-- Synthetic graph integration only; does NOT substitute for existing domain RPC integration.
BEGIN;
SELECT fixture_assert(current_database()='dog_v2b_fixture' AND inet_server_addr() IS NULL,'local only');
SET LOCAL request.jwt.claim.sub='00000000-0000-4000-8000-000000000900';
SET LOCAL ROLE authenticated;
UPDATE dogs SET name='Normal staff edit',breed='Mixed',customer_id=fixture_id(801) WHERE id=fixture_id(31);
SELECT fixture_assert((SELECT version=2 AND updated_by=auth.uid() FROM dogs WHERE id=fixture_id(31)),'normal staff edit');
INSERT INTO dogs(customer_id,name,is_active) VALUES(fixture_id(801),'Normal staff creation',true);
DO $$ DECLARE col text; BEGIN
 FOREACH col IN ARRAY ARRAY['profile_status','is_active','version','profile_status_changed_at','profile_status_changed_by','profile_status_reason','merged_into_dog_id','updated_by'] LOOP
   BEGIN EXECUTE format('UPDATE dogs SET %I=%I WHERE id=fixture_id(31)',col,col); RAISE EXCEPTION 'direct field allowed: %',col;
   EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 END LOOP;
END $$;
RESET ROLE;
-- Normal active relation writes, followed by terminal states, must stay possible.
INSERT INTO operation_schedule_dogs VALUES(fixture_id(4031),fixture_id(31),fixture_id(106),NULL);
INSERT INTO hotel_stays VALUES(fixture_id(4031),fixture_id(31),NULL,NULL,NULL);
UPDATE hotel_stays SET checked_in_at='2026-09-01',checked_out_at='2026-09-02' WHERE id=fixture_id(4031);
INSERT INTO sales VALUES(fixture_id(4031),fixture_id(31),'normal',100,'2026-09-01');
INSERT INTO journal_entries VALUES(fixture_id(4031),fixture_id(31),NULL,fixture_id(700),'completed');
INSERT INTO long_stay_contracts VALUES(fixture_id(4031),fixture_id(31),'completed',NULL,'2026-09-01','2026-09-02');
INSERT INTO hotel_physical_occupancies VALUES(fixture_id(4031),NULL,'completed',NULL,'2026-09-01','2026-09-02');
INSERT INTO hotel_physical_occupancy_members(id,dog_id,occupancy_id,status,archived_at) VALUES(fixture_id(4031),fixture_id(31),fixture_id(4031),'left',NULL);
SET LOCAL ROLE authenticated;
SELECT remove_dog_profile(fixture_id(31),2,preview_dog_profile_removal(fixture_id(31))->>'graphFingerprint','profile_remove',fixture_id(4031));
RESET ROLE;
-- Existing financial follow-up and terminal record maintenance are not new association.
UPDATE sales SET outstanding_amount=0,status='refunded' WHERE id=fixture_id(4031);
UPDATE operation_schedules SET ends_at=ends_at WHERE id=fixture_id(106);
UPDATE operation_schedules SET status='cancelled' WHERE id=fixture_id(106);
UPDATE operation_schedules SET status='completed' WHERE id=fixture_id(106);
SELECT fixture_assert((SELECT outstanding_amount=0 FROM sales WHERE id=fixture_id(4031)),'removed financial follow-up');
DO $$ DECLARE d integer; stmt text; BEGIN
 FOREACH d IN ARRAY ARRAY[2,31] LOOP
   FOREACH stmt IN ARRAY ARRAY[
    'INSERT INTO operation_schedule_dogs VALUES(fixture_id(5001),fixture_id(%s),fixture_id(106),NULL)',
    'INSERT INTO hotel_stays VALUES(fixture_id(5001),fixture_id(%s),NULL,NULL,NULL)',
    'INSERT INTO sales VALUES(fixture_id(5001),fixture_id(%s),''normal'',0,''2026-09-01'')',
    'INSERT INTO journal_entries VALUES(fixture_id(5001),fixture_id(%s),NULL,fixture_id(700),''in_progress'')',
    'INSERT INTO family_booking_members(id,dog_id,family_booking_id,status,archived_at,shared_room_group_id) VALUES(fixture_id(5001),fixture_id(%s),fixture_id(710),''pending'',NULL,NULL)',
    'INSERT INTO long_stay_contracts VALUES(fixture_id(5001),fixture_id(%s),''pending'',NULL,''2026-09-01'',NULL)',
    'INSERT INTO hotel_physical_occupancy_members(id,dog_id,occupancy_id,status,archived_at) VALUES(fixture_id(5001),fixture_id(%s),fixture_id(718),''active'',NULL)'
   ] LOOP
     BEGIN EXECUTE format(stmt,d); RAISE EXCEPTION 'inactive/removed relation allowed';
     EXCEPTION WHEN check_violation THEN IF SQLERRM<>'INVALID_PROFILE_STATE' THEN RAISE; END IF; END;
   END LOOP;
 END LOOP;
 FOREACH stmt IN ARRAY ARRAY[
  'UPDATE operation_schedules SET status=''scheduled'' WHERE id=fixture_id(106)',
  'UPDATE hotel_stays SET checked_out_at=NULL WHERE id=fixture_id(4031)',
  'UPDATE journal_entries SET status=''in_progress'' WHERE id=fixture_id(4031)',
  'UPDATE long_stay_contracts SET status=''active'' WHERE id=fixture_id(4031)',
  'UPDATE hotel_physical_occupancies SET status=''active'' WHERE id=fixture_id(4031)'
 ] LOOP
   BEGIN EXECUTE stmt; RAISE EXCEPTION 'reactivation allowed';
   EXCEPTION WHEN check_violation THEN IF SQLERRM<>'INVALID_PROFILE_STATE' THEN RAISE; END IF; END;
 END LOOP;
 -- Simulated multi-statement command fails after its first insert: no orphan survives.
 BEGIN
  INSERT INTO operation_schedules VALUES(fixture_id(5999),'scheduled','2026-09-18','2026-09-19',NULL);
  INSERT INTO operation_schedule_dogs VALUES(fixture_id(5999),fixture_id(31),fixture_id(5999),NULL);
  RAISE EXCEPTION 'guard expected';
 EXCEPTION WHEN check_violation THEN NULL; END;
 PERFORM fixture_assert(NOT EXISTS(SELECT 1 FROM operation_schedules WHERE id=fixture_id(5999)),'partial command rollback');
END $$;
SELECT fixture_assert(get_historical_dog_identities(ARRAY[fixture_id(31)])->0->>'displayName'='Normal staff edit','history identity preserved');
ROLLBACK;
