-- P&M OS Hotel Operations Sprint 1 workflow RPCs
-- 기존 Operations/Finance 함수와 정책을 교체하지 않는다.

begin;

do $$
begin
  if to_regclass('public.hotel_room_types') is null
    or to_regclass('public.hotel_rooms') is null
    or to_regclass('public.hotel_operation_settings') is null
    or to_regclass('public.hotel_stays') is null
    or to_regclass('public.hotel_stay_schedule_events') is null
    or to_regclass('public.hotel_capacity_reservations') is null
    or to_regclass('public.hotel_room_allocations') is null
  then
    raise exception 'STOP_HOTEL_FOUNDATION_NOT_APPLIED';
  end if;

  if to_regprocedure('public.create_operation_schedule(uuid,uuid,text,timestamp with time zone,timestamp with time zone,boolean,boolean,text,uuid[],uuid[],uuid[],uuid)') is null
    or to_regprocedure('public.update_operation_schedule(uuid,integer,uuid,uuid,text,timestamp with time zone,timestamp with time zone,boolean,boolean,text,uuid[],uuid[],uuid[],uuid)') is null
    or to_regprocedure('public.set_operation_schedule_status(uuid,integer,text,text,uuid)') is null
    or to_regprocedure('public.operation_schedule_json(uuid)') is null
    or to_regprocedure('public.can_manage_operation_schedule(uuid)') is null
  then
    raise exception 'STOP_REQUIRED_SCHEDULE_RPC_NOT_READY';
  end if;
end;
$$;

create or replace function public.assert_hotel_capacity_available(
  p_room_type_id uuid,
  p_reserved_from timestamptz,
  p_reserved_until timestamptz,
  p_quantity integer default 1,
  p_exclude_reservation_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  active_room_count integer;
  peak_reserved integer;
begin
  if p_room_type_id is null or p_reserved_from is null or p_reserved_until is null
    or p_reserved_until <= p_reserved_from or p_quantity <> 1 then
    raise exception '유효한 객실 유형과 예약 기간이 필요합니다.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('hotel-capacity:' || p_room_type_id::text, 0));

  select count(*) into active_room_count
  from public.hotel_rooms room
  join public.hotel_room_types room_type on room_type.id = room.room_type_id
  where room.room_type_id = p_room_type_id
    and room.is_active and room.archived_at is null
    and room_type.is_active and room_type.archived_at is null;

  if active_room_count = 0 then
    raise exception '예약 가능한 활성 객실이 없습니다.' using errcode = '22023';
  end if;

  with intervals as (
    select greatest(reservation.reserved_from, p_reserved_from) as starts_at,
      least(reservation.reserved_until, p_reserved_until) as ends_at,
      reservation.quantity::integer as quantity
    from public.hotel_capacity_reservations reservation
    where reservation.room_type_id = p_room_type_id
      and reservation.archived_at is null
      and reservation.id is distinct from p_exclude_reservation_id
      and reservation.reserved_from < p_reserved_until
      and reservation.reserved_until > p_reserved_from
    union all
    select p_reserved_from, p_reserved_until, p_quantity
  ), points as (
    select starts_at as point_at, quantity as delta from intervals
    union all
    select ends_at as point_at, -quantity as delta from intervals
  ), deltas as (
    select point_at, sum(delta) as delta from points group by point_at
  ), running as (
    select point_at, sum(delta) over (order by point_at rows unbounded preceding) as occupancy
    from deltas
  )
  select coalesce(max(occupancy), 0)::integer into peak_reserved from running;

  if peak_reserved > active_room_count then
    raise exception '선택한 기간의 객실 유형 Capacity가 부족합니다.'
      using errcode = '23514',
        detail = format('active_rooms=%s, requested_peak=%s', active_room_count, peak_reserved);
  end if;
end;
$$;

create or replace function public.assert_hotel_room_allocation_available(
  p_room_id uuid,
  p_capacity_reservation_id uuid,
  p_allocated_from timestamptz,
  p_allocated_until timestamptz,
  p_exclude_allocation_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  room_row public.hotel_rooms%rowtype;
  reservation_row public.hotel_capacity_reservations%rowtype;
begin
  if p_allocated_from is null or p_allocated_until is null
    or p_allocated_until <= p_allocated_from then
    raise exception '유효한 호실 배정 기간이 필요합니다.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('hotel-room:' || p_room_id::text, 0));

  select * into room_row from public.hotel_rooms room
  where room.id = p_room_id and room.is_active and room.archived_at is null;
  if not found then
    raise exception '활성 호실을 확인할 수 없습니다.' using errcode = 'P0002';
  end if;

  select * into reservation_row from public.hotel_capacity_reservations reservation
  where reservation.id = p_capacity_reservation_id and reservation.archived_at is null;
  if not found then
    raise exception '활성 Capacity 예약을 확인할 수 없습니다.' using errcode = 'P0002';
  end if;

  if room_row.room_type_id <> reservation_row.room_type_id then
    raise exception '예약한 객실 유형과 선택한 호실 유형이 다릅니다.' using errcode = '22023';
  end if;
  if p_allocated_from < reservation_row.reserved_from
    or p_allocated_until > reservation_row.reserved_until then
    raise exception '호실 배정 기간은 Capacity 예약 기간 안이어야 합니다.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.hotel_room_allocations allocation
    where allocation.room_id = p_room_id
      and allocation.archived_at is null
      and allocation.id is distinct from p_exclude_allocation_id
      and allocation.allocated_from < p_allocated_until
      and allocation.allocated_until > p_allocated_from
  ) then
    raise exception '선택한 기간에 이미 사용 중인 호실입니다.' using errcode = '23P01';
  end if;
end;
$$;

create or replace function public.hotel_stay_json(p_hotel_stay_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', stay.id,
    'dogId', stay.dog_id,
    'dogName', dog.name,
    'customerId', dog.customer_id,
    'customerName', customer.name,
    'customerPhone', customer.phone,
    'version', stay.version,
    'requestId', stay.request_id,
    'checkedInAt', stay.checked_in_at,
    'checkedInBy', stay.checked_in_by,
    'checkedOutAt', stay.checked_out_at,
    'checkedOutBy', stay.checked_out_by,
    'createdBy', stay.created_by,
    'createdAt', stay.created_at,
    'updatedAt', stay.updated_at,
    'archivedAt', stay.archived_at,
    'capacityReservation', jsonb_build_object(
      'id', capacity.id,
      'roomTypeId', room_type.id,
      'roomTypeCode', room_type.code,
      'roomTypeName', room_type.name,
      'reservedFrom', capacity.reserved_from,
      'reservedUntil', capacity.reserved_until,
      'quantity', capacity.quantity
    ),
    'scheduleEvents', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'eventKind', event.event_kind,
          'schedule', public.operation_schedule_json(event.operation_schedule_id)
        ) order by case event.event_kind when 'check_in' then 1 else 2 end
      )
      from public.hotel_stay_schedule_events event
      where event.hotel_stay_id = stay.id and event.archived_at is null
    ), '[]'::jsonb),
    'roomAllocations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', allocation.id,
        'roomId', room.id,
        'roomName', room.name,
        'roomTypeId', room.room_type_id,
        'allocatedFrom', allocation.allocated_from,
        'allocatedUntil', allocation.allocated_until,
        'assignmentReason', allocation.assignment_reason,
        'version', allocation.version
      ) order by allocation.allocated_from, allocation.id)
      from public.hotel_room_allocations allocation
      join public.hotel_rooms room on room.id = allocation.room_id
      where allocation.capacity_reservation_id = capacity.id
        and allocation.archived_at is null
    ), '[]'::jsonb)
  )
  from public.hotel_stays stay
  join public.dogs dog on dog.id = stay.dog_id
  left join public.customers customer on customer.id = dog.customer_id
  left join public.hotel_capacity_reservations capacity
    on capacity.hotel_stay_id = stay.id and capacity.archived_at is null
  left join public.hotel_room_types room_type on room_type.id = capacity.room_type_id
  where stay.id = p_hotel_stay_id
    and public.is_active_operation_member();
$$;

create or replace function public.is_replayed_hotel_stay_request(
  p_hotel_stay_id uuid,
  p_request_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  request_entity_id uuid;
begin
  select audit.entity_id into request_entity_id
  from public.entity_audit_events audit
  where audit.module_code = 'hotel_operations'
    and audit.entity_type = 'hotel_stays'
    and audit.request_id = p_request_id
  order by audit.created_at
  limit 1;
  if not found then return false; end if;
  if request_entity_id <> p_hotel_stay_id then
    raise exception '이미 다른 호텔 예약에 사용된 요청 ID입니다.' using errcode = '23505';
  end if;
  return true;
end;
$$;

create or replace function public.get_hotel_operations_snapshot(
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
$$;

create or replace function public.create_hotel_reservation(
  p_calendar_id uuid,
  p_schedule_type_id uuid,
  p_title text,
  p_check_in_at timestamptz,
  p_check_out_at timestamptz,
  p_room_type_id uuid,
  p_dog_id uuid,
  p_customer_id uuid,
  p_assignee_ids uuid[],
  p_memo text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  stay_id uuid;
  check_in_schedule jsonb;
  check_out_schedule jsonb;
  child_check_in_request uuid;
  child_check_out_request uuid;
begin
  if actor_id is null or not public.is_active_operation_member() then
    raise exception '호텔 예약 등록 권한이 없습니다.' using errcode = '42501';
  end if;
  if p_request_id is null or nullif(btrim(p_title), '') is null
    or p_check_in_at is null or p_check_out_at is null
    or p_check_out_at <= p_check_in_at then
    raise exception '예약 제목, 입실·퇴실 시간, 요청 ID가 필요합니다.' using errcode = '22023';
  end if;
  if p_dog_id is null or p_customer_id is null
    or cardinality(coalesce(p_assignee_ids, '{}'::uuid[])) = 0 then
    raise exception '반려견, 보호자, 담당자가 필요합니다.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.operation_calendars calendar
    join public.business_units unit on unit.id = calendar.business_unit_id
    join public.operation_calendar_schedule_types mapping
      on mapping.calendar_id = calendar.id and mapping.schedule_type_id = p_schedule_type_id
    where calendar.id = p_calendar_id and calendar.is_active
      and unit.code = 'hotel' and mapping.is_active and mapping.archived_at is null
  ) then
    raise exception '활성 호텔 캘린더와 일정 유형을 확인해 주세요.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.dogs dog
    join public.customers customer on customer.id = p_customer_id
    where dog.id = p_dog_id and dog.is_active
      and customer.is_active and dog.customer_id = customer.id
  ) then
    raise exception '반려견과 연결 보호자 정보를 확인해 주세요.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('hotel-request:' || p_request_id::text, 0));
  select stay.id into stay_id from public.hotel_stays stay where stay.request_id = p_request_id;
  if stay_id is not null then
    return public.hotel_stay_json(stay_id);
  end if;

  perform public.assert_hotel_capacity_available(
    p_room_type_id, p_check_in_at, p_check_out_at, 1, null
  );

  child_check_in_request := gen_random_uuid();
  child_check_out_request := gen_random_uuid();

  check_in_schedule := public.create_operation_schedule(
    p_calendar_id, p_schedule_type_id, btrim(p_title),
    p_check_in_at, p_check_in_at + interval '1 hour', false, false,
    p_memo, p_assignee_ids, array[p_customer_id], array[p_dog_id],
    child_check_in_request
  );
  check_out_schedule := public.create_operation_schedule(
    p_calendar_id, p_schedule_type_id, btrim(p_title),
    p_check_out_at, p_check_out_at + interval '1 hour', false, false,
    p_memo, p_assignee_ids, array[p_customer_id], array[p_dog_id],
    child_check_out_request
  );

  perform set_config('app.operation_change_reason', '호텔 예약 등록', true);
  perform set_config('app.operation_request_id', p_request_id::text, true);

  insert into public.hotel_stays (
    dog_id, request_id, created_by, updated_by
  ) values (p_dog_id, p_request_id, actor_id, actor_id)
  returning id into stay_id;

  insert into public.hotel_stay_schedule_events (
    hotel_stay_id, operation_schedule_id, event_kind, created_by, updated_by
  ) values
    (stay_id, (check_in_schedule ->> 'id')::uuid, 'check_in', actor_id, actor_id),
    (stay_id, (check_out_schedule ->> 'id')::uuid, 'check_out', actor_id, actor_id);

  insert into public.hotel_capacity_reservations (
    source_kind, hotel_stay_id, room_type_id, reserved_from, reserved_until,
    quantity, created_by, updated_by
  ) values (
    'stay', stay_id, p_room_type_id, p_check_in_at, p_check_out_at,
    1, actor_id, actor_id
  );

  return public.hotel_stay_json(stay_id);
end;
$$;

create or replace function public.update_hotel_reservation(
  p_hotel_stay_id uuid,
  p_expected_version integer,
  p_calendar_id uuid,
  p_schedule_type_id uuid,
  p_title text,
  p_check_in_at timestamptz,
  p_check_out_at timestamptz,
  p_room_type_id uuid,
  p_dog_id uuid,
  p_customer_id uuid,
  p_assignee_ids uuid[],
  p_memo text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  stay_row public.hotel_stays%rowtype;
  capacity_row public.hotel_capacity_reservations%rowtype;
  check_in_schedule public.operation_schedules%rowtype;
  check_out_schedule public.operation_schedules%rowtype;
  allocation_row public.hotel_room_allocations%rowtype;
  allocation_count integer;
begin
  if actor_id is null or not public.is_active_operation_member() then
    raise exception '호텔 예약 수정 권한이 없습니다.' using errcode = '42501';
  end if;
  if p_request_id is null or p_expected_version is null
    or p_check_in_at is null or p_check_out_at is null
    or p_check_out_at <= p_check_in_at then
    raise exception '요청 ID, 기존 버전, 유효한 예약 시간이 필요합니다.' using errcode = '22023';
  end if;
  if p_dog_id is null or p_customer_id is null
    or cardinality(coalesce(p_assignee_ids, '{}'::uuid[])) = 0 then
    raise exception '반려견, 보호자, 담당자가 필요합니다.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.operation_calendars calendar
    join public.business_units unit on unit.id = calendar.business_unit_id
    join public.operation_calendar_schedule_types mapping
      on mapping.calendar_id = calendar.id and mapping.schedule_type_id = p_schedule_type_id
    where calendar.id = p_calendar_id and calendar.is_active
      and unit.code = 'hotel' and mapping.is_active and mapping.archived_at is null
  ) then
    raise exception '활성 호텔 캘린더와 일정 유형을 확인해 주세요.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.dogs dog
    join public.customers customer on customer.id = p_customer_id
    where dog.id = p_dog_id and dog.is_active
      and customer.is_active and dog.customer_id = customer.id
  ) then
    raise exception '반려견과 연결 보호자 정보를 확인해 주세요.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('hotel-request:' || p_request_id::text, 0));
  if public.is_replayed_hotel_stay_request(p_hotel_stay_id, p_request_id) then
    return public.hotel_stay_json(p_hotel_stay_id);
  end if;

  select * into stay_row from public.hotel_stays stay
  where stay.id = p_hotel_stay_id for update;
  if not found or stay_row.archived_at is not null then
    raise exception '수정할 호텔 예약을 확인할 수 없습니다.' using errcode = 'P0002';
  end if;
  if stay_row.version <> p_expected_version then
    raise exception '다른 사용자가 먼저 호텔 예약을 수정했습니다.' using errcode = '40001';
  end if;
  if stay_row.checked_in_at is not null then
    raise exception '입실 완료 후에는 Calendar 예약 정보를 변경할 수 없습니다.' using errcode = '22023';
  end if;

  select capacity.* into capacity_row
  from public.hotel_capacity_reservations capacity
  where capacity.hotel_stay_id = p_hotel_stay_id and capacity.archived_at is null
  for update;
  select schedule.* into check_in_schedule
  from public.hotel_stay_schedule_events event
  join public.operation_schedules schedule on schedule.id = event.operation_schedule_id
  where event.hotel_stay_id = p_hotel_stay_id and event.event_kind = 'check_in'
    and event.archived_at is null for update of schedule;
  select schedule.* into check_out_schedule
  from public.hotel_stay_schedule_events event
  join public.operation_schedules schedule on schedule.id = event.operation_schedule_id
  where event.hotel_stay_id = p_hotel_stay_id and event.event_kind = 'check_out'
    and event.archived_at is null for update of schedule;

  if capacity_row.id is null or check_in_schedule.id is null or check_out_schedule.id is null then
    raise exception '호텔 예약 연결 구조가 완전하지 않습니다.' using errcode = 'P0002';
  end if;
  if not public.can_manage_operation_schedule(check_in_schedule.id)
    or not public.can_manage_operation_schedule(check_out_schedule.id) then
    raise exception '호텔 예약 생성자 또는 담당자만 수정할 수 있습니다.' using errcode = '42501';
  end if;

  -- Calendar 일정이나 Capacity를 변경하기 전에 물리 배정 이력과 충돌을 먼저 검증한다.
  select count(*) into allocation_count
  from public.hotel_room_allocations allocation
  where allocation.capacity_reservation_id = capacity_row.id
    and allocation.archived_at is null;
  if allocation_count > 1 then
    raise exception '객실 이동 이력이 있는 Stay는 Calendar 예약 기간을 수정할 수 없습니다.'
      using errcode = '22023';
  end if;
  if allocation_count = 1 then
    select allocation.* into allocation_row
    from public.hotel_room_allocations allocation
    where allocation.capacity_reservation_id = capacity_row.id
      and allocation.archived_at is null
    for update;
    if capacity_row.room_type_id = p_room_type_id then
      perform pg_advisory_xact_lock(
        hashtextextended('hotel-room:' || allocation_row.room_id::text, 0)
      );
      if not exists (
        select 1 from public.hotel_rooms room
        where room.id = allocation_row.room_id
          and room.room_type_id = p_room_type_id
          and room.is_active and room.archived_at is null
      ) then
        raise exception '사전 배정된 호실이 새 예약 조건에 유효하지 않습니다.'
          using errcode = '22023';
      end if;
      if exists (
        select 1 from public.hotel_room_allocations other_allocation
        where other_allocation.room_id = allocation_row.room_id
          and other_allocation.archived_at is null
          and other_allocation.id <> allocation_row.id
          and other_allocation.allocated_from < p_check_out_at
          and other_allocation.allocated_until > p_check_in_at
      ) then
        raise exception '변경한 예약 기간에 사전 배정 호실 충돌이 있습니다.'
          using errcode = '23P01';
      end if;
    end if;
  end if;
  perform public.assert_hotel_capacity_available(
    p_room_type_id, p_check_in_at, p_check_out_at, 1, capacity_row.id
  );

  perform public.update_operation_schedule(
    check_in_schedule.id, check_in_schedule.version,
    p_calendar_id, p_schedule_type_id, p_title,
    p_check_in_at, p_check_in_at + interval '1 hour', false, false,
    p_memo, p_assignee_ids, array[p_customer_id], array[p_dog_id], gen_random_uuid()
  );
  perform public.update_operation_schedule(
    check_out_schedule.id, check_out_schedule.version,
    p_calendar_id, p_schedule_type_id, p_title,
    p_check_out_at, p_check_out_at + interval '1 hour', false, false,
    p_memo, p_assignee_ids, array[p_customer_id], array[p_dog_id], gen_random_uuid()
  );

  perform set_config('app.operation_change_reason', '호텔 예약 수정', true);
  perform set_config('app.operation_request_id', p_request_id::text, true);

  if allocation_count = 1 then
    if capacity_row.room_type_id <> p_room_type_id then
      update public.hotel_room_allocations allocation
      set archived_at = now(), archived_by = actor_id,
          archive_reason = '예약 객실 유형 변경으로 호실 배정 해제',
          updated_by = actor_id
      where allocation.id = allocation_row.id;
    else
      update public.hotel_room_allocations allocation
      set allocated_from = p_check_in_at,
          allocated_until = p_check_out_at,
          updated_by = actor_id
      where allocation.id = allocation_row.id;
    end if;
  end if;

  update public.hotel_capacity_reservations capacity
  set room_type_id = p_room_type_id,
      reserved_from = p_check_in_at,
      reserved_until = p_check_out_at,
      updated_by = actor_id
  where capacity.id = capacity_row.id;

  update public.hotel_stays stay
  set dog_id = p_dog_id, updated_by = actor_id
  where stay.id = p_hotel_stay_id;

  return public.hotel_stay_json(p_hotel_stay_id);
end;
$$;

create or replace function public.cancel_hotel_reservation(
  p_hotel_stay_id uuid,
  p_expected_version integer,
  p_reason text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  stay_row public.hotel_stays%rowtype;
  schedule_row public.operation_schedules%rowtype;
begin
  if actor_id is null or not public.is_active_operation_member() then
    raise exception '호텔 예약 취소 권한이 없습니다.' using errcode = '42501';
  end if;
  if p_request_id is null or p_expected_version is null
    or nullif(btrim(p_reason), '') is null then
    raise exception '요청 ID, 기존 버전, 취소 사유가 필요합니다.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('hotel-request:' || p_request_id::text, 0));
  if public.is_replayed_hotel_stay_request(p_hotel_stay_id, p_request_id) then
    return public.hotel_stay_json(p_hotel_stay_id);
  end if;

  select * into stay_row from public.hotel_stays stay
  where stay.id = p_hotel_stay_id for update;
  if not found then raise exception '호텔 예약을 확인할 수 없습니다.' using errcode = 'P0002'; end if;
  if stay_row.archived_at is not null then return public.hotel_stay_json(p_hotel_stay_id); end if;
  if stay_row.version <> p_expected_version then
    raise exception '다른 사용자가 먼저 호텔 예약을 수정했습니다.' using errcode = '40001';
  end if;
  if stay_row.checked_in_at is not null then
    raise exception '입실 완료된 예약은 일반 취소할 수 없습니다.' using errcode = '22023';
  end if;

  for schedule_row in
    select schedule.* from public.hotel_stay_schedule_events event
    join public.operation_schedules schedule on schedule.id = event.operation_schedule_id
    where event.hotel_stay_id = p_hotel_stay_id and event.archived_at is null
    order by event.event_kind
  loop
    if not public.can_manage_operation_schedule(schedule_row.id) then
      raise exception '호텔 예약 생성자 또는 담당자만 취소할 수 있습니다.' using errcode = '42501';
    end if;
    if schedule_row.status <> 'cancelled' then
      perform public.set_operation_schedule_status(
        schedule_row.id, schedule_row.version, 'cancelled', btrim(p_reason), gen_random_uuid()
      );
    end if;
  end loop;

  perform set_config('app.operation_change_reason', btrim(p_reason), true);
  perform set_config('app.operation_request_id', p_request_id::text, true);

  update public.hotel_room_allocations allocation
  set archived_at = now(), archived_by = actor_id,
      archive_reason = btrim(p_reason), updated_by = actor_id
  where allocation.capacity_reservation_id in (
    select capacity.id from public.hotel_capacity_reservations capacity
    where capacity.hotel_stay_id = p_hotel_stay_id and capacity.archived_at is null
  ) and allocation.archived_at is null;
  update public.hotel_capacity_reservations capacity
  set archived_at = now(), archived_by = actor_id,
      archive_reason = btrim(p_reason), updated_by = actor_id
  where capacity.hotel_stay_id = p_hotel_stay_id and capacity.archived_at is null;

  update public.hotel_stays stay
  set archived_at = now(), archived_by = actor_id,
      archive_reason = btrim(p_reason), updated_by = actor_id
  where stay.id = p_hotel_stay_id;

  return public.hotel_stay_json(p_hotel_stay_id);
end;
$$;

create or replace function public.assign_hotel_room(
  p_hotel_stay_id uuid,
  p_expected_version integer,
  p_room_id uuid,
  p_reason text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  stay_row public.hotel_stays%rowtype;
  capacity_row public.hotel_capacity_reservations%rowtype;
begin
  if actor_id is null or not public.is_active_operation_member() then
    raise exception '호실 배정 권한이 없습니다.' using errcode = '42501';
  end if;
  if p_request_id is null or p_expected_version is null then
    raise exception '요청 ID와 기존 버전이 필요합니다.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('hotel-request:' || p_request_id::text, 0));
  if public.is_replayed_hotel_stay_request(p_hotel_stay_id, p_request_id) then
    return public.hotel_stay_json(p_hotel_stay_id);
  end if;
  select * into stay_row from public.hotel_stays stay
    where stay.id = p_hotel_stay_id for update;
  if not found or stay_row.archived_at is not null then
    raise exception '활성 호텔 예약을 확인할 수 없습니다.' using errcode = 'P0002';
  end if;
  if stay_row.version <> p_expected_version then
    raise exception '다른 사용자가 먼저 호텔 예약을 수정했습니다.' using errcode = '40001';
  end if;
  if stay_row.checked_out_at is not null then
    raise exception '퇴실 완료된 예약에는 호실을 배정할 수 없습니다.' using errcode = '22023';
  end if;
  select * into capacity_row from public.hotel_capacity_reservations capacity
    where capacity.hotel_stay_id = p_hotel_stay_id and capacity.archived_at is null for update;
  if not found then raise exception 'Capacity 예약을 확인할 수 없습니다.' using errcode = 'P0002'; end if;
  if exists (select 1 from public.hotel_room_allocations allocation
    where allocation.capacity_reservation_id = capacity_row.id
      and allocation.archived_at is null) then
    raise exception '이미 배정된 호실이 있습니다. 객실 이동을 사용해 주세요.' using errcode = '23505';
  end if;

  perform public.assert_hotel_room_allocation_available(
    p_room_id, capacity_row.id, capacity_row.reserved_from, capacity_row.reserved_until, null
  );
  perform set_config('app.operation_change_reason', coalesce(nullif(btrim(p_reason), ''), '호텔 호실 배정'), true);
  perform set_config('app.operation_request_id', p_request_id::text, true);
  insert into public.hotel_room_allocations (
    capacity_reservation_id, room_id, allocated_from, allocated_until,
    assignment_reason, request_id, created_by, updated_by
  ) values (
    capacity_row.id, p_room_id, capacity_row.reserved_from, capacity_row.reserved_until,
    nullif(btrim(p_reason), ''), p_request_id, actor_id, actor_id
  );
  update public.hotel_stays set updated_by = actor_id where id = p_hotel_stay_id;
  return public.hotel_stay_json(p_hotel_stay_id);
end;
$$;

create or replace function public.reassign_hotel_room_before_check_in(
  p_hotel_stay_id uuid,
  p_expected_version integer,
  p_new_room_id uuid,
  p_reason text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  stay_row public.hotel_stays%rowtype;
  capacity_row public.hotel_capacity_reservations%rowtype;
  current_allocation public.hotel_room_allocations%rowtype;
  allocation_count integer;
begin
  if actor_id is null or not public.is_active_operation_member() then
    raise exception '사전 호실 재배정 권한이 없습니다.' using errcode = '42501';
  end if;
  if p_request_id is null or p_expected_version is null
    or nullif(btrim(p_reason), '') is null then
    raise exception '요청 ID, 기존 버전, 재배정 사유가 필요합니다.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('hotel-request:' || p_request_id::text, 0));
  if public.is_replayed_hotel_stay_request(p_hotel_stay_id, p_request_id) then
    return public.hotel_stay_json(p_hotel_stay_id);
  end if;
  select * into stay_row from public.hotel_stays stay
  where stay.id = p_hotel_stay_id for update;
  if not found or stay_row.archived_at is not null then
    raise exception '활성 호텔 예약을 확인할 수 없습니다.' using errcode = 'P0002';
  end if;
  if stay_row.version <> p_expected_version then
    raise exception '다른 사용자가 먼저 호텔 예약을 수정했습니다.' using errcode = '40001';
  end if;
  if stay_row.checked_in_at is not null then
    raise exception '입실 후에는 객실 이동 기능을 사용해 주세요.' using errcode = '22023';
  end if;
  select * into capacity_row from public.hotel_capacity_reservations capacity
  where capacity.hotel_stay_id = p_hotel_stay_id and capacity.archived_at is null for update;
  select count(*) into allocation_count from public.hotel_room_allocations allocation
  where allocation.capacity_reservation_id = capacity_row.id and allocation.archived_at is null;
  if allocation_count <> 1 then
    raise exception '사전 재배정은 활성 호실 배정이 정확히 한 건일 때만 가능합니다.' using errcode = '22023';
  end if;
  select * into current_allocation from public.hotel_room_allocations allocation
  where allocation.capacity_reservation_id = capacity_row.id and allocation.archived_at is null
  for update;
  if current_allocation.room_id = p_new_room_id then
    raise exception '현재 배정과 다른 호실을 선택해 주세요.' using errcode = '22023';
  end if;
  perform public.assert_hotel_room_allocation_available(
    p_new_room_id, capacity_row.id, capacity_row.reserved_from, capacity_row.reserved_until, null
  );
  perform set_config('app.operation_change_reason', btrim(p_reason), true);
  perform set_config('app.operation_request_id', p_request_id::text, true);
  update public.hotel_room_allocations allocation
  set archived_at = now(), archived_by = actor_id,
      archive_reason = btrim(p_reason), updated_by = actor_id
  where allocation.id = current_allocation.id;
  insert into public.hotel_room_allocations (
    capacity_reservation_id, room_id, allocated_from, allocated_until,
    assignment_reason, request_id, created_by, updated_by
  ) values (
    capacity_row.id, p_new_room_id, capacity_row.reserved_from, capacity_row.reserved_until,
    btrim(p_reason), p_request_id, actor_id, actor_id
  );
  update public.hotel_stays set updated_by = actor_id where id = p_hotel_stay_id;
  return public.hotel_stay_json(p_hotel_stay_id);
end;
$$;

create or replace function public.move_hotel_room_same_type(
  p_hotel_stay_id uuid,
  p_expected_version integer,
  p_new_room_id uuid,
  p_move_at timestamptz,
  p_reason text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  stay_row public.hotel_stays%rowtype;
  capacity_row public.hotel_capacity_reservations%rowtype;
  current_allocation public.hotel_room_allocations%rowtype;
begin
  if actor_id is null or not public.is_active_operation_member() then
    raise exception '객실 이동 권한이 없습니다.' using errcode = '42501';
  end if;
  if p_request_id is null or p_expected_version is null or p_move_at is null
    or nullif(btrim(p_reason), '') is null then
    raise exception '요청 ID, 기존 버전, 이동 시각, 이동 사유가 필요합니다.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('hotel-request:' || p_request_id::text, 0));
  if public.is_replayed_hotel_stay_request(p_hotel_stay_id, p_request_id) then
    return public.hotel_stay_json(p_hotel_stay_id);
  end if;
  select * into stay_row from public.hotel_stays stay
    where stay.id = p_hotel_stay_id for update;
  if not found or stay_row.archived_at is not null then
    raise exception '활성 호텔 예약을 확인할 수 없습니다.' using errcode = 'P0002';
  end if;
  if stay_row.version <> p_expected_version then
    raise exception '다른 사용자가 먼저 호텔 예약을 수정했습니다.' using errcode = '40001';
  end if;
  if stay_row.checked_out_at is not null then
    raise exception '퇴실 완료된 예약은 객실을 이동할 수 없습니다.' using errcode = '22023';
  end if;
  if stay_row.checked_in_at is null then
    raise exception '입실 전에는 사전 호실 재배정 기능을 사용해 주세요.' using errcode = '22023';
  end if;
  select * into capacity_row from public.hotel_capacity_reservations capacity
    where capacity.hotel_stay_id = p_hotel_stay_id and capacity.archived_at is null for update;
  select allocation.* into current_allocation
  from public.hotel_room_allocations allocation
  where allocation.capacity_reservation_id = capacity_row.id
    and allocation.archived_at is null
    and allocation.allocated_from <= p_move_at
    and allocation.allocated_until > p_move_at
  order by allocation.allocated_from desc limit 1 for update;
  if not found then raise exception '이동할 현재 호실 배정을 확인할 수 없습니다.' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.hotel_rooms room
    where room.id = p_new_room_id and room.room_type_id = capacity_row.room_type_id
      and room.is_active and room.archived_at is null) then
    raise exception 'Sprint 1에서는 같은 객실 유형 안에서만 이동할 수 있습니다.' using errcode = '22023';
  end if;
  if p_move_at <= current_allocation.allocated_from
    or p_move_at >= current_allocation.allocated_until then
    raise exception '이동 시각은 현재 배정 구간 안이어야 합니다.' using errcode = '22023';
  end if;
  perform public.assert_hotel_room_allocation_available(
    p_new_room_id, capacity_row.id, p_move_at, current_allocation.allocated_until, null
  );

  perform set_config('app.operation_change_reason', btrim(p_reason), true);
  perform set_config('app.operation_request_id', p_request_id::text, true);
  update public.hotel_room_allocations allocation
  set allocated_until = p_move_at, assignment_reason = btrim(p_reason), updated_by = actor_id
  where allocation.id = current_allocation.id;
  insert into public.hotel_room_allocations (
    capacity_reservation_id, room_id, allocated_from, allocated_until,
    assignment_reason, request_id, created_by, updated_by
  ) values (
    capacity_row.id, p_new_room_id, p_move_at, current_allocation.allocated_until,
    btrim(p_reason), p_request_id, actor_id, actor_id
  );
  update public.hotel_stays set updated_by = actor_id where id = p_hotel_stay_id;
  return public.hotel_stay_json(p_hotel_stay_id);
end;
$$;

create or replace function public.complete_hotel_check_in(
  p_hotel_stay_id uuid,
  p_expected_version integer,
  p_completed_at timestamptz,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  stay_row public.hotel_stays%rowtype;
  capacity_id uuid;
  effective_at timestamptz := coalesce(p_completed_at, now());
begin
  if actor_id is null or not public.is_active_operation_member() then
    raise exception '입실 완료 권한이 없습니다.' using errcode = '42501';
  end if;
  if p_request_id is null or p_expected_version is null then
    raise exception '요청 ID와 기존 버전이 필요합니다.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('hotel-request:' || p_request_id::text, 0));
  if public.is_replayed_hotel_stay_request(p_hotel_stay_id, p_request_id) then
    return public.hotel_stay_json(p_hotel_stay_id);
  end if;
  select * into stay_row from public.hotel_stays stay where stay.id = p_hotel_stay_id for update;
  if not found or stay_row.archived_at is not null then raise exception '활성 호텔 예약을 확인할 수 없습니다.' using errcode = 'P0002'; end if;
  if stay_row.version <> p_expected_version then raise exception '다른 사용자가 먼저 처리했습니다.' using errcode = '40001'; end if;
  if stay_row.checked_in_at is not null then return public.hotel_stay_json(p_hotel_stay_id); end if;
  select id into capacity_id from public.hotel_capacity_reservations
    where hotel_stay_id = p_hotel_stay_id and archived_at is null;
  if not exists (select 1 from public.hotel_room_allocations allocation
    where allocation.capacity_reservation_id = capacity_id and allocation.archived_at is null
      and allocation.allocated_from <= effective_at and allocation.allocated_until > effective_at) then
    raise exception '입실 완료 전에 해당 시각의 실제 호실 배정이 필요합니다.' using errcode = '23514';
  end if;
  perform set_config('app.operation_change_reason', '호텔 입실 완료', true);
  perform set_config('app.operation_request_id', p_request_id::text, true);
  update public.hotel_stays set checked_in_at = effective_at, checked_in_by = actor_id,
    updated_by = actor_id where id = p_hotel_stay_id;
  return public.hotel_stay_json(p_hotel_stay_id);
end;
$$;

create or replace function public.complete_hotel_check_out(
  p_hotel_stay_id uuid,
  p_expected_version integer,
  p_completed_at timestamptz,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  stay_row public.hotel_stays%rowtype;
  capacity_row public.hotel_capacity_reservations%rowtype;
  final_allocation public.hotel_room_allocations%rowtype;
  effective_at timestamptz := coalesce(p_completed_at, now());
begin
  if actor_id is null or not public.is_active_operation_member() then
    raise exception '퇴실 완료 권한이 없습니다.' using errcode = '42501';
  end if;
  if p_request_id is null or p_expected_version is null then raise exception '요청 ID와 기존 버전이 필요합니다.' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('hotel-request:' || p_request_id::text, 0));
  if public.is_replayed_hotel_stay_request(p_hotel_stay_id, p_request_id) then
    return public.hotel_stay_json(p_hotel_stay_id);
  end if;
  select * into stay_row from public.hotel_stays stay where stay.id = p_hotel_stay_id for update;
  if not found or stay_row.archived_at is not null then raise exception '활성 호텔 예약을 확인할 수 없습니다.' using errcode = 'P0002'; end if;
  if stay_row.version <> p_expected_version then raise exception '다른 사용자가 먼저 처리했습니다.' using errcode = '40001'; end if;
  if stay_row.checked_in_at is null then raise exception '입실 완료 후 퇴실 처리할 수 있습니다.' using errcode = '22023'; end if;
  if effective_at <= stay_row.checked_in_at then raise exception '퇴실 완료 시각은 입실 완료 시각보다 늦어야 합니다.' using errcode = '22023'; end if;
  if stay_row.checked_out_at is not null then return public.hotel_stay_json(p_hotel_stay_id); end if;
  select * into capacity_row from public.hotel_capacity_reservations capacity
    where capacity.hotel_stay_id = p_hotel_stay_id and capacity.archived_at is null for update;
  if not found then raise exception '활성 Capacity 예약을 확인할 수 없습니다.' using errcode = 'P0002'; end if;
  select * into final_allocation from public.hotel_room_allocations allocation
  where allocation.capacity_reservation_id = capacity_row.id
    and allocation.archived_at is null
  order by allocation.allocated_until desc, allocation.allocated_from desc
  limit 1 for update;
  if not found then raise exception '퇴실 처리할 최종 호실 배정을 확인할 수 없습니다.' using errcode = 'P0002'; end if;
  if effective_at <= final_allocation.allocated_from then
    raise exception '퇴실 완료 시각은 최종 호실 배정 시작보다 늦어야 합니다.' using errcode = '22023';
  end if;

  if effective_at > capacity_row.reserved_until then
    perform public.assert_hotel_capacity_available(
      capacity_row.room_type_id, capacity_row.reserved_from, effective_at,
      capacity_row.quantity, capacity_row.id
    );
    -- 기존 Capacity를 먼저 바꾸지 않고 예상 종료시각 기준으로 호실 충돌을 검사한다.
    perform pg_advisory_xact_lock(
      hashtextextended('hotel-room:' || final_allocation.room_id::text, 0)
    );
    if exists (
      select 1 from public.hotel_room_allocations other_allocation
      where other_allocation.room_id = final_allocation.room_id
        and other_allocation.archived_at is null
        and other_allocation.id <> final_allocation.id
        and other_allocation.allocated_from < effective_at
        and other_allocation.allocated_until > final_allocation.allocated_from
    ) then
      raise exception '실제 퇴실 시각까지 최종 호실을 연장할 수 없습니다.'
        using errcode = '23P01';
    end if;
  end if;

  perform set_config('app.operation_change_reason', '호텔 퇴실 완료', true);
  perform set_config('app.operation_request_id', p_request_id::text, true);
  if effective_at > capacity_row.reserved_until then
    update public.hotel_capacity_reservations capacity
    set reserved_until = effective_at, updated_by = actor_id
    where capacity.id = capacity_row.id;
  end if;
  update public.hotel_room_allocations allocation
  set allocated_until = effective_at, updated_by = actor_id
  where allocation.id = final_allocation.id;
  update public.hotel_stays
  set checked_out_at = effective_at,
      checked_out_by = actor_id,
      checkout_previous_reserved_until = capacity_row.reserved_until,
      checkout_previous_allocation_id = final_allocation.id,
      checkout_previous_allocation_until = final_allocation.allocated_until,
      updated_by = actor_id
  where id = p_hotel_stay_id;
  return public.hotel_stay_json(p_hotel_stay_id);
end;
$$;

create or replace function public.reverse_hotel_completion(
  p_hotel_stay_id uuid,
  p_expected_version integer,
  p_completion_kind text,
  p_reason text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  stay_row public.hotel_stays%rowtype;
  capacity_row public.hotel_capacity_reservations%rowtype;
  final_allocation public.hotel_room_allocations%rowtype;
begin
  if actor_id is null or not public.has_operation_role(array['owner', 'manager']) then
    raise exception 'Operations Owner/Manager만 완료 상태를 되돌릴 수 있습니다.' using errcode = '42501';
  end if;
  if p_request_id is null or p_expected_version is null
    or p_completion_kind not in ('check_in', 'check_out')
    or nullif(btrim(p_reason), '') is null then
    raise exception '완료 종류, 요청 ID, 기존 버전, 되돌리기 사유가 필요합니다.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('hotel-request:' || p_request_id::text, 0));
  if public.is_replayed_hotel_stay_request(p_hotel_stay_id, p_request_id) then
    return public.hotel_stay_json(p_hotel_stay_id);
  end if;
  select * into stay_row from public.hotel_stays stay where stay.id = p_hotel_stay_id for update;
  if not found or stay_row.archived_at is not null then raise exception '활성 호텔 예약을 확인할 수 없습니다.' using errcode = 'P0002'; end if;
  if stay_row.version <> p_expected_version then raise exception '다른 사용자가 먼저 처리했습니다.' using errcode = '40001'; end if;
  if p_completion_kind = 'check_in' and stay_row.checked_out_at is not null then
    raise exception '퇴실 완료를 먼저 되돌려야 합니다.' using errcode = '22023';
  end if;
  perform set_config('app.operation_change_reason', btrim(p_reason), true);
  perform set_config('app.operation_request_id', p_request_id::text, true);
  if p_completion_kind = 'check_in' then
    update public.hotel_stays set checked_in_at = null, checked_in_by = null,
      updated_by = actor_id where id = p_hotel_stay_id;
  else
    if stay_row.checked_out_at is null
      or stay_row.checkout_previous_reserved_until is null
      or stay_row.checkout_previous_allocation_id is null
      or stay_row.checkout_previous_allocation_until is null then
      raise exception '되돌릴 퇴실 완료 기록을 확인할 수 없습니다.' using errcode = 'P0002';
    end if;
    select * into capacity_row from public.hotel_capacity_reservations capacity
      where capacity.hotel_stay_id = p_hotel_stay_id and capacity.archived_at is null for update;
    select * into final_allocation from public.hotel_room_allocations allocation
      where allocation.id = stay_row.checkout_previous_allocation_id
        and allocation.capacity_reservation_id = capacity_row.id
        and allocation.archived_at is null for update;
    if not found then raise exception '복원할 최종 호실 배정 기록을 확인할 수 없습니다.' using errcode = 'P0002'; end if;
    if stay_row.checkout_previous_allocation_until <= final_allocation.allocated_from then
      raise exception '저장된 이전 호실 종료 시각이 유효하지 않습니다.' using errcode = '22023';
    end if;
    if stay_row.checkout_previous_reserved_until > capacity_row.reserved_until then
      perform public.assert_hotel_capacity_available(
        capacity_row.room_type_id, capacity_row.reserved_from,
        stay_row.checkout_previous_reserved_until, capacity_row.quantity, capacity_row.id
      );
    end if;
    -- 정확히 저장한 이전 Capacity 범위를 먼저 복원한다. 이어지는 호실 검증이
    -- 실패하면 동일 함수 호출의 모든 변경이 원자적으로 롤백된다.
    update public.hotel_capacity_reservations capacity
    set reserved_until = stay_row.checkout_previous_reserved_until,
        updated_by = actor_id
    where capacity.id = capacity_row.id;
    perform public.assert_hotel_room_allocation_available(
      final_allocation.room_id, capacity_row.id,
      final_allocation.allocated_from,
      stay_row.checkout_previous_allocation_until,
      final_allocation.id
    );
    update public.hotel_room_allocations allocation
    set allocated_until = stay_row.checkout_previous_allocation_until,
        updated_by = actor_id
    where allocation.id = final_allocation.id;
    update public.hotel_stays
    set checked_out_at = null,
        checked_out_by = null,
        checkout_previous_reserved_until = null,
        checkout_previous_allocation_id = null,
        checkout_previous_allocation_until = null,
        updated_by = actor_id
    where id = p_hotel_stay_id;
  end if;
  return public.hotel_stay_json(p_hotel_stay_id);
end;
$$;

create or replace function public.register_hotel_daycare_capacity(
  p_schedule_id uuid,
  p_room_type_id uuid,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  schedule_row public.operation_schedules%rowtype;
  reservation_id uuid;
begin
  if actor_id is null or not public.is_active_operation_member() then
    raise exception '데이케어 객실 Capacity 등록 권한이 없습니다.' using errcode = '42501';
  end if;
  if p_request_id is null then raise exception '요청 ID가 필요합니다.' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('hotel-request:' || p_request_id::text, 0));
  select id into reservation_id from public.hotel_capacity_reservations where request_id = p_request_id;
  if reservation_id is not null then
    return (select to_jsonb(capacity) from public.hotel_capacity_reservations capacity where capacity.id = reservation_id);
  end if;
  select * into schedule_row from public.operation_schedules schedule
    where schedule.id = p_schedule_id and schedule.archived_at is null for update;
  if not found then raise exception '활성 데이케어 일정을 확인할 수 없습니다.' using errcode = 'P0002'; end if;
  if schedule_row.all_day or schedule_row.time_unspecified then
    raise exception '데이케어 객실 사용은 정확한 시작·종료 시간이 필요합니다.' using errcode = '22023';
  end if;
  if not public.can_manage_operation_schedule(p_schedule_id) then
    raise exception '일정 생성자 또는 담당자만 객실 Capacity를 연결할 수 있습니다.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.operation_calendars calendar
    join public.business_units unit on unit.id = calendar.business_unit_id
    where calendar.id = schedule_row.calendar_id and unit.code = 'daycare') then
    raise exception '데이케어 캘린더 일정만 연결할 수 있습니다.' using errcode = '22023';
  end if;
  perform public.assert_hotel_capacity_available(
    p_room_type_id, schedule_row.starts_at, schedule_row.ends_at, 1, null
  );
  perform set_config('app.operation_change_reason', '데이케어 객실 Capacity 등록', true);
  perform set_config('app.operation_request_id', '', true);
  insert into public.hotel_capacity_reservations (
    source_kind, daycare_schedule_id, room_type_id, reserved_from, reserved_until,
    quantity, request_id, created_by, updated_by
  ) values (
    'daycare', p_schedule_id, p_room_type_id, schedule_row.starts_at,
    schedule_row.ends_at, 1, p_request_id, actor_id, actor_id
  ) returning id into reservation_id;
  return (select to_jsonb(capacity) from public.hotel_capacity_reservations capacity where capacity.id = reservation_id);
end;
$$;

create or replace function public.update_hotel_operation_settings(
  p_expected_version integer,
  p_default_check_in_time time,
  p_default_check_out_time time,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  settings_row public.hotel_operation_settings%rowtype;
  request_module text;
  request_entity_type text;
  request_entity_id uuid;
  request_after_data jsonb;
begin
  if actor_id is null or not public.has_operation_role(array['owner', 'manager']) then
    raise exception 'Operations Owner/Manager만 호텔 기본 시간을 변경할 수 있습니다.' using errcode = '42501';
  end if;
  if p_request_id is null or p_expected_version is null
    or p_default_check_in_time is null or p_default_check_out_time is null then
    raise exception '기존 버전, 기본 시간, 요청 ID가 필요합니다.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('hotel-request:' || p_request_id::text, 0));
  select * into settings_row from public.hotel_operation_settings
    where singleton_key = 'default' and archived_at is null;
  if not found then raise exception '호텔 운영 설정을 확인할 수 없습니다.' using errcode = 'P0002'; end if;
  select audit.module_code, audit.entity_type, audit.entity_id, audit.after_data
  into request_module, request_entity_type, request_entity_id, request_after_data
  from public.entity_audit_events audit
  where audit.request_id = p_request_id
  order by audit.created_at
  limit 1;
  if found then
    if request_module = 'hotel_operations'
      and request_entity_type = 'hotel_operation_settings'
      and request_entity_id = settings_row.id then
      return request_after_data;
    end if;
    raise exception '이미 다른 요청 또는 엔티티에 사용된 요청 ID입니다.' using errcode = '23505';
  end if;
  select * into settings_row from public.hotel_operation_settings
    where singleton_key = 'default' and archived_at is null for update;
  if not found then raise exception '호텔 운영 설정을 확인할 수 없습니다.' using errcode = 'P0002'; end if;
  if settings_row.version <> p_expected_version then raise exception '다른 사용자가 먼저 설정을 변경했습니다.' using errcode = '40001'; end if;
  perform set_config('app.operation_change_reason', '호텔 기본 입퇴실 시간 변경', true);
  perform set_config('app.operation_request_id', p_request_id::text, true);
  update public.hotel_operation_settings
  set default_check_in_time = p_default_check_in_time,
      default_check_out_time = p_default_check_out_time,
      updated_by = actor_id
  where id = settings_row.id;
  return (select to_jsonb(settings) from public.hotel_operation_settings settings where settings.id = settings_row.id);
end;
$$;

create or replace function public.assign_hotel_daycare_room(
  p_capacity_reservation_id uuid,
  p_room_id uuid,
  p_reason text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  capacity_row public.hotel_capacity_reservations%rowtype;
  allocation_id uuid;
begin
  if actor_id is null or not public.is_active_operation_member() then
    raise exception '데이케어 호실 배정 권한이 없습니다.' using errcode = '42501';
  end if;
  if p_request_id is null then raise exception '요청 ID가 필요합니다.' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('hotel-request:' || p_request_id::text, 0));
  select id into allocation_id from public.hotel_room_allocations where request_id = p_request_id;
  if allocation_id is not null then
    return (select to_jsonb(allocation) from public.hotel_room_allocations allocation where allocation.id = allocation_id);
  end if;
  select * into capacity_row from public.hotel_capacity_reservations capacity
    where capacity.id = p_capacity_reservation_id and capacity.source_kind = 'daycare'
      and capacity.archived_at is null for update;
  if not found then raise exception '활성 데이케어 Capacity를 확인할 수 없습니다.' using errcode = 'P0002'; end if;
  if not public.can_manage_operation_schedule(capacity_row.daycare_schedule_id) then
    raise exception '일정 생성자 또는 담당자만 호실을 배정할 수 있습니다.' using errcode = '42501';
  end if;
  if exists (select 1 from public.hotel_room_allocations allocation
    where allocation.capacity_reservation_id = capacity_row.id and allocation.archived_at is null) then
    raise exception '이미 배정된 호실이 있습니다.' using errcode = '23505';
  end if;
  perform public.assert_hotel_room_allocation_available(
    p_room_id, capacity_row.id, capacity_row.reserved_from, capacity_row.reserved_until, null
  );
  perform set_config('app.operation_change_reason', coalesce(nullif(btrim(p_reason), ''), '데이케어 호실 배정'), true);
  perform set_config('app.operation_request_id', '', true);
  insert into public.hotel_room_allocations (
    capacity_reservation_id, room_id, allocated_from, allocated_until,
    assignment_reason, request_id, created_by, updated_by
  ) values (
    capacity_row.id, p_room_id, capacity_row.reserved_from, capacity_row.reserved_until,
    nullif(btrim(p_reason), ''), p_request_id, actor_id, actor_id
  ) returning id into allocation_id;
  return (select to_jsonb(allocation) from public.hotel_room_allocations allocation where allocation.id = allocation_id);
end;
$$;

do $$
declare
  signature text;
begin
  foreach signature in array array[
    'public.assert_hotel_capacity_available(uuid,timestamp with time zone,timestamp with time zone,integer,uuid)',
    'public.assert_hotel_room_allocation_available(uuid,uuid,timestamp with time zone,timestamp with time zone,uuid)',
    'public.hotel_stay_json(uuid)',
    'public.is_replayed_hotel_stay_request(uuid,uuid)',
    'public.get_hotel_operations_snapshot(date)',
    'public.create_hotel_reservation(uuid,uuid,text,timestamp with time zone,timestamp with time zone,uuid,uuid,uuid,uuid[],text,uuid)',
    'public.update_hotel_reservation(uuid,integer,uuid,uuid,text,timestamp with time zone,timestamp with time zone,uuid,uuid,uuid,uuid[],text,uuid)',
    'public.cancel_hotel_reservation(uuid,integer,text,uuid)',
    'public.assign_hotel_room(uuid,integer,uuid,text,uuid)',
    'public.reassign_hotel_room_before_check_in(uuid,integer,uuid,text,uuid)',
    'public.move_hotel_room_same_type(uuid,integer,uuid,timestamp with time zone,text,uuid)',
    'public.complete_hotel_check_in(uuid,integer,timestamp with time zone,uuid)',
    'public.complete_hotel_check_out(uuid,integer,timestamp with time zone,uuid)',
    'public.reverse_hotel_completion(uuid,integer,text,text,uuid)',
    'public.register_hotel_daycare_capacity(uuid,uuid,uuid)',
    'public.assign_hotel_daycare_room(uuid,uuid,text,uuid)',
    'public.update_hotel_operation_settings(integer,time without time zone,time without time zone,uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', signature);
  end loop;
end;
$$;

grant execute on function public.hotel_stay_json(uuid) to authenticated;
grant execute on function public.get_hotel_operations_snapshot(date) to authenticated;
grant execute on function public.create_hotel_reservation(
  uuid,uuid,text,timestamptz,timestamptz,uuid,uuid,uuid,uuid[],text,uuid
) to authenticated;
grant execute on function public.update_hotel_reservation(
  uuid,integer,uuid,uuid,text,timestamptz,timestamptz,uuid,uuid,uuid,uuid[],text,uuid
) to authenticated;
grant execute on function public.cancel_hotel_reservation(uuid,integer,text,uuid) to authenticated;
grant execute on function public.assign_hotel_room(uuid,integer,uuid,text,uuid) to authenticated;
grant execute on function public.reassign_hotel_room_before_check_in(
  uuid,integer,uuid,text,uuid
) to authenticated;
grant execute on function public.move_hotel_room_same_type(
  uuid,integer,uuid,timestamptz,text,uuid
) to authenticated;
grant execute on function public.complete_hotel_check_in(
  uuid,integer,timestamptz,uuid
) to authenticated;
grant execute on function public.complete_hotel_check_out(
  uuid,integer,timestamptz,uuid
) to authenticated;
grant execute on function public.reverse_hotel_completion(
  uuid,integer,text,text,uuid
) to authenticated;
grant execute on function public.register_hotel_daycare_capacity(uuid,uuid,uuid) to authenticated;
grant execute on function public.assign_hotel_daycare_room(uuid,uuid,text,uuid) to authenticated;
grant execute on function public.update_hotel_operation_settings(
  integer,time,time,uuid
) to authenticated;

commit;
