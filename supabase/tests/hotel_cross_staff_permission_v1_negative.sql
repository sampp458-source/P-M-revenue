BEGIN;
DO $$ BEGIN IF current_database()<>'dog_current_baseline' OR inet_server_addr() IS NOT NULL THEN RAISE EXCEPTION 'LOCAL_ONLY'; END IF; END $$;
CREATE FUNCTION pg_temp.f(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
UPDATE operation_memberships SET is_active=false WHERE profile_id=pg_temp.f(904);
UPDATE profiles SET account_status='inactive',is_active=false WHERE id=pg_temp.f(905);
UPDATE profiles SET account_status='pending' WHERE id=pg_temp.f(906);
-- Profile triggers derive is_active from account_status. Keep memberships
-- active in these synthetic fixtures to isolate the profile/account guard.
UPDATE operation_memberships SET is_active=true WHERE profile_id IN (pg_temp.f(905),pg_temp.f(906));
DELETE FROM operation_memberships WHERE profile_id=pg_temp.f(907);
SET LOCAL ROLE authenticated;
CREATE FUNCTION pg_temp.denied(q text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 BEGIN EXECUTE q; EXCEPTION WHEN insufficient_privilege THEN RETURN; END;
 RAISE EXCEPTION 'EXPECTED_42501: %',q;
END $$;
DO $$ DECLARE n integer; q text; s jsonb; h jsonb; sid uuid; d date:=(now() AT TIME ZONE 'Asia/Seoul')::date;
BEGIN
 PERFORM set_config('request.jwt.claim.sub',pg_temp.f(902)::text,true);
 s:=create_operation_schedule(pg_temp.f(22),pg_temp.f(30),'non-Hotel',now(),now()+interval '1 hour',false,false,NULL,ARRAY[pg_temp.f(902)],ARRAY[pg_temp.f(800)],ARRAY[pg_temp.f(1)],gen_random_uuid());sid:=(s->>'id')::uuid;
 PERFORM set_config('request.jwt.claim.sub',pg_temp.f(903)::text,true);
 IF can_manage_operation_schedule(sid) THEN RAISE EXCEPTION 'CALENDAR_OPENED'; END IF;
 PERFORM pg_temp.denied(format('SELECT set_operation_schedule_status(%L::uuid,%s,''completed'',''no'',gen_random_uuid())',sid,s->>'version'));
 PERFORM pg_temp.denied(format('SELECT update_operation_schedule(%L::uuid,%s,pg_temp.f(22),pg_temp.f(30),''no'',now(),now()+interval ''1 hour'',false,false,NULL,ARRAY[pg_temp.f(902)],ARRAY[pg_temp.f(800)],ARRAY[pg_temp.f(1)],gen_random_uuid())',sid,s->>'version'));
 PERFORM set_config('request.jwt.claim.sub',pg_temp.f(902)::text,true);
 s:=create_operation_schedule(pg_temp.f(20),pg_temp.f(30),'Hotel calendar without stay',now(),now()+interval '1 hour',false,false,NULL,ARRAY[pg_temp.f(902)],ARRAY[pg_temp.f(800)],ARRAY[pg_temp.f(1)],gen_random_uuid());
 PERFORM set_config('request.jwt.claim.sub',pg_temp.f(903)::text,true);
 IF can_manage_operation_schedule((s->>'id')::uuid) THEN RAISE EXCEPTION 'UNLINKED_HOTEL_OPENED'; END IF;
 PERFORM set_config('request.jwt.claim.sub',pg_temp.f(902)::text,true);
 h:=create_flexible_hotel_reservation(pg_temp.f(20),pg_temp.f(30),d,'00:00',false,d+2,'18:00',false,pg_temp.f(40),pg_temp.f(1),pg_temp.f(800),ARRAY[pg_temp.f(902)],'negative',gen_random_uuid());
 sid:=(h->>'id')::uuid;
 -- Every unauthorised identity is rejected before normal business-state checks.
 FOR n IN 904..907 LOOP
  PERFORM set_config('request.jwt.claim.sub',pg_temp.f(n)::text,true);
  IF is_active_operation_member() OR can_manage_operation_schedule((SELECT operation_schedule_id FROM hotel_stay_schedule_events WHERE hotel_stay_id=sid LIMIT 1)) THEN RAISE EXCEPTION 'INACTIVE_ALLOWED'; END IF;
  FOREACH q IN ARRAY ARRAY[
   'create_flexible_hotel_reservation(pg_temp.f(20),pg_temp.f(30),current_date,''00:00'',false,current_date+2,''18:00'',false,pg_temp.f(40),pg_temp.f(1),pg_temp.f(800),ARRAY[pg_temp.f(902)],NULL,gen_random_uuid())',
   format('update_flexible_hotel_reservation(%L::uuid,1,pg_temp.f(20),pg_temp.f(30),current_date,''00:00'',false,current_date+2,''18:00'',false,pg_temp.f(40),pg_temp.f(1),pg_temp.f(800),ARRAY[pg_temp.f(902)],NULL,gen_random_uuid())',sid),
   format('cancel_hotel_reservation(%L::uuid,1,''no'',gen_random_uuid())',sid),
   format('assign_hotel_room(%L::uuid,1,pg_temp.f(51),''no'',gen_random_uuid())',sid),
   format('unassign_hotel_room_before_check_in(%L::uuid,1,''no'',gen_random_uuid())',sid),
   format('reassign_hotel_room_before_check_in(%L::uuid,1,pg_temp.f(52),''no'',gen_random_uuid())',sid),
   format('move_hotel_room_same_type(%L::uuid,1,pg_temp.f(52),now(),''no'',gen_random_uuid())',sid),
   format('change_room_type_before_check_in(%L::uuid,1,pg_temp.f(61),''no'',gen_random_uuid())',sid),
   format('change_room_type_after_check_in(%L::uuid,1,pg_temp.f(61),now(),''no'',gen_random_uuid())',sid),
   format('complete_hotel_check_in(%L::uuid,1,now(),gen_random_uuid())',sid),
   format('complete_hotel_check_out(%L::uuid,1,now(),gen_random_uuid())',sid),
   format('finalize_and_complete_hotel_check_in(%L::uuid,1,now(),pg_temp.f(40),pg_temp.f(51),gen_random_uuid())',sid),
   format('finalize_and_complete_hotel_check_out(%L::uuid,1,now(),gen_random_uuid())',sid),
   format('update_checked_in_hotel_planned_checkout(%L::uuid,1,current_date+2,''18:00'',false,gen_random_uuid())',sid),
   format('complete_shared_hotel_check_in(gen_random_uuid(),%L::uuid,1,1,now(),gen_random_uuid())',sid),
   format('complete_shared_hotel_member_check_out(gen_random_uuid(),%L::uuid,1,1,now(),gen_random_uuid())',sid),
   'create_shared_hotel_room_occupancy(gen_random_uuid(),pg_temp.f(55),gen_random_uuid())',
   'unassign_shared_hotel_room_before_check_in(gen_random_uuid(),1,''no'',gen_random_uuid())',
   'cancel_shared_hotel_room_family_booking(gen_random_uuid(),1,''no'',gen_random_uuid())'
  ] LOOP PERFORM pg_temp.denied('SELECT public.'||q); END LOOP;
  RAISE NOTICE 'NEGATIVE_IDENTITY_%_ALL_COMMANDS_PASS',n;
 END LOOP;
 RAISE NOTICE 'NON_HOTEL_AND_UNLINKED_HOTEL_CALENDAR_REGRESSION_PASS';
END $$;
ROLLBACK;
