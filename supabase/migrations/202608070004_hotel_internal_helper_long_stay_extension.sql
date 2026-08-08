-- Hotel Internal Helper Long Stay Extension (append-only helper surface).
--
-- This migration does not create Long Stay runtime objects. It preserves every
-- public Hotel RPC definition and moves the three existing internal helper
-- bodies behind extended postgres-only helpers. Existing helper signatures are
-- retained as compatibility wrappers with the exact ordinary-Hotel defaults.

begin;

do $$
declare
  contract_ready boolean;
begin
  select bool_and(
    procedure_row.oid is not null
    and md5(procedure_row.prosrc) = expected.body_fingerprint
    and md5(pg_get_functiondef(procedure_row.oid)) = expected.definition_fingerprint
    and pg_get_userbyid(procedure_row.proowner) = 'postgres'
    and procedure_row.prosecdef
    and procedure_row.provolatile = expected.expected_volatility
    and pg_get_function_result(procedure_row.oid) = expected.expected_return_type
    and 'search_path=public, pg_temp' = any(procedure_row.proconfig)
    and coalesce(array(
      select distinct pg_get_userbyid(entry.grantee)::text
      from aclexplode(coalesce(
        procedure_row.proacl, acldefault('f', procedure_row.proowner)
      )) entry
      where entry.privilege_type = 'EXECUTE'
      order by 1
    ), '{}'::text[]) = expected.expected_acl
  )
  into contract_ready
  from (values
    ('public.create_flexible_hotel_reservation(uuid,uuid,date,time without time zone,boolean,date,time without time zone,boolean,uuid,uuid,uuid,uuid[],text,uuid)', 'cca668cd6142942eb9af87dcfada05d8', '04cac0ee426974d370d97195436c6efc', 'v', 'jsonb', array['authenticated','postgres','service_role']::text[]),
    ('public.change_room_type_before_check_in(uuid,integer,uuid,text,uuid)', 'e18904d6698133d3b735af55d3e2209f', '7dbc179de63f3174ad90d46658404390', 'v', 'jsonb', array['authenticated','postgres','service_role']::text[]),
    ('public.change_room_type_after_check_in(uuid,integer,uuid,timestamp with time zone,text,uuid)', '34804fd6ef82d8ac99cd042816d3e93b', '6c80e5e91a89c8efcee9dc8ae3711369', 'v', 'jsonb', array['authenticated','postgres','service_role']::text[]),
    ('public.prepare_hotel_reservation_runtime_input_internal(uuid,uuid,date,time without time zone,boolean,date,time without time zone,boolean,uuid,uuid,uuid,uuid[],text)', '471673afbfe5dfff9fcac28356b07603', '5298a977437eba4c8c8de5645899ef49', 'v', 'jsonb', array['postgres']::text[]),
    ('public.create_hotel_reservation_runtime_internal(uuid,uuid,uuid,uuid,uuid[],text,uuid,uuid,uuid,uuid,jsonb)', '48d9146603c1462a02cb8df65458cc8f', '7ad67c55f8fde942219be2bc16c86a71', 'v', 'jsonb', array['postgres']::text[]),
    ('public.change_hotel_room_type_and_allocation_internal(text,uuid,integer,uuid,uuid,text,text,timestamp with time zone,text,text,uuid,uuid)', '2a344bee4a21279f1d6a4a7c4dac1445', 'a9f0fbcb4e46bf69d2ff6a26dc26dbf0', 'v', 'jsonb', array['postgres']::text[]),
    ('public.complete_hotel_check_out(uuid,integer,timestamp with time zone,uuid)', '7744baa7276dcb70676ec593e8ddc0e6', 'd73c90ca6f9f454f5867feed5d8fe496', 'v', 'jsonb', array['authenticated','postgres','service_role']::text[]),
    ('public.reverse_hotel_completion(uuid,integer,text,text,uuid)', 'dd4dd04865adfa2dc3ec83097e2b81a3', '4029c9e292df3a690b1040cb37debf61', 'v', 'jsonb', array['authenticated','postgres','service_role']::text[]),
    ('public.get_hotel_operations_snapshot_v2(date)', '7dac53943e2f74f207de1cd36d5023fb', 'ddcbfba32525ed050124fa337127f366', 's', 'jsonb', array['authenticated','postgres','service_role']::text[])
  ) expected(
    identity, body_fingerprint, definition_fingerprint,
    expected_volatility, expected_return_type, expected_acl
  )
  left join pg_proc procedure_row
    on procedure_row.oid = to_regprocedure(expected.identity);

  if not coalesce(contract_ready, false) then
    raise exception 'STOP_HOTEL_HELPER_LONG_STAY_EXTENSION_UNEXPECTED_BASELINE';
  end if;

  if to_regprocedure('public.prepare_hotel_reservation_runtime_input_extended_internal(uuid,uuid,date,time without time zone,boolean,date,time without time zone,boolean,boolean,timestamp with time zone,uuid,uuid,uuid,uuid[],text)') is not null
    or to_regprocedure('public.create_hotel_reservation_runtime_extended_internal(uuid,uuid,uuid,uuid,uuid[],text,uuid,uuid,uuid,uuid,jsonb,boolean)') is not null
    or to_regprocedure('public.change_hotel_room_type_and_allocation_extended_internal(text,uuid,integer,uuid,uuid,text,text,timestamp with time zone,text,text,uuid,uuid,text[])') is not null then
    raise exception 'STOP_HOTEL_HELPER_LONG_STAY_EXTENSION_ALREADY_PRESENT';
  end if;
end;
$$;

create function public.prepare_hotel_reservation_runtime_input_extended_internal(
  p_calendar_id uuid,
  p_schedule_type_id uuid,
  p_check_in_date date,
  p_check_in_time time,
  p_check_in_time_unspecified boolean,
  p_check_out_date date,
  p_check_out_time time,
  p_check_out_time_unspecified boolean,
  p_include_check_out_event boolean,
  p_capacity_until_override timestamptz,
  p_room_type_id uuid,
  p_dog_id uuid,
  p_customer_id uuid,
  p_assignee_ids uuid[],
  p_memo text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  dog_name text;
  room_type_code text;
  check_in_schedule_at timestamptz;
  check_out_schedule_at timestamptz;
  capacity_from timestamptz;
  capacity_until timestamptz;
  include_check_out boolean := coalesce(p_include_check_out_event, false);
begin
  if p_check_in_date is null then
    raise exception '입실일이 필요합니다.' using errcode = '22023';
  end if;
  if include_check_out and p_check_out_date is null then
    raise exception '퇴실 Event를 포함하는 경우 퇴실일이 필요합니다.'
      using errcode = '22023';
  end if;
  if include_check_out and p_check_out_date < p_check_in_date then
    raise exception '퇴실 날짜는 입실 날짜보다 빠를 수 없습니다.'
      using errcode = '22023';
  end if;
  if include_check_out
    and p_check_out_date = p_check_in_date
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
  if include_check_out
    and not coalesce(p_check_out_time_unspecified, false)
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

  check_in_schedule_at := case
    when coalesce(p_check_in_time_unspecified, false)
      then p_check_in_date::timestamp at time zone 'Asia/Seoul'
    else (p_check_in_date::timestamp + p_check_in_time)
      at time zone 'Asia/Seoul'
  end;
  if include_check_out then
    check_out_schedule_at := case
      when coalesce(p_check_out_time_unspecified, false)
        then p_check_out_date::timestamp at time zone 'Asia/Seoul'
      else (p_check_out_date::timestamp + p_check_out_time)
        at time zone 'Asia/Seoul'
    end;
  else
    check_out_schedule_at := null;
  end if;

  capacity_from := check_in_schedule_at;
  capacity_until := coalesce(
    p_capacity_until_override,
    case
      when not include_check_out then null
      when coalesce(p_check_out_time_unspecified, false)
        then (p_check_out_date + 1)::timestamp at time zone 'Asia/Seoul'
      else check_out_schedule_at
    end
  );
  if capacity_until is null or capacity_until <= capacity_from then
    raise exception 'Capacity 종료는 입실 Capacity 시작보다 늦어야 합니다.'
      using errcode = '22023';
  end if;

  return jsonb_build_object(
    'dogName', dog_name,
    'roomTypeCode', room_type_code,
    'includeCheckOutEvent', include_check_out,
    'checkInScheduleAt', check_in_schedule_at,
    'checkOutScheduleAt', check_out_schedule_at,
    'checkInTimeUnspecified', coalesce(p_check_in_time_unspecified, false),
    'checkOutTimeUnspecified', case when include_check_out
      then coalesce(p_check_out_time_unspecified, false) else null end,
    'customerId', p_customer_id,
    'capacityFrom', capacity_from,
    'capacityUntil', capacity_until,
    'expectedCheckInEndsAt', case
      when coalesce(p_check_in_time_unspecified, false)
        then check_in_schedule_at + interval '1 day'
      else check_in_schedule_at + interval '1 hour'
    end,
    'expectedCheckOutEndsAt', case when include_check_out then
      case when coalesce(p_check_out_time_unspecified, false)
        then check_out_schedule_at + interval '1 day'
        else check_out_schedule_at + interval '1 hour'
      end
      else null end,
    'checkInTitle', format('%s · 호텔링 · %s · 입실', dog_name, room_type_code),
    'checkOutTitle', case when include_check_out
      then format('%s · 호텔링 · %s · 퇴실', dog_name, room_type_code)
      else null end,
    'normalizedMemo', nullif(btrim(p_memo), '')
  );
end;
$$;

create or replace function public.prepare_hotel_reservation_runtime_input_internal(
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
  p_memo text
)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
  select public.prepare_hotel_reservation_runtime_input_extended_internal(
    p_calendar_id, p_schedule_type_id,
    p_check_in_date, p_check_in_time, p_check_in_time_unspecified,
    p_check_out_date, p_check_out_time, p_check_out_time_unspecified,
    true, null, p_room_type_id, p_dog_id, p_customer_id,
    p_assignee_ids, p_memo
  );
$$;

create function public.create_hotel_reservation_runtime_extended_internal(
  p_calendar_id uuid,
  p_schedule_type_id uuid,
  p_dog_id uuid,
  p_room_type_id uuid,
  p_assignee_ids uuid[],
  p_memo text,
  p_actor_id uuid,
  p_request_id uuid,
  p_check_in_request_id uuid,
  p_check_out_request_id uuid,
  p_runtime_input jsonb,
  p_include_check_out_event boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  stay_id uuid;
  check_in_schedule jsonb;
  check_out_schedule jsonb;
  check_in_schedule_at timestamptz := (p_runtime_input ->> 'checkInScheduleAt')::timestamptz;
  check_out_schedule_at timestamptz;
  capacity_from timestamptz := (p_runtime_input ->> 'capacityFrom')::timestamptz;
  capacity_until timestamptz := (p_runtime_input ->> 'capacityUntil')::timestamptz;
  include_check_out boolean := coalesce(p_include_check_out_event, false);
begin
  if (p_runtime_input ->> 'includeCheckOutEvent')::boolean
      is distinct from include_check_out then
    raise exception 'Runtime input과 Event 계약이 일치하지 않습니다.'
      using errcode = '22023';
  end if;
  if include_check_out and p_check_out_request_id is null then
    raise exception '퇴실 Event 요청 ID가 필요합니다.' using errcode = '22023';
  end if;
  if not include_check_out and p_check_out_request_id is not null then
    raise exception '퇴실 Event 미포함 시 퇴실 요청 ID를 전달할 수 없습니다.'
      using errcode = '22023';
  end if;
  if p_room_type_id is not null then
    perform public.assert_hotel_capacity_available(
      p_room_type_id, capacity_from, capacity_until, 1, null
    );
  end if;

  check_in_schedule := public.create_operation_schedule(
    p_calendar_id, p_schedule_type_id,
    p_runtime_input ->> 'checkInTitle',
    check_in_schedule_at, check_in_schedule_at + interval '1 hour',
    false, (p_runtime_input ->> 'checkInTimeUnspecified')::boolean,
    p_memo, p_assignee_ids,
    array[(p_runtime_input ->> 'customerId')::uuid], array[p_dog_id],
    p_check_in_request_id
  );

  if include_check_out then
    check_out_schedule_at := (p_runtime_input ->> 'checkOutScheduleAt')::timestamptz;
    check_out_schedule := public.create_operation_schedule(
      p_calendar_id, p_schedule_type_id,
      p_runtime_input ->> 'checkOutTitle',
      check_out_schedule_at, check_out_schedule_at + interval '1 hour',
      false, (p_runtime_input ->> 'checkOutTimeUnspecified')::boolean,
      p_memo, p_assignee_ids,
      array[(p_runtime_input ->> 'customerId')::uuid], array[p_dog_id],
      p_check_out_request_id
    );
  end if;

  perform set_config('app.operation_change_reason', '유연 호텔 예약 등록', true);
  perform set_config('app.operation_request_id', p_request_id::text, true);
  insert into public.hotel_stays (dog_id, request_id, created_by, updated_by)
  values (p_dog_id, p_request_id, p_actor_id, p_actor_id)
  returning id into stay_id;

  insert into public.hotel_stay_schedule_events (
    hotel_stay_id, operation_schedule_id, event_kind, created_by, updated_by
  ) values (
    stay_id, (check_in_schedule ->> 'id')::uuid, 'check_in', p_actor_id, p_actor_id
  );
  if include_check_out then
    insert into public.hotel_stay_schedule_events (
      hotel_stay_id, operation_schedule_id, event_kind, created_by, updated_by
    ) values (
      stay_id, (check_out_schedule ->> 'id')::uuid, 'check_out', p_actor_id, p_actor_id
    );
  end if;

  insert into public.hotel_capacity_reservations (
    source_kind, hotel_stay_id, room_type_id, reserved_from, reserved_until,
    quantity, created_by, updated_by
  ) values (
    'stay', stay_id, p_room_type_id, capacity_from, capacity_until,
    1, p_actor_id, p_actor_id
  );
  return public.hotel_stay_json(stay_id);
end;
$$;

create or replace function public.create_hotel_reservation_runtime_internal(
  p_calendar_id uuid,
  p_schedule_type_id uuid,
  p_dog_id uuid,
  p_room_type_id uuid,
  p_assignee_ids uuid[],
  p_memo text,
  p_actor_id uuid,
  p_request_id uuid,
  p_check_in_request_id uuid,
  p_check_out_request_id uuid,
  p_runtime_input jsonb
)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
  select public.create_hotel_reservation_runtime_extended_internal(
    p_calendar_id, p_schedule_type_id, p_dog_id, p_room_type_id,
    p_assignee_ids, p_memo, p_actor_id, p_request_id,
    p_check_in_request_id, p_check_out_request_id,
    p_runtime_input || jsonb_build_object('includeCheckOutEvent', true), true
  );
$$;

create function public.change_hotel_room_type_and_allocation_extended_internal(
  p_phase text,
  p_hotel_stay_id uuid,
  p_expected_version integer,
  p_new_room_id uuid,
  p_new_room_type_id uuid,
  p_new_room_type_code text,
  p_new_room_name text,
  p_effective_at timestamptz,
  p_normalized_reason text,
  p_root_reason text,
  p_actor_id uuid,
  p_request_id uuid,
  p_required_event_kinds text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  stay_row public.hotel_stays%rowtype;
  capacity_row public.hotel_capacity_reservations%rowtype;
  allocation_row public.hotel_room_allocations%rowtype;
  old_room public.hotel_rooms%rowtype;
  old_room_type public.hotel_room_types%rowtype;
  capacity_count integer;
  allocation_count integer;
  schedule_count integer;
  root_audit_count integer;
  lock_id uuid;
  allocation_from timestamptz;
  overlap_from timestamptz;
begin
  if p_phase not in ('before_check_in', 'after_check_in') then
    raise exception '지원하지 않는 객실 유형 변경 단계입니다.' using errcode = '22023';
  end if;

  select stay.* into stay_row
  from public.hotel_stays stay
  where stay.id = p_hotel_stay_id
  for update;
  if not found or stay_row.archived_at is not null then
    raise exception '활성 호텔 예약을 확인할 수 없습니다.' using errcode = 'P0002';
  end if;
  if stay_row.version <> p_expected_version then
    raise exception '다른 사용자가 먼저 호텔 예약을 수정했습니다.' using errcode = '40001';
  end if;
  if p_phase = 'before_check_in'
    and (stay_row.checked_in_at is not null or stay_row.checked_out_at is not null) then
    raise exception '입실 전 예약만 이 기능으로 객실 유형을 변경할 수 있습니다.'
      using errcode = '22023';
  end if;
  if p_phase = 'after_check_in'
    and (stay_row.checked_in_at is null or stay_row.checked_out_at is not null) then
    raise exception '입실 완료 후 퇴실 전 예약만 객실 유형을 이동할 수 있습니다.'
      using errcode = '22023';
  end if;
  if p_phase = 'after_check_in' and p_effective_at <= stay_row.checked_in_at then
    raise exception '이동 시각은 입실 완료 시각보다 늦어야 합니다.' using errcode = '22023';
  end if;

  select count(*)::integer into capacity_count
  from public.hotel_capacity_reservations capacity
  where capacity.hotel_stay_id = p_hotel_stay_id
    and capacity.archived_at is null;
  if capacity_count <> 1 then
    raise exception '활성 Capacity가 정확히 한 건이어야 합니다.' using errcode = '22023';
  end if;
  select capacity.* into capacity_row
  from public.hotel_capacity_reservations capacity
  where capacity.hotel_stay_id = p_hotel_stay_id
    and capacity.archived_at is null
  for update;
  if capacity_row.room_type_id is null then
    if p_phase = 'before_check_in' then
      raise exception '기존 객실 유형이 확정된 예약만 변경할 수 있습니다.'
        using errcode = '22023';
    end if;
    raise exception '객실 유형이 확정된 예약만 이동할 수 있습니다.' using errcode = '22023';
  end if;
  if capacity_row.room_type_id = p_new_room_type_id then
    if p_phase = 'before_check_in' then
      raise exception '같은 객실 유형은 기존 호실 재배정 기능을 사용해 주세요.'
        using errcode = '22023';
    end if;
    raise exception '같은 객실 유형은 기존 객실 이동 기능을 사용해 주세요.'
      using errcode = '22023';
  end if;
  if p_phase = 'after_check_in'
    and (p_effective_at <= capacity_row.reserved_from
      or p_effective_at >= capacity_row.reserved_until) then
    raise exception '이동 시각은 Capacity 예약 구간 안이어야 합니다.' using errcode = '22023';
  end if;

  if p_phase = 'before_check_in' then
    select count(*)::integer into allocation_count
    from public.hotel_room_allocations allocation
    where allocation.capacity_reservation_id = capacity_row.id
      and allocation.archived_at is null;
    if allocation_count <> 1 then
      raise exception '입실 전 활성 호실 배정이 정확히 한 건이어야 합니다.'
        using errcode = '22023';
    end if;
    select allocation.* into allocation_row
    from public.hotel_room_allocations allocation
    where allocation.capacity_reservation_id = capacity_row.id
      and allocation.archived_at is null
    for update;
    allocation_from := capacity_row.reserved_from;
    overlap_from := capacity_row.reserved_from;
  else
    select count(*)::integer into allocation_count
    from public.hotel_room_allocations allocation
    where allocation.capacity_reservation_id = capacity_row.id
      and allocation.archived_at is null
      and allocation.allocated_from < p_effective_at
      and allocation.allocated_until > p_effective_at;
    if allocation_count <> 1 then
      raise exception '이동 시각의 활성 호실 Allocation이 정확히 한 건이어야 합니다.'
        using errcode = '22023';
    end if;
    select allocation.* into allocation_row
    from public.hotel_room_allocations allocation
    where allocation.capacity_reservation_id = capacity_row.id
      and allocation.archived_at is null
      and allocation.allocated_from < p_effective_at
      and allocation.allocated_until > p_effective_at
    for update;
    allocation_from := p_effective_at;
    overlap_from := p_effective_at;
  end if;

  select room.* into old_room
  from public.hotel_rooms room where room.id = allocation_row.room_id;
  select room_type.* into old_room_type
  from public.hotel_room_types room_type
  where room_type.id = capacity_row.room_type_id;
  if old_room.id is null or old_room_type.id is null then
    raise exception '기존 호실 또는 객실 유형을 확인할 수 없습니다.' using errcode = 'P0002';
  end if;

  if p_required_event_kinds is null
    or cardinality(p_required_event_kinds) = 0
    or exists (
      select 1
      from unnest(p_required_event_kinds) requested(event_kind)
      where requested.event_kind not in ('check_in', 'check_out')
    )
    or (
      select count(distinct requested.event_kind)
      from unnest(p_required_event_kinds) requested(event_kind)
    ) <> cardinality(p_required_event_kinds) then
    raise exception '필수 Hotel Event 집합이 올바르지 않습니다.'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from unnest(p_required_event_kinds) requested(event_kind)
    left join lateral (
      select count(*)::integer as event_count
      from public.hotel_stay_schedule_events event
      join public.operation_schedules schedule
        on schedule.id = event.operation_schedule_id
      where event.hotel_stay_id = p_hotel_stay_id
        and event.event_kind = requested.event_kind
        and event.archived_at is null
        and schedule.archived_at is null
    ) cardinality_check on true
    where cardinality_check.event_count <> 1
  ) or exists (
    select 1
    from public.hotel_stay_schedule_events event
    join public.operation_schedules schedule
      on schedule.id = event.operation_schedule_id
    where event.hotel_stay_id = p_hotel_stay_id
      and event.archived_at is null
      and schedule.archived_at is null
      and not (event.event_kind = any(p_required_event_kinds))
  ) then
    raise exception '활성 Hotel Event가 호출 계약과 정확히 일치해야 합니다.'
      using errcode = 'P0002';
  end if;

  perform schedule.id
  from public.hotel_stay_schedule_events event
  join public.operation_schedules schedule
    on schedule.id = event.operation_schedule_id
  where event.hotel_stay_id = p_hotel_stay_id
    and event.archived_at is null
    and event.event_kind = any(p_required_event_kinds)
    and schedule.archived_at is null
  order by event.event_kind, schedule.id
  for update of schedule;
  get diagnostics schedule_count = row_count;
  if schedule_count <> cardinality(p_required_event_kinds) then
    raise exception '필수 Hotel Schedule 잠금 계약이 일치하지 않습니다.'
      using errcode = 'P0002';
  end if;

  for lock_id in
    select distinct candidate.id
    from (values (old_room_type.id), (p_new_room_type_id)) candidate(id)
    order by candidate.id
  loop
    perform pg_advisory_xact_lock(
      hashtextextended('hotel-capacity:' || lock_id::text, 0)
    );
  end loop;
  for lock_id in
    select distinct candidate.id
    from (values (old_room.id), (p_new_room_id)) candidate(id)
    order by candidate.id
  loop
    perform pg_advisory_xact_lock(
      hashtextextended('hotel-room:' || lock_id::text, 0)
    );
  end loop;

  perform public.assert_hotel_capacity_available(
    p_new_room_type_id,
    capacity_row.reserved_from,
    capacity_row.reserved_until,
    capacity_row.quantity,
    capacity_row.id
  );
  if exists (
    select 1
    from public.hotel_room_allocations other_allocation
    where other_allocation.room_id = p_new_room_id
      and other_allocation.archived_at is null
      and other_allocation.id <> allocation_row.id
      and other_allocation.allocated_from < capacity_row.reserved_until
      and other_allocation.allocated_until > overlap_from
  ) then
    raise exception '선택한 기간에 이미 사용 중인 호실입니다.' using errcode = '23P01';
  end if;

  perform set_config(
    'app.operation_change_reason',
    format(
      case when p_phase = 'before_check_in'
        then '입실 전 객실 유형 변경 · %s → %s · %s · %s'
        else '입실 후 객실 유형 이동 · %s → %s · %s · %s'
      end,
      old_room_type.code,
      p_new_room_type_code,
      p_new_room_name,
      p_normalized_reason
    ),
    true
  );
  perform set_config('app.operation_request_id', '', true);

  if p_phase = 'before_check_in' then
    update public.hotel_room_allocations allocation
    set archived_at = clock_timestamp(),
        archived_by = p_actor_id,
        archive_reason = p_normalized_reason,
        updated_by = p_actor_id
    where allocation.id = allocation_row.id;
  else
    update public.hotel_room_allocations allocation
    set allocated_until = p_effective_at,
        assignment_reason = p_normalized_reason,
        updated_by = p_actor_id
    where allocation.id = allocation_row.id;
  end if;

  update public.hotel_capacity_reservations capacity
  set room_type_id = p_new_room_type_id,
      updated_by = p_actor_id
  where capacity.id = capacity_row.id;

  perform public.assert_hotel_room_allocation_available(
    p_new_room_id,
    capacity_row.id,
    allocation_from,
    capacity_row.reserved_until,
    null
  );
  insert into public.hotel_room_allocations (
    capacity_reservation_id, room_id, allocated_from, allocated_until,
    assignment_reason, request_id, created_by, updated_by
  ) values (
    capacity_row.id, p_new_room_id, allocation_from,
    capacity_row.reserved_until, p_normalized_reason, null,
    p_actor_id, p_actor_id
  );

  perform set_config('app.operation_change_reason', p_root_reason, true);
  perform set_config('app.operation_request_id', p_request_id::text, true);
  update public.hotel_stays stay
  set updated_by = p_actor_id
  where stay.id = p_hotel_stay_id;

  select count(*)::integer into root_audit_count
  from public.entity_audit_events audit
  where audit.module_code = 'hotel_operations'
    and audit.entity_type = 'hotel_stays'
    and audit.entity_id = p_hotel_stay_id
    and audit.request_id = p_request_id;
  if root_audit_count <> 1 then
    raise exception 'Hotel Stay Root Audit이 정확히 한 건 기록되어야 합니다.'
      using errcode = 'P0001';
  end if;
  return public.hotel_stay_json(p_hotel_stay_id);
end;
$$;

-- Forward declaration so the public wrapper can be replaced before the full
-- runtime body is installed in this same transaction.


create or replace function public.change_hotel_room_type_and_allocation_internal(
  p_phase text,
  p_hotel_stay_id uuid,
  p_expected_version integer,
  p_new_room_id uuid,
  p_new_room_type_id uuid,
  p_new_room_type_code text,
  p_new_room_name text,
  p_effective_at timestamptz,
  p_normalized_reason text,
  p_root_reason text,
  p_actor_id uuid,
  p_request_id uuid
)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
  select public.change_hotel_room_type_and_allocation_extended_internal(
    p_phase, p_hotel_stay_id, p_expected_version,
    p_new_room_id, p_new_room_type_id, p_new_room_type_code, p_new_room_name,
    p_effective_at, p_normalized_reason, p_root_reason,
    p_actor_id, p_request_id, array['check_in', 'check_out']::text[]
  );
$$;

revoke all on function public.prepare_hotel_reservation_runtime_input_extended_internal(
  uuid,uuid,date,time,boolean,date,time,boolean,boolean,timestamptz,
  uuid,uuid,uuid,uuid[],text
) from public, anon, authenticated, service_role;
revoke all on function public.create_hotel_reservation_runtime_extended_internal(
  uuid,uuid,uuid,uuid,uuid[],text,uuid,uuid,uuid,uuid,jsonb,boolean
) from public, anon, authenticated, service_role;
revoke all on function public.change_hotel_room_type_and_allocation_extended_internal(
  text,uuid,integer,uuid,uuid,text,text,timestamptz,text,text,uuid,uuid,text[]
) from public, anon, authenticated, service_role;

revoke all on function public.prepare_hotel_reservation_runtime_input_internal(
  uuid,uuid,date,time,boolean,date,time,boolean,uuid,uuid,uuid,uuid[],text
) from public, anon, authenticated, service_role;
revoke all on function public.create_hotel_reservation_runtime_internal(
  uuid,uuid,uuid,uuid,uuid[],text,uuid,uuid,uuid,uuid,jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.change_hotel_room_type_and_allocation_internal(
  text,uuid,integer,uuid,uuid,text,text,timestamptz,text,text,uuid,uuid
) from public, anon, authenticated, service_role;

comment on function public.prepare_hotel_reservation_runtime_input_extended_internal(
  uuid,uuid,date,time,boolean,date,time,boolean,boolean,timestamptz,
  uuid,uuid,uuid,uuid[],text
) is 'Extended Hotel runtime input preparation. Optional checkout event and explicit capacity boundary. postgres only.';
comment on function public.create_hotel_reservation_runtime_extended_internal(
  uuid,uuid,uuid,uuid,uuid[],text,uuid,uuid,uuid,uuid,jsonb,boolean
) is 'Extended Hotel runtime creation. Creates required check-in and optional checkout event. postgres only.';
comment on function public.change_hotel_room_type_and_allocation_extended_internal(
  text,uuid,integer,uuid,uuid,text,text,timestamptz,text,text,uuid,uuid,text[]
) is 'Extended Hotel cross-type runtime change with explicit required event set. postgres only.';

commit;
