-- LOCAL ONLY: run after the V2-A synthetic fixture, V2-B fixture extensions and V2-B migration.
BEGIN;
SELECT fixture_assert(current_database()='dog_v2b_fixture' AND inet_server_addr() IS NULL,'local only');
SET LOCAL request.jwt.claim.sub='00000000-0000-4000-8000-000000000900';
SELECT fixture_assert((SELECT profile_status='inactive' AND version=1 FROM dogs WHERE id=fixture_id(2)),'inactive initialization');
SET LOCAL ROLE authenticated;
DO $$ DECLARE p jsonb; r jsonb; replay jsonb; n integer; BEGIN
 p:=preview_dog_profile_removal(fixture_id(1));
 r:=remove_dog_profile(fixture_id(1),1,p->>'graphFingerprint','hard_delete',fixture_id(1001));
 replay:=remove_dog_profile(fixture_id(1),1,p->>'graphFingerprint','hard_delete',fixture_id(1001));
 PERFORM fixture_assert(r=replay AND NOT EXISTS(SELECT 1 FROM dogs WHERE id=fixture_id(1)),'unused delete and response-loss replay');
 BEGIN PERFORM remove_dog_profile(fixture_id(1),1,p->>'graphFingerprint','profile_remove',fixture_id(1001)); RAISE EXCEPTION 'expected request conflict';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'REQUEST_ID_CONFLICT' THEN RAISE; END IF; END;
 FOR n IN SELECT unnest(ARRAY[2,3,6,7,8,11,14,15]) LOOP
   p:=preview_dog_profile_removal(fixture_id(n));
   PERFORM fixture_assert(p->>'proposedMode'='profile_remove','historical mode '||n);
   IF n=8 THEN PERFORM fixture_assert(p->'warnings' ? 'OUTSTANDING_SALES','outstanding warning'); END IF;
   PERFORM remove_dog_profile(fixture_id(n),1,p->>'graphFingerprint','profile_remove',fixture_id(1000+n));
   PERFORM fixture_assert((SELECT profile_status='removed' AND NOT is_active AND version=2 FROM dogs WHERE id=fixture_id(n)),'removed '||n);
   PERFORM fixture_assert(get_historical_dog_identities(ARRAY[fixture_id(n)])->0->>'profileStatus'='removed','historical identity '||n);
 END LOOP;
 FOR n IN SELECT unnest(ARRAY[4,5,9,10,12,13,16,17,18,19,20]) LOOP
   p:=preview_dog_profile_removal(fixture_id(n));
   PERFORM fixture_assert((p->>'activeBlockerCount')::integer>0 AND p->'commandAvailable'='false','blocked '||n);
   BEGIN PERFORM remove_dog_profile(fixture_id(n),1,p->>'graphFingerprint','profile_remove',fixture_id(1000+n)); RAISE EXCEPTION 'expected blocker';
   EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'ACTIVE_OPERATION_EXISTS' THEN RAISE; END IF; END;
 END LOOP;
 BEGIN UPDATE dogs SET name='changed' WHERE id=fixture_id(2); RAISE EXCEPTION 'removed edit allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN UPDATE dogs SET is_active=false WHERE id=fixture_id(4); RAISE EXCEPTION 'direct lifecycle allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN DELETE FROM dogs WHERE id=fixture_id(4); RAISE EXCEPTION 'direct delete allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN UPDATE dogs SET version=100 WHERE id=fixture_id(4); RAISE EXCEPTION 'direct version allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 p:=preview_dog_profile_removal(fixture_id(4));
 BEGIN PERFORM remove_dog_profile(fixture_id(4),2,p->>'graphFingerprint','hard_delete',fixture_id(1104)); RAISE EXCEPTION 'expected stale version';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'STALE_VERSION' THEN RAISE; END IF; END;
 BEGIN PERFORM remove_dog_profile(fixture_id(4),1,'stale','hard_delete',fixture_id(1104)); RAISE EXCEPTION 'expected stale preview';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'STALE_PREVIEW' THEN RAISE; END IF; END;
END $$;
RESET ROLE;
SELECT fixture_assert((SELECT count(*)=9 FROM dog_profile_removal_receipts),'success receipts only');
SELECT fixture_assert((SELECT count(*)=6 FROM operation_schedule_dogs),'schedule references preserved');
DO $$ BEGIN
 BEGIN INSERT INTO operation_schedule_dogs VALUES(fixture_id(9998),fixture_id(2),fixture_id(102),NULL); RAISE EXCEPTION 'new relation allowed'; EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN UPDATE operation_schedules SET status='scheduled' WHERE id=fixture_id(102); RAISE EXCEPTION 'reversal allowed'; EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='00000000-0000-4000-8000-000000000901';
DO $$ BEGIN
 BEGIN PERFORM remove_dog_profile(fixture_id(4),1,'x','hard_delete',fixture_id(1001)); RAISE EXCEPTION 'unauthorized allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN SELECT count(*) FROM dog_profile_removal_receipts; RAISE EXCEPTION 'receipt read allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
ROLLBACK;
