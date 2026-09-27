-- Local storage-fixture projection regression, never Production.
BEGIN;
DO $$ BEGIN IF current_database()<>'projection_fixture_008' OR inet_server_addr() IS NOT NULL THEN RAISE EXCEPTION 'LOCAL_FIXTURE_ONLY'; END IF; END $$;
SET LOCAL test.actor='00000000-0000-4000-8000-000000000001';
INSERT INTO hotel_room_types(id,name) VALUES(md5('type')::uuid,'DELUXE');
INSERT INTO hotel_rooms(id,name,room_type_id) VALUES(md5('room')::uuid,'DELUXE 2',md5('type')::uuid);
-- Reproduce baseline cardinalities without copying customer or stay data.
INSERT INTO hotel_stays(id,dog_id,checked_in_at,checked_out_at)
SELECT md5('single'||n)::uuid,md5('dog'||n)::uuid,'2091-01-01Z'::timestamptz,CASE WHEN n<=48 THEN '2091-01-02Z'::timestamptz END FROM generate_series(1,58)n;
INSERT INTO hotel_capacity_reservations(id,source_kind,hotel_stay_id,room_type_id,reserved_from,reserved_until,quantity)
SELECT md5('cap'||n)::uuid,'stay',md5('single'||n)::uuid,md5('type')::uuid,'2091-01-01Z','2091-01-03Z',1 FROM generate_series(1,58)n;
INSERT INTO hotel_room_allocations(id,capacity_reservation_id,room_id,allocated_from,allocated_until)
SELECT md5('allocation'||n)::uuid,md5('cap'||n)::uuid,md5('room')::uuid,'2091-01-01Z','2091-01-03Z' FROM generate_series(1,58)n;
INSERT INTO operation_schedules(id,starts_at)
SELECT md5('in'||n)::uuid,'2091-01-01Z'::timestamptz FROM generate_series(1,58)n UNION ALL SELECT md5('out'||n)::uuid,'2091-01-02Z'::timestamptz FROM generate_series(1,48)n;
INSERT INTO hotel_stay_schedule_events(id,hotel_stay_id,operation_schedule_id,event_kind)
SELECT md5('ei'||n)::uuid,md5('single'||n)::uuid,md5('in'||n)::uuid,'check_in' FROM generate_series(1,58)n UNION ALL SELECT md5('eo'||n)::uuid,md5('single'||n)::uuid,md5('out'||n)::uuid,'check_out' FROM generate_series(1,48)n;
DO $$ DECLARE rows jsonb; BEGIN
rows:=get_operation_hotel_room_projections_v2(ARRAY(SELECT id FROM operation_schedules));
IF jsonb_array_length(rows)<>106 OR EXISTS(SELECT 1 FROM jsonb_array_elements(rows)x WHERE x->>'roomResolutionStatus' IS DISTINCT FROM 'resolved') THEN RAISE EXCEPTION 'SINGLE_106_REGRESSION'; END IF;
END $$;
-- Requested Shared without physical allocation is explicitly unassigned.
INSERT INTO hotel_stays(id,dog_id) VALUES(md5('future')::uuid,md5('future-dog')::uuid);
INSERT INTO family_shared_room_groups(id,status,room_type_id) VALUES(md5('future-group')::uuid,'requested',md5('type')::uuid);
INSERT INTO family_booking_members(id,hotel_stay_id,shared_room_group_id,service_type) VALUES(md5('future-member')::uuid,md5('future')::uuid,md5('future-group')::uuid,'hotel');
INSERT INTO operation_schedules(id,starts_at) VALUES(md5('future-event')::uuid,'2091-01-01Z');
INSERT INTO hotel_stay_schedule_events(id,hotel_stay_id,operation_schedule_id,event_kind) VALUES(md5('future-link')::uuid,md5('future')::uuid,md5('future-event')::uuid,'check_in');
DO $$ BEGIN IF get_operation_hotel_room_projections_v2(ARRAY[md5('future-event')::uuid])->0->>'roomResolutionStatus' IS DISTINCT FROM 'unassigned' THEN RAISE EXCEPTION 'FUTURE_UNASSIGNED'; END IF; END $$;
INSERT INTO hotel_physical_occupancy_members(id,occupancy_id,family_booking_member_id,hotel_stay_id,status) VALUES(md5('pm')::uuid,md5('po')::uuid,md5('future-member')::uuid,md5('future')::uuid,'active');
INSERT INTO hotel_physical_occupancies(id,shared_room_group_id,room_id,room_type_id,room_allocation_id,status) VALUES(md5('po')::uuid,md5('future-group')::uuid,md5('room')::uuid,md5('type')::uuid,md5('future-a')::uuid,'active');
INSERT INTO hotel_room_allocations(id,room_id,allocated_from,allocated_until,version,updated_at) VALUES(md5('future-a')::uuid,md5('room')::uuid,'2091-01-01Z','2091-01-03Z',1,'2090-12-31Z');
UPDATE family_shared_room_groups SET status='allocated' WHERE id=md5('future-group')::uuid;
DO $$ BEGIN IF get_operation_hotel_room_projections_v2(ARRAY[md5('future-event')::uuid])->0->>'roomResolutionStatus' IS DISTINCT FROM 'resolved' THEN RAISE EXCEPTION 'FUTURE_ASSIGNED'; END IF; END $$;
UPDATE hotel_stays SET checked_in_at='2091-01-01Z' WHERE id=md5('future')::uuid;
DO $$ BEGIN IF get_operation_hotel_room_projections_v2(ARRAY[md5('future-event')::uuid])->0->>'roomResolutionStatus' IS DISTINCT FROM 'resolved' THEN RAISE EXCEPTION 'ACTIVE_SHARED'; END IF; END $$;
SELECT 'PASS: Single 58 check-in / 48 checkout; future requested; future assigned; active Shared';
ROLLBACK;
