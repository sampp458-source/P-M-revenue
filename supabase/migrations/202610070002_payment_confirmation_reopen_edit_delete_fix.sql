-- Confirmation workflow only. Existing rows are not rewritten. Sources stay OFF until release approval.
BEGIN;
DO $guard$ BEGIN
IF md5(pg_get_functiondef('payment_rows_v1()'::regprocedure)) <> 'e3536ba4236bae1470ae4622914d520e' THEN RAISE EXCEPTION 'CONFIRMATION_PREDECESSOR_MISMATCH: payment_rows_v1'; END IF;
IF md5(pg_get_functiondef('payment_can_admin_close_v1(text,uuid)'::regprocedure)) <> 'bf054c0f7a643a415d2f7f266dd09588' THEN RAISE EXCEPTION 'CONFIRMATION_PREDECESSOR_MISMATCH: payment_can_admin_close_v1'; END IF;
IF md5(pg_get_functiondef('get_payment_request_detail_v1(text,uuid)'::regprocedure)) <> 'bda1f68c270f165c1b0e73e01699dbb4' THEN RAISE EXCEPTION 'CONFIRMATION_PREDECESSOR_MISMATCH: get_payment_request_detail_v1'; END IF;
IF md5(pg_get_functiondef('payment_emit_v1(text,uuid,uuid,text)'::regprocedure)) <> 'c863e5cdb86a81c455415ccaf2e962e0' THEN RAISE EXCEPTION 'CONFIRMATION_PREDECESSOR_MISMATCH: payment_emit_v1'; END IF;
IF md5(pg_get_functiondef('payment_command_v1(text,uuid,text,jsonb,bigint,uuid)'::regprocedure)) <> '2ed2e4f0bf162c7d41e44a883166d968' THEN RAISE EXCEPTION 'CONFIRMATION_PREDECESSOR_MISMATCH: payment_command_v1'; END IF;
IF md5(pg_get_functiondef('payment_push_valid_v1(text,uuid,uuid,text)'::regprocedure)) <> 'a36b9e6f7f14d02957e8a9401f72a57f' THEN RAISE EXCEPTION 'CONFIRMATION_PREDECESSOR_MISMATCH: payment_push_valid_v1'; END IF;
IF md5(pg_get_functiondef('get_request_hub_v1(text,text,text,integer)'::regprocedure)) <> '30fa12a4eb61220aa4489d70628c6759' THEN RAISE EXCEPTION 'CONFIRMATION_PREDECESSOR_MISMATCH: get_request_hub_v1'; END IF;
IF md5(pg_get_functiondef('set_payment_request_capability_v1(uuid,text,boolean,bigint,uuid)'::regprocedure)) <> 'b87d0a143510a93a4121bf886ed4ee7d' THEN RAISE EXCEPTION 'CONFIRMATION_PREDECESSOR_MISMATCH: set_payment_request_capability_v1'; END IF;
IF md5((SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='public.payment_request_audit_events'::regclass AND conname='payment_request_audit_events_action_check')) IS DISTINCT FROM '72481c007f868743d6a99958c8eb6b70' THEN RAISE EXCEPTION 'CONFIRMATION_AUDIT_CHECK_MISMATCH'; END IF;
 IF EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.payment_confirmation_requests'::regclass AND attname IN('deleted_at','deleted_by') AND NOT attisdropped) OR to_regprocedure('public.update_payment_confirmation_request_v1(uuid,bigint,jsonb,uuid)') IS NOT NULL OR to_regprocedure('public.delete_payment_confirmation_request_v1(uuid,bigint,jsonb,uuid)') IS NOT NULL THEN RAISE EXCEPTION 'CONFIRMATION_OBJECT_ALREADY_EXISTS'; END IF;
END $guard$;
ALTER TABLE public.payment_confirmation_requests ADD COLUMN deleted_at timestamptz, ADD COLUMN deleted_by uuid REFERENCES public.profiles;
ALTER TABLE public.payment_confirmation_requests ADD CONSTRAINT confirmation_tombstone_consistent CHECK ((deleted_at IS NULL)=(deleted_by IS NULL) AND (deleted_at IS NULL OR status='CANCELLED'));
ALTER TABLE public.payment_request_audit_events DROP CONSTRAINT payment_request_audit_events_action_check;
ALTER TABLE public.payment_request_audit_events ADD CONSTRAINT payment_request_audit_events_action_check CHECK(action IN('CONFIRMATION_CREATED','CONFIRMATION_CONFIRMED','CONFIRMATION_NOT_FOUND','CONFIRMATION_CANCELLED','PAYMENT_CREATED','PAYMENT_ACKNOWLEDGED','PAYMENT_COMPLETED','PAYMENT_REJECTED','PAYMENT_CANCELLED','CONFIRMATION_ADMIN_CANCELLED','PAYMENT_ADMIN_CANCELLED','CONFIRMATION_UPDATED','CONFIRMATION_DELETED'));

CREATE OR REPLACE FUNCTION public.payment_rows_v1() RETURNS TABLE(request_type text,id uuid,requester_id uuid,handler_id uuid,display_title text,status text,created_at timestamptz,due_at timestamptz,version bigint,data jsonb) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $payment$
SELECT 'PAYMENT_CONFIRMATION_REQUEST'::text,r.id,r.requester_id,r.reviewer_id,r.payer_name||' · 입금 확인',r.status,r.created_at,NULL::timestamptz,r.version,to_jsonb(r)-'payload_hash'-'request_id' FROM public.payment_confirmation_requests r WHERE r.deleted_at IS NULL
 UNION ALL SELECT 'PAYMENT_REQUEST',r.id,r.requester_id,r.processor_id,r.title,r.status,r.created_at,r.due_at,r.version,to_jsonb(r)-'payload_hash'-'request_id' FROM public.payment_requests r;
$payment$;

CREATE OR REPLACE FUNCTION public.payment_can_admin_close_v1(p_type text,p_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $payment$
SELECT public.is_admin() AND public.payment_has_capability_v1(auth.uid(),'PAYMENT_REQUESTS_VIEW_ALL') AND public.payment_enabled_v1(p_type) AND EXISTS(SELECT 1 FROM public.payment_rows_v1()r WHERE r.request_type=p_type AND r.id=p_id AND (r.status IN('REQUESTED','ACKNOWLEDGED') OR (r.request_type='PAYMENT_CONFIRMATION_REQUEST' AND r.status='NOT_FOUND')) AND NOT public.payment_has_capability_v1(r.handler_id,CASE p_type WHEN 'PAYMENT_CONFIRMATION_REQUEST' THEN 'PAYMENT_CONFIRMATION_REVIEW' ELSE 'PAYMENT_REQUEST_PROCESS' END));
$payment$;

CREATE OR REPLACE FUNCTION public.get_payment_request_detail_v1(p_type text,p_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $payment$
DECLARE r record; BEGIN
 IF NOT public.payment_can_view_v1(p_type,p_id,auth.uid()) THEN RAISE EXCEPTION 'PAYMENT_NOT_FOUND' USING ERRCODE='P0002'; END IF;
 SELECT * INTO r FROM public.payment_rows_v1() WHERE request_type=p_type AND id=p_id;
 RETURN r.data||jsonb_build_object('request_type',p_type,'requester_name',(SELECT name FROM public.profiles WHERE id=r.requester_id),'handler_name',(SELECT name FROM public.profiles WHERE id=r.handler_id),'can_process',r.handler_id=auth.uid() AND public.payment_has_capability_v1(auth.uid(),CASE p_type WHEN 'PAYMENT_CONFIRMATION_REQUEST' THEN 'PAYMENT_CONFIRMATION_REVIEW' ELSE 'PAYMENT_REQUEST_PROCESS' END),'can_cancel',r.requester_id=auth.uid() AND (r.status='REQUESTED' OR (p_type='PAYMENT_CONFIRMATION_REQUEST' AND r.status='NOT_FOUND')),'handler_unavailable',(r.status IN('REQUESTED','ACKNOWLEDGED') OR (r.request_type='PAYMENT_CONFIRMATION_REQUEST' AND r.status='NOT_FOUND')) AND NOT public.payment_has_capability_v1(r.handler_id,CASE p_type WHEN 'PAYMENT_CONFIRMATION_REQUEST' THEN 'PAYMENT_CONFIRMATION_REVIEW' ELSE 'PAYMENT_REQUEST_PROCESS' END),'can_edit',p_type='PAYMENT_CONFIRMATION_REQUEST' AND r.requester_id=auth.uid() AND r.status IN('REQUESTED','NOT_FOUND'),'can_delete',p_type='PAYMENT_CONFIRMATION_REQUEST' AND r.requester_id=auth.uid() AND r.status IN('REQUESTED','NOT_FOUND'),'can_admin_close',public.payment_can_admin_close_v1(p_type,p_id)); END;
$payment$;

CREATE OR REPLACE FUNCTION public.payment_emit_v1(p_type text,p_id uuid,p_recipient uuid,p_event text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $payment$
DECLARE eid uuid; BEGIN
 IF NOT public.payment_can_view_v1(p_type,p_id,p_recipient) THEN RETURN; END IF;
 INSERT INTO public.notification_events(event_type,source_kind,source_id,dedupe_key,payload,state,processed_at)
 VALUES(p_event,'payment_request',p_id,'payment:'||p_type||':'||p_id||':'||p_event||':'||p_recipient||CASE WHEN p_type='PAYMENT_CONFIRMATION_REQUEST' THEN ':'||(SELECT version::text FROM public.payment_confirmation_requests WHERE id=p_id) ELSE '' END,jsonb_build_object('request_type',p_type,'request_id',p_id),'processed',statement_timestamp()) ON CONFLICT(dedupe_key) DO NOTHING RETURNING id INTO eid;
 IF eid IS NULL THEN RETURN; END IF;
 INSERT INTO public.notifications(event_id,recipient_id,category,title,message,deep_link_type,deep_link_id) VALUES(eid,p_recipient,p_type,CASE p_event WHEN 'PAYMENT_CONFIRMATION_UPDATED' THEN '결제 확인 요청이 수정되었습니다.' WHEN 'PAYMENT_CONFIRMATION_NOT_FOUND' THEN '입금이 아직 확인되지 않았습니다.' WHEN 'PAYMENT_CONFIRMATION_CONFIRMED' THEN '입금이 확인되었습니다.' WHEN 'PAYMENT_CONFIRMATION_REQUESTED' THEN '새 결제 확인 요청이 있습니다.' WHEN 'PAYMENT_REQUEST_REQUESTED' THEN '새 지급 요청이 있습니다.' WHEN 'PAYMENT_REQUEST_COMPLETED' THEN '요청한 지급이 완료되었습니다.' WHEN 'PAYMENT_REQUEST_REJECTED' THEN '지급 요청이 반려되었습니다.' WHEN 'PAYMENT_CONFIRMATION_CANCELLED' THEN '요청이 취소되었습니다.' WHEN 'PAYMENT_REQUEST_CANCELLED' THEN '요청이 취소되었습니다.' WHEN 'PAYMENT_CONFIRMATION_ADMIN_CANCELLED' THEN '결제 확인 요청이 관리 종료되었습니다.' WHEN 'PAYMENT_REQUEST_ADMIN_CANCELLED' THEN '지급 요청이 관리 종료되었습니다.' ELSE '결제 확인 요청이 처리되었습니다.' END,CASE p_event WHEN 'PAYMENT_CONFIRMATION_ADMIN_CANCELLED' THEN '입금 여부는 별도로 확인해 주세요.' WHEN 'PAYMENT_REQUEST_ADMIN_CANCELLED' THEN '외부 지급 여부는 별도로 확인해 주세요.' ELSE '요청 상세에서 확인해 주세요.' END,p_type,p_id); END;
$payment$;

CREATE OR REPLACE FUNCTION public.payment_command_v1(p_type text,p_id uuid,p_action text,p_payload jsonb,p_expected_version bigint,p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $payment$
#variable_conflict use_variable
DECLARE r record; previous_data jsonb:='{}'; prior public.payment_request_command_receipts; h text; handler uuid; requester uuid; rid uuid:=p_id; prev text; next text; result jsonb; ver bigint; at timestamptz; ev text; note text:=nullif(btrim(p_payload->>'note'),''); required_cap text;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('payment-domain-write-v1',0));
 IF p_type IS NULL OR p_type NOT IN('PAYMENT_CONFIRMATION_REQUEST','PAYMENT_REQUEST') OR p_action IS NULL OR p_action NOT IN('CREATE','CONFIRMED','NOT_FOUND','CANCELLED','ACKNOWLEDGED','COMPLETED','REJECTED','ADMIN_CANCELLED','UPDATED','DELETED') OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' OR p_request_id IS NULL OR p_expected_version IS NULL THEN RAISE EXCEPTION 'INVALID_PAYMENT_INPUT' USING ERRCODE='22023'; END IF;
 IF p_action IN('UPDATED','DELETED') AND p_type<>'PAYMENT_CONFIRMATION_REQUEST' THEN RAISE EXCEPTION 'INVALID_PAYMENT_INPUT' USING ERRCODE='22023'; END IF;
 IF NOT public.is_active_operation_member() OR (p_action='ADMIN_CANCELLED' AND (NOT public.is_admin() OR NOT public.payment_has_capability_v1(auth.uid(),'PAYMENT_REQUESTS_VIEW_ALL'))) THEN RAISE EXCEPTION 'PAYMENT_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF NOT public.payment_enabled_v1(p_type) THEN RAISE EXCEPTION 'PAYMENT_DISABLED' USING ERRCODE='55000'; END IF;
 h:=md5(jsonb_build_object('type',p_type,'id',p_id,'action',p_action,'payload',p_payload,'version',p_expected_version)::text);
 SELECT * INTO prior FROM public.payment_request_command_receipts WHERE actor_id=auth.uid() AND request_id=p_request_id;
 IF FOUND THEN IF prior.payload_hash<>h THEN RAISE EXCEPTION 'REQUEST_ID_PAYLOAD_MISMATCH' USING ERRCODE='22023'; END IF; RETURN prior.result; END IF;
 IF p_action NOT IN('CREATE','UPDATED') AND length(note)>1000 THEN RAISE EXCEPTION 'INVALID_PAYMENT_INPUT' USING ERRCODE='22023'; END IF;
 IF p_action='CREATE' THEN
  IF p_id IS NOT NULL OR p_expected_version<>0 THEN RAISE EXCEPTION 'PAYMENT_VERSION_CONFLICT' USING ERRCODE='40001'; END IF;
  required_cap:=CASE p_type WHEN 'PAYMENT_CONFIRMATION_REQUEST' THEN 'PAYMENT_CONFIRMATION_REQUEST_CREATE' ELSE 'PAYMENT_REQUEST_CREATE' END;
  handler:=(p_payload->>'handler_id')::uuid; requester:=auth.uid();
 ELSE
  IF p_type='PAYMENT_CONFIRMATION_REQUEST' THEN PERFORM 1 FROM public.payment_confirmation_requests WHERE id=p_id FOR UPDATE; ELSE PERFORM 1 FROM public.payment_requests WHERE id=p_id FOR UPDATE; END IF;
  SELECT * INTO r FROM public.payment_rows_v1() WHERE request_type=p_type AND id=p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'PAYMENT_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  previous_data:=r.data; handler:=r.handler_id; requester:=r.requester_id; prev:=r.status;
  IF p_action='ADMIN_CANCELLED' THEN NULL;
  ELSIF p_action IN('CANCELLED','UPDATED','DELETED') THEN IF auth.uid()<>r.requester_id THEN RAISE EXCEPTION 'PAYMENT_FORBIDDEN' USING ERRCODE='42501'; END IF;
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
  IF (p_payload-CASE WHEN p_action='UPDATED' THEN ARRAY['payer_name','reported_amount','dog_name','note'] ELSE ARRAY['note'] END)<>'{}'::jsonb THEN RAISE EXCEPTION 'INVALID_PAYMENT_INPUT' USING ERRCODE='22023'; END IF;
  IF NOT ((p_action='ADMIN_CANCELLED' AND (prev IN('REQUESTED','ACKNOWLEDGED') OR (p_type='PAYMENT_CONFIRMATION_REQUEST' AND prev='NOT_FOUND'))) OR (p_action='CANCELLED' AND (prev='REQUESTED' OR (p_type='PAYMENT_CONFIRMATION_REQUEST' AND prev='NOT_FOUND'))) OR (p_type='PAYMENT_CONFIRMATION_REQUEST' AND ((p_action IN('CONFIRMED','NOT_FOUND') AND prev='REQUESTED') OR (p_action='CONFIRMED' AND prev='NOT_FOUND') OR (p_action IN('UPDATED','DELETED') AND prev IN('REQUESTED','NOT_FOUND')))) OR (p_type='PAYMENT_REQUEST' AND ((p_action='ACKNOWLEDGED' AND prev='REQUESTED') OR (p_action='COMPLETED' AND prev='ACKNOWLEDGED') OR (p_action='REJECTED' AND prev IN('REQUESTED','ACKNOWLEDGED'))))) THEN RAISE EXCEPTION 'PAYMENT_INVALID_TRANSITION' USING ERRCODE='22023'; END IF;
  IF p_action IN('CANCELLED','REJECTED','ADMIN_CANCELLED') AND note IS NULL THEN RAISE EXCEPTION 'PAYMENT_REASON_REQUIRED' USING ERRCODE='22023'; END IF;
  IF p_action='DELETED' THEN note:='요청자 삭제'; END IF;
  next:=CASE WHEN p_action IN('ADMIN_CANCELLED','DELETED') THEN 'CANCELLED' WHEN p_action='UPDATED' THEN 'REQUESTED' ELSE p_action END; ver:=r.version+1;
  IF p_type='PAYMENT_CONFIRMATION_REQUEST' THEN UPDATE public.payment_confirmation_requests SET payer_name=CASE WHEN p_action='UPDATED' THEN btrim(p_payload->>'payer_name') ELSE payer_name END,reported_amount=CASE WHEN p_action='UPDATED' THEN (p_payload->>'reported_amount')::bigint ELSE reported_amount END,dog_name=CASE WHEN p_action='UPDATED' THEN nullif(btrim(p_payload->>'dog_name'),'') ELSE dog_name END,note=CASE WHEN p_action='UPDATED' THEN nullif(btrim(p_payload->>'note'),'') ELSE payment_confirmation_requests.note END,deleted_at=CASE WHEN p_action='DELETED' THEN at END,deleted_by=CASE WHEN p_action='DELETED' THEN auth.uid() END,administrative_cancelled=(p_action='ADMIN_CANCELLED'),status=next,version=ver,updated_at=at,resolved_at=CASE WHEN next IN('CONFIRMED','NOT_FOUND') THEN at END,resolved_by=CASE WHEN next IN('CONFIRMED','NOT_FOUND') THEN auth.uid() END,resolution_note=CASE WHEN next IN('CONFIRMED','NOT_FOUND') THEN note END,cancelled_at=CASE WHEN next='CANCELLED' THEN at END,cancelled_by=CASE WHEN next='CANCELLED' THEN auth.uid() END,cancel_reason=CASE WHEN next='CANCELLED' THEN note END WHERE id=rid;
  ELSE UPDATE public.payment_requests SET administrative_cancelled=(p_action='ADMIN_CANCELLED'),status=next,version=ver,updated_at=at,acknowledged_at=CASE WHEN next='ACKNOWLEDGED' THEN at ELSE acknowledged_at END,completed_at=CASE WHEN next='COMPLETED' THEN at END,completion_note=CASE WHEN next='COMPLETED' THEN note END,rejected_at=CASE WHEN next='REJECTED' THEN at END,rejected_by=CASE WHEN next='REJECTED' THEN auth.uid() END,rejection_reason=CASE WHEN next='REJECTED' THEN note END,cancelled_at=CASE WHEN next='CANCELLED' THEN at END,cancelled_by=CASE WHEN next='CANCELLED' THEN auth.uid() END,cancel_reason=CASE WHEN next='CANCELLED' THEN note END WHERE id=rid; END IF;
 END IF;
 result:=jsonb_build_object('id',rid,'version',ver,'status',next);
 INSERT INTO public.payment_request_command_receipts(actor_id,request_id,command,payload_hash,confirmation_id,payment_id,result) VALUES(auth.uid(),p_request_id,p_action,h,CASE WHEN p_type='PAYMENT_CONFIRMATION_REQUEST' THEN rid END,CASE WHEN p_type='PAYMENT_REQUEST' THEN rid END,result);
 INSERT INTO public.payment_request_audit_events(confirmation_id,payment_id,actor_id,action,request_id,from_status,to_status,version,metadata) VALUES(CASE WHEN p_type='PAYMENT_CONFIRMATION_REQUEST' THEN rid END,CASE WHEN p_type='PAYMENT_REQUEST' THEN rid END,auth.uid(),CASE p_type WHEN 'PAYMENT_CONFIRMATION_REQUEST' THEN 'CONFIRMATION_' ELSE 'PAYMENT_' END||CASE WHEN p_action='CREATE' THEN 'CREATED' WHEN p_action='ADMIN_CANCELLED' THEN 'ADMIN_CANCELLED' WHEN p_action IN('UPDATED','DELETED') THEN p_action ELSE next END,p_request_id,prev,next,ver,jsonb_build_object('note_present',note IS NOT NULL)||CASE WHEN p_action='UPDATED' THEN jsonb_build_object('status_reset',prev='NOT_FOUND','changed_fields',ARRAY(SELECT k FROM unnest(ARRAY['payer_name','reported_amount','dog_name','note'])k WHERE previous_data->k IS DISTINCT FROM (SELECT to_jsonb(c)->k FROM public.payment_confirmation_requests c WHERE id=rid))) ELSE '{}'::jsonb END||CASE WHEN p_action='ADMIN_CANCELLED' THEN jsonb_build_object('administrative',true) ELSE '{}'::jsonb END);
 IF p_action='DELETED' THEN
  UPDATE public.notifications SET revoked_at=at WHERE deep_link_type=p_type AND deep_link_id=rid AND revoked_at IS NULL;
 END IF;
 IF p_action NOT IN('ACKNOWLEDGED','DELETED') THEN
  ev:=CASE p_type WHEN 'PAYMENT_CONFIRMATION_REQUEST' THEN 'PAYMENT_CONFIRMATION_' ELSE 'PAYMENT_REQUEST_' END||CASE WHEN p_action='CREATE' THEN 'REQUESTED' WHEN p_action='ADMIN_CANCELLED' THEN 'ADMIN_CANCELLED' WHEN p_action IN('UPDATED','DELETED') THEN p_action ELSE next END;
  PERFORM public.payment_emit_v1(p_type,rid,CASE WHEN p_action IN('CREATE','CANCELLED','UPDATED') THEN handler ELSE requester END,ev);
 END IF;
 PERFORM public.payment_revision_v1(requester,handler);
 RETURN result; END;
$payment$;

CREATE OR REPLACE FUNCTION public.payment_push_valid_v1(p_type text,p_id uuid,p_recipient uuid,p_event text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $payment$
SELECT public.payment_can_view_v1(p_type,p_id,p_recipient) AND EXISTS(SELECT 1 FROM public.payment_rows_v1()r WHERE r.request_type=p_type AND r.id=p_id AND CASE
 WHEN p_event='PAYMENT_CONFIRMATION_UPDATED' THEN r.request_type='PAYMENT_CONFIRMATION_REQUEST' AND r.status='REQUESTED' AND r.handler_id=p_recipient
 WHEN p_event IN('PAYMENT_CONFIRMATION_REQUESTED','PAYMENT_REQUEST_REQUESTED') THEN r.status='REQUESTED' AND r.handler_id=p_recipient
 WHEN p_event IN('PAYMENT_CONFIRMATION_CANCELLED','PAYMENT_REQUEST_CANCELLED') THEN p_event=CASE r.request_type WHEN 'PAYMENT_CONFIRMATION_REQUEST' THEN 'PAYMENT_CONFIRMATION_CANCELLED' ELSE 'PAYMENT_REQUEST_CANCELLED' END AND r.status='CANCELLED' AND NOT (r.data->>'administrative_cancelled')::boolean AND r.handler_id=p_recipient
 WHEN p_event IN('PAYMENT_CONFIRMATION_ADMIN_CANCELLED','PAYMENT_REQUEST_ADMIN_CANCELLED') THEN p_event=CASE r.request_type WHEN 'PAYMENT_CONFIRMATION_REQUEST' THEN 'PAYMENT_CONFIRMATION_ADMIN_CANCELLED' ELSE 'PAYMENT_REQUEST_ADMIN_CANCELLED' END AND r.status='CANCELLED' AND (r.data->>'administrative_cancelled')::boolean AND r.requester_id=p_recipient
 WHEN p_event='PAYMENT_CONFIRMATION_CONFIRMED' THEN r.request_type='PAYMENT_CONFIRMATION_REQUEST' AND r.status='CONFIRMED' AND r.requester_id=p_recipient
 WHEN p_event='PAYMENT_CONFIRMATION_NOT_FOUND' THEN r.request_type='PAYMENT_CONFIRMATION_REQUEST' AND r.status='NOT_FOUND' AND r.requester_id=p_recipient
 WHEN p_event='PAYMENT_REQUEST_COMPLETED' THEN r.request_type='PAYMENT_REQUEST' AND r.status='COMPLETED' AND r.requester_id=p_recipient
 WHEN p_event='PAYMENT_REQUEST_REJECTED' THEN r.request_type='PAYMENT_REQUEST' AND r.status='REJECTED' AND r.requester_id=p_recipient ELSE false END);
$payment$;

CREATE OR REPLACE FUNCTION public.get_request_hub_v1(p_scope text DEFAULT 'inbox',p_type text DEFAULT 'ALL',p_filter text DEFAULT 'active',p_offset integer DEFAULT 0) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $payment$
DECLARE result jsonb; BEGIN
 IF NOT public.is_active_operation_member() THEN RAISE EXCEPTION 'PAYMENT_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF p_scope IS NULL OR p_scope NOT IN('inbox','sent','all') OR p_type IS NULL OR p_type NOT IN('ALL','TASK_REQUEST','PAYMENT_CONFIRMATION_REQUEST','PAYMENT_REQUEST') OR p_filter IS NULL OR p_filter NOT IN('active','done','all') OR p_offset IS NULL OR p_offset NOT BETWEEN 0 AND 100000 THEN RAISE EXCEPTION 'INVALID_PAGE' USING ERRCODE='22023'; END IF;
 WITH permitted AS (
 SELECT r.request_type,r.id,r.display_title,r.status,CASE WHEN (r.status IN('REQUESTED','ACKNOWLEDGED') OR (r.request_type='PAYMENT_CONFIRMATION_REQUEST' AND r.status='NOT_FOUND')) THEN 'OPEN' ELSE 'CLOSED' END lifecycle,r.created_at,r.due_at,(SELECT name FROM public.profiles WHERE id=CASE WHEN p_scope='sent' THEN r.handler_id ELSE r.requester_id END) counterparty,(r.status IN('REQUESTED','ACKNOWLEDGED') OR (r.request_type='PAYMENT_CONFIRMATION_REQUEST' AND r.status='NOT_FOUND')) AND NOT public.payment_has_capability_v1(r.handler_id,CASE r.request_type WHEN 'PAYMENT_CONFIRMATION_REQUEST' THEN 'PAYMENT_CONFIRMATION_REVIEW' ELSE 'PAYMENT_REQUEST_PROCESS' END) handler_unavailable,(r.data->>'administrative_cancelled')::boolean administrative_cancelled
 FROM public.payment_rows_v1()r WHERE (p_type='ALL' OR p_type=r.request_type) AND public.payment_can_view_v1(r.request_type,r.id,auth.uid()) AND ((p_scope='inbox' AND r.handler_id=auth.uid()) OR (p_scope='sent' AND r.requester_id=auth.uid()) OR (p_scope='all' AND public.payment_has_capability_v1(auth.uid(),'PAYMENT_REQUESTS_VIEW_ALL')))
 UNION ALL
 SELECT 'TASK_REQUEST',r.id,r.title,CASE WHEN r.cancelled_at IS NOT NULL THEN 'CANCELLED' WHEN s.complete THEN 'COMPLETED' ELSE 'REQUESTED' END,CASE WHEN r.cancelled_at IS NOT NULL OR s.complete THEN 'CLOSED' ELSE 'OPEN' END,r.created_at,r.due_at,CASE WHEN p_scope='sent' THEN (SELECT CASE WHEN count(*)=1 THEN min(p.name) ELSE count(*)::text||'명' END FROM public.task_request_targets t JOIN public.profiles p ON p.id=t.recipient_id WHERE t.task_request_id=r.id) ELSE (SELECT name FROM public.profiles WHERE id=r.requester_id) END,false,false
 FROM public.task_requests r CROSS JOIN LATERAL(SELECT bool_and(t.completed_at IS NOT NULL) complete FROM public.task_request_targets t WHERE t.task_request_id=r.id AND (p_scope<>'inbox' OR t.recipient_id=auth.uid()))s
 WHERE p_type IN('ALL','TASK_REQUEST') AND EXISTS(SELECT 1 FROM public.notification_task_config WHERE singleton AND task_request_enabled) AND ((p_scope='inbox' AND EXISTS(SELECT 1 FROM public.task_request_targets WHERE task_request_id=r.id AND recipient_id=auth.uid())) OR (p_scope='sent' AND r.requester_id=auth.uid()) OR (p_scope='all' AND public.has_operation_role(ARRAY['owner'])))
 ), filtered AS(SELECT * FROM permitted WHERE p_filter='all' OR (p_filter='active' AND lifecycle='OPEN') OR (p_filter='done' AND lifecycle='CLOSED'))
 SELECT jsonb_build_object('count',(SELECT count(*) FROM filtered),'items',coalesce((SELECT jsonb_agg(to_jsonb(q)) FROM (SELECT * FROM filtered ORDER BY (lifecycle='OPEN') DESC,due_at ASC NULLS LAST,created_at DESC,id LIMIT 50 OFFSET p_offset)q),'[]')) INTO result; RETURN result; END;
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
 IF old.active AND NOT p_active AND ((p_capability='PAYMENT_CONFIRMATION_REVIEW' AND EXISTS(SELECT 1 FROM public.payment_confirmation_requests WHERE reviewer_id=p_target_id AND status IN('REQUESTED','NOT_FOUND') AND deleted_at IS NULL)) OR (p_capability='PAYMENT_REQUEST_PROCESS' AND EXISTS(SELECT 1 FROM public.payment_requests WHERE processor_id=p_target_id AND status IN('REQUESTED','ACKNOWLEDGED')))) THEN RAISE EXCEPTION 'PAYMENT_CAPABILITY_IN_USE' USING ERRCODE='55000'; END IF;
 IF old.id IS NULL THEN INSERT INTO public.notification_capability_grants(profile_id,capability,active,granted_by,revoked_at) VALUES(p_target_id,p_capability,p_active,auth.uid(),CASE WHEN NOT p_active THEN statement_timestamp() END);
 ELSE UPDATE public.notification_capability_grants SET active=p_active,revoked_at=CASE WHEN NOT p_active THEN statement_timestamp() END,granted_by=CASE WHEN p_active THEN auth.uid() ELSE granted_by END,version=version+1 WHERE id=old.id; END IF;
 INSERT INTO public.entity_audit_events(module_code,entity_type,entity_id,action,changed_by,request_id,after_data,change_reason) VALUES('operations','notification_capability_grants',p_target_id,'updated',auth.uid(),p_request_id,payload,CASE WHEN p_active THEN 'PERMISSION_GRANTED' ELSE 'PERMISSION_REVOKED' END);
END;
$function$
;

CREATE FUNCTION public.update_payment_confirmation_request_v1(p_request_id uuid,p_expected_version bigint,p_payload jsonb,p_id uuid) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $rpc$
 SELECT public.payment_command_v1('PAYMENT_CONFIRMATION_REQUEST',p_id,'UPDATED',p_payload,p_expected_version,p_request_id);
$rpc$;
REVOKE ALL ON FUNCTION public.update_payment_confirmation_request_v1(uuid,bigint,jsonb,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.update_payment_confirmation_request_v1(uuid,bigint,jsonb,uuid) TO authenticated;

CREATE FUNCTION public.delete_payment_confirmation_request_v1(p_request_id uuid,p_expected_version bigint,p_payload jsonb,p_id uuid) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $rpc$
 SELECT public.payment_command_v1('PAYMENT_CONFIRMATION_REQUEST',p_id,'DELETED',p_payload,p_expected_version,p_request_id);
$rpc$;
REVOKE ALL ON FUNCTION public.delete_payment_confirmation_request_v1(uuid,bigint,jsonb,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.delete_payment_confirmation_request_v1(uuid,bigint,jsonb,uuid) TO authenticated;
COMMIT;
