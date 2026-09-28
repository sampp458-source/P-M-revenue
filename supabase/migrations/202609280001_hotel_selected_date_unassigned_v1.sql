-- Candidate only: additive read projection; no business rows, triggers or policies change.
BEGIN;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM (VALUES
      ('public.get_hotel_operations_snapshot_v2(date)','7dac53943e2f74f207de1cd36d5023fb'),
      ('public.get_unassigned_shared_hotel_room_groups(date)','760e1d7cca31bfa3f9803c15c210ea4c')
    ) expected(signature,body_md5)
    LEFT JOIN pg_proc p ON p.oid=to_regprocedure(expected.signature)
    WHERE p.oid IS NULL OR md5(p.prosrc)<>expected.body_md5
  ) THEN RAISE EXCEPTION 'STOP_SELECTED_DATE_UNASSIGNED_PREDECESSOR_MISMATCH'; END IF;
END;
$$;

CREATE FUNCTION public.hotel_selected_date_unassigned_internal(p_local_date date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  day_start timestamptz;
  day_end timestamptz;
  shared_rows jsonb;
  single_items jsonb;
  shared_items jsonb;
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
  RETURN jsonb_build_object(
    'date',p_local_date,
    'count',jsonb_array_length(single_items)+jsonb_array_length(shared_items),
    'singleStayIds',coalesce((SELECT jsonb_agg(i->'canonicalId') FROM jsonb_array_elements(single_items) i),'[]'::jsonb),
    'sharedGroupIds',coalesce((SELECT jsonb_agg(i->'canonicalId') FROM jsonb_array_elements(shared_items) i),'[]'::jsonb),
    'items',single_items||shared_items
  );
END;
$$;
REVOKE ALL ON FUNCTION public.hotel_selected_date_unassigned_internal(date)
  FROM PUBLIC, anon, authenticated, service_role;

-- Existing signature, owner and ACL retained by CREATE OR REPLACE.
create or replace function public.get_hotel_operations_snapshot_v2(
  p_local_date date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  day_start timestamptz;
  day_end timestamptz;
  selected_instant timestamptz;
  base_payload jsonb;
  enriched_room_types jsonb;
  confirmed_remaining_by_type jsonb;
  active_rooms integer;
  confirmed_peak integer;
  unspecified_peak integer;
  total_peak integer;
  confirmed_now integer;
  unspecified_now integer;
  confirmed_reservation_count integer;
  unspecified_reservation_count integer;
begin
  if not public.is_active_operation_member() then
    raise exception '호텔 운영 조회 권한이 없습니다.' using errcode = '42501';
  end if;
  if p_local_date is null then
    raise exception '조회 날짜가 필요합니다.' using errcode = '22023';
  end if;

  day_start := p_local_date::timestamp at time zone 'Asia/Seoul';
  day_end := (p_local_date + 1)::timestamp at time zone 'Asia/Seoul';
  selected_instant := case
    when p_local_date = (now() at time zone 'Asia/Seoul')::date then now()
    else day_start + interval '12 hours'
  end;
  base_payload := public.get_hotel_operations_snapshot(p_local_date);

  select coalesce(
    jsonb_agg(
      room_type_item || jsonb_build_object(
        'confirmedReservationCount',
          (
            select coalesce(sum(capacity.quantity), 0)::integer
            from public.hotel_capacity_reservations capacity
            where capacity.archived_at is null
              and capacity.room_type_id =
                (room_type_item ->> 'id')::uuid
              and capacity.reserved_from < day_end
              and capacity.reserved_until > day_start
          ),
        'confirmedReservedPeak',
          coalesce((room_type_item ->> 'reservedPeak')::integer, 0),
        'confirmedRemaining',
          greatest(
            coalesce((room_type_item ->> 'activeRooms')::integer, 0)
              - coalesce((room_type_item ->> 'reservedPeak')::integer, 0),
            0
          ),
        'conservativeRemaining',
          greatest(
            coalesce((room_type_item ->> 'activeRooms')::integer, 0)
              - coalesce((room_type_item ->> 'reservedPeak')::integer, 0)
              - unspecified_for_day.reserved_peak,
            0
          ),
        'affectedByUnspecifiedCount',
          unspecified_for_day.reservation_count
      )
      order by room_type_ordinality
    ),
    '[]'::jsonb
  )
  into enriched_room_types
  from jsonb_array_elements(
    coalesce(base_payload -> 'roomTypes', '[]'::jsonb)
  ) with ordinality as room_type_rows(
    room_type_item, room_type_ordinality
  )
  cross join lateral (
    select
      coalesce(sum(capacity.quantity), 0)::integer as reservation_count,
      coalesce((
        with scoped as (
          select capacity_row.reserved_from,
            capacity_row.reserved_until,
            capacity_row.quantity
          from public.hotel_capacity_reservations capacity_row
          where capacity_row.archived_at is null
            and capacity_row.room_type_id is null
            and capacity_row.reserved_from < day_end
            and capacity_row.reserved_until > day_start
        ), points as (
          select greatest(reserved_from, day_start) point_at,
            quantity::integer delta
          from scoped
          union all
          select least(reserved_until, day_end), -quantity::integer
          from scoped
        ), deltas as (
          select point_at, sum(delta) delta from points group by point_at
        ), running as (
          select sum(delta) over (
            order by point_at rows unbounded preceding
          ) occupancy
          from deltas
        )
        select max(occupancy) from running
      ), 0)::integer as reserved_peak
    from public.hotel_capacity_reservations capacity
    where capacity.archived_at is null
      and capacity.room_type_id is null
      and capacity.reserved_from < day_end
      and capacity.reserved_until > day_start
  ) unspecified_for_day;

  select coalesce(
    jsonb_object_agg(
      room_type_item ->> 'code',
      coalesce((room_type_item ->> 'confirmedRemaining')::integer, 0)
    ),
    '{}'::jsonb
  )
  into confirmed_remaining_by_type
  from jsonb_array_elements(enriched_room_types) room_type(room_type_item);

  select count(*)::integer into active_rooms
  from public.hotel_rooms room
  join public.hotel_room_types room_type on room_type.id = room.room_type_id
  where room.is_active and room.archived_at is null
    and room_type.is_active and room_type.archived_at is null;

  with scoped as (
    select capacity.reserved_from, capacity.reserved_until, capacity.quantity
    from public.hotel_capacity_reservations capacity
    where capacity.archived_at is null
      and capacity.room_type_id is not null
      and capacity.reserved_from < day_end
      and capacity.reserved_until > day_start
  ), points as (
    select greatest(reserved_from, day_start) point_at, quantity::integer delta from scoped
    union all
    select least(reserved_until, day_end), -quantity::integer from scoped
  ), deltas as (
    select point_at, sum(delta) delta from points group by point_at
  ), running as (
    select sum(delta) over (order by point_at rows unbounded preceding) occupancy
    from deltas
  )
  select coalesce(max(occupancy), 0)::integer into confirmed_peak from running;

  with scoped as (
    select capacity.reserved_from, capacity.reserved_until, capacity.quantity
    from public.hotel_capacity_reservations capacity
    where capacity.archived_at is null
      and capacity.room_type_id is null
      and capacity.reserved_from < day_end
      and capacity.reserved_until > day_start
  ), points as (
    select greatest(reserved_from, day_start) point_at, quantity::integer delta from scoped
    union all
    select least(reserved_until, day_end), -quantity::integer from scoped
  ), deltas as (
    select point_at, sum(delta) delta from points group by point_at
  ), running as (
    select sum(delta) over (order by point_at rows unbounded preceding) occupancy
    from deltas
  )
  select coalesce(max(occupancy), 0)::integer into unspecified_peak from running;

  with scoped as (
    select capacity.reserved_from, capacity.reserved_until, capacity.quantity
    from public.hotel_capacity_reservations capacity
    where capacity.archived_at is null
      and capacity.reserved_from < day_end
      and capacity.reserved_until > day_start
  ), points as (
    select greatest(reserved_from, day_start) point_at, quantity::integer delta from scoped
    union all
    select least(reserved_until, day_end), -quantity::integer from scoped
  ), deltas as (
    select point_at, sum(delta) delta from points group by point_at
  ), running as (
    select sum(delta) over (order by point_at rows unbounded preceding) occupancy
    from deltas
  )
  select coalesce(max(occupancy), 0)::integer into total_peak from running;

  select
    coalesce(sum(capacity.quantity) filter (
      where capacity.room_type_id is not null
    ), 0)::integer,
    coalesce(sum(capacity.quantity) filter (
      where capacity.room_type_id is null
    ), 0)::integer
  into confirmed_now, unspecified_now
  from public.hotel_capacity_reservations capacity
  where capacity.archived_at is null
    and capacity.reserved_from <= selected_instant
    and capacity.reserved_until > selected_instant;

  select
    coalesce(sum(capacity.quantity) filter (
      where capacity.room_type_id is not null
    ), 0)::integer,
    coalesce(sum(capacity.quantity) filter (
      where capacity.room_type_id is null
    ), 0)::integer
  into confirmed_reservation_count, unspecified_reservation_count
  from public.hotel_capacity_reservations capacity
  where capacity.archived_at is null
    and capacity.reserved_from < day_end
    and capacity.reserved_until > day_start;

  return jsonb_set(
    base_payload,
    '{roomTypes}',
    enriched_room_types,
    true
  ) || jsonb_build_object(
    'confirmedRemainingByType', confirmed_remaining_by_type,
    'unassignedRoomTypeCount', unspecified_reservation_count,
    'overallSafeRemaining', greatest(active_rooms - total_peak, 0),
    'individualTypeAvailabilityWarning', unspecified_peak > 0,
    'roomTypeUnspecified', jsonb_build_object(
      'reservationCount', unspecified_reservation_count,
      'reservedPeak', unspecified_peak,
      'reservedNow', unspecified_now,
      'label', '객실 미정'
    ),
    'totalCapacity', jsonb_build_object(
      'activeRooms', active_rooms,
      'confirmedReservationCount', confirmed_reservation_count,
      'unspecifiedReservationCount', unspecified_reservation_count,
      'totalReservationCount',
        confirmed_reservation_count + unspecified_reservation_count,
      'confirmedReservedPeak', confirmed_peak,
      'unspecifiedReservedPeak', unspecified_peak,
      'totalReservedPeak', total_peak,
      'confirmedReservedNow', confirmed_now,
      'unspecifiedReservedNow', unspecified_now,
      'totalReservedNow', confirmed_now + unspecified_now,
      'safeRemaining', greatest(active_rooms - total_peak, 0),
      'individualTypeAvailabilityWarning', unspecified_peak > 0
    )
  ) || jsonb_build_object('selectedDateUnassigned',
    public.hotel_selected_date_unassigned_internal(p_local_date));
end;
$$;
COMMIT;
