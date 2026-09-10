-- 010 follow-up: strict Single planned checkout evidence. No business/ACL table changes.
BEGIN;
DO $$ BEGIN
 IF md5(btrim((SELECT prosrc FROM pg_proc WHERE oid=to_regprocedure('public.hotel_history_individual_010(jsonb)')),E' \t\r\n')) IS DISTINCT FROM 'debfbe011b5d24045196046b537579b1' THEN RAISE EXCEPTION 'STOP_010_ADJUSTMENT_BASELINE'; END IF;
 IF md5(btrim((SELECT prosrc FROM pg_proc WHERE oid=to_regprocedure('public.get_hotel_historical_room_board(date)')),E' \t\r\n')) IS DISTINCT FROM '09ac10531de414921fb60e14e488ea6f' THEN RAISE EXCEPTION 'STOP_010_ADJUSTMENT_BASELINE'; END IF;
END $$;
-- Pure proof of one planned-end adjustment. No processing timestamp is an occupancy boundary.
CREATE FUNCTION public.hotel_history_planned_adjustment_010(p jsonb,a jsonb,c jsonb,e jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE b jsonb:=e->'before_data'; n jsonb:=e->'after_data'; ca jsonb; root jsonb; req jsonb; snap jsonb; sa jsonb;
 matches integer:=0; roots integer; caps integer; allocations integer; s jsonb:=p->'stay';
BEGIN
 IF p->>'kind' IS DISTINCT FROM 'single' OR e->>'action' IS DISTINCT FROM 'updated'
  OR e->>'change_reason' IS DISTINCT FROM '입실 후 퇴실 예정 변경'
  OR b->>'id' IS DISTINCT FROM a->>'id' OR n->>'id' IS DISTINCT FROM a->>'id'
  OR b->>'archived_at' IS NOT NULL OR n->>'archived_at' IS NOT NULL
  OR c->>'source_kind' IS DISTINCT FROM 'stay' OR c->>'hotel_stay_id' IS DISTINCT FROM s->>'id'
  OR c->>'physical_occupancy_id' IS NOT NULL OR c->>'shared_room_group_id' IS NOT NULL
  OR c->>'quantity' IS DISTINCT FROM '1'
  OR (public.hotel_history_semantic_010('hotel_room_allocations',b)-'allocated_until') IS DISTINCT FROM
     (public.hotel_history_semantic_010('hotel_room_allocations',n)-'allocated_until')
  OR (b->>'allocated_until')::timestamptz IS NOT DISTINCT FROM (n->>'allocated_until')::timestamptz
  OR NOT public.hotel_history_chain_010('hotel_stays',s,p->'audits')
  OR NOT public.hotel_history_chain_010('hotel_room_allocations',a,p->'audits')
  OR NOT public.hotel_history_chain_010('hotel_capacity_reservations',c,p->'audits') THEN RETURN false; END IF;
 FOR req IN SELECT value FROM jsonb_array_elements(coalesce(p->'plannedRequests','[]')) LOOP
  IF req->>'request_id' IS NULL OR req->>'hotel_stay_id' IS DISTINCT FROM s->>'id'
   OR req->>'completed_at' IS NULL OR jsonb_typeof(req->'response') IS DISTINCT FROM 'object' THEN CONTINUE; END IF;
  snap:=req->'response';
  IF snap->>'id' IS DISTINCT FROM s->>'id' OR snap->>'dogId' IS DISTINCT FROM s->>'dog_id' THEN CONTINUE; END IF;
  SELECT count(*) INTO roots FROM jsonb_array_elements(p->'audits') x WHERE x->>'entity_type'='hotel_stays' AND x->>'entity_id'=s->>'id'
   AND x->>'request_id'=req->>'request_id' AND x->'after_data' ? 'created_at'
   AND x->'after_data'->>'version'=snap->>'version';
  IF roots<>1 THEN CONTINUE; END IF;
  SELECT x INTO root FROM jsonb_array_elements(p->'audits') x WHERE x->>'entity_type'='hotel_stays' AND x->>'entity_id'=s->>'id'
   AND x->>'request_id'=req->>'request_id' AND x->'after_data' ? 'created_at' AND x->'after_data'->>'version'=snap->>'version';
  IF root->>'action' IS DISTINCT FROM 'updated' OR root->>'change_reason' IS DISTINCT FROM '입실 후 퇴실 예정 변경'
   OR root->'before_data'->>'checked_in_at' IS NULL OR root->'after_data'->>'checked_out_at' IS NOT NULL
   OR root->'before_data'->>'archived_at' IS NOT NULL OR root->'after_data'->>'archived_at' IS NOT NULL
   OR public.hotel_history_semantic_010('hotel_stays',root->'before_data') IS DISTINCT FROM public.hotel_history_semantic_010('hotel_stays',root->'after_data')
   OR (snap->>'checkedInAt')::timestamptz IS DISTINCT FROM (root->'after_data'->>'checked_in_at')::timestamptz
   OR snap->>'checkedOutAt' IS NOT NULL OR snap->>'archivedAt' IS NOT NULL
   OR (n->>'allocated_until')::timestamptz <= (snap->>'checkedInAt')::timestamptz THEN CONTINUE; END IF;
  SELECT count(*) INTO allocations FROM jsonb_array_elements(snap->'roomAllocations') x WHERE x->>'id'=a->>'id';
  IF allocations<>1 THEN CONTINUE; END IF;
  SELECT x INTO sa FROM jsonb_array_elements(snap->'roomAllocations') x WHERE x->>'id'=a->>'id';
  IF sa->>'version' IS DISTINCT FROM n->>'version' OR sa->>'roomId' IS DISTINCT FROM n->>'room_id'
   OR (sa->>'allocatedFrom')::timestamptz IS DISTINCT FROM (n->>'allocated_from')::timestamptz
   OR (sa->>'allocatedUntil')::timestamptz IS DISTINCT FROM (n->>'allocated_until')::timestamptz
   OR sa->>'roomTypeId' IS DISTINCT FROM c->>'room_type_id'
   OR snap->'capacityReservation'->>'id' IS DISTINCT FROM c->>'id'
   OR snap->'capacityReservation'->>'roomTypeId' IS DISTINCT FROM c->>'room_type_id'
   OR snap->'capacityReservation'->>'quantity' IS DISTINCT FROM c->>'quantity'
   OR (snap->'capacityReservation'->>'reservedFrom')::timestamptz IS DISTINCT FROM (c->>'reserved_from')::timestamptz
   OR (snap->'capacityReservation'->>'reservedUntil')::timestamptz IS DISTINCT FROM (n->>'allocated_until')::timestamptz
   OR (e->>'request_id' IS NOT NULL AND e->>'request_id'<>req->>'request_id') THEN CONTINUE; END IF;
  -- Capacity response has no version in the established DTO. Require a unique
  -- exact before/after edge; repeated identical edges cannot be guessed apart.
  SELECT count(*) INTO caps FROM jsonb_array_elements(p->'audits') x
   WHERE x->>'entity_type'='hotel_capacity_reservations' AND x->>'entity_id'=c->>'id' AND x->'after_data' ? 'created_at'
   AND (x->'before_data'->>'reserved_until')::timestamptz=(b->>'allocated_until')::timestamptz
   AND (x->'after_data'->>'reserved_until')::timestamptz=(n->>'allocated_until')::timestamptz;
  IF caps<>1 THEN CONTINUE; END IF;
  SELECT x INTO ca FROM jsonb_array_elements(p->'audits') x
   WHERE x->>'entity_type'='hotel_capacity_reservations' AND x->>'entity_id'=c->>'id' AND x->'after_data' ? 'created_at'
   AND (x->'before_data'->>'reserved_until')::timestamptz=(b->>'allocated_until')::timestamptz
   AND (x->'after_data'->>'reserved_until')::timestamptz=(n->>'allocated_until')::timestamptz;
  IF ca->>'action' IS DISTINCT FROM 'updated' OR ca->>'change_reason' IS DISTINCT FROM '입실 후 퇴실 예정 변경'
   OR (ca->>'request_id' IS NOT NULL AND ca->>'request_id'<>req->>'request_id')
   OR ca->'before_data'->>'archived_at' IS NOT NULL OR ca->'after_data'->>'archived_at' IS NOT NULL
   OR (public.hotel_history_semantic_010('hotel_capacity_reservations',ca->'before_data')-'reserved_until') IS DISTINCT FROM
      (public.hotel_history_semantic_010('hotel_capacity_reservations',ca->'after_data')-'reserved_until')
   OR (public.hotel_history_semantic_010('hotel_capacity_reservations',ca->'after_data')-'reserved_until') IS DISTINCT FROM
      (public.hotel_history_semantic_010('hotel_capacity_reservations',c)-'reserved_until')
   OR ca->'after_data'->>'hotel_stay_id' IS DISTINCT FROM s->>'id'
   OR ca->'after_data'->>'source_kind' IS DISTINCT FROM 'stay'
   OR ca->'after_data'->>'physical_occupancy_id' IS NOT NULL OR ca->'after_data'->>'shared_room_group_id' IS NOT NULL THEN CONTINUE; END IF;
  matches:=matches+1;
 END LOOP;
 RETURN matches=1;
EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow OR numeric_value_out_of_range OR invalid_parameter_value THEN RETURN false;
END $$;
REVOKE ALL ON FUNCTION public.hotel_history_planned_adjustment_010(jsonb,jsonb,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.hotel_history_individual_010(p jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE s jsonb:=p->'stay'; audits jsonb:=p->'audits'; a jsonb; c jsonb; x jsonb;
 prev jsonb; leave_row jsonb; return_row jsonb; receipt jsonb; room jsonb;
 segments jsonb:='[]'; absences jsonb:='[]'; reason text:='AUDIT_CHAIN_UNPROVEN';
 lo timestamptz; hi timestamptz; required_until timestamptz; start_at timestamptz; end_at timestamptz; leave_at timestamptz; return_at timestamptz;
 cursor_at timestamptz; piece_start timestamptz; piece_end timestamptz; last_absence_end timestamptz;
 longstay boolean:=p->>'kind'='longstay'; matched integer; first_segment boolean:=true;
BEGIN
 lo:=(s->>'checked_in_at')::timestamptz;
 hi:=least(coalesce((s->>'checked_out_at')::timestamptz,'infinity'),(p->>'asOf')::timestamptz);
 required_until:=least(hi,coalesce((p->>'windowUntil')::timestamptz,hi));
 IF lo IS NULL OR hi<=lo OR s->>'archived_at' IS NOT NULL THEN
  RETURN jsonb_build_object('reasonCode','ACTUAL_STAY_INTERVAL_UNPROVEN','segments','[]'::jsonb); END IF;
 IF NOT public.hotel_history_chain_010('hotel_stays',s,audits) THEN RAISE EXCEPTION 'unproven' USING errcode='P0010'; END IF;
 -- Rewritten actual check-in/out, including reversal, is outside this release's supported paths.
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(audits) e WHERE e->>'entity_type'='hotel_stays' AND e->>'entity_id'=s->>'id' AND e->'after_data' ? 'created_at'
 AND ((e->'after_data'->>'dog_id' IS DISTINCT FROM s->>'dog_id')
 OR e->'after_data'->>'archived_at' IS NOT NULL
 OR (e->'before_data'->>'checked_in_at' IS NOT NULL AND e->'before_data'->>'checked_in_at' IS DISTINCT FROM e->'after_data'->>'checked_in_at')
 OR (e->'before_data'->>'checked_out_at' IS NOT NULL AND e->'before_data'->>'checked_out_at' IS DISTINCT FROM e->'after_data'->>'checked_out_at'))) THEN
 reason:='UNSUPPORTED_REVERSAL'; RAISE EXCEPTION 'unproven' USING errcode='P0010'; END IF;

 IF longstay AND s->>'checked_out_at' IS NOT NULL THEN RETURN jsonb_build_object('segments','[]'::jsonb,'reasonCode','UNSUPPORTED_LONGSTAY_COMPLETION'); END IF;
 IF longstay THEN
  reason:='ABSENCE_PROVENANCE_UNPROVEN';
  -- Only the observed keep -> release -> different-room return path is enabled.
  IF jsonb_array_length(p->'absences')<>2 THEN RAISE EXCEPTION 'unproven' USING errcode='P0010'; END IF;
  SELECT value INTO leave_row FROM jsonb_array_elements(p->'absences') WHERE value->>'event_type'='leave';
  SELECT value INTO return_row FROM jsonb_array_elements(p->'absences') WHERE value->>'event_type'='return';
  IF leave_row IS NULL OR return_row IS NULL OR leave_row->>'archived_at' IS NOT NULL OR return_row->>'archived_at' IS NOT NULL
   OR return_row->>'paired_leave_event_id' IS DISTINCT FROM leave_row->>'id'
   OR leave_row->>'hotel_stay_id' IS DISTINCT FROM s->>'id' OR return_row->>'hotel_stay_id' IS DISTINCT FROM s->>'id'
   OR leave_row->>'long_stay_contract_id' IS DISTINCT FROM return_row->>'long_stay_contract_id'
   OR leave_row->>'inventory_mode' IS DISTINCT FROM 'release_room' OR leave_row->>'is_open' IS DISTINCT FROM 'false'
   OR leave_row->>'returned_room_id' IS NOT DISTINCT FROM leave_row->>'previous_room_id' THEN RAISE EXCEPTION 'unproven' USING errcode='P0010'; END IF;
  leave_at:=(leave_row->>'occurred_at')::timestamptz; return_at:=(return_row->>'occurred_at')::timestamptz;
  IF leave_at<=lo OR return_at<=leave_at THEN RAISE EXCEPTION 'unproven' USING errcode='P0010'; END IF;
  SELECT count(*) INTO matched FROM jsonb_array_elements(p->'receipts') r
   WHERE r->>'long_stay_contract_id'=leave_row->>'long_stay_contract_id' AND r->'canonical_payload'->>'contractId'=leave_row->>'long_stay_contract_id' AND r->>'absence_event_id'=leave_row->>'id' AND r->>'request_id'=leave_row->>'request_id'
   AND r->>'operation_kind' IN ('start_absence','start_absence_inventory_v1')
   AND (r->'canonical_payload'->>'leftAt')::timestamptz=leave_at
   AND coalesce(r->'canonical_payload'->>'inventoryMode','keep_room')='keep_room';
  IF matched<>1 THEN RAISE EXCEPTION 'unproven' USING errcode='P0010'; END IF;
  SELECT count(*) INTO matched FROM jsonb_array_elements(p->'receipts') r
   WHERE r->>'long_stay_contract_id'=leave_row->>'long_stay_contract_id' AND r->'canonical_payload'->>'contractId'=leave_row->>'long_stay_contract_id' AND r->>'absence_event_id'=leave_row->>'id' AND r->>'operation_kind'='release_room_during_absence_inventory_v1';
  IF matched<>1 THEN RAISE EXCEPTION 'unproven' USING errcode='P0010'; END IF;
  SELECT count(*) INTO matched FROM jsonb_array_elements(p->'receipts') r
   WHERE r->>'long_stay_contract_id'=leave_row->>'long_stay_contract_id' AND r->'canonical_payload'->>'contractId'=leave_row->>'long_stay_contract_id' AND r->>'absence_event_id'=return_row->>'id' AND r->>'request_id'=return_row->>'request_id'
   AND r->>'operation_kind'='complete_absence_inventory_v1'
   AND (r->'canonical_payload'->>'returnedAt')::timestamptz=return_at
   AND r->'canonical_payload'->>'roomId'=leave_row->>'returned_room_id';
  IF matched<>1 THEN RAISE EXCEPTION 'unproven' USING errcode='P0010'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p->'receipts') r WHERE r->>'operation_kind' ~ '(reverse|cancel|complete_check_out)') THEN RAISE EXCEPTION 'unproven' USING errcode='P0010'; END IF;
  SELECT value INTO a FROM jsonb_array_elements(p->'allocations') WHERE value->>'id'=leave_row->>'released_allocation_id';
  SELECT value INTO c FROM jsonb_array_elements(p->'capacities') WHERE value->>'id'=leave_row->>'released_capacity_id';
  IF a IS NULL OR c IS NULL OR a->>'capacity_reservation_id' IS DISTINCT FROM c->>'id'
   OR a->>'room_id' IS DISTINCT FROM leave_row->>'previous_room_id'
   OR (a->>'allocated_until')::timestamptz IS DISTINCT FROM (c->>'reserved_until')::timestamptz
   OR (a->>'allocated_until')::timestamptz<leave_at
   OR (a->>'allocated_until')::timestamptz>(leave_row->>'guarantee_from')::timestamptz THEN RAISE EXCEPTION 'unproven' USING errcode='P0010'; END IF;
  SELECT value INTO a FROM jsonb_array_elements(p->'allocations') WHERE value->>'id'=leave_row->>'returned_allocation_id';
  IF a IS NULL OR a->>'room_id' IS DISTINCT FROM leave_row->>'returned_room_id'
   OR a->>'capacity_reservation_id' IS DISTINCT FROM leave_row->>'return_capacity_id'
   OR (a->>'allocated_from')::timestamptz IS DISTINCT FROM return_at THEN RAISE EXCEPTION 'unproven' USING errcode='P0010'; END IF;
  absences:=jsonb_build_array(jsonb_build_object('from',leave_at,'until',return_at));
 END IF;

 cursor_at:=lo;
 FOR a IN SELECT value FROM jsonb_array_elements(p->'allocations')
 WHERE (value->>'allocated_from')::timestamptz<required_until AND (value->>'allocated_until')::timestamptz>lo
 ORDER BY (value->>'allocated_from')::timestamptz,value->>'id' LOOP
  reason:='AUDIT_CHAIN_UNPROVEN';
  IF NOT public.hotel_history_chain_010('hotel_room_allocations',a,audits) THEN RAISE EXCEPTION 'unproven' USING errcode='P0010'; END IF;
  SELECT value INTO c FROM jsonb_array_elements(p->'capacities') WHERE value->>'id'=a->>'capacity_reservation_id';
  IF c IS NULL OR NOT public.hotel_history_chain_010('hotel_capacity_reservations',c,audits) THEN RAISE EXCEPTION 'unproven' USING errcode='P0010'; END IF;
  reason:='UNSUPPORTED_TRANSITION';
  IF c->>'source_kind' IS DISTINCT FROM 'stay' OR c->>'hotel_stay_id' IS DISTINCT FROM s->>'id' OR c->>'physical_occupancy_id' IS NOT NULL
   OR c->>'quantity' IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'unproven' USING errcode='P0010'; END IF;
  -- A cancelled/reassigned allocation overlapping actual use is not evidence of actual occupancy.
  -- Long Stay inventory release is the sole explicitly proven archive exception here.
  IF (a->>'archived_at' IS NOT NULL OR c->>'archived_at' IS NOT NULL)
   AND NOT (longstay AND a->>'id'=leave_row->>'released_allocation_id' AND c->>'id'=leave_row->>'released_capacity_id') THEN
   reason:='PREASSIGNMENT_OR_ARCHIVE_UNPROVEN'; RAISE EXCEPTION 'unproven' USING errcode='P0010'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(audits) e WHERE e->>'entity_type'='hotel_room_allocations' AND e->>'entity_id'=a->>'id' AND e->'after_data' ? 'created_at'
   AND ((e->'after_data'->>'room_id' IS DISTINCT FROM a->>'room_id')
    OR ((CASE WHEN longstay THEN
       (e->'after_data'->>'allocated_until')::timestamptz > (e->'before_data'->>'allocated_until')::timestamptz
      ELSE (e->'after_data'->>'allocated_until')::timestamptz > (e->'before_data'->>'allocated_until')::timestamptz
       OR (e->>'change_reason'='입실 후 퇴실 예정 변경' AND (e->'after_data'->>'allocated_until')::timestamptz IS DISTINCT FROM (e->'before_data'->>'allocated_until')::timestamptz)
      END) AND (longstay OR NOT public.hotel_history_planned_adjustment_010(p,a,c,e)))
    OR (e->'before_data'->>'archived_at' IS NOT NULL AND e->'after_data'->>'archived_at' IS NULL)
    OR (e->'after_data'->>'allocated_from')::timestamptz IS DISTINCT FROM (a->>'allocated_from')::timestamptz
    OR e->'after_data'->>'request_id' IS DISTINCT FROM a->>'request_id'
    OR e->'after_data'->>'capacity_reservation_id' IS DISTINCT FROM c->>'id')) THEN RAISE EXCEPTION 'unproven' USING errcode='P0010'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(audits) e WHERE e->>'entity_type'='hotel_capacity_reservations' AND e->>'entity_id'=c->>'id' AND e->'after_data' ? 'created_at'
   AND (e->'after_data'->>'source_kind' IS DISTINCT FROM 'stay' OR e->'after_data'->>'hotel_stay_id' IS DISTINCT FROM s->>'id' OR e->'after_data'->>'physical_occupancy_id' IS NOT NULL)) THEN RAISE EXCEPTION 'unproven' USING errcode='P0010'; END IF;
  start_at:=greatest(lo,(a->>'allocated_from')::timestamptz); end_at:=least(hi,(a->>'allocated_until')::timestamptz);
  IF (c->>'reserved_from')::timestamptz>start_at OR (c->>'reserved_until')::timestamptz<end_at THEN
   reason:='CAPACITY_ENVELOPE_UNPROVEN'; RAISE EXCEPTION 'unproven' USING errcode='P0010'; END IF;
  IF longstay AND start_at<return_at AND end_at>leave_at THEN end_at:=least(end_at,leave_at); END IF;
  IF start_at>=end_at THEN CONTINUE; END IF;
  SELECT value INTO room FROM jsonb_array_elements(p->'rooms') WHERE value->>'roomId'=a->>'room_id';
  IF room IS NULL THEN reason:='ROOM_CANDIDATE_CONFLICT'; RAISE EXCEPTION 'unproven' USING errcode='P0010'; END IF;
  IF longstay AND cursor_at=leave_at THEN cursor_at:=return_at; END IF;
  IF start_at<>cursor_at THEN reason:='INTERVAL_NOT_COVERED'; RAISE EXCEPTION 'unproven' USING errcode='P0010'; END IF;
  IF NOT first_segment AND NOT (longstay AND a->>'id'=leave_row->>'returned_allocation_id' AND start_at=return_at) THEN
   reason:='MOVE_PROVENANCE_UNPROVEN';
   IF (prev->>'allocated_until')::timestamptz<>start_at OR prev->>'room_id'=a->>'room_id'
    OR prev->>'capacity_reservation_id' IS DISTINCT FROM a->>'capacity_reservation_id' OR a->>'request_id' IS NULL
    OR (SELECT value->>'roomTypeId' FROM jsonb_array_elements(p->'rooms') WHERE value->>'roomId'=prev->>'room_id') IS DISTINCT FROM room->>'roomTypeId'
    OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(audits) e WHERE e->>'entity_type'='hotel_room_allocations' AND e->>'entity_id'=prev->>'id'
     AND (e->'after_data'->>'allocated_until')::timestamptz=start_at
     AND (e->'before_data'->>'allocated_until')::timestamptz>start_at)
    OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(audits) e WHERE e->>'entity_type'='hotel_stays' AND e->>'entity_id'=s->>'id'
     AND e->>'request_id'=a->>'request_id' AND e->'after_data' ? 'created_at'
     AND e->'after_data'->>'checked_in_at' IS NOT NULL
     AND public.hotel_history_semantic_010('hotel_stays',e->'before_data')=public.hotel_history_semantic_010('hotel_stays',e->'after_data')
     AND e->'after_data'->>'id'=s->>'id' AND e->'before_data'->>'id'=s->>'id') THEN RAISE EXCEPTION 'unproven' USING errcode='P0010'; END IF;
  END IF;
  segments:=segments||jsonb_build_array(jsonb_build_object('allocationId',a->'id','roomId',a->'room_id','usedFrom',start_at,'usedUntil',end_at,
   'startEvent',CASE WHEN start_at=lo THEN 'check_in' WHEN longstay AND start_at=return_at THEN 'returned' ELSE 'moved_in' END,
   'endEvent',CASE WHEN end_at=(s->>'checked_out_at')::timestamptz THEN 'check_out' WHEN longstay AND end_at=leave_at THEN 'left_for_absence' ELSE 'moved_out' END));
  prev:=a; cursor_at:=end_at; first_segment:=false;
 END LOOP;
 IF longstay AND cursor_at=leave_at THEN cursor_at:=least(return_at,hi); END IF;
 IF cursor_at<required_until THEN reason:='INTERVAL_NOT_COVERED'; RAISE EXCEPTION 'unproven' USING errcode='P0010'; END IF;
 IF cursor_at>=hi AND hi=(s->>'checked_out_at')::timestamptz AND prev->>'id' IS DISTINCT FROM s->>'checkout_previous_allocation_id' THEN
  reason:='CHECKOUT_LINK_UNPROVEN'; RAISE EXCEPTION 'unproven' USING errcode='P0010'; END IF;
 RETURN jsonb_build_object('segments',segments,'reasonCode',null);
EXCEPTION WHEN SQLSTATE 'P0010' THEN RETURN jsonb_build_object('segments',CASE WHEN reason='MOVE_PROVENANCE_UNPROVEN' THEN segments ELSE '[]'::jsonb END,'reasonCode',reason,'affectedFrom',CASE WHEN reason='MOVE_PROVENANCE_UNPROVEN' THEN cursor_at ELSE lo END);
 WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow OR numeric_value_out_of_range THEN
 RETURN jsonb_build_object('segments','[]'::jsonb,'reasonCode','MALFORMED_EVIDENCE');
END $$;
CREATE OR REPLACE FUNCTION public.get_hotel_historical_room_board(p_local_date date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE ds timestamptz; de timestamptz; observed timestamptz:=statement_timestamp();
 scoped_stays jsonb; rooms jsonb; all_segments jsonb:='[]'; unavailable jsonb:='[]'; shared_proof jsonb; ids uuid[];
 ctx record; stay_value jsonb; evidence jsonb; proof jsonb; z jsonb; scope_range jsonb; kind text; reason text; events jsonb;
 start_at timestamptz; end_at timestamptz; affected_from timestamptz; affected_until timestamptz; conflicts text[];
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_active_operation_member() THEN RAISE EXCEPTION 'Hotel history authorization required' USING errcode='42501'; END IF;
 IF p_local_date IS NULL OR p_local_date >= (observed AT TIME ZONE 'Asia/Seoul')::date THEN
  RAISE EXCEPTION 'Past date required' USING errcode='22023'; END IF;
 ds:=p_local_date::timestamp AT TIME ZONE 'Asia/Seoul'; de:=(p_local_date+1)::timestamp AT TIME ZONE 'Asia/Seoul';
 SELECT coalesce(jsonb_agg(jsonb_build_object('roomId',r.id,'roomName',r.name,'roomTypeId',t.id,'roomType',t.name) ORDER BY t.name,r.name,r.id),'[]')
 INTO rooms FROM public.hotel_rooms r JOIN public.hotel_room_types t ON t.id=r.room_type_id;
 -- Scope is not room proof. Retained actual boundaries take precedence over old snapshots.
 -- An audit-only fallback after a reset must have a finite actual checkout: never open
 -- a completed/reset stay merely because an earlier snapshot had a null checkout.
 WITH actual_envelopes AS (
  SELECT s.id,s.checked_in_at used_from,least(coalesce(s.checked_out_at,observed),observed) used_until
  FROM public.hotel_stays s WHERE s.checked_in_at IS NOT NULL
  UNION ALL
  SELECT s.id,(e.after_data->>'checked_in_at')::timestamptz,
   least(coalesce(s.checked_out_at,(e.after_data->>'checked_out_at')::timestamptz),observed)
  FROM public.hotel_stays s JOIN public.entity_audit_events e ON e.entity_id=s.id AND e.entity_type='hotel_stays'
  WHERE s.checked_in_at IS NULL AND e.module_code='hotel_operations' AND e.after_data ? 'created_at'
   AND e.after_data->>'checked_in_at' IS NOT NULL
   AND coalesce(s.checked_out_at,(e.after_data->>'checked_out_at')::timestamptz) IS NOT NULL
 ), intersections AS (
  SELECT id,greatest(ds,used_from) scope_from,least(de,used_until) scope_until
  FROM actual_envelopes WHERE used_from IS NOT NULL AND used_until IS NOT NULL
 ), ordered AS (
  SELECT *,max(scope_until) OVER(PARTITION BY id ORDER BY scope_from,scope_until ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) prior_until
  FROM intersections WHERE scope_from<scope_until
 ), numbered AS (
  SELECT *,sum(CASE WHEN prior_until IS NULL OR prior_until<scope_from THEN 1 ELSE 0 END)
   OVER(PARTITION BY id ORDER BY scope_from,scope_until) island FROM ordered
 ), intervals AS (
  SELECT id,island,min(scope_from) scope_from,max(scope_until) scope_until FROM numbered GROUP BY id,island
 ), scoped AS (
  SELECT id,min(scope_from) scope_from,max(scope_until) scope_until,
   jsonb_agg(jsonb_build_object('from',scope_from,'until',scope_until) ORDER BY scope_from) scope_ranges
  FROM intervals GROUP BY id
 ) SELECT coalesce(jsonb_agg(to_jsonb(scoped)),'[]') INTO scoped_stays FROM scoped;
 -- All three lifecycle paths consume exactly the same selected-day scope.
 -- Shared ownership wins even when evidence is unavailable; Long Stay cannot fall back to Single.
 SELECT coalesce(array_agg(scope.id),'{}') INTO ids
 FROM jsonb_to_recordset(scoped_stays) AS scope(id uuid,scope_from timestamptz,scope_until timestamptz,scope_ranges jsonb)
 WHERE EXISTS(SELECT 1 FROM public.hotel_physical_occupancy_members m WHERE m.hotel_stay_id=scope.id)
 OR EXISTS(SELECT 1 FROM public.family_booking_members f WHERE f.hotel_stay_id=scope.id AND f.shared_room_group_id IS NOT NULL);
 shared_proof:=public.hotel_shared_verified_segments_internal(ids);
 FOR ctx IN
 WITH stays AS MATERIALIZED (
  SELECT s.*,d.name dog_name,scope.scope_from,scope.scope_until,scope.scope_ranges
  FROM public.hotel_stays s JOIN public.dogs d ON d.id=s.dog_id
  JOIN jsonb_to_recordset(scoped_stays) AS scope(id uuid,scope_from timestamptz,scope_until timestamptz,scope_ranges jsonb) ON scope.id=s.id
 ), capacities AS MATERIALIZED (
  SELECT c.* FROM public.hotel_capacity_reservations c JOIN stays s ON c.hotel_stay_id=s.id
 ), allocations AS MATERIALIZED (
  SELECT a.* FROM public.hotel_room_allocations a JOIN capacities c ON c.id=a.capacity_reservation_id
 ), audits AS MATERIALIZED (
  SELECT e.* FROM public.entity_audit_events e WHERE e.module_code='hotel_operations' AND
  ((e.entity_type='hotel_stays' AND e.entity_id IN (SELECT id FROM stays)) OR
   (e.entity_type='hotel_capacity_reservations' AND e.entity_id IN (SELECT id FROM capacities)) OR
   (e.entity_type='hotel_room_allocations' AND e.entity_id IN (SELECT id FROM allocations)))
 )
 SELECT to_jsonb(s)-ARRAY['dog_name','scope_from','scope_until','scope_ranges'] stay,s.dog_name,s.scope_from,s.scope_until,s.scope_ranges,
  coalesce((SELECT jsonb_agg(to_jsonb(c)) FROM capacities c WHERE c.hotel_stay_id=s.id),'[]') caps,
  coalesce((SELECT jsonb_agg(to_jsonb(a)) FROM allocations a JOIN capacities c ON c.id=a.capacity_reservation_id WHERE c.hotel_stay_id=s.id),'[]') allocs,
  coalesce((SELECT jsonb_agg(to_jsonb(e)) FROM audits e WHERE
    (e.entity_type='hotel_stays' AND e.entity_id=s.id) OR
    (e.entity_type='hotel_capacity_reservations' AND e.entity_id IN(SELECT id FROM capacities WHERE hotel_stay_id=s.id)) OR
    (e.entity_type='hotel_room_allocations' AND e.entity_id IN(SELECT a.id FROM allocations a JOIN capacities c ON c.id=a.capacity_reservation_id WHERE c.hotel_stay_id=s.id))),'[]') audit_rows,
  coalesce((SELECT jsonb_agg(to_jsonb(a)) FROM public.long_stay_absence_events a WHERE a.hotel_stay_id=s.id),'[]') absence_rows,
  coalesce((SELECT jsonb_agg(to_jsonb(r)) FROM public.long_stay_operation_audit_events r WHERE r.long_stay_contract_id IN
   (SELECT c.id FROM public.long_stay_contracts c WHERE c.current_hotel_stay_id=s.id UNION SELECT a.long_stay_contract_id FROM public.long_stay_absence_events a WHERE a.hotel_stay_id=s.id)),'[]') receipts,
  coalesce((SELECT jsonb_agg(to_jsonb(pr)) FROM public.hotel_planned_checkout_requests pr WHERE pr.hotel_stay_id=s.id),'[]') planned_requests,
  EXISTS(SELECT 1 FROM public.long_stay_contracts c WHERE c.current_hotel_stay_id=s.id)
   OR EXISTS(SELECT 1 FROM public.long_stay_absence_events a WHERE a.hotel_stay_id=s.id)
   OR EXISTS(SELECT 1 FROM public.long_stay_monthly_occupancies m WHERE m.hotel_stay_id=s.id) is_longstay
 FROM stays s ORDER BY s.id
 LOOP
  stay_value:=ctx.stay; reason:=NULL;
  kind:=CASE WHEN (stay_value->>'id')::uuid=ANY(ids) THEN 'shared' WHEN ctx.is_longstay THEN 'longstay' ELSE 'single' END;
  IF kind='shared' AND ctx.is_longstay THEN
   reason:='DOMAIN_OWNERSHIP_CONFLICT'; proof:=jsonb_build_object('segments','[]'::jsonb);
  ELSIF kind='shared' THEN
   SELECT value INTO proof FROM jsonb_array_elements(shared_proof) WHERE value->>'hotelStayId'=stay_value->>'id';
   reason:='SHARED_PARTICIPATION_UNPROVEN';
   IF EXISTS(SELECT 1 FROM public.hotel_physical_occupancy_requests r WHERE r.occupancy_id::text=proof->>'physicalOccupancyId' AND r.operation_kind='move') THEN reason:='MOVE_PROVENANCE_UNPROVEN';
   ELSIF EXISTS(SELECT 1 FROM public.hotel_physical_occupancy_requests r WHERE r.occupancy_id::text=proof->>'physicalOccupancyId' AND r.operation_kind='merge_existing_stays') THEN reason:='UNSUPPORTED_SHARED_MERGE'; END IF;
   IF public.hotel_history_shared_gate_010(stay_value,proof,
    (SELECT coalesce(jsonb_agg(to_jsonb(m)),'[]') FROM public.hotel_physical_occupancy_members m WHERE m.hotel_stay_id=(stay_value->>'id')::uuid),
    (SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]') FROM public.hotel_physical_occupancy_requests r WHERE r.occupancy_id::text=proof->>'physicalOccupancyId')) THEN
    reason:=NULL;
   END IF;
   IF reason IS NOT NULL THEN proof:=jsonb_build_object('segments','[]'::jsonb,'reasonCode',reason); END IF;
  ELSE
   evidence:=jsonb_build_object('stay',stay_value,'kind',kind,'capacities',ctx.caps,'allocations',ctx.allocs,'audits',ctx.audit_rows,
    'plannedRequests',CASE WHEN kind='single' THEN ctx.planned_requests ELSE '[]'::jsonb END,'absences',ctx.absence_rows,'receipts',ctx.receipts,'rooms',rooms,'asOf',observed,'windowUntil',de);
   proof:=public.hotel_history_individual_010(evidence);reason:=proof->>'reasonCode';
  END IF;
  IF reason IS NOT NULL OR proof IS NULL THEN
   FOR scope_range IN SELECT value FROM jsonb_array_elements(ctx.scope_ranges) LOOP
   affected_from:=greatest((scope_range->>'from')::timestamptz,coalesce((proof->>'affectedFrom')::timestamptz,(scope_range->>'from')::timestamptz));
   affected_until:=(scope_range->>'until')::timestamptz;
   IF affected_from<affected_until THEN
    unavailable:=unavailable||jsonb_build_array(jsonb_build_object('stayId',stay_value->'id','dogId',stay_value->'dog_id','dogName',ctx.dog_name,'lifecycleKind',kind,
     'reasonCode',coalesce(reason,'AUDIT_CHAIN_UNPROVEN'),'coverageClassification','unavailable','affectedFrom',affected_from,'affectedUntil',affected_until));
   END IF;
   END LOOP;
   IF coalesce(jsonb_array_length(proof->'segments'),0)=0 THEN CONTINUE; END IF;
  END IF;
  FOR z IN SELECT value FROM jsonb_array_elements(proof->'segments') LOOP
   start_at:=(z->>'usedFrom')::timestamptz; end_at:=(z->>'usedUntil')::timestamptz;
   IF greatest(start_at,ctx.scope_from)>=least(end_at,ctx.scope_until) THEN CONTINUE; END IF;
   events:='[]';
   IF start_at<ds THEN events:=events||'"continuing"'::jsonb; END IF;
   IF start_at>=ds THEN events:=events||to_jsonb(CASE WHEN start_at=(stay_value->>'checked_in_at')::timestamptz THEN 'check_in' ELSE coalesce(z->>'startEvent','moved_in') END); END IF;
   IF end_at>=ds AND end_at<de THEN
    IF end_at=(stay_value->>'checked_out_at')::timestamptz THEN events:=events||'"check_out"'::jsonb;
    ELSIF z->>'endEvent'='left_for_absence' THEN events:=events||'"left_for_absence"'::jsonb;
    ELSIF EXISTS(SELECT 1 FROM jsonb_array_elements(proof->'segments') nxt WHERE (nxt->>'usedFrom')::timestamptz=end_at) THEN events:=events||'"moved_out"'::jsonb; END IF;
   END IF;
   all_segments:=all_segments||jsonb_build_array(jsonb_build_object('segmentId',md5(concat_ws(':',stay_value->>'id',coalesce(z->>'allocationId',proof->>'physicalOccupancyId'),z->>'roomId',extract(epoch FROM start_at)::text)),
    'stayId',stay_value->'id','dogId',stay_value->'dog_id','dogName',ctx.dog_name,'lifecycleKind',kind,'physicalOccupancyId',proof->'physicalOccupancyId',
    'roomId',z->'roomId','usedFrom',start_at,'usedUntil',end_at,'displayFrom',greatest(ctx.scope_from,start_at),'displayUntil',least(ctx.scope_until,end_at),
    'selectedDayEvents',events,'provenanceStatus','verified','coverageClassification','verified_supported_path'));
  END LOOP;
 END LOOP;
 -- Cross-stay room conflicts fail closed; co-members of the same proven Shared occupancy are allowed.
 SELECT array_agg(DISTINCT a->>'stayId') INTO conflicts FROM jsonb_array_elements(all_segments) a CROSS JOIN jsonb_array_elements(all_segments) b
 WHERE a->>'stayId'<>b->>'stayId' AND a->>'roomId'=b->>'roomId'
 AND (a->>'displayFrom')::timestamptz<(b->>'displayUntil')::timestamptz AND (b->>'displayFrom')::timestamptz<(a->>'displayUntil')::timestamptz
 AND NOT (a->>'lifecycleKind'='shared' AND b->>'lifecycleKind'='shared' AND a->>'physicalOccupancyId'=b->>'physicalOccupancyId');
 IF conflicts IS NOT NULL THEN
  SELECT unavailable||coalesce(jsonb_agg(x),'[]') INTO unavailable FROM (
   SELECT DISTINCT jsonb_build_object('stayId',s->'stayId','dogId',s->'dogId','dogName',s->'dogName','lifecycleKind',s->'lifecycleKind','reasonCode','ROOM_CANDIDATE_CONFLICT','coverageClassification','unavailable',
    'affectedFrom',s->'displayFrom','affectedUntil',s->'displayUntil') x
   FROM jsonb_array_elements(all_segments) s WHERE s->>'stayId'=ANY(conflicts)) q;
  SELECT coalesce(jsonb_agg(s),'[]') INTO all_segments FROM jsonb_array_elements(all_segments) s WHERE NOT(s->>'stayId'=ANY(conflicts));
 END IF;
 SELECT coalesce(jsonb_agg(q.value ORDER BY q.value->>'stayId',q.value->>'affectedFrom'),'[]') INTO unavailable FROM (SELECT DISTINCT ON (u->>'stayId',u->>'affectedFrom',u->>'affectedUntil') u value FROM jsonb_array_elements(unavailable) u ORDER BY u->>'stayId',u->>'affectedFrom',u->>'affectedUntil',(u->>'reasonCode'='ROOM_CANDIDATE_CONFLICT') DESC) q;
 RETURN jsonb_build_object('selectedDate',p_local_date,'timezone','Asia/Seoul','evidenceAsOf',observed,'readOnly',true,'coverageStatus','PARTIAL',
  'rooms',(SELECT coalesce(jsonb_agg(r||jsonb_build_object('segments',(SELECT coalesce(jsonb_agg(s ORDER BY s->>'displayFrom',s->>'segmentId'),'[]') FROM jsonb_array_elements(all_segments) s WHERE s->>'roomId'=r->>'roomId'))),'[]') FROM jsonb_array_elements(rooms) r),
  'unavailable',unavailable);
END $$;
COMMIT;
