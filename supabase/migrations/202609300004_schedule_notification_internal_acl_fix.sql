-- Restore internal-only execution after Production default function grants.
-- Append-only: the applied Sprint 3A migration and all function bodies stay unchanged.
BEGIN;

DO $guard$
DECLARE expected record; actual record;
BEGIN
  FOR expected IN SELECT * FROM (VALUES
    ('public.schedule_notification_fingerprint_v1(public.operation_schedules)', '2258090c8865964a91e81d7d74fbb57c', false),
    ('public.schedule_notification_recipient_v1(uuid)', 'd9557fb448ee44436cf92be3157ff178', true),
    ('public.emit_schedule_notification_v1(uuid,uuid,text,text,date,integer)', '856c596505f9fc38110e1b2e47e30c08', true),
    ('public.finalize_schedule_notification_v1()', '9824cef3a326e7ed4735e2c4f8ba1feb', true),
    ('public.run_daily_schedule_summary_at_v1(timestamp with time zone)', '0e2d249aa51b35203721fde124fff0a9', true)
  ) AS v(signature, body_md5, security_definer)
  LOOP
    SELECT p.oid, md5(p.prosrc) AS body_md5, pg_get_userbyid(p.proowner) AS owner,
           p.prosecdef, p.proconfig,
           ARRAY(SELECT a::text FROM unnest(p.proacl) a ORDER BY a::text) AS acl
    INTO actual FROM pg_proc p WHERE p.oid = to_regprocedure(expected.signature);
    IF NOT FOUND THEN
      RAISE EXCEPTION 'SCHEDULE_INTERNAL_ACL_PREDECESSOR_MISSING: %', expected.signature;
    END IF;
    IF actual.body_md5 IS DISTINCT FROM expected.body_md5
       OR actual.owner IS DISTINCT FROM 'postgres'
       OR actual.prosecdef IS DISTINCT FROM expected.security_definer
       OR actual.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']::text[]
       OR actual.acl IS DISTINCT FROM ARRAY['postgres=X/postgres','service_role=X/postgres']::text[] THEN
      RAISE EXCEPTION 'SCHEDULE_INTERNAL_ACL_PREDECESSOR_MISMATCH: %', expected.signature;
    END IF;
  END LOOP;
END
$guard$;

REVOKE EXECUTE ON FUNCTION public.schedule_notification_fingerprint_v1(public.operation_schedules) FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.schedule_notification_recipient_v1(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.emit_schedule_notification_v1(uuid,uuid,text,text,date,integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.finalize_schedule_notification_v1() FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.run_daily_schedule_summary_at_v1(timestamp with time zone) FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
