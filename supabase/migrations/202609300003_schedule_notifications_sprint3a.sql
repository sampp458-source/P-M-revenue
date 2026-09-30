-- Candidate only. Manual apply after separate approval; no cron creation or history writes.
BEGIN;
DO $$ BEGIN
IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.push_delivery_valid_v1(uuid)') AND md5(prosrc)='079ceec88f347510d509156d0f1c20c0' AND prosecdef AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'STOP_PREDECESSOR_push_delivery_valid_v1'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('get_notification_inbox_v1(integer,boolean)') AND md5(prosrc)='b1c9db6c30a21d53168010bf2ff10824' AND prosecdef AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'STOP_PREDECESSOR_get_notification_inbox_v1'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('get_notification_detail_v1(uuid)') AND md5(prosrc)='a426d586badf79ab02567278c7257f3b' AND prosecdef AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'STOP_PREDECESSOR_get_notification_detail_v1'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('get_notification_push_delivery_v1(uuid,uuid)') AND md5(prosrc)='90a8844aba808c910d634f6f3afa94cc' AND prosecdef AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'STOP_PREDECESSOR_get_notification_push_delivery_v1'; END IF;
END $$;

LOCK TABLE public.operation_schedules, public.operation_schedule_assignees IN SHARE ROW EXCLUSIVE MODE;
CREATE TABLE public.notification_schedule_config (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), enabled boolean NOT NULL DEFAULT false,
 daily_summary_enabled boolean NOT NULL DEFAULT false, daily_summary_time time NOT NULL DEFAULT '08:00',
 timezone text NOT NULL DEFAULT 'Asia/Seoul' CHECK(timezone='Asia/Seoul')
);
INSERT INTO public.notification_schedule_config(singleton) VALUES(true);
CREATE TABLE public.notification_schedule_state (
 -- Notification-only mutex: no FK that could acquire a domain lock during initialization.
 schedule_id uuid PRIMARY KEY,
 fingerprint jsonb NOT NULL, assignees uuid[] NOT NULL, status text NOT NULL,
 archived boolean NOT NULL, revision bigint NOT NULL DEFAULT 0
);
ALTER TABLE public.notification_schedule_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_schedule_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_schedule_config,public.notification_schedule_state FROM PUBLIC,anon,authenticated;
ALTER TABLE public.notifications DROP CONSTRAINT notifications_deep_link_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_deep_link_type_check CHECK(deep_link_type IN ('ANNOUNCEMENT','SCHEDULE','SCHEDULE_DAY'));
ALTER TABLE public.notifications ADD COLUMN schedule_local_date date;

CREATE FUNCTION public.schedule_notification_fingerprint_v1(s public.operation_schedules) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $$
 SELECT jsonb_build_array(s.calendar_id,s.schedule_type_id,md5(s.title),extract(epoch FROM s.starts_at),extract(epoch FROM s.ends_at),s.all_day,s.time_unspecified)
$$;
-- Baseline only: never replay historical assignments or completions.
INSERT INTO public.notification_schedule_state(schedule_id,fingerprint,assignees,status,archived)
SELECT s.id,public.schedule_notification_fingerprint_v1(s),
 ARRAY(SELECT DISTINCT a.profile_id FROM public.operation_schedule_assignees a WHERE a.schedule_id=s.id AND a.archived_at IS NULL ORDER BY a.profile_id),s.status,s.archived_at IS NOT NULL
FROM public.operation_schedules s;

CREATE FUNCTION public.schedule_notification_recipient_v1(p_profile uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.profiles p JOIN public.operation_memberships m ON m.profile_id=p.id
 WHERE p.id=p_profile AND p.is_active AND p.account_status='active' AND m.is_active)
$$;
CREATE FUNCTION public.emit_schedule_notification_v1(p_schedule uuid,p_recipient uuid,p_kind text,p_key text,p_date date,p_count integer DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE eid uuid; label text; preview text; s public.operation_schedules;
BEGIN
 IF NOT public.schedule_notification_recipient_v1(p_recipient) THEN RETURN; END IF;
 label:=CASE p_kind WHEN 'SCHEDULE_ASSIGNED' THEN '새 일정이 등록되었습니다.' WHEN 'SCHEDULE_UPDATED' THEN '일정이 변경되었습니다.' WHEN 'SCHEDULE_COMPLETED' THEN '일정이 완료 처리되었습니다.' WHEN 'SCHEDULE_CANCELLED' THEN '일정이 취소되었습니다.' WHEN 'DAILY_SCHEDULE_SUMMARY' THEN '오늘 일정 '||p_count||'건이 있습니다.' END;
 IF label IS NULL OR (p_kind='DAILY_SCHEDULE_SUMMARY' AND (p_count IS NULL OR p_count<1)) THEN RAISE EXCEPTION 'INVALID_SCHEDULE_EVENT'; END IF;
 IF p_kind='DAILY_SCHEDULE_SUMMARY' THEN preview:=to_char(p_date,'YYYY. MM. DD.')||' · 나의 예정 일정';
 ELSE
 SELECT * INTO STRICT s FROM public.operation_schedules WHERE id=p_schedule;
 -- No memo/customer/dog data in preview. Time-unspecified never becomes midnight.
 SELECT to_char(s.starts_at AT TIME ZONE 'Asia/Seoul','YYYY. MM. DD.')||' · '||
 CASE WHEN s.time_unspecified THEN '시간 미정' WHEN s.all_day THEN '종일' ELSE to_char(s.starts_at AT TIME ZONE 'Asia/Seoul','HH24:MI') END||' · '||t.name
 INTO preview FROM public.operation_schedule_types t WHERE t.id=s.schedule_type_id;
 END IF;
 INSERT INTO public.notification_events(event_type,source_kind,source_id,dedupe_key,payload,state,processed_at)
 VALUES(p_kind,'schedule',coalesce(p_schedule,p_recipient),p_key,jsonb_build_object('local_date',p_date,'count',p_count),'processed',now())
 ON CONFLICT(dedupe_key) DO NOTHING RETURNING id INTO eid;
 IF eid IS NULL THEN RETURN; END IF;
 INSERT INTO public.notifications(event_id,recipient_id,category,title,message,deep_link_type,deep_link_id,schedule_local_date)
 VALUES(eid,p_recipient,'SCHEDULE',label,coalesce(preview,''),CASE WHEN p_kind='DAILY_SCHEDULE_SUMMARY' THEN 'SCHEDULE_DAY' ELSE 'SCHEDULE' END,coalesce(p_schedule,p_recipient),p_date);
END $$;

CREATE FUNCTION public.finalize_schedule_notification_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE sid uuid; s public.operation_schedules; previous public.notification_schedule_state;
 ids uuid[]; fp jsonb; recipient uuid; kind text; rev bigint; changed boolean; active_config boolean;
BEGIN
 IF TG_TABLE_NAME='operation_schedules' THEN sid:=NEW.id; ELSE sid:=NEW.schedule_id; END IF;
 -- Serialize only notification finalizers, before reading canonical state. The null
 -- fingerprint/empty assignees are a comparison sentinel, not a historical baseline:
 -- schedule + assignee INSERT in one transaction still emits its first ASSIGNED.
 INSERT INTO public.notification_schedule_state(schedule_id,fingerprint,assignees,status,archived)
 VALUES(sid,'null'::jsonb,'{}','scheduled',false) ON CONFLICT DO NOTHING;
 SELECT * INTO previous FROM public.notification_schedule_state WHERE schedule_id=sid FOR UPDATE;
 -- Separate statements in this VOLATILE function use fresh READ COMMITTED snapshots
 -- after mutex wait. Never lock or write domain rows while holding this mutex.
 SELECT * INTO s FROM public.operation_schedules WHERE id=sid;
 IF NOT FOUND THEN RETURN NULL; END IF;
 ids:=ARRAY(SELECT DISTINCT profile_id FROM public.operation_schedule_assignees WHERE schedule_id=sid AND archived_at IS NULL ORDER BY profile_id);
 fp:=public.schedule_notification_fingerprint_v1(s);
 changed:=previous.fingerprint IS DISTINCT FROM fp OR previous.assignees IS DISTINCT FROM ids OR previous.status<>s.status OR previous.archived<>(s.archived_at IS NOT NULL);
 IF NOT changed THEN RETURN NULL; END IF;
 rev:=previous.revision+1;
 SELECT enabled INTO active_config FROM public.notification_schedule_config;
 IF active_config AND s.archived_at IS NULL THEN
 FOREACH recipient IN ARRAY ids LOOP
 kind:=NULL;
 IF s.status='completed' AND previous.status<>'completed' THEN kind:='SCHEDULE_COMPLETED';
 ELSIF s.status='cancelled' AND previous.status<>'cancelled' THEN kind:='SCHEDULE_CANCELLED';
 ELSIF s.status='scheduled' AND NOT(recipient=ANY(previous.assignees)) THEN kind:='SCHEDULE_ASSIGNED';
 ELSIF s.status='scheduled' AND (previous.fingerprint IS DISTINCT FROM fp OR previous.status<>s.status OR previous.archived) THEN kind:='SCHEDULE_UPDATED';
 END IF;
 IF kind IS NOT NULL THEN
 PERFORM public.emit_schedule_notification_v1(sid,recipient,kind,'schedule:'||sid||':'||rev||':'||recipient||':'||kind,(s.starts_at AT TIME ZONE 'Asia/Seoul')::date);
 END IF;
 END LOOP;
 END IF;
 -- Also advance while disabled: enabling cannot drain a hidden historical backlog.
 UPDATE public.notification_schedule_state SET fingerprint=fp,assignees=ids,status=s.status,archived=s.archived_at IS NOT NULL,revision=rev WHERE schedule_id=sid;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER notification_schedule_final AFTER INSERT OR UPDATE ON public.operation_schedules
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.finalize_schedule_notification_v1();
CREATE CONSTRAINT TRIGGER notification_assignee_final AFTER INSERT OR UPDATE ON public.operation_schedule_assignees
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.finalize_schedule_notification_v1();

CREATE FUNCTION public.run_daily_schedule_summary_at_v1(p_now timestamptz) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE cfg public.notification_schedule_config; day date; local_now timestamp; item record; emitted integer:=0;
BEGIN
 SELECT * INTO cfg FROM public.notification_schedule_config;
 IF NOT cfg.enabled OR NOT cfg.daily_summary_enabled THEN RETURN 0; END IF;
 local_now:=p_now AT TIME ZONE cfg.timezone; day:=local_now::date;
 IF local_now::time<cfg.daily_summary_time THEN RETURN 0; END IF;
 FOR item IN
 SELECT a.profile_id,count(DISTINCT s.id)::integer n FROM public.operation_schedules s
 JOIN public.operation_schedule_assignees a ON a.schedule_id=s.id AND a.archived_at IS NULL
 WHERE s.archived_at IS NULL AND s.status='scheduled'
 AND s.starts_at<(day+1)::timestamp AT TIME ZONE cfg.timezone AND s.ends_at>day::timestamp AT TIME ZONE cfg.timezone
 AND public.schedule_notification_recipient_v1(a.profile_id) GROUP BY a.profile_id ORDER BY a.profile_id
 LOOP
 PERFORM public.emit_schedule_notification_v1(NULL,item.profile_id,'DAILY_SCHEDULE_SUMMARY','daily-schedule:'||item.profile_id||':'||day,day,item.n);
 emitted:=emitted+1;
 END LOOP;
 RETURN emitted;
END $$;

-- The cron entry point never accepts caller-supplied dates/recipients.
CREATE FUNCTION public.run_daily_schedule_summary_v1() RETURNS integer
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT public.run_daily_schedule_summary_at_v1(statement_timestamp())
$$;
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
 SELECT count(*) FILTER(WHERE n.read_at IS NULL),count(*) FILTER(WHERE a.ack_required AND n.acknowledged_at IS NULL) INTO v_count,v_ack FROM public.notifications n LEFT JOIN public.announcements a ON a.id=n.announcement_id WHERE n.recipient_id=auth.uid() AND n.revoked_at IS NULL AND (n.expires_at IS NULL OR n.expires_at>now());
 SELECT coalesce(jsonb_agg(x ORDER BY x.created_at DESC,x.id DESC),'[]') INTO v_rows FROM (
 SELECT n.*,coalesce(a.ack_required,false) ack_required,coalesce(a.priority,'NORMAL') priority FROM public.notifications n LEFT JOIN public.announcements a ON a.id=n.announcement_id WHERE n.recipient_id=auth.uid() AND n.revoked_at IS NULL AND (n.expires_at IS NULL OR n.expires_at>now()) AND (NOT p_unread_only OR n.read_at IS NULL) ORDER BY n.created_at DESC,n.id DESC LIMIT 50 OFFSET p_offset) x;
 SELECT coalesce(jsonb_agg(x ORDER BY x.created_at DESC,x.id DESC),'[]') INTO v_popup FROM (
 SELECT n.*,a.ack_required,a.priority FROM public.notifications n JOIN public.announcements a ON a.id=n.announcement_id WHERE n.recipient_id=auth.uid() AND n.revoked_at IS NULL AND (n.expires_at IS NULL OR n.expires_at>now()) AND ((a.ack_required AND n.acknowledged_at IS NULL) OR (NOT a.ack_required AND n.popup_presented_at IS NULL AND n.read_at IS NULL)) ORDER BY n.created_at DESC,n.id DESC LIMIT 20) x;
 RETURN jsonb_build_object('items',v_rows,'popup',v_popup,'unread_count',v_count,'unacknowledged_count',v_ack,'can_publish',public.notification_has_capability_v1('ANNOUNCEMENT_PUBLISH'),'can_view_receipts',public.notification_has_capability_v1('ANNOUNCEMENT_RECEIPTS_VIEW'));
END $function$
;
CREATE OR REPLACE FUNCTION public.get_notification_detail_v1(p_notification_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE result jsonb;
BEGIN
 IF NOT public.notification_active_user_v1() THEN RAISE EXCEPTION 'NOTIFICATION_FORBIDDEN' USING ERRCODE='42501'; END IF;
 SELECT to_jsonb(x) INTO result FROM (SELECT n.*,coalesce(a.ack_required,false) ack_required,coalesce(a.priority,'NORMAL') priority FROM public.notifications n LEFT JOIN public.announcements a ON a.id=n.announcement_id WHERE n.id=p_notification_id AND n.recipient_id=auth.uid() AND n.revoked_at IS NULL AND (n.expires_at IS NULL OR n.expires_at>now())) x;
 RETURN result;
END $function$
;
CREATE OR REPLACE FUNCTION public.get_notification_push_delivery_v1(p_delivery_id uuid, p_token uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT jsonb_build_object('notification_id',n.id,'deep_link_type',n.deep_link_type,'deep_link_id',n.deep_link_id,
    'event_type',e.event_type,'summary_count',CASE WHEN e.event_type='DAILY_SCHEDULE_SUMMARY' THEN e.payload->'count' ELSE NULL END,'category',n.category,'endpoint',s.endpoint,'p256dh',s.p256dh,'auth',s.auth)
  FROM public.notification_push_deliveries d JOIN public.notifications n ON n.id=d.notification_id JOIN public.notification_events e ON e.id=n.event_id JOIN public.push_subscriptions s ON s.id=d.subscription_id
  WHERE d.id=p_delivery_id AND d.claim_token=p_token AND d.status='PROCESSING' AND d.lease_until>now()+interval '20 seconds'
  AND EXISTS(SELECT 1 FROM public.notification_push_config WHERE enabled) AND public.push_delivery_valid_v1(d.id);
$function$
;
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT oid::regprocedure sig FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN (
 'schedule_notification_fingerprint_v1','schedule_notification_recipient_v1','emit_schedule_notification_v1','finalize_schedule_notification_v1','run_daily_schedule_summary_v1','run_daily_schedule_summary_at_v1') LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.sig);
 END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.run_daily_schedule_summary_v1() TO service_role;
CREATE OR REPLACE FUNCTION public.push_delivery_valid_v1(p_delivery_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT EXISTS(SELECT 1 FROM public.notification_push_deliveries d
    JOIN public.notifications n ON n.id=d.notification_id JOIN public.push_subscriptions s ON s.id=d.subscription_id
    JOIN public.profiles p ON p.id=s.profile_id
    WHERE d.id=p_delivery_id AND d.binding_id=s.binding_id AND n.recipient_id=s.profile_id
    AND s.revoked_at IS NULL AND (s.expiration_time IS NULL OR s.expiration_time>now())
    AND (n.category<>'SCHEDULE' OR (public.schedule_notification_recipient_v1(s.profile_id) AND (n.deep_link_type='SCHEDULE_DAY' OR EXISTS(SELECT 1 FROM public.operation_schedule_assignees a JOIN public.operation_schedules os ON os.id=a.schedule_id WHERE a.schedule_id=n.deep_link_id AND a.profile_id=s.profile_id AND a.archived_at IS NULL AND os.archived_at IS NULL))))
    AND p.is_active AND p.account_status='active' AND n.revoked_at IS NULL AND (n.expires_at IS NULL OR n.expires_at>now()));
$function$
;
COMMIT;
