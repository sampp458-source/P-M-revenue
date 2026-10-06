-- Candidate only. Manual transaction apply; no cron creation or feature enable.
BEGIN;
DO $guard$ BEGIN
IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('push_delivery_valid_v1(uuid)') AND md5(pg_get_functiondef(oid))='a505ed070aa524164fe30b449e175840' AND proowner='postgres'::regrole AND prosecdef) THEN RAISE EXCEPTION 'TASK_PREDECESSOR_MISMATCH: push_delivery_valid_v1'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('get_notification_push_delivery_v1(uuid,uuid)') AND md5(pg_get_functiondef(oid))='ee568c1a13aa7bbe3e3347bff3615473' AND proowner='postgres'::regrole AND prosecdef) THEN RAISE EXCEPTION 'TASK_PREDECESSOR_MISMATCH: get_notification_push_delivery_v1'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('get_notification_inbox_v1(integer,boolean)') AND md5(pg_get_functiondef(oid))='dd90cbac1333e9294086b14dc0cd45af' AND proowner='postgres'::regrole AND prosecdef) THEN RAISE EXCEPTION 'TASK_PREDECESSOR_MISMATCH: get_notification_inbox_v1'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('get_notification_detail_v1(uuid)') AND md5(pg_get_functiondef(oid))='f484dbc0e300fce052c66079c4203938' AND proowner='postgres'::regrole AND prosecdef) THEN RAISE EXCEPTION 'TASK_PREDECESSOR_MISMATCH: get_notification_detail_v1'; END IF;
END $guard$;
CREATE TABLE public.notification_task_config (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 task_request_enabled boolean NOT NULL DEFAULT false,
 reminder_enabled boolean NOT NULL DEFAULT false
);
INSERT INTO public.notification_task_config VALUES(true,false,false);
ALTER TABLE public.notification_capability_grants DROP CONSTRAINT notification_capability_grants_capability_check;
ALTER TABLE public.notification_capability_grants ADD CONSTRAINT notification_capability_grants_capability_check
 CHECK(capability IN ('ANNOUNCEMENT_PUBLISH','ANNOUNCEMENT_RECEIPTS_VIEW','TASK_REQUEST_CREATE'));
ALTER TABLE public.notification_capability_grants ADD COLUMN version bigint NOT NULL DEFAULT 1;
CREATE TABLE public.task_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), requester_id uuid NOT NULL REFERENCES public.profiles(id),
 title text NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 100),
 body text NOT NULL CHECK(length(btrim(body)) BETWEEN 1 AND 4000),
 due_at timestamptz NOT NULL CHECK(isfinite(due_at)), created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 cancelled_at timestamptz, cancelled_by uuid REFERENCES public.profiles(id), cancel_reason text,
 request_id uuid NOT NULL, payload_hash text NOT NULL, version bigint NOT NULL DEFAULT 1,
 next_reminder_at timestamptz, last_reminded_at timestamptz, reminder_count integer NOT NULL DEFAULT 0,
 reminder_local_date date, reminder_count_today integer NOT NULL DEFAULT 0,
 UNIQUE(requester_id,request_id),
 CHECK((cancelled_at IS NULL)=(cancelled_by IS NULL)),
 CHECK(cancelled_at IS NULL OR length(btrim(cancel_reason)) BETWEEN 1 AND 1000)
);
CREATE TABLE public.task_request_targets (
 task_request_id uuid NOT NULL REFERENCES public.task_requests(id), recipient_id uuid NOT NULL REFERENCES public.profiles(id),
 acknowledged_at timestamptz, completed_at timestamptz, completion_note text CHECK(length(completion_note)<=1000),
 created_at timestamptz NOT NULL DEFAULT statement_timestamp(), version bigint NOT NULL DEFAULT 1,
 next_reminder_at timestamptz, last_reminded_at timestamptz, reminder_count integer NOT NULL DEFAULT 0,
 reminder_local_date date, reminder_count_today integer NOT NULL DEFAULT 0,
 PRIMARY KEY(task_request_id,recipient_id), CHECK(completed_at IS NULL OR acknowledged_at IS NOT NULL),
 CHECK(completed_at IS NULL OR completed_at>=acknowledged_at)
);
CREATE TABLE public.task_request_audit_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), task_request_id uuid NOT NULL REFERENCES public.task_requests(id),
 recipient_id uuid REFERENCES public.profiles(id), actor_id uuid REFERENCES public.profiles(id),
 action text NOT NULL CHECK(action IN('CREATED','ACKNOWLEDGED','COMPLETED','CANCELLED','REMINDER_EMITTED')),
 request_id uuid, payload_hash text, metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 UNIQUE(actor_id,request_id)
);
-- Durable receipts for successful no-op retries, without duplicating lifecycle audit.
CREATE TABLE public.task_request_command_receipts (
 actor_id uuid NOT NULL REFERENCES public.profiles(id), request_id uuid NOT NULL,
 task_request_id uuid NOT NULL REFERENCES public.task_requests(id), payload_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT statement_timestamp(), PRIMARY KEY(actor_id,request_id)
);
CREATE INDEX task_request_inbox ON public.task_request_targets(recipient_id,completed_at,task_request_id);
CREATE INDEX task_request_sent ON public.task_requests(requester_id,created_at DESC,id);
CREATE INDEX task_request_due ON public.task_requests(next_reminder_at,id) WHERE cancelled_at IS NULL;
CREATE UNIQUE INDEX task_capability_request ON public.entity_audit_events(changed_by,request_id)
 WHERE entity_type='notification_capability_grants' AND request_id IS NOT NULL;
ALTER TABLE public.notifications DROP CONSTRAINT notifications_deep_link_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_deep_link_type_check CHECK(deep_link_type IN('ANNOUNCEMENT','SCHEDULE','SCHEDULE_DAY','TASK_REQUEST'));

CREATE FUNCTION public.task_active_member_v1(p_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $task$
SELECT EXISTS(SELECT 1 FROM public.profiles p JOIN public.operation_memberships m ON m.profile_id=p.id WHERE p.id=p_id AND p.is_active AND p.account_status='active' AND m.is_active);
$task$;

CREATE FUNCTION public.task_require_enabled_v1() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $task$
BEGIN IF NOT public.is_active_operation_member() THEN RAISE EXCEPTION 'TASK_FORBIDDEN' USING ERRCODE='42501'; END IF; IF NOT (SELECT task_request_enabled FROM public.notification_task_config WHERE singleton) THEN RAISE EXCEPTION 'TASK_DISABLED' USING ERRCODE='55000'; END IF; END;
$task$;

CREATE FUNCTION public.get_task_request_access_v1() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $task$
SELECT jsonb_build_object('enabled',coalesce((SELECT task_request_enabled FROM public.notification_task_config WHERE singleton),false) AND public.is_active_operation_member(),'can_create',public.is_active_operation_member() AND public.notification_has_capability_v1('TASK_REQUEST_CREATE'),'owner',public.has_operation_role(ARRAY['owner']));
$task$;

CREATE FUNCTION public.get_notification_capability_directory_v1() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $task$
BEGIN
 IF NOT public.has_operation_role(ARRAY['owner']) THEN RAISE EXCEPTION 'CAPABILITY_OWNER_REQUIRED' USING ERRCODE='42501'; END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'active',p.is_active AND p.account_status='active','operation_role',m.role,'operation_active',coalesce(m.is_active,false),'capabilities',
 (SELECT jsonb_object_agg(k,jsonb_build_object('active',coalesce(g.active,false),'version',coalesce(g.version,0))) FROM unnest(ARRAY['ANNOUNCEMENT_PUBLISH','ANNOUNCEMENT_RECEIPTS_VIEW','TASK_REQUEST_CREATE']) k LEFT JOIN LATERAL(SELECT active,version FROM public.notification_capability_grants WHERE profile_id=p.id AND capability=k ORDER BY version DESC,created_at DESC LIMIT 1)g ON true)) ORDER BY p.name,p.id) FROM public.profiles p LEFT JOIN public.operation_memberships m ON m.profile_id=p.id),'[]'); END;
$task$;

CREATE FUNCTION public.set_notification_capability_v1(p_target_id uuid,p_capability text,p_active boolean,p_expected_version bigint,p_request_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $task$
DECLARE old public.notification_capability_grants; prior public.entity_audit_events; payload jsonb;
BEGIN
 IF p_request_id IS NULL OR p_target_id IS NULL OR p_active IS NULL OR p_capability IS NULL OR p_capability NOT IN('ANNOUNCEMENT_PUBLISH','ANNOUNCEMENT_RECEIPTS_VIEW','TASK_REQUEST_CREATE') THEN RAISE EXCEPTION 'INVALID_CAPABILITY_INPUT' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('task-command:'||auth.uid()||':'||p_request_id,0));
 IF NOT public.has_operation_role(ARRAY['owner']) THEN RAISE EXCEPTION 'CAPABILITY_OWNER_REQUIRED' USING ERRCODE='42501'; END IF;
 payload:=jsonb_build_object('target',p_target_id,'capability',p_capability,'active',p_active);
 SELECT * INTO prior FROM public.entity_audit_events WHERE entity_type='notification_capability_grants' AND changed_by=auth.uid() AND request_id=p_request_id;
 IF FOUND THEN IF prior.after_data<>payload THEN RAISE EXCEPTION 'REQUEST_ID_PAYLOAD_MISMATCH' USING ERRCODE='22023'; END IF; RETURN; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('task-capability:'||p_target_id,0));
 PERFORM 1 FROM public.profiles WHERE id=ANY(ARRAY[p_target_id,auth.uid()]) ORDER BY id FOR SHARE;
 PERFORM 1 FROM public.operation_memberships WHERE profile_id=ANY(ARRAY[p_target_id,auth.uid()]) ORDER BY profile_id FOR SHARE;
 IF NOT public.has_operation_role(ARRAY['owner']) THEN RAISE EXCEPTION 'CAPABILITY_OWNER_REQUIRED' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_target_id AND is_active AND account_status='active') THEN RAISE EXCEPTION 'INACTIVE_TARGET' USING ERRCODE='22023'; END IF;
 IF p_capability='TASK_REQUEST_CREATE' AND NOT public.task_active_member_v1(p_target_id) THEN RAISE EXCEPTION 'TASK_OPERATIONS_REQUIRED' USING ERRCODE='22023'; END IF;
 SELECT * INTO old FROM public.notification_capability_grants WHERE profile_id=p_target_id AND capability=p_capability ORDER BY version DESC,created_at DESC LIMIT 1 FOR UPDATE;
 IF coalesce(old.version,0) IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'CAPABILITY_VERSION_CONFLICT' USING ERRCODE='40001'; END IF;
 IF old.id IS NULL THEN INSERT INTO public.notification_capability_grants(profile_id,capability,active,granted_by,revoked_at) VALUES(p_target_id,p_capability,p_active,auth.uid(),CASE WHEN NOT p_active THEN statement_timestamp() END);
 ELSE UPDATE public.notification_capability_grants SET active=p_active,revoked_at=CASE WHEN NOT p_active THEN statement_timestamp() END,granted_by=CASE WHEN p_active THEN auth.uid() ELSE granted_by END,version=version+1 WHERE id=old.id; END IF;
 INSERT INTO public.entity_audit_events(module_code,entity_type,entity_id,action,changed_by,request_id,after_data,change_reason) VALUES('operations','notification_capability_grants',p_target_id,'updated',auth.uid(),p_request_id,payload,CASE WHEN p_active THEN 'PERMISSION_GRANTED' ELSE 'PERMISSION_REVOKED' END);
END;
$task$;

CREATE FUNCTION public.task_revision_v1(p_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $task$
BEGIN
 INSERT INTO public.notification_inbox_revisions(recipient_id,revision,updated_at)
 SELECT id,1,statement_timestamp() FROM (SELECT requester_id id FROM public.task_requests WHERE id=p_id UNION SELECT recipient_id FROM public.task_request_targets WHERE task_request_id=p_id UNION SELECT profile_id FROM public.operation_memberships WHERE role='owner' AND is_active) u ORDER BY id
 ON CONFLICT(recipient_id) DO UPDATE SET revision=public.notification_inbox_revisions.revision+1,updated_at=statement_timestamp(); END;
$task$;

CREATE FUNCTION public.task_emit_v1(p_id uuid,p_recipient uuid,p_kind text,p_key text,p_audience text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $task$
DECLARE eid uuid; BEGIN
 IF NOT public.task_active_member_v1(p_recipient) THEN RETURN; END IF;
 INSERT INTO public.notification_events(event_type,source_kind,source_id,dedupe_key,payload,state,processed_at)
 VALUES(p_kind,'task_request',p_id,p_key,jsonb_build_object('task_request_id',p_id,'audience',p_audience),'processed',statement_timestamp()) ON CONFLICT(dedupe_key) DO NOTHING RETURNING id INTO eid;
 IF eid IS NULL THEN RETURN; END IF;
 INSERT INTO public.notifications(event_id,recipient_id,category,title,message,deep_link_type,deep_link_id)
 VALUES(eid,p_recipient,'TASK_REQUEST',CASE p_kind WHEN 'TASK_REQUEST_ASSIGNED' THEN '새 업무요청이 도착했습니다.' WHEN 'TASK_REQUEST_OVERDUE' THEN CASE WHEN p_audience='requester' THEN '요청한 업무가 아직 완료되지 않았습니다.' ELSE '완료되지 않은 업무요청이 있습니다.' END WHEN 'TASK_REQUEST_COMPLETED' THEN '요청한 업무가 완료되었습니다.' ELSE '업무요청이 취소되었습니다.' END,'업무요청 상세에서 확인해 주세요.','TASK_REQUEST',p_id);
END;
$task$;

CREATE FUNCTION public.create_task_request_v1(p_request_id uuid,p_title text,p_body text,p_due_at timestamptz,p_recipient_ids uuid[]) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $task$
DECLARE ids uuid[]; h text; r public.task_requests; person uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('task-domain-write-v1',0));
 PERFORM public.task_require_enabled_v1();
 IF p_request_id IS NULL THEN RAISE EXCEPTION 'REQUEST_ID_REQUIRED' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('task-command:'||auth.uid()||':'||p_request_id,0));
 SELECT array_agg(DISTINCT x ORDER BY x) INTO ids FROM unnest(p_recipient_ids) x;
 IF p_title IS NULL OR length(btrim(p_title)) NOT BETWEEN 1 AND 100 OR p_body IS NULL OR length(btrim(p_body)) NOT BETWEEN 1 AND 4000 OR cardinality(ids) IS NULL OR cardinality(ids) NOT BETWEEN 1 AND 100 OR array_position(ids,NULL) IS NOT NULL OR p_due_at IS NULL OR NOT isfinite(p_due_at) THEN RAISE EXCEPTION 'INVALID_TASK_INPUT' USING ERRCODE='22023'; END IF;
 h:=md5(jsonb_build_object('title',btrim(p_title),'body',btrim(p_body),'due',extract(epoch FROM p_due_at),'ids',ids)::text);
 SELECT * INTO r FROM public.task_requests WHERE requester_id=auth.uid() AND request_id=p_request_id;
 IF FOUND THEN IF r.payload_hash<>h THEN RAISE EXCEPTION 'REQUEST_ID_PAYLOAD_MISMATCH' USING ERRCODE='22023'; END IF; RETURN r.id; END IF;
 IF EXISTS(SELECT 1 FROM public.task_request_audit_events WHERE actor_id=auth.uid() AND request_id=p_request_id) OR EXISTS(SELECT 1 FROM public.task_request_command_receipts WHERE actor_id=auth.uid() AND request_id=p_request_id) THEN RAISE EXCEPTION 'REQUEST_ID_PAYLOAD_MISMATCH' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('task-capability:'||auth.uid(),0));
 IF NOT public.notification_has_capability_v1('TASK_REQUEST_CREATE') THEN RAISE EXCEPTION 'TASK_CREATE_FORBIDDEN' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.profiles WHERE id=ANY(ids||ARRAY[auth.uid()]) ORDER BY id FOR SHARE;
 PERFORM 1 FROM public.operation_memberships WHERE profile_id=ANY(ids||ARRAY[auth.uid()]) ORDER BY profile_id FOR SHARE;
 IF NOT public.task_active_member_v1(auth.uid()) OR EXISTS(SELECT 1 FROM unnest(ids) x WHERE NOT public.task_active_member_v1(x)) THEN RAISE EXCEPTION 'INVALID_TASK_RECIPIENT' USING ERRCODE='22023'; END IF;
 IF p_due_at<=clock_timestamp() THEN RAISE EXCEPTION 'TASK_DUE_MUST_BE_FUTURE' USING ERRCODE='22023'; END IF;
 INSERT INTO public.task_requests(requester_id,title,body,due_at,request_id,payload_hash,next_reminder_at) VALUES(auth.uid(),btrim(p_title),btrim(p_body),p_due_at,p_request_id,h,p_due_at) RETURNING * INTO r;
 INSERT INTO public.task_request_targets(task_request_id,recipient_id,next_reminder_at) SELECT r.id,x,p_due_at FROM unnest(ids)x ORDER BY x;
 INSERT INTO public.task_request_audit_events(task_request_id,actor_id,action,request_id,payload_hash) VALUES(r.id,auth.uid(),'CREATED',p_request_id,h);
 FOREACH person IN ARRAY ids LOOP PERFORM public.task_emit_v1(r.id,person,'TASK_REQUEST_ASSIGNED','task:'||r.id||':assigned:'||person,'target'); END LOOP;
 PERFORM public.task_revision_v1(r.id); RETURN r.id;
END;
$task$;

CREATE FUNCTION public.task_action_v1(p_id uuid,p_request_id uuid,p_action text,p_note text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $task$
DECLARE r public.task_requests; t public.task_request_targets; prior public.task_request_audit_events; h text; person uuid; at timestamptz;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('task-domain-write-v1',0));
 PERFORM public.task_require_enabled_v1();
 IF p_request_id IS NULL OR p_action NOT IN('ACKNOWLEDGED','COMPLETED','CANCELLED') THEN RAISE EXCEPTION 'INVALID_TASK_ACTION' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('task-command:'||auth.uid()||':'||p_request_id,0));
 h:=md5(jsonb_build_object('id',p_id,'action',p_action,'note',nullif(btrim(p_note),''))::text);
 SELECT * INTO prior FROM public.task_request_audit_events WHERE actor_id=auth.uid() AND request_id=p_request_id;
 IF FOUND THEN IF prior.payload_hash IS DISTINCT FROM h THEN RAISE EXCEPTION 'REQUEST_ID_PAYLOAD_MISMATCH' USING ERRCODE='22023'; END IF; RETURN; END IF;
 IF EXISTS(SELECT 1 FROM public.task_request_command_receipts WHERE actor_id=auth.uid() AND request_id=p_request_id) THEN
 IF NOT EXISTS(SELECT 1 FROM public.task_request_command_receipts WHERE actor_id=auth.uid() AND request_id=p_request_id AND payload_hash=h) THEN RAISE EXCEPTION 'REQUEST_ID_PAYLOAD_MISMATCH' USING ERRCODE='22023'; END IF; RETURN; END IF;
 SELECT * INTO r FROM public.task_requests WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'TASK_NOT_FOUND' USING ERRCODE='P0002'; END IF;
 PERFORM 1 FROM public.task_request_targets WHERE task_request_id=p_id ORDER BY recipient_id FOR UPDATE;
 at:=clock_timestamp();
 IF length(p_note)>1000 THEN RAISE EXCEPTION 'TASK_NOTE_TOO_LONG' USING ERRCODE='22023'; END IF;
 IF p_action='CANCELLED' THEN
 IF r.requester_id<>auth.uid() AND NOT public.has_operation_role(ARRAY['owner']) THEN RAISE EXCEPTION 'TASK_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF nullif(btrim(p_note),'') IS NULL THEN RAISE EXCEPTION 'TASK_CANCEL_REASON_REQUIRED' USING ERRCODE='22023'; END IF;
 IF r.cancelled_at IS NOT NULL THEN INSERT INTO public.task_request_command_receipts(actor_id,request_id,task_request_id,payload_hash) VALUES(auth.uid(),p_request_id,p_id,h); RETURN; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.task_request_targets WHERE task_request_id=p_id AND completed_at IS NULL) THEN RAISE EXCEPTION 'TASK_ALREADY_COMPLETE' USING ERRCODE='22023'; END IF;
 UPDATE public.task_requests SET cancelled_at=at,cancelled_by=auth.uid(),cancel_reason=btrim(p_note),next_reminder_at=NULL,version=version+1 WHERE id=p_id;
 UPDATE public.task_request_targets SET next_reminder_at=NULL WHERE task_request_id=p_id;
 FOR person IN SELECT recipient_id FROM public.task_request_targets WHERE task_request_id=p_id AND completed_at IS NULL ORDER BY recipient_id LOOP PERFORM public.task_emit_v1(p_id,person,'TASK_REQUEST_CANCELLED','task:'||p_id||':cancelled:'||person,'target'); END LOOP;
 ELSE
 SELECT * INTO t FROM public.task_request_targets WHERE task_request_id=p_id AND recipient_id=auth.uid();
 IF NOT FOUND THEN RAISE EXCEPTION 'TASK_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF r.cancelled_at IS NOT NULL THEN RAISE EXCEPTION 'TASK_CANCELLED' USING ERRCODE='22023'; END IF;
 IF t.completed_at IS NOT NULL OR (p_action='ACKNOWLEDGED' AND t.acknowledged_at IS NOT NULL) THEN INSERT INTO public.task_request_command_receipts(actor_id,request_id,task_request_id,payload_hash) VALUES(auth.uid(),p_request_id,p_id,h); RETURN; END IF;
 IF p_action='COMPLETED' AND t.acknowledged_at IS NULL THEN RAISE EXCEPTION 'TASK_ACK_REQUIRED' USING ERRCODE='22023'; END IF;
 IF p_action='ACKNOWLEDGED' THEN UPDATE public.task_request_targets SET acknowledged_at=at,version=version+1 WHERE task_request_id=p_id AND recipient_id=auth.uid();
 ELSE UPDATE public.task_request_targets SET completed_at=at,completion_note=nullif(btrim(p_note),''),next_reminder_at=NULL,version=version+1 WHERE task_request_id=p_id AND recipient_id=auth.uid(); END IF;
 UPDATE public.task_requests SET version=version+1 WHERE id=p_id;
 IF NOT EXISTS(SELECT 1 FROM public.task_request_targets WHERE task_request_id=p_id AND completed_at IS NULL) THEN
 UPDATE public.task_requests SET next_reminder_at=NULL WHERE id=p_id;
 PERFORM public.task_emit_v1(p_id,r.requester_id,'TASK_REQUEST_COMPLETED','task:'||p_id||':completed','requester'); END IF;
 END IF;
 INSERT INTO public.task_request_audit_events(task_request_id,recipient_id,actor_id,action,request_id,payload_hash,metadata) VALUES(p_id,CASE WHEN p_action<>'CANCELLED' THEN auth.uid() END,auth.uid(),p_action,p_request_id,h,jsonb_build_object('note_present',nullif(btrim(p_note),'') IS NOT NULL));
 PERFORM public.task_revision_v1(p_id);
END;
$task$;

CREATE FUNCTION public.acknowledge_task_request_v1(p_task_request_id uuid,p_request_id uuid) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $task$
SELECT public.task_action_v1(p_task_request_id,p_request_id,'ACKNOWLEDGED',NULL);
$task$;

CREATE FUNCTION public.complete_task_request_v1(p_task_request_id uuid,p_request_id uuid,p_completion_note text DEFAULT NULL) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $task$
SELECT public.task_action_v1(p_task_request_id,p_request_id,'COMPLETED',p_completion_note);
$task$;

CREATE FUNCTION public.cancel_task_request_v1(p_task_request_id uuid,p_request_id uuid,p_reason text) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $task$
SELECT public.task_action_v1(p_task_request_id,p_request_id,'CANCELLED',p_reason);
$task$;

CREATE FUNCTION public.get_task_request_recipients_v1() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $task$
BEGIN PERFORM public.task_require_enabled_v1(); IF NOT public.notification_has_capability_v1('TASK_REQUEST_CREATE') THEN RAISE EXCEPTION 'TASK_CREATE_FORBIDDEN' USING ERRCODE='42501'; END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'name',name) ORDER BY name,id) FROM public.profiles WHERE public.task_active_member_v1(id)),'[]'); END;
$task$;

CREATE FUNCTION public.get_task_request_detail_v1(p_task_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $task$
DECLARE r public.task_requests; manager boolean; BEGIN
 PERFORM public.task_require_enabled_v1(); SELECT * INTO r FROM public.task_requests WHERE id=p_task_request_id;
 manager:=r.requester_id=auth.uid() OR public.has_operation_role(ARRAY['owner']);
 IF r.id IS NULL OR NOT (manager OR EXISTS(SELECT 1 FROM public.task_request_targets WHERE task_request_id=r.id AND recipient_id=auth.uid())) THEN RAISE EXCEPTION 'TASK_NOT_FOUND' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('id',r.id,'requester_id',r.requester_id,'requester_name',(SELECT name FROM public.profiles WHERE id=r.requester_id),'title',r.title,'body',r.body,'due_at',r.due_at,'created_at',r.created_at,'cancelled_at',r.cancelled_at,'cancel_reason',r.cancel_reason,'version',r.version,'can_cancel',manager,'targets',
 (SELECT coalesce(jsonb_agg(jsonb_build_object('recipient_id',t.recipient_id,'name',p.name,'acknowledged_at',t.acknowledged_at,'completed_at',t.completed_at,'completion_note',t.completion_note,'version',t.version) ORDER BY p.name,p.id),'[]') FROM public.task_request_targets t JOIN public.profiles p ON p.id=t.recipient_id WHERE t.task_request_id=r.id AND (manager OR t.recipient_id=auth.uid())));
 END;
$task$;

CREATE FUNCTION public.get_task_request_inbox_v1(p_scope text DEFAULT 'inbox',p_offset integer DEFAULT 0,p_filter text DEFAULT 'active') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $task$
BEGIN PERFORM pg_advisory_xact_lock(hashtextextended('task-domain-write-v1',0));
 PERFORM public.task_require_enabled_v1();
 IF p_filter IS NULL OR p_filter NOT IN('active','done','all') OR p_scope IS NULL OR p_scope NOT IN('inbox','sent','all') OR p_offset IS NULL OR p_offset<0 OR p_offset>100000 THEN RAISE EXCEPTION 'INVALID_TASK_SCOPE' USING ERRCODE='22023'; END IF;
 IF p_scope='all' AND NOT public.has_operation_role(ARRAY['owner']) THEN RAISE EXCEPTION 'TASK_FORBIDDEN' USING ERRCODE='42501'; END IF;
 RETURN coalesce((SELECT jsonb_agg(public.get_task_request_detail_v1(q.id) ORDER BY q.rank,q.sort_time,q.id) FROM (
 SELECT r.id,CASE WHEN r.cancelled_at IS NOT NULL THEN 4 WHEN state.complete THEN 3 WHEN r.due_at<statement_timestamp() THEN 0 WHEN NOT state.ack THEN 1 ELSE 2 END rank,
 CASE WHEN state.complete THEN -extract(epoch FROM state.completed_at) ELSE extract(epoch FROM r.due_at) END sort_time
 FROM public.task_requests r LEFT JOIN public.task_request_targets t ON t.task_request_id=r.id AND t.recipient_id=auth.uid()
 CROSS JOIN LATERAL(SELECT bool_and(x.completed_at IS NOT NULL) complete,bool_and(x.acknowledged_at IS NOT NULL) ack,max(x.completed_at) completed_at FROM public.task_request_targets x WHERE x.task_request_id=r.id AND (p_scope<>'inbox' OR x.recipient_id=auth.uid())) state
 WHERE ((p_scope='inbox' AND t.recipient_id IS NOT NULL) OR (p_scope='sent' AND r.requester_id=auth.uid()) OR p_scope='all')
 AND (p_filter='all' OR (p_filter='done' AND state.complete) OR (p_filter='active' AND NOT state.complete AND r.cancelled_at IS NULL))
 ORDER BY rank,sort_time,r.id LIMIT 50 OFFSET p_offset)q),'[]'); END;
$task$;

CREATE FUNCTION public.get_sent_task_requests_v1(p_offset integer DEFAULT 0) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $task$
SELECT public.get_task_request_inbox_v1('sent',p_offset,'all');
$task$;

CREATE FUNCTION public.task_next_reminder_v1(p_at timestamptz,p_count integer,p_today integer) RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $task$
DECLARE n timestamptz; local_stamp timestamp; BEGIN
 n:=p_at+CASE WHEN p_count=1 THEN interval '1 hour' WHEN p_count=2 THEN interval '2 hours' ELSE interval '4 hours' END;
 IF p_today>=4 THEN n:=greatest(n,((p_at AT TIME ZONE 'Asia/Seoul')::date+1+time '08:00') AT TIME ZONE 'Asia/Seoul'); END IF;
 local_stamp:=n AT TIME ZONE 'Asia/Seoul';
 IF local_stamp::time<time '08:00' THEN n:=(local_stamp::date+time '08:00') AT TIME ZONE 'Asia/Seoul';
 ELSIF local_stamp::time>=time '22:00' THEN n:=(local_stamp::date+1+time '08:00') AT TIME ZONE 'Asia/Seoul'; END IF;
 RETURN n; END;
$task$;

CREATE FUNCTION public.task_run_reminders_at_v1(p_at timestamptz) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $task$
DECLARE r public.task_requests; t public.task_request_targets; at timestamptz:=p_at; day date:=(at AT TIME ZONE 'Asia/Seoul')::date; n integer:=0; cnt integer; recipients uuid[]; person uuid; claimed uuid[];
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.notification_task_config WHERE singleton AND task_request_enabled AND reminder_enabled) THEN RETURN 0; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('task-domain-write-v1',0));
 SELECT array_agg(id ORDER BY id) INTO claimed FROM (SELECT id FROM public.task_requests WHERE cancelled_at IS NULL AND due_at<at AND next_reminder_at<=at ORDER BY id LIMIT 50 FOR UPDATE SKIP LOCKED) locked;
 FOR r IN SELECT * FROM public.task_requests WHERE id=ANY(claimed) ORDER BY id LOOP
 PERFORM 1 FROM public.task_request_targets WHERE task_request_id=r.id ORDER BY recipient_id FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM public.task_request_targets WHERE task_request_id=r.id AND completed_at IS NULL) THEN UPDATE public.task_requests SET next_reminder_at=NULL WHERE id=r.id; CONTINUE; END IF;
 -- First overdue is never quieted. Repeated jobs delayed by downtime are re-windowed.
 IF r.reminder_count>0 AND ((at AT TIME ZONE 'Asia/Seoul')::time<time '08:00' OR (at AT TIME ZONE 'Asia/Seoul')::time>=time '22:00') THEN
 UPDATE public.task_requests SET next_reminder_at=(((at AT TIME ZONE 'Asia/Seoul')::date+CASE WHEN (at AT TIME ZONE 'Asia/Seoul')::time>=time '22:00' THEN 1 ELSE 0 END)+time '08:00') AT TIME ZONE 'Asia/Seoul' WHERE id=r.id; CONTINUE; END IF;
 cnt:=CASE WHEN r.reminder_local_date=day THEN r.reminder_count_today ELSE 0 END;
 IF cnt>=4 THEN UPDATE public.task_requests SET next_reminder_at=(day+1+time '08:00') AT TIME ZONE 'Asia/Seoul' WHERE id=r.id; CONTINUE; END IF;
 recipients:=ARRAY(SELECT recipient_id FROM public.task_request_targets WHERE task_request_id=r.id AND completed_at IS NULL UNION SELECT r.requester_id);
 FOREACH person IN ARRAY recipients LOOP
 PERFORM public.task_emit_v1(r.id,person,'TASK_REQUEST_OVERDUE','task:'||r.id||':overdue:'||(r.reminder_count+1)||':'||person,CASE WHEN person=r.requester_id THEN 'requester' ELSE 'target' END);
 END LOOP;
 UPDATE public.task_request_targets SET reminder_count=reminder_count+1,reminder_local_date=day,reminder_count_today=CASE WHEN reminder_local_date=day THEN reminder_count_today+1 ELSE 1 END,last_reminded_at=at,next_reminder_at=public.task_next_reminder_v1(at,r.reminder_count+1,cnt+1) WHERE task_request_id=r.id AND completed_at IS NULL;
 UPDATE public.task_requests SET reminder_count=reminder_count+1,reminder_local_date=day,reminder_count_today=cnt+1,last_reminded_at=at,next_reminder_at=public.task_next_reminder_v1(at,r.reminder_count+1,cnt+1) WHERE id=r.id;
 INSERT INTO public.task_request_audit_events(task_request_id,action,metadata) VALUES(r.id,'REMINDER_EMITTED',jsonb_build_object('round',r.reminder_count+1));
 PERFORM public.task_revision_v1(r.id); n:=n+1;
 END LOOP; RETURN n;
END;
$task$;

CREATE FUNCTION public.run_task_request_reminders_v1() RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ SELECT public.task_run_reminders_at_v1(statement_timestamp()); $$;
CREATE FUNCTION public.get_task_request_summary_v1() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$ BEGIN
 PERFORM public.task_require_enabled_v1(); RETURN jsonb_build_object('incomplete', (SELECT count(*) FROM public.task_request_targets t JOIN public.task_requests r ON r.id=t.task_request_id WHERE t.recipient_id=auth.uid() AND t.completed_at IS NULL AND r.cancelled_at IS NULL)); END $$;
CREATE FUNCTION public.task_push_valid_v1(p_id uuid,p_recipient uuid,p_kind text,p_audience text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
SELECT EXISTS(SELECT 1 FROM public.task_requests r WHERE r.id=p_id
 AND public.task_active_member_v1(p_recipient)
 AND EXISTS(SELECT 1 FROM public.notification_task_config WHERE singleton AND task_request_enabled)
 AND CASE p_kind
 WHEN 'TASK_REQUEST_CANCELLED' THEN r.cancelled_at IS NOT NULL AND EXISTS(SELECT 1 FROM public.task_request_targets t WHERE t.task_request_id=r.id AND t.recipient_id=p_recipient AND t.completed_at IS NULL)
 WHEN 'TASK_REQUEST_COMPLETED' THEN r.cancelled_at IS NULL AND r.requester_id=p_recipient AND NOT EXISTS(SELECT 1 FROM public.task_request_targets t WHERE t.task_request_id=r.id AND t.completed_at IS NULL)
 WHEN 'TASK_REQUEST_ASSIGNED' THEN r.cancelled_at IS NULL AND EXISTS(SELECT 1 FROM public.task_request_targets t WHERE t.task_request_id=r.id AND t.recipient_id=p_recipient AND t.completed_at IS NULL AND t.acknowledged_at IS NULL)
 WHEN 'TASK_REQUEST_OVERDUE' THEN r.cancelled_at IS NULL AND r.due_at<statement_timestamp() AND EXISTS(SELECT 1 FROM public.notification_task_config WHERE singleton AND reminder_enabled) AND
 CASE WHEN p_audience='requester' THEN r.requester_id=p_recipient AND EXISTS(SELECT 1 FROM public.task_request_targets t WHERE t.task_request_id=r.id AND t.completed_at IS NULL)
 ELSE EXISTS(SELECT 1 FROM public.task_request_targets t WHERE t.task_request_id=r.id AND t.recipient_id=p_recipient AND t.completed_at IS NULL) END
 ELSE false END);
$$;
CREATE OR REPLACE FUNCTION public.push_delivery_valid_v1(p_delivery_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
 SELECT EXISTS(SELECT 1 FROM public.notification_push_deliveries d
 JOIN public.notifications n ON n.id=d.notification_id JOIN public.notification_events e ON e.id=n.event_id
 JOIN public.push_subscriptions s ON s.id=d.subscription_id JOIN public.profiles p ON p.id=s.profile_id
 WHERE d.id=p_delivery_id AND d.binding_id=s.binding_id AND n.recipient_id=s.profile_id
 AND s.revoked_at IS NULL AND (s.expiration_time IS NULL OR s.expiration_time>now())
 AND (e.event_type<>'DAILY_SCHEDULE_SUMMARY' OR n.schedule_local_date=(statement_timestamp() AT TIME ZONE 'Asia/Seoul')::date)
 AND (n.category<>'SCHEDULE' OR (public.schedule_notification_recipient_v1(s.profile_id) AND (n.deep_link_type='SCHEDULE_DAY' OR EXISTS(
  SELECT 1 FROM public.operation_schedule_assignees a JOIN public.operation_schedules os ON os.id=a.schedule_id
  WHERE a.schedule_id=n.deep_link_id AND a.profile_id=s.profile_id AND a.archived_at IS NULL AND os.archived_at IS NULL))))
 AND (n.category<>'TASK_REQUEST' OR public.task_push_valid_v1(n.deep_link_id,n.recipient_id,e.event_type,e.payload->>'audience'))
 AND p.is_active AND p.account_status='active' AND n.revoked_at IS NULL AND (n.expires_at IS NULL OR n.expires_at>now()))
$function$
;
CREATE OR REPLACE FUNCTION public.get_notification_push_delivery_v1(p_delivery_id uuid, p_token uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT jsonb_build_object('notification_id',n.id,'deep_link_type',n.deep_link_type,'deep_link_id',n.deep_link_id,
    'event_type',e.event_type,'summary_count',CASE WHEN e.event_type='DAILY_SCHEDULE_SUMMARY' THEN e.payload->'count' ELSE NULL END,'category',n.category,'endpoint',s.endpoint,'p256dh',s.p256dh,'auth',s.auth) || CASE WHEN n.category='TASK_REQUEST' THEN jsonb_build_object('task_audience',e.payload->>'audience') ELSE '{}'::jsonb END
  FROM public.notification_push_deliveries d JOIN public.notifications n ON n.id=d.notification_id JOIN public.notification_events e ON e.id=n.event_id JOIN public.push_subscriptions s ON s.id=d.subscription_id
  WHERE d.id=p_delivery_id AND d.claim_token=p_token AND d.status='PROCESSING' AND d.lease_until>now()+interval '20 seconds'
  AND EXISTS(SELECT 1 FROM public.notification_push_config WHERE enabled) AND public.push_delivery_valid_v1(d.id);
$function$
;
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
 SELECT count(*) FILTER(WHERE n.read_at IS NULL),count(*) FILTER(WHERE a.ack_required AND n.acknowledged_at IS NULL) INTO v_count,v_ack FROM public.notifications n LEFT JOIN public.announcements a ON a.id=n.announcement_id WHERE n.recipient_id=auth.uid() AND (n.category<>'TASK_REQUEST' OR (public.is_active_operation_member() AND EXISTS(SELECT 1 FROM public.notification_task_config WHERE singleton AND task_request_enabled))) AND n.revoked_at IS NULL AND (n.expires_at IS NULL OR n.expires_at>now());
 SELECT coalesce(jsonb_agg(x ORDER BY x.created_at DESC,x.id DESC),'[]') INTO v_rows FROM (
 SELECT n.*,coalesce(a.ack_required,false) ack_required,coalesce(a.priority,'NORMAL') priority FROM public.notifications n LEFT JOIN public.announcements a ON a.id=n.announcement_id WHERE n.recipient_id=auth.uid() AND (n.category<>'TASK_REQUEST' OR (public.is_active_operation_member() AND EXISTS(SELECT 1 FROM public.notification_task_config WHERE singleton AND task_request_enabled))) AND n.revoked_at IS NULL AND (n.expires_at IS NULL OR n.expires_at>now()) AND (NOT p_unread_only OR n.read_at IS NULL) ORDER BY n.created_at DESC,n.id DESC LIMIT 50 OFFSET p_offset) x;
 SELECT coalesce(jsonb_agg(x ORDER BY x.created_at DESC,x.id DESC),'[]') INTO v_popup FROM (
 SELECT n.*,a.ack_required,a.priority FROM public.notifications n JOIN public.announcements a ON a.id=n.announcement_id WHERE n.recipient_id=auth.uid() AND (n.category<>'TASK_REQUEST' OR (public.is_active_operation_member() AND EXISTS(SELECT 1 FROM public.notification_task_config WHERE singleton AND task_request_enabled))) AND n.revoked_at IS NULL AND (n.expires_at IS NULL OR n.expires_at>now()) AND ((a.ack_required AND n.acknowledged_at IS NULL) OR (NOT a.ack_required AND n.popup_presented_at IS NULL AND n.read_at IS NULL)) ORDER BY n.created_at DESC,n.id DESC LIMIT 20) x;
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
 SELECT to_jsonb(x) INTO result FROM (SELECT n.*,coalesce(a.ack_required,false) ack_required,coalesce(a.priority,'NORMAL') priority FROM public.notifications n LEFT JOIN public.announcements a ON a.id=n.announcement_id WHERE n.id=p_notification_id AND n.recipient_id=auth.uid() AND (n.category<>'TASK_REQUEST' OR (public.is_active_operation_member() AND EXISTS(SELECT 1 FROM public.notification_task_config WHERE singleton AND task_request_enabled))) AND n.revoked_at IS NULL AND (n.expires_at IS NULL OR n.expires_at>now())) x;
 RETURN result;
END $function$
;

DO $acl$ DECLARE r record; BEGIN
 FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN('task_requests','task_request_targets','task_request_audit_events','task_request_command_receipts','notification_task_config') LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',r.tablename);
 EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',r.tablename);
 END LOOP;
 FOR r IN SELECT oid::regprocedure signature,proname FROM pg_proc WHERE pronamespace='public'::regnamespace AND (proname LIKE 'task_%_v1' OR proname IN('get_task_request_summary_v1','get_task_request_access_v1','get_notification_capability_directory_v1','set_notification_capability_v1','create_task_request_v1','acknowledge_task_request_v1','complete_task_request_v1','cancel_task_request_v1','get_task_request_recipients_v1','get_task_request_detail_v1','get_task_request_inbox_v1','get_sent_task_requests_v1','run_task_request_reminders_v1')) LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',r.signature);
 IF r.proname NOT LIKE 'task_%' AND r.proname<>'run_task_request_reminders_v1' THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',r.signature); END IF;
 END LOOP;
END $acl$;
COMMIT;
