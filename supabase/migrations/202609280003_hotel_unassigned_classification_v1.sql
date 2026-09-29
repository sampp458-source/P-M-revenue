-- Candidate only. Additive classification; booking membership/count is unchanged.
-- No business writes, public RPC signature changes, policies, triggers or tables.
BEGIN;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM (VALUES
      ('public.hotel_selected_date_unassigned_internal(date)','4726fbb8e6f41bffd5c5c9182a2774aa'),
      ('public.hotel_current_physical_rooms_internal()','0e04f9124a1fe36f1f8a2a8cb8072807'),
      ('public.get_unassigned_shared_hotel_room_groups(date)','760e1d7cca31bfa3f9803c15c210ea4c'),
      ('public.get_hotel_operations_snapshot_v2(date)','56b2afa3112502405d1fc7cdb4ccddfe')
    ) expected(signature,body_md5)
    LEFT JOIN pg_proc p ON p.oid=to_regprocedure(expected.signature)
    WHERE p.oid IS NULL OR md5(p.prosrc)<>expected.body_md5
  ) THEN RAISE EXCEPTION 'STOP_UNASSIGNED_CLASSIFICATION_PREDECESSOR_MISMATCH'; END IF;
END;
$$;

-- CREATE OR REPLACE retains the internal helper owner and existing restrictive ACL.
CREATE OR REPLACE FUNCTION public.hotel_selected_date_unassigned_internal(p_local_date date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  day_start timestamptz;
  day_end timestamptz;
  shared_rows jsonb;
  single_items jsonb;
  shared_items jsonb;
  physical_rows jsonb;
  classified_items jsonb := '[]'::jsonb;
  v_item jsonb;
  member_ids uuid[];
  evidence record;
  classification text;
  reason text;
  shared_valid boolean;
  summary jsonb;
BEGIN
  IF NOT public.is_active_operation_member() THEN
    RAISE EXCEPTION '호텔 운영 조회 권한이 없습니다.' USING errcode='42501';
  END IF;
  IF p_local_date IS NULL THEN
    RAISE EXCEPTION '조회 날짜가 필요합니다.' USING errcode='22023';
  END IF;
  day_start := p_local_date::timestamp AT TIME ZONE 'Asia/Seoul';
  day_end := (p_local_date + 1)::timestamp AT TIME ZONE 'Asia/Seoul';
  -- Reuse the validated, DELUXE-only, group-cardinality read contract.
  shared_rows := public.get_unassigned_shared_hotel_room_groups(p_local_date);
  WITH demand AS (
    SELECT s.id stay_id, c.id capacity_id, c.room_type_id,
      c.reserved_from, c.reserved_until
    FROM public.hotel_capacity_reservations c
    JOIN public.hotel_stays s ON s.id=c.hotel_stay_id
    WHERE c.archived_at IS NULL AND c.source_kind='stay'
      AND c.quantity=1 AND c.shared_room_group_id IS NULL
      AND s.archived_at IS NULL AND s.checked_out_at IS NULL
      AND c.reserved_from<day_end AND c.reserved_until>day_start
      -- Assignment is an existing nonarchived segment of this capacity,
      -- overlapping the selected demand slice. Historical segments outside
      -- that slice do not assign it; partial-day actual entry is not a gap error.
      AND NOT EXISTS (
        SELECT 1 FROM public.hotel_room_allocations a
        WHERE a.capacity_reservation_id=c.id AND a.archived_at IS NULL
          AND a.allocated_from<least(c.reserved_until,day_end)
          AND a.allocated_until>greatest(c.reserved_from,day_start)
      )
  ), units AS (
    SELECT stay_id, jsonb_build_object(
      'kind','single','canonicalId',stay_id,
      'capacitySegments',jsonb_agg(jsonb_build_object(
        'capacityId',capacity_id,'roomTypeId',room_type_id,
        'capacityStart',reserved_from,'capacityEnd',reserved_until
      ) ORDER BY reserved_from,capacity_id)
    ) item FROM demand GROUP BY stay_id
  ) SELECT coalesce(jsonb_agg(item ORDER BY stay_id),'[]'::jsonb)
    INTO single_items FROM units;
  SELECT coalesce(jsonb_agg(item ORDER BY group_id),'[]'::jsonb)
    INTO shared_items FROM (
      SELECT DISTINCT ON (g->>'sharedRoomGroupId') g->>'sharedRoomGroupId' group_id,
        jsonb_build_object('kind','shared','canonicalId',g->>'sharedRoomGroupId',
          'capacitySegments',jsonb_build_array(jsonb_build_object(
            'capacityId',g->>'capacityReservationId','roomTypeId',g->>'roomTypeId',
            'capacityStart',g->>'reservedFrom','capacityEnd',g->>'reservedUntil'
          ))) item
      FROM jsonb_array_elements(shared_rows) g
      ORDER BY g->>'sharedRoomGroupId'
    ) groups;
  -- Resolve current physical identity once, using the same source as the guards.
  SELECT coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb) INTO physical_rows
    FROM public.hotel_current_physical_rooms_internal() p;
  FOR v_item IN SELECT value FROM jsonb_array_elements(single_items || shared_items) LOOP
    shared_valid := true;
    IF v_item->>'kind' = 'single' THEN
      member_ids := ARRAY[(v_item->>'canonicalId')::uuid];
    ELSE
      -- Membership/cardinality already passed the existing Shared read contract.
      -- Recheck lifecycle, not normalized_starts_at, for arrival classification.
      SELECT array_agg(m.hotel_stay_id ORDER BY m.hotel_stay_id),
        coalesce(bool_and(g.status='requested' AND b.archived_at IS NULL
          AND m.service_type='hotel' AND m.hotel_stay_id IS NOT NULL),false)
        AND count(*)=count(DISTINCT m.hotel_stay_id) AND count(*)>=2
      INTO member_ids, shared_valid
      FROM public.family_shared_room_groups g
      JOIN public.family_bookings b ON b.id=g.family_booking_id
      JOIN public.family_booking_members m ON m.shared_room_group_id=g.id
        AND m.family_booking_id=b.id AND m.archived_at IS NULL
      WHERE g.id=(v_item->>'canonicalId')::uuid AND g.archived_at IS NULL;
    END IF;
    WITH members AS (
      SELECT s.*, arrival.n arrival_count, arrival.starts_at arrival_at,
        arrival.valid arrival_valid, arrival.time_unspecified,
        -- Match the Legacy Physical Occupancy snapshot's released exception.
        EXISTS (SELECT 1 FROM public.long_stay_absence_events e
          WHERE e.hotel_stay_id=s.id AND e.archived_at IS NULL
            AND e.event_type='leave' AND e.is_open AND e.inventory_mode='release_room'
            AND e.occurred_at<=statement_timestamp()) released,
        (SELECT count(*) FROM jsonb_array_elements(physical_rows) p
          JOIN public.hotel_rooms room ON room.id=(p->>'room_id')::uuid
          WHERE p->>'stay_id'=s.id::text
            AND EXISTS (SELECT 1 FROM public.hotel_room_allocations a
              WHERE a.capacity_reservation_id=(p->>'capacity_id')::uuid
                AND a.room_id=room.id AND a.archived_at IS NULL
                AND a.allocated_from<=statement_timestamp())) physical_count,
        (SELECT count(*) FROM public.long_stay_absence_events leave_event
          JOIN public.long_stay_contracts contract ON contract.id=leave_event.long_stay_contract_id
            AND contract.current_hotel_stay_id=s.id AND contract.archived_at IS NULL
            AND contract.status='active'
          WHERE leave_event.hotel_stay_id=s.id AND leave_event.archived_at IS NULL
            AND leave_event.event_type='leave' AND leave_event.inventory_mode='release_room'
            AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_item->'capacitySegments') segment
              WHERE segment->>'capacityId'=leave_event.return_capacity_id::text)
            AND (
              (leave_event.is_open AND leave_event.inventory_transition_status='room_released'
                AND leave_event.expected_return_date=p_local_date
                AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_item->'capacitySegments') segment
                  WHERE segment->>'capacityId'=leave_event.return_capacity_id::text
                    AND (segment->>'capacityStart')::timestamptz=leave_event.guarantee_from)
                AND EXISTS (SELECT 1 FROM public.hotel_room_allocations released_allocation
                  JOIN public.hotel_capacity_reservations released_capacity
                    ON released_capacity.id=leave_event.released_capacity_id
                  WHERE released_allocation.id=leave_event.released_allocation_id
                    AND released_allocation.capacity_reservation_id=released_capacity.id
                    AND released_capacity.hotel_stay_id=s.id AND released_capacity.archived_at IS NOT NULL
                    AND released_allocation.allocated_until=released_capacity.reserved_until
                    AND released_allocation.allocated_until>=leave_event.occurred_at
                    AND released_allocation.allocated_until<=leave_event.guarantee_from)
                AND (leave_event.guarantee_from AT TIME ZONE 'Asia/Seoul')::date=p_local_date)
              OR (NOT leave_event.is_open AND leave_event.inventory_transition_status='room_returned'
                AND (SELECT count(*) FROM public.long_stay_absence_events returned
                  WHERE returned.paired_leave_event_id=leave_event.id
                    AND returned.hotel_stay_id=s.id AND returned.long_stay_contract_id=contract.id
                    AND returned.event_type='return' AND returned.archived_at IS NULL
                    AND (returned.occurred_at AT TIME ZONE 'Asia/Seoul')::date=p_local_date)=1)
            )) return_count
      FROM public.hotel_stays s
      LEFT JOIN LATERAL (
        SELECT count(*) n,min(os.starts_at) starts_at,
          bool_and(os.status='scheduled' AND os.archived_at IS NULL
            AND os.starts_at IS NOT NULL AND isfinite(os.starts_at)) valid,
          bool_or(os.time_unspecified) time_unspecified
        FROM public.hotel_stay_schedule_events e
        LEFT JOIN public.operation_schedules os ON os.id=e.operation_schedule_id
        WHERE e.hotel_stay_id=s.id AND e.event_kind='check_in' AND e.archived_at IS NULL
      ) arrival ON true
      WHERE s.id=ANY(member_ids)
    ) SELECT count(*) n,
      coalesce(bool_and(archived_at IS NULL AND checked_out_at IS NULL),false) lifecycle_valid,
      coalesce(bool_or(checked_in_at IS NOT NULL AND checked_out_at IS NULL
        AND archived_at IS NULL AND physical_count<>1 AND NOT released),false) unresolved,
      coalesce(bool_and(checked_in_at IS NULL),false) all_pending,
      coalesce(bool_or(checked_in_at IS NOT NULL),false) any_checked_in,
      coalesce(bool_and(arrival_count=1 AND arrival_valid),false) arrivals_valid,
      coalesce(bool_and((arrival_at AT TIME ZONE 'Asia/Seoul')::date=p_local_date),false) arrives_today,
      coalesce(bool_and((arrival_at AT TIME ZONE 'Asia/Seoul')::date<p_local_date),false) arrives_before,
      -- Lateness is current operational evidence, never selected-date arithmetic.
      -- Unknown time has no clock deadline: only a completed KST day is late.
      coalesce(bool_and(CASE WHEN time_unspecified THEN
        (arrival_at AT TIME ZONE 'Asia/Seoul')::date < (statement_timestamp() AT TIME ZONE 'Asia/Seoul')::date
        ELSE arrival_at < statement_timestamp() END),false) arrivals_overdue,
      coalesce(bool_and(return_count=1),false) returns_today,
      min(arrival_at) first_arrival, max(arrival_at) last_arrival,
      bool_or(time_unspecified) time_unspecified
    INTO evidence FROM members;
    classification := 'OTHER'; reason := 'CANONICAL_EVIDENCE_INCOMPLETE';
    IF evidence.n IS DISTINCT FROM cardinality(member_ids) OR NOT shared_valid OR NOT evidence.lifecycle_valid THEN
      reason := 'MEMBER_LIFECYCLE_INCONSISTENT';
    ELSIF evidence.unresolved THEN
      classification := 'CHECKED_IN_UNRESOLVED'; reason := 'CURRENT_PHYSICAL_ROOM_UNRESOLVED';
    ELSIF v_item->>'kind'='single' AND evidence.any_checked_in AND evidence.returns_today THEN
      classification := 'LONG_STAY_RETURN'; reason := 'CANONICAL_RELEASE_RETURN_SEGMENT';
    ELSIF evidence.all_pending AND evidence.arrivals_valid AND evidence.arrives_today THEN
      classification := 'ARRIVAL'; reason := 'CANONICAL_INITIAL_CHECK_IN_SELECTED_DATE';
    ELSIF evidence.all_pending AND evidence.arrivals_valid AND evidence.arrives_before AND evidence.arrivals_overdue THEN
      classification := 'LATE_ARRIVAL'; reason := 'CANONICAL_INITIAL_CHECK_IN_ACTUALLY_OVERDUE';
    ELSIF evidence.all_pending AND evidence.arrivals_valid AND evidence.arrives_before THEN
      classification := 'PLANNED_STAY_UNASSIGNED'; reason := 'CANONICAL_PLANNED_STAY_NOT_OVERDUE';
    END IF;
    classified_items := classified_items || jsonb_build_array(v_item || jsonb_build_object(
      'classification',classification,'classificationReasonCode',reason,
      'canonicalArrivalAt',CASE WHEN evidence.arrivals_valid THEN evidence.first_arrival END,
      'canonicalArrivalUntil',CASE WHEN evidence.arrivals_valid THEN evidence.last_arrival END,
      'arrivalTimeUnspecified',CASE WHEN evidence.arrivals_valid THEN evidence.time_unspecified END,
      'actualCheckInState',CASE WHEN NOT evidence.lifecycle_valid THEN 'inconsistent'
        WHEN evidence.all_pending THEN 'pending' WHEN evidence.any_checked_in THEN 'checked_in' ELSE 'unknown' END
    ));
  END LOOP;
  SELECT jsonb_object_agg(kind,n) INTO summary FROM (
    SELECT kind,(SELECT count(*) FROM jsonb_array_elements(classified_items) i
      WHERE i->>'classification'=kind) n
    FROM unnest(ARRAY['ARRIVAL','LATE_ARRIVAL','PLANNED_STAY_UNASSIGNED','LONG_STAY_RETURN','CHECKED_IN_UNRESOLVED','OTHER']) kind
  ) counts;
  RETURN jsonb_build_object(
    'date',p_local_date,
    'count',jsonb_array_length(single_items)+jsonb_array_length(shared_items),
    'singleStayIds',coalesce((SELECT jsonb_agg(i->'canonicalId') FROM jsonb_array_elements(single_items) i),'[]'::jsonb),
    'sharedGroupIds',coalesce((SELECT jsonb_agg(i->'canonicalId') FROM jsonb_array_elements(shared_items) i),'[]'::jsonb),
    'items',classified_items,
    'classificationSummary',summary
  );
END;
$$;

COMMIT;
