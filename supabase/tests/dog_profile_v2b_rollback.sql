BEGIN;
SELECT fixture_assert(current_database()='dog_v2b_fixture' AND inet_server_addr() IS NULL,'local only');
SET LOCAL request.jwt.claim.sub='00000000-0000-4000-8000-000000000900';
CREATE FUNCTION fixture_reject_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'SYNTHETIC_RECEIPT_FAILURE'; END $$;
CREATE TRIGGER fixture_reject_receipt BEFORE INSERT ON dog_profile_removal_receipts FOR EACH ROW EXECUTE FUNCTION fixture_reject_receipt();
SET LOCAL ROLE authenticated;
DO $$ DECLARE n integer; mode text; p jsonb; before_row jsonb; BEGIN
 FOR n IN SELECT unnest(ARRAY[1,2]) LOOP
   SELECT to_jsonb(d) INTO before_row FROM dogs d WHERE id=fixture_id(n);
   p:=preview_dog_profile_removal(fixture_id(n)); mode:=p->>'proposedMode';
   BEGIN PERFORM remove_dog_profile(fixture_id(n),1,p->>'graphFingerprint',mode,fixture_id(1200+n)); RAISE EXCEPTION 'failure not raised';
   EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'SYNTHETIC_RECEIPT_FAILURE' THEN RAISE; END IF; END;
   PERFORM fixture_assert((SELECT to_jsonb(d)=before_row FROM dogs d WHERE id=fixture_id(n)),'complete rollback '||mode);
 END LOOP;
END $$;
RESET ROLE;
SELECT fixture_assert(NOT EXISTS(SELECT 1 FROM dog_profile_removal_receipts),'no failed receipt');
ROLLBACK;
