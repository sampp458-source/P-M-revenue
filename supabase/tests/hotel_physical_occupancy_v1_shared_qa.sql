-- Local bounded fixture only; all synthetic mutations roll back.
BEGIN;
DO $$ BEGIN IF current_database()<>'single_checkin_fixture_016' OR inet_server_addr() IS NOT NULL THEN RAISE EXCEPTION 'LOCAL_ONLY'; END IF; END $$;
CREATE FUNCTION pg_temp.ok(v boolean,label text) RETURNS void LANGUAGE plpgsql AS $$BEGIN IF v IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL %',label; END IF; RAISE NOTICE 'PASS %',label; END$$;
CREATE FUNCTION pg_temp.f(n int) RETURNS uuid LANGUAGE sql AS $$SELECT ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
SELECT set_config('test.actor',pg_temp.f(900)::text,true);
INSERT INTO profiles VALUES(pg_temp.f(900));
INSERT INTO hotel_room_types(id,name,code) VALUES(pg_temp.f(1),'DELUXE','DELUXE');
INSERT INTO hotel_rooms(id,name,room_type_id,sort_order) SELECT pg_temp.f(10+n),'D'||n,pg_temp.f(1),n FROM generate_series(1,6)n;
INSERT INTO hotel_stays(id,dog_id,created_by,updated_by) SELECT pg_temp.f(20+n),pg_temp.f(100+n),pg_temp.f(900),pg_temp.f(900) FROM generate_series(1,4)n;

INSERT INTO dogs VALUES(pg_temp.f(101),'토리'),(pg_temp.f(102),'모카');
INSERT INTO family_bookings VALUES(pg_temp.f(70),pg_temp.f(80),null);
INSERT INTO family_shared_room_groups(id,family_booking_id,room_type_id) VALUES(pg_temp.f(71),pg_temp.f(70),pg_temp.f(1));
INSERT INTO hotel_capacity_reservations(id,physical_occupancy_id,source_kind,quantity,room_type_id,reserved_from,reserved_until,created_by,updated_by)
VALUES(pg_temp.f(31),pg_temp.f(60),'shared_occupancy',1,pg_temp.f(1),now()-interval '3 hours',now()-interval '1 hour',pg_temp.f(900),pg_temp.f(900));
INSERT INTO hotel_room_allocations(id,capacity_reservation_id,room_id,allocated_from,allocated_until,created_by,updated_by)
VALUES(pg_temp.f(41),pg_temp.f(31),pg_temp.f(11),now()-interval '3 hours',now()-interval '1 hour',pg_temp.f(900),pg_temp.f(900));
INSERT INTO hotel_physical_occupancies(id,family_booking_id,shared_room_group_id,customer_id,room_type_id,room_id,occupied_from,occupied_until,capacity_reservation_id,room_allocation_id,status,version)
VALUES(pg_temp.f(60),pg_temp.f(70),pg_temp.f(71),pg_temp.f(80),pg_temp.f(1),pg_temp.f(11),now()-interval '3 hours',now()-interval '1 hour',pg_temp.f(31),pg_temp.f(41),'active',1);
INSERT INTO hotel_physical_occupancy_members(id,occupancy_id,hotel_stay_id,dog_id,status)
VALUES(pg_temp.f(61),pg_temp.f(60),pg_temp.f(21),pg_temp.f(101),'active'),(pg_temp.f(62),pg_temp.f(60),pg_temp.f(22),pg_temp.f(102),'active');
UPDATE hotel_stays SET checked_in_at=now()-interval '3 hours',checked_in_by=pg_temp.f(900) WHERE id IN(pg_temp.f(21),pg_temp.f(22));
SELECT pg_temp.ok((SELECT count(distinct room_id)=1 AND count(*)=2 FROM hotel_current_physical_rooms_internal()),'J Shared two dogs one room');
SELECT pg_temp.ok(jsonb_array_length(get_hotel_shared_room_occupancies((now() AT TIME ZONE 'Asia/Seoul')::date))=1,'F Shared expired interval retained');
SELECT assert_shared_hotel_occupancy_internal(pg_temp.f(60));
DO $$BEGIN
 BEGIN UPDATE hotel_room_types SET name='STANDARD',code='STANDARD' WHERE id=pg_temp.f(1);
 PERFORM assert_shared_hotel_occupancy_internal(pg_temp.f(60));
 RAISE EXCEPTION 'STANDARD accepted'; EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS L STANDARD Shared rejected'; END;
END$$;
SELECT complete_shared_hotel_member_check_out(pg_temp.f(60),pg_temp.f(21),1,(SELECT version FROM hotel_stays WHERE id=pg_temp.f(21)),now()-interval '2 minutes',gen_random_uuid());
SELECT pg_temp.ok((SELECT count(*)=1 FROM hotel_current_physical_rooms_internal()),'J real member checkout retains room');
SELECT pg_temp.ok((SELECT status='active' AND completed_at IS NULL FROM hotel_physical_occupancies WHERE id=pg_temp.f(60)), 'first member retains active occupancy');
SELECT pg_temp.ok((SELECT count(*)=1 FROM hotel_physical_occupancy_members WHERE occupancy_id=pg_temp.f(60) AND status='active'),'first member leaves one active member');
SELECT complete_shared_hotel_member_check_out(pg_temp.f(60),pg_temp.f(22),1,(SELECT version FROM hotel_stays WHERE id=pg_temp.f(22)),now()-interval '1 minute',gen_random_uuid());
SELECT pg_temp.ok(NOT EXISTS(SELECT 1 FROM hotel_current_physical_rooms_internal()),'K real last-member late checkout releases room');
SELECT pg_temp.ok((SELECT status='completed' FROM hotel_physical_occupancies WHERE id=pg_temp.f(60)),'K occupancy completed');
SELECT pg_temp.ok((SELECT status='released' FROM family_shared_room_groups WHERE id=pg_temp.f(71)),'last member releases shared group');
ROLLBACK;
