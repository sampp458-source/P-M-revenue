-- Exact Production predecessor; the approved a971... digest is pg_get_functiondef,
-- not prosrc. This migration only scopes the two existing singleton updates.
BEGIN;
DO $guard$
DECLARE p pg_proc%ROWTYPE;
BEGIN
 SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure('public.wake_notification_push_v1()');
 IF NOT FOUND THEN RAISE EXCEPTION 'PUSH_WAKE_PREDECESSOR_MISSING'; END IF;
 IF md5(pg_get_functiondef(p.oid)) <> 'a971cd3a904f00fea421d7b9ce329c21'
    OR pg_get_userbyid(p.proowner) <> 'postgres'
    OR NOT p.prosecdef
    OR p.prorettype <> 'void'::regtype
    OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']::text[]
    OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}'
 THEN RAISE EXCEPTION 'PUSH_WAKE_PREDECESSOR_MISMATCH'; END IF;
 IF (SELECT jsonb_agg(jsonb_build_array(attname,format_type(atttypid,atttypmod),attnotnull) ORDER BY attnum)
     FROM pg_attribute WHERE attrelid=to_regclass('public.notification_push_config') AND attnum>0 AND NOT attisdropped)
    IS DISTINCT FROM '[["singleton","boolean",true],["enabled","boolean",true],["last_wake_at","timestamp with time zone",false],["last_wake_error","text",false]]'::jsonb
    OR (SELECT array_agg(pg_get_constraintdef(oid) ORDER BY pg_get_constraintdef(oid)) FROM pg_constraint WHERE conrelid=to_regclass('public.notification_push_config') AND contype <> 'n')
       IS DISTINCT FROM ARRAY['CHECK (singleton)','PRIMARY KEY (singleton)']::text[]
 THEN RAISE EXCEPTION 'PUSH_CONFIG_SINGLETON_SCHEMA_MISMATCH'; END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.wake_notification_push_v1()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE worker_url text; worker_secret text;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.notification_push_config WHERE enabled) THEN RETURN; END IF;
  BEGIN
    EXECUTE 'SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name=$1' INTO worker_url USING 'notification_push_worker_url';
    EXECUTE 'SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name=$1' INTO worker_secret USING 'notification_push_worker_secret';
    IF worker_url !~ '^https://[a-z0-9]+\.supabase\.co/functions/v1/notification-push-dispatch$' OR worker_url IS NULL OR length(coalesce(worker_secret,''))<32 THEN RAISE EXCEPTION 'PUSH_WAKE_NOT_CONFIGURED'; END IF;
    EXECUTE 'SELECT net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 3000)'
      USING worker_url,'{}'::jsonb,jsonb_build_object('Content-Type','application/json','x-push-worker-secret',worker_secret);
    UPDATE public.notification_push_config SET last_wake_at=now(),last_wake_error=NULL WHERE singleton IS TRUE;
  EXCEPTION WHEN OTHERS THEN
    UPDATE public.notification_push_config SET last_wake_error='WAKE_UNAVAILABLE' WHERE singleton IS TRUE;
  END;
END $function$;

COMMIT;
