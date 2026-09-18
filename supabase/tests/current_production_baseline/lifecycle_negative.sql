BEGIN;
DO $$ BEGIN IF current_database()<>'dog_current_baseline' OR inet_server_addr() IS NOT NULL THEN RAISE EXCEPTION 'LOCAL_ONLY'; END IF; END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000900',true);
CREATE FUNCTION pg_temp.f(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
DO $$ DECLARE j jsonb; p jsonb; n integer; kind text; rejected boolean; BEGIN
 IF NOT EXISTS(SELECT 1 FROM dogs WHERE id=pg_temp.f(10) AND profile_status='inactive') THEN RAISE EXCEPTION 'MISSING_PRE_V2B_INACTIVE_FIXTURE'; END IF;
 j:=create_operation_schedule(pg_temp.f(22),pg_temp.f(30),'Synthetic removal',now()-interval '3 days',now()-interval '3 days'+interval '1 hour',false,false,'Synthetic',ARRAY[pg_temp.f(900)],ARRAY[pg_temp.f(800)],ARRAY[pg_temp.f(9)],gen_random_uuid());
 PERFORM set_operation_schedule_status((j->>'id')::uuid,(j->>'version')::integer,'completed','Synthetic',gen_random_uuid());
 p:=preview_dog_profile_removal(pg_temp.f(9));
 PERFORM remove_dog_profile(pg_temp.f(9),(p->>'version')::bigint,p->>'graphFingerprint','profile_remove',gen_random_uuid(),'Synthetic');
 FOREACH n IN ARRAY ARRAY[9,10] LOOP
 FOREACH kind IN ARRAY ARRAY['schedule','hotel','long_stay','shared'] LOOP
 rejected:=false;
 BEGIN
 CASE kind
 WHEN 'schedule' THEN
 PERFORM create_operation_schedule(pg_temp.f(22),pg_temp.f(30),'Synthetic reject',now()+interval '3 days',now()+interval '3 days 1 hour',false,false,'Synthetic',ARRAY[pg_temp.f(900)],ARRAY[pg_temp.f(800)],ARRAY[pg_temp.f(n)],gen_random_uuid());
 WHEN 'hotel' THEN
 PERFORM create_flexible_hotel_reservation(pg_temp.f(20),pg_temp.f(30),current_date+3,'09:00',false,current_date+4,'15:00',false,pg_temp.f(40),pg_temp.f(n),pg_temp.f(800),ARRAY[pg_temp.f(900)],'Synthetic',gen_random_uuid());
 WHEN 'long_stay' THEN
 PERFORM create_long_stay_contract(pg_temp.f(800),pg_temp.f(n),current_date+3,current_date+10,pg_temp.f(40),pg_temp.f(54),1000,1,'Synthetic',gen_random_uuid());
 WHEN 'shared' THEN
 PERFORM create_unassigned_shared_room_family_booking(pg_temp.f(800),'Synthetic',false,(SELECT jsonb_agg(jsonb_build_object('stableMemberKey','member-'||x,'dogId',pg_temp.f(x),'serviceType','hotel','assigneeIds',jsonb_build_array(pg_temp.f(900)),'sharedRoomGroupKey','negative','calendarId',pg_temp.f(20),'scheduleTypeId',pg_temp.f(30),'checkInDate',current_date+3,'checkInTime','09:00','checkOutDate',current_date+5,'checkOutTime','15:00','roomTypeId',pg_temp.f(40))) FROM unnest(ARRAY[7,n]) x),pg_temp.f(40),true,gen_random_uuid());
 END CASE;
 EXCEPTION WHEN OTHERS THEN
 IF SQLERRM NOT IN ('INVALID_PROFILE_STATE','DOG_NOT_ACTIVE') AND SQLERRM NOT LIKE '%반려견%' THEN RAISE; END IF;
 rejected:=true;
 END;
 IF NOT rejected THEN RAISE EXCEPTION 'ACCEPTED_NONACTIVE: % %',kind,n; END IF;
 END LOOP; END LOOP;
 RAISE NOTICE 'CURRENT_BASELINE_REAL_RPC_REMOVED_INACTIVE_NEGATIVES_PASS';
END $$;
ROLLBACK;
