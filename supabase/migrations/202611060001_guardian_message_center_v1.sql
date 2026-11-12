-- Local candidate. Independent manual messaging; no existing business/notification objects replaced.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $$ BEGIN
 IF to_regclass('public.guardian_message_config') IS NOT NULL THEN RAISE EXCEPTION 'GUARDIAN_MESSAGE_ALREADY_INSTALLED'; END IF;
 IF to_regprocedure('public.is_active_operation_member()') IS NULL OR to_regclass('public.operation_schedule_customers') IS NULL THEN RAISE EXCEPTION 'GUARDIAN_MESSAGE_DEPENDENCY_MISSING'; END IF;
END $$;
CREATE TABLE public.guardian_message_config(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),enabled boolean NOT NULL DEFAULT false,internal_test_verified boolean NOT NULL DEFAULT false,send_scope text NOT NULL DEFAULT 'off' CHECK(send_scope IN('off','internal','live')),fallback_enabled boolean NOT NULL DEFAULT false);
INSERT INTO public.guardian_message_config DEFAULT VALUES;
CREATE TABLE public.guardian_message_permissions(profile_id uuid NOT NULL REFERENCES public.profiles(id),unit text NOT NULL CHECK(unit IN('training','hotel','daycare')),can_send boolean NOT NULL DEFAULT false,PRIMARY KEY(profile_id,unit));
CREATE TABLE public.guardian_message_internal_recipients(phone text PRIMARY KEY CHECK(phone ~ '^0[0-9]{8,10}$'),is_active boolean NOT NULL DEFAULT true,approved_by uuid NOT NULL REFERENCES public.profiles(id),approval_reason text NOT NULL CHECK(length(btrim(approval_reason))>=5),approved_at timestamptz NOT NULL DEFAULT statement_timestamp());
CREATE TABLE public.guardian_messages(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),request_id uuid NOT NULL,actor_id uuid NOT NULL REFERENCES public.profiles(id),
 unit text NOT NULL CHECK(unit IN('training','hotel','daycare')),customer_id uuid NULL REFERENCES public.customers(id) ON DELETE SET NULL,
 schedule_id uuid NULL REFERENCES public.operation_schedules(id) ON DELETE SET NULL,channel text NOT NULL CHECK(channel IN('SMS','LMS','ATA')),
 snapshot jsonb NOT NULL,snapshot_hash text NOT NULL,send_scope text NULL CHECK(send_scope IN('internal','live')),status text NOT NULL DEFAULT 'draft' CHECK(status IN('draft','submitting','accepted','processing','success','failed','unknown')),
 provider_message_id text NULL,provider_group_id text NULL,result_code text NULL,fallback_used boolean NULL,cost numeric NULL CHECK(cost>=0),
 created_at timestamptz NOT NULL DEFAULT statement_timestamp(),requested_at timestamptz NULL,updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),UNIQUE(actor_id,request_id)
);
CREATE INDEX guardian_messages_actor_created ON public.guardian_messages(actor_id,created_at DESC);
CREATE INDEX guardian_messages_recipient ON public.guardian_messages(customer_id,requested_at DESC);
CREATE TABLE public.guardian_message_audit(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),message_id uuid NULL REFERENCES public.guardian_messages(id),actor_id uuid NOT NULL REFERENCES public.profiles(id),action text NOT NULL,code text NULL,details jsonb NOT NULL DEFAULT '{}',request_id uuid NULL,recorded_at timestamptz NOT NULL DEFAULT statement_timestamp(),UNIQUE(actor_id,request_id));
ALTER TABLE public.guardian_message_internal_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guardian_message_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guardian_message_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guardian_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guardian_message_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.guardian_message_internal_recipients,public.guardian_message_config,public.guardian_message_permissions,public.guardian_messages,public.guardian_message_audit FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.guardian_message_admin_v1(p_actor uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.profiles p JOIN public.operation_memberships m ON m.profile_id=p.id WHERE p.id=p_actor AND p.role='admin' AND p.is_active AND p.account_status='active' AND m.is_active)
$$;
CREATE FUNCTION public.guardian_message_access_v1(p_actor uuid,p_unit text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT p_unit IN('training','hotel','daycare') AND EXISTS(SELECT 1 FROM public.profiles p JOIN public.operation_memberships m ON m.profile_id=p.id WHERE p.id=p_actor AND p.is_active AND p.account_status='active' AND m.is_active AND (p.role='admin' OR EXISTS(SELECT 1 FROM public.guardian_message_permissions g WHERE g.profile_id=p_actor AND g.unit=p_unit AND g.can_send)))
$$;
CREATE FUNCTION public.guardian_message_customer_allowed_v1(p_actor uuid,p_unit text,p_customer uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT public.guardian_message_access_v1(p_actor,p_unit) AND (public.guardian_message_admin_v1(p_actor) OR EXISTS(
 SELECT 1 FROM public.operation_schedule_customers c JOIN public.operation_schedules s ON s.id=c.schedule_id JOIN public.operation_calendars cal ON cal.id=s.calendar_id JOIN public.business_units b ON b.id=cal.business_unit_id JOIN public.operation_schedule_assignees a ON a.schedule_id=s.id
 WHERE c.customer_id=p_customer AND c.archived_at IS NULL AND s.archived_at IS NULL AND cal.scope_type='business_unit' AND b.code=p_unit AND a.profile_id=p_actor AND a.archived_at IS NULL))
$$;
CREATE FUNCTION public.get_guardian_message_access_v1() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT jsonb_build_object('units',COALESCE((SELECT jsonb_agg(u) FROM unnest(ARRAY['training','hotel','daycare'])u WHERE public.guardian_message_access_v1(auth.uid(),u)),'[]'::jsonb),'admin',public.guardian_message_admin_v1(auth.uid()),'enabled',c.enabled,'internalTestVerified',c.internal_test_verified,'fallbackEnabled',c.fallback_enabled,'sendScope',c.send_scope,'internalRecipientCount',(SELECT count(*) FROM public.guardian_message_internal_recipients WHERE is_active)) FROM public.guardian_message_config c WHERE singleton
$$;
CREATE FUNCTION public.search_guardian_message_customers_v1(p_unit text,p_query text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NOT public.guardian_message_access_v1(auth.uid(),p_unit) THEN RAISE EXCEPTION 'MESSAGE_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF length(btrim(p_query))<2 OR length(p_query)>80 THEN RETURN '[]'::jsonb; END IF;
 RETURN COALESCE((SELECT jsonb_agg(x) FROM(SELECT c.id,c.name,CASE WHEN c.phone IS NULL THEN NULL ELSE regexp_replace(c.phone,'^(.{3}).*(.{4})$','\1****\2') END AS phone_masked FROM public.customers c WHERE c.is_active AND public.guardian_message_customer_allowed_v1(auth.uid(),p_unit,c.id) AND (position(lower(p_query) in lower(COALESCE(c.name,'')))>0 OR position(p_query in COALESCE(c.phone,''))>0 OR EXISTS(SELECT 1 FROM public.dogs d WHERE d.customer_id=c.id AND d.is_active AND position(lower(p_query) in lower(d.name))>0)) ORDER BY c.name,c.id LIMIT 20)x),'[]'::jsonb);
END $$;
-- Internal context returns only required contact/linked schedule fields, never memo/payment data.
CREATE FUNCTION public.guardian_message_context_v1(p_actor uuid,p_unit text,p_customer uuid,p_schedule uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c public.customers;s public.operation_schedules; result jsonb;
BEGIN
 IF NOT public.guardian_message_customer_allowed_v1(p_actor,p_unit,p_customer) THEN RAISE EXCEPTION 'MESSAGE_FORBIDDEN' USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM public.customers WHERE id=p_customer AND is_active;
 IF c.id IS NULL THEN RAISE EXCEPTION 'MESSAGE_CUSTOMER_UNAVAILABLE'; END IF;
 result:=jsonb_build_object('customerId',c.id,'guardianName',c.name,'phone',c.phone,'dogNames',(SELECT string_agg(d.name,', ' ORDER BY d.name) FROM public.dogs d WHERE d.customer_id=c.id AND d.is_active));
 IF p_schedule IS NOT NULL THEN
  SELECT op.* INTO s FROM public.operation_schedules op JOIN public.operation_calendars cal ON cal.id=op.calendar_id JOIN public.business_units b ON b.id=cal.business_unit_id JOIN public.operation_schedule_customers sc ON sc.schedule_id=op.id WHERE op.id=p_schedule AND op.archived_at IS NULL AND op.status<>'cancelled' AND b.code=p_unit AND cal.scope_type='business_unit' AND sc.customer_id=p_customer AND sc.archived_at IS NULL;
  IF s.id IS NULL THEN RAISE EXCEPTION 'MESSAGE_SCHEDULE_UNAVAILABLE'; END IF;
  result:=result||jsonb_build_object('scheduleId',s.id,'scheduleVersion',s.version,'dogNames',(SELECT string_agg(d.name,', ' ORDER BY d.name) FROM public.operation_schedule_dogs sd JOIN public.dogs d ON d.id=sd.dog_id WHERE sd.schedule_id=s.id AND sd.archived_at IS NULL AND d.customer_id=p_customer AND d.is_active),'title',s.title,'startsAt',CASE WHEN s.time_unspecified OR s.all_day THEN NULL ELSE s.starts_at END,'endsAt',CASE WHEN s.time_unspecified OR s.all_day THEN NULL ELSE s.ends_at END);
 END IF;
 RETURN result;
END $$;
CREATE FUNCTION public.get_guardian_message_context_v1(p_unit text,p_customer uuid,p_schedule uuid DEFAULT NULL) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$ SELECT public.guardian_message_context_v1(auth.uid(),p_unit,p_customer,p_schedule) $$;

CREATE FUNCTION public.save_guardian_message_v1(p_actor uuid,p_request uuid,p_snapshot jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE old public.guardian_messages; rec public.guardian_messages; context jsonb; h text:=encode(sha256(convert_to(p_snapshot::text,'UTF8')),'hex');
BEGIN
 IF p_request IS NULL OR jsonb_typeof(p_snapshot)<>'object' OR octet_length(p_snapshot::text)>16000 THEN RAISE EXCEPTION 'MESSAGE_INPUT'; END IF;
 context:=public.guardian_message_context_v1(p_actor,p_snapshot->>'unit',(p_snapshot->>'customerId')::uuid,(p_snapshot->>'scheduleId')::uuid);
 IF p_snapshot->>'channel' NOT IN('SMS','LMS','ATA') OR length(p_snapshot->>'text') NOT BETWEEN 1 AND 2000 OR p_snapshot->>'to' !~ '^0[0-9]{8,10}$' THEN RAISE EXCEPTION 'MESSAGE_INPUT'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('guardian-draft:'||p_actor::text,0));
 SELECT * INTO old FROM public.guardian_messages WHERE actor_id=p_actor AND request_id=p_request;
 IF FOUND THEN IF old.snapshot_hash<>h THEN RAISE EXCEPTION 'MESSAGE_REQUEST_MISMATCH'; END IF; RETURN jsonb_build_object('id',old.id,'hash',old.snapshot_hash,'status',old.status); END IF;
 IF (SELECT count(*) FROM public.guardian_messages WHERE actor_id=p_actor AND created_at>statement_timestamp()-interval '1 day')>=100 THEN RAISE EXCEPTION 'MESSAGE_DRAFT_LIMIT'; END IF;
 INSERT INTO public.guardian_messages(actor_id,request_id,unit,customer_id,schedule_id,channel,snapshot,snapshot_hash) VALUES(p_actor,p_request,p_snapshot->>'unit',(p_snapshot->>'customerId')::uuid,(p_snapshot->>'scheduleId')::uuid,p_snapshot->>'channel',p_snapshot,h) RETURNING * INTO rec;
 INSERT INTO public.guardian_message_audit(message_id,actor_id,action) VALUES(rec.id,p_actor,'PREVIEW_SAVED');
 RETURN jsonb_build_object('id',rec.id,'hash',h,'status',rec.status);
END $$;
CREATE FUNCTION public.claim_guardian_message_v1(p_actor uuid,p_id uuid,p_hash text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE rec public.guardian_messages;context jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('guardian-send',0));
 SELECT * INTO rec FROM public.guardian_messages WHERE id=p_id AND actor_id=p_actor FOR UPDATE;
 IF rec.id IS NULL OR NOT public.guardian_message_customer_allowed_v1(p_actor,rec.unit,rec.customer_id) THEN RAISE EXCEPTION 'MESSAGE_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF rec.snapshot_hash IS DISTINCT FROM p_hash THEN RAISE EXCEPTION 'MESSAGE_SNAPSHOT_CHANGED'; END IF;
 IF rec.status<>'draft' THEN RETURN jsonb_build_object('claimed',false,'status',rec.status); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.guardian_message_config cfg WHERE singleton AND enabled AND ((send_scope='live' AND internal_test_verified) OR (send_scope='internal' AND public.guardian_message_admin_v1(p_actor) AND EXISTS(SELECT 1 FROM public.guardian_message_internal_recipients t WHERE t.phone=rec.snapshot->>'to' AND t.is_active)))) THEN RAISE EXCEPTION 'MESSAGE_DISABLED'; END IF;
 IF rec.snapshot->>'fallback'='true' AND NOT EXISTS(SELECT 1 FROM public.guardian_message_config WHERE singleton AND fallback_enabled) THEN RAISE EXCEPTION 'MESSAGE_UNAPPROVED_FALLBACK'; END IF;
 IF rec.created_at<statement_timestamp()-interval '5 minutes' THEN RAISE EXCEPTION 'MESSAGE_PREVIEW_EXPIRED'; END IF;
 context:=public.guardian_message_context_v1(p_actor,rec.unit,rec.customer_id,rec.schedule_id);
 IF context->>'phone' IS DISTINCT FROM rec.snapshot->>'originalPhone' OR context->>'scheduleVersion' IS DISTINCT FROM rec.snapshot->>'scheduleVersion' THEN RAISE EXCEPTION 'MESSAGE_CONTEXT_CHANGED'; END IF;
 IF (SELECT count(*) FROM public.guardian_messages WHERE actor_id=p_actor AND requested_at>statement_timestamp()-interval '1 day')>=20 OR EXISTS(SELECT 1 FROM public.guardian_messages WHERE (requested_at>statement_timestamp()-interval '5 minutes' OR status IN('submitting','unknown','accepted','processing')) AND snapshot->>'to'=rec.snapshot->>'to' AND snapshot->>'text'=rec.snapshot->>'text') THEN RAISE EXCEPTION 'MESSAGE_RATE_LIMIT'; END IF;
 UPDATE public.guardian_messages SET status='submitting',send_scope=(SELECT cfg.send_scope FROM public.guardian_message_config cfg WHERE singleton),requested_at=statement_timestamp(),updated_at=statement_timestamp() WHERE id=p_id;
 INSERT INTO public.guardian_message_audit(message_id,actor_id,action,details) VALUES(p_id,p_actor,'SEND_CLAIMED',jsonb_build_object('scope',(SELECT cfg.send_scope FROM public.guardian_message_config cfg WHERE singleton)));
 RETURN jsonb_build_object('claimed',true,'snapshot',rec.snapshot);
END $$;
CREATE FUNCTION public.finish_guardian_message_v1(p_actor uuid,p_id uuid,p_status text,p_message_id text,p_group_id text,p_code text,p_fallback boolean DEFAULT NULL,p_cost numeric DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.guardian_messages;
BEGIN
 SELECT * INTO r FROM public.guardian_messages WHERE id=p_id AND (actor_id=p_actor OR public.guardian_message_admin_v1(p_actor)) FOR UPDATE;
 IF r.id IS NULL OR r.status='draft' OR p_status NOT IN('accepted','processing','success','failed','unknown') OR length(COALESCE(p_code,''))>60 THEN RAISE EXCEPTION 'MESSAGE_RESULT_INPUT'; END IF;
 IF (r.provider_message_id IS NOT NULL AND p_message_id IS NOT NULL AND r.provider_message_id IS DISTINCT FROM p_message_id) OR (r.provider_group_id IS NOT NULL AND p_group_id IS NOT NULL AND r.provider_group_id IS DISTINCT FROM p_group_id) THEN RAISE EXCEPTION 'MESSAGE_PROVIDER_ID_MISMATCH'; END IF;
 IF p_status IN('accepted','processing','success') AND (nullif(p_message_id,'') IS NULL OR nullif(p_group_id,'') IS NULL) THEN RAISE EXCEPTION 'MESSAGE_PROVIDER_ID_REQUIRED'; END IF;
 IF (p_status='accepted' AND p_code IS DISTINCT FROM '2000') OR (p_status='processing' AND p_code IS DISTINCT FROM '3000') OR (p_status='failed' AND p_code IS DISTINCT FROM '5000' AND p_code IS DISTINCT FROM 'PROVIDER_REJECTED') THEN RAISE EXCEPTION 'MESSAGE_RESULT_CODE_MISMATCH'; END IF;
 IF p_fallback IS TRUE AND r.snapshot->>'fallback' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'MESSAGE_UNAPPROVED_FALLBACK'; END IF;
 IF r.status IN('success','failed') THEN RETURN; END IF;
 IF (r.status='processing' AND p_status='accepted') OR (r.status IN('accepted','processing') AND p_status='unknown') THEN RETURN; END IF;
 IF p_status='success' AND p_code IS DISTINCT FROM '4000' THEN RAISE EXCEPTION 'MESSAGE_UNCONFIRMED_SUCCESS'; END IF;
 UPDATE public.guardian_messages SET status=p_status,provider_message_id=COALESCE(provider_message_id,p_message_id),provider_group_id=COALESCE(provider_group_id,p_group_id),result_code=p_code,fallback_used=COALESCE(p_fallback,fallback_used),cost=COALESCE(p_cost,cost),updated_at=statement_timestamp() WHERE id=p_id;
 INSERT INTO public.guardian_message_audit(message_id,actor_id,action,code) VALUES(p_id,p_actor,p_status,p_code);
END $$;
CREATE FUNCTION public.get_guardian_message_v1(p_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.guardian_messages;
BEGIN SELECT * INTO r FROM public.guardian_messages WHERE id=p_id;
 IF r.id IS NULL OR NOT public.guardian_message_access_v1(auth.uid(),r.unit) OR NOT (r.actor_id=auth.uid() OR public.guardian_message_admin_v1(auth.uid())) THEN RAISE EXCEPTION 'MESSAGE_FORBIDDEN' USING ERRCODE='42501'; END IF;
 RETURN to_jsonb(r);
END $$;
CREATE FUNCTION public.list_guardian_messages_v1(p_unit text DEFAULT NULL,p_channel text DEFAULT NULL,p_status text DEFAULT NULL) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT COALESCE(jsonb_agg(x),'[]'::jsonb) FROM(SELECT m.id,m.unit,m.channel,m.status,m.created_at,m.requested_at,p.name AS actor_name,m.provider_message_id,m.provider_group_id,m.result_code,m.fallback_used,m.cost,m.snapshot->>'type' AS type,regexp_replace(m.snapshot->>'to','^(.{3}).*(.{4})$','\1****\2') AS recipient FROM public.guardian_messages m JOIN public.profiles p ON p.id=m.actor_id WHERE public.guardian_message_access_v1(auth.uid(),m.unit) AND (m.actor_id=auth.uid() OR public.guardian_message_admin_v1(auth.uid())) AND(p_unit IS NULL OR m.unit=p_unit) AND(p_channel IS NULL OR m.channel=p_channel) AND(p_status IS NULL OR m.status=p_status) ORDER BY m.created_at DESC LIMIT 50)x
$$;
CREATE FUNCTION public.get_guardian_message_staff_v1() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NOT public.guardian_message_admin_v1(auth.uid()) THEN RAISE EXCEPTION 'MESSAGE_FORBIDDEN' USING ERRCODE='42501'; END IF;
 RETURN COALESCE((SELECT jsonb_agg(x) FROM(SELECT p.id,p.name,COALESCE((SELECT jsonb_agg(g.unit) FROM public.guardian_message_permissions g WHERE g.profile_id=p.id AND g.can_send),'[]'::jsonb) units FROM public.profiles p JOIN public.operation_memberships m ON m.profile_id=p.id WHERE p.is_active AND p.account_status='active' AND m.is_active AND p.role='staff' ORDER BY p.name)x),'[]'::jsonb);
END $$;
CREATE FUNCTION public.set_guardian_message_permission_v1(p_profile uuid,p_unit text,p_can_send boolean,p_reason text,p_request uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid:=auth.uid(); prior jsonb; details jsonb:=jsonb_build_object('profileId',p_profile,'unit',p_unit,'canSend',p_can_send,'reason',btrim(p_reason));
BEGIN
 IF NOT public.guardian_message_admin_v1(actor) THEN RAISE EXCEPTION 'MESSAGE_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF p_unit NOT IN('training','hotel','daycare') OR p_request IS NULL OR p_can_send IS NULL OR length(btrim(p_reason))<5 OR length(p_reason)>300 THEN RAISE EXCEPTION 'MESSAGE_PERMISSION_INPUT'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('guardian-permission:'||actor::text,0));
 SELECT a.details INTO prior FROM public.guardian_message_audit a WHERE a.actor_id=actor AND a.request_id=p_request;
 IF FOUND THEN IF prior IS DISTINCT FROM details THEN RAISE EXCEPTION 'MESSAGE_REQUEST_MISMATCH'; END IF;RETURN;END IF;
 IF NOT EXISTS(SELECT 1 FROM public.profiles p JOIN public.operation_memberships m ON m.profile_id=p.id WHERE p.id=p_profile AND p.role='staff' AND p.is_active AND p.account_status='active' AND m.is_active) THEN RAISE EXCEPTION 'MESSAGE_PERMISSION_TARGET'; END IF;
 INSERT INTO public.guardian_message_permissions(profile_id,unit,can_send) VALUES(p_profile,p_unit,p_can_send) ON CONFLICT(profile_id,unit) DO UPDATE SET can_send=EXCLUDED.can_send;
 INSERT INTO public.guardian_message_audit(actor_id,action,details,request_id) VALUES(actor,'PERMISSION_CHANGED',details,p_request);
END $$;
-- Empty on installation. Only an explicit administrator-approved number can enter this list.
CREATE FUNCTION public.is_guardian_message_internal_recipient_v1(p_phone text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT public.guardian_message_admin_v1(auth.uid()) AND EXISTS(SELECT 1 FROM public.guardian_message_internal_recipients WHERE phone=p_phone AND is_active)
$$;
CREATE FUNCTION public.set_guardian_message_internal_recipient_v1(p_phone text,p_enabled boolean,p_reason text,p_request uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid:=auth.uid(); prior jsonb; payload jsonb:=jsonb_build_object('recipientHash',encode(sha256(convert_to(p_phone,'UTF8')),'hex'),'last4',right(p_phone,4),'enabled',p_enabled,'reason',btrim(p_reason));
BEGIN
 IF NOT public.guardian_message_admin_v1(actor) THEN RAISE EXCEPTION 'MESSAGE_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF p_phone IS NULL OR p_phone !~ '^0[0-9]{8,10}$' OR p_enabled IS NULL OR p_request IS NULL OR length(btrim(COALESCE(p_reason,'')))<5 OR length(p_reason)>300 THEN RAISE EXCEPTION 'MESSAGE_INTERNAL_RECIPIENT_INPUT'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('guardian-permission:'||actor::text,0));
 SELECT details INTO prior FROM public.guardian_message_audit WHERE actor_id=actor AND request_id=p_request;
 IF FOUND THEN IF prior IS DISTINCT FROM payload THEN RAISE EXCEPTION 'MESSAGE_REQUEST_MISMATCH'; END IF;RETURN;END IF;
 INSERT INTO public.guardian_message_internal_recipients(phone,is_active,approved_by,approval_reason) VALUES(p_phone,p_enabled,actor,p_reason) ON CONFLICT(phone) DO UPDATE SET is_active=EXCLUDED.is_active,approved_by=actor,approval_reason=p_reason,approved_at=statement_timestamp();
 INSERT INTO public.guardian_message_audit(actor_id,action,details,request_id) VALUES(actor,'INTERNAL_RECIPIENT_APPROVED',payload,p_request);
END $$;
CREATE FUNCTION public.audit_guardian_message_attempt_v1(p_actor uuid,p_id uuid,p_code text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF length(p_code)>60 OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_actor) OR (p_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.guardian_messages WHERE id=p_id AND (actor_id=p_actor OR public.guardian_message_admin_v1(p_actor)))) THEN RAISE EXCEPTION 'MESSAGE_AUDIT_INPUT'; END IF;
 INSERT INTO public.guardian_message_audit(message_id,actor_id,action,code) VALUES(p_id,p_actor,'REQUEST_BLOCKED',p_code);
END $$;
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT oid::regprocedure AS signature,proname FROM pg_proc WHERE pronamespace='public'::regnamespace AND oid=ANY(ARRAY[
   'public.guardian_message_admin_v1(uuid)'::regprocedure,
   'public.guardian_message_access_v1(uuid,text)'::regprocedure,
   'public.guardian_message_customer_allowed_v1(uuid,text,uuid)'::regprocedure,
   'public.get_guardian_message_access_v1()'::regprocedure,
   'public.search_guardian_message_customers_v1(text,text)'::regprocedure,
   'public.guardian_message_context_v1(uuid,text,uuid,uuid)'::regprocedure,
   'public.get_guardian_message_context_v1(text,uuid,uuid)'::regprocedure,
   'public.save_guardian_message_v1(uuid,uuid,jsonb)'::regprocedure,
   'public.claim_guardian_message_v1(uuid,uuid,text)'::regprocedure,
   'public.finish_guardian_message_v1(uuid,uuid,text,text,text,text,boolean,numeric)'::regprocedure,
   'public.get_guardian_message_v1(uuid)'::regprocedure,
   'public.list_guardian_messages_v1(text,text,text)'::regprocedure,
   'public.get_guardian_message_staff_v1()'::regprocedure,
   'public.set_guardian_message_permission_v1(uuid,text,boolean,text,uuid)'::regprocedure,
   'public.is_guardian_message_internal_recipient_v1(text)'::regprocedure,
   'public.set_guardian_message_internal_recipient_v1(text,boolean,text,uuid)'::regprocedure,
   'public.audit_guardian_message_attempt_v1(uuid,uuid,text)'::regprocedure
  ]) LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.signature);
  IF f.proname IN('get_guardian_message_access_v1','search_guardian_message_customers_v1','get_guardian_message_context_v1','get_guardian_message_v1','list_guardian_messages_v1','get_guardian_message_staff_v1','set_guardian_message_permission_v1','is_guardian_message_internal_recipient_v1','set_guardian_message_internal_recipient_v1') THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',f.signature);
  ELSIF f.proname IN('save_guardian_message_v1','claim_guardian_message_v1','finish_guardian_message_v1','audit_guardian_message_attempt_v1') THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.signature); END IF;
 END LOOP;
END $$;
COMMIT;
