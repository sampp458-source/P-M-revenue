-- Administrator self-test only. No business records, flags, Cron or history writes.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $guard$ BEGIN
 IF to_regclass('public.notification_push_self_tests') IS NOT NULL THEN RAISE EXCEPTION 'SELF_TEST_ALREADY_INSTALLED'; END IF;
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='enqueue_notification_push_v1()'::regprocedure) IS DISTINCT FROM 'b73627a1d91c62adcae47bd83830be26' THEN RAISE EXCEPTION 'SELF_TEST_PREDECESSOR_enqueue_notification_push_v1'; END IF;
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='finish_notification_push_delivery_v1(uuid,uuid,text,integer)'::regprocedure) IS DISTINCT FROM 'e4b08b4ead706db8836c47e3ef6ccaf0' THEN RAISE EXCEPTION 'SELF_TEST_PREDECESSOR_finish_notification_push_delivery_v1'; END IF;
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='get_notification_push_delivery_v1(uuid,uuid)'::regprocedure) IS DISTINCT FROM '8e1d494527b62c2e206b1cb1c4cc79de' THEN RAISE EXCEPTION 'SELF_TEST_PREDECESSOR_get_notification_push_delivery_v1'; END IF;
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='push_delivery_valid_v1(uuid)'::regprocedure) IS DISTINCT FROM '67513f2efe998c2839ec80a198a0c95f' THEN RAISE EXCEPTION 'SELF_TEST_PREDECESSOR_push_delivery_valid_v1'; END IF;
 IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='public.notifications'::regclass AND conname='notifications_deep_link_type_check') IS DISTINCT FROM 'CHECK ((deep_link_type = ANY (ARRAY[''ANNOUNCEMENT''::text, ''SCHEDULE''::text, ''SCHEDULE_DAY''::text, ''TASK_REQUEST''::text, ''PAYMENT_CONFIRMATION_REQUEST''::text, ''PAYMENT_REQUEST''::text])))' THEN RAISE EXCEPTION 'SELF_TEST_LINK_CONTRACT_DRIFT'; END IF;
END $guard$;
ALTER TABLE public.notifications DROP CONSTRAINT notifications_deep_link_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_deep_link_type_check CHECK(deep_link_type IN('ANNOUNCEMENT','SCHEDULE','SCHEDULE_DAY','TASK_REQUEST','PAYMENT_CONFIRMATION_REQUEST','PAYMENT_REQUEST','CENTER'));
CREATE TABLE public.notification_push_self_tests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid NOT NULL REFERENCES public.profiles(id),
 request_id uuid NOT NULL, subscription_id uuid NOT NULL REFERENCES public.push_subscriptions(id), binding_id uuid NOT NULL,
 notification_id uuid NOT NULL UNIQUE REFERENCES public.notifications(id) DEFERRABLE INITIALLY DEFERRED,
 created_at timestamptz NOT NULL DEFAULT statement_timestamp(), UNIQUE(actor_id,request_id)
);
CREATE INDEX notification_push_self_tests_rate ON public.notification_push_self_tests(actor_id,created_at DESC);
CREATE TABLE public.notification_push_self_test_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), test_id uuid NOT NULL REFERENCES public.notification_push_self_tests(id),
 actor_id uuid NOT NULL REFERENCES public.profiles(id), action text NOT NULL CHECK(action IN('REQUESTED','PROCESSING','SENT','FAILED','GONE','CANCELLED')),
 attempt_count integer NOT NULL DEFAULT 0, error_code text, recorded_at timestamptz NOT NULL DEFAULT statement_timestamp()
);
ALTER TABLE public.notification_push_self_tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_push_self_test_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_push_self_tests,public.notification_push_self_test_audit FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.admin_push_self_test_allowed_v1(p_actor uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $allowed$
 SELECT EXISTS(SELECT 1 FROM public.profiles p JOIN public.operation_memberships m ON m.profile_id=p.id
 WHERE p.id=p_actor AND p.role='admin' AND p.is_active AND p.account_status='active' AND m.is_active)
$allowed$;
CREATE FUNCTION public.admin_push_self_test_result_v1(p_test uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $result$
 SELECT jsonb_build_object('request_id',t.request_id,'notification_id',t.notification_id,'delivery_id',d.id,
 'status',d.status,'created_at',t.created_at,'sent_at',d.sent_at,'last_error',d.last_error)
 FROM public.notification_push_self_tests t JOIN public.notification_push_deliveries d ON d.notification_id=t.notification_id AND d.subscription_id=t.subscription_id WHERE t.id=p_test
$result$;
CREATE FUNCTION public.get_admin_push_self_test_v1() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $context$
DECLARE s public.push_subscriptions; total integer; latest_id uuid;
BEGIN
 IF NOT public.admin_push_self_test_allowed_v1(auth.uid()) THEN RETURN jsonb_build_object('allowed',false); END IF;
 SELECT count(*) INTO total FROM public.push_subscriptions WHERE profile_id=auth.uid() AND revoked_at IS NULL AND (expiration_time IS NULL OR expiration_time>now());
 IF total<>1 THEN RETURN jsonb_build_object('allowed',true,'blocked',CASE WHEN total=0 THEN '연결된 알림 기기가 없습니다. 본인 기기에서 알림을 켜주세요.' ELSE '연결된 기기가 여러 개여서 구별할 수 없습니다. 테스트를 중단합니다.' END); END IF;
 SELECT * INTO s FROM public.push_subscriptions WHERE profile_id=auth.uid() AND revoked_at IS NULL AND (expiration_time IS NULL OR expiration_time>now());
 SELECT id INTO latest_id FROM public.notification_push_self_tests WHERE actor_id=auth.uid() ORDER BY created_at DESC LIMIT 1;
 RETURN jsonb_build_object('allowed',true,'subscription',jsonb_build_object('id',s.id,'binding_id',s.binding_id,'last_seen_at',s.last_seen_at,
 'provider',CASE WHEN s.endpoint LIKE 'https://web.push.apple.com/%' THEN 'Apple 기기 (활성 연결 1개)' WHEN s.endpoint LIKE 'https://fcm.googleapis.com/%' THEN 'Google Push 기기 (활성 연결 1개)' ELSE 'Web Push 기기 (활성 연결 1개)' END),'latest',public.admin_push_self_test_result_v1(latest_id));
END $context$;
CREATE FUNCTION public.send_admin_push_self_test_v1(p_request_id uuid,p_subscription_id uuid,p_binding_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $send$
DECLARE actor uuid:=auth.uid(); s public.push_subscriptions; previous public.notification_push_self_tests; tid uuid:=gen_random_uuid(); nid uuid:=gen_random_uuid(); eid uuid; total integer;
BEGIN
 IF NOT public.admin_push_self_test_allowed_v1(actor) THEN RAISE EXCEPTION 'SELF_TEST_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF p_request_id IS NULL OR p_subscription_id IS NULL OR p_binding_id IS NULL THEN RAISE EXCEPTION 'SELF_TEST_INPUT' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('push-self-test:'||actor::text,0));
 SELECT * INTO previous FROM public.notification_push_self_tests WHERE actor_id=actor AND request_id=p_request_id;
 IF FOUND THEN
  IF previous.subscription_id IS DISTINCT FROM p_subscription_id OR previous.binding_id IS DISTINCT FROM p_binding_id THEN RAISE EXCEPTION 'SELF_TEST_REQUEST_MISMATCH' USING ERRCODE='22023'; END IF;
  RETURN public.admin_push_self_test_result_v1(previous.id);
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.notification_push_config WHERE singleton AND enabled) THEN RAISE EXCEPTION 'SELF_TEST_PUSH_DISABLED' USING ERRCODE='22023'; END IF;
 SELECT * INTO s FROM public.push_subscriptions WHERE id=p_subscription_id AND profile_id=actor AND revoked_at IS NULL AND (expiration_time IS NULL OR expiration_time>now()) FOR UPDATE;
 SELECT count(*) INTO total FROM public.push_subscriptions WHERE profile_id=actor AND revoked_at IS NULL AND (expiration_time IS NULL OR expiration_time>now());
 IF s.id IS NULL OR s.binding_id IS DISTINCT FROM p_binding_id OR total<>1 THEN RAISE EXCEPTION 'SELF_TEST_SUBSCRIPTION_CHANGED' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM public.notification_push_self_tests WHERE actor_id=actor AND created_at>statement_timestamp()-interval '5 minutes') OR
 (SELECT count(*) FROM public.notification_push_self_tests WHERE actor_id=actor AND created_at>=date_trunc('day',statement_timestamp() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul')>=3 THEN RAISE EXCEPTION 'SELF_TEST_RATE_LIMIT' USING ERRCODE='22023'; END IF;
 INSERT INTO public.notification_push_self_tests(id,actor_id,request_id,subscription_id,binding_id,notification_id) VALUES(tid,actor,p_request_id,s.id,s.binding_id,nid);
 INSERT INTO public.notification_events(event_type,source_kind,source_id,dedupe_key,payload,state,processed_at)
 VALUES('ADMIN_PUSH_SELF_TEST','push_self_test',tid,'push-self-test:'||tid::text,jsonb_build_object('actor_id',actor,'request_id',p_request_id),'processed',statement_timestamp()) RETURNING id INTO eid;
 INSERT INTO public.notifications(id,event_id,recipient_id,category,title,message,deep_link_type,deep_link_id,expires_at)
 VALUES(nid,eid,actor,'PUSH_SELF_TEST','[테스트 알림] 새 미리보기 확인','P&M OS 알림 표시 테스트입니다. 실제 업무 처리는 필요하지 않습니다.','CENTER',nid,statement_timestamp()+interval '5 minutes');
 IF (SELECT count(*) FROM public.notification_push_deliveries WHERE notification_id=nid)<>1 THEN RAISE EXCEPTION 'SELF_TEST_DELIVERY_INVARIANT'; END IF;
 INSERT INTO public.notification_push_self_test_audit(test_id,actor_id,action) VALUES(tid,actor,'REQUESTED');
 RETURN public.admin_push_self_test_result_v1(tid);
END $send$;
CREATE FUNCTION public.audit_push_self_test_delivery_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $audit$
DECLARE t public.notification_push_self_tests;
BEGIN
 IF NEW.status IS NOT DISTINCT FROM OLD.status AND NEW.attempt_count IS NOT DISTINCT FROM OLD.attempt_count THEN RETURN NEW; END IF;
 SELECT * INTO t FROM public.notification_push_self_tests WHERE notification_id=NEW.notification_id AND subscription_id=NEW.subscription_id;
 IF FOUND THEN INSERT INTO public.notification_push_self_test_audit(test_id,actor_id,action,attempt_count,error_code) VALUES(t.id,t.actor_id,NEW.status,NEW.attempt_count,CASE WHEN NEW.last_error IN('RETRY','PERMANENT','GONE','ATTEMPTS_EXHAUSTED') THEN NEW.last_error END); END IF;
 RETURN NEW;
END $audit$;
CREATE TRIGGER audit_push_self_test_delivery AFTER UPDATE ON public.notification_push_deliveries FOR EACH ROW EXECUTE FUNCTION public.audit_push_self_test_delivery_v1();
CREATE OR REPLACE FUNCTION public.enqueue_notification_push_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
 IF NEW.category='PUSH_SELF_TEST' THEN
  INSERT INTO public.notification_push_deliveries(notification_id,subscription_id,binding_id)
  SELECT NEW.id,s.id,s.binding_id FROM public.notification_push_self_tests t JOIN public.push_subscriptions s ON s.id=t.subscription_id
  WHERE t.notification_id=NEW.id AND t.actor_id=NEW.recipient_id AND s.profile_id=t.actor_id AND s.binding_id=t.binding_id
  AND s.revoked_at IS NULL AND (s.expiration_time IS NULL OR s.expiration_time>now()) AND public.admin_push_self_test_allowed_v1(t.actor_id)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
 END IF;
  IF NEW.revoked_at IS NULL AND (NEW.expires_at IS NULL OR NEW.expires_at>now()) THEN
    INSERT INTO public.notification_push_deliveries(notification_id,subscription_id,binding_id)
      SELECT NEW.id,s.id,s.binding_id FROM public.push_subscriptions s JOIN public.profiles p ON p.id=s.profile_id
      WHERE s.profile_id=NEW.recipient_id AND s.revoked_at IS NULL AND (s.expiration_time IS NULL OR s.expiration_time>now())
      AND p.is_active AND p.account_status='active' ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $function$
;
CREATE FUNCTION public.admin_push_self_test_delivery_valid_v1(p_delivery uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $valid$
 SELECT EXISTS(SELECT 1 FROM public.notification_push_deliveries d JOIN public.notifications n ON n.id=d.notification_id
 WHERE d.id=p_delivery AND (n.category<>'PUSH_SELF_TEST' OR EXISTS(
 SELECT 1 FROM public.notification_push_self_tests t WHERE t.notification_id=n.id AND t.actor_id=n.recipient_id AND t.subscription_id=d.subscription_id AND t.binding_id=d.binding_id AND public.admin_push_self_test_allowed_v1(t.actor_id))))
$valid$;
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
 AND p.is_active AND p.account_status='active' AND n.revoked_at IS NULL AND (n.expires_at IS NULL OR n.expires_at>now()))) AND coalesce(public.schedule_reminder_delivery_valid_v1(p_delivery_id),false) AND public.admin_push_self_test_delivery_valid_v1(p_delivery_id)
$function$
;
REVOKE ALL ON FUNCTION public.admin_push_self_test_allowed_v1(uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.admin_push_self_test_result_v1(uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.admin_push_self_test_delivery_valid_v1(uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.audit_push_self_test_delivery_v1() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.get_admin_push_self_test_v1() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.send_admin_push_self_test_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_push_self_test_v1(),public.send_admin_push_self_test_v1(uuid,uuid,uuid) TO authenticated;
COMMIT;
