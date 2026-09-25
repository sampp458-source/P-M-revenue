-- Bounded synthetic cutover / today's legacy Single shape. No Production identifiers.
BEGIN;
DO $$ BEGIN IF current_database()<>'single_checkin_fixture_016' OR inet_server_addr() IS NOT NULL THEN RAISE EXCEPTION 'LOCAL_ONLY'; END IF; END $$;
CREATE FUNCTION pg_temp.ok(v boolean,label text) RETURNS void LANGUAGE plpgsql AS $$BEGIN IF v IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL %',label; END IF; RAISE NOTICE 'PASS %',label; END$$;
CREATE FUNCTION pg_temp.f(n int) RETURNS uuid LANGUAGE sql AS $$SELECT ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
SELECT set_config('test.actor',pg_temp.f(900)::text,true);
INSERT INTO profiles VALUES(pg_temp.f(900));
INSERT INTO hotel_room_types(id,name,code) VALUES(pg_temp.f(1),'DELUXE','DELUXE');
INSERT INTO hotel_rooms(id,name,room_type_id,sort_order) SELECT pg_temp.f(10+n),'D'||n,pg_temp.f(1),n FROM generate_series(1,6)n;
INSERT INTO hotel_operation_settings VALUES(pg_temp.f(800),'default',7,'13:00','18:00','Asia/Seoul',now(),null);
INSERT INTO hotel_stays(id,dog_id,created_by,updated_by) SELECT pg_temp.f(20+n),pg_temp.f(100+n),pg_temp.f(900),pg_temp.f(900) FROM generate_series(1,4)n;
INSERT INTO hotel_capacity_reservations(id,hotel_stay_id,source_kind,quantity,room_type_id,reserved_from,reserved_until,created_by,updated_by)
VALUES(pg_temp.f(31),pg_temp.f(21),'stay',1,pg_temp.f(1),'2026-08-15 09:30+09','2026-08-16 18:00+09',pg_temp.f(900),pg_temp.f(900)),
(pg_temp.f(32),pg_temp.f(22),'stay',1,pg_temp.f(1),'2026-09-23 07:50+09','2026-09-25 20:00+09',pg_temp.f(900),pg_temp.f(900)),
(pg_temp.f(33),pg_temp.f(23),'stay',1,pg_temp.f(1),now()-interval '30 minutes',now()+interval '1 hour',pg_temp.f(900),pg_temp.f(900));
INSERT INTO hotel_room_allocations(id,capacity_reservation_id,room_id,allocated_from,allocated_until,created_by,updated_by)
SELECT pg_temp.f(40+(row_number() over(order by id))::int),id,pg_temp.f(CASE WHEN id=pg_temp.f(32) THEN 15 ELSE 11 END),reserved_from,reserved_until,pg_temp.f(900),pg_temp.f(900) FROM hotel_capacity_reservations;
UPDATE hotel_stays SET checked_in_at='2026-08-15 09:30+09',checked_in_by=pg_temp.f(900) WHERE id=pg_temp.f(21);
UPDATE hotel_stays SET checked_in_at='2026-09-23 07:50+09',checked_in_by=pg_temp.f(900) WHERE id=pg_temp.f(22);
INSERT INTO operation_schedules(id,starts_at) VALUES(pg_temp.f(51),'2026-08-16 18:00+09'),(pg_temp.f(52),'2026-09-25 20:00+09');
INSERT INTO hotel_stay_schedule_events(id,hotel_stay_id,operation_schedule_id,event_kind) VALUES(pg_temp.f(61),pg_temp.f(21),pg_temp.f(51),'check_out'),(pg_temp.f(62),pg_temp.f(22),pg_temp.f(52),'check_out');
SELECT pg_temp.ok(NOT EXISTS(SELECT 1 FROM hotel_current_physical_rooms_internal()),'A pre-cutover stale and legacy departure do not create physical holds');
SELECT complete_hotel_check_in(pg_temp.f(23),1,now(),gen_random_uuid());
SELECT pg_temp.ok((SELECT count(*)=1 FROM hotel_current_physical_rooms_internal()),'A/B old stale does not block real post-cutover entry; before planned end held');
SELECT pg_temp.ok((SELECT checked_out_at IS NULL AND checked_in_at='2026-08-15 09:30+09' FROM hotel_stays WHERE id=pg_temp.f(21)),'A no stale backfill or implicit checkout');
SELECT pg_temp.ok(jsonb_array_length(get_hotel_operations_snapshot(current_date)->'rooms')=6,'Production rooms extension preserved');
SELECT pg_temp.ok((get_hotel_operations_snapshot(current_date)->'settings'->>'version')::int=7,'Production settings extension preserved');
-- Explicit old state remains untouched; today's legacy departure remains separately accessible even after midnight.
SELECT pg_temp.ok(EXISTS(SELECT 1 FROM jsonb_array_elements(get_hotel_operations_snapshot((now() at time zone 'Asia/Seoul')::date)->'stays') j WHERE j->>'id'=pg_temp.f(22)::text),'legacy due checkout remains in snapshot');
SELECT complete_hotel_check_out(pg_temp.f(22),(SELECT version FROM hotel_stays WHERE id=pg_temp.f(22)),greatest('2026-09-25 20:35+09'::timestamptz,now()),gen_random_uuid());
SELECT pg_temp.ok((SELECT checked_out_at IS NOT NULL FROM hotel_stays WHERE id=pg_temp.f(22)),'Today Single pre-cutover shape completes through unchanged Production RPC');
SELECT pg_temp.ok((SELECT checked_out_at IS NULL FROM hotel_stays WHERE id=pg_temp.f(21)),'old stale still untouched after other checkout');
ROLLBACK;
