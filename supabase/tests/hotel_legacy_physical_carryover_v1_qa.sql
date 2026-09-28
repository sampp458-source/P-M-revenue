-- Synthetic, socket-only fixture. No Production connection or identifiers.
BEGIN;
DO $$ BEGIN IF current_database()<>'single_checkin_fixture_016' OR inet_server_addr() IS NOT NULL THEN RAISE EXCEPTION 'LOCAL_ONLY'; END IF; END $$;
CREATE FUNCTION pg_temp.ok(v boolean,label text) RETURNS void LANGUAGE plpgsql AS $$BEGIN IF v IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL %',label; END IF; RAISE NOTICE 'PASS %',label; END$$;
CREATE FUNCTION pg_temp.f(n int) RETURNS uuid LANGUAGE sql AS $$SELECT ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
SELECT set_config('test.actor',pg_temp.f(900)::text,true);
INSERT INTO profiles VALUES(pg_temp.f(900));
INSERT INTO hotel_room_types(id,name,code) VALUES(pg_temp.f(1),'DELUXE','DELUXE'),(pg_temp.f(2),'STANDARD','STANDARD');
INSERT INTO hotel_rooms(id,name,room_type_id,sort_order) SELECT pg_temp.f(10+n),'D'||n,pg_temp.f(1),n FROM generate_series(1,15)n;
CREATE FUNCTION pg_temp.stay(n int,lo timestamptz,hi timestamptz,actual_in timestamptz,audit_at timestamptz)
RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 INSERT INTO hotel_stays(id,dog_id,checked_in_at,created_by,updated_by)
 VALUES(pg_temp.f(100+n),pg_temp.f(1000+n),actual_in,pg_temp.f(900),pg_temp.f(900));
 INSERT INTO hotel_capacity_reservations(id,hotel_stay_id,source_kind,quantity,room_type_id,reserved_from,reserved_until,created_by,updated_by)
 VALUES(pg_temp.f(200+n),pg_temp.f(100+n),'stay',1,pg_temp.f(1),lo,hi,pg_temp.f(900),pg_temp.f(900));
 INSERT INTO hotel_room_allocations(id,capacity_reservation_id,room_id,allocated_from,allocated_until,created_by,updated_by)
 VALUES(pg_temp.f(300+n),pg_temp.f(200+n),pg_temp.f(10+n),lo,hi,pg_temp.f(900),pg_temp.f(900));
 UPDATE entity_audit_events SET created_at=audit_at WHERE entity_id IN(pg_temp.f(100+n),pg_temp.f(200+n),pg_temp.f(300+n));
END $$;
SELECT pg_temp.stay(1,'2026-09-23 14:20+09','2026-09-28 12:40+09','2026-09-23 14:20+09','2026-09-23 14:21+09');
SELECT pg_temp.stay(2,'2026-08-15 09:30+09','2026-08-16 18:00+09','2026-08-15 09:30+09','2026-08-15 09:31+09');
SELECT pg_temp.stay(3,'2026-08-16 16:12+09','2026-08-18 00:00+09','2026-08-16 16:12+09','2026-08-16 16:13+09');
SELECT pg_temp.stay(4,'2026-09-21 19:51+09','2026-09-23 22:00+09','2026-09-21 19:51+09','2026-09-21 19:52+09');
SELECT pg_temp.stay(5,'2026-09-22 12:16+09','2026-09-23 18:00+09','2026-09-22 12:16+09','2026-09-22 12:17+09');
SELECT pg_temp.stay(6,'2026-09-23 14:20+09','2026-09-25 00:00+09','2026-09-23 14:20+09','2026-09-23 14:21+09');
-- Backdated allocation written after cutover is not an at-cutover anchor.
SELECT pg_temp.stay(7,'2026-09-25 00:00+09','infinity','2026-09-23 14:20+09','2026-09-25 00:01+09');
SELECT pg_temp.stay(8,'2026-09-23 14:20+09','infinity','2026-09-23 14:20+09','2026-09-23 14:21+09');
SELECT pg_temp.ok((SELECT array_agg(stay_id ORDER BY stay_id)=ARRAY[pg_temp.f(101),pg_temp.f(108)] FROM hotel_legacy_physical_anchors_internal()),'cutover overlap only; four stale negatives and half-open boundary excluded');
SELECT pg_temp.ok((SELECT room_id=pg_temp.f(11) FROM hotel_current_physical_rooms_internal() WHERE stay_id=pg_temp.f(101)),'expired Benger-like planned segment retained');
SELECT pg_temp.ok((SELECT count(*)=2 FROM hotel_current_physical_rooms_internal()),'legacy physical cardinality, no stale revival');
DO $$ BEGIN
 PERFORM assert_hotel_physical_room_available_internal(pg_temp.f(11),pg_temp.f(999));
 RAISE EXCEPTION 'guard accepted occupied room';
EXCEPTION WHEN exclusion_violation THEN RAISE NOTICE 'PASS immediate physical guard 23P01'; END $$;
-- Retention or missing proof fails closed; never infer an anchor from current dates.
SAVEPOINT before_proof_loss;
DELETE FROM entity_audit_events WHERE entity_type='hotel_stays' AND entity_id=pg_temp.f(101);
SELECT pg_temp.ok(NOT EXISTS(SELECT 1 FROM hotel_legacy_physical_anchors_internal() WHERE stay_id=pg_temp.f(101)),'missing audit chain rejects carryover anchor');
SELECT pg_temp.ok(NOT EXISTS(SELECT 1 FROM hotel_current_physical_rooms_internal() WHERE stay_id=pg_temp.f(101)),'missing proof never invents physical room');
ROLLBACK TO before_proof_loss;
SAVEPOINT before_proof_gap;
UPDATE hotel_room_allocations SET version=version+1 WHERE id=pg_temp.f(301);
DELETE FROM entity_audit_events WHERE entity_type='hotel_room_allocations' AND entity_id=pg_temp.f(301) AND action='created';
SELECT pg_temp.ok(NOT EXISTS(SELECT 1 FROM hotel_legacy_physical_anchors_internal() WHERE stay_id=pg_temp.f(101)),'incomplete retained audit chain rejects carryover anchor');
ROLLBACK TO before_proof_gap;
-- Actual frontend RPC: current Production v2 plus candidate base snapshot.
CREATE FUNCTION pg_temp.capacity_payload(j jsonb) RETURNS jsonb LANGUAGE sql AS $$
SELECT jsonb_build_object('selectedDateUnassigned',j->'selectedDateUnassigned',
 'confirmedRemainingByType',j->'confirmedRemainingByType','overallSafeRemaining',j->'overallSafeRemaining',
 'individualTypeAvailabilityWarning',j->'individualTypeAvailabilityWarning','roomTypeUnspecified',j->'roomTypeUnspecified',
 'totalCapacity',j->'totalCapacity','unassignedRoomTypeCount',j->'unassignedRoomTypeCount',
 'roomTypes',(SELECT jsonb_agg(t-'checkedInNow'-'allocatedNow'-'physicallyEmpty') FROM jsonb_array_elements(j->'roomTypes') t))
$$;
SELECT pg_temp.ok(pg_temp.capacity_payload(get_hotel_operations_snapshot_v2('2026-09-28'))=pg_temp.capacity_payload(qa_old_snapshot_v2('2026-09-28')),'current v2 selected-date fields identical to predecessor base');
SELECT pg_temp.ok(EXISTS(SELECT 1 FROM jsonb_array_elements(get_hotel_operations_snapshot_v2('2026-09-28')->'stays') s WHERE s->>'id'=pg_temp.f(101)::text AND s->'currentPhysicalRoom'->>'state'='occupied' AND s->'currentPhysicalRoom'->>'date'='2026-09-28' AND s->'currentPhysicalRoom'->'allocation'->>'roomId'=pg_temp.f(11)::text),'current v2 preserves Benger legacy physical field');
SELECT pg_temp.ok(NOT (get_hotel_operations_snapshot_v2('2026-09-28')->'selectedDateUnassigned'->'singleStayIds' ? pg_temp.f(101)::text),'current v2 does not reclassify checked-in Benger as selected unassigned');
SELECT pg_temp.ok(pg_temp.capacity_payload(get_hotel_operations_snapshot_v2('2026-09-29'))=pg_temp.capacity_payload(qa_old_snapshot_v2('2026-09-29')),'future v2 capacity fields preserved');
-- Canonical Single -> Shared merge shape: primary capacity converts in place,
-- secondary capacity/allocation is archived, active membership owns one DELUXE room.
SAVEPOINT before_shared_transition;
SELECT pg_temp.stay(10,'2026-09-23 14:20+09','2026-09-28 12:40+09','2026-09-23 14:20+09','2026-09-23 14:21+09');
INSERT INTO family_bookings VALUES(pg_temp.f(800),pg_temp.f(801),NULL);
INSERT INTO family_shared_room_groups(id,family_booking_id,room_type_id,status) VALUES(pg_temp.f(802),pg_temp.f(800),pg_temp.f(1),'allocated');
INSERT INTO hotel_physical_occupancies(id,family_booking_id,shared_room_group_id,customer_id,room_type_id,room_id,occupied_from,occupied_until,capacity_reservation_id,room_allocation_id,status,version)
VALUES(pg_temp.f(803),pg_temp.f(800),pg_temp.f(802),pg_temp.f(801),pg_temp.f(1),pg_temp.f(11),'2026-09-23 14:20+09','2026-09-28 12:40+09',pg_temp.f(201),pg_temp.f(301),'active',1);
UPDATE hotel_capacity_reservations SET source_kind='shared_occupancy',hotel_stay_id=NULL,physical_occupancy_id=pg_temp.f(803) WHERE id=pg_temp.f(201);
UPDATE hotel_capacity_reservations SET archived_at=now(),archive_reason='shared merge' WHERE id=pg_temp.f(210);
UPDATE hotel_room_allocations SET archived_at=now(),archive_reason='shared merge' WHERE id=pg_temp.f(310);
INSERT INTO hotel_physical_occupancy_members(id,occupancy_id,hotel_stay_id,dog_id,status)
VALUES(pg_temp.f(804),pg_temp.f(803),pg_temp.f(101),pg_temp.f(1001),'active'),(pg_temp.f(805),pg_temp.f(803),pg_temp.f(110),pg_temp.f(1010),'active');
SELECT pg_temp.ok((SELECT count(*)=2 AND count(DISTINCT room_id)=1 AND count(DISTINCT capacity_id)=1 FROM hotel_current_physical_rooms_internal() WHERE stay_id IN(pg_temp.f(101),pg_temp.f(110))),'legacy Single to Shared canonical conversion follows one shared capacity');
SELECT pg_temp.ok(NOT EXISTS(SELECT 1 FROM hotel_current_physical_rooms_internal() WHERE room_id=pg_temp.f(20)),'Shared merge never revives secondary archived room');
ROLLBACK TO before_shared_transition;
SAVEPOINT before_rollover;
UPDATE hotel_capacity_reservations SET reserved_until='2026-09-27 12:40+09' WHERE id=pg_temp.f(201);
UPDATE hotel_room_allocations SET allocated_until='2026-09-27 12:40+09' WHERE id=pg_temp.f(301);
SELECT pg_temp.ok(EXISTS(SELECT 1 FROM jsonb_array_elements(get_hotel_operations_snapshot((now() AT TIME ZONE 'Asia/Seoul')::date)->'stays') s WHERE s->>'id'=pg_temp.f(101)::text AND s->'currentPhysicalRoom'->'allocation'->>'roomId'=pg_temp.f(11)::text),'current-date merge survives planned day rollover');
ROLLBACK TO before_rollover;
-- Extend an old stale planned end after cutover: it must not manufacture eligibility.
UPDATE hotel_capacity_reservations SET reserved_until=now()+interval '2 days' WHERE id=pg_temp.f(202);
UPDATE hotel_room_allocations SET allocated_until=now()+interval '2 days' WHERE id=pg_temp.f(302);
SELECT pg_temp.ok(NOT EXISTS(SELECT 1 FROM hotel_legacy_physical_anchors_internal() WHERE stay_id=pg_temp.f(102)),'later planned-end extension cannot create anchor');
-- Actual native V1 admission and completion remain separate from legacy proof.
SELECT pg_temp.stay(9,now()-interval '2 hours',now()-interval '1 hour',now()-interval '2 hours',now());
SELECT pg_temp.ok(EXISTS(SELECT 1 FROM hotel_current_physical_rooms_internal() WHERE stay_id=pg_temp.f(109)),'native V1 expired stay retained');
UPDATE hotel_stays SET checked_out_at=now() WHERE id=pg_temp.f(109);
SELECT pg_temp.ok(NOT EXISTS(SELECT 1 FROM hotel_current_physical_rooms_internal() WHERE stay_id=pg_temp.f(109)),'native actual checkout releases');
-- Actual existing command paths, including the RPCs used by DnD.
SELECT pg_temp.stay(14,now()-interval '10 minutes',now()+interval '1 day',NULL,now());
DO $$ BEGIN
 PERFORM reassign_hotel_room_before_check_in(pg_temp.f(114),(SELECT version FROM hotel_stays WHERE id=pg_temp.f(114)),pg_temp.f(11),'local reassign test',gen_random_uuid());
 RAISE EXCEPTION 'reassign accepted legacy occupied room';
EXCEPTION WHEN exclusion_violation THEN RAISE NOTICE 'PASS reassign/DnD physical conflict 23P01'; END $$;
SELECT pg_temp.ok((SELECT archived_at IS NULL FROM hotel_room_allocations WHERE id=pg_temp.f(314)),'failed reassign is atomic');
INSERT INTO hotel_stays(id,dog_id,created_by,updated_by) VALUES(pg_temp.f(115),pg_temp.f(1015),pg_temp.f(900),pg_temp.f(900)),(pg_temp.f(116),pg_temp.f(1016),pg_temp.f(900),pg_temp.f(900));
INSERT INTO hotel_capacity_reservations(id,hotel_stay_id,source_kind,quantity,room_type_id,reserved_from,reserved_until,created_by,updated_by)
VALUES(pg_temp.f(215),pg_temp.f(115),'stay',1,pg_temp.f(1),now()-interval '10 minutes',now()+interval '1 day',pg_temp.f(900),pg_temp.f(900)),
(pg_temp.f(216),pg_temp.f(116),'stay',1,pg_temp.f(1),now()+interval '2 days',now()+interval '3 days',pg_temp.f(900),pg_temp.f(900));
DO $$ BEGIN
 PERFORM assign_hotel_room(pg_temp.f(115),1,pg_temp.f(11),'local assign test',gen_random_uuid());
 RAISE EXCEPTION 'assign accepted legacy occupied room';
EXCEPTION WHEN exclusion_violation THEN RAISE NOTICE 'PASS assign/DnD physical conflict 23P01'; END $$;
SELECT assign_hotel_room(pg_temp.f(116),1,pg_temp.f(11),'local future planning test',gen_random_uuid());
SELECT pg_temp.ok(EXISTS(SELECT 1 FROM hotel_room_allocations WHERE capacity_reservation_id=pg_temp.f(216) AND room_id=pg_temp.f(11)),'future room assignment remains allowed');
SELECT pg_temp.stay(13,now()-interval '2 hours',now()+interval '1 day',now()-interval '2 hours',now());
DO $$ BEGIN
 PERFORM move_hotel_room_same_type(pg_temp.f(113),(SELECT version FROM hotel_stays WHERE id=pg_temp.f(113)),pg_temp.f(11),now(),'local move test',gen_random_uuid());
 RAISE EXCEPTION 'move accepted legacy occupied room';
EXCEPTION WHEN exclusion_violation THEN RAISE NOTICE 'PASS move/DnD physical conflict 23P01'; END $$;
-- Contiguous room move: closed predecessor remains historical, new room wins.
SELECT move_hotel_room_same_type(pg_temp.f(101),(SELECT version FROM hotel_stays WHERE id=pg_temp.f(101)),pg_temp.f(20),'2026-09-26 12:00+09','local canonical move',gen_random_uuid());
SELECT pg_temp.ok((SELECT room_id=pg_temp.f(20) FROM hotel_current_physical_rooms_internal() WHERE stay_id=pg_temp.f(101)),'contiguous move follows successor, never revives anchor room');
SELECT assert_hotel_physical_room_available_internal(pg_temp.f(11),pg_temp.f(999));
DO $$ BEGIN
 PERFORM assert_hotel_physical_room_available_internal(pg_temp.f(20),pg_temp.f(999));
 RAISE EXCEPTION 'guard accepted moved physical room';
EXCEPTION WHEN exclusion_violation THEN RAISE NOTICE 'PASS moved room guard 23P01'; END $$;
SAVEPOINT before_actual_checkout;
SELECT complete_hotel_check_out(pg_temp.f(101),(SELECT version FROM hotel_stays WHERE id=pg_temp.f(101)),now(),gen_random_uuid());
SELECT pg_temp.ok((SELECT checked_out_at IS NOT NULL FROM hotel_stays WHERE id=pg_temp.f(101)),'legacy actual checkout command populates completion');
SELECT pg_temp.ok(NOT EXISTS(SELECT 1 FROM hotel_current_physical_rooms_internal() WHERE stay_id=pg_temp.f(101)),'legacy actual checkout releases moved physical room');
SELECT assert_hotel_physical_room_available_internal(pg_temp.f(20),pg_temp.f(999));
SAVEPOINT after_actual_checkout;
SELECT reverse_hotel_completion(pg_temp.f(101),(SELECT version FROM hotel_stays WHERE id=pg_temp.f(101)),'check_out','local safe reversal',gen_random_uuid());
SET CONSTRAINTS hotel_legacy_physical_reentry_guard IMMEDIATE;
SELECT pg_temp.ok(EXISTS(SELECT 1 FROM hotel_current_physical_rooms_internal() WHERE stay_id=pg_temp.f(101)),'valid legacy checkout reversal restores canonical physical room');
ROLLBACK TO after_actual_checkout;
-- Reversal after a different actual guest occupies the released room.
INSERT INTO hotel_stays(id,dog_id,created_by,updated_by) VALUES(pg_temp.f(117),pg_temp.f(1017),pg_temp.f(900),pg_temp.f(900));
INSERT INTO hotel_capacity_reservations(id,hotel_stay_id,source_kind,quantity,room_type_id,reserved_from,reserved_until,created_by,updated_by)
VALUES(pg_temp.f(217),pg_temp.f(117),'stay',1,pg_temp.f(1),now(),now()+interval '1 day',pg_temp.f(900),pg_temp.f(900));
INSERT INTO hotel_room_allocations(id,capacity_reservation_id,room_id,allocated_from,allocated_until,created_by,updated_by)
VALUES(pg_temp.f(317),pg_temp.f(217),pg_temp.f(20),now(),now()+interval '1 day',pg_temp.f(900),pg_temp.f(900));
UPDATE hotel_stays SET checked_in_at=now() WHERE id=pg_temp.f(117);
DO $$ BEGIN
 PERFORM reverse_hotel_completion(pg_temp.f(101),(SELECT version FROM hotel_stays WHERE id=pg_temp.f(101)),'check_out','local reversal conflict test',gen_random_uuid());
 SET CONSTRAINTS hotel_legacy_physical_reentry_guard IMMEDIATE;
 RAISE EXCEPTION 'reverse accepted legacy physical collision';
EXCEPTION WHEN exclusion_violation THEN RAISE NOTICE 'PASS legacy reversal physical conflict 23P01'; END $$;
SELECT pg_temp.ok((SELECT checked_out_at IS NOT NULL FROM hotel_stays WHERE id=pg_temp.f(101)),'failed reversal rollback preserves completed legacy stay');
SELECT pg_temp.ok((SELECT count(DISTINCT capacity_id)=1 FROM hotel_current_physical_rooms_internal() WHERE room_id=pg_temp.f(20)),'failed reversal leaves exactly one actual room occupant');
ROLLBACK TO before_actual_checkout;
-- No gap can be bridged merely by sorting rows.
UPDATE hotel_room_allocations SET allocated_from='2026-09-26 12:01+09' WHERE capacity_reservation_id=pg_temp.f(201) AND room_id=pg_temp.f(20);
SELECT pg_temp.ok(NOT EXISTS(SELECT 1 FROM hotel_current_physical_rooms_internal() WHERE stay_id=pg_temp.f(101)),'broken continuity is unresolved, not last-row guessing');
-- Long Stay keep/release/actual-return continuity, including a pre-cutover
-- guest absent at cutover. Future return capacity alone must not hold a room.
INSERT INTO long_stay_contracts(id,current_hotel_stay_id,status) VALUES(pg_temp.f(600),pg_temp.f(108),'active'),(pg_temp.f(601),pg_temp.f(103),'active');
INSERT INTO long_stay_absence_events(id,hotel_stay_id,long_stay_contract_id,event_type,inventory_mode,is_open,occurred_at,inventory_transition_status)
VALUES(pg_temp.f(610),pg_temp.f(108),pg_temp.f(600),'leave','keep_room',true,now()-interval '1 hour','room_retained');
SELECT pg_temp.ok(EXISTS(SELECT 1 FROM hotel_current_physical_rooms_internal() WHERE stay_id=pg_temp.f(108)),'Long Stay keep_room retains physical room');
UPDATE long_stay_absence_events SET inventory_mode='release_room',inventory_transition_status='room_released' WHERE id=pg_temp.f(610);
SELECT pg_temp.ok(NOT EXISTS(SELECT 1 FROM hotel_current_physical_rooms_internal() WHERE stay_id=pg_temp.f(108)),'release_room overrides immutable anchor');
UPDATE hotel_capacity_reservations SET archived_at=now(),archive_reason='long_stay_outing_inventory_segment_closed' WHERE id=pg_temp.f(208);
INSERT INTO hotel_capacity_reservations(id,hotel_stay_id,source_kind,quantity,room_type_id,reserved_from,reserved_until,created_by,updated_by)
VALUES(pg_temp.f(508),pg_temp.f(108),'stay',1,pg_temp.f(1),now()+interval '1 day','infinity',pg_temp.f(900),pg_temp.f(900));
SELECT pg_temp.ok(NOT EXISTS(SELECT 1 FROM hotel_current_physical_rooms_internal() WHERE stay_id=pg_temp.f(108)),'future guaranteed return capacity is not physical reentry');
-- A second pre-cutover guest had no cutover anchor, but has a proven actual return.
INSERT INTO long_stay_absence_events(id,hotel_stay_id,long_stay_contract_id,event_type,inventory_mode,is_open,occurred_at,inventory_transition_status)
VALUES(pg_temp.f(611),pg_temp.f(103),pg_temp.f(601),'leave','release_room',true,'2026-09-24 10:00+09','room_released');
INSERT INTO hotel_capacity_reservations(id,hotel_stay_id,source_kind,quantity,room_type_id,reserved_from,reserved_until,created_by,updated_by)
VALUES(pg_temp.f(503),pg_temp.f(103),'stay',1,pg_temp.f(1),'2026-09-25 22:24+09','infinity',pg_temp.f(900),pg_temp.f(900));
INSERT INTO hotel_room_allocations(id,capacity_reservation_id,room_id,allocated_from,allocated_until,created_by,updated_by)
VALUES(pg_temp.f(703),pg_temp.f(503),pg_temp.f(21),'2026-09-25 22:24+09','infinity',pg_temp.f(900),pg_temp.f(900));
UPDATE long_stay_absence_events SET is_open=false,inventory_transition_status='room_returned',returned_allocation_id=pg_temp.f(703),return_capacity_id=pg_temp.f(503),returned_room_id=pg_temp.f(21) WHERE id=pg_temp.f(611);
INSERT INTO long_stay_absence_events(id,hotel_stay_id,long_stay_contract_id,event_type,paired_leave_event_id,occurred_at)
VALUES(pg_temp.f(621),pg_temp.f(103),pg_temp.f(601),'return',pg_temp.f(611),'2026-09-25 22:24+09');
SELECT pg_temp.ok((SELECT count(*)=1 AND min(room_id::text)=pg_temp.f(21)::text FROM hotel_current_physical_rooms_internal() WHERE stay_id=pg_temp.f(103)),'Gamja-like actual return resolves once without cutover anchor');
SELECT pg_temp.ok(NOT EXISTS(SELECT 1 FROM hotel_legacy_physical_anchors_internal() WHERE stay_id=pg_temp.f(103)),'actual return does not manufacture historical eligibility');
-- Snapshot uses the same server resolution; past/future carry no current projection.
SELECT pg_temp.ok(EXISTS(SELECT 1 FROM jsonb_array_elements(get_hotel_operations_snapshot((now() AT TIME ZONE 'Asia/Seoul')::date)->'stays') s WHERE s->>'id'=pg_temp.f(103)::text AND s->'currentPhysicalRoom'->'allocation'->>'roomId'=pg_temp.f(21)::text),'snapshot merges canonical current return');
SELECT pg_temp.ok(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(get_hotel_operations_snapshot('2026-09-24')->'stays') s WHERE s ? 'currentPhysicalRoom'),'past snapshot untouched');
SELECT pg_temp.ok(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(get_hotel_operations_snapshot('2026-09-30')->'stays') s WHERE s ? 'currentPhysicalRoom'),'future snapshot untouched');
ROLLBACK;
