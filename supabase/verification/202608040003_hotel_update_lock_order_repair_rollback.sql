-- Rollback order:
-- 1. Roll back Hotel Flexible Reservations first, if it has been applied.
-- 2. Run this Lock Repair rollback.

begin;

do $$
declare
  target_oid regprocedure := to_regprocedure(
    'public.update_hotel_reservation(uuid,integer,uuid,uuid,text,timestamp with time zone,timestamp with time zone,uuid,uuid,uuid,uuid[],text,uuid)'
  );
  target_body_fingerprint text;
begin
  if to_regprocedure(
      'public.create_flexible_hotel_reservation(uuid,uuid,date,time without time zone,boolean,date,time without time zone,boolean,uuid,uuid,uuid,uuid[],text,uuid)'
    ) is not null
    or to_regprocedure('public.get_hotel_operations_snapshot_v2(date)') is not null
    or to_regprocedure(
      'public.assert_hotel_total_capacity_available(timestamp with time zone,timestamp with time zone,integer,uuid)'
    ) is not null
    or exists (
      select 1 from pg_trigger trigger_row
      where trigger_row.tgname in (
        'hotel_capacity_reservations_total_capacity_guard',
        'hotel_room_allocations_room_type_guard'
      )
        and not trigger_row.tgisinternal
    )
    or exists (
      select 1 from pg_constraint constraint_row
      where constraint_row.conrelid =
          'public.hotel_capacity_reservations'::regclass
        and constraint_row.conname =
          'hotel_capacity_reservations_room_type_state_check'
    )
  then
    raise exception 'STOP_ROLLBACK_FLEXIBLE_EXTENSION_STILL_APPLIED'
      using detail = 'Flexible Rollback 후 Lock Repair Rollback 순서로 실행해 주세요.';
  end if;

  if target_oid is null then
    raise exception 'STOP_UPDATE_HOTEL_RESERVATION_MISSING';
  end if;

  select md5(procedure_row.prosrc)
  into target_body_fingerprint
  from pg_proc procedure_row
  where procedure_row.oid = target_oid;

  if target_body_fingerprint <> '321e35c3ac5180215086adf5d0f7d5ac' then
    raise exception 'STOP_REPAIRED_FUNCTION_VERSION_MISMATCH'
      using detail = format(
        'expected_body_fingerprint=%s; actual_body_fingerprint=%s',
        '321e35c3ac5180215086adf5d0f7d5ac',
        target_body_fingerprint
      );
  end if;
end;
$$;

CREATE OR REPLACE FUNCTION public.update_hotel_reservation(p_hotel_stay_id uuid, p_expected_version integer, p_calendar_id uuid, p_schedule_type_id uuid, p_title text, p_check_in_at timestamp with time zone, p_check_out_at timestamp with time zone, p_room_type_id uuid, p_dog_id uuid, p_customer_id uuid, p_assignee_ids uuid[], p_memo text, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  actor_id uuid := auth.uid();
  stay_row public.hotel_stays%rowtype;
  capacity_row public.hotel_capacity_reservations%rowtype;
  check_in_schedule public.operation_schedules%rowtype;
  check_out_schedule public.operation_schedules%rowtype;
  allocation_row public.hotel_room_allocations%rowtype;
  allocation_count integer;
begin
  if actor_id is null
    or not public.is_active_operation_member() then
    raise exception '호텔 예약 수정 권한이 없습니다.'
      using errcode = '42501';
  end if;

  if p_request_id is null
    or p_expected_version is null
    or p_check_in_at is null
    or p_check_out_at is null
    or p_check_out_at <= p_check_in_at then
    raise exception '요청 ID, 기존 버전, 유효한 예약 시간이 필요합니다.'
      using errcode = '22023';
  end if;

  if p_dog_id is null
    or p_customer_id is null
    or cardinality(
      coalesce(p_assignee_ids, '{}'::uuid[])
    ) = 0 then
    raise exception '반려견, 보호자, 담당자가 필요합니다.'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.operation_calendars calendar
    join public.business_units unit
      on unit.id = calendar.business_unit_id
    join public.operation_calendar_schedule_types mapping
      on mapping.calendar_id = calendar.id
     and mapping.schedule_type_id = p_schedule_type_id
    where calendar.id = p_calendar_id
      and calendar.is_active
      and unit.code = 'hotel'
      and mapping.is_active
      and mapping.archived_at is null
  ) then
    raise exception '활성 호텔 캘린더와 일정 유형을 확인해 주세요.'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.dogs dog
    join public.customers customer
      on customer.id = p_customer_id
    where dog.id = p_dog_id
      and dog.is_active
      and customer.is_active
      and dog.customer_id = customer.id
  ) then
    raise exception '반려견과 연결 보호자 정보를 확인해 주세요.'
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
    raise exception '수정할 호텔 예약을 확인할 수 없습니다.'
      using errcode = 'P0002';
  end if;

  if stay_row.version <> p_expected_version then
    raise exception '다른 사용자가 먼저 호텔 예약을 수정했습니다.'
      using errcode = '40001';
  end if;

  if stay_row.checked_in_at is not null then
    raise exception '입실 완료 후에는 Calendar 예약 정보를 변경할 수 없습니다.'
      using errcode = '22023';
  end if;

  select capacity.*
  into capacity_row
  from public.hotel_capacity_reservations capacity
  where capacity.hotel_stay_id = p_hotel_stay_id
    and capacity.archived_at is null
  for update;

  select schedule.*
  into check_in_schedule
  from public.hotel_stay_schedule_events event
  join public.operation_schedules schedule
    on schedule.id = event.operation_schedule_id
  where event.hotel_stay_id = p_hotel_stay_id
    and event.event_kind = 'check_in'
    and event.archived_at is null
  for update of schedule;

  select schedule.*
  into check_out_schedule
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

  if not public.can_manage_operation_schedule(
    check_in_schedule.id
  )
  or not public.can_manage_operation_schedule(
    check_out_schedule.id
  ) then
    raise exception '호텔 예약 생성자 또는 담당자만 수정할 수 있습니다.'
      using errcode = '42501';
  end if;

  select count(*)
  into allocation_count
  from public.hotel_room_allocations allocation
  where allocation.capacity_reservation_id = capacity_row.id
    and allocation.archived_at is null;

  if allocation_count > 1 then
    raise exception '객실 이동 이력이 있는 Stay는 Calendar 예약 기간을 수정할 수 없습니다.'
      using errcode = '22023';
  end if;

  if allocation_count = 1 then
    select allocation.*
    into allocation_row
    from public.hotel_room_allocations allocation
    where allocation.capacity_reservation_id = capacity_row.id
      and allocation.archived_at is null
    for update;

    if capacity_row.room_type_id = p_room_type_id then
      perform pg_advisory_xact_lock(
        hashtextextended(
          'hotel-room:' || allocation_row.room_id::text,
          0
        )
      );

      if not exists (
        select 1
        from public.hotel_rooms room
        where room.id = allocation_row.room_id
          and room.room_type_id = p_room_type_id
          and room.is_active
          and room.archived_at is null
      ) then
        raise exception '사전 배정된 호실이 새 예약 조건에 유효하지 않습니다.'
          using errcode = '22023';
      end if;

      if exists (
        select 1
        from public.hotel_room_allocations other_allocation
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
    p_room_type_id,
    p_check_in_at,
    p_check_out_at,
    1,
    capacity_row.id
  );

  perform public.update_operation_schedule(
    check_in_schedule.id,
    check_in_schedule.version,
    p_calendar_id,
    p_schedule_type_id,
    p_title,
    p_check_in_at,
    p_check_in_at + interval '1 hour',
    false,
    false,
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
    p_title,
    p_check_out_at,
    p_check_out_at + interval '1 hour',
    false,
    false,
    p_memo,
    p_assignee_ids,
    array[p_customer_id],
    array[p_dog_id],
    gen_random_uuid()
  );

  perform set_config(
    'app.operation_change_reason',
    '호텔 예약 수정',
    true
  );

  perform set_config(
    'app.operation_request_id',
    p_request_id::text,
    true
  );

  if allocation_count = 1 then
    if capacity_row.room_type_id <> p_room_type_id then
      update public.hotel_room_allocations allocation
      set
        archived_at = now(),
        archived_by = actor_id,
        archive_reason =
          '예약 객실 유형 변경으로 호실 배정 해제',
        updated_by = actor_id
      where allocation.id = allocation_row.id;
    else
      update public.hotel_room_allocations allocation
      set
        allocated_from = p_check_in_at,
        allocated_until = p_check_out_at,
        updated_by = actor_id
      where allocation.id = allocation_row.id;
    end if;
  end if;

  update public.hotel_capacity_reservations capacity
  set
    room_type_id = p_room_type_id,
    reserved_from = p_check_in_at,
    reserved_until = p_check_out_at,
    updated_by = actor_id
  where capacity.id = capacity_row.id;

  update public.hotel_stays stay
  set
    dog_id = p_dog_id,
    updated_by = actor_id
  where stay.id = p_hotel_stay_id;

  return public.hotel_stay_json(p_hotel_stay_id);
end;
$function$;

commit;
