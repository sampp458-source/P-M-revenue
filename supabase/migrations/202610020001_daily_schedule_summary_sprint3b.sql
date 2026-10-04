-- Candidate only. No configuration enable, cron creation, backfill or history write.
BEGIN;
DO $guard$
DECLARE e record; p record;
BEGIN
 FOR e IN SELECT * FROM (VALUES
 ('run_daily_schedule_summary_at_v1(timestamptz)','0e2d249aa51b35203721fde124fff0a9',false),
 ('run_daily_schedule_summary_v1()','10de0bfc638a35f14b788ae934a207f0',true),
 ('wake_notification_push_v1()','215b74930f9d800053f776068d07fad9',true),
 ('push_delivery_valid_v1(uuid)','963dc5c1796c7cdc86c03c56918e0603',true),
 ('claim_notification_push_deliveries_v1(integer)','85f15dbfd14fb26848dfc68d0416d37d',true),
 ('schedule_notification_recipient_v1(uuid)','d9557fb448ee44436cf92be3157ff178',false),
 ('emit_schedule_notification_v1(uuid,uuid,text,text,date,integer)','856c596505f9fc38110e1b2e47e30c08',false)
 ) v(sig,hash,service_access) LOOP
  SELECT oid,md5(prosrc) hash,prosecdef,proconfig,pg_get_userbyid(proowner) owner,
   ARRAY(SELECT a::text FROM unnest(proacl) a ORDER BY a::text) acl INTO p
  FROM pg_proc WHERE oid=to_regprocedure('public.'||e.sig);
  IF NOT FOUND OR p.hash IS DISTINCT FROM e.hash OR p.owner IS DISTINCT FROM 'postgres'
   OR NOT p.prosecdef OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']::text[]
   OR p.acl IS DISTINCT FROM (CASE WHEN e.service_access
    THEN ARRAY['postgres=X/postgres','service_role=X/postgres']::text[] ELSE ARRAY['postgres=X/postgres']::text[] END)
  THEN RAISE EXCEPTION 'DAILY_PREDECESSOR_MISMATCH: %',e.sig; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM public.notification_events WHERE event_type='DAILY_SCHEDULE_SUMMARY') THEN
  RAISE EXCEPTION 'DAILY_EXISTING_EVENTS_REQUIRE_AUDIT';
 END IF;
END $guard$;

CREATE TABLE public.notification_daily_summary_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), summary_date date NOT NULL,
 scope text NOT NULL CHECK(scope IN ('FULL','PILOT')), pilot_recipient_id uuid,
 request_id uuid NOT NULL UNIQUE, started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 completed_at timestamptz,
 eligible_recipient_count integer NOT NULL DEFAULT 0 CHECK(eligible_recipient_count>=0),
 zero_schedule_recipient_count integer NOT NULL DEFAULT 0 CHECK(zero_schedule_recipient_count>=0),
 snapshots_created integer NOT NULL DEFAULT 0 CHECK(snapshots_created>=0),
 idempotent_snapshot_skips integer NOT NULL DEFAULT 0 CHECK(idempotent_snapshot_skips>=0),
 summaries_created integer NOT NULL DEFAULT 0 CHECK(summaries_created>=0),
 notifications_created integer NOT NULL DEFAULT 0 CHECK(notifications_created>=0),
 deliveries_created integer NOT NULL DEFAULT 0 CHECK(deliveries_created>=0),
 CHECK((scope='FULL' AND pilot_recipient_id IS NULL) OR (scope='PILOT' AND pilot_recipient_id IS NOT NULL))
);
CREATE UNIQUE INDEX notification_daily_full_date ON public.notification_daily_summary_runs(summary_date) WHERE scope='FULL';
CREATE UNIQUE INDEX notification_daily_pilot_date ON public.notification_daily_summary_runs(summary_date,pilot_recipient_id) WHERE scope='PILOT';
CREATE TABLE public.notification_daily_summary_recipient_state (
 summary_date date NOT NULL, recipient_id uuid NOT NULL,
 schedule_count integer NOT NULL CHECK(schedule_count>=0),
 run_id uuid NOT NULL REFERENCES public.notification_daily_summary_runs(id),
 snapshot_at timestamptz NOT NULL,
 event_id uuid REFERENCES public.notification_events(id) DEFERRABLE INITIALLY DEFERRED,
 PRIMARY KEY(summary_date,recipient_id),
 CHECK((schedule_count=0 AND event_id IS NULL) OR (schedule_count>0 AND event_id IS NOT NULL))
);
ALTER TABLE public.notification_daily_summary_runs OWNER TO postgres;
ALTER TABLE public.notification_daily_summary_recipient_state OWNER TO postgres;
ALTER TABLE public.notification_daily_summary_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_daily_summary_recipient_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_daily_summary_runs,public.notification_daily_summary_recipient_state FROM PUBLIC,anon,authenticated,service_role;

-- All selection and snapshot INSERTs share ONE statement snapshot. No per-user
-- SELECT loop. The date mutex is acquired BEFORE that statement, and no domain
-- row locks are taken. PILOT and FULL share the recipient/date unique guard.
CREATE FUNCTION public.run_daily_schedule_summary_internal_v2(
 p_now timestamptz,p_scope text,p_recipient uuid,p_request uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE cfg public.notification_schedule_config; day date; rid uuid; old_run public.notification_daily_summary_runs;
 stats jsonb; nids uuid[]; queued integer; local_now timestamp;
BEGIN
 IF p_now IS NULL OR p_request IS NULL OR p_scope IS NULL OR p_scope NOT IN ('FULL','PILOT')
  OR (p_scope='FULL' AND p_recipient IS NOT NULL) OR (p_scope='PILOT' AND p_recipient IS NULL)
 THEN RAISE EXCEPTION 'INVALID_DAILY_SCOPE' USING ERRCODE='22023'; END IF;
 SELECT * INTO STRICT cfg FROM public.notification_schedule_config WHERE singleton IS TRUE;
 local_now:=p_now AT TIME ZONE cfg.timezone; day:=local_now::date;
 stats:=jsonb_build_object('summary_date',day,'scope',p_scope,'eligible_recipients',0,'zero_schedule_recipients',0,
  'snapshots_created',0,'idempotent_snapshot_skips',0,'summaries_created',0,'notifications_created',0,'deliveries_created',0);
 -- PILOT is owner-only, explicitly bypasses Daily OFF and the time gate, but
 -- never bypasses Operations eligibility or a disabled realtime source.
 IF NOT cfg.enabled OR (p_scope='FULL' AND NOT cfg.daily_summary_enabled) THEN
  RETURN stats||jsonb_build_object('result','DISABLED'); END IF;
 IF p_scope='FULL' AND local_now::time<cfg.daily_summary_time THEN
  RETURN stats||jsonb_build_object('result','BEFORE_TIME'); END IF;
 PERFORM pg_advisory_xact_lock(734203,day-DATE '2000-01-01');
 SELECT * INTO old_run FROM public.notification_daily_summary_runs WHERE request_id=p_request;
 IF FOUND AND (old_run.summary_date<>day OR old_run.scope<>p_scope OR old_run.pilot_recipient_id IS DISTINCT FROM p_recipient)
 THEN RAISE EXCEPTION 'DAILY_REQUEST_CONFLICT' USING ERRCODE='22023'; END IF;
 -- FULL success freezes the entire date, including users activated afterwards.
 SELECT * INTO old_run FROM public.notification_daily_summary_runs
 WHERE summary_date=day AND (scope='FULL' OR (scope=p_scope AND pilot_recipient_id=p_recipient))
 ORDER BY (scope='FULL') DESC LIMIT 1;
 IF FOUND THEN
  RETURN stats||jsonb_build_object('result','ALREADY_COMPLETED','run_id',old_run.id,
   'idempotent_snapshot_skips',(SELECT count(*) FROM public.notification_daily_summary_recipient_state
    WHERE summary_date=day AND (p_scope='FULL' OR recipient_id=p_recipient)));
 END IF;
 INSERT INTO public.notification_daily_summary_runs(summary_date,scope,pilot_recipient_id,request_id)
 VALUES(day,p_scope,p_recipient,p_request) RETURNING id INTO rid;
 WITH capture AS MATERIALIZED (SELECT clock_timestamp() snapshot_at), eligible AS MATERIALIZED (
  SELECT p.id FROM public.profiles p
  WHERE public.schedule_notification_recipient_v1(p.id) AND (p_scope='FULL' OR p.id=p_recipient)
 ), counts AS MATERIALIZED (
  SELECT e.id recipient_id,count(DISTINCT s.id)::integer n
  FROM eligible e LEFT JOIN public.operation_schedule_assignees a ON a.profile_id=e.id AND a.archived_at IS NULL
  LEFT JOIN public.operation_schedules s ON s.id=a.schedule_id AND s.archived_at IS NULL AND s.status='scheduled'
   AND s.starts_at<(day+1)::timestamp AT TIME ZONE cfg.timezone
   AND s.ends_at>day::timestamp AT TIME ZONE cfg.timezone
  GROUP BY e.id
 ), snapshots AS (
  INSERT INTO public.notification_daily_summary_recipient_state(summary_date,recipient_id,schedule_count,run_id,snapshot_at,event_id)
  SELECT day,c.recipient_id,c.n,rid,capture.snapshot_at,CASE WHEN c.n>0 THEN gen_random_uuid() END
  FROM counts c CROSS JOIN capture
  ORDER BY c.recipient_id ON CONFLICT(summary_date,recipient_id) DO NOTHING RETURNING *
 ), events AS (
  INSERT INTO public.notification_events(id,event_type,source_kind,source_id,dedupe_key,payload,state,processed_at)
  SELECT s.event_id,'DAILY_SCHEDULE_SUMMARY','schedule',s.recipient_id,'daily-schedule:'||s.recipient_id||':'||day,
   jsonb_build_object('local_date',day,'count',s.schedule_count),'processed',now()
  FROM snapshots s WHERE s.schedule_count>0
  ON CONFLICT(dedupe_key) DO NOTHING RETURNING id,source_id
 ), notices AS (
  INSERT INTO public.notifications(event_id,recipient_id,category,title,message,deep_link_type,deep_link_id,schedule_local_date)
  SELECT e.id,e.source_id,'SCHEDULE','오늘 일정 '||s.schedule_count||'건이 있습니다.',
   to_char(day,'YYYY. MM. DD.')||' · 나의 예정 일정','SCHEDULE_DAY',e.source_id,day
  FROM events e JOIN snapshots s ON s.event_id=e.id
  ON CONFLICT(event_id,recipient_id) DO NOTHING RETURNING id
 )
 SELECT stats||jsonb_build_object('eligible_recipients',(SELECT count(*) FROM counts),
  'zero_schedule_recipients',(SELECT count(*) FROM counts WHERE n=0),
  'snapshots_created',(SELECT count(*) FROM snapshots),
  'idempotent_snapshot_skips',(SELECT count(*) FROM counts)-(SELECT count(*) FROM snapshots),
  'summaries_created',(SELECT count(*) FROM events),'notifications_created',(SELECT count(*) FROM notices)),
  ARRAY(SELECT id FROM notices) INTO stats,nids;
 -- AFTER INSERT delivery triggers have completed; count only this run's new
 -- notifications. This later SELECT is statistics, never a second domain snapshot.
 SELECT count(*) INTO queued FROM public.notification_push_deliveries WHERE notification_id=ANY(nids);
 stats:=stats||jsonb_build_object('deliveries_created',queued,'run_id',rid,'result','COMPLETED');
 UPDATE public.notification_daily_summary_runs SET completed_at=clock_timestamp(),
  eligible_recipient_count=(stats->>'eligible_recipients')::integer,
  zero_schedule_recipient_count=(stats->>'zero_schedule_recipients')::integer,
  snapshots_created=(stats->>'snapshots_created')::integer,
  idempotent_snapshot_skips=(stats->>'idempotent_snapshot_skips')::integer,
  summaries_created=(stats->>'summaries_created')::integer,
  notifications_created=(stats->>'notifications_created')::integer,deliveries_created=queued WHERE id=rid;
 RETURN stats;
END $$;
CREATE OR REPLACE FUNCTION public.run_daily_schedule_summary_at_v1(p_now timestamptz) RETURNS integer
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT (public.run_daily_schedule_summary_internal_v2(p_now,'FULL',NULL,gen_random_uuid())->>'summaries_created')::integer
$$;
CREATE FUNCTION public.run_daily_schedule_summary_v2() RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT public.run_daily_schedule_summary_internal_v2(statement_timestamp(),'FULL',NULL,gen_random_uuid())
$$;
CREATE FUNCTION public.run_daily_schedule_summary_pilot_v1(p_recipient uuid,p_now timestamptz DEFAULT statement_timestamp(),p_request uuid DEFAULT gen_random_uuid()) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT public.run_daily_schedule_summary_internal_v2(p_now,'PILOT',p_recipient,p_request)
$$;

-- Keep the safeupdate WHERE predicates. Diagnostic failure is itself contained.
CREATE OR REPLACE FUNCTION public.wake_notification_push_v1() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE worker_url text; worker_secret text;
BEGIN
 BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.notification_push_config WHERE enabled) THEN RETURN; END IF;
  EXECUTE 'SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name=$1' INTO worker_url USING 'notification_push_worker_url';
  EXECUTE 'SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name=$1' INTO worker_secret USING 'notification_push_worker_secret';
  IF worker_url !~ '^https://[a-z0-9]+\.supabase\.co/functions/v1/notification-push-dispatch$' OR worker_url IS NULL OR length(coalesce(worker_secret,''))<32 THEN RAISE EXCEPTION 'PUSH_WAKE_NOT_CONFIGURED'; END IF;
  EXECUTE 'SELECT net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 3000)'
   USING worker_url,'{}'::jsonb,jsonb_build_object('Content-Type','application/json','x-push-worker-secret',worker_secret);
  UPDATE public.notification_push_config SET last_wake_at=now(),last_wake_error=NULL WHERE singleton IS TRUE;
 EXCEPTION WHEN OTHERS THEN
  BEGIN
   UPDATE public.notification_push_config SET last_wake_error='WAKE_UNAVAILABLE' WHERE singleton IS TRUE;
  EXCEPTION WHEN OTHERS THEN
   RAISE LOG 'NOTIFICATION_PUSH_WAKE_DIAGNOSTIC_UNAVAILABLE';
  END;
 END;
END $$;

-- Keep past app notifications/read history. Only provider delivery is time-bound.
CREATE OR REPLACE FUNCTION public.push_delivery_valid_v1(p_delivery_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.notification_push_deliveries d
 JOIN public.notifications n ON n.id=d.notification_id JOIN public.notification_events e ON e.id=n.event_id
 JOIN public.push_subscriptions s ON s.id=d.subscription_id JOIN public.profiles p ON p.id=s.profile_id
 WHERE d.id=p_delivery_id AND d.binding_id=s.binding_id AND n.recipient_id=s.profile_id
 AND s.revoked_at IS NULL AND (s.expiration_time IS NULL OR s.expiration_time>now())
 AND (e.event_type<>'DAILY_SCHEDULE_SUMMARY' OR n.schedule_local_date=(statement_timestamp() AT TIME ZONE 'Asia/Seoul')::date)
 AND (n.category<>'SCHEDULE' OR (public.schedule_notification_recipient_v1(s.profile_id) AND (n.deep_link_type='SCHEDULE_DAY' OR EXISTS(
  SELECT 1 FROM public.operation_schedule_assignees a JOIN public.operation_schedules os ON os.id=a.schedule_id
  WHERE a.schedule_id=n.deep_link_id AND a.profile_id=s.profile_id AND a.archived_at IS NULL AND os.archived_at IS NULL))))
 AND p.is_active AND p.account_status='active' AND n.revoked_at IS NULL AND (n.expires_at IS NULL OR n.expires_at>now()))
$$;
CREATE OR REPLACE FUNCTION public.claim_notification_push_deliveries_v1(p_limit integer DEFAULT 10)
RETURNS TABLE(delivery_id uuid,token uuid) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 -- Expired Daily rows become terminal, including exhausted retries. An active
 -- provider lease is not stolen; get_delivery rechecks validity before send.
 WITH expired AS (
  SELECT d.id FROM public.notification_push_deliveries d
  JOIN public.notifications n ON d.notification_id=n.id JOIN public.notification_events e ON e.id=n.event_id
  WHERE e.event_type='DAILY_SCHEDULE_SUMMARY'
  AND n.schedule_local_date<(statement_timestamp() AT TIME ZONE 'Asia/Seoul')::date
  AND (d.status IN ('PENDING','FAILED') OR (d.status='PROCESSING' AND d.lease_until<=now()))
  ORDER BY d.id FOR UPDATE OF d SKIP LOCKED
 )
 UPDATE public.notification_push_deliveries d SET status='CANCELLED',claim_token=NULL,lease_until=NULL,
  last_error='DAILY_DATE_EXPIRED',updated_at=now() FROM expired x WHERE d.id=x.id;
 IF NOT EXISTS(SELECT 1 FROM public.notification_push_config WHERE enabled) THEN RETURN; END IF;
 RETURN QUERY WITH due AS (
  SELECT d.id FROM public.notification_push_deliveries d
  WHERE ((d.status IN ('PENDING','FAILED') AND d.available_at<=now()) OR (d.status='PROCESSING' AND d.lease_until<=now()))
  AND d.attempt_count<6 ORDER BY d.available_at,d.id LIMIT greatest(1,least(coalesce(p_limit,10),10)) FOR UPDATE SKIP LOCKED
 ), claimed AS (
  UPDATE public.notification_push_deliveries d SET status=CASE WHEN public.push_delivery_valid_v1(d.id) THEN 'PROCESSING' ELSE 'CANCELLED' END,
   attempt_count=attempt_count+1,claimed_at=now(),lease_until=now()+interval '120 seconds',claim_token=gen_random_uuid(),updated_at=now()
  FROM due WHERE d.id=due.id RETURNING d.*
 ) SELECT id,claim_token FROM claimed WHERE status='PROCESSING';
 UPDATE public.notification_push_deliveries SET status='FAILED',lease_until=NULL,claim_token=NULL,last_error='ATTEMPTS_EXHAUSTED',updated_at=now()
 WHERE status='PROCESSING' AND lease_until<=now() AND attempt_count>=6;
END $$;

-- Defeat Production default ACL grants in the same transaction as creation.
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT oid::regprocedure sig FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN
 ('run_daily_schedule_summary_internal_v2','run_daily_schedule_summary_at_v1','run_daily_schedule_summary_v1',
  'run_daily_schedule_summary_v2','run_daily_schedule_summary_pilot_v1','wake_notification_push_v1',
  'push_delivery_valid_v1','claim_notification_push_deliveries_v1') LOOP
  EXECUTE format('ALTER FUNCTION %s OWNER TO postgres',f.sig);
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.sig);
 END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.run_daily_schedule_summary_v1(),public.run_daily_schedule_summary_v2(),
 public.wake_notification_push_v1(),public.push_delivery_valid_v1(uuid),public.claim_notification_push_deliveries_v1(integer) TO service_role;
COMMIT;
