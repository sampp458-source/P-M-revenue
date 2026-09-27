-- Shared historical provenance paths. Reader only; no business data repair.
BEGIN;
DO $guard$
DECLARE definition text;
BEGIN
 IF md5(btrim((SELECT prosrc FROM pg_proc WHERE oid=to_regprocedure('public.complete_hotel_check_in(uuid,integer,timestamp with time zone,uuid)')), E' \t\r\n')) IS DISTINCT FROM '93457a694ffd6481c06be76edf3b9ac4' THEN
  RAISE EXCEPTION 'STOP_SHARED_HISTORY_PREDECESSOR_MISMATCH: complete_hotel_check_in';
 END IF;
 IF md5(btrim((SELECT prosrc FROM pg_proc WHERE oid=to_regprocedure('public.complete_shared_hotel_check_in(uuid,uuid,integer,integer,timestamp with time zone,uuid)')), E' \t\r\n')) IS DISTINCT FROM '647f1261e9ac36a3d900bcd1a90384b5' THEN
  RAISE EXCEPTION 'STOP_SHARED_HISTORY_PREDECESSOR_MISMATCH: complete_shared_hotel_check_in';
 END IF;
 IF md5(btrim((SELECT prosrc FROM pg_proc WHERE oid=to_regprocedure('public.get_operation_hotel_room_projections(uuid[])')), E' \t\r\n')) IS DISTINCT FROM '27cd8bbdd8231acab0fa631727652c0d' THEN
  RAISE EXCEPTION 'STOP_SHARED_HISTORY_PREDECESSOR_MISMATCH: get_operation_hotel_room_projections';
 END IF;
 IF md5(btrim((SELECT prosrc FROM pg_proc WHERE oid=to_regprocedure('public.get_operation_hotel_room_projections_v2(uuid[])')), E' \t\r\n')) IS DISTINCT FROM '02fb77fc5a08c30eaae2f1d9cce5f18f' THEN
  RAISE EXCEPTION 'STOP_SHARED_HISTORY_PREDECESSOR_MISMATCH: get_operation_hotel_room_projections_v2';
 END IF;
 IF md5(btrim((SELECT prosrc FROM pg_proc WHERE oid=to_regprocedure('public.hotel_shared_chain_internal(text,jsonb,jsonb)')), E' \t\r\n')) IS DISTINCT FROM 'e444f7370b83e6e93d8f93fc6149fd30' THEN
  RAISE EXCEPTION 'STOP_SHARED_HISTORY_PREDECESSOR_MISMATCH: hotel_shared_chain_internal';
 END IF;
 IF md5(btrim((SELECT prosrc FROM pg_proc WHERE oid=to_regprocedure('public.hotel_shared_semantic_internal(text,jsonb)')), E' \t\r\n')) IS DISTINCT FROM '1d7053f3a7a3472d1a00278798d48cf1' THEN
  RAISE EXCEPTION 'STOP_SHARED_HISTORY_PREDECESSOR_MISMATCH: hotel_shared_semantic_internal';
 END IF;
 IF md5(btrim((SELECT prosrc FROM pg_proc WHERE oid=to_regprocedure('public.hotel_shared_verified_segments_internal(uuid[])')), E' \t\r\n')) IS DISTINCT FROM '9c255110adb3e596514a2a65a6bd91d6' THEN
  RAISE EXCEPTION 'STOP_SHARED_HISTORY_PREDECESSOR_MISMATCH: hotel_shared_verified_segments_internal';
 END IF;
 IF md5(btrim((SELECT prosrc FROM pg_proc WHERE oid=to_regprocedure('public.merge_existing_hotel_stays_into_shared_room(uuid[],integer[],boolean,uuid)')), E' \t\r\n')) IS DISTINCT FROM 'e044c35711c0ffa612ab072786f32bc9' THEN
  RAISE EXCEPTION 'STOP_SHARED_HISTORY_PREDECESSOR_MISMATCH: merge_existing_hotel_stays_into_shared_room';
 END IF;
 IF md5(btrim((SELECT prosrc FROM pg_proc WHERE oid=to_regprocedure('public.record_hotel_operation_audit_event()')), E' \t\r\n')) IS DISTINCT FROM '9b3d4c9cc4156e571065eecada32699f' THEN
  RAISE EXCEPTION 'STOP_SHARED_HISTORY_PREDECESSOR_MISMATCH: record_hotel_operation_audit_event';
 END IF;
 SELECT pg_get_functiondef('public.hotel_shared_verified_segments_internal(uuid[])'::regprocedure) INTO definition;
 IF (length(definition)-length(replace(definition,$old$ IF valid THEN
 -- Creation/merge receipt independently binds the initial allocation and room.
 room_id:=(chains->'hotel_physical_occupancies'->0->'after'->>'room_id')::uuid;
 SELECT count(*) INTO count_match FROM jsonb_array_elements(requests) r
 WHERE r->>'occupancy_id'=o->>'id' AND r->>'operation_kind' IN ('create','merge_existing_stays')
 AND r->>'completed_at' IS NOT NULL AND r->'response'->>'id'=o->>'id'
 AND r->'response'->>'roomId'=room_id::text AND r->'response'->>'roomAllocationId'=a->>'id'
 AND r->'response'->>'capacityReservationId'=c->>'id';
 valid:=count_match=1 AND (chains->'hotel_room_allocations'->0->'after'->>'room_id')::uuid=room_id;
 lo:=(s->>'checked_in_at')::timestamptz;
 hi:=coalesce((s->>'checked_out_at')::timestamptz,statement_timestamp());
 valid:=valid AND lo<hi AND (m->>'joined_at')::timestamptz<=lo
 AND (o->>'occupied_from')::timestamptz<=lo AND (o->>'occupied_until')::timestamptz>=hi
 AND ((s->>'checked_out_at' IS NULL AND m->>'status'='active' AND o->>'status'='active') OR
 (m->>'status'='completed' AND (m->>'left_at')::timestamptz=hi AND f->>'status'='completed'));
 -- Each completed lifecycle action must have a matching successful stay receipt.
 FOR e IN SELECT * FROM (VALUES ('check_in','checkedInAt','checked_in_at'),('check_out','checkedOutAt','checked_out_at')) v(op,response_key,stay_key) LOOP
 IF s->>e.stay_key IS NOT NULL THEN
 SELECT count(*) INTO count_match FROM jsonb_array_elements(requests) r
 WHERE r->>'occupancy_id'=o->>'id' AND r->>'operation_kind'=e.op AND r->>'completed_at' IS NOT NULL
 AND r->'response'->'stay'->>'id'=s->>'id'
 AND (r->'response'->'stay'->>e.response_key)::timestamptz=(s->>e.stay_key)::timestamptz;
 IF count_match<>1 THEN valid:=false;END IF;
 END IF;END LOOP;
 END IF;
$old$,'')))/length($old$ IF valid THEN
 -- Creation/merge receipt independently binds the initial allocation and room.
 room_id:=(chains->'hotel_physical_occupancies'->0->'after'->>'room_id')::uuid;
 SELECT count(*) INTO count_match FROM jsonb_array_elements(requests) r
 WHERE r->>'occupancy_id'=o->>'id' AND r->>'operation_kind' IN ('create','merge_existing_stays')
 AND r->>'completed_at' IS NOT NULL AND r->'response'->>'id'=o->>'id'
 AND r->'response'->>'roomId'=room_id::text AND r->'response'->>'roomAllocationId'=a->>'id'
 AND r->'response'->>'capacityReservationId'=c->>'id';
 valid:=count_match=1 AND (chains->'hotel_room_allocations'->0->'after'->>'room_id')::uuid=room_id;
 lo:=(s->>'checked_in_at')::timestamptz;
 hi:=coalesce((s->>'checked_out_at')::timestamptz,statement_timestamp());
 valid:=valid AND lo<hi AND (m->>'joined_at')::timestamptz<=lo
 AND (o->>'occupied_from')::timestamptz<=lo AND (o->>'occupied_until')::timestamptz>=hi
 AND ((s->>'checked_out_at' IS NULL AND m->>'status'='active' AND o->>'status'='active') OR
 (m->>'status'='completed' AND (m->>'left_at')::timestamptz=hi AND f->>'status'='completed'));
 -- Each completed lifecycle action must have a matching successful stay receipt.
 FOR e IN SELECT * FROM (VALUES ('check_in','checkedInAt','checked_in_at'),('check_out','checkedOutAt','checked_out_at')) v(op,response_key,stay_key) LOOP
 IF s->>e.stay_key IS NOT NULL THEN
 SELECT count(*) INTO count_match FROM jsonb_array_elements(requests) r
 WHERE r->>'occupancy_id'=o->>'id' AND r->>'operation_kind'=e.op AND r->>'completed_at' IS NOT NULL
 AND r->'response'->'stay'->>'id'=s->>'id'
 AND (r->'response'->'stay'->>e.response_key)::timestamptz=(s->>e.stay_key)::timestamptz;
 IF count_match<>1 THEN valid:=false;END IF;
 END IF;END LOOP;
 END IF;
$old$)<>1 THEN RAISE EXCEPTION 'STOP_SHARED_HISTORY_REPLACEMENT_COUNT'; END IF;
 definition:=replace(definition,'identity jsonb;','identity jsonb; origin_receipt jsonb; entry_audit jsonb; native_entry boolean; merged_entry boolean; active_members integer;');
 EXECUTE replace(definition,$old$ IF valid THEN
 -- Creation/merge receipt independently binds the initial allocation and room.
 room_id:=(chains->'hotel_physical_occupancies'->0->'after'->>'room_id')::uuid;
 SELECT count(*) INTO count_match FROM jsonb_array_elements(requests) r
 WHERE r->>'occupancy_id'=o->>'id' AND r->>'operation_kind' IN ('create','merge_existing_stays')
 AND r->>'completed_at' IS NOT NULL AND r->'response'->>'id'=o->>'id'
 AND r->'response'->>'roomId'=room_id::text AND r->'response'->>'roomAllocationId'=a->>'id'
 AND r->'response'->>'capacityReservationId'=c->>'id';
 valid:=count_match=1 AND (chains->'hotel_room_allocations'->0->'after'->>'room_id')::uuid=room_id;
 lo:=(s->>'checked_in_at')::timestamptz;
 hi:=coalesce((s->>'checked_out_at')::timestamptz,statement_timestamp());
 valid:=valid AND lo<hi AND (m->>'joined_at')::timestamptz<=lo
 AND (o->>'occupied_from')::timestamptz<=lo AND (o->>'occupied_until')::timestamptz>=hi
 AND ((s->>'checked_out_at' IS NULL AND m->>'status'='active' AND o->>'status'='active') OR
 (m->>'status'='completed' AND (m->>'left_at')::timestamptz=hi AND f->>'status'='completed'));
 -- Each completed lifecycle action must have a matching successful stay receipt.
 FOR e IN SELECT * FROM (VALUES ('check_in','checkedInAt','checked_in_at'),('check_out','checkedOutAt','checked_out_at')) v(op,response_key,stay_key) LOOP
 IF s->>e.stay_key IS NOT NULL THEN
 SELECT count(*) INTO count_match FROM jsonb_array_elements(requests) r
 WHERE r->>'occupancy_id'=o->>'id' AND r->>'operation_kind'=e.op AND r->>'completed_at' IS NOT NULL
 AND r->'response'->'stay'->>'id'=s->>'id'
 AND (r->'response'->'stay'->>e.response_key)::timestamptz=(s->>e.stay_key)::timestamptz;
 IF count_match<>1 THEN valid:=false;END IF;
 END IF;END LOOP;
 END IF;
$old$,$new$ IF valid THEN
 room_id:=(chains->'hotel_physical_occupancies'->0->'after'->>'room_id')::uuid;
 -- Canonical creation/merge receipt must identify this exact member. Timestamps
 -- alone (including a backdated joined_at) cannot create membership provenance.
 SELECT count(*),jsonb_agg(r)->0 INTO count_match,origin_receipt
 FROM jsonb_array_elements(requests) r
 WHERE r->>'occupancy_id'=o->>'id' AND r->>'operation_kind' IN ('create','merge_existing_stays')
 AND r->>'completed_at' IS NOT NULL AND r->>'created_by' IS NOT NULL
 AND (r->>'created_at')::timestamptz<=(r->>'completed_at')::timestamptz
 AND r->'response'->>'id'=o->>'id'
 AND r->'response'->>'sharedRoomGroupId'=g->>'id'
 AND r->'response'->>'familyBookingId'=f->>'family_booking_id'
 AND r->'response'->>'roomAllocationId'=a->>'id'
 AND r->'response'->>'capacityReservationId'=c->>'id'
 AND r->'response'->>'roomId'=chains->'hotel_physical_occupancies'->0->'after'->>'room_id'
 AND r->'response'->>'roomId'=chains->'hotel_room_allocations'->0->'after'->>'room_id'
 AND (chains->'hotel_physical_occupancies'->0->>'at')::timestamptz=(r->>'created_at')::timestamptz
 AND (chains->'hotel_physical_occupancy_members'->0->>'at')::timestamptz=(r->>'created_at')::timestamptz
 AND (m->>'created_at')::timestamptz=(r->>'created_at')::timestamptz
 AND chains->'hotel_physical_occupancy_members'->0->'after'->>'status'='active'
 AND (SELECT count(*) FROM jsonb_array_elements(r->'response'->'members') rm
      WHERE rm->>'id'=m->>'id' AND rm->>'hotelStayId'=s->>'id'
      AND rm->>'familyBookingMemberId'=f->>'id' AND rm->>'dogId'=s->>'dog_id'
      AND rm->>'status'='active' AND rm->>'leftAt' IS NULL
      AND (rm->>'joinedAt')::timestamptz=(m->>'joined_at')::timestamptz)=1;
 valid:=count_match=1;
 lo:=(s->>'checked_in_at')::timestamptz;
 hi:=coalesce((s->>'checked_out_at')::timestamptz,statement_timestamp());
 native_entry:=false; merged_entry:=false;
 IF valid THEN
 -- Path A: successful Shared check-in, exact returned member and audited
 -- occupancy version. Creation evidence must already exist when it executes.
 SELECT count(*)=1 INTO native_entry
 FROM jsonb_array_elements(requests) r
 JOIN LATERAL jsonb_array_elements(chains->'hotel_physical_occupancies') v ON true
 WHERE r->>'operation_kind'='check_in' AND r->>'occupancy_id'=o->>'id'
 AND r->>'completed_at' IS NOT NULL AND r->>'created_by' IS NOT NULL
 AND (origin_receipt->>'completed_at')::timestamptz<=(r->>'created_at')::timestamptz
 AND (r->>'created_at')::timestamptz<=(r->>'completed_at')::timestamptz
 AND r->'response'->'stay'->>'id'=s->>'id'
 AND (r->'response'->'stay'->>'checkedInAt')::timestamptz=lo
 AND r->'response'->'occupancy'->>'id'=o->>'id'
 AND r->'response'->'occupancy'->>'sharedRoomGroupId'=g->>'id'
 AND (SELECT count(*) FROM jsonb_array_elements(audits) h
      WHERE h->>'entity_type'='hotel_stays' AND h->>'entity_id'=s->>'id'
      AND h->'before_data'->>'checked_in_at' IS NULL
      AND (h->'after_data'->>'checked_in_at')::timestamptz=lo
      AND h->>'request_id'=r->>'request_id' AND h->>'changed_by'=r->>'created_by'
      AND (h->>'created_at')::timestamptz=(r->>'created_at')::timestamptz)=1
 AND r->'response'->'occupancy'->>'version'=v->>'version'
 AND r->'response'->'occupancy'->>'roomId'=v->'after'->>'room_id'
 AND r->'response'->'occupancy'->>'roomAllocationId'=a->>'id'
 AND r->'response'->'occupancy'->>'capacityReservationId'=c->>'id'
 AND v->'after'->>'status'='active'
 AND (v->>'at')::timestamptz=(r->>'created_at')::timestamptz
 AND to_timestamp((v->'after'->>'occupied_from')::double precision)<=lo
 AND lo<to_timestamp((v->'after'->>'occupied_until')::double precision)
 AND (SELECT count(*) FROM jsonb_array_elements(r->'response'->'occupancy'->'members') rm
      WHERE rm->>'id'=m->>'id' AND rm->>'hotelStayId'=s->>'id'
      AND rm->>'familyBookingMemberId'=f->>'id' AND rm->>'dogId'=s->>'dog_id'
      AND rm->>'status'='active')=1;
 -- Path B: a Single admission predating canonical merge. The retained Single
 -- allocation/capacity must be the exact aggregate transferred by that merge.
 -- Do not infer a joining stay's old room from the eventual Shared room.
 IF origin_receipt->>'operation_kind'='merge_existing_stays'
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(requests) r
 WHERE r->>'operation_kind'='check_in' AND r->'response'->'stay'->>'id'=s->>'id') THEN
 SELECT count(*),jsonb_agg(h)->0 INTO count_match,entry_audit
 FROM jsonb_array_elements(audits) h
 WHERE h->>'entity_type'='hotel_stays' AND h->>'entity_id'=s->>'id'
 AND h->>'action'='updated' AND h->>'request_id' IS NOT NULL
 AND h->>'changed_by' IS NOT NULL AND h->>'change_reason'='호텔 입실 완료'
 AND h->'before_data'->>'checked_in_at' IS NULL
 AND (h->'after_data'->>'checked_in_at')::timestamptz=lo
 AND h->'after_data'->>'checked_in_by'=h->>'changed_by'
 AND (h->>'created_at')::timestamptz<(origin_receipt->>'created_at')::timestamptz;
 IF count_match=1 THEN
 merged_entry:=EXISTS(
 SELECT 1 FROM jsonb_array_elements(chains->'hotel_capacity_reservations') cv
 WHERE cv->'before'->>'source_kind'='stay' AND cv->'before'->>'hotel_stay_id'=s->>'id'
 AND cv->'after'->>'source_kind'='shared_occupancy' AND cv->'after'->>'physical_occupancy_id'=o->>'id'
 AND (cv->>'at')::timestamptz=(origin_receipt->>'created_at')::timestamptz
 ) AND EXISTS(
 SELECT 1 FROM jsonb_array_elements(chains->'hotel_capacity_reservations') cv
 WHERE cv->'after'->>'source_kind'='stay' AND cv->'after'->>'hotel_stay_id'=s->>'id'
 AND (cv->>'at')::timestamptz<=(entry_audit->>'created_at')::timestamptz
 AND to_timestamp((cv->'after'->>'reserved_from')::double precision)<=lo
 AND to_timestamp((cv->'after'->>'reserved_until')::double precision)>lo
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(chains->'hotel_capacity_reservations') later
 WHERE (later->>'version')::integer>(cv->>'version')::integer
 AND (later->>'at')::timestamptz<=(entry_audit->>'created_at')::timestamptz)
 ) AND EXISTS(
 SELECT 1 FROM jsonb_array_elements(chains->'hotel_room_allocations') av
 WHERE av->'after'->>'capacity_reservation_id'=c->>'id'
 AND av->'after'->>'room_id'=origin_receipt->'response'->>'roomId'
 AND (av->>'at')::timestamptz<=(entry_audit->>'created_at')::timestamptz
 AND to_timestamp((av->'after'->>'allocated_from')::double precision)<=lo
 AND to_timestamp((av->'after'->>'allocated_until')::double precision)>lo
 AND NOT EXISTS(SELECT 1 FROM public.hotel_capacity_reservations competing
 WHERE competing.id<>(c->>'id')::uuid AND competing.hotel_stay_id=(s->>'id')::uuid
 AND competing.source_kind='stay' AND competing.created_at<=(entry_audit->>'created_at')::timestamptz
 AND competing.reserved_from<=lo AND lo<competing.reserved_until
 AND (competing.archived_at IS NULL OR competing.archived_at>(entry_audit->>'created_at')::timestamptz))
 AND NOT EXISTS(SELECT 1 FROM public.entity_audit_events competing
 WHERE competing.entity_type='hotel_capacity_reservations' AND competing.entity_id::text<>c->>'id'
 AND competing.after_data->>'hotel_stay_id'=s->>'id' AND competing.after_data->>'source_kind'='stay'
 AND competing.created_at<=(entry_audit->>'created_at')::timestamptz
 AND competing.after_data->>'archived_at' IS NULL
 AND (competing.after_data->>'reserved_from')::timestamptz<=lo
 AND lo<(competing.after_data->>'reserved_until')::timestamptz
 AND NOT EXISTS(SELECT 1 FROM public.entity_audit_events later
 WHERE later.entity_type=competing.entity_type AND later.entity_id=competing.entity_id
 AND later.created_at<=(entry_audit->>'created_at')::timestamptz
 AND (later.after_data->>'version')::integer>(competing.after_data->>'version')::integer))
 AND NOT EXISTS(SELECT 1 FROM public.hotel_room_allocations competing
 WHERE competing.id<>(a->>'id')::uuid AND competing.capacity_reservation_id=(c->>'id')::uuid
 AND competing.created_at<=(entry_audit->>'created_at')::timestamptz
 AND competing.allocated_from<=lo AND lo<competing.allocated_until
 AND (competing.archived_at IS NULL OR competing.archived_at>(entry_audit->>'created_at')::timestamptz))
 AND NOT EXISTS(SELECT 1 FROM public.entity_audit_events competing
 WHERE competing.entity_type='hotel_room_allocations' AND competing.entity_id::text<>a->>'id'
 AND competing.after_data->>'capacity_reservation_id'=c->>'id'
 AND competing.created_at<=(entry_audit->>'created_at')::timestamptz
 AND competing.after_data->>'archived_at' IS NULL
 AND (competing.after_data->>'allocated_from')::timestamptz<=lo
 AND lo<(competing.after_data->>'allocated_until')::timestamptz
 AND NOT EXISTS(SELECT 1 FROM public.entity_audit_events later
 WHERE later.entity_type=competing.entity_type AND later.entity_id=competing.entity_id
 AND later.created_at<=(entry_audit->>'created_at')::timestamptz
 AND (later.after_data->>'version')::integer>(competing.after_data->>'version')::integer))
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(chains->'hotel_room_allocations') later
 WHERE (later->>'version')::integer>(av->>'version')::integer
 AND (later->>'at')::timestamptz<=(origin_receipt->>'created_at')::timestamptz
 AND later->'before'->'room_id' IS DISTINCT FROM later->'after'->'room_id')
 );
 END IF;
 END IF;
 END IF;
 valid:=valid AND lo<hi AND (native_entry OR merged_entry)
 AND (o->>'occupied_from')::timestamptz<=lo
 -- First-member late checkout may precede the last member's capacity-bound
 -- adjustment. Its successful receipt, not planned expiry, proves this past
 -- member's actual end; this does not extend current capacity/availability.
 AND ((o->>'occupied_until')::timestamptz>=hi OR
 (o->>'status'='active' AND s->>'checked_out_at' IS NOT NULL AND EXISTS(
 SELECT 1 FROM jsonb_array_elements(requests) r
 JOIN LATERAL jsonb_array_elements(chains->'hotel_physical_occupancies') v ON true
 WHERE r->>'operation_kind'='check_out' AND r->>'occupancy_id'=o->>'id'
 AND r->>'completed_at' IS NOT NULL AND r->'response'->'stay'->>'id'=s->>'id'
 AND (r->'response'->'stay'->>'checkedOutAt')::timestamptz=hi
 AND r->'response'->'occupancy'->>'id'=o->>'id'
 AND r->'response'->'occupancy'->>'sharedRoomGroupId'=g->>'id'
 AND r->'response'->'occupancy'->>'version'=v->>'version'
 AND v->'after'->>'status'='active'
 AND (v->>'at')::timestamptz=(r->>'created_at')::timestamptz
 AND (SELECT count(*) FROM jsonb_array_elements(r->'response'->'occupancy'->'members') rm
 WHERE rm->>'id'=m->>'id' AND rm->>'hotelStayId'=s->>'id'
 AND rm->>'status'='completed' AND (rm->>'leftAt')::timestamptz=hi)=1)))
 AND ((s->>'checked_out_at' IS NULL AND m->>'status'='active' AND o->>'status'='active') OR
 (m->>'status'='completed' AND (m->>'left_at')::timestamptz=hi AND f->>'status'='completed'));
 -- Terminal coherence is distinct from partial member completion.
 SELECT count(*) INTO active_members FROM public.hotel_physical_occupancy_members pm
 WHERE pm.occupancy_id=(o->>'id')::uuid AND pm.archived_at IS NULL AND pm.status='active';
 valid:=valid AND (
 (o->>'status'='active' AND g->>'status'='allocated' AND active_members>0 AND o->>'completed_at' IS NULL)
 OR (o->>'status'='completed' AND g->>'status'='released' AND active_members=0
 AND o->>'completed_at' IS NOT NULL
 AND NOT EXISTS(SELECT 1 FROM public.hotel_physical_occupancy_members pm
 LEFT JOIN public.hotel_stays ps ON ps.id=pm.hotel_stay_id
 LEFT JOIN public.family_booking_members pf ON pf.id=pm.family_booking_member_id
 WHERE pm.occupancy_id=(o->>'id')::uuid AND pm.archived_at IS NULL
 AND (pm.status IS DISTINCT FROM 'completed' OR ps.checked_out_at IS NULL
 OR pm.left_at IS DISTINCT FROM ps.checked_out_at OR pf.status IS DISTINCT FROM 'completed'))));
 -- Path B proves Single check-in through its audited command; do not invent a
 -- Shared check-in receipt. Every checkout still requires its real receipt.
 FOR e IN SELECT * FROM (VALUES ('check_in','checkedInAt','checked_in_at'),('check_out','checkedOutAt','checked_out_at')) v(op,response_key,stay_key) LOOP
 IF s->>e.stay_key IS NOT NULL AND NOT(e.op='check_in' AND merged_entry) THEN
 SELECT count(*) INTO count_match FROM jsonb_array_elements(requests) r
 WHERE r->>'occupancy_id'=o->>'id' AND r->>'operation_kind'=e.op AND r->>'completed_at' IS NOT NULL
 AND r->'response'->'stay'->>'id'=s->>'id'
 AND (r->'response'->'stay'->>e.response_key)::timestamptz=(s->>e.stay_key)::timestamptz;
 IF count_match<>1 THEN valid:=false;END IF;
 END IF;END LOOP;
 END IF;
$new$);
END $guard$;
COMMIT;
