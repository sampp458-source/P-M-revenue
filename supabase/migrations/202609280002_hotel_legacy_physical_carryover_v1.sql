-- Candidate only. No historical row rewrite or planned-capacity extension.
BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM (VALUES
      ('public.hotel_current_physical_rooms_internal()', '084c0ad98b3eb88bb43a00f53eb0b30e'),
      ('public.assert_hotel_physical_room_available_internal(uuid,uuid)', '253c293f3783e827a7bd90bae21d472a'),
      ('public.guard_hotel_physical_allocation_internal()', '167e91d443dc2304efe683d3a7289015'),
      ('public.guard_hotel_physical_check_in_internal()', '97b527fa8f52b36d3f2fd5d54a57d3e3'),
      ('public.get_hotel_operations_snapshot(date)', '6c5f11faa36e099aa4ad14274be19839'),
      ('public.get_hotel_operations_snapshot_v2(date)', '56b2afa3112502405d1fc7cdb4ccddfe'),
      ('public.hotel_selected_date_unassigned_internal(date)', '4726fbb8e6f41bffd5c5c9182a2774aa'),
      ('public.get_unassigned_shared_hotel_room_groups(date)', '760e1d7cca31bfa3f9803c15c210ea4c'),
      ('public.reverse_hotel_completion(uuid,integer,text,text,uuid)', '98ad764ce3b12bc5f87ba1dfba8169b2'),
      ('public.reverse_shared_hotel_member_completion(uuid,uuid,integer,integer,text,uuid)', 'e2517aeecb9bd485dbeaed34049ecd99'),
      ('public.hotel_history_semantic_010(text,jsonb)', '918972afa05c7cf40223c79ecf0f26dc'),
      ('public.hotel_history_chain_010(text,jsonb,jsonb)', '850f95d9131a5cf22f33df0a5aa2bdc1'),
      ('public.hotel_shared_semantic_internal(text,jsonb)', 'd07e04b00d05e4e72173fc62667553e0'),
      ('public.hotel_shared_chain_internal(text,jsonb,jsonb)', '2f2bbaf15d0d9bbc409b5d931c8783a3')
    ) expected(signature, body_md5)
    LEFT JOIN pg_proc p ON p.oid=to_regprocedure(expected.signature)
    WHERE p.oid IS NULL OR md5(p.prosrc)<>expected.body_md5
  ) OR to_regprocedure('public.hotel_shared_chain_internal(text,jsonb,jsonb)') IS NULL
    OR to_regprocedure('public.hotel_history_chain_010(text,jsonb,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'STOP_LEGACY_CARRYOVER_PREDECESSOR_MISMATCH';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.hotel_room_allocations'::regclass
    AND tgname='hotel_physical_allocation_guard' AND tgenabled='O'
    AND tgfoid='public.guard_hotel_physical_allocation_internal()'::regprocedure)
    OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.hotel_stays'::regclass
    AND tgname='hotel_physical_check_in_guard' AND tgenabled='O'
    AND tgfoid='public.guard_hotel_physical_check_in_internal()'::regprocedure) THEN
    RAISE EXCEPTION 'STOP_LEGACY_CARRYOVER_PHYSICAL_GUARD_MISSING';
  END IF;
END $$;

-- Recover the state at the cutover from a complete, current-matching audit chain.
-- Later planned-end changes cannot manufacture a historical physical anchor.
CREATE FUNCTION public.hotel_physical_cutover_row_internal(p_kind text,p_current jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE evidence jsonb; result jsonb;
BEGIN
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'entity_type',e.entity_type,'entity_id',e.entity_id,'action',e.action,
    'before_data',e.before_data,'after_data',e.after_data,'created_at',e.created_at
  ) ORDER BY e.created_at,e.id),'[]'::jsonb) INTO evidence
  FROM public.entity_audit_events e
  WHERE e.module_code='hotel_operations' AND e.entity_type=p_kind
    AND e.entity_id=(p_current->>'id')::uuid;
  IF p_kind IN ('hotel_stays','hotel_capacity_reservations','hotel_room_allocations') THEN
    IF NOT public.hotel_history_chain_010(p_kind,p_current,evidence) THEN RETURN NULL; END IF;
  ELSIF public.hotel_shared_chain_internal(p_kind,p_current,evidence) IS NULL THEN RETURN NULL;
  END IF;
  SELECT e->'after_data' INTO result FROM jsonb_array_elements(evidence) e
  WHERE (e->>'created_at')::timestamptz<=timestamptz '2026-09-25 00:00:00+09'
  ORDER BY (e->'after_data'->>'version')::integer DESC LIMIT 1;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.hotel_physical_cutover_row_internal(text,jsonb) FROM PUBLIC,anon,authenticated,service_role;

-- One row per proven anchor, not per dog name. Shared members can share one anchor.
CREATE FUNCTION public.hotel_legacy_physical_anchors_internal()
RETURNS TABLE(stay_id uuid,capacity_id uuid,allocation_id uuid,room_id uuid,allocated_from timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s record; c record; a record; m record; old_s jsonb; old_c jsonb; old_a jsonb; old_m jsonb;
  cutover constant timestamptz:=timestamptz '2026-09-25 00:00:00+09'; linked boolean;
BEGIN
  FOR s IN SELECT x.* FROM public.hotel_stays x
    WHERE x.archived_at IS NULL AND x.checked_in_at<cutover AND x.checked_out_at IS NULL LOOP
    old_s:=public.hotel_physical_cutover_row_internal('hotel_stays',to_jsonb(s));
    IF old_s IS NULL OR old_s->>'archived_at' IS NOT NULL
      OR old_s->>'checked_out_at' IS NOT NULL OR old_s->>'checked_in_at' IS NULL
      OR (old_s->>'checked_in_at')::timestamptz IS DISTINCT FROM s.checked_in_at THEN CONTINUE; END IF;
    -- Retain archived/converted segments for proof only. Current use is resolved separately.
    FOR c IN SELECT x.* FROM public.hotel_capacity_reservations x
      WHERE x.hotel_stay_id=s.id OR EXISTS (
        SELECT 1 FROM public.entity_audit_events e WHERE e.module_code='hotel_operations'
          AND e.entity_type='hotel_capacity_reservations' AND e.entity_id=x.id
          AND e.after_data->>'hotel_stay_id'=s.id::text
      ) OR EXISTS (
        SELECT 1 FROM public.hotel_physical_occupancy_members member
        JOIN public.hotel_physical_occupancies o ON o.id=member.occupancy_id
        WHERE member.hotel_stay_id=s.id AND o.capacity_reservation_id=x.id
      ) LOOP
      old_c:=public.hotel_physical_cutover_row_internal('hotel_capacity_reservations',to_jsonb(c));
      IF old_c IS NULL OR old_c->>'archived_at' IS NOT NULL OR (old_c->>'quantity')::integer<>1 THEN CONTINUE; END IF;
      linked:=old_c->>'hotel_stay_id'=s.id::text AND old_c->>'source_kind'='stay';
      IF NOT coalesce(linked,false) AND old_c->>'source_kind'='shared_occupancy' THEN
        FOR m IN SELECT x.* FROM public.hotel_physical_occupancy_members x
          WHERE x.hotel_stay_id=s.id AND x.occupancy_id=(old_c->>'physical_occupancy_id')::uuid LOOP
          old_m:=public.hotel_physical_cutover_row_internal('hotel_physical_occupancy_members',to_jsonb(m));
          linked:=coalesce(old_m->>'status'='active' AND old_m->>'archived_at' IS NULL
            AND old_m->>'hotel_stay_id'=s.id::text
            AND old_m->>'occupancy_id'=old_c->>'physical_occupancy_id'
            AND (old_m->>'joined_at')::timestamptz<=cutover,false);
          EXIT WHEN linked;
        END LOOP;
      END IF;
      IF NOT coalesce(linked,false) THEN CONTINUE; END IF;
      FOR a IN SELECT x.* FROM public.hotel_room_allocations x WHERE x.capacity_reservation_id=c.id LOOP
        old_a:=public.hotel_physical_cutover_row_internal('hotel_room_allocations',to_jsonb(a));
        IF old_a IS NULL OR old_a->>'archived_at' IS NOT NULL
          OR old_a->>'capacity_reservation_id'<>c.id::text
          OR (old_a->>'allocated_from')::timestamptz>cutover
          OR coalesce((old_a->>'allocated_until')::timestamptz,'infinity')<=cutover THEN CONTINUE; END IF;
        stay_id:=s.id;capacity_id:=c.id;allocation_id:=a.id;room_id:=(old_a->>'room_id')::uuid;
        allocated_from:=(old_a->>'allocated_from')::timestamptz;
        RETURN NEXT;
      END LOOP;
    END LOOP;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.hotel_legacy_physical_anchors_internal() FROM PUBLIC,anon,authenticated,service_role;

-- Follow an actual assignment chain. Expiry of the terminal planned segment is
-- not release; gaps, overlaps, archived seeds, or multiple successors are not proof.
CREATE FUNCTION public.hotel_physical_allocation_successor_internal(p_seed uuid,p_capacity uuid)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE current_row public.hotel_room_allocations%rowtype; next_row public.hotel_room_allocations%rowtype;
  n integer; visited uuid[]:='{}';
BEGIN
  SELECT * INTO current_row FROM public.hotel_room_allocations a
    WHERE a.id=p_seed AND a.capacity_reservation_id=p_capacity AND a.archived_at IS NULL
      AND a.allocated_from<=statement_timestamp();
  IF NOT FOUND THEN RETURN NULL; END IF;
  LOOP
    visited:=array_append(visited,current_row.id);
    SELECT count(*) INTO n FROM public.hotel_room_allocations a
      WHERE a.capacity_reservation_id=p_capacity AND a.archived_at IS NULL
        AND a.allocated_from>=current_row.allocated_from AND a.allocated_from<=statement_timestamp()
        AND NOT a.id=ANY(visited);
    IF n=0 THEN RETURN current_row.id; END IF;
    SELECT count(*) INTO n FROM public.hotel_room_allocations a
      WHERE a.capacity_reservation_id=p_capacity AND a.archived_at IS NULL
        AND a.allocated_from=current_row.allocated_until AND a.allocated_from<=statement_timestamp()
        AND NOT a.id=ANY(visited);
    IF n<>1 THEN RETURN NULL; END IF;
    SELECT * INTO next_row FROM public.hotel_room_allocations a
      WHERE a.capacity_reservation_id=p_capacity AND a.archived_at IS NULL
        AND a.allocated_from=current_row.allocated_until AND a.allocated_from<=statement_timestamp()
        AND NOT a.id=ANY(visited);
    IF EXISTS(SELECT 1 FROM public.hotel_room_allocations a
      WHERE a.capacity_reservation_id=p_capacity AND a.archived_at IS NULL
        AND a.allocated_from>=current_row.allocated_from AND a.allocated_from<next_row.allocated_from
        AND NOT a.id=ANY(visited)) THEN RETURN NULL; END IF;
    current_row:=next_row;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.hotel_physical_allocation_successor_internal(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

-- Only the bounded legacy branches are new. Native V1 and daycare branches below
-- retain their existing contract. A Long Stay actual return is a separate proof,
-- not retroactive cutover eligibility and not a future return-capacity reservation.
CREATE FUNCTION public.hotel_legacy_current_physical_rooms_internal()
RETURNS TABLE(room_id uuid,capacity_id uuid,stay_id uuid,occupancy_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s record; anchor jsonb; anchors jsonb; ret record; active_shared record;
  anchor_count integer; shared_count integer; seed uuid; cap uuid; resolved uuid;
BEGIN
  SELECT coalesce(jsonb_agg(to_jsonb(a)),'[]'::jsonb) INTO anchors
  FROM public.hotel_legacy_physical_anchors_internal() a;
  FOR s IN SELECT x.* FROM public.hotel_stays x
    WHERE x.archived_at IS NULL AND x.checked_in_at<timestamptz '2026-09-25 00:00:00+09'
      AND x.checked_out_at IS NULL LOOP
    seed:=NULL;cap:=NULL;anchor:=NULL;
    SELECT count(*) INTO anchor_count FROM jsonb_array_elements(anchors) a WHERE a->>'stay_id'=s.id::text;
    IF anchor_count=1 THEN
      SELECT a INTO anchor FROM jsonb_array_elements(anchors) a WHERE a->>'stay_id'=s.id::text;
      seed:=(anchor->>'allocation_id')::uuid;cap:=(anchor->>'capacity_id')::uuid;
    END IF;
    -- A release is explicit even when its future return capacity already exists.
    IF EXISTS(SELECT 1 FROM public.long_stay_absence_events e
      WHERE e.hotel_stay_id=s.id AND e.archived_at IS NULL AND e.event_type='leave'
        AND e.inventory_mode='release_room' AND e.is_open
        AND e.occurred_at<=statement_timestamp()) THEN CONTINUE; END IF;
    -- Follow the latest completed actual return with its canonical paired leave.
    SELECT l.returned_allocation_id,l.return_capacity_id INTO ret
    FROM public.long_stay_absence_events r
    JOIN public.long_stay_absence_events l ON l.id=r.paired_leave_event_id
    JOIN public.long_stay_contracts k ON k.id=r.long_stay_contract_id
    JOIN public.hotel_room_allocations a ON a.id=l.returned_allocation_id
    JOIN public.hotel_capacity_reservations c ON c.id=l.return_capacity_id
    WHERE r.hotel_stay_id=s.id AND l.hotel_stay_id=s.id AND k.current_hotel_stay_id=s.id
      AND k.archived_at IS NULL AND k.status='active'
      AND r.event_type='return' AND l.event_type='leave' AND l.inventory_mode='release_room'
      AND NOT l.is_open AND l.inventory_transition_status='room_returned'
      AND r.archived_at IS NULL AND l.archived_at IS NULL
      AND r.long_stay_contract_id=l.long_stay_contract_id
      AND r.occurred_at>=timestamptz '2026-09-25 00:00:00+09'
      AND r.occurred_at<=statement_timestamp() AND r.occurred_at>l.occurred_at
      AND a.capacity_reservation_id=c.id AND a.room_id=l.returned_room_id
      AND a.allocated_from=r.occurred_at AND a.archived_at IS NULL
      AND c.hotel_stay_id=s.id AND c.archived_at IS NULL AND c.source_kind='stay'
    ORDER BY r.occurred_at DESC,r.id LIMIT 1;
    IF FOUND THEN seed:=ret.returned_allocation_id;cap:=ret.return_capacity_id; END IF;
    IF seed IS NULL THEN CONTINUE; END IF;
    SELECT count(*) INTO shared_count
    FROM public.hotel_physical_occupancy_members m
    WHERE m.hotel_stay_id=s.id AND m.archived_at IS NULL AND m.status='active';
    IF shared_count>0 THEN
      IF shared_count<>1 THEN CONTINUE; END IF;
      SELECT o.* INTO active_shared FROM public.hotel_physical_occupancy_members m
      JOIN public.hotel_physical_occupancies o ON o.id=m.occupancy_id
      JOIN public.family_shared_room_groups g ON g.id=o.shared_room_group_id
      JOIN public.hotel_rooms r ON r.id=o.room_id
      JOIN public.hotel_room_types t ON t.id=r.room_type_id
      JOIN public.hotel_capacity_reservations c ON c.id=o.capacity_reservation_id
      WHERE m.hotel_stay_id=s.id AND m.archived_at IS NULL AND m.status='active'
        AND o.archived_at IS NULL AND o.status='active' AND o.occupied_from<=statement_timestamp()
        AND g.archived_at IS NULL AND g.status='allocated' AND t.code='DELUXE'
        AND c.archived_at IS NULL AND c.source_kind='shared_occupancy' AND c.quantity=1
        AND c.physical_occupancy_id=o.id
        AND (c.shared_room_group_id IS NULL OR c.shared_room_group_id=g.id);
      IF FOUND THEN
        room_id:=active_shared.room_id;capacity_id:=active_shared.capacity_reservation_id;
        stay_id:=s.id;occupancy_id:=active_shared.id;RETURN NEXT;
      END IF;
      CONTINUE;
    END IF;
    IF NOT EXISTS(SELECT 1 FROM public.hotel_capacity_reservations c
      WHERE c.id=cap AND c.hotel_stay_id=s.id AND c.archived_at IS NULL AND c.source_kind='stay') THEN CONTINUE; END IF;
    IF seed=(anchor->>'allocation_id')::uuid AND NOT EXISTS(
      SELECT 1 FROM public.hotel_room_allocations a WHERE a.id=seed
        AND a.room_id=(anchor->>'room_id')::uuid
        AND a.allocated_from=(anchor->>'allocated_from')::timestamptz
    ) THEN CONTINUE; END IF;
    resolved:=public.hotel_physical_allocation_successor_internal(seed,cap);
    IF resolved IS NULL THEN CONTINUE; END IF;
    SELECT a.room_id INTO room_id FROM public.hotel_room_allocations a WHERE a.id=resolved;
    capacity_id:=cap;stay_id:=s.id;occupancy_id:=NULL;RETURN NEXT;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.hotel_legacy_current_physical_rooms_internal() FROM PUBLIC,anon,authenticated,service_role;

-- The existing guard and snapshot call this same canonical physical source.
-- Existing function ownership and privileges survive CREATE OR REPLACE.
CREATE OR REPLACE FUNCTION public.hotel_current_physical_rooms_internal()
RETURNS TABLE(room_id uuid,capacity_id uuid,stay_id uuid,occupancy_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT a.room_id,c.id,s.id,NULL::uuid
  FROM public.hotel_stays s
  JOIN public.hotel_capacity_reservations c ON c.hotel_stay_id=s.id AND c.archived_at IS NULL
  CROSS JOIN LATERAL (
    SELECT x.room_id FROM public.hotel_room_allocations x
    WHERE x.capacity_reservation_id=c.id AND x.archived_at IS NULL
      AND x.allocated_from<=statement_timestamp()
    ORDER BY x.allocated_from DESC,x.id DESC LIMIT 1
  ) a
  WHERE s.archived_at IS NULL AND s.checked_in_at>=timestamptz '2026-09-25 00:00:00+09' AND s.checked_in_at<=statement_timestamp() AND s.checked_out_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM public.hotel_physical_occupancy_members m
      WHERE m.hotel_stay_id=s.id AND m.archived_at IS NULL AND m.status='active')
  UNION ALL
  SELECT o.room_id,o.capacity_reservation_id,s.id,o.id
  FROM public.hotel_physical_occupancies o
  JOIN public.hotel_physical_occupancy_members m ON m.occupancy_id=o.id AND m.archived_at IS NULL AND m.status='active'
  JOIN public.hotel_stays s ON s.id=m.hotel_stay_id
  WHERE o.archived_at IS NULL AND o.status='active'
    AND s.archived_at IS NULL AND s.checked_in_at>=timestamptz '2026-09-25 00:00:00+09' AND s.checked_in_at<=statement_timestamp() AND s.checked_out_at IS NULL
  UNION ALL
  SELECT a.room_id,c.id,NULL::uuid,NULL::uuid
  FROM public.daycare_operation_states d
  JOIN public.hotel_capacity_reservations c ON c.daycare_schedule_id=d.operation_schedule_id AND c.archived_at IS NULL
  CROSS JOIN LATERAL (SELECT x.room_id FROM public.hotel_room_allocations x
    WHERE x.capacity_reservation_id=c.id AND x.archived_at IS NULL AND x.allocated_from<=statement_timestamp()
    ORDER BY x.allocated_from DESC,x.id DESC LIMIT 1) a
  WHERE d.lifecycle_status='checked_in'
  UNION ALL
  SELECT * FROM public.hotel_legacy_current_physical_rooms_internal()
$$;

CREATE OR REPLACE FUNCTION public.get_hotel_operations_snapshot(p_local_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  day_start timestamptz;
  day_end timestamptz;
  selected_instant timestamptz;
  result jsonb;
  physical_rows jsonb;
  physical_stays jsonb;
begin
  if not public.is_active_operation_member() then
    raise exception '호텔 운영 조회 권한이 없습니다.' using errcode = '42501';
  end if;
  if p_local_date is null then
    raise exception '조회 날짜가 필요합니다.' using errcode = '22023';
  end if;

  day_start := p_local_date::timestamp at time zone 'Asia/Seoul';
  day_end := (p_local_date + 1)::timestamp at time zone 'Asia/Seoul';
  selected_instant := case when p_local_date = (now() at time zone 'Asia/Seoul')::date
    then now() else day_start + interval '12 hours' end;

  select jsonb_build_object(
    'date', p_local_date,
    'roomTypes', coalesce(jsonb_agg(jsonb_build_object(
      'id', room_type.id,
      'code', room_type.code,
      'name', room_type.name,
      'activeRooms', (select count(*) from public.hotel_rooms room
        where room.room_type_id = room_type.id and room.is_active and room.archived_at is null),
      'reservedPeak', coalesce((
        with points as (
          select greatest(capacity.reserved_from, day_start) point_at, capacity.quantity::integer delta
          from public.hotel_capacity_reservations capacity
          where capacity.room_type_id = room_type.id and capacity.archived_at is null
            and capacity.reserved_from < day_end and capacity.reserved_until > day_start
          union all
          select least(capacity.reserved_until, day_end), -capacity.quantity::integer
          from public.hotel_capacity_reservations capacity
          where capacity.room_type_id = room_type.id and capacity.archived_at is null
            and capacity.reserved_from < day_end and capacity.reserved_until > day_start
        ), deltas as (select point_at, sum(delta) delta from points group by point_at),
        running as (select sum(delta) over (order by point_at) occupancy from deltas)
        select max(occupancy) from running
      ), 0),
      'checkedInNow', (select count(*) from public.hotel_capacity_reservations capacity
        join public.hotel_stays stay on stay.id = capacity.hotel_stay_id
        where capacity.room_type_id = room_type.id and capacity.archived_at is null
          and stay.archived_at is null and stay.checked_in_at is not null
          and stay.checked_out_at is null and capacity.reserved_from <= selected_instant
          and capacity.reserved_until > selected_instant),
      'allocatedNow', (select count(distinct allocation.room_id)
        from public.hotel_room_allocations allocation
        join public.hotel_capacity_reservations capacity on capacity.id = allocation.capacity_reservation_id
        where capacity.room_type_id = room_type.id and capacity.archived_at is null
          and allocation.archived_at is null and allocation.allocated_from <= selected_instant
          and allocation.allocated_until > selected_instant),
      'reservedNow', (select coalesce(sum(capacity.quantity), 0)
        from public.hotel_capacity_reservations capacity
        where capacity.room_type_id = room_type.id and capacity.archived_at is null
          and capacity.reserved_from <= selected_instant
          and capacity.reserved_until > selected_instant),
      'unassignedNow', greatest(0,
        (select coalesce(sum(capacity.quantity), 0)
          from public.hotel_capacity_reservations capacity
          where capacity.room_type_id = room_type.id and capacity.archived_at is null
            and capacity.reserved_from <= selected_instant
            and capacity.reserved_until > selected_instant)
        - (select count(distinct allocation.capacity_reservation_id)
          from public.hotel_room_allocations allocation
          join public.hotel_capacity_reservations capacity on capacity.id = allocation.capacity_reservation_id
          where capacity.room_type_id = room_type.id and capacity.archived_at is null
            and allocation.archived_at is null and allocation.allocated_from <= selected_instant
            and allocation.allocated_until > selected_instant)
      ),
      'physicallyEmpty', greatest(0,
        (select count(*) from public.hotel_rooms room
          where room.room_type_id = room_type.id and room.is_active and room.archived_at is null)
        - (select count(distinct allocation.room_id)
          from public.hotel_room_allocations allocation
          join public.hotel_capacity_reservations capacity on capacity.id = allocation.capacity_reservation_id
          where capacity.room_type_id = room_type.id and capacity.archived_at is null
            and allocation.archived_at is null and allocation.allocated_from <= selected_instant
            and allocation.allocated_until > selected_instant)
      )
    ) order by room_type.sort_order, room_type.code), '[]'::jsonb),
    'rooms', coalesce((select jsonb_agg(jsonb_build_object(
      'id', room.id,
      'name', room.name,
      'roomTypeId', room_type_row.id,
      'roomTypeCode', room_type_row.code,
      'roomTypeName', room_type_row.name,
      'isActive', room.is_active,
      'sortOrder', room.sort_order
    ) order by room_type_row.sort_order, room.sort_order, room.name)
      from public.hotel_rooms room
      join public.hotel_room_types room_type_row on room_type_row.id = room.room_type_id
      where room.archived_at is null
        and room_type_row.archived_at is null), '[]'::jsonb),
    'settings', (select jsonb_build_object(
      'id', settings.id,
      'version', settings.version,
      'defaultCheckInTime', settings.default_check_in_time::text,
      'defaultCheckOutTime', settings.default_check_out_time::text,
      'timezone', settings.timezone
    )
      from public.hotel_operation_settings settings
      where settings.singleton_key = 'default'
        and settings.archived_at is null
      order by settings.created_at, settings.id
      limit 1),
    'stays', coalesce((select jsonb_agg(public.hotel_stay_json(stay.id)
      order by capacity.reserved_from, stay.created_at)
      from public.hotel_stays stay
      join public.hotel_capacity_reservations capacity on capacity.hotel_stay_id = stay.id
      where stay.archived_at is null and capacity.archived_at is null
        and ((capacity.reserved_from < day_end and capacity.reserved_until > day_start)
          or (p_local_date=(statement_timestamp() at time zone 'Asia/Seoul')::date
            and stay.checked_in_at<=statement_timestamp() and stay.checked_out_at is null
            and (stay.checked_in_at>=timestamptz '2026-09-25 00:00:00+09' or exists (select 1 from public.hotel_stay_schedule_events ev
              join public.operation_schedules os on os.id=ev.operation_schedule_id
              where ev.hotel_stay_id=stay.id and ev.event_kind='check_out'
                and ev.archived_at is null and os.archived_at is null
                and os.starts_at>=timestamptz '2026-09-25 00:00:00+09' and os.starts_at<day_end))))), '[]'::jsonb),
    'unassignedFuture', coalesce((select jsonb_agg(public.hotel_stay_json(stay.id)
      order by capacity.reserved_from, stay.created_at)
      from public.hotel_stays stay
      join public.hotel_capacity_reservations capacity on capacity.hotel_stay_id = stay.id
      where stay.archived_at is null and capacity.archived_at is null
        and capacity.reserved_until > day_start
        and not exists (select 1 from public.hotel_room_allocations allocation
          where allocation.capacity_reservation_id = capacity.id
            and allocation.archived_at is null)), '[]'::jsonb)
  ) into result
  from public.hotel_room_types room_type
  where room_type.is_active and room_type.archived_at is null;

  if p_local_date=(statement_timestamp() at time zone 'Asia/Seoul')::date then
    result := jsonb_set(result,'{roomTypes}',coalesce((
      select jsonb_agg(item || jsonb_build_object(
        'checkedInNow',n.occupied,'allocatedNow',n.occupied,
        'physicallyEmpty',greatest(0,(item->>'activeRooms')::integer-n.occupied)) order by ordinal)
      from jsonb_array_elements(result->'roomTypes') with ordinality as items(item,ordinal)
      cross join lateral (select count(distinct p.room_id)::integer occupied
        from public.hotel_current_physical_rooms_internal() p
        join public.hotel_rooms room on room.id=p.room_id
        where room.room_type_id=(item->>'id')::uuid) n
    ),'[]'::jsonb));
    select coalesce(jsonb_agg(to_jsonb(p)),'[]'::jsonb) into physical_rows
      from public.hotel_current_physical_rooms_internal() p;
    -- Merge current physical members even after the entire planned day has expired.
    -- Never merge current membership into historical/future selected-date payloads.
    with candidates as (
      select item,ordinal from jsonb_array_elements(result->'stays') with ordinality items(item,ordinal)
      union all
      select public.hotel_stay_json(s.id),jsonb_array_length(result->'stays')+row_number() over(order by s.id)
      from public.hotel_stays s
      where (exists(select 1 from jsonb_array_elements(physical_rows) p where p->>'stay_id'=s.id::text)
        or exists(select 1 from public.hotel_legacy_physical_anchors_internal() a where a.stay_id=s.id))
        and not exists(select 1 from jsonb_array_elements(result->'stays') item where item->>'id'=s.id::text)
    )
    select coalesce(jsonb_agg(item || jsonb_build_object('currentPhysicalRoom',jsonb_build_object(
      'date',p_local_date,'observedAt',statement_timestamp(),'allocation',resolved.allocation,
      'state',case when resolved.allocation is not null then 'occupied'
        when exists(select 1 from public.long_stay_absence_events e
          where e.hotel_stay_id=(item->>'id')::uuid and e.archived_at is null
            and e.event_type='leave' and e.is_open and e.inventory_mode='release_room'
            and e.occurred_at<=statement_timestamp()) then 'released' else 'unresolved' end
    )) order by ordinal),'[]'::jsonb) into physical_stays
    from candidates
    left join lateral (
      select jsonb_build_object('id',a.id,'roomId',r.id,'roomName',r.name,'roomTypeId',r.room_type_id,
        'allocatedFrom',a.allocated_from,'allocatedUntil',a.allocated_until,
        'assignmentReason',a.assignment_reason,'version',a.version) allocation
      from jsonb_array_elements(physical_rows) p
      join public.hotel_rooms r on r.id=(p->>'room_id')::uuid
      join lateral (select x.* from public.hotel_room_allocations x
        where x.capacity_reservation_id=(p->>'capacity_id')::uuid and x.room_id=r.id
          and x.archived_at is null and x.allocated_from<=statement_timestamp()
        order by x.allocated_from desc,x.id desc limit 1) a on true
      where p->>'stay_id'=item->>'id'
        and (select count(*) from jsonb_array_elements(physical_rows) same_stay
          where same_stay->>'stay_id'=item->>'id')=1
    ) resolved on true;
    result := jsonb_set(result,'{stays}',physical_stays);
    result := result || jsonb_build_object('physicalOccupiedRooms',
      (select count(distinct p->>'room_id') from jsonb_array_elements(physical_rows) p));
  end if;
  return result;
end;
$function$
;

-- A completed legacy checkout can be reversed by an existing normal command.
-- Its old planned interval may already be past. Check the FINAL canonical room
-- after the same transaction restores Shared membership and writes audit events.
-- This does not alter the completion commands or revive ineligible old records.
CREATE FUNCTION public.guard_hotel_legacy_physical_reentry_internal()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p record;
BEGIN
  FOR p IN SELECT DISTINCT x.room_id,x.capacity_id
    FROM public.hotel_legacy_current_physical_rooms_internal() x
    WHERE x.stay_id=NEW.id ORDER BY x.room_id,x.capacity_id LOOP
    PERFORM public.assert_hotel_physical_room_available_internal(p.room_id,p.capacity_id);
  END LOOP;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.guard_hotel_legacy_physical_reentry_internal() FROM PUBLIC,anon,authenticated,service_role;
CREATE CONSTRAINT TRIGGER hotel_legacy_physical_reentry_guard
AFTER UPDATE ON public.hotel_stays
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW WHEN (
  OLD.checked_out_at IS NOT NULL AND NEW.checked_out_at IS NULL
  AND NEW.checked_in_at<timestamptz '2026-09-25 00:00:00+09'
  AND NEW.archived_at IS NULL
)
EXECUTE FUNCTION public.guard_hotel_legacy_physical_reentry_internal();

COMMIT;
