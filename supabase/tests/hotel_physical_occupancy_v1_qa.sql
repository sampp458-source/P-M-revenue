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
INSERT INTO hotel_capacity_reservations(id,hotel_stay_id,source_kind,quantity,room_type_id,reserved_from,reserved_until,created_by,updated_by)
VALUES(pg_temp.f(31),pg_temp.f(21),'stay',1,pg_temp.f(1),now()-interval '3 hours',now()-interval '1 hour',pg_temp.f(900),pg_temp.f(900)),
(pg_temp.f(32),pg_temp.f(22),'stay',1,pg_temp.f(1),now()-interval '1 hour',now()+interval '1 day',pg_temp.f(900),pg_temp.f(900));
INSERT INTO hotel_room_allocations(id,capacity_reservation_id,room_id,allocated_from,allocated_until,created_by,updated_by)
VALUES(pg_temp.f(41),pg_temp.f(31),pg_temp.f(11),now()-interval '3 hours',now()-interval '2 hours',pg_temp.f(900),pg_temp.f(900)),
(pg_temp.f(42),pg_temp.f(31),pg_temp.f(12),now()-interval '2 hours',now()-interval '1 hour',pg_temp.f(900),pg_temp.f(900));
-- A stale preallocation was made before the older guest became overdue.
INSERT INTO hotel_capacity_reservations(id,hotel_stay_id,source_kind,quantity,room_type_id,reserved_from,reserved_until,created_by,updated_by)
VALUES(pg_temp.f(33),pg_temp.f(23),'stay',1,pg_temp.f(1),now()-interval '1 hour',now()+interval '1 day',pg_temp.f(900),pg_temp.f(900));
INSERT INTO hotel_room_allocations(id,capacity_reservation_id,room_id,allocated_from,allocated_until,created_by,updated_by)
VALUES(pg_temp.f(44),pg_temp.f(33),pg_temp.f(12),now()-interval '1 hour',now()+interval '1 day',pg_temp.f(900),pg_temp.f(900));
UPDATE hotel_stays SET checked_in_at=now()-interval '3 hours',checked_in_by=pg_temp.f(900) WHERE id=pg_temp.f(21);
SELECT pg_temp.ok((SELECT count(*)=1 AND min(room_id::text)=pg_temp.f(12)::text FROM hotel_current_physical_rooms_internal()),'B/C/F/G overdue uses only latest Room B');
SELECT pg_temp.ok(EXISTS(SELECT 1 FROM jsonb_array_elements(get_hotel_operations_snapshot_v2((now() AT TIME ZONE 'Asia/Seoul')::date)->'stays') x WHERE x->>'id'=pg_temp.f(21)::text),'F current snapshot includes unfinished overdue');
SELECT pg_temp.ok((get_hotel_operations_snapshot_v2((now() AT TIME ZONE 'Asia/Seoul')::date)->>'physicalOccupiedRooms')::int=1,'physical count');
DO $$BEGIN
 BEGIN INSERT INTO hotel_room_allocations(id,capacity_reservation_id,room_id,allocated_from,allocated_until,created_by,updated_by)
 VALUES(pg_temp.f(43),pg_temp.f(32),pg_temp.f(12),now(),now()+interval '1 day',pg_temp.f(900),pg_temp.f(900));
 RAISE EXCEPTION 'guard did not reject'; EXCEPTION WHEN exclusion_violation THEN RAISE NOTICE 'PASS I immediate allocation SERVER REJECT'; END;
END$$;
DO $$BEGIN
 BEGIN PERFORM complete_hotel_check_in(pg_temp.f(23),(SELECT version FROM hotel_stays WHERE id=pg_temp.f(23)),now(),gen_random_uuid());
 RAISE EXCEPTION 'actual check-in accepted occupied room'; EXCEPTION WHEN exclusion_violation THEN RAISE NOTICE 'PASS I real preassigned check-in SERVER REJECT'; END;
END$$;
DELETE FROM hotel_room_allocations WHERE id=pg_temp.f(44);
INSERT INTO operation_schedules(id,starts_at) VALUES(pg_temp.f(50),now()-interval '1 hour');
INSERT INTO hotel_stay_schedule_events(id,hotel_stay_id,operation_schedule_id,event_kind) VALUES(pg_temp.f(51),pg_temp.f(22),pg_temp.f(50),'check_in');
SELECT pg_temp.ok(EXISTS(SELECT 1 FROM jsonb_array_elements(get_hotel_single_room_eligibility(pg_temp.f(22),'actual_check_in',now())->'rooms') x WHERE x->>'roomId'=pg_temp.f(12)::text AND (x->>'eligible')::boolean=false),'I read eligibility physical block');
DO $$BEGIN
 BEGIN PERFORM check_in_unassigned_hotel_stay(pg_temp.f(22),(SELECT version FROM hotel_stays WHERE id=pg_temp.f(22)),(SELECT version FROM hotel_capacity_reservations WHERE id=pg_temp.f(32)),pg_temp.f(12),now(),gen_random_uuid());
 RAISE EXCEPTION '016 accepted occupied room'; EXCEPTION WHEN exclusion_violation THEN RAISE NOTICE 'PASS I real 016 SERVER REJECT'; END;
END$$;
-- Future planning remains finite and allowed (a different future segment, not actual entry).
UPDATE hotel_capacity_reservations SET reserved_from=now()+interval '1 day',reserved_until=now()+interval '2 days' WHERE id=pg_temp.f(32);
INSERT INTO hotel_room_allocations(id,capacity_reservation_id,room_id,allocated_from,allocated_until,created_by,updated_by)
VALUES(pg_temp.f(43),pg_temp.f(32),pg_temp.f(12),now()+interval '1 day',now()+interval '2 days',pg_temp.f(900),pg_temp.f(900));
SELECT assert_hotel_capacity_available(pg_temp.f(1),now()+interval '1 day',now()+interval '2 days',1,pg_temp.f(32));
SELECT pg_temp.ok(true,'H future planned allocation/capacity preserved');
-- Stale preallocation ended/planned intervals do not bypass actual-entry guard.
UPDATE hotel_room_allocations SET allocated_from=now()-interval '1 hour',allocated_until=now()-interval '1 minute' WHERE id=pg_temp.f(43);
DO $$BEGIN
 BEGIN UPDATE hotel_stays SET checked_in_at=now()-interval '1 hour',checked_in_by=pg_temp.f(900) WHERE id=pg_temp.f(22);
 RAISE EXCEPTION 'guard did not reject'; EXCEPTION WHEN exclusion_violation THEN RAISE NOTICE 'PASS I stale actual entry SERVER REJECT'; END;
END$$;
DELETE FROM hotel_room_allocations WHERE id=pg_temp.f(43);
-- Exact 35-minute late completion, after the date-rollover scenario above.
UPDATE hotel_capacity_reservations SET reserved_until=now()-interval '36 minutes' WHERE id=pg_temp.f(31);
UPDATE hotel_room_allocations SET allocated_until=now()-interval '36 minutes' WHERE id=pg_temp.f(42);
-- Real existing checkout command, late and collision free.
SELECT complete_hotel_check_out(pg_temp.f(21),(SELECT version FROM hotel_stays WHERE id=pg_temp.f(21)),now()-interval '1 minute',gen_random_uuid());
SELECT pg_temp.ok(NOT EXISTS(SELECT 1 FROM hotel_current_physical_rooms_internal()),'D real late checkout releases physical occupancy');
SELECT pg_temp.ok((SELECT checked_out_at-checkout_previous_reserved_until=interval '35 minutes' FROM hotel_stays WHERE id=pg_temp.f(21)),'D actual checkout stored 35 minutes late');
-- M: existing infinity segment remains held; released archived segment is not resurrected.
UPDATE hotel_stays SET checked_out_at=null WHERE id=pg_temp.f(21);
UPDATE hotel_capacity_reservations SET reserved_until='infinity' WHERE id=pg_temp.f(31);
UPDATE hotel_room_allocations SET allocated_until='infinity' WHERE id=pg_temp.f(42);
SELECT pg_temp.ok((SELECT count(*)=1 FROM hotel_current_physical_rooms_internal()),'M infinity hold preserved');
UPDATE hotel_room_allocations SET allocated_until=now()-interval '1 minute' WHERE id=pg_temp.f(42);
UPDATE hotel_capacity_reservations SET archived_at=now(),reserved_until=now()-interval '1 minute' WHERE id=pg_temp.f(31);
SELECT pg_temp.ok(NOT EXISTS(SELECT 1 FROM hotel_current_physical_rooms_internal()),'M release-room segment not resurrected');
INSERT INTO hotel_capacity_reservations(id,hotel_stay_id,source_kind,quantity,room_type_id,reserved_from,reserved_until,created_by,updated_by)
VALUES(pg_temp.f(34),pg_temp.f(21),'stay',1,pg_temp.f(1),now()-interval '1 second','infinity',pg_temp.f(900),pg_temp.f(900));
INSERT INTO hotel_room_allocations(id,capacity_reservation_id,room_id,allocated_from,allocated_until,created_by,updated_by)
VALUES(pg_temp.f(45),pg_temp.f(34),pg_temp.f(13),now()-interval '1 second','infinity',pg_temp.f(900),pg_temp.f(900));
SELECT pg_temp.ok((SELECT count(*)=1 AND min(room_id::text)=pg_temp.f(13)::text FROM hotel_current_physical_rooms_internal()),'M return selects new active segment only');
SELECT pg_temp.ok(NOT has_function_privilege('authenticated','public.hotel_current_physical_rooms_internal()','EXECUTE'),'private helper ACL');
SELECT pg_temp.ok(NOT has_function_privilege('anon','public.assert_hotel_physical_room_available_internal(uuid,uuid)','EXECUTE'),'private guard ACL');
ROLLBACK;
