-- Hotel flexible reservations extension
-- Existing Hotel, Operations and Finance RPC signatures are preserved.

begin;

do $$
begin
  if to_regclass('public.hotel_capacity_reservations') is null
    or to_regclass('public.hotel_room_allocations') is null
    or to_regclass('public.hotel_stays') is null
    or to_regclass('public.hotel_stay_schedule_events') is null
    or to_regclass('public.business_units') is null
    or to_regclass('public.operation_calendars') is null
    or to_regclass('public.operation_schedule_types') is null
    or to_regclass('public.operation_calendar_schedule_types') is null
    or to_regclass('public.operation_schedules') is null then
    raise exception 'Hotel Flexible Reservation 필수 테이블이 누락되었습니다.'
      using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from information_schema.columns column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = 'hotel_capacity_reservations'
      and column_row.column_name = 'room_type_id'
      and column_row.is_nullable = 'NO'
  ) then
    raise exception 'room_type_id 기존 NOT NULL 계약을 확인할 수 없습니다.'
      using errcode = 'P0002';
  end if;
  if coalesce((
    select md5(procedure_row.prosrc) =
      '321e35c3ac5180215086adf5d0f7d5ac'
    from pg_proc procedure_row
    where procedure_row.oid = to_regprocedure(
      'public.update_hotel_reservation(uuid,integer,uuid,uuid,text,timestamp with time zone,timestamp with time zone,uuid,uuid,uuid,uuid[],text,uuid)'
    )
  ), false) is not true then
    raise exception 'Hotel update lock-order Repair를 먼저 적용해 주세요.'
      using errcode = 'P0001';
  end if;
  if coalesce((
    select
      strpos(normalized.definition, 'assert_hotel_capacity_available')
        < strpos(normalized.definition, 'hotel-room:')
      and strpos(normalized.definition, 'hotel-room:')
        < strpos(normalized.definition, 'update public.hotel_capacity_reservations')
      and strpos(normalized.definition, 'update public.hotel_capacity_reservations')
        < strpos(normalized.definition, 'assert_hotel_room_allocation_available')
    from (
      select lower(regexp_replace(
        pg_get_functiondef(procedure_row.oid), '\s+', ' ', 'g'
      )) as definition
      from pg_proc procedure_row
      where procedure_row.oid = to_regprocedure(
        'public.reverse_hotel_completion(uuid,integer,text,text,uuid)'
      )
    ) normalized
  ), false) is not true then
    raise exception 'reverse_hotel_completion Lock Order Repair가 필요합니다.'
      using errcode = 'P0001';
  end if;
  if coalesce((
    select md5(procedure_row.prosrc) =
      'dd4dd04865adfa2dc3ec83097e2b81a3'
    from pg_proc procedure_row
    where procedure_row.oid = to_regprocedure(
      'public.reverse_hotel_completion(uuid,integer,text,text,uuid)'
    )
  ), false) is not true then
    raise exception 'reverse_hotel_completion Lock Order Repair 버전을 확인해 주세요.'
      using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.hotel_capacity_reservations capacity
    where capacity.room_type_id is null
  ) then
    raise exception '적용 전 room_type_id NULL 데이터 검토가 필요합니다.'
      using errcode = 'P0001';
  end if;
  if to_regprocedure(
      'public.create_flexible_hotel_reservation(uuid,uuid,date,time without time zone,boolean,date,time without time zone,boolean,uuid,uuid,uuid,uuid[],text,uuid)'
    ) is not null
    or to_regprocedure(
      'public.get_hotel_operations_snapshot_v2(date)'
    ) is not null then
    raise exception 'Hotel Flexible Reservation 확장 객체가 이미 존재합니다.'
      using errcode = '42710';
  end if;
end;
$$;

alter table public.hotel_capacity_reservations
  alter column room_type_id drop not null;

alter table public.hotel_capacity_reservations
  add constraint hotel_capacity_reservations_room_type_state_check
  check (
    room_type_id is not null
    or source_kind = 'stay'
  );

create index hotel_capacity_reservations_unspecified_overlap_idx
  on public.hotel_capacity_reservations (reserved_from, reserved_until)
  where room_type_id is null and archived_at is null;

create function public.assert_hotel_total_capacity_available(
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
  if p_reserved_from is null or p_reserved_until is null
    or p_reserved_until <= p_reserved_from or p_quantity <> 1 then
    raise exception '유효한 전체 호텔 Capacity 예약 기간이 필요합니다.'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('hotel-capacity:all', 0)
  );

  select count(*)::integer
  into active_room_count
  from public.hotel_rooms room
  join public.hotel_room_types room_type on room_type.id = room.room_type_id
  where room.is_active and room.archived_at is null
    and room_type.is_active and room_type.archived_at is null;

  if active_room_count = 0 then
    raise exception '예약 가능한 활성 호텔 객실이 없습니다.'
      using errcode = '22023';
  end if;

  with intervals as (
    select
      greatest(capacity.reserved_from, p_reserved_from) as starts_at,
      least(capacity.reserved_until, p_reserved_until) as ends_at,
      capacity.quantity::integer as quantity
    from public.hotel_capacity_reservations capacity
    where capacity.archived_at is null
      and capacity.id is distinct from p_exclude_reservation_id
      and capacity.reserved_from < p_reserved_until
      and capacity.reserved_until > p_reserved_from
    union all
    select p_reserved_from, p_reserved_until, p_quantity
  ), points as (
    select starts_at as point_at, quantity as delta from intervals
    union all
    select ends_at as point_at, -quantity as delta from intervals
  ), deltas as (
    select point_at, sum(delta) as delta from points group by point_at
  ), running as (
    select sum(delta) over (
      order by point_at rows unbounded preceding
    ) as occupancy
    from deltas
  )
  select coalesce(max(occupancy), 0)::integer
  into peak_reserved
  from running;

  if peak_reserved > active_room_count then
    raise exception '선택한 기간의 전체 호텔 Capacity가 부족합니다.'
      using errcode = '23514',
        detail = format(
          'active_rooms=%s, requested_peak=%s',
          active_room_count,
          peak_reserved
        );
  end if;
end;
$$;

create function public.enforce_hotel_total_capacity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.archived_at is not null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    perform public.assert_hotel_total_capacity_available(
      new.reserved_from,
      new.reserved_until,
      new.quantity,
      null
    );
  elsif old.archived_at is not null
    or new.reserved_from is distinct from old.reserved_from
    or new.reserved_until is distinct from old.reserved_until
    or new.quantity is distinct from old.quantity then
    perform public.assert_hotel_total_capacity_available(
      new.reserved_from,
      new.reserved_until,
      new.quantity,
      new.id
    );
  end if;
  return new;
end;
$$;

create trigger hotel_capacity_reservations_total_capacity_guard
  before insert or update on public.hotel_capacity_reservations
  for each row execute function public.enforce_hotel_total_capacity();

create function public.enforce_hotel_allocation_room_type()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  capacity_room_type_id uuid;
  selected_room_type_id uuid;
begin
  if new.archived_at is not null then
    return new;
  end if;

  select capacity.room_type_id
  into capacity_room_type_id
  from public.hotel_capacity_reservations capacity
  where capacity.id = new.capacity_reservation_id
    and capacity.archived_at is null;
  if not found or capacity_room_type_id is null then
    raise exception '객실 유형을 확정한 뒤 호실을 배정해 주세요.'
      using errcode = '23514';
  end if;

  select room.room_type_id
  into selected_room_type_id
  from public.hotel_rooms room
  where room.id = new.room_id
    and room.is_active
    and room.archived_at is null;
  if not found or selected_room_type_id <> capacity_room_type_id then
    raise exception '확정된 객실 유형과 선택한 호실 유형이 다릅니다.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger hotel_room_allocations_room_type_guard
  before insert or update on public.hotel_room_allocations
  for each row execute function public.enforce_hotel_allocation_room_type();

create function public.create_flexible_hotel_reservation(
  p_calendar_id uuid,
  p_schedule_type_id uuid,
  p_check_in_date date,
  p_check_in_time time,
  p_check_in_time_unspecified boolean,
  p_check_out_date date,
  p_check_out_time time,
  p_check_out_time_unspecified boolean,
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
  existing_stay public.hotel_stays%rowtype;
  existing_capacity public.hotel_capacity_reservations%rowtype;
  replay_check_in_schedule public.operation_schedules%rowtype;
  replay_check_out_schedule public.operation_schedules%rowtype;
  active_capacity_count integer;
  active_event_count integer;
  check_in_event_count integer;
  check_out_event_count integer;
  expected_check_in_ends_at timestamptz;
  expected_check_out_ends_at timestamptz;
  check_in_schedule jsonb;
  check_out_schedule jsonb;
  check_in_schedule_at timestamptz;
  check_out_schedule_at timestamptz;
  capacity_from timestamptz;
  capacity_until timestamptz;
  check_in_title text;
  check_out_title text;
  room_type_code text;
  dog_name text;
begin
  if actor_id is null or not public.is_active_operation_member() then
    raise exception '호텔 예약 등록 권한이 없습니다.' using errcode = '42501';
  end if;
  if p_request_id is null
    or p_check_in_date is null or p_check_out_date is null then
    raise exception '입실일, 퇴실일, 요청 ID가 필요합니다.'
      using errcode = '22023';
  end if;
  if p_check_out_date < p_check_in_date then
    raise exception '퇴실 날짜는 입실 날짜보다 빠를 수 없습니다.'
      using errcode = '22023';
  end if;
  if p_check_out_date = p_check_in_date
    and not coalesce(p_check_in_time_unspecified, false)
    and not coalesce(p_check_out_time_unspecified, false)
    and p_check_out_time <= p_check_in_time then
    raise exception '같은 날 예약의 퇴실 시간은 입실 시간보다 늦어야 합니다.'
      using errcode = '22023';
  end if;
  if not coalesce(p_check_in_time_unspecified, false)
    and p_check_in_time is null then
    raise exception '입실 시간이 확정된 경우 입실 시간이 필요합니다.'
      using errcode = '22023';
  end if;
  if not coalesce(p_check_out_time_unspecified, false)
    and p_check_out_time is null then
    raise exception '퇴실 시간이 확정된 경우 퇴실 시간이 필요합니다.'
      using errcode = '22023';
  end if;
  if p_dog_id is null or p_customer_id is null
    or cardinality(coalesce(p_assignee_ids, '{}'::uuid[])) = 0 then
    raise exception '반려견, 보호자, 담당자가 필요합니다.'
      using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.operation_calendars calendar
    join public.business_units unit on unit.id = calendar.business_unit_id
    join public.operation_schedule_types schedule_type
      on schedule_type.id = p_schedule_type_id
    join public.operation_calendar_schedule_types mapping
      on mapping.calendar_id = calendar.id
     and mapping.schedule_type_id = p_schedule_type_id
    where calendar.id = p_calendar_id
      and calendar.is_active
      and (to_jsonb(calendar) ->> 'archived_at') is null
      and unit.code = 'hotel'
      and unit.is_active
      and (to_jsonb(unit) ->> 'archived_at') is null
      and schedule_type.is_active
      and (to_jsonb(schedule_type) ->> 'archived_at') is null
      and mapping.is_active
      and mapping.archived_at is null
  ) then
    raise exception '활성 호텔 캘린더와 일정 유형을 확인해 주세요.'
      using errcode = '22023';
  end if;
  select dog.name
  into dog_name
  from public.dogs dog
  join public.customers customer on customer.id = p_customer_id
  where dog.id = p_dog_id
    and dog.is_active
    and customer.is_active
    and dog.customer_id = customer.id;
  if dog_name is null then
    raise exception '반려견과 연결 보호자 정보를 확인해 주세요.'
      using errcode = '22023';
  end if;
  if p_room_type_id is not null then
    select room_type.code
    into room_type_code
    from public.hotel_room_types room_type
    where room_type.id = p_room_type_id
      and room_type.is_active
      and room_type.archived_at is null;
    if room_type_code is null then
      raise exception '활성 객실 유형을 확인할 수 없습니다.'
        using errcode = 'P0002';
    end if;
  else
    room_type_code := '객실 미정';
  end if;

  -- time_unspecified=true이면 stale form time을 완전히 무시한다.
  check_in_schedule_at := case
    when coalesce(p_check_in_time_unspecified, false)
      then p_check_in_date::timestamp at time zone 'Asia/Seoul'
    else (p_check_in_date::timestamp + p_check_in_time)
      at time zone 'Asia/Seoul'
  end;
  check_out_schedule_at := case
    when coalesce(p_check_out_time_unspecified, false)
      then p_check_out_date::timestamp at time zone 'Asia/Seoul'
    else (p_check_out_date::timestamp + p_check_out_time)
      at time zone 'Asia/Seoul'
  end;
  capacity_from := case
    when coalesce(p_check_in_time_unspecified, false)
      then p_check_in_date::timestamp at time zone 'Asia/Seoul'
    else check_in_schedule_at
  end;
  capacity_until := case
    when coalesce(p_check_out_time_unspecified, false)
      then (p_check_out_date + 1)::timestamp at time zone 'Asia/Seoul'
    else check_out_schedule_at
  end;
  if capacity_until <= capacity_from then
    raise exception '퇴실 Capacity 종료는 입실 Capacity 시작보다 늦어야 합니다.'
      using errcode = '22023';
  end if;
  -- create_operation_schedule은 time_unspecified=true일 때 KST 날짜 범위를
  -- 기술적 저장 범위(다음 날 00:00)로 정규화하므로 Replay도 저장값을 비교한다.
  expected_check_in_ends_at := case
    when coalesce(p_check_in_time_unspecified, false)
      then check_in_schedule_at + interval '1 day'
    else check_in_schedule_at + interval '1 hour'
  end;
  expected_check_out_ends_at := case
    when coalesce(p_check_out_time_unspecified, false)
      then check_out_schedule_at + interval '1 day'
    else check_out_schedule_at + interval '1 hour'
  end;

  perform pg_advisory_xact_lock(
    hashtextextended('hotel-request:' || p_request_id::text, 0)
  );
  select stay.*
  into existing_stay
  from public.hotel_stays stay
  where stay.request_id = p_request_id;
  if existing_stay.id is not null then
    stay_id := existing_stay.id;
    select count(*)::integer
    into active_capacity_count
    from public.hotel_capacity_reservations capacity
    where capacity.hotel_stay_id = stay_id
      and capacity.archived_at is null;
    select capacity.*
    into existing_capacity
    from public.hotel_capacity_reservations capacity
    where capacity.hotel_stay_id = stay_id
      and capacity.archived_at is null;
    select
      count(*)::integer,
      count(*) filter (where event.event_kind = 'check_in')::integer,
      count(*) filter (where event.event_kind = 'check_out')::integer
    into active_event_count, check_in_event_count, check_out_event_count
    from public.hotel_stay_schedule_events event
    where event.hotel_stay_id = stay_id
      and event.archived_at is null;
    select schedule.*
    into replay_check_in_schedule
    from public.hotel_stay_schedule_events event
    join public.operation_schedules schedule
      on schedule.id = event.operation_schedule_id
    where event.hotel_stay_id = stay_id
      and event.event_kind = 'check_in'
      and event.archived_at is null;
    select schedule.*
    into replay_check_out_schedule
    from public.hotel_stay_schedule_events event
    join public.operation_schedules schedule
      on schedule.id = event.operation_schedule_id
    where event.hotel_stay_id = stay_id
      and event.event_kind = 'check_out'
      and event.archived_at is null;

    if existing_stay.archived_at is not null
      or existing_stay.dog_id is distinct from p_dog_id
      or active_capacity_count <> 1
      or existing_capacity.id is null
      or existing_capacity.room_type_id is distinct from p_room_type_id
      or existing_capacity.reserved_from is distinct from capacity_from
      or existing_capacity.reserved_until is distinct from capacity_until
      or active_event_count <> 2
      or check_in_event_count <> 1
      or check_out_event_count <> 1
      or replay_check_in_schedule.id is null
      or replay_check_out_schedule.id is null
      or replay_check_in_schedule.archived_at is not null
      or replay_check_out_schedule.archived_at is not null
      or replay_check_in_schedule.calendar_id is distinct from p_calendar_id
      or replay_check_out_schedule.calendar_id is distinct from p_calendar_id
      or replay_check_in_schedule.schedule_type_id is distinct from p_schedule_type_id
      or replay_check_out_schedule.schedule_type_id is distinct from p_schedule_type_id
      or replay_check_in_schedule.title is distinct from
        format('%s · 호텔링 · %s · 입실', dog_name, room_type_code)
      or replay_check_out_schedule.title is distinct from
        format('%s · 호텔링 · %s · 퇴실', dog_name, room_type_code)
      or replay_check_in_schedule.time_unspecified
        is distinct from coalesce(p_check_in_time_unspecified, false)
      or replay_check_out_schedule.time_unspecified
        is distinct from coalesce(p_check_out_time_unspecified, false)
      or replay_check_in_schedule.starts_at is distinct from check_in_schedule_at
      or replay_check_out_schedule.starts_at is distinct from check_out_schedule_at
      or replay_check_in_schedule.ends_at is distinct from expected_check_in_ends_at
      or replay_check_out_schedule.ends_at is distinct from expected_check_out_ends_at
      or replay_check_in_schedule.description
        is distinct from nullif(btrim(p_memo), '')
      or replay_check_out_schedule.description
        is distinct from nullif(btrim(p_memo), '')
      or (
        select coalesce(array_agg(distinct assignee.profile_id order by assignee.profile_id), '{}'::uuid[])
        from public.operation_schedule_assignees assignee
        where assignee.schedule_id = replay_check_in_schedule.id
          and assignee.archived_at is null
      ) <> (
        select coalesce(array_agg(distinct requested_id order by requested_id), '{}'::uuid[])
        from unnest(coalesce(p_assignee_ids, '{}'::uuid[])) requested_id
      )
      or (
        select coalesce(array_agg(distinct assignee.profile_id order by assignee.profile_id), '{}'::uuid[])
        from public.operation_schedule_assignees assignee
        where assignee.schedule_id = replay_check_out_schedule.id
          and assignee.archived_at is null
      ) <> (
        select coalesce(array_agg(distinct requested_id order by requested_id), '{}'::uuid[])
        from unnest(coalesce(p_assignee_ids, '{}'::uuid[])) requested_id
      )
      or (
        select coalesce(array_agg(distinct customer_link.customer_id order by customer_link.customer_id), '{}'::uuid[])
        from public.operation_schedule_customers customer_link
        where customer_link.schedule_id = replay_check_in_schedule.id
          and customer_link.archived_at is null
      ) <> array[p_customer_id]
      or (
        select coalesce(array_agg(distinct customer_link.customer_id order by customer_link.customer_id), '{}'::uuid[])
        from public.operation_schedule_customers customer_link
        where customer_link.schedule_id = replay_check_out_schedule.id
          and customer_link.archived_at is null
      ) <> array[p_customer_id]
      or (
        select coalesce(array_agg(distinct dog_link.dog_id order by dog_link.dog_id), '{}'::uuid[])
        from public.operation_schedule_dogs dog_link
        where dog_link.schedule_id = replay_check_in_schedule.id
          and dog_link.archived_at is null
      ) <> array[p_dog_id]
      or (
        select coalesce(array_agg(distinct dog_link.dog_id order by dog_link.dog_id), '{}'::uuid[])
        from public.operation_schedule_dogs dog_link
        where dog_link.schedule_id = replay_check_out_schedule.id
          and dog_link.archived_at is null
      ) <> array[p_dog_id] then
      raise exception '동일 request_id의 입력 계약이 일치하지 않습니다.'
        using errcode = '23505';
    end if;
    return public.hotel_stay_json(stay_id);
  end if;

  -- 확정 예약은 유형 Lock을 먼저 잡는다. 전체 Lock은 Capacity INSERT
  -- Trigger가 마지막에 잡으며, 객실 유형 미정은 Trigger의 전체 Lock만 사용한다.
  if p_room_type_id is not null then
    perform public.assert_hotel_capacity_available(
      p_room_type_id, capacity_from, capacity_until, 1, null
    );
  end if;

  check_in_title := format(
    '%s · 호텔링 · %s · 입실', dog_name, room_type_code
  );
  check_out_title := format(
    '%s · 호텔링 · %s · 퇴실', dog_name, room_type_code
  );

  check_in_schedule := public.create_operation_schedule(
    p_calendar_id,
    p_schedule_type_id,
    check_in_title,
    check_in_schedule_at,
    check_in_schedule_at + interval '1 hour',
    false,
    coalesce(p_check_in_time_unspecified, false),
    p_memo,
    p_assignee_ids,
    array[p_customer_id],
    array[p_dog_id],
    gen_random_uuid()
  );
  check_out_schedule := public.create_operation_schedule(
    p_calendar_id,
    p_schedule_type_id,
    check_out_title,
    check_out_schedule_at,
    check_out_schedule_at + interval '1 hour',
    false,
    coalesce(p_check_out_time_unspecified, false),
    p_memo,
    p_assignee_ids,
    array[p_customer_id],
    array[p_dog_id],
    gen_random_uuid()
  );

  perform set_config('app.operation_change_reason', '유연 호텔 예약 등록', true);
  perform set_config('app.operation_request_id', p_request_id::text, true);

  insert into public.hotel_stays (
    dog_id, request_id, created_by, updated_by
  ) values (
    p_dog_id, p_request_id, actor_id, actor_id
  ) returning id into stay_id;

  insert into public.hotel_stay_schedule_events (
    hotel_stay_id, operation_schedule_id, event_kind, created_by, updated_by
  ) values
    (stay_id, (check_in_schedule ->> 'id')::uuid, 'check_in', actor_id, actor_id),
    (stay_id, (check_out_schedule ->> 'id')::uuid, 'check_out', actor_id, actor_id);

  insert into public.hotel_capacity_reservations (
    source_kind, hotel_stay_id, room_type_id, reserved_from, reserved_until,
    quantity, created_by, updated_by
  ) values (
    'stay', stay_id, p_room_type_id, capacity_from, capacity_until,
    1, actor_id, actor_id
  );

  return public.hotel_stay_json(stay_id);
end;
$$;

create function public.update_flexible_hotel_reservation(
  p_hotel_stay_id uuid,
  p_expected_version integer,
  p_calendar_id uuid,
  p_schedule_type_id uuid,
  p_check_in_date date,
  p_check_in_time time,
  p_check_in_time_unspecified boolean,
  p_check_out_date date,
  p_check_out_time time,
  p_check_out_time_unspecified boolean,
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
  check_in_schedule_at timestamptz;
  check_out_schedule_at timestamptz;
  capacity_from timestamptz;
  capacity_until timestamptz;
  room_type_code text;
  dog_name text;
begin
  if actor_id is null or not public.is_active_operation_member() then
    raise exception '호텔 예약 수정 권한이 없습니다.' using errcode = '42501';
  end if;
  if p_request_id is null or p_expected_version is null
    or p_check_in_date is null or p_check_out_date is null then
    raise exception '요청 ID, 기존 버전, 입실일, 퇴실일이 필요합니다.'
      using errcode = '22023';
  end if;
  if p_check_out_date < p_check_in_date then
    raise exception '퇴실 날짜는 입실 날짜보다 빠를 수 없습니다.'
      using errcode = '22023';
  end if;
  if p_check_out_date = p_check_in_date
    and not coalesce(p_check_in_time_unspecified, false)
    and not coalesce(p_check_out_time_unspecified, false)
    and p_check_out_time <= p_check_in_time then
    raise exception '같은 날 예약의 퇴실 시간은 입실 시간보다 늦어야 합니다.'
      using errcode = '22023';
  end if;
  if not coalesce(p_check_in_time_unspecified, false)
    and p_check_in_time is null then
    raise exception '입실 시간이 확정된 경우 입실 시간이 필요합니다.'
      using errcode = '22023';
  end if;
  if not coalesce(p_check_out_time_unspecified, false)
    and p_check_out_time is null then
    raise exception '퇴실 시간이 확정된 경우 퇴실 시간이 필요합니다.'
      using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.operation_calendars calendar
    join public.business_units unit on unit.id = calendar.business_unit_id
    join public.operation_schedule_types schedule_type
      on schedule_type.id = p_schedule_type_id
    join public.operation_calendar_schedule_types mapping
      on mapping.calendar_id = calendar.id
     and mapping.schedule_type_id = p_schedule_type_id
    where calendar.id = p_calendar_id
      and calendar.is_active
      and (to_jsonb(calendar) ->> 'archived_at') is null
      and unit.code = 'hotel'
      and unit.is_active
      and (to_jsonb(unit) ->> 'archived_at') is null
      and schedule_type.is_active
      and (to_jsonb(schedule_type) ->> 'archived_at') is null
      and mapping.is_active
      and mapping.archived_at is null
  ) then
    raise exception '활성 호텔 캘린더와 일정 유형을 확인해 주세요.'
      using errcode = '22023';
  end if;

  -- time_unspecified=true이면 전달된 시간값과 무관하게 KST 00:00으로 정규화한다.
  check_in_schedule_at := case
    when coalesce(p_check_in_time_unspecified, false)
      then p_check_in_date::timestamp at time zone 'Asia/Seoul'
    else (p_check_in_date::timestamp + p_check_in_time)
      at time zone 'Asia/Seoul'
  end;
  check_out_schedule_at := case
    when coalesce(p_check_out_time_unspecified, false)
      then p_check_out_date::timestamp at time zone 'Asia/Seoul'
    else (p_check_out_date::timestamp + p_check_out_time)
      at time zone 'Asia/Seoul'
  end;
  capacity_from := case
    when coalesce(p_check_in_time_unspecified, false)
      then p_check_in_date::timestamp at time zone 'Asia/Seoul'
    else check_in_schedule_at
  end;
  capacity_until := case
    when coalesce(p_check_out_time_unspecified, false)
      then (p_check_out_date + 1)::timestamp at time zone 'Asia/Seoul'
    else check_out_schedule_at
  end;
  if capacity_until <= capacity_from then
    raise exception '퇴실 Capacity 종료는 입실 Capacity 시작보다 늦어야 합니다.'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('hotel-request:' || p_request_id::text, 0)
  );
  if public.is_replayed_hotel_stay_request(p_hotel_stay_id, p_request_id) then
    return public.hotel_stay_json(p_hotel_stay_id);
  end if;

  select stay.* into stay_row
  from public.hotel_stays stay
  where stay.id = p_hotel_stay_id
  for update;
  if not found or stay_row.archived_at is not null then
    raise exception '수정할 호텔 예약을 확인할 수 없습니다.'
      using errcode = 'P0002';
  end if;
  if stay_row.version <> p_expected_version then
    raise exception '다른 사용자가 먼저 호텔 예약을 수정했습니다.'
      using errcode = '40001';
  end if;
  if stay_row.checked_in_at is not null then
    raise exception '입실 완료 후에는 예약 정보를 변경할 수 없습니다.'
      using errcode = '22023';
  end if;

  select capacity.* into capacity_row
  from public.hotel_capacity_reservations capacity
  where capacity.hotel_stay_id = p_hotel_stay_id
    and capacity.archived_at is null
  for update;
  select schedule.* into check_in_schedule
  from public.hotel_stay_schedule_events event
  join public.operation_schedules schedule
    on schedule.id = event.operation_schedule_id
  where event.hotel_stay_id = p_hotel_stay_id
    and event.event_kind = 'check_in'
    and event.archived_at is null
  for update of schedule;
  select schedule.* into check_out_schedule
  from public.hotel_stay_schedule_events event
  join public.operation_schedules schedule
    on schedule.id = event.operation_schedule_id
  where event.hotel_stay_id = p_hotel_stay_id
    and event.event_kind = 'check_out'
    and event.archived_at is null
  for update of schedule;
  if capacity_row.id is null
    or check_in_schedule.id is null
    or check_out_schedule.id is null then
    raise exception '호텔 예약 연결 구조가 완전하지 않습니다.'
      using errcode = 'P0002';
  end if;
  if not public.can_manage_operation_schedule(check_in_schedule.id)
    or not public.can_manage_operation_schedule(check_out_schedule.id) then
    raise exception '호텔 예약 생성자 또는 담당자만 수정할 수 있습니다.'
      using errcode = '42501';
  end if;

  select dog.name into dog_name
  from public.dogs dog
  join public.customers customer on customer.id = p_customer_id
  where dog.id = p_dog_id and dog.is_active
    and customer.is_active and dog.customer_id = customer.id;
  if dog_name is null then
    raise exception '반려견과 연결 보호자 정보를 확인해 주세요.'
      using errcode = '22023';
  end if;
  if p_room_type_id is not null then
    select room_type.code into room_type_code
    from public.hotel_room_types room_type
    where room_type.id = p_room_type_id
      and room_type.is_active and room_type.archived_at is null;
    if room_type_code is null then
      raise exception '활성 객실 유형을 확인할 수 없습니다.'
        using errcode = 'P0002';
    end if;
  else
    room_type_code := '객실 미정';
  end if;

  select count(*)::integer into allocation_count
  from public.hotel_room_allocations allocation
  where allocation.capacity_reservation_id = capacity_row.id
    and allocation.archived_at is null;
  if allocation_count > 1 then
    raise exception '객실 이동 이력이 있는 Stay는 예약 정보를 수정할 수 없습니다.'
      using errcode = '22023';
  end if;
  if allocation_count = 1 then
    select allocation.* into allocation_row
    from public.hotel_room_allocations allocation
    where allocation.capacity_reservation_id = capacity_row.id
      and allocation.archived_at is null
    for update;
  end if;

  -- 글로벌 Advisory Lock 순서: 객실 유형 -> 호실 -> 전체 Capacity.
  -- 전체 Lock은 Capacity UPDATE Trigger가 마지막에 잡는다.
  if p_room_type_id is not null then
    perform public.assert_hotel_capacity_available(
      p_room_type_id, capacity_from, capacity_until, 1, capacity_row.id
    );
  end if;
  if allocation_count = 1 then
    perform pg_advisory_xact_lock(
      hashtextextended('hotel-room:' || allocation_row.room_id::text, 0)
    );
    if p_room_type_id is null
      or allocation_row.room_id not in (
        select room.id from public.hotel_rooms room
        where room.room_type_id = p_room_type_id
          and room.is_active and room.archived_at is null
      ) then
      null;
    elsif exists (
      select 1 from public.hotel_room_allocations other_allocation
      where other_allocation.room_id = allocation_row.room_id
        and other_allocation.archived_at is null
        and other_allocation.id <> allocation_row.id
        and other_allocation.allocated_from < capacity_until
        and other_allocation.allocated_until > capacity_from
    ) then
      raise exception '변경한 예약 기간에 사전 배정 호실 충돌이 있습니다.'
        using errcode = '23P01';
    end if;
  end if;

  perform public.update_operation_schedule(
    check_in_schedule.id,
    check_in_schedule.version,
    p_calendar_id,
    p_schedule_type_id,
    format('%s · 호텔링 · %s · 입실', dog_name, room_type_code),
    check_in_schedule_at,
    check_in_schedule_at + interval '1 hour',
    false,
    coalesce(p_check_in_time_unspecified, false),
    p_memo,
    p_assignee_ids,
    array[p_customer_id],
    array[p_dog_id],
    gen_random_uuid()
  );
  perform public.update_operation_schedule(
    check_out_schedule.id,
    check_out_schedule.version,
    p_calendar_id,
    p_schedule_type_id,
    format('%s · 호텔링 · %s · 퇴실', dog_name, room_type_code),
    check_out_schedule_at,
    check_out_schedule_at + interval '1 hour',
    false,
    coalesce(p_check_out_time_unspecified, false),
    p_memo,
    p_assignee_ids,
    array[p_customer_id],
    array[p_dog_id],
    gen_random_uuid()
  );

  perform set_config('app.operation_change_reason', '유연 호텔 예약 수정', true);
  perform set_config('app.operation_request_id', '', true);
  if allocation_count = 1 then
    if p_room_type_id is null
      or capacity_row.room_type_id is distinct from p_room_type_id then
      update public.hotel_room_allocations allocation
      set archived_at = now(), archived_by = actor_id,
          archive_reason = '예약 객실 유형 변경으로 호실 배정 해제',
          updated_by = actor_id
      where allocation.id = allocation_row.id;
    else
      update public.hotel_room_allocations allocation
      set allocated_from = capacity_from,
          allocated_until = capacity_until,
          updated_by = actor_id
      where allocation.id = allocation_row.id;
    end if;
  end if;
  update public.hotel_capacity_reservations capacity
  set room_type_id = p_room_type_id,
      reserved_from = capacity_from,
      reserved_until = capacity_until,
      updated_by = actor_id
  where capacity.id = capacity_row.id;

  perform set_config('app.operation_request_id', p_request_id::text, true);
  update public.hotel_stays stay
  set dog_id = p_dog_id, updated_by = actor_id
  where stay.id = p_hotel_stay_id;

  return public.hotel_stay_json(p_hotel_stay_id);
end;
$$;

create function public.finalize_and_complete_hotel_check_in(
  p_hotel_stay_id uuid,
  p_expected_version integer,
  p_completed_at timestamptz,
  p_room_type_id uuid,
  p_room_id uuid,
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
  current_allocation public.hotel_room_allocations%rowtype;
  allocation_count integer;
  dog_name text;
  room_type_code text;
begin
  if actor_id is null or not public.is_active_operation_member() then
    raise exception '입실 완료 권한이 없습니다.' using errcode = '42501';
  end if;
  if p_request_id is null or p_expected_version is null
    or p_completed_at is null or p_room_type_id is null or p_room_id is null then
    raise exception '입실 시간, 객실 유형, 호실, 요청 ID가 필요합니다.'
      using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended('hotel-request:' || p_request_id::text, 0)
  );
  if public.is_replayed_hotel_stay_request(p_hotel_stay_id, p_request_id) then
    return public.hotel_stay_json(p_hotel_stay_id);
  end if;

  select stay.* into stay_row
  from public.hotel_stays stay
  where stay.id = p_hotel_stay_id for update;
  if not found or stay_row.archived_at is not null then
    raise exception '활성 호텔 예약을 확인할 수 없습니다.' using errcode = 'P0002';
  end if;
  if stay_row.version <> p_expected_version then
    raise exception '다른 사용자가 먼저 처리했습니다.' using errcode = '40001';
  end if;
  if stay_row.checked_in_at is not null then
    return public.hotel_stay_json(p_hotel_stay_id);
  end if;

  select capacity.* into capacity_row
  from public.hotel_capacity_reservations capacity
  where capacity.hotel_stay_id = p_hotel_stay_id
    and capacity.archived_at is null
  for update;
  select schedule.* into check_in_schedule
  from public.hotel_stay_schedule_events event
  join public.operation_schedules schedule
    on schedule.id = event.operation_schedule_id
  where event.hotel_stay_id = p_hotel_stay_id
    and event.event_kind = 'check_in'
    and event.archived_at is null
  for update of schedule;
  select schedule.* into check_out_schedule
  from public.hotel_stay_schedule_events event
  join public.operation_schedules schedule
    on schedule.id = event.operation_schedule_id
  where event.hotel_stay_id = p_hotel_stay_id
    and event.event_kind = 'check_out'
    and event.archived_at is null
  for update of schedule;
  if capacity_row.id is null
    or check_in_schedule.id is null
    or check_out_schedule.id is null then
    raise exception '호텔 예약 연결 구조가 완전하지 않습니다.' using errcode = 'P0002';
  end if;
  if (p_completed_at at time zone 'Asia/Seoul')::date
    <> (check_in_schedule.starts_at at time zone 'Asia/Seoul')::date then
    raise exception '입실 완료 시각은 기존 입실 예약일 내에서만 확정할 수 있습니다.'
      using errcode = '22023';
  end if;
  if not public.can_manage_operation_schedule(check_in_schedule.id) then
    raise exception '입실 Calendar 일정을 수정할 권한이 없습니다.'
      using errcode = '42501';
  end if;
  if p_completed_at >= capacity_row.reserved_until then
    raise exception '입실 완료 시각은 현재 퇴실 Capacity 종료보다 빨라야 합니다.'
      using errcode = '22023';
  end if;

  select room_type.code into room_type_code
  from public.hotel_room_types room_type
  where room_type.id = p_room_type_id
    and room_type.is_active and room_type.archived_at is null;
  select dog.name into dog_name from public.dogs dog where dog.id = stay_row.dog_id;
  if room_type_code is null or dog_name is null then
    raise exception '활성 객실 유형 또는 반려견을 확인할 수 없습니다.'
      using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from public.hotel_rooms room
    where room.id = p_room_id
      and room.room_type_id = p_room_type_id
      and room.is_active and room.archived_at is null
  ) then
    raise exception '선택한 객실 유형에 속한 활성 호실이 아닙니다.'
      using errcode = '22023';
  end if;
  select count(*)::integer into allocation_count
  from public.hotel_room_allocations allocation
  where allocation.capacity_reservation_id = capacity_row.id
    and allocation.archived_at is null;
  if allocation_count > 1 then
    raise exception '입실 전 활성 호실 배정은 최대 1건이어야 합니다.'
      using errcode = '22023';
  end if;
  if allocation_count = 1 then
    select allocation.* into current_allocation
    from public.hotel_room_allocations allocation
    where allocation.capacity_reservation_id = capacity_row.id
      and allocation.archived_at is null
    for update;
  end if;

  -- 글로벌 Advisory Lock 순서: 객실 유형 -> 호실 -> 전체 Capacity.
  perform public.assert_hotel_capacity_available(
    p_room_type_id,
    p_completed_at,
    capacity_row.reserved_until,
    1,
    capacity_row.id
  );
  perform pg_advisory_xact_lock(
    hashtextextended('hotel-room:' || p_room_id::text, 0)
  );

  perform set_config('app.operation_change_reason', '입실 시 미정 예약 확정', true);
  perform set_config('app.operation_request_id', '', true);
  update public.hotel_capacity_reservations capacity
  set room_type_id = p_room_type_id,
      reserved_from = p_completed_at,
      updated_by = actor_id
  where capacity.id = capacity_row.id;

  if allocation_count = 1 and current_allocation.room_id <> p_room_id then
    update public.hotel_room_allocations allocation
    set archived_at = now(), archived_by = actor_id,
        archive_reason = '입실 완료 시 호실 확정 변경',
        updated_by = actor_id
    where allocation.id = current_allocation.id;
    allocation_count := 0;
  end if;

  perform public.assert_hotel_room_allocation_available(
    p_room_id,
    capacity_row.id,
    p_completed_at,
    capacity_row.reserved_until,
    case when allocation_count = 1 then current_allocation.id else null end
  );
  if allocation_count = 1 then
    update public.hotel_room_allocations allocation
    set allocated_from = p_completed_at,
        allocated_until = capacity_row.reserved_until,
        updated_by = actor_id
    where allocation.id = current_allocation.id;
  else
    insert into public.hotel_room_allocations (
      capacity_reservation_id, room_id, allocated_from, allocated_until,
      assignment_reason, request_id, created_by, updated_by
    ) values (
      capacity_row.id, p_room_id, p_completed_at, capacity_row.reserved_until,
      '입실 완료 시 호실 확정', null, actor_id, actor_id
    );
  end if;

  perform set_config('app.operation_request_id', gen_random_uuid()::text, true);
  update public.operation_schedules schedule
  set starts_at = p_completed_at,
      ends_at = p_completed_at + interval '1 hour',
      time_unspecified = false,
      title = format('%s · 호텔링 · %s · 입실', dog_name, room_type_code),
      updated_by = actor_id
  where schedule.id = check_in_schedule.id;
  perform set_config('app.operation_request_id', gen_random_uuid()::text, true);
  update public.operation_schedules schedule
  set title = format('%s · 호텔링 · %s · 퇴실', dog_name, room_type_code),
      updated_by = actor_id
  where schedule.id = check_out_schedule.id;

  perform set_config('app.operation_request_id', p_request_id::text, true);
  update public.hotel_stays stay
  set checked_in_at = p_completed_at,
      checked_in_by = actor_id,
      updated_by = actor_id
  where stay.id = p_hotel_stay_id;

  return public.hotel_stay_json(p_hotel_stay_id);
end;
$$;

create function public.finalize_and_complete_hotel_check_out(
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
  check_out_schedule public.operation_schedules%rowtype;
  final_allocation public.hotel_room_allocations%rowtype;
begin
  if actor_id is null or not public.is_active_operation_member() then
    raise exception '퇴실 완료 권한이 없습니다.' using errcode = '42501';
  end if;
  if p_request_id is null or p_expected_version is null
    or p_completed_at is null then
    raise exception '퇴실 시간, 기존 버전, 요청 ID가 필요합니다.'
      using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended('hotel-request:' || p_request_id::text, 0)
  );
  if public.is_replayed_hotel_stay_request(p_hotel_stay_id, p_request_id) then
    return public.hotel_stay_json(p_hotel_stay_id);
  end if;

  select stay.* into stay_row
  from public.hotel_stays stay
  where stay.id = p_hotel_stay_id for update;
  if not found or stay_row.archived_at is not null then
    raise exception '활성 호텔 예약을 확인할 수 없습니다.' using errcode = 'P0002';
  end if;
  if stay_row.version <> p_expected_version then
    raise exception '다른 사용자가 먼저 처리했습니다.' using errcode = '40001';
  end if;
  if stay_row.checked_in_at is null then
    raise exception '입실 완료 후 퇴실 처리할 수 있습니다.' using errcode = '22023';
  end if;
  if stay_row.checked_out_at is not null then
    return public.hotel_stay_json(p_hotel_stay_id);
  end if;
  if p_completed_at <= stay_row.checked_in_at then
    raise exception '퇴실 완료 시각은 입실 완료 시각보다 늦어야 합니다.'
      using errcode = '22023';
  end if;

  select capacity.* into capacity_row
  from public.hotel_capacity_reservations capacity
  where capacity.hotel_stay_id = p_hotel_stay_id
    and capacity.archived_at is null
  for update;
  select schedule.* into check_out_schedule
  from public.hotel_stay_schedule_events event
  join public.operation_schedules schedule
    on schedule.id = event.operation_schedule_id
  where event.hotel_stay_id = p_hotel_stay_id
    and event.event_kind = 'check_out'
    and event.archived_at is null
  for update of schedule;
  select allocation.* into final_allocation
  from public.hotel_room_allocations allocation
  where allocation.capacity_reservation_id = capacity_row.id
    and allocation.archived_at is null
  order by allocation.allocated_until desc, allocation.allocated_from desc
  limit 1
  for update;
  if capacity_row.id is null or capacity_row.room_type_id is null
    or check_out_schedule.id is null or final_allocation.id is null then
    raise exception '퇴실 완료에 필요한 Capacity, 객실 유형, 일정, 호실을 확인할 수 없습니다.'
      using errcode = 'P0002';
  end if;
  if not check_out_schedule.time_unspecified then
    raise exception '퇴실 시간이 이미 확정된 예약은 기존 퇴실 완료 기능을 사용해 주세요.'
      using errcode = '22023';
  end if;
  if (p_completed_at at time zone 'Asia/Seoul')::date
    <> (check_out_schedule.starts_at at time zone 'Asia/Seoul')::date then
    raise exception '퇴실 완료 시각은 기존 퇴실 예약일 내에서만 확정할 수 있습니다.'
      using errcode = '22023';
  end if;
  if not public.can_manage_operation_schedule(check_out_schedule.id) then
    raise exception '퇴실 Calendar 일정을 수정할 권한이 없습니다.'
      using errcode = '42501';
  end if;
  if p_completed_at <= final_allocation.allocated_from then
    raise exception '퇴실 완료 시각은 최종 호실 배정 시작보다 늦어야 합니다.'
      using errcode = '22023';
  end if;

  -- 유형 Lock을 먼저 잡고 전체 Lock은 Capacity UPDATE Trigger가 마지막에 잡는다.
  perform public.assert_hotel_capacity_available(
    capacity_row.room_type_id,
    capacity_row.reserved_from,
    p_completed_at,
    capacity_row.quantity,
    capacity_row.id
  );
  perform pg_advisory_xact_lock(
    hashtextextended('hotel-room:' || final_allocation.room_id::text, 0)
  );
  if exists (
    select 1 from public.hotel_room_allocations other_allocation
    where other_allocation.room_id = final_allocation.room_id
      and other_allocation.archived_at is null
      and other_allocation.id <> final_allocation.id
      and other_allocation.allocated_from < p_completed_at
      and other_allocation.allocated_until > final_allocation.allocated_from
  ) then
    raise exception '실제 퇴실 시각까지 최종 호실을 사용할 수 없습니다.'
      using errcode = '23P01';
  end if;

  perform set_config('app.operation_change_reason', '퇴실 시간 확정 및 완료', true);
  perform set_config('app.operation_request_id', '', true);
  update public.hotel_capacity_reservations capacity
  set reserved_until = p_completed_at, updated_by = actor_id
  where capacity.id = capacity_row.id;
  update public.hotel_room_allocations allocation
  set allocated_until = p_completed_at, updated_by = actor_id
  where allocation.id = final_allocation.id;

  perform set_config('app.operation_request_id', gen_random_uuid()::text, true);
  update public.operation_schedules schedule
  set starts_at = p_completed_at,
      ends_at = p_completed_at + interval '1 hour',
      time_unspecified = false,
      updated_by = actor_id
  where schedule.id = check_out_schedule.id;

  perform set_config('app.operation_request_id', p_request_id::text, true);
  update public.hotel_stays stay
  set checked_out_at = p_completed_at,
      checked_out_by = actor_id,
      checkout_previous_reserved_until = capacity_row.reserved_until,
      checkout_previous_allocation_id = final_allocation.id,
      checkout_previous_allocation_until = final_allocation.allocated_until,
      updated_by = actor_id
  where stay.id = p_hotel_stay_id;

  return public.hotel_stay_json(p_hotel_stay_id);
end;
$$;

create function public.get_hotel_operations_snapshot_v2(
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
  );
end;
$$;

revoke all on function public.assert_hotel_total_capacity_available(
  timestamptz, timestamptz, integer, uuid
) from public, anon, authenticated;
revoke all on function public.enforce_hotel_total_capacity()
  from public, anon, authenticated;
revoke all on function public.enforce_hotel_allocation_room_type()
  from public, anon, authenticated;

revoke all on function public.create_flexible_hotel_reservation(
  uuid, uuid, date, time, boolean, date, time, boolean,
  uuid, uuid, uuid, uuid[], text, uuid
) from public, anon;
grant execute on function public.create_flexible_hotel_reservation(
  uuid, uuid, date, time, boolean, date, time, boolean,
  uuid, uuid, uuid, uuid[], text, uuid
) to authenticated;

revoke all on function public.update_flexible_hotel_reservation(
  uuid, integer, uuid, uuid, date, time, boolean, date, time,
  boolean, uuid, uuid, uuid, uuid[], text, uuid
) from public, anon;
grant execute on function public.update_flexible_hotel_reservation(
  uuid, integer, uuid, uuid, date, time, boolean, date, time,
  boolean, uuid, uuid, uuid, uuid[], text, uuid
) to authenticated;

revoke all on function public.finalize_and_complete_hotel_check_in(
  uuid, integer, timestamptz, uuid, uuid, uuid
) from public, anon;
grant execute on function public.finalize_and_complete_hotel_check_in(
  uuid, integer, timestamptz, uuid, uuid, uuid
) to authenticated;

revoke all on function public.finalize_and_complete_hotel_check_out(
  uuid, integer, timestamptz, uuid
) from public, anon;
grant execute on function public.finalize_and_complete_hotel_check_out(
  uuid, integer, timestamptz, uuid
) to authenticated;

revoke all on function public.get_hotel_operations_snapshot_v2(date)
  from public, anon;
grant execute on function public.get_hotel_operations_snapshot_v2(date)
  to authenticated;

commit;
