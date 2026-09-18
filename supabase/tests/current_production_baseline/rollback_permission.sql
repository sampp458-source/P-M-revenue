BEGIN;
DO $$ BEGIN IF current_database()<>'dog_current_baseline' OR inet_server_addr() IS NOT NULL THEN RAISE EXCEPTION 'LOCAL_ONLY'; END IF; END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000900',true);
CREATE FUNCTION pg_temp.f(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
CREATE FUNCTION pg_temp.ok(b boolean,label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF b IS DISTINCT FROM true THEN RAISE EXCEPTION 'ASSERTION: %',label; END IF; END $$;
-- Real historical reference before injected receipt failure.
SET LOCAL ROLE authenticated;
DO $$ DECLARE j jsonb; BEGIN
 j:=create_operation_schedule(pg_temp.f(22),pg_temp.f(30),'Synthetic rollback',now()-interval '3 days',now()-interval '3 days'+interval '1 hour',false,false,'Synthetic',ARRAY[pg_temp.f(900)],ARRAY[pg_temp.f(800)],ARRAY[pg_temp.f(1)],gen_random_uuid());
 PERFORM set_operation_schedule_status((j->>'id')::uuid,(j->>'version')::integer,'completed','Synthetic',gen_random_uuid());
END $$;
RESET ROLE;
CREATE FUNCTION pg_temp.reject_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'SYNTHETIC_RECEIPT_FAILURE'; END $$;
CREATE TRIGGER synthetic_receipt_failure BEFORE INSERT ON dog_profile_removal_receipts FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_receipt();
SET LOCAL ROLE authenticated;
DO $$ DECLARE n integer; p jsonb; previous jsonb; BEGIN
 FOREACH n IN ARRAY ARRAY[1,9] LOOP
 SELECT to_jsonb(d) INTO previous FROM dogs d WHERE id=pg_temp.f(n);
 p:=preview_dog_profile_removal(pg_temp.f(n));
 BEGIN
  PERFORM remove_dog_profile(pg_temp.f(n),(p->>'version')::bigint,p->>'graphFingerprint',p->>'proposedMode',gen_random_uuid(),'Synthetic rollback');
  RAISE EXCEPTION 'missing expected failure';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'SYNTHETIC_RECEIPT_FAILURE' THEN RAISE; END IF; END;
 PERFORM pg_temp.ok((SELECT to_jsonb(d)=previous FROM dogs d WHERE id=pg_temp.f(n)),'row/version rollback');
 END LOOP;
END $$;
RESET ROLE;
SELECT pg_temp.ok(NOT EXISTS(SELECT 1 FROM dog_profile_removal_receipts),'no failed receipt');
SELECT pg_temp.ok(EXISTS(SELECT 1 FROM operation_schedule_dogs WHERE dog_id=pg_temp.f(1)),'reference retained');
DROP TRIGGER synthetic_receipt_failure ON dog_profile_removal_receipts;
SET LOCAL ROLE authenticated;
DO $$ DECLARE p jsonb; r jsonb; replay jsonb; rid uuid:=gen_random_uuid(); BEGIN
 p:=preview_dog_profile_removal(pg_temp.f(1));
 r:=remove_dog_profile(pg_temp.f(1),(p->>'version')::bigint,p->>'graphFingerprint','profile_remove',rid,'Synthetic replay');
 replay:=remove_dog_profile(pg_temp.f(1),(p->>'version')::bigint,p->>'graphFingerprint','profile_remove',rid,'Synthetic replay');
 PERFORM pg_temp.ok(r=replay,'same request replay');
 BEGIN
 PERFORM remove_dog_profile(pg_temp.f(1),(p->>'version')::bigint,p->>'graphFingerprint','profile_remove',rid,'changed');
 RAISE EXCEPTION 'changed input accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'REQUEST_ID_CONFLICT' THEN RAISE; END IF; END;
END $$;
RESET ROLE;
SELECT pg_temp.ok((SELECT count(*)=1 FROM dog_profile_removal_receipts),'one success receipt');
SELECT pg_temp.ok(NOT has_function_privilege('anon','public.remove_dog_profile(uuid,bigint,text,text,uuid,text)','EXECUTE'),'anon denied');
SELECT pg_temp.ok(NOT has_table_privilege('authenticated','public.dog_profile_removal_receipts','SELECT'),'receipt private');
ROLLBACK;
