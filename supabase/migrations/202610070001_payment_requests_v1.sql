-- Payment Requests V1: workflow only; never writes financial ledgers.
BEGIN;

DO $absence$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_class WHERE relnamespace='public'::regnamespace AND relname=ANY(ARRAY['payment_request_config','payment_confirmation_requests','payment_requests','payment_request_audit_events','payment_request_command_receipts','payment_confirmation_inbox','payment_confirmation_sent','payment_request_inbox','payment_request_sent'])) OR EXISTS(SELECT 1 FROM pg_type WHERE typnamespace='public'::regnamespace AND typname=ANY(ARRAY['payment_request_config','payment_confirmation_requests','payment_requests','payment_request_audit_events','payment_request_command_receipts','payment_confirmation_inbox','payment_confirmation_sent','payment_request_inbox','payment_request_sent'])) OR EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=ANY(ARRAY['acknowledge_payment_request_v1','administratively_cancel_payment_confirmation_request_v1','administratively_cancel_payment_request_v1','cancel_payment_confirmation_request_v1','cancel_payment_request_v1','complete_payment_request_v1','confirm_payment_confirmation_request_v1','create_payment_confirmation_request_v1','create_payment_request_v1','get_payment_request_access_v1','get_payment_request_capability_directory_v1','get_payment_request_detail_v1','get_payment_request_handlers_v1','get_request_hub_v1','mark_payment_confirmation_not_found_v1','payment_can_admin_close_v1','payment_can_view_v1','payment_command_v1','payment_emit_v1','payment_enabled_v1','payment_has_capability_v1','payment_push_valid_v1','payment_revision_v1','payment_rows_v1','reject_payment_request_v1','set_payment_request_capability_v1'])) THEN RAISE EXCEPTION 'PAYMENT_OBJECT_ALREADY_EXISTS'; END IF;
END $absence$;
LOCK TABLE public.notification_capability_grants,public.notifications IN SHARE ROW EXCLUSIVE MODE;
DO $shared_guard$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.notification_capability_grants'::regclass AND conname='notification_capability_grants_capability_check' AND contype='c' AND convalidated AND pg_get_constraintdef(oid)=$expected$CHECK ((capability = ANY (ARRAY['ANNOUNCEMENT_PUBLISH'::text, 'ANNOUNCEMENT_RECEIPTS_VIEW'::text, 'TASK_REQUEST_CREATE'::text])))$expected$) THEN RAISE EXCEPTION 'PAYMENT_CHECK_PREDECESSOR_MISMATCH: notification_capability_grants_capability_check'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.notifications'::regclass AND conname='notifications_deep_link_type_check' AND contype='c' AND convalidated AND pg_get_constraintdef(oid)=$expected$CHECK ((deep_link_type = ANY (ARRAY['ANNOUNCEMENT'::text, 'SCHEDULE'::text, 'SCHEDULE_DAY'::text, 'TASK_REQUEST'::text])))$expected$) THEN RAISE EXCEPTION 'PAYMENT_CHECK_PREDECESSOR_MISMATCH: notifications_deep_link_type_check'; END IF;
 IF EXISTS(SELECT 1 FROM public.notification_capability_grants WHERE capability IS NULL OR capability NOT IN('ANNOUNCEMENT_PUBLISH','ANNOUNCEMENT_RECEIPTS_VIEW','TASK_REQUEST_CREATE')) OR EXISTS(SELECT 1 FROM public.notifications WHERE deep_link_type IS NULL OR deep_link_type NOT IN('ANNOUNCEMENT','SCHEDULE','SCHEDULE_DAY','TASK_REQUEST')) THEN RAISE EXCEPTION 'PAYMENT_PREDECESSOR_DATA_MISMATCH'; END IF;
END $shared_guard$;

DO $guard$ BEGIN
IF md5(pg_get_functiondef('push_delivery_valid_v1(uuid)'::regprocedure)) <> '66dcce1898430d07bab1818733ef02da' THEN RAISE EXCEPTION 'PAYMENT_PREDECESSOR_MISMATCH: push_delivery_valid_v1'; END IF;
IF md5(pg_get_functiondef('get_notification_inbox_v1(integer,boolean)'::regprocedure)) <> '549b5285b76d5df721c3c12abbe22123' THEN RAISE EXCEPTION 'PAYMENT_PREDECESSOR_MISMATCH: get_notification_inbox_v1'; END IF;
IF md5(pg_get_functiondef('get_notification_detail_v1(uuid)'::regprocedure)) <> '51303cd09ebc6823f4e9012e6cb70763' THEN RAISE EXCEPTION 'PAYMENT_PREDECESSOR_MISMATCH: get_notification_detail_v1'; END IF;
END $guard$;

CREATE TABLE public.payment_request_config(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), payment_confirmation_enabled boolean NOT NULL DEFAULT false, payment_request_enabled boolean NOT NULL DEFAULT false);
INSERT INTO public.payment_request_config(singleton) VALUES(true);
CREATE TABLE public.payment_confirmation_requests(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), requester_id uuid NOT NULL REFERENCES public.profiles, reviewer_id uuid NOT NULL REFERENCES public.profiles,
 payer_name text NOT NULL CHECK(length(btrim(payer_name)) BETWEEN 1 AND 100), reported_amount bigint NOT NULL CHECK(reported_amount BETWEEN 1 AND 2147483647), dog_name text CHECK(length(dog_name)<=100), note text CHECK(length(note)<=2000),
 status text NOT NULL DEFAULT 'REQUESTED' CHECK(status IN('REQUESTED','CONFIRMED','NOT_FOUND','CANCELLED')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 resolved_at timestamptz, resolved_by uuid REFERENCES public.profiles, resolution_note text CHECK(length(resolution_note)<=1000),
 administrative_cancelled boolean NOT NULL DEFAULT false CHECK(NOT administrative_cancelled OR status='CANCELLED'),
 cancelled_at timestamptz, cancelled_by uuid REFERENCES public.profiles, cancel_reason text,
 request_id uuid NOT NULL, payload_hash text NOT NULL, version bigint NOT NULL DEFAULT 1 CHECK(version>0), UNIQUE(requester_id,request_id),
 CHECK((status IN('CONFIRMED','NOT_FOUND'))=(resolved_at IS NOT NULL AND resolved_by IS NOT NULL)),
 CHECK((status='CANCELLED')=(cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL AND nullif(btrim(cancel_reason),'') IS NOT NULL))
);
CREATE TABLE public.payment_requests(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), requester_id uuid NOT NULL REFERENCES public.profiles, processor_id uuid NOT NULL REFERENCES public.profiles,
 title text NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 100), payee_name text NOT NULL CHECK(length(btrim(payee_name)) BETWEEN 1 AND 100), requested_amount bigint NOT NULL CHECK(requested_amount BETWEEN 1 AND 2147483647), reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 2000), due_at timestamptz CHECK(isfinite(due_at)),
 status text NOT NULL DEFAULT 'REQUESTED' CHECK(status IN('REQUESTED','ACKNOWLEDGED','COMPLETED','REJECTED','CANCELLED')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(), acknowledged_at timestamptz,
 completed_at timestamptz, completion_note text CHECK(length(completion_note)<=1000),
 rejected_at timestamptz, rejected_by uuid REFERENCES public.profiles, rejection_reason text,
 administrative_cancelled boolean NOT NULL DEFAULT false CHECK(NOT administrative_cancelled OR status='CANCELLED'),
 cancelled_at timestamptz, cancelled_by uuid REFERENCES public.profiles, cancel_reason text,
 request_id uuid NOT NULL, payload_hash text NOT NULL, version bigint NOT NULL DEFAULT 1 CHECK(version>0), UNIQUE(requester_id,request_id),
 CHECK((status='COMPLETED')=(completed_at IS NOT NULL)), CHECK(status NOT IN('ACKNOWLEDGED','COMPLETED') OR acknowledged_at IS NOT NULL),
 CHECK((status='REJECTED')=(rejected_at IS NOT NULL AND rejected_by IS NOT NULL AND nullif(btrim(rejection_reason),'') IS NOT NULL)),
 CHECK((status='CANCELLED')=(cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL AND nullif(btrim(cancel_reason),'') IS NOT NULL)), CHECK(status<>'CANCELLED' OR acknowledged_at IS NULL OR administrative_cancelled)
);
CREATE TABLE public.payment_request_audit_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), confirmation_id uuid REFERENCES public.payment_confirmation_requests, payment_id uuid REFERENCES public.payment_requests,
 actor_id uuid NOT NULL REFERENCES public.profiles, action text NOT NULL CHECK(action IN('CONFIRMATION_CREATED','CONFIRMATION_CONFIRMED','CONFIRMATION_NOT_FOUND','CONFIRMATION_CANCELLED','PAYMENT_CREATED','PAYMENT_ACKNOWLEDGED','PAYMENT_COMPLETED','PAYMENT_REJECTED','PAYMENT_CANCELLED','CONFIRMATION_ADMIN_CANCELLED','PAYMENT_ADMIN_CANCELLED')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), request_id uuid NOT NULL, from_status text, to_status text NOT NULL, version bigint NOT NULL, metadata jsonb NOT NULL DEFAULT '{}',
 CHECK(num_nonnulls(confirmation_id,payment_id)=1), UNIQUE(actor_id,request_id)
);
CREATE TABLE public.payment_request_command_receipts(
 actor_id uuid NOT NULL REFERENCES public.profiles, request_id uuid NOT NULL, command text NOT NULL, payload_hash text NOT NULL,
 confirmation_id uuid REFERENCES public.payment_confirmation_requests, payment_id uuid REFERENCES public.payment_requests,
 result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(actor_id,request_id), CHECK(num_nonnulls(confirmation_id,payment_id)=1)
);
CREATE INDEX payment_confirmation_inbox ON public.payment_confirmation_requests(reviewer_id,created_at DESC,id);
CREATE INDEX payment_confirmation_sent ON public.payment_confirmation_requests(requester_id,created_at DESC,id);
CREATE INDEX payment_request_inbox ON public.payment_requests(processor_id,created_at DESC,id);
CREATE INDEX payment_request_sent ON public.payment_requests(requester_id,created_at DESC,id);
ALTER TABLE public.notification_capability_grants DROP CONSTRAINT notification_capability_grants_capability_check;
ALTER TABLE public.notification_capability_grants ADD CONSTRAINT notification_capability_grants_capability_check CHECK(capability IN('ANNOUNCEMENT_PUBLISH','ANNOUNCEMENT_RECEIPTS_VIEW','TASK_REQUEST_CREATE','PAYMENT_CONFIRMATION_REQUEST_CREATE','PAYMENT_REQUEST_CREATE','PAYMENT_CONFIRMATION_REVIEW','PAYMENT_REQUEST_PROCESS','PAYMENT_REQUESTS_VIEW_ALL'));
ALTER TABLE public.notifications DROP CONSTRAINT notifications_deep_link_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_deep_link_type_check CHECK(deep_link_type IN('ANNOUNCEMENT','SCHEDULE','SCHEDULE_DAY','TASK_REQUEST','PAYMENT_CONFIRMATION_REQUEST','PAYMENT_REQUEST'));


CREATE FUNCTION public.payment_enabled_v1(p_type text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $payment$
SELECT coalesce((SELECT CASE p_type WHEN 'PAYMENT_CONFIRMATION_REQUEST' THEN payment_confirmation_enabled WHEN 'PAYMENT_REQUEST' THEN payment_request_enabled ELSE false END FROM public.payment_request_config WHERE singleton),false);
$payment$;

CREATE FUNCTION public.payment_has_capability_v1(p_person uuid,p_cap text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $payment$
SELECT public.task_active_member_v1(p_person) AND EXISTS(SELECT 1 FROM public.notification_capability_grants WHERE profile_id=p_person AND capability=p_cap AND active);
$payment$;

CREATE FUNCTION public.get_payment_request_access_v1() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $payment$
SELECT jsonb_build_object('confirmation_enabled',public.is_active_operation_member() AND public.payment_enabled_v1('PAYMENT_CONFIRMATION_REQUEST'),'payment_enabled',public.is_active_operation_member() AND public.payment_enabled_v1('PAYMENT_REQUEST'),'confirmation_create',public.payment_has_capability_v1(auth.uid(),'PAYMENT_CONFIRMATION_REQUEST_CREATE'),'payment_create',public.payment_has_capability_v1(auth.uid(),'PAYMENT_REQUEST_CREATE'),'view_all',public.payment_has_capability_v1(auth.uid(),'PAYMENT_REQUESTS_VIEW_ALL'),'manage_create',public.has_operation_role(ARRAY['owner']),'manage_finance',public.is_admin());
$payment$;

CREATE FUNCTION public.get_payment_request_handlers_v1(p_type text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $payment$
BEGIN
 IF NOT public.is_active_operation_member() OR NOT public.payment_enabled_v1(p_type) OR NOT public.payment_has_capability_v1(auth.uid(),CASE p_type WHEN 'PAYMENT_CONFIRMATION_REQUEST' THEN 'PAYMENT_CONFIRMATION_REQUEST_CREATE' ELSE 'PAYMENT_REQUEST_CREATE' END) THEN RAISE EXCEPTION 'PAYMENT_FORBIDDEN' USING ERRCODE='42501'; END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',p.id,'name',p.name) ORDER BY p.name,p.id) FROM public.profiles p WHERE public.payment_has_capability_v1(p.id,CASE p_type WHEN 'PAYMENT_CONFIRMATION_REQUEST' THEN 'PAYMENT_CONFIRMATION_REVIEW' ELSE 'PAYMENT_REQUEST_PROCESS' END)),'[]'); END;
$payment$;

CREATE OR REPLACE FUNCTION public.set_payment_request_capability_v1(p_target_id uuid, p_capability text, p_active boolean, p_expected_version bigint, p_request_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE old public.notification_capability_grants; prior public.entity_audit_events; payload jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('payment-domain-write-v1',0));
 IF p_request_id IS NULL OR p_target_id IS NULL OR p_active IS NULL OR p_capability IS NULL OR p_capability NOT IN('PAYMENT_CONFIRMATION_REQUEST_CREATE','PAYMENT_REQUEST_CREATE','PAYMENT_CONFIRMATION_REVIEW','PAYMENT_REQUEST_PROCESS','PAYMENT_REQUESTS_VIEW_ALL') THEN RAISE EXCEPTION 'INVALID_CAPABILITY_INPUT' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('task-command:'||auth.uid()||':'||p_request_id,0));
 IF NOT (CASE WHEN p_capability IN('PAYMENT_CONFIRMATION_REQUEST_CREATE','PAYMENT_REQUEST_CREATE') THEN public.has_operation_role(ARRAY['owner']) ELSE public.is_admin() END) THEN RAISE EXCEPTION 'CAPABILITY_OWNER_REQUIRED' USING ERRCODE='42501'; END IF;
 payload:=jsonb_build_object('target',p_target_id,'capability',p_capability,'active',p_active);
 SELECT * INTO prior FROM public.entity_audit_events WHERE entity_type='notification_capability_grants' AND changed_by=auth.uid() AND request_id=p_request_id;
 IF FOUND THEN IF prior.after_data<>payload THEN RAISE EXCEPTION 'REQUEST_ID_PAYLOAD_MISMATCH' USING ERRCODE='22023'; END IF; RETURN; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('task-capability:'||p_target_id,0));
 PERFORM 1 FROM public.profiles WHERE id=ANY(ARRAY[p_target_id,auth.uid()]) ORDER BY id FOR SHARE;
 PERFORM 1 FROM public.operation_memberships WHERE profile_id=ANY(ARRAY[p_target_id,auth.uid()]) ORDER BY profile_id FOR SHARE;
 IF NOT (CASE WHEN p_capability IN('PAYMENT_CONFIRMATION_REQUEST_CREATE','PAYMENT_REQUEST_CREATE') THEN public.has_operation_role(ARRAY['owner']) ELSE public.is_admin() END) THEN RAISE EXCEPTION 'CAPABILITY_OWNER_REQUIRED' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_target_id AND is_active AND account_status='active') THEN RAISE EXCEPTION 'INACTIVE_TARGET' USING ERRCODE='22023'; END IF;
 IF p_active AND NOT public.task_active_member_v1(p_target_id) THEN RAISE EXCEPTION 'TASK_OPERATIONS_REQUIRED' USING ERRCODE='22023'; END IF;
 SELECT * INTO old FROM public.notification_capability_grants WHERE profile_id=p_target_id AND capability=p_capability ORDER BY version DESC,created_at DESC LIMIT 1 FOR UPDATE;
 IF coalesce(old.version,0) IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'CAPABILITY_VERSION_CONFLICT' USING ERRCODE='40001'; END IF;
 IF old.active AND NOT p_active AND ((p_capability='PAYMENT_CONFIRMATION_REVIEW' AND EXISTS(SELECT 1 FROM public.payment_confirmation_requests WHERE reviewer_id=p_target_id AND status='REQUESTED')) OR (p_capability='PAYMENT_REQUEST_PROCESS' AND EXISTS(SELECT 1 FROM public.payment_requests WHERE processor_id=p_target_id AND status IN('REQUESTED','ACKNOWLEDGED')))) THEN RAISE EXCEPTION 'PAYMENT_CAPABILITY_IN_USE' USING ERRCODE='55000'; END IF;
 IF old.id IS NULL THEN INSERT INTO public.notification_capability_grants(profile_id,capability,active,granted_by,revoked_at) VALUES(p_target_id,p_capability,p_active,auth.uid(),CASE WHEN NOT p_active THEN statement_timestamp() END);
 ELSE UPDATE public.notification_capability_grants SET active=p_active,revoked_at=CASE WHEN NOT p_active THEN statement_timestamp() END,granted_by=CASE WHEN p_active THEN auth.uid() ELSE granted_by END,version=version+1 WHERE id=old.id; END IF;
 INSERT INTO public.entity_audit_events(module_code,entity_type,entity_id,action,changed_by,request_id,after_data,change_reason) VALUES('operations','notification_capability_grants',p_target_id,'updated',auth.uid(),p_request_id,payload,CASE WHEN p_active THEN 'PERMISSION_GRANTED' ELSE 'PERMISSION_REVOKED' END);
END;
$function$
;

CREATE FUNCTION public.get_payment_request_capability_directory_v1() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $payment$
BEGIN
 IF NOT public.has_operation_role(ARRAY['owner']) AND NOT public.is_admin() THEN RAISE EXCEPTION 'PAYMENT_FORBIDDEN' USING ERRCODE='42501'; END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'active',p.is_active AND p.account_status='active','operation_active',coalesce(m.is_active,false),'capabilities',coalesce((SELECT jsonb_object_agg(k,jsonb_build_object('active',coalesce(g.active,false),'version',coalesce(g.version,0))) FROM unnest(ARRAY['PAYMENT_CONFIRMATION_REQUEST_CREATE','PAYMENT_REQUEST_CREATE','PAYMENT_CONFIRMATION_REVIEW','PAYMENT_REQUEST_PROCESS','PAYMENT_REQUESTS_VIEW_ALL'])k LEFT JOIN LATERAL(SELECT active,version FROM public.notification_capability_grants WHERE profile_id=p.id AND capability=k ORDER BY version DESC,created_at DESC LIMIT 1)g ON true WHERE CASE WHEN k IN('PAYMENT_CONFIRMATION_REQUEST_CREATE','PAYMENT_REQUEST_CREATE') THEN public.has_operation_role(ARRAY['owner']) ELSE public.is_admin() END),'{}')) ORDER BY p.name,p.id) FROM public.profiles p LEFT JOIN public.operation_memberships m ON m.profile_id=p.id),'[]'); END;
$payment$;

CREATE FUNCTION public.payment_rows_v1() RETURNS TABLE(request_type text,id uuid,requester_id uuid,handler_id uuid,display_title text,status text,created_at timestamptz,due_at timestamptz,version bigint,data jsonb) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $payment$
SELECT 'PAYMENT_CONFIRMATION_REQUEST'::text,r.id,r.requester_id,r.reviewer_id,r.payer_name||' · 입금 확인',r.status,r.created_at,NULL::timestamptz,r.version,to_jsonb(r)-'payload_hash'-'request_id' FROM public.payment_confirmation_requests r
 UNION ALL SELECT 'PAYMENT_REQUEST',r.id,r.requester_id,r.processor_id,r.title,r.status,r.created_at,r.due_at,r.version,to_jsonb(r)-'payload_hash'-'request_id' FROM public.payment_requests r;
$payment$;

CREATE FUNCTION public.payment_can_view_v1(p_type text,p_id uuid,p_person uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $payment$
SELECT public.task_active_member_v1(p_person) AND public.payment_enabled_v1(p_type) AND EXISTS(SELECT 1 FROM public.payment_rows_v1()r WHERE r.request_type=p_type AND r.id=p_id AND (r.requester_id=p_person OR (r.handler_id=p_person AND public.payment_has_capability_v1(p_person,CASE p_type WHEN 'PAYMENT_CONFIRMATION_REQUEST' THEN 'PAYMENT_CONFIRMATION_REVIEW' ELSE 'PAYMENT_REQUEST_PROCESS' END)) OR public.payment_has_capability_v1(p_person,'PAYMENT_REQUESTS_VIEW_ALL')));
$payment$;

CREATE FUNCTION public.payment_can_admin_close_v1(p_type text,p_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $payment$
SELECT public.is_admin() AND public.payment_has_capability_v1(auth.uid(),'PAYMENT_REQUESTS_VIEW_ALL') AND public.payment_enabled_v1(p_type) AND EXISTS(SELECT 1 FROM public.payment_rows_v1()r WHERE r.request_type=p_type AND r.id=p_id AND r.status IN('REQUESTED','ACKNOWLEDGED') AND NOT public.payment_has_capability_v1(r.handler_id,CASE p_type WHEN 'PAYMENT_CONFIRMATION_REQUEST' THEN 'PAYMENT_CONFIRMATION_REVIEW' ELSE 'PAYMENT_REQUEST_PROCESS' END));
$payment$;

CREATE FUNCTION public.get_payment_request_detail_v1(p_type text,p_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $payment$
DECLARE r record; BEGIN
 IF NOT public.payment_can_view_v1(p_type,p_id,auth.uid()) THEN RAISE EXCEPTION 'PAYMENT_NOT_FOUND' USING ERRCODE='P0002'; END IF;
 SELECT * INTO r FROM public.payment_rows_v1() WHERE request_type=p_type AND id=p_id;
 RETURN r.data||jsonb_build_object('request_type',p_type,'requester_name',(SELECT name FROM public.profiles WHERE id=r.requester_id),'handler_name',(SELECT name FROM public.profiles WHERE id=r.handler_id),'can_process',r.handler_id=auth.uid() AND public.payment_has_capability_v1(auth.uid(),CASE p_type WHEN 'PAYMENT_CONFIRMATION_REQUEST' THEN 'PAYMENT_CONFIRMATION_REVIEW' ELSE 'PAYMENT_REQUEST_PROCESS' END),'can_cancel',r.requester_id=auth.uid() AND r.status='REQUESTED','handler_unavailable',r.status IN('REQUESTED','ACKNOWLEDGED') AND NOT public.payment_has_capability_v1(r.handler_id,CASE p_type WHEN 'PAYMENT_CONFIRMATION_REQUEST' THEN 'PAYMENT_CONFIRMATION_REVIEW' ELSE 'PAYMENT_REQUEST_PROCESS' END),'can_admin_close',public.payment_can_admin_close_v1(p_type,p_id)); END;
$payment$;

CREATE FUNCTION public.payment_revision_v1(p_requester uuid,p_handler uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $payment$
BEGIN
 INSERT INTO public.notification_inbox_revisions(recipient_id,revision,updated_at)
 SELECT id,1,statement_timestamp() FROM (SELECT p_requester id UNION SELECT p_handler UNION SELECT profile_id FROM public.notification_capability_grants WHERE capability='PAYMENT_REQUESTS_VIEW_ALL' AND active)u ORDER BY id
 ON CONFLICT(recipient_id) DO UPDATE SET revision=public.notification_inbox_revisions.revision+1,updated_at=statement_timestamp(); END;
$payment$;

CREATE FUNCTION public.payment_emit_v1(p_type text,p_id uuid,p_recipient uuid,p_event text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $payment$
DECLARE eid uuid; BEGIN
 IF NOT public.payment_can_view_v1(p_type,p_id,p_recipient) THEN RETURN; END IF;
 INSERT INTO public.notification_events(event_type,source_kind,source_id,dedupe_key,payload,state,processed_at)
 VALUES(p_event,'payment_request',p_id,'payment:'||p_type||':'||p_id||':'||p_event||':'||p_recipient,jsonb_build_object('request_type',p_type,'request_id',p_id),'processed',statement_timestamp()) ON CONFLICT(dedupe_key) DO NOTHING RETURNING id INTO eid;
 IF eid IS NULL THEN RETURN; END IF;
 INSERT INTO public.notifications(event_id,recipient_id,category,title,message,deep_link_type,deep_link_id) VALUES(eid,p_recipient,p_type,CASE p_event WHEN 'PAYMENT_CONFIRMATION_REQUESTED' THEN '새 결제 확인 요청이 있습니다.' WHEN 'PAYMENT_REQUEST_REQUESTED' THEN '새 지급 요청이 있습니다.' WHEN 'PAYMENT_REQUEST_COMPLETED' THEN '요청한 지급이 완료되었습니다.' WHEN 'PAYMENT_REQUEST_REJECTED' THEN '지급 요청이 반려되었습니다.' WHEN 'PAYMENT_CONFIRMATION_CANCELLED' THEN '요청이 취소되었습니다.' WHEN 'PAYMENT_REQUEST_CANCELLED' THEN '요청이 취소되었습니다.' WHEN 'PAYMENT_CONFIRMATION_ADMIN_CANCELLED' THEN '결제 확인 요청이 관리 종료되었습니다.' WHEN 'PAYMENT_REQUEST_ADMIN_CANCELLED' THEN '지급 요청이 관리 종료되었습니다.' ELSE '결제 확인 요청이 처리되었습니다.' END,CASE p_event WHEN 'PAYMENT_CONFIRMATION_ADMIN_CANCELLED' THEN '입금 여부는 별도로 확인해 주세요.' WHEN 'PAYMENT_REQUEST_ADMIN_CANCELLED' THEN '외부 지급 여부는 별도로 확인해 주세요.' ELSE '요청 상세에서 확인해 주세요.' END,p_type,p_id); END;
$payment$;

CREATE FUNCTION public.payment_command_v1(p_type text,p_id uuid,p_action text,p_payload jsonb,p_expected_version bigint,p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $payment$
#variable_conflict use_variable
DECLARE r record; prior public.payment_request_command_receipts; h text; handler uuid; requester uuid; rid uuid:=p_id; prev text; next text; result jsonb; ver bigint; at timestamptz; ev text; note text:=nullif(btrim(p_payload->>'note'),''); required_cap text;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('payment-domain-write-v1',0));
 IF p_type IS NULL OR p_type NOT IN('PAYMENT_CONFIRMATION_REQUEST','PAYMENT_REQUEST') OR p_action IS NULL OR p_action NOT IN('CREATE','CONFIRMED','NOT_FOUND','CANCELLED','ACKNOWLEDGED','COMPLETED','REJECTED','ADMIN_CANCELLED') OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' OR p_request_id IS NULL OR p_expected_version IS NULL THEN RAISE EXCEPTION 'INVALID_PAYMENT_INPUT' USING ERRCODE='22023'; END IF;
 IF NOT public.is_active_operation_member() OR (p_action='ADMIN_CANCELLED' AND (NOT public.is_admin() OR NOT public.payment_has_capability_v1(auth.uid(),'PAYMENT_REQUESTS_VIEW_ALL'))) THEN RAISE EXCEPTION 'PAYMENT_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF NOT public.payment_enabled_v1(p_type) THEN RAISE EXCEPTION 'PAYMENT_DISABLED' USING ERRCODE='55000'; END IF;
 h:=md5(jsonb_build_object('type',p_type,'id',p_id,'action',p_action,'payload',p_payload,'version',p_expected_version)::text);
 SELECT * INTO prior FROM public.payment_request_command_receipts WHERE actor_id=auth.uid() AND request_id=p_request_id;
 IF FOUND THEN IF prior.payload_hash<>h THEN RAISE EXCEPTION 'REQUEST_ID_PAYLOAD_MISMATCH' USING ERRCODE='22023'; END IF; RETURN prior.result; END IF;
 IF p_action<>'CREATE' AND length(note)>1000 THEN RAISE EXCEPTION 'INVALID_PAYMENT_INPUT' USING ERRCODE='22023'; END IF;
 IF p_action='CREATE' THEN
  IF p_id IS NOT NULL OR p_expected_version<>0 THEN RAISE EXCEPTION 'PAYMENT_VERSION_CONFLICT' USING ERRCODE='40001'; END IF;
  required_cap:=CASE p_type WHEN 'PAYMENT_CONFIRMATION_REQUEST' THEN 'PAYMENT_CONFIRMATION_REQUEST_CREATE' ELSE 'PAYMENT_REQUEST_CREATE' END;
  handler:=(p_payload->>'handler_id')::uuid; requester:=auth.uid();
 ELSE
  IF p_type='PAYMENT_CONFIRMATION_REQUEST' THEN PERFORM 1 FROM public.payment_confirmation_requests WHERE id=p_id FOR UPDATE; ELSE PERFORM 1 FROM public.payment_requests WHERE id=p_id FOR UPDATE; END IF;
  SELECT * INTO r FROM public.payment_rows_v1() WHERE request_type=p_type AND id=p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'PAYMENT_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  handler:=r.handler_id; requester:=r.requester_id; prev:=r.status;
  IF p_action='ADMIN_CANCELLED' THEN NULL;
  ELSIF p_action='CANCELLED' THEN IF auth.uid()<>r.requester_id THEN RAISE EXCEPTION 'PAYMENT_FORBIDDEN' USING ERRCODE='42501'; END IF;
  ELSE IF auth.uid()<>handler THEN RAISE EXCEPTION 'PAYMENT_FORBIDDEN' USING ERRCODE='42501'; END IF; required_cap:=CASE p_type WHEN 'PAYMENT_CONFIRMATION_REQUEST' THEN 'PAYMENT_CONFIRMATION_REVIEW' ELSE 'PAYMENT_REQUEST_PROCESS' END; END IF;
 END IF;
 PERFORM 1 FROM public.profiles WHERE id=ANY(ARRAY[auth.uid(),handler]) ORDER BY id FOR SHARE;
 PERFORM 1 FROM public.operation_memberships WHERE profile_id=ANY(ARRAY[auth.uid(),handler]) ORDER BY profile_id FOR SHARE;
 IF NOT public.is_active_operation_member() OR (required_cap IS NOT NULL AND NOT public.payment_has_capability_v1(auth.uid(),required_cap)) THEN RAISE EXCEPTION 'PAYMENT_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF p_action='ADMIN_CANCELLED' AND NOT public.payment_can_admin_close_v1(p_type,p_id) THEN RAISE EXCEPTION 'PAYMENT_ADMIN_CLOSE_NOT_ALLOWED' USING ERRCODE='42501'; END IF;
 at:=clock_timestamp();
 IF p_action='CREATE' THEN
  IF handler IS NULL OR NOT public.payment_has_capability_v1(handler,CASE p_type WHEN 'PAYMENT_CONFIRMATION_REQUEST' THEN 'PAYMENT_CONFIRMATION_REVIEW' ELSE 'PAYMENT_REQUEST_PROCESS' END) THEN RAISE EXCEPTION 'INVALID_PAYMENT_HANDLER' USING ERRCODE='22023'; END IF;
  IF p_type='PAYMENT_CONFIRMATION_REQUEST' THEN
   IF (p_payload-ARRAY['handler_id','payer_name','amount','dog_name','note'])<>'{}'::jsonb THEN RAISE EXCEPTION 'INVALID_PAYMENT_INPUT' USING ERRCODE='22023'; END IF;
   INSERT INTO public.payment_confirmation_requests(requester_id,reviewer_id,payer_name,reported_amount,dog_name,note,request_id,payload_hash) VALUES(auth.uid(),handler,btrim(p_payload->>'payer_name'),(p_payload->>'amount')::bigint,nullif(btrim(p_payload->>'dog_name'),''),nullif(btrim(p_payload->>'note'),''),p_request_id,h) RETURNING id INTO rid;
  ELSE
   IF (p_payload-ARRAY['handler_id','title','payee_name','amount','reason','due_at'])<>'{}'::jsonb OR ((p_payload->>'due_at') IS NOT NULL AND (p_payload->>'due_at') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$') OR (p_payload->>'due_at')::timestamptz<=at OR NOT isfinite((p_payload->>'due_at')::timestamptz) THEN RAISE EXCEPTION 'PAYMENT_DUE_MUST_BE_FUTURE' USING ERRCODE='22023'; END IF;
   INSERT INTO public.payment_requests(requester_id,processor_id,title,payee_name,requested_amount,reason,due_at,request_id,payload_hash) VALUES(auth.uid(),handler,btrim(p_payload->>'title'),btrim(p_payload->>'payee_name'),(p_payload->>'amount')::bigint,btrim(p_payload->>'reason'),(p_payload->>'due_at')::timestamptz,p_request_id,h) RETURNING id INTO rid;
  END IF;
  next:='REQUESTED'; ver:=1;
 ELSE
  IF p_expected_version<>r.version THEN RAISE EXCEPTION 'PAYMENT_VERSION_CONFLICT' USING ERRCODE='40001'; END IF;
  IF (p_payload-ARRAY['note'])<>'{}'::jsonb THEN RAISE EXCEPTION 'INVALID_PAYMENT_INPUT' USING ERRCODE='22023'; END IF;
  IF NOT ((p_action='ADMIN_CANCELLED' AND prev IN('REQUESTED','ACKNOWLEDGED')) OR (p_action='CANCELLED' AND prev='REQUESTED') OR (p_type='PAYMENT_CONFIRMATION_REQUEST' AND p_action IN('CONFIRMED','NOT_FOUND') AND prev='REQUESTED') OR (p_type='PAYMENT_REQUEST' AND ((p_action='ACKNOWLEDGED' AND prev='REQUESTED') OR (p_action='COMPLETED' AND prev='ACKNOWLEDGED') OR (p_action='REJECTED' AND prev IN('REQUESTED','ACKNOWLEDGED'))))) THEN RAISE EXCEPTION 'PAYMENT_INVALID_TRANSITION' USING ERRCODE='22023'; END IF;
  IF p_action IN('CANCELLED','REJECTED','ADMIN_CANCELLED') AND note IS NULL THEN RAISE EXCEPTION 'PAYMENT_REASON_REQUIRED' USING ERRCODE='22023'; END IF;
  next:=CASE WHEN p_action='ADMIN_CANCELLED' THEN 'CANCELLED' ELSE p_action END; ver:=r.version+1;
  IF p_type='PAYMENT_CONFIRMATION_REQUEST' THEN UPDATE public.payment_confirmation_requests SET administrative_cancelled=(p_action='ADMIN_CANCELLED'),status=next,version=ver,updated_at=at,resolved_at=CASE WHEN next<>'CANCELLED' THEN at END,resolved_by=CASE WHEN next<>'CANCELLED' THEN auth.uid() END,resolution_note=CASE WHEN next<>'CANCELLED' THEN note END,cancelled_at=CASE WHEN next='CANCELLED' THEN at END,cancelled_by=CASE WHEN next='CANCELLED' THEN auth.uid() END,cancel_reason=CASE WHEN next='CANCELLED' THEN note END WHERE id=rid;
  ELSE UPDATE public.payment_requests SET administrative_cancelled=(p_action='ADMIN_CANCELLED'),status=next,version=ver,updated_at=at,acknowledged_at=CASE WHEN next='ACKNOWLEDGED' THEN at ELSE acknowledged_at END,completed_at=CASE WHEN next='COMPLETED' THEN at END,completion_note=CASE WHEN next='COMPLETED' THEN note END,rejected_at=CASE WHEN next='REJECTED' THEN at END,rejected_by=CASE WHEN next='REJECTED' THEN auth.uid() END,rejection_reason=CASE WHEN next='REJECTED' THEN note END,cancelled_at=CASE WHEN next='CANCELLED' THEN at END,cancelled_by=CASE WHEN next='CANCELLED' THEN auth.uid() END,cancel_reason=CASE WHEN next='CANCELLED' THEN note END WHERE id=rid; END IF;
 END IF;
 result:=jsonb_build_object('id',rid,'version',ver,'status',next);
 INSERT INTO public.payment_request_command_receipts(actor_id,request_id,command,payload_hash,confirmation_id,payment_id,result) VALUES(auth.uid(),p_request_id,p_action,h,CASE WHEN p_type='PAYMENT_CONFIRMATION_REQUEST' THEN rid END,CASE WHEN p_type='PAYMENT_REQUEST' THEN rid END,result);
 INSERT INTO public.payment_request_audit_events(confirmation_id,payment_id,actor_id,action,request_id,from_status,to_status,version,metadata) VALUES(CASE WHEN p_type='PAYMENT_CONFIRMATION_REQUEST' THEN rid END,CASE WHEN p_type='PAYMENT_REQUEST' THEN rid END,auth.uid(),CASE p_type WHEN 'PAYMENT_CONFIRMATION_REQUEST' THEN 'CONFIRMATION_' ELSE 'PAYMENT_' END||CASE WHEN p_action='CREATE' THEN 'CREATED' WHEN p_action='ADMIN_CANCELLED' THEN 'ADMIN_CANCELLED' ELSE next END,p_request_id,prev,next,ver,jsonb_build_object('note_present',note IS NOT NULL)||CASE WHEN p_action='ADMIN_CANCELLED' THEN jsonb_build_object('administrative',true) ELSE '{}'::jsonb END);
 IF p_action<>'ACKNOWLEDGED' THEN
  ev:=CASE p_type WHEN 'PAYMENT_CONFIRMATION_REQUEST' THEN 'PAYMENT_CONFIRMATION_' ELSE 'PAYMENT_REQUEST_' END||CASE WHEN p_action='CREATE' THEN 'REQUESTED' WHEN p_action='ADMIN_CANCELLED' THEN 'ADMIN_CANCELLED' ELSE next END;
  PERFORM public.payment_emit_v1(p_type,rid,CASE WHEN p_action IN('CREATE','CANCELLED') THEN handler ELSE requester END,ev);
 END IF;
 PERFORM public.payment_revision_v1(requester,handler);
 RETURN result; END;
$payment$;

CREATE FUNCTION public.create_payment_confirmation_request_v1(p_request_id uuid,p_expected_version bigint,p_payload jsonb) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $payment$
SELECT public.payment_command_v1('PAYMENT_CONFIRMATION_REQUEST',NULL,'CREATE',p_payload,p_expected_version,p_request_id);
$payment$;

CREATE FUNCTION public.confirm_payment_confirmation_request_v1(p_request_id uuid,p_expected_version bigint,p_payload jsonb,p_id uuid) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $payment$
SELECT public.payment_command_v1('PAYMENT_CONFIRMATION_REQUEST',p_id,'CONFIRMED',p_payload,p_expected_version,p_request_id);
$payment$;

CREATE FUNCTION public.mark_payment_confirmation_not_found_v1(p_request_id uuid,p_expected_version bigint,p_payload jsonb,p_id uuid) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $payment$
SELECT public.payment_command_v1('PAYMENT_CONFIRMATION_REQUEST',p_id,'NOT_FOUND',p_payload,p_expected_version,p_request_id);
$payment$;

CREATE FUNCTION public.cancel_payment_confirmation_request_v1(p_request_id uuid,p_expected_version bigint,p_payload jsonb,p_id uuid) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $payment$
SELECT public.payment_command_v1('PAYMENT_CONFIRMATION_REQUEST',p_id,'CANCELLED',p_payload,p_expected_version,p_request_id);
$payment$;

CREATE FUNCTION public.create_payment_request_v1(p_request_id uuid,p_expected_version bigint,p_payload jsonb) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $payment$
SELECT public.payment_command_v1('PAYMENT_REQUEST',NULL,'CREATE',p_payload,p_expected_version,p_request_id);
$payment$;

CREATE FUNCTION public.acknowledge_payment_request_v1(p_request_id uuid,p_expected_version bigint,p_payload jsonb,p_id uuid) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $payment$
SELECT public.payment_command_v1('PAYMENT_REQUEST',p_id,'ACKNOWLEDGED',p_payload,p_expected_version,p_request_id);
$payment$;

CREATE FUNCTION public.complete_payment_request_v1(p_request_id uuid,p_expected_version bigint,p_payload jsonb,p_id uuid) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $payment$
SELECT public.payment_command_v1('PAYMENT_REQUEST',p_id,'COMPLETED',p_payload,p_expected_version,p_request_id);
$payment$;

CREATE FUNCTION public.reject_payment_request_v1(p_request_id uuid,p_expected_version bigint,p_payload jsonb,p_id uuid) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $payment$
SELECT public.payment_command_v1('PAYMENT_REQUEST',p_id,'REJECTED',p_payload,p_expected_version,p_request_id);
$payment$;

CREATE FUNCTION public.cancel_payment_request_v1(p_request_id uuid,p_expected_version bigint,p_payload jsonb,p_id uuid) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $payment$
SELECT public.payment_command_v1('PAYMENT_REQUEST',p_id,'CANCELLED',p_payload,p_expected_version,p_request_id);
$payment$;

CREATE FUNCTION public.administratively_cancel_payment_request_v1(p_request_id uuid,p_expected_version bigint,p_payload jsonb,p_id uuid) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $payment$
SELECT public.payment_command_v1('PAYMENT_REQUEST',p_id,'ADMIN_CANCELLED',p_payload,p_expected_version,p_request_id);
$payment$;

CREATE FUNCTION public.administratively_cancel_payment_confirmation_request_v1(p_request_id uuid,p_expected_version bigint,p_payload jsonb,p_id uuid) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $payment$
SELECT public.payment_command_v1('PAYMENT_CONFIRMATION_REQUEST',p_id,'ADMIN_CANCELLED',p_payload,p_expected_version,p_request_id);
$payment$;

CREATE FUNCTION public.payment_push_valid_v1(p_type text,p_id uuid,p_recipient uuid,p_event text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $payment$
SELECT public.payment_can_view_v1(p_type,p_id,p_recipient) AND EXISTS(SELECT 1 FROM public.payment_rows_v1()r WHERE r.request_type=p_type AND r.id=p_id AND CASE
 WHEN p_event IN('PAYMENT_CONFIRMATION_REQUESTED','PAYMENT_REQUEST_REQUESTED') THEN r.status='REQUESTED' AND r.handler_id=p_recipient
 WHEN p_event IN('PAYMENT_CONFIRMATION_CANCELLED','PAYMENT_REQUEST_CANCELLED') THEN p_event=CASE r.request_type WHEN 'PAYMENT_CONFIRMATION_REQUEST' THEN 'PAYMENT_CONFIRMATION_CANCELLED' ELSE 'PAYMENT_REQUEST_CANCELLED' END AND r.status='CANCELLED' AND NOT (r.data->>'administrative_cancelled')::boolean AND r.handler_id=p_recipient
 WHEN p_event IN('PAYMENT_CONFIRMATION_ADMIN_CANCELLED','PAYMENT_REQUEST_ADMIN_CANCELLED') THEN p_event=CASE r.request_type WHEN 'PAYMENT_CONFIRMATION_REQUEST' THEN 'PAYMENT_CONFIRMATION_ADMIN_CANCELLED' ELSE 'PAYMENT_REQUEST_ADMIN_CANCELLED' END AND r.status='CANCELLED' AND (r.data->>'administrative_cancelled')::boolean AND r.requester_id=p_recipient
 WHEN p_event='PAYMENT_CONFIRMATION_CONFIRMED' THEN r.request_type='PAYMENT_CONFIRMATION_REQUEST' AND r.status='CONFIRMED' AND r.requester_id=p_recipient
 WHEN p_event='PAYMENT_CONFIRMATION_NOT_FOUND' THEN r.request_type='PAYMENT_CONFIRMATION_REQUEST' AND r.status='NOT_FOUND' AND r.requester_id=p_recipient
 WHEN p_event='PAYMENT_REQUEST_COMPLETED' THEN r.request_type='PAYMENT_REQUEST' AND r.status='COMPLETED' AND r.requester_id=p_recipient
 WHEN p_event='PAYMENT_REQUEST_REJECTED' THEN r.request_type='PAYMENT_REQUEST' AND r.status='REJECTED' AND r.requester_id=p_recipient ELSE false END);
$payment$;

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
 AND (n.category NOT IN('PAYMENT_CONFIRMATION_REQUEST','PAYMENT_REQUEST') OR public.payment_push_valid_v1(n.category,n.deep_link_id,n.recipient_id,e.event_type))
 AND p.is_active AND p.account_status='active' AND n.revoked_at IS NULL AND (n.expires_at IS NULL OR n.expires_at>now()))
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
 SELECT count(*) FILTER(WHERE n.read_at IS NULL),count(*) FILTER(WHERE a.ack_required AND n.acknowledged_at IS NULL) INTO v_count,v_ack FROM public.notifications n LEFT JOIN public.announcements a ON a.id=n.announcement_id WHERE n.recipient_id=auth.uid() AND (n.category<>'TASK_REQUEST' OR (public.is_active_operation_member() AND EXISTS(SELECT 1 FROM public.notification_task_config WHERE singleton AND task_request_enabled))) AND (n.category NOT IN('PAYMENT_CONFIRMATION_REQUEST','PAYMENT_REQUEST') OR public.payment_can_view_v1(n.category,n.deep_link_id,auth.uid())) AND n.revoked_at IS NULL AND (n.expires_at IS NULL OR n.expires_at>now());
 SELECT coalesce(jsonb_agg(x ORDER BY x.created_at DESC,x.id DESC),'[]') INTO v_rows FROM (
 SELECT n.*,coalesce(a.ack_required,false) ack_required,coalesce(a.priority,'NORMAL') priority FROM public.notifications n LEFT JOIN public.announcements a ON a.id=n.announcement_id WHERE n.recipient_id=auth.uid() AND (n.category<>'TASK_REQUEST' OR (public.is_active_operation_member() AND EXISTS(SELECT 1 FROM public.notification_task_config WHERE singleton AND task_request_enabled))) AND (n.category NOT IN('PAYMENT_CONFIRMATION_REQUEST','PAYMENT_REQUEST') OR public.payment_can_view_v1(n.category,n.deep_link_id,auth.uid())) AND n.revoked_at IS NULL AND (n.expires_at IS NULL OR n.expires_at>now()) AND (NOT p_unread_only OR n.read_at IS NULL) ORDER BY n.created_at DESC,n.id DESC LIMIT 50 OFFSET p_offset) x;
 SELECT coalesce(jsonb_agg(x ORDER BY x.created_at DESC,x.id DESC),'[]') INTO v_popup FROM (
 SELECT n.*,a.ack_required,a.priority FROM public.notifications n JOIN public.announcements a ON a.id=n.announcement_id WHERE n.recipient_id=auth.uid() AND (n.category<>'TASK_REQUEST' OR (public.is_active_operation_member() AND EXISTS(SELECT 1 FROM public.notification_task_config WHERE singleton AND task_request_enabled))) AND (n.category NOT IN('PAYMENT_CONFIRMATION_REQUEST','PAYMENT_REQUEST') OR public.payment_can_view_v1(n.category,n.deep_link_id,auth.uid())) AND n.revoked_at IS NULL AND (n.expires_at IS NULL OR n.expires_at>now()) AND ((a.ack_required AND n.acknowledged_at IS NULL) OR (NOT a.ack_required AND n.popup_presented_at IS NULL AND n.read_at IS NULL)) ORDER BY n.created_at DESC,n.id DESC LIMIT 20) x;
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
 SELECT to_jsonb(x) INTO result FROM (SELECT n.*,coalesce(a.ack_required,false) ack_required,coalesce(a.priority,'NORMAL') priority FROM public.notifications n LEFT JOIN public.announcements a ON a.id=n.announcement_id WHERE n.id=p_notification_id AND n.recipient_id=auth.uid() AND (n.category<>'TASK_REQUEST' OR (public.is_active_operation_member() AND EXISTS(SELECT 1 FROM public.notification_task_config WHERE singleton AND task_request_enabled))) AND (n.category NOT IN('PAYMENT_CONFIRMATION_REQUEST','PAYMENT_REQUEST') OR public.payment_can_view_v1(n.category,n.deep_link_id,auth.uid())) AND n.revoked_at IS NULL AND (n.expires_at IS NULL OR n.expires_at>now())) x;
 RETURN result;
END $function$
;

CREATE FUNCTION public.get_request_hub_v1(p_scope text DEFAULT 'inbox',p_type text DEFAULT 'ALL',p_filter text DEFAULT 'active',p_offset integer DEFAULT 0) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $payment$
DECLARE result jsonb; BEGIN
 IF NOT public.is_active_operation_member() THEN RAISE EXCEPTION 'PAYMENT_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF p_scope IS NULL OR p_scope NOT IN('inbox','sent','all') OR p_type IS NULL OR p_type NOT IN('ALL','TASK_REQUEST','PAYMENT_CONFIRMATION_REQUEST','PAYMENT_REQUEST') OR p_filter IS NULL OR p_filter NOT IN('active','done','all') OR p_offset IS NULL OR p_offset NOT BETWEEN 0 AND 100000 THEN RAISE EXCEPTION 'INVALID_PAGE' USING ERRCODE='22023'; END IF;
 WITH permitted AS (
 SELECT r.request_type,r.id,r.display_title,r.status,CASE WHEN r.status IN('REQUESTED','ACKNOWLEDGED') THEN 'OPEN' ELSE 'CLOSED' END lifecycle,r.created_at,r.due_at,(SELECT name FROM public.profiles WHERE id=CASE WHEN p_scope='sent' THEN r.handler_id ELSE r.requester_id END) counterparty,r.status IN('REQUESTED','ACKNOWLEDGED') AND NOT public.payment_has_capability_v1(r.handler_id,CASE r.request_type WHEN 'PAYMENT_CONFIRMATION_REQUEST' THEN 'PAYMENT_CONFIRMATION_REVIEW' ELSE 'PAYMENT_REQUEST_PROCESS' END) handler_unavailable,(r.data->>'administrative_cancelled')::boolean administrative_cancelled
 FROM public.payment_rows_v1()r WHERE (p_type='ALL' OR p_type=r.request_type) AND public.payment_can_view_v1(r.request_type,r.id,auth.uid()) AND ((p_scope='inbox' AND r.handler_id=auth.uid()) OR (p_scope='sent' AND r.requester_id=auth.uid()) OR (p_scope='all' AND public.payment_has_capability_v1(auth.uid(),'PAYMENT_REQUESTS_VIEW_ALL')))
 UNION ALL
 SELECT 'TASK_REQUEST',r.id,r.title,CASE WHEN r.cancelled_at IS NOT NULL THEN 'CANCELLED' WHEN s.complete THEN 'COMPLETED' ELSE 'REQUESTED' END,CASE WHEN r.cancelled_at IS NOT NULL OR s.complete THEN 'CLOSED' ELSE 'OPEN' END,r.created_at,r.due_at,CASE WHEN p_scope='sent' THEN (SELECT CASE WHEN count(*)=1 THEN min(p.name) ELSE count(*)::text||'명' END FROM public.task_request_targets t JOIN public.profiles p ON p.id=t.recipient_id WHERE t.task_request_id=r.id) ELSE (SELECT name FROM public.profiles WHERE id=r.requester_id) END,false,false
 FROM public.task_requests r CROSS JOIN LATERAL(SELECT bool_and(t.completed_at IS NOT NULL) complete FROM public.task_request_targets t WHERE t.task_request_id=r.id AND (p_scope<>'inbox' OR t.recipient_id=auth.uid()))s
 WHERE p_type IN('ALL','TASK_REQUEST') AND EXISTS(SELECT 1 FROM public.notification_task_config WHERE singleton AND task_request_enabled) AND ((p_scope='inbox' AND EXISTS(SELECT 1 FROM public.task_request_targets WHERE task_request_id=r.id AND recipient_id=auth.uid())) OR (p_scope='sent' AND r.requester_id=auth.uid()) OR (p_scope='all' AND public.has_operation_role(ARRAY['owner'])))
 ), filtered AS(SELECT * FROM permitted WHERE p_filter='all' OR (p_filter='active' AND lifecycle='OPEN') OR (p_filter='done' AND lifecycle='CLOSED'))
 SELECT jsonb_build_object('count',(SELECT count(*) FROM filtered),'items',coalesce((SELECT jsonb_agg(to_jsonb(q)) FROM (SELECT * FROM filtered ORDER BY (lifecycle='OPEN') DESC,due_at ASC NULLS LAST,created_at DESC,id LIMIT 50 OFFSET p_offset)q),'[]')) INTO result; RETURN result; END;
$payment$;

DO $acl$ DECLARE r record; BEGIN
 FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN('payment_request_config','payment_confirmation_requests','payment_requests','payment_request_audit_events','payment_request_command_receipts') LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',r.tablename); EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC,anon,authenticated,service_role',r.tablename); END LOOP;
 FOR r IN SELECT oid::regprocedure signature,proname FROM pg_proc WHERE pronamespace='public'::regnamespace AND (proname LIKE 'payment_%_v1' OR proname LIKE '%payment_request%_v1' OR proname LIKE '%payment_confirmation%_v1' OR proname='get_request_hub_v1') LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',r.signature);
 IF r.proname NOT LIKE 'payment_%' THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',r.signature); END IF; END LOOP;
END $acl$;
COMMIT;
