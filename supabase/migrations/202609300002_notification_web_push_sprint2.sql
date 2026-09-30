-- Candidate only. Manual SQL; no migration-history writes or extension enablement.
BEGIN;
CREATE TABLE public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE CHECK (length(endpoint) <= 4096), p256dh text NOT NULL, auth text NOT NULL,
  expiration_time timestamptz, binding_id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz
);
CREATE INDEX push_subscriptions_active_profile ON public.push_subscriptions(profile_id) WHERE revoked_at IS NULL;
CREATE TABLE public.notification_push_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
  subscription_id uuid NOT NULL REFERENCES public.push_subscriptions(id) ON DELETE CASCADE,
  binding_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PROCESSING','SENT','FAILED','GONE','CANCELLED')),
  attempt_count integer NOT NULL DEFAULT 0, available_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz, lease_until timestamptz, claim_token uuid, sent_at timestamptz, last_error text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(notification_id, subscription_id)
);
CREATE INDEX notification_push_due ON public.notification_push_deliveries(available_at) WHERE status IN ('PENDING','FAILED','PROCESSING');
-- Disabled until a separately approved release. Secrets live in Vault.
CREATE TABLE public.notification_push_config (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), enabled boolean NOT NULL DEFAULT false,
  last_wake_at timestamptz, last_wake_error text
);
INSERT INTO public.notification_push_config(singleton) VALUES(true);
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_push_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_push_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.push_subscriptions,public.notification_push_deliveries,public.notification_push_config FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.push_subscriptions,public.notification_push_deliveries,public.notification_push_config TO service_role;
CREATE FUNCTION public.register_web_push_subscription_v1(p_endpoint text,p_p256dh text,p_auth text,p_expiration_time timestamptz DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE s public.push_subscriptions; result_id uuid;
BEGIN
  IF NOT public.notification_active_user_v1() THEN RAISE EXCEPTION 'PUSH_FORBIDDEN' USING ERRCODE='42501'; END IF;
  IF p_endpoint IS NULL OR length(p_endpoint)>4096 OR p_endpoint !~ '^https://(web\.push\.apple\.com|fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9-]+\.notify\.windows\.com)/[^[:space:]#]+$'
    OR p_p256dh IS NULL OR p_p256dh !~ '^B[A-Za-z0-9_-]{86}$' OR p_auth IS NULL OR p_auth !~ '^[A-Za-z0-9_-]{22}$'
    OR (p_expiration_time IS NOT NULL AND p_expiration_time<=now()) THEN
    RAISE EXCEPTION 'PUSH_INVALID_SUBSCRIPTION' USING ERRCODE='22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_endpoint,0));
  SELECT * INTO s FROM public.push_subscriptions WHERE endpoint=p_endpoint FOR UPDATE;
  IF FOUND THEN
    IF s.p256dh<>p_p256dh OR s.auth<>p_auth THEN RAISE EXCEPTION 'PUSH_BINDING_CONFLICT' USING ERRCODE='42501'; END IF;
    IF s.profile_id<>auth.uid() OR s.revoked_at IS NOT NULL THEN
      UPDATE public.notification_push_deliveries SET status='CANCELLED',claim_token=NULL,lease_until=NULL,updated_at=now() WHERE subscription_id=s.id AND status IN ('PENDING','FAILED','PROCESSING');
    END IF;
    UPDATE public.push_subscriptions SET profile_id=auth.uid(),revoked_at=NULL,
      binding_id=CASE WHEN s.profile_id<>auth.uid() OR s.revoked_at IS NOT NULL THEN gen_random_uuid() ELSE s.binding_id END,
      expiration_time=p_expiration_time,last_seen_at=now(),updated_at=now() WHERE id=s.id RETURNING id INTO result_id;
  ELSE
    INSERT INTO public.push_subscriptions(profile_id,endpoint,p256dh,auth,expiration_time)
      VALUES(auth.uid(),p_endpoint,p_p256dh,p_auth,p_expiration_time) RETURNING id INTO result_id;
  END IF;
  RETURN result_id;
END $$;
CREATE FUNCTION public.disable_web_push_subscription_v1(p_endpoint text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE sid uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'PUSH_FORBIDDEN' USING ERRCODE='42501'; END IF;
  SELECT id INTO sid FROM public.push_subscriptions WHERE endpoint=p_endpoint AND profile_id=auth.uid() FOR UPDATE;
  IF sid IS NULL THEN RAISE EXCEPTION 'PUSH_SUBSCRIPTION_NOT_OWNED' USING ERRCODE='42501'; END IF;
  UPDATE public.push_subscriptions SET revoked_at=now(),updated_at=now() WHERE id=sid;
  UPDATE public.notification_push_deliveries SET status='CANCELLED',claim_token=NULL,lease_until=NULL,updated_at=now() WHERE subscription_id=sid AND status IN ('PENDING','FAILED','PROCESSING');
END $$;
CREATE FUNCTION public.enqueue_notification_push_v1() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF NEW.revoked_at IS NULL AND (NEW.expires_at IS NULL OR NEW.expires_at>now()) THEN
    INSERT INTO public.notification_push_deliveries(notification_id,subscription_id,binding_id)
      SELECT NEW.id,s.id,s.binding_id FROM public.push_subscriptions s JOIN public.profiles p ON p.id=s.profile_id
      WHERE s.profile_id=NEW.recipient_id AND s.revoked_at IS NULL AND (s.expiration_time IS NULL OR s.expiration_time>now())
      AND p.is_active AND p.account_status='active' ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER enqueue_notification_push AFTER INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION public.enqueue_notification_push_v1();
CREATE FUNCTION public.wake_notification_push_v1() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE worker_url text; worker_secret text;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.notification_push_config WHERE enabled) THEN RETURN; END IF;
  BEGIN
    EXECUTE 'SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name=$1' INTO worker_url USING 'notification_push_worker_url';
    EXECUTE 'SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name=$1' INTO worker_secret USING 'notification_push_worker_secret';
    IF worker_url !~ '^https://[a-z0-9]+\.supabase\.co/functions/v1/notification-push-dispatch$' OR worker_url IS NULL OR length(coalesce(worker_secret,''))<32 THEN RAISE EXCEPTION 'PUSH_WAKE_NOT_CONFIGURED'; END IF;
    EXECUTE 'SELECT net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 3000)'
      USING worker_url,'{}'::jsonb,jsonb_build_object('Content-Type','application/json','x-push-worker-secret',worker_secret);
    UPDATE public.notification_push_config SET last_wake_at=now(),last_wake_error=NULL;
  EXCEPTION WHEN OTHERS THEN
    UPDATE public.notification_push_config SET last_wake_error='WAKE_UNAVAILABLE';
  END;
END $$;
CREATE FUNCTION public.wake_notification_push_trigger_v1() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM inserted_deliveries) THEN PERFORM public.wake_notification_push_v1(); END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER wake_notification_push AFTER INSERT ON public.notification_push_deliveries REFERENCING NEW TABLE AS inserted_deliveries FOR EACH STATEMENT EXECUTE FUNCTION public.wake_notification_push_trigger_v1();
CREATE FUNCTION public.push_delivery_valid_v1(p_delivery_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT EXISTS(SELECT 1 FROM public.notification_push_deliveries d
    JOIN public.notifications n ON n.id=d.notification_id JOIN public.push_subscriptions s ON s.id=d.subscription_id
    JOIN public.profiles p ON p.id=s.profile_id
    WHERE d.id=p_delivery_id AND d.binding_id=s.binding_id AND n.recipient_id=s.profile_id
    AND s.revoked_at IS NULL AND (s.expiration_time IS NULL OR s.expiration_time>now())
    AND p.is_active AND p.account_status='active' AND n.revoked_at IS NULL AND (n.expires_at IS NULL OR n.expires_at>now()));
$$;
CREATE FUNCTION public.claim_notification_push_deliveries_v1(p_limit integer DEFAULT 10)
RETURNS TABLE(delivery_id uuid,token uuid) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
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
CREATE FUNCTION public.get_notification_push_delivery_v1(p_delivery_id uuid,p_token uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT jsonb_build_object('notification_id',n.id,'deep_link_type',n.deep_link_type,'deep_link_id',n.deep_link_id,
    'category',n.category,'endpoint',s.endpoint,'p256dh',s.p256dh,'auth',s.auth)
  FROM public.notification_push_deliveries d JOIN public.notifications n ON n.id=d.notification_id JOIN public.push_subscriptions s ON s.id=d.subscription_id
  WHERE d.id=p_delivery_id AND d.claim_token=p_token AND d.status='PROCESSING' AND d.lease_until>now()+interval '20 seconds'
  AND EXISTS(SELECT 1 FROM public.notification_push_config WHERE enabled) AND public.push_delivery_valid_v1(d.id);
$$;
CREATE FUNCTION public.finish_notification_push_delivery_v1(p_delivery_id uuid,p_token uuid,p_result text,p_retry_after integer DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE d public.notification_push_deliveries;
BEGIN
  IF p_result NOT IN ('SENT','GONE','RETRY','PERMANENT','CANCELLED') THEN RAISE EXCEPTION 'PUSH_INVALID_RESULT'; END IF;
  SELECT * INTO d FROM public.notification_push_deliveries WHERE id=p_delivery_id AND claim_token=p_token AND status='PROCESSING' AND lease_until>now() FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE public.notification_push_deliveries SET status=CASE WHEN p_result IN ('RETRY','PERMANENT') THEN 'FAILED' ELSE p_result END,
    available_at=now()+make_interval(secs=>greatest(30,least(coalesce(p_retry_after,(30*power(2,d.attempt_count))::integer),3600))),
    attempt_count=CASE WHEN p_result='PERMANENT' THEN 6 ELSE attempt_count END,
    sent_at=CASE WHEN p_result='SENT' THEN now() ELSE NULL END,last_error=CASE WHEN p_result IN ('RETRY','PERMANENT','GONE') THEN p_result ELSE NULL END,
    claim_token=NULL,lease_until=NULL,updated_at=now() WHERE id=d.id;
  IF p_result='GONE' THEN
    UPDATE public.push_subscriptions SET revoked_at=now(),updated_at=now() WHERE id=d.subscription_id AND binding_id=d.binding_id;
  END IF;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.register_web_push_subscription_v1(text,text,text,timestamptz),public.disable_web_push_subscription_v1(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.register_web_push_subscription_v1(text,text,text,timestamptz),public.disable_web_push_subscription_v1(text) TO authenticated;
REVOKE ALL ON FUNCTION public.enqueue_notification_push_v1(),public.wake_notification_push_v1(),public.wake_notification_push_trigger_v1(),public.push_delivery_valid_v1(uuid),public.claim_notification_push_deliveries_v1(integer),public.get_notification_push_delivery_v1(uuid,uuid),public.finish_notification_push_delivery_v1(uuid,uuid,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.wake_notification_push_v1(),public.claim_notification_push_deliveries_v1(integer),public.get_notification_push_delivery_v1(uuid,uuid),public.finish_notification_push_delivery_v1(uuid,uuid,text,integer) TO service_role;
COMMIT;
