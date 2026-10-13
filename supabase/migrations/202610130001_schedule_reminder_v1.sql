-- LOCAL CANDIDATE ONLY. No enable, cron, historical replay or domain data repair.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $guard$ BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'REMINDER_OWNER_REQUIRED'; END IF;
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid=to_regprocedure('public.claim_notification_push_deliveries_v1(integer)')) IS DISTINCT FROM '319ec38bc86e309224fb08b4a4529d85' THEN RAISE EXCEPTION 'REMINDER_CLAIM_PREDECESSOR_MISMATCH'; END IF;
 IF (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('push_delivery_valid_v1','get_notification_push_delivery_v1','claim_notification_push_deliveries_v1'))<>3
 OR EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid IN (to_regprocedure('public.push_delivery_valid_v1(uuid)'),to_regprocedure('public.get_notification_push_delivery_v1(uuid,uuid)'),to_regprocedure('public.claim_notification_push_deliveries_v1(integer)')) AND (
 NOT p.prosecdef OR pg_get_userbyid(p.proowner)<>'postgres' OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']::text[]
 OR ARRAY(SELECT a::text FROM unnest(p.proacl) a ORDER BY a::text) IS DISTINCT FROM
 ARRAY['postgres=X/postgres','service_role=X/postgres']::text[]))
 THEN RAISE EXCEPTION 'REMINDER_PREDECESSOR_SECURITY_MISMATCH'; END IF;
 IF to_regclass('public.notification_schedule_reminder_config') IS NOT NULL THEN RAISE EXCEPTION 'REMINDER_ALREADY_INSTALLED'; END IF;
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid=to_regprocedure('public.push_delivery_valid_v1(uuid)')) IS DISTINCT FROM '926f1a5f9b11844dd0bc2e007c9c0763'
 OR (SELECT md5(prosrc) FROM pg_proc WHERE oid=to_regprocedure('public.get_notification_push_delivery_v1(uuid,uuid)')) IS DISTINCT FROM '268508092991e9446ce30b0d1a94d927' THEN RAISE EXCEPTION 'REMINDER_PREDECESSOR_MISMATCH'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc pp WHERE pp.oid=to_regprocedure('public.get_notification_detail_v1(uuid)') AND md5(pp.prosrc)='4889ef578a2b0950e15a6e029d06672a' AND pp.prosecdef AND pg_get_userbyid(pp.proowner)='postgres' AND pp.proconfig=ARRAY['search_path=pg_catalog, public']::text[] AND ARRAY(SELECT x::text FROM unnest(pp.proacl)x ORDER BY x::text)=ARRAY['authenticated=X/postgres','postgres=X/postgres','service_role=X/postgres']::text[]) THEN RAISE EXCEPTION 'REMINDER_READ_PREDECESSOR_MISMATCH: get_notification_detail_v1'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc pp WHERE pp.oid=to_regprocedure('public.get_notification_inbox_v1(integer,boolean)') AND md5(pp.prosrc)='397f00adc17606674db3568884936c21' AND pp.prosecdef AND pg_get_userbyid(pp.proowner)='postgres' AND pp.proconfig=ARRAY['search_path=pg_catalog, public']::text[] AND ARRAY(SELECT x::text FROM unnest(pp.proacl)x ORDER BY x::text)=ARRAY['authenticated=X/postgres','postgres=X/postgres','service_role=X/postgres']::text[]) THEN RAISE EXCEPTION 'REMINDER_READ_PREDECESSOR_MISMATCH: get_notification_inbox_v1'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc pp WHERE pp.oid=to_regprocedure('public.mark_all_notifications_read_v1()') AND md5(pp.prosrc)='e0d0fcd15b4eb35e8c9b8468bf6eaaaf' AND pp.prosecdef AND pg_get_userbyid(pp.proowner)='postgres' AND pp.proconfig=ARRAY['search_path=pg_catalog, public']::text[] AND ARRAY(SELECT x::text FROM unnest(pp.proacl)x ORDER BY x::text)=ARRAY['authenticated=X/postgres','postgres=X/postgres']::text[]) THEN RAISE EXCEPTION 'REMINDER_READ_PREDECESSOR_MISMATCH: mark_all_notifications_read_v1'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc pp WHERE pp.oid=to_regprocedure('public.mark_notification_read_v1(uuid)') AND md5(pp.prosrc)='8e47d2f343adec3749b060675ad59c6e' AND pp.prosecdef AND pg_get_userbyid(pp.proowner)='postgres' AND pp.proconfig=ARRAY['search_path=pg_catalog, public']::text[] AND ARRAY(SELECT x::text FROM unnest(pp.proacl)x ORDER BY x::text)=ARRAY['authenticated=X/postgres','postgres=X/postgres','service_role=X/postgres']::text[]) THEN RAISE EXCEPTION 'REMINDER_READ_PREDECESSOR_MISMATCH: mark_notification_read_v1'; END IF;
END $guard$;
-- Atomic metadata baseline plus trigger installation; concurrent writers wait briefly.
LOCK TABLE public.operation_schedules,public.operation_schedule_assignees IN SHARE ROW EXCLUSIVE MODE;
CREATE TABLE public.notification_schedule_reminder_config (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), enabled boolean NOT NULL DEFAULT false,
 enabled_at timestamptz, pilot_recipient_id uuid REFERENCES public.profiles(id),
 CHECK(NOT enabled OR enabled_at IS NOT NULL)
);
INSERT INTO public.notification_schedule_reminder_config(singleton) VALUES(true);
CREATE TABLE public.notification_schedule_reminder_types (
 calendar_id uuid NOT NULL REFERENCES public.operation_calendars(id),
 schedule_type_id uuid NOT NULL REFERENCES public.operation_schedule_types(id),
 mode text NOT NULL CHECK(mode IN ('STANDARD','HOTEL','DAYCARE')),
 PRIMARY KEY(calendar_id,schedule_type_id)
);
INSERT INTO public.notification_schedule_reminder_types VALUES ('a6e1dcea-478a-4d67-a4b4-1ce92a9c009e','4855ec9d-b5d7-4171-86b9-52f8aef07b0e','STANDARD'),('04684630-3eca-4650-ad24-c4defb6c5c7d','5adeacd6-8807-4521-b29a-f997f6b7af04','HOTEL'),('3b3eb37e-1dcb-4275-9ed2-521040ccd45e','b4d4fc90-5b65-42eb-adae-1c964c31e9d3','STANDARD'),('04684630-3eca-4650-ad24-c4defb6c5c7d','4855ec9d-b5d7-4171-86b9-52f8aef07b0e','STANDARD'),('04684630-3eca-4650-ad24-c4defb6c5c7d','b4d4fc90-5b65-42eb-adae-1c964c31e9d3','STANDARD'),('a6e1dcea-478a-4d67-a4b4-1ce92a9c009e','b4d4fc90-5b65-42eb-adae-1c964c31e9d3','STANDARD'),('35f8010c-cba0-41aa-9e96-a02c305eb1a0','b4d4fc90-5b65-42eb-adae-1c964c31e9d3','STANDARD'),('35f8010c-cba0-41aa-9e96-a02c305eb1a0','4855ec9d-b5d7-4171-86b9-52f8aef07b0e','STANDARD'),('3b3eb37e-1dcb-4275-9ed2-521040ccd45e','7677172a-088c-47de-98b8-b7591df89579','STANDARD'),('04684630-3eca-4650-ad24-c4defb6c5c7d','5cadf20b-021a-4948-a5dd-471677f51d21','DAYCARE');
DO $mapping$ BEGIN
 IF EXISTS(SELECT 1 FROM public.notification_schedule_reminder_types r WHERE NOT EXISTS(
 SELECT 1 FROM public.operation_calendar_schedule_types m WHERE m.calendar_id=r.calendar_id AND m.schedule_type_id=r.schedule_type_id AND m.is_active AND m.archived_at IS NULL))
 THEN RAISE EXCEPTION 'REMINDER_ALLOWLIST_MAPPING_MISSING'; END IF;
END $mapping$;
CREATE TABLE public.notification_schedule_reminder_timing (
 schedule_id uuid PRIMARY KEY REFERENCES public.operation_schedules(id) ON DELETE CASCADE, starts_at timestamptz NOT NULL,
 observed_at timestamptz NOT NULL
);
-- Unknown historical change times are conservatively the installation time.
INSERT INTO public.notification_schedule_reminder_timing SELECT id,starts_at,statement_timestamp() FROM public.operation_schedules;
CREATE TABLE public.notification_schedule_reminder_assignments (
 assignment_id uuid PRIMARY KEY REFERENCES public.operation_schedule_assignees(id) ON DELETE CASCADE,
 recipient_id uuid NOT NULL REFERENCES public.profiles(id), observed_at timestamptz NOT NULL
);
INSERT INTO public.notification_schedule_reminder_assignments SELECT id,profile_id,clock_timestamp() FROM public.operation_schedule_assignees;
CREATE TABLE public.notification_schedule_reminders (
 -- Retain occurrence identifiers after domain deletion; live joins fail closed.
 -- Only disposable observation rows cascade, never notifications or audit.
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), schedule_id uuid NOT NULL,
 recipient_id uuid NOT NULL REFERENCES public.profiles(id), assignment_id uuid NOT NULL,
 starts_at timestamptz NOT NULL, due_at timestamptz NOT NULL, notification_id uuid UNIQUE REFERENCES public.notifications(id),
 invalidated_at timestamptz, created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 UNIQUE(schedule_id,recipient_id,starts_at), CHECK(due_at=starts_at-interval '15 minutes')
);
CREATE INDEX schedule_reminder_due ON public.operation_schedules(starts_at,id) WHERE status='scheduled' AND archived_at IS NULL AND NOT all_day AND NOT time_unspecified;
CREATE INDEX schedule_reminder_notices ON public.notification_schedule_reminders(schedule_id) WHERE invalidated_at IS NULL;
ALTER TABLE public.notification_schedule_reminder_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_schedule_reminder_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_schedule_reminder_timing ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_schedule_reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_schedule_reminder_assignments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_schedule_reminder_config,public.notification_schedule_reminder_types,public.notification_schedule_reminder_timing,public.notification_schedule_reminder_assignments,public.notification_schedule_reminders FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.notification_schedule_reminder_config TO service_role;
GRANT UPDATE(enabled,pilot_recipient_id) ON public.notification_schedule_reminder_config TO service_role;
CREATE FUNCTION public.control_schedule_reminder_epoch_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $epoch$
BEGIN
 IF NEW.enabled AND (NOT OLD.enabled OR NEW.pilot_recipient_id IS DISTINCT FROM OLD.pilot_recipient_id) THEN NEW.enabled_at:=clock_timestamp();
 ELSE NEW.enabled_at:=OLD.enabled_at; END IF;
 RETURN NEW;
END $epoch$;
CREATE TRIGGER schedule_reminder_epoch BEFORE UPDATE ON public.notification_schedule_reminder_config FOR EACH ROW EXECUTE FUNCTION public.control_schedule_reminder_epoch_v1();

CREATE FUNCTION public.schedule_reminder_eligible_v1(p_schedule uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $eligible$
 SELECT EXISTS(SELECT 1 FROM public.operation_schedules s
 JOIN public.notification_schedule_reminder_types r ON r.calendar_id=s.calendar_id AND r.schedule_type_id=s.schedule_type_id
 JOIN public.operation_calendars c ON c.id=s.calendar_id AND c.is_active
 JOIN public.operation_schedule_types t ON t.id=s.schedule_type_id AND t.is_active
 JOIN public.operation_calendar_schedule_types m ON m.calendar_id=s.calendar_id AND m.schedule_type_id=s.schedule_type_id AND m.is_active AND m.archived_at IS NULL
 WHERE s.id=p_schedule AND s.status='scheduled' AND s.archived_at IS NULL AND NOT s.all_day AND NOT s.time_unspecified
 AND CASE r.mode
 WHEN 'HOTEL' THEN EXISTS(SELECT 1 FROM public.hotel_stay_schedule_events e JOIN public.hotel_stays h ON h.id=e.hotel_stay_id
 WHERE e.operation_schedule_id=s.id AND e.archived_at IS NULL AND h.archived_at IS NULL AND h.checked_out_at IS NULL
 AND ((e.event_kind='check_in' AND h.checked_in_at IS NULL) OR e.event_kind='check_out'))
 WHEN 'DAYCARE' THEN EXISTS(SELECT 1 FROM public.daycare_operation_states d WHERE d.operation_schedule_id=s.id AND d.lifecycle_status='scheduled' AND d.checked_in_at IS NULL)
 ELSE true END)
$eligible$;
CREATE FUNCTION public.schedule_reminder_visible_v1(p_notification uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $visible$
 SELECT CASE WHEN e.event_type<>'SCHEDULE_REMINDER' THEN true ELSE EXISTS(
 SELECT 1 FROM public.notification_schedule_reminders r
 JOIN public.operation_schedules os ON os.id=r.schedule_id AND os.starts_at=r.starts_at
 JOIN public.operation_schedule_assignees aa ON aa.id=r.assignment_id AND aa.schedule_id=r.schedule_id AND aa.profile_id=r.recipient_id AND aa.archived_at IS NULL
 WHERE r.notification_id=n.id AND r.recipient_id=n.recipient_id AND r.invalidated_at IS NULL
 AND statement_timestamp()<r.starts_at AND public.schedule_reminder_eligible_v1(r.schedule_id)
 AND public.schedule_notification_recipient_v1(r.recipient_id)
 AND EXISTS(SELECT 1 FROM public.notification_schedule_config WHERE singleton AND enabled)
 AND EXISTS(SELECT 1 FROM public.notification_schedule_reminder_config WHERE singleton AND enabled AND r.due_at>=enabled_at AND (pilot_recipient_id IS NULL OR pilot_recipient_id=r.recipient_id))) END
 FROM public.notifications n JOIN public.notification_events e ON e.id=n.event_id WHERE n.id=p_notification
$visible$;

CREATE FUNCTION public.schedule_reminder_delivery_valid_v1(p_delivery uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $valid$
 SELECT CASE WHEN e.event_type<>'SCHEDULE_REMINDER' THEN true ELSE EXISTS(
 SELECT 1 FROM public.notification_schedule_reminders r
 JOIN public.operation_schedules os ON os.id=r.schedule_id
 JOIN public.operation_schedule_assignees a ON a.id=r.assignment_id AND a.schedule_id=r.schedule_id AND a.profile_id=r.recipient_id AND a.archived_at IS NULL
 WHERE r.notification_id=n.id AND r.invalidated_at IS NULL AND os.starts_at=r.starts_at
 AND r.due_at<=statement_timestamp() AND statement_timestamp()<r.starts_at
 AND public.schedule_reminder_eligible_v1(r.schedule_id)
 AND EXISTS(SELECT 1 FROM public.notification_schedule_config WHERE singleton AND enabled)
 AND EXISTS(SELECT 1 FROM public.notification_schedule_reminder_config WHERE singleton AND enabled AND r.due_at>=enabled_at AND (pilot_recipient_id IS NULL OR pilot_recipient_id=r.recipient_id))) END
 FROM public.notification_push_deliveries d JOIN public.notifications n ON n.id=d.notification_id JOIN public.notification_events e ON e.id=n.event_id WHERE d.id=p_delivery
$valid$;
CREATE FUNCTION public.invalidate_schedule_reminders_v1(p_schedule uuid DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $invalidate$
BEGIN
 UPDATE public.notification_schedule_reminders r SET invalidated_at=statement_timestamp()
 WHERE r.invalidated_at IS NULL AND (p_schedule IS NULL OR r.schedule_id=p_schedule) AND (
 r.starts_at<=statement_timestamp() OR NOT public.schedule_reminder_eligible_v1(r.schedule_id)
 OR NOT EXISTS(SELECT 1 FROM public.operation_schedules os WHERE os.id=r.schedule_id AND os.starts_at=r.starts_at)
 OR NOT EXISTS(SELECT 1 FROM public.operation_schedule_assignees aa WHERE aa.id=r.assignment_id AND aa.schedule_id=r.schedule_id AND aa.profile_id=r.recipient_id AND aa.archived_at IS NULL));
END $invalidate$;
CREATE FUNCTION public.track_schedule_reminder_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $track$
DECLARE sid uuid; current_start timestamptz; current_assignment public.operation_schedule_assignees;
BEGIN
 IF TG_TABLE_NAME='operation_schedules' THEN
 sid:=NEW.id;
 SELECT starts_at INTO current_start FROM public.operation_schedules WHERE id=sid;
 IF NOT FOUND THEN RETURN NULL; END IF;
 INSERT INTO public.notification_schedule_reminder_timing(schedule_id,starts_at,observed_at) VALUES(sid,current_start,clock_timestamp())
 ON CONFLICT(schedule_id) DO UPDATE SET starts_at=EXCLUDED.starts_at,observed_at=EXCLUDED.observed_at
 WHERE notification_schedule_reminder_timing.starts_at IS DISTINCT FROM EXCLUDED.starts_at
 OR (TG_OP='UPDATE' AND (OLD.time_unspecified IS DISTINCT FROM NEW.time_unspecified OR OLD.all_day IS DISTINCT FROM NEW.all_day
 OR OLD.calendar_id IS DISTINCT FROM NEW.calendar_id OR OLD.schedule_type_id IS DISTINCT FROM NEW.schedule_type_id
 OR OLD.status IS DISTINCT FROM NEW.status OR OLD.archived_at IS DISTINCT FROM NEW.archived_at));
 ELSE
 sid:=NEW.schedule_id;
 SELECT * INTO current_assignment FROM public.operation_schedule_assignees WHERE id=NEW.id;
 IF FOUND AND current_assignment.archived_at IS NULL THEN
 INSERT INTO public.notification_schedule_reminder_assignments(assignment_id,recipient_id,observed_at)
 VALUES(current_assignment.id,current_assignment.profile_id,clock_timestamp())
 ON CONFLICT(assignment_id) DO UPDATE SET recipient_id=EXCLUDED.recipient_id,observed_at=EXCLUDED.observed_at
 WHERE notification_schedule_reminder_assignments.recipient_id IS DISTINCT FROM EXCLUDED.recipient_id
 OR (TG_OP='UPDATE' AND OLD.archived_at IS NOT NULL AND NEW.archived_at IS NULL);
 END IF;
 END IF;
 PERFORM public.invalidate_schedule_reminders_v1(sid);
 RETURN NULL;
END $track$;
CREATE CONSTRAINT TRIGGER schedule_reminder_track AFTER INSERT OR UPDATE ON public.operation_schedules DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.track_schedule_reminder_v1();
CREATE CONSTRAINT TRIGGER schedule_reminder_assignment AFTER INSERT OR UPDATE ON public.operation_schedule_assignees DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.track_schedule_reminder_v1();

CREATE FUNCTION public.run_schedule_reminders_at_v1(p_now timestamptz) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $run$
DECLARE cfg public.notification_schedule_reminder_config; s public.operation_schedules; a record; rid uuid; eid uuid; nid uuid; emitted integer:=0;
BEGIN
 IF p_now IS NULL THEN RAISE EXCEPTION 'INVALID_REMINDER_TIME'; END IF;
 SELECT * INTO STRICT cfg FROM public.notification_schedule_reminder_config WHERE singleton;
 IF NOT cfg.enabled OR NOT EXISTS(SELECT 1 FROM public.notification_schedule_config WHERE singleton AND enabled) THEN RETURN 0; END IF;
 IF NOT pg_try_advisory_xact_lock(734204,1) THEN RETURN 0; END IF;
 -- Bounded five-minute catch-up; do not drain an old reminder backlog.
 FOR s IN SELECT os.* FROM public.operation_schedules os WHERE os.starts_at>p_now
 AND os.starts_at-interval '15 minutes' BETWEEN greatest(cfg.enabled_at,p_now-interval '5 minutes') AND p_now
 AND public.schedule_reminder_eligible_v1(os.id)
 AND EXISTS(SELECT 1 FROM public.notification_schedule_reminder_timing tm WHERE tm.schedule_id=os.id AND tm.starts_at=os.starts_at AND tm.observed_at<os.starts_at-interval '15 minutes')
 AND EXISTS(SELECT 1 FROM public.operation_schedule_assignees x WHERE x.schedule_id=os.id AND x.archived_at IS NULL
 AND x.created_at<os.starts_at-interval '15 minutes' AND EXISTS(SELECT 1 FROM public.notification_schedule_reminder_assignments am WHERE am.assignment_id=x.id AND am.recipient_id=x.profile_id AND am.observed_at<os.starts_at-interval '15 minutes') AND public.schedule_notification_recipient_v1(x.profile_id)
 AND (cfg.pilot_recipient_id IS NULL OR cfg.pilot_recipient_id=x.profile_id)
 AND NOT EXISTS(SELECT 1 FROM public.notification_schedule_reminders r WHERE r.schedule_id=os.id AND r.recipient_id=x.profile_id AND r.starts_at=os.starts_at))
 ORDER BY os.starts_at,os.id LIMIT 500 FOR UPDATE OF os SKIP LOCKED
 LOOP
 -- Fresh statements after the domain mutex; canonical RPCs lock schedule before links.
 IF NOT public.schedule_reminder_eligible_v1(s.id) THEN CONTINUE; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.notification_schedule_reminder_timing tm WHERE tm.schedule_id=s.id AND tm.starts_at=s.starts_at AND tm.observed_at<s.starts_at-interval '15 minutes') THEN CONTINUE; END IF;
 FOR a IN SELECT x.id,x.profile_id FROM public.operation_schedule_assignees x WHERE x.schedule_id=s.id AND x.archived_at IS NULL
 AND x.created_at<s.starts_at-interval '15 minutes' AND EXISTS(SELECT 1 FROM public.notification_schedule_reminder_assignments am WHERE am.assignment_id=x.id AND am.recipient_id=x.profile_id AND am.observed_at<s.starts_at-interval '15 minutes') AND public.schedule_notification_recipient_v1(x.profile_id)
 AND (cfg.pilot_recipient_id IS NULL OR cfg.pilot_recipient_id=x.profile_id) ORDER BY x.profile_id
 LOOP
 INSERT INTO public.notification_schedule_reminders(schedule_id,recipient_id,assignment_id,starts_at,due_at)
 VALUES(s.id,a.profile_id,a.id,s.starts_at,s.starts_at-interval '15 minutes') ON CONFLICT(schedule_id,recipient_id,starts_at) DO NOTHING RETURNING id INTO rid;
 IF rid IS NULL THEN CONTINUE; END IF;
 INSERT INTO public.notification_events(event_type,source_kind,source_id,dedupe_key,payload,state,processed_at)
 VALUES('SCHEDULE_REMINDER','schedule',s.id,'schedule-reminder:'||s.id||':'||a.profile_id||':'||extract(epoch FROM s.starts_at),jsonb_build_object('local_date',(s.starts_at AT TIME ZONE 'Asia/Seoul')::date),'processed',p_now) RETURNING id INTO eid;
 INSERT INTO public.notifications(event_id,recipient_id,category,title,message,deep_link_type,deep_link_id,schedule_local_date,expires_at)
 VALUES(eid,a.profile_id,'SCHEDULE','일정 시작 전 알림',to_char(s.starts_at AT TIME ZONE 'Asia/Seoul','YYYY. MM. DD. HH24:MI'),'SCHEDULE',s.id,(s.starts_at AT TIME ZONE 'Asia/Seoul')::date,s.starts_at) RETURNING id INTO nid;
 UPDATE public.notification_schedule_reminders SET notification_id=nid WHERE id=rid;
 emitted:=emitted+1;
 END LOOP;
 END LOOP;
 RETURN emitted;
END $run$;
CREATE FUNCTION public.run_schedule_reminders_v1() RETURNS integer
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $cron$
 SELECT public.run_schedule_reminders_at_v1(statement_timestamp())
$cron$;
CREATE OR REPLACE FUNCTION public.push_delivery_valid_v1(p_delivery_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
 SELECT (SELECT EXISTS(SELECT 1 FROM public.notification_push_deliveries d
 JOIN public.notifications n ON n.id=d.notification_id JOIN public.notification_events e ON e.id=n.event_id
 JOIN public.push_subscriptions s ON s.id=d.subscription_id JOIN public.profiles p ON p.id=s.profile_id
 WHERE d.id=p_delivery_id AND d.binding_id=s.binding_id AND n.recipient_id=s.profile_id
 AND s.revoked_at IS NULL AND (s.expiration_time IS NULL OR s.expiration_time>now())
 AND (e.event_type<>'DAILY_SCHEDULE_SUMMARY' OR n.schedule_local_date=(statement_timestamp() AT TIME ZONE 'Asia/Seoul')::date)
 AND (n.category<>'SCHEDULE' OR (public.schedule_notification_recipient_v1(s.profile_id) AND (n.deep_link_type='SCHEDULE_DAY' OR EXISTS(
 SELECT 1 FROM public.operation_schedule_assignees a JOIN public.operation_schedules os ON os.id=a.schedule_id
 WHERE a.schedule_id=n.deep_link_id AND a.profile_id=s.profile_id AND a.archived_at IS NULL AND os.archived_at IS NULL))))
 AND (n.category<>'TASK_REQUEST' OR public.task_push_valid_v1(n.deep_link_id,n.recipient_id,e.event_type,e.payload->>'audience'))
 AND (n.category NOT IN('PAYMENT_CONFIRMATION_REQUEST','PAYMENT_REQUEST') OR public.payment_push_valid_v1(n.category,n.deep_link_id,n.recipient_id,e.event_type))
 AND p.is_active AND p.account_status='active' AND n.revoked_at IS NULL AND (n.expires_at IS NULL OR n.expires_at>now()))) AND coalesce(public.schedule_reminder_delivery_valid_v1(p_delivery_id),false)
$function$;
CREATE OR REPLACE FUNCTION public.get_notification_push_delivery_v1(p_delivery_id uuid, p_token uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
 SELECT jsonb_build_object('notification_id',n.id,'deep_link_type',n.deep_link_type,'deep_link_id',n.deep_link_id,
 'event_type',e.event_type,'summary_count',CASE WHEN e.event_type='DAILY_SCHEDULE_SUMMARY' THEN e.payload->'count' ELSE NULL END,'category',n.category,'endpoint',s.endpoint,'p256dh',s.p256dh,'auth',s.auth) || CASE WHEN n.category='TASK_REQUEST' THEN jsonb_build_object('task_audience',e.payload->>'audience') ELSE '{}'::jsonb END
 || CASE WHEN e.event_type='SCHEDULE_REMINDER' THEN jsonb_build_object('expires_at',n.expires_at) ELSE '{}'::jsonb END
 FROM public.notification_push_deliveries d JOIN public.notifications n ON n.id=d.notification_id JOIN public.notification_events e ON e.id=n.event_id JOIN public.push_subscriptions s ON s.id=d.subscription_id
 WHERE d.id=p_delivery_id AND d.claim_token=p_token AND d.status='PROCESSING' AND d.lease_until>now()+interval '20 seconds'
 AND EXISTS(SELECT 1 FROM public.notification_push_config WHERE enabled) AND public.push_delivery_valid_v1(d.id);
$function$;

CREATE OR REPLACE FUNCTION public.claim_notification_push_deliveries_v1(p_limit integer DEFAULT 10)
RETURNS TABLE(delivery_id uuid,token uuid) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $claim$
BEGIN
 -- Reminder expiry is terminal even for delayed/exhausted retries; do not steal a live lease.
 WITH expired AS (SELECT d.id FROM public.notification_push_deliveries d
 JOIN public.notifications n ON n.id=d.notification_id JOIN public.notification_events e ON e.id=n.event_id
 WHERE e.event_type='SCHEDULE_REMINDER' AND n.expires_at<=statement_timestamp()
 AND (d.status IN ('PENDING','FAILED') OR (d.status='PROCESSING' AND d.lease_until<=statement_timestamp()))
 ORDER BY d.id FOR UPDATE OF d SKIP LOCKED)
 UPDATE public.notification_push_deliveries d SET status='CANCELLED',claim_token=NULL,lease_until=NULL,last_error='REMINDER_EXPIRED',updated_at=statement_timestamp()
 FROM expired x WHERE d.id=x.id;

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
END $claim$;

CREATE OR REPLACE FUNCTION public.get_notification_detail_v1(p_notification_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE result jsonb;
BEGIN
 IF NOT public.notification_active_user_v1() THEN RAISE EXCEPTION 'NOTIFICATION_FORBIDDEN' USING ERRCODE='42501'; END IF;
 SELECT to_jsonb(x) INTO result FROM (SELECT n.*,coalesce(a.ack_required,false) ack_required,coalesce(a.priority,'NORMAL') priority FROM public.notifications n LEFT JOIN public.announcements a ON a.id=n.announcement_id WHERE n.id=p_notification_id AND n.recipient_id=auth.uid() AND (n.category<>'TASK_REQUEST' OR (public.is_active_operation_member() AND EXISTS(SELECT 1 FROM public.notification_task_config WHERE singleton AND task_request_enabled))) AND (n.category NOT IN('PAYMENT_CONFIRMATION_REQUEST','PAYMENT_REQUEST') OR public.payment_can_view_v1(n.category,n.deep_link_id,auth.uid())) AND public.schedule_reminder_visible_v1(n.id) AND n.revoked_at IS NULL AND (n.expires_at IS NULL OR n.expires_at>now())) x;
 RETURN result;
END $function$;
CREATE OR REPLACE FUNCTION public.get_notification_inbox_v1(p_offset integer DEFAULT 0, p_unread_only boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_rows jsonb; v_popup jsonb; v_count integer; v_ack integer;
BEGIN
 IF NOT public.notification_active_user_v1() THEN RAISE EXCEPTION 'NOTIFICATION_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF p_offset IS NULL OR p_offset<0 OR p_offset>100000 OR p_unread_only IS NULL THEN RAISE EXCEPTION 'INVALID_PAGE' USING ERRCODE='22023'; END IF;
 SELECT count(*) FILTER(WHERE n.read_at IS NULL),count(*) FILTER(WHERE a.ack_required AND n.acknowledged_at IS NULL) INTO v_count,v_ack FROM public.notifications n LEFT JOIN public.announcements a ON a.id=n.announcement_id WHERE n.recipient_id=auth.uid() AND (n.category<>'TASK_REQUEST' OR (public.is_active_operation_member() AND EXISTS(SELECT 1 FROM public.notification_task_config WHERE singleton AND task_request_enabled))) AND (n.category NOT IN('PAYMENT_CONFIRMATION_REQUEST','PAYMENT_REQUEST') OR public.payment_can_view_v1(n.category,n.deep_link_id,auth.uid())) AND public.schedule_reminder_visible_v1(n.id) AND n.revoked_at IS NULL AND (n.expires_at IS NULL OR n.expires_at>now());
 SELECT coalesce(jsonb_agg(x ORDER BY x.created_at DESC,x.id DESC),'[]') INTO v_rows FROM (
 SELECT n.*,coalesce(a.ack_required,false) ack_required,coalesce(a.priority,'NORMAL') priority FROM public.notifications n LEFT JOIN public.announcements a ON a.id=n.announcement_id WHERE n.recipient_id=auth.uid() AND (n.category<>'TASK_REQUEST' OR (public.is_active_operation_member() AND EXISTS(SELECT 1 FROM public.notification_task_config WHERE singleton AND task_request_enabled))) AND (n.category NOT IN('PAYMENT_CONFIRMATION_REQUEST','PAYMENT_REQUEST') OR public.payment_can_view_v1(n.category,n.deep_link_id,auth.uid())) AND public.schedule_reminder_visible_v1(n.id) AND n.revoked_at IS NULL AND (n.expires_at IS NULL OR n.expires_at>now()) AND (NOT p_unread_only OR n.read_at IS NULL) ORDER BY n.created_at DESC,n.id DESC LIMIT 50 OFFSET p_offset) x;
 SELECT coalesce(jsonb_agg(x ORDER BY x.created_at DESC,x.id DESC),'[]') INTO v_popup FROM (
 SELECT n.*,a.ack_required,a.priority FROM public.notifications n JOIN public.announcements a ON a.id=n.announcement_id WHERE n.recipient_id=auth.uid() AND (n.category<>'TASK_REQUEST' OR (public.is_active_operation_member() AND EXISTS(SELECT 1 FROM public.notification_task_config WHERE singleton AND task_request_enabled))) AND (n.category NOT IN('PAYMENT_CONFIRMATION_REQUEST','PAYMENT_REQUEST') OR public.payment_can_view_v1(n.category,n.deep_link_id,auth.uid())) AND public.schedule_reminder_visible_v1(n.id) AND n.revoked_at IS NULL AND (n.expires_at IS NULL OR n.expires_at>now()) AND ((a.ack_required AND n.acknowledged_at IS NULL) OR (NOT a.ack_required AND n.popup_presented_at IS NULL AND n.read_at IS NULL)) ORDER BY n.created_at DESC,n.id DESC LIMIT 20) x;
 RETURN jsonb_build_object('items',v_rows,'popup',v_popup,'unread_count',v_count,'unacknowledged_count',v_ack,'can_publish',public.notification_has_capability_v1('ANNOUNCEMENT_PUBLISH'),'can_view_receipts',public.notification_has_capability_v1('ANNOUNCEMENT_RECEIPTS_VIEW'));
END $function$;
CREATE OR REPLACE FUNCTION public.mark_all_notifications_read_v1()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_count integer;
BEGIN
 IF NOT public.notification_active_user_v1() THEN
  RAISE EXCEPTION 'NOTIFICATION_FORBIDDEN' USING ERRCODE = '42501';
 END IF;
 WITH targets AS MATERIALIZED (
  SELECT n.id FROM public.notifications n
  WHERE n.recipient_id = auth.uid() AND n.read_at IS NULL
   AND (n.category <> 'TASK_REQUEST' OR (public.is_active_operation_member()
    AND EXISTS (SELECT 1 FROM public.notification_task_config WHERE singleton AND task_request_enabled)))
   AND (n.category NOT IN ('PAYMENT_CONFIRMATION_REQUEST','PAYMENT_REQUEST')
    OR public.payment_can_view_v1(n.category,n.deep_link_id,auth.uid()))
   AND public.schedule_reminder_visible_v1(n.id) AND n.revoked_at IS NULL AND (n.expires_at IS NULL OR n.expires_at > now())
 ), changed AS (
  UPDATE public.notifications n SET read_at = statement_timestamp()
  FROM targets t WHERE n.id = t.id AND n.recipient_id = auth.uid()
   AND n.read_at IS NULL AND public.schedule_reminder_visible_v1(n.id) AND n.revoked_at IS NULL
   AND (n.expires_at IS NULL OR n.expires_at > now())
  RETURNING n.id
 ) SELECT count(*)::integer INTO v_count FROM changed;
 RETURN v_count;
END $function$;
CREATE OR REPLACE FUNCTION public.mark_notification_read_v1(p_notification_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
 IF NOT public.notification_active_user_v1() THEN RAISE EXCEPTION 'NOTIFICATION_FORBIDDEN' USING ERRCODE='42501'; END IF;
 UPDATE public.notifications SET read_at=coalesce(read_at,now()) WHERE id=p_notification_id AND recipient_id=auth.uid() AND public.schedule_reminder_visible_v1(id) AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>now());
 IF NOT FOUND THEN RAISE EXCEPTION 'NOTIFICATION_UNAVAILABLE' USING ERRCODE='42501'; END IF;
END $function$;

DO $acl$ DECLARE f record; BEGIN
 FOR f IN SELECT oid::regprocedure signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN (
 'schedule_reminder_visible_v1','control_schedule_reminder_epoch_v1','schedule_reminder_eligible_v1','schedule_reminder_delivery_valid_v1','invalidate_schedule_reminders_v1','track_schedule_reminder_v1','run_schedule_reminders_at_v1','run_schedule_reminders_v1') LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.signature);
 END LOOP;
END $acl$;
GRANT EXECUTE ON FUNCTION public.run_schedule_reminders_v1() TO service_role;
-- Existing RPC ACLs are preserved by CREATE OR REPLACE. No Cron or enable here.
COMMIT;
