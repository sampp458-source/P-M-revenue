-- Local bounded QA only. Verbatim Production predecessors captured 2026-09-25.
-- No application rows; not a foundation reconstruction or migration.
-- complete_hotel_check_out body MD5 7744baa7276dcb70676ec593e8ddc0e6
CREATE OR REPLACE FUNCTION public.complete_hotel_check_out(p_hotel_stay_id uuid, p_expected_version integer, p_completed_at timestamp with time zone, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  actor_id uuid := auth.uid();
  stay_row public.hotel_stays%rowtype;
  capacity_row public.hotel_capacity_reservations%rowtype;
  final_allocation public.hotel_room_allocations%rowtype;
  effective_at timestamptz :=
    coalesce(p_completed_at, now());
begin
  if actor_id is null
    or not public.is_active_operation_member() then
    raise exception '퇴실 완료 권한이 없습니다.'
      using errcode = '42501';
  end if;

  if p_request_id is null
    or p_expected_version is null then
    raise exception '요청 ID와 기존 버전이 필요합니다.'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'hotel-request:' || p_request_id::text,
      0
    )
  );

  if public.is_replayed_hotel_stay_request(
    p_hotel_stay_id,
    p_request_id
  ) then
    return public.hotel_stay_json(p_hotel_stay_id);
  end if;

  select *
  into stay_row
  from public.hotel_stays stay
  where stay.id = p_hotel_stay_id
  for update;

  if not found
    or stay_row.archived_at is not null then
    raise exception '활성 호텔 예약을 확인할 수 없습니다.'
      using errcode = 'P0002';
  end if;

  if stay_row.version <> p_expected_version then
    raise exception '다른 사용자가 먼저 처리했습니다.'
      using errcode = '40001';
  end if;

  if stay_row.checked_in_at is null then
    raise exception '입실 완료 후 퇴실 처리할 수 있습니다.'
      using errcode = '22023';
  end if;

  if effective_at <= stay_row.checked_in_at then
    raise exception '퇴실 완료 시각은 입실 완료 시각보다 늦어야 합니다.'
      using errcode = '22023';
  end if;

  if stay_row.checked_out_at is not null then
    return public.hotel_stay_json(p_hotel_stay_id);
  end if;

  select *
  into capacity_row
  from public.hotel_capacity_reservations capacity
  where capacity.hotel_stay_id = p_hotel_stay_id
    and capacity.archived_at is null
  for update;

  if not found then
    raise exception '활성 Capacity 예약을 확인할 수 없습니다.'
      using errcode = 'P0002';
  end if;

  select *
  into final_allocation
  from public.hotel_room_allocations allocation
  where allocation.capacity_reservation_id = capacity_row.id
    and allocation.archived_at is null
  order by
    allocation.allocated_until desc,
    allocation.allocated_from desc
  limit 1
  for update;

  if not found then
    raise exception '퇴실 처리할 최종 호실 배정을 확인할 수 없습니다.'
      using errcode = 'P0002';
  end if;

  if effective_at <= final_allocation.allocated_from then
    raise exception '퇴실 완료 시각은 최종 호실 배정 시작보다 늦어야 합니다.'
      using errcode = '22023';
  end if;

  if effective_at > capacity_row.reserved_until then
    perform public.assert_hotel_capacity_available(
      capacity_row.room_type_id,
      capacity_row.reserved_from,
      effective_at,
      capacity_row.quantity,
      capacity_row.id
    );

    perform pg_advisory_xact_lock(
      hashtextextended(
        'hotel-room:' ||
        final_allocation.room_id::text,
        0
      )
    );

    if exists (
      select 1
      from public.hotel_room_allocations other_allocation
      where other_allocation.room_id =
        final_allocation.room_id
        and other_allocation.archived_at is null
        and other_allocation.id <>
          final_allocation.id
        and other_allocation.allocated_from <
          effective_at
        and other_allocation.allocated_until >
          final_allocation.allocated_from
    ) then
      raise exception '실제 퇴실 시각까지 최종 호실을 연장할 수 없습니다.'
        using errcode = '23P01';
    end if;
  end if;

  perform set_config(
    'app.operation_change_reason',
    '호텔 퇴실 완료',
    true
  );

  perform set_config(
    'app.operation_request_id',
    p_request_id::text,
    true
  );

  if effective_at > capacity_row.reserved_until then
    update public.hotel_capacity_reservations capacity
    set
      reserved_until = effective_at,
      updated_by = actor_id
    where capacity.id = capacity_row.id;
  end if;

  update public.hotel_room_allocations allocation
  set
    allocated_until = effective_at,
    updated_by = actor_id
  where allocation.id = final_allocation.id;

  update public.hotel_stays
  set
    checked_out_at = effective_at,
    checked_out_by = actor_id,
    checkout_previous_reserved_until =
      capacity_row.reserved_until,
    checkout_previous_allocation_id =
      final_allocation.id,
    checkout_previous_allocation_until =
      final_allocation.allocated_until,
    updated_by = actor_id
  where id = p_hotel_stay_id;

  return public.hotel_stay_json(p_hotel_stay_id);
end;
$function$
;

-- complete_shared_hotel_member_check_out body MD5 c4da96cc8def147edd5a52a8844b9508
CREATE OR REPLACE FUNCTION public.complete_shared_hotel_member_check_out(p_occupancy_id uuid, p_hotel_stay_id uuid, p_expected_occupancy_version integer, p_expected_stay_version integer, p_completed_at timestamp with time zone, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  actor_id uuid:=auth.uid(); replay jsonb; payload jsonb; o public.hotel_physical_occupancies%rowtype;
  s public.hotel_stays%rowtype; m public.hotel_physical_occupancy_members%rowtype;
  remaining integer; result jsonb;
begin
  payload:=jsonb_build_object('completedAt',p_completed_at,'expectedOccupancyVersion',p_expected_occupancy_version,'expectedStayVersion',p_expected_stay_version,'hotelStayId',p_hotel_stay_id,'occupancyId',p_occupancy_id);
  replay:=public.claim_shared_hotel_request_internal(p_request_id,'check_out',payload,p_occupancy_id); if replay is not null then return replay; end if;
  select * into o from public.hotel_physical_occupancies where id=p_occupancy_id for update;
  select * into s from public.hotel_stays where id=p_hotel_stay_id for update;
  select * into m from public.hotel_physical_occupancy_members where occupancy_id=p_occupancy_id and hotel_stay_id=p_hotel_stay_id and archived_at is null for update;
  if o.id is null or o.status<>'active' or s.id is null or m.id is null or m.status<>'active' then raise exception '퇴실할 공유 객실 member를 확인할 수 없습니다.' using errcode='P0002'; end if;
  if o.version<>p_expected_occupancy_version or s.version<>p_expected_stay_version then raise exception '다른 사용자가 먼저 처리했습니다.' using errcode='PT409'; end if;
  if s.checked_in_at is null or p_completed_at is null or p_completed_at<=s.checked_in_at or p_completed_at<=o.occupied_from then raise exception '입실 이후의 유효한 퇴실 시각이 필요합니다.' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('hotel-capacity:all',0));
  perform pg_advisory_xact_lock(hashtextextended('hotel-capacity:'||o.room_type_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('hotel-room:'||o.room_id::text,0));
  perform set_config('app.operation_change_reason','다견 공유 객실 member 퇴실',true);
  perform set_config('app.operation_request_id',p_request_id::text,true);
  update public.hotel_stays set checked_out_at=p_completed_at,checked_out_by=actor_id,
    checkout_previous_reserved_until=o.occupied_until,checkout_previous_allocation_id=o.room_allocation_id,
    checkout_previous_allocation_until=o.occupied_until,updated_by=actor_id where id=s.id;
  perform set_config('app.operation_request_id','',true);
  update public.hotel_physical_occupancy_members set status='completed',left_at=p_completed_at,updated_by=actor_id where id=m.id;
  update public.family_booking_members set status='completed',updated_by=actor_id
    where hotel_stay_id=s.id and family_booking_id=o.family_booking_id and archived_at is null;
  select count(*) into remaining from public.hotel_physical_occupancy_members x where x.occupancy_id=o.id and x.archived_at is null and x.status='active';
  if remaining=0 then
    if p_completed_at>o.occupied_until then
      perform public.assert_hotel_total_capacity_available(o.occupied_from,p_completed_at,1,o.capacity_reservation_id);
      perform public.assert_hotel_capacity_available(o.room_type_id,o.occupied_from,p_completed_at,1,o.capacity_reservation_id);
      perform public.assert_hotel_room_allocation_available(o.room_id,o.capacity_reservation_id,o.occupied_from,p_completed_at,o.room_allocation_id);
    end if;
    update public.hotel_capacity_reservations set reserved_until=p_completed_at,updated_by=actor_id where id=o.capacity_reservation_id;
    update public.hotel_room_allocations set allocated_until=p_completed_at,updated_by=actor_id where id=o.room_allocation_id;
    update public.hotel_physical_occupancies set restore_occupied_until=o.occupied_until,occupied_until=p_completed_at,status='completed',completed_at=p_completed_at,updated_by=actor_id where id=o.id;
    update public.family_shared_room_groups set status='released',updated_by=actor_id where id=o.shared_room_group_id;
  else
    update public.hotel_physical_occupancies set updated_by=actor_id where id=o.id;
  end if;
  result:=jsonb_build_object('occupancy',public.shared_hotel_occupancy_json_internal(o.id),'stay',public.hotel_stay_json(s.id),'remainingActiveMembers',remaining);
  return public.finish_shared_hotel_request_internal(p_request_id,o.id,result);
end;
$function$
;

-- get_hotel_operations_snapshot_v2 body MD5 7dac53943e2f74f207de1cd36d5023fb
CREATE OR REPLACE FUNCTION public.get_hotel_operations_snapshot_v2(p_local_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  );
end;
$function$
;

-- get_hotel_operations_snapshot body MD5 655417d618ef44206fe8274e026b7ae9
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
        and capacity.reserved_from < day_end and capacity.reserved_until > day_start), '[]'::jsonb),
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

  return result;
end;
$function$
;

-- get_hotel_shared_room_occupancies body MD5 7a52aee4d105736f18a48176df0a701b
CREATE OR REPLACE FUNCTION public.get_hotel_shared_room_occupancies(p_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if not public.is_active_operation_member() then
    raise exception '공유 객실 조회 권한이 없습니다.' using errcode='42501';
  end if;
  return coalesce((select jsonb_agg(public.shared_hotel_occupancy_json_internal(o.id) order by r.sort_order,r.name,o.id)
    from public.hotel_physical_occupancies o join public.hotel_rooms r on r.id=o.room_id
    where o.archived_at is null and o.status='active'
      and o.occupied_from < ((p_date+1)::timestamp at time zone 'Asia/Seoul')
      and o.occupied_until > (p_date::timestamp at time zone 'Asia/Seoul')),'[]'::jsonb);
end;
$function$
;

-- hotel_single_room_eligibility_internal body MD5 8e1ec0b36c21013a40cd60b58d61569b
CREATE OR REPLACE FUNCTION public.hotel_single_room_eligibility_internal(p_stay_id uuid, p_purpose text, p_effective_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE s public.hotel_stays%rowtype; c public.hotel_capacity_reservations%rowtype;
 n integer; lo timestamptz; why text; room_rows jsonb; checkin_at timestamptz;
BEGIN
 IF p_purpose IS NULL OR p_purpose NOT IN ('preassign','actual_check_in') THEN
  RAISE EXCEPTION 'INVALID_PURPOSE' USING errcode='22023'; END IF;
 SELECT * INTO s FROM public.hotel_stays WHERE id=p_stay_id;
 IF s.id IS NULL OR s.archived_at IS NOT NULL THEN why:='STAY_UNAVAILABLE'; END IF;
 SELECT count(*) INTO n FROM public.hotel_capacity_reservations WHERE hotel_stay_id=p_stay_id AND archived_at IS NULL;
 IF n<>1 THEN why:=coalesce(why,'CAPACITY_RELATION_INVALID'); ELSE
  SELECT * INTO c FROM public.hotel_capacity_reservations WHERE hotel_stay_id=p_stay_id AND archived_at IS NULL;
 END IF;
 IF EXISTS(SELECT 1 FROM public.hotel_physical_occupancy_members WHERE hotel_stay_id=p_stay_id)
  OR EXISTS(SELECT 1 FROM public.family_booking_members WHERE hotel_stay_id=p_stay_id AND shared_room_group_id IS NOT NULL)
  OR EXISTS(SELECT 1 FROM public.long_stay_contracts WHERE current_hotel_stay_id=p_stay_id)
  OR EXISTS(SELECT 1 FROM public.long_stay_monthly_occupancies WHERE hotel_stay_id=p_stay_id)
  OR EXISTS(SELECT 1 FROM public.long_stay_absence_events WHERE hotel_stay_id=p_stay_id)
 THEN why:=coalesce(why,'DEDICATED_LIFECYCLE_REQUIRED'); END IF;
 IF c.id IS NOT NULL AND (c.source_kind IS DISTINCT FROM 'stay' OR c.quantity IS DISTINCT FROM 1
  OR c.physical_occupancy_id IS NOT NULL OR c.shared_room_group_id IS NOT NULL OR c.room_type_id IS NULL) THEN why:=coalesce(why,'CAPACITY_RELATION_INVALID'); END IF;
 IF s.checked_in_at IS NOT NULL OR s.checked_out_at IS NOT NULL THEN why:=coalesce(why,'STAY_ALREADY_COMPLETED'); END IF;
 IF EXISTS(SELECT 1 FROM public.hotel_room_allocations WHERE capacity_reservation_id=c.id AND archived_at IS NULL)
 THEN why:=coalesce(why,'ALREADY_ALLOCATED'); END IF;
 IF c.room_type_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.hotel_room_types WHERE id=c.room_type_id AND is_active AND archived_at IS NULL) THEN why:=coalesce(why,'ROOM_TYPE_UNAVAILABLE'); END IF;
 lo:=CASE WHEN p_purpose='preassign' THEN c.reserved_from ELSE p_effective_at END;
 IF lo IS NULL OR NOT isfinite(lo) OR lo<c.reserved_from OR lo>=c.reserved_until
 THEN why:=coalesce(why,'INVALID_EFFECTIVE_TIME'); END IF;
 IF p_purpose='actual_check_in' THEN
  SELECT count(*),min(os.starts_at) INTO n,checkin_at
   FROM public.hotel_stay_schedule_events e JOIN public.operation_schedules os ON os.id=e.operation_schedule_id
   WHERE e.hotel_stay_id=p_stay_id AND e.event_kind='check_in' AND e.archived_at IS NULL AND os.archived_at IS NULL;
  IF n<>1 THEN why:=coalesce(why,'SCHEDULE_RELATION_INVALID');
  ELSIF (lo AT TIME ZONE 'Asia/Seoul')::date<>(checkin_at AT TIME ZONE 'Asia/Seoul')::date
   OR lo>statement_timestamp() THEN why:=coalesce(why,'INVALID_EFFECTIVE_TIME'); END IF;
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('roomId',r.id,'roomName',r.name,'roomTypeId',r.room_type_id,
  'eligible',q.reason IS NULL,'reasonCode',q.reason,'recommended',false) ORDER BY r.sort_order,r.name,r.id),'[]')
 INTO room_rows FROM public.hotel_rooms r CROSS JOIN LATERAL (
  SELECT CASE WHEN why IS NOT NULL THEN why
   WHEN r.room_type_id IS DISTINCT FROM c.room_type_id THEN 'ROOM_TYPE_MISMATCH'
   WHEN EXISTS(SELECT 1 FROM public.hotel_room_allocations a WHERE a.room_id=r.id AND a.archived_at IS NULL
    AND a.allocated_from<c.reserved_until AND a.allocated_until>lo) THEN 'ROOM_INTERVAL_CONFLICT'
   ELSE NULL END AS reason
 ) q WHERE r.is_active AND r.archived_at IS NULL;
 SELECT coalesce(jsonb_agg(x.value || jsonb_build_object('recommended',coalesce(x.ord=first_ok.ord,false)) ORDER BY x.ord),'[]')
 INTO room_rows FROM jsonb_array_elements(room_rows) WITH ORDINALITY x(value,ord)
 CROSS JOIN LATERAL (SELECT min(y.ord) AS ord FROM jsonb_array_elements(room_rows) WITH ORDINALITY y(value,ord)
  WHERE (y.value->>'eligible')::boolean) first_ok;
 RETURN jsonb_build_object('stayId',s.id,'stayVersion',s.version,'capacityId',c.id,'capacityVersion',c.version,
  'purpose',p_purpose,'evaluatedFrom',lo,'evaluatedUntil',c.reserved_until,'observedAt',statement_timestamp(),
  'reasonCode',why,'rooms',room_rows);
END $function$
;
