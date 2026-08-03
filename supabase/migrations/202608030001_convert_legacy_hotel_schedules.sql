-- Append-only conversion of two legacy Hotel Calendar schedules into one Hotel Stay.
begin;

do $$
begin
  if to_regprocedure(
    'public.convert_legacy_hotel_schedules_to_reservation(uuid,uuid,uuid,uuid,uuid,uuid[],text,uuid)'
  ) is not null then
    raise exception 'STOP_CONVERSION_RPC_ALREADY_EXISTS';
  end if;
end;
$$;

create function public.convert_legacy_hotel_schedules_to_reservation(
  p_check_in_schedule_id uuid,
  p_check_out_schedule_id uuid,
  p_dog_id uuid,
  p_customer_id uuid,
  p_room_type_id uuid,
  p_assignee_ids uuid[],
  p_notes text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  existing_stay_id uuid;
  stay_id uuid;
  check_in_schedule public.operation_schedules%rowtype;
  check_out_schedule public.operation_schedules%rowtype;
  room_type_row public.hotel_room_types%rowtype;
  hotel_schedule_type_id uuid;
  active_mapping_count integer;
  locked_schedule_count integer;
  normalized_assignee_ids uuid[];
  active_assignee_count integer;
  dog_name text;
  check_in_title text;
  check_out_title text;
begin
  if actor_id is null
    or not public.has_operation_role(array['owner', 'manager']) then
    raise exception '호텔 예약 전환은 Operations Owner 또는 Manager만 할 수 있습니다.'
      using errcode = '42501';
  end if;
  if p_request_id is null
    or p_check_in_schedule_id is null
    or p_check_out_schedule_id is null
    or p_dog_id is null
    or p_customer_id is null
    or p_room_type_id is null then
    raise exception '전환에 필요한 일정, 반려견, 보호자, 객실 유형, 요청 ID를 확인해 주세요.'
      using errcode = '22023';
  end if;
  if p_check_in_schedule_id = p_check_out_schedule_id then
    raise exception '입실과 퇴실 일정은 서로 달라야 합니다.' using errcode = '22023';
  end if;

  select array_agg(distinct assignee_id order by assignee_id)
  into normalized_assignee_ids
  from unnest(coalesce(p_assignee_ids, array[]::uuid[])) assignee_id;
  if cardinality(coalesce(normalized_assignee_ids, array[]::uuid[])) = 0 then
    raise exception '활성 Operations 담당자가 1명 이상 필요합니다.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('hotel-request:' || p_request_id::text, 0)
  );
  select stay.id into existing_stay_id
  from public.hotel_stays stay
  where stay.request_id = p_request_id;
  if existing_stay_id is not null then
    if not exists (
      select 1
      from public.hotel_stays stay
      join public.operation_schedules check_in
        on check_in.id = p_check_in_schedule_id
      join public.operation_schedules check_out
        on check_out.id = p_check_out_schedule_id
      where stay.id = existing_stay_id
        and stay.archived_at is null
        and stay.dog_id = p_dog_id
        and (
          select count(*)
          from public.hotel_capacity_reservations capacity
          where capacity.hotel_stay_id = stay.id
            and capacity.archived_at is null
        ) = 1
        and exists (
          select 1
          from public.hotel_capacity_reservations capacity
          where capacity.hotel_stay_id = stay.id
            and capacity.archived_at is null
            and capacity.room_type_id = p_room_type_id
            and capacity.reserved_from is not distinct from check_in.starts_at
            and capacity.reserved_until is not distinct from check_out.starts_at
        )
        and (
          select count(*)
          from public.hotel_stay_schedule_events event
          where event.hotel_stay_id = stay.id
            and event.archived_at is null
        ) = 2
        and (
          select count(*)
          from public.hotel_stay_schedule_events event
          where event.hotel_stay_id = stay.id
            and event.archived_at is null
            and event.event_kind = 'check_in'
            and event.operation_schedule_id = p_check_in_schedule_id
        ) = 1
        and (
          select count(*)
          from public.hotel_stay_schedule_events event
          where event.hotel_stay_id = stay.id
            and event.archived_at is null
            and event.event_kind = 'check_out'
            and event.operation_schedule_id = p_check_out_schedule_id
        ) = 1
    ) then
      raise exception '동일 request_id의 입력 계약 불일치'
        using errcode = '23505';
    end if;
    return public.hotel_stay_json(existing_stay_id);
  end if;
  if exists (
    select 1 from public.entity_audit_events audit
    where audit.request_id = p_request_id
  ) then
    raise exception '이미 다른 작업에 사용된 request_id입니다.' using errcode = '23505';
  end if;

  perform schedule.id
  from public.operation_schedules schedule
  where schedule.id in (p_check_in_schedule_id, p_check_out_schedule_id)
  order by schedule.id
  for update;
  get diagnostics locked_schedule_count = row_count;
  if locked_schedule_count <> 2 then
    raise exception '입실·퇴실 일정 두 건을 모두 확인할 수 없습니다.' using errcode = 'P0002';
  end if;
  select * into check_in_schedule
  from public.operation_schedules where id = p_check_in_schedule_id;
  select * into check_out_schedule
  from public.operation_schedules where id = p_check_out_schedule_id;

  if check_in_schedule.archived_at is not null
    or check_out_schedule.archived_at is not null
    or check_in_schedule.status <> 'scheduled'
    or check_out_schedule.status <> 'scheduled' then
    raise exception '전환할 일정은 보관·취소·완료되지 않은 예정 상태여야 합니다.'
      using errcode = '22023';
  end if;
  if check_in_schedule.all_day or check_out_schedule.all_day
    or check_in_schedule.time_unspecified or check_out_schedule.time_unspecified then
    raise exception '호텔 전환은 입실·퇴실 시간이 확정된 일정만 가능합니다.'
      using errcode = '22023';
  end if;
  if check_in_schedule.ends_at is null
    or check_out_schedule.ends_at is null
    or check_in_schedule.ends_at <= check_in_schedule.starts_at
    or check_out_schedule.ends_at <= check_out_schedule.starts_at then
    raise exception '입실·퇴실 일정의 종료 시각은 각 시작 시각보다 늦어야 합니다.'
      using errcode = '22023';
  end if;
  if check_in_schedule.starts_at >= check_out_schedule.starts_at then
    raise exception '입실 시각은 퇴실 시각보다 빨라야 합니다.' using errcode = '22023';
  end if;
  if check_in_schedule.calendar_id <> check_out_schedule.calendar_id then
    raise exception '입실과 퇴실 일정은 같은 Hotel Calendar에 있어야 합니다.'
      using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.operation_calendars calendar
    join public.business_units unit on unit.id = calendar.business_unit_id
    where calendar.id = check_in_schedule.calendar_id
      and calendar.is_active
      and unit.is_active
      and unit.code = 'hotel'
  ) then
    raise exception '활성 Hotel Calendar 일정이 아닙니다.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.hotel_stay_schedule_events event
    where event.operation_schedule_id in (
      p_check_in_schedule_id, p_check_out_schedule_id
    )
  ) then
    raise exception '선택한 일정 중 이미 Hotel Stay 연결 이력이 있는 일정이 있습니다.'
      using errcode = '23505';
  end if;

  select count(*),
    (array_agg(schedule_type.id order by schedule_type.id))[1]
  into active_mapping_count, hotel_schedule_type_id
  from public.operation_calendar_schedule_types mapping
  join public.operation_schedule_types schedule_type
    on schedule_type.id = mapping.schedule_type_id
  where mapping.calendar_id = check_in_schedule.calendar_id
    and mapping.is_active
    and mapping.archived_at is null
    and schedule_type.is_active
    and schedule_type.name = '입실·퇴실';
  if active_mapping_count <> 1 or hotel_schedule_type_id is null then
    raise exception 'Hotel Calendar의 활성 입실·퇴실 일정 유형 매핑을 확인해 주세요.'
      using errcode = '22023';
  end if;

  select dog.name into dog_name
  from public.dogs dog
  join public.customers customer on customer.id = p_customer_id
  where dog.id = p_dog_id
    and dog.is_active
    and customer.is_active
    and dog.customer_id = customer.id;
  if dog_name is null then
    raise exception '활성 반려견과 연결 보호자 정보가 일치하지 않습니다.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.operation_schedule_dogs link
    where link.schedule_id in (p_check_in_schedule_id, p_check_out_schedule_id)
      and link.archived_at is null and link.dog_id <> p_dog_id
  ) or exists (
    select 1 from public.operation_schedule_customers link
    where link.schedule_id in (p_check_in_schedule_id, p_check_out_schedule_id)
      and link.archived_at is null and link.customer_id <> p_customer_id
  ) then
    raise exception '기존 일정의 반려견 또는 보호자 연결이 선택값과 다릅니다.'
      using errcode = '22023';
  end if;

  select count(distinct membership.profile_id) into active_assignee_count
  from public.operation_memberships membership
  join public.profiles profile on profile.id = membership.profile_id
  where membership.profile_id = any(normalized_assignee_ids)
    and membership.is_active
    and profile.is_active
    and profile.account_status = 'active';
  if active_assignee_count <> cardinality(normalized_assignee_ids) then
    raise exception '비활성 또는 Operations 구성원이 아닌 담당자가 포함되어 있습니다.'
      using errcode = '22023';
  end if;
  select * into room_type_row
  from public.hotel_room_types room_type
  where room_type.id = p_room_type_id
    and room_type.is_active
    and room_type.archived_at is null
  for share;
  if not found then
    raise exception '활성 객실 유형을 확인해 주세요.' using errcode = '22023';
  end if;

  perform public.assert_hotel_capacity_available(
    p_room_type_id,
    check_in_schedule.starts_at,
    check_out_schedule.starts_at,
    1,
    null
  );

  check_in_title := format('%s · 호텔링 · %s · 입실', dog_name, room_type_row.code);
  check_out_title := format('%s · 호텔링 · %s · 퇴실', dog_name, room_type_row.code);
  perform public.update_operation_schedule(
    check_in_schedule.id, check_in_schedule.version,
    check_in_schedule.calendar_id, hotel_schedule_type_id, check_in_title,
    check_in_schedule.starts_at, check_in_schedule.ends_at,
    false, false, p_notes, normalized_assignee_ids,
    array[p_customer_id], array[p_dog_id], gen_random_uuid()
  );
  perform public.update_operation_schedule(
    check_out_schedule.id, check_out_schedule.version,
    check_out_schedule.calendar_id, hotel_schedule_type_id, check_out_title,
    check_out_schedule.starts_at, check_out_schedule.ends_at,
    false, false, p_notes, normalized_assignee_ids,
    array[p_customer_id], array[p_dog_id], gen_random_uuid()
  );

  perform set_config('app.operation_change_reason', '기존 수동 Hotel 일정 정식 예약 전환', true);
  perform set_config('app.operation_request_id', p_request_id::text, true);
  insert into public.hotel_stays (
    dog_id, request_id, created_by, updated_by
  ) values (
    p_dog_id, p_request_id, actor_id, actor_id
  ) returning id into stay_id;

  insert into public.hotel_capacity_reservations (
    source_kind, hotel_stay_id, room_type_id, reserved_from, reserved_until,
    quantity, created_by, updated_by
  ) values (
    'stay', stay_id, p_room_type_id,
    check_in_schedule.starts_at, check_out_schedule.starts_at,
    1, actor_id, actor_id
  );

  insert into public.hotel_stay_schedule_events (
    hotel_stay_id, operation_schedule_id, event_kind, created_by, updated_by
  ) values
    (stay_id, p_check_in_schedule_id, 'check_in', actor_id, actor_id),
    (stay_id, p_check_out_schedule_id, 'check_out', actor_id, actor_id);

  return public.hotel_stay_json(stay_id);
end;
$$;

revoke all on function public.convert_legacy_hotel_schedules_to_reservation(
  uuid, uuid, uuid, uuid, uuid, uuid[], text, uuid
) from public, anon;
grant execute on function public.convert_legacy_hotel_schedules_to_reservation(
  uuid, uuid, uuid, uuid, uuid, uuid[], text, uuid
) to authenticated;

commit;
