-- Hotel Daycare belongs to the Hotel calendar. No legacy reservation repair.
begin;
do $$
begin
  if md5(pg_get_functiondef(to_regprocedure('public.assert_daycare_reservation_input_internal(uuid,uuid,uuid,uuid,date,time,time,uuid,uuid,uuid[])'))) is distinct from 'cd41520e5f118439a751131d6f41d28e' then raise exception 'STOP_DAYCARE_INPUT_PREDECESSOR'; end if;
  if md5(pg_get_functiondef(to_regprocedure('public.register_hotel_daycare_capacity(uuid,uuid,uuid)'))) is distinct from 'e6ed84a124393acadaacc153f91e9dc2' then raise exception 'STOP_DAYCARE_CAPACITY_PREDECESSOR'; end if;
end;
$$;
do $$
declare hotel_calendar uuid;
begin
  if (select count(*) from public.operation_calendars c join public.business_units b on b.id=c.business_unit_id where c.is_active and b.is_active and b.code='hotel')<>1 then
    raise exception 'HOTEL_DAYCARE_CALENDAR_NOT_UNIQUE';
  end if;
  select c.id into hotel_calendar from public.operation_calendars c join public.business_units b on b.id=c.business_unit_id where c.is_active and b.is_active and b.code='hotel';
  if exists(select 1 from public.operation_schedule_types where id='5cadf20b-021a-4948-a5dd-471677f51d21' or lower(btrim(name))='호텔 데이케어') then
    raise exception 'HOTEL_DAYCARE_TYPE_ALREADY_EXISTS';
  end if;
  insert into public.operation_schedule_types(id,name,color,sort_order) values('5cadf20b-021a-4948-a5dd-471677f51d21','호텔 데이케어','#C99845',40);
  insert into public.operation_calendar_schedule_types(calendar_id,schedule_type_id,sort_order) values(hotel_calendar,'5cadf20b-021a-4948-a5dd-471677f51d21',40);
end;
$$;
create or replace function public.assert_daycare_reservation_input_internal(
  p_calendar_id uuid,p_schedule_type_id uuid,p_customer_id uuid,p_dog_id uuid,
  p_service_date date,p_check_in_time time,p_check_out_time time,
  p_room_type_id uuid,p_room_id uuid,p_assignee_ids uuid[]
)
returns void language plpgsql security definer
set search_path=public,pg_temp
as $$
begin
  if p_service_date is null or p_check_in_time is null or p_check_out_time is null
    or p_check_out_time<=p_check_in_time then
    raise exception '데이케어 날짜와 시작보다 늦은 입실·퇴실 시간이 필요합니다.' using errcode='22023';
  end if;
  if not exists(select 1 from public.operation_calendars calendar
    join public.business_units unit on unit.id=calendar.business_unit_id
    where calendar.id=p_calendar_id and calendar.is_active and unit.is_active and unit.code='hotel') then
    raise exception '활성 호텔 데이케어 Calendar를 확인할 수 없습니다.' using errcode='22023';
  end if;
  if not exists(select 1 from public.operation_calendar_schedule_types mapping
    join public.operation_schedule_types schedule_type on schedule_type.id=mapping.schedule_type_id
    where mapping.calendar_id=p_calendar_id and mapping.schedule_type_id=p_schedule_type_id
      and mapping.is_active and mapping.archived_at is null and schedule_type.is_active and schedule_type.id='5cadf20b-021a-4948-a5dd-471677f51d21'::uuid) then
    raise exception 'Daycare Calendar에서 사용할 수 있는 일정 유형이 아닙니다.' using errcode='22023';
  end if;
  if not exists(select 1 from public.customers customer join public.dogs dog on dog.customer_id=customer.id
    where customer.id=p_customer_id and customer.is_active and dog.id=p_dog_id and dog.is_active) then
    raise exception '활성 보호자와 소유 반려견 관계를 확인할 수 없습니다.' using errcode='22023';
  end if;
  if cardinality(coalesce(p_assignee_ids,'{}'::uuid[]))=0 then
    raise exception '담당자를 한 명 이상 선택해 주세요.' using errcode='22023';
  end if;
  if not exists(select 1 from public.hotel_room_types room_type
    where room_type.id=p_room_type_id and room_type.is_active and room_type.archived_at is null) then
    raise exception '활성 객실 유형을 확인할 수 없습니다.' using errcode='22023';
  end if;
  if p_room_id is not null and not exists(select 1 from public.hotel_rooms room
    where room.id=p_room_id and room.room_type_id=p_room_type_id and room.is_active and room.archived_at is null) then
    raise exception '선택한 객실 유형과 호실이 일치하지 않습니다.' using errcode='22023';
  end if;
end;
$$;

-- Preserve legacy capacity links; add the canonical Hotel Daycare input only.
CREATE OR REPLACE FUNCTION public.register_hotel_daycare_capacity(p_schedule_id uuid, p_room_type_id uuid, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  actor_id uuid := auth.uid();
  schedule_row public.operation_schedules%rowtype;
  reservation_id uuid;
begin
  if actor_id is null
    or not public.is_active_operation_member() then
    raise exception '데이케어 객실 Capacity 등록 권한이 없습니다.'
      using errcode = '42501';
  end if;

  if p_request_id is null then
    raise exception '요청 ID가 필요합니다.'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'hotel-request:' || p_request_id::text,
      0
    )
  );

  select id
  into reservation_id
  from public.hotel_capacity_reservations
  where request_id = p_request_id;

  if reservation_id is not null then
    return (
      select to_jsonb(capacity)
      from public.hotel_capacity_reservations capacity
      where capacity.id = reservation_id
    );
  end if;

  select *
  into schedule_row
  from public.operation_schedules schedule
  where schedule.id = p_schedule_id
    and schedule.archived_at is null
  for update;

  if not found then
    raise exception '활성 데이케어 일정을 확인할 수 없습니다.'
      using errcode = 'P0002';
  end if;

  if schedule_row.all_day
    or schedule_row.time_unspecified then
    raise exception '데이케어 객실 사용은 정확한 시작·종료 시간이 필요합니다.'
      using errcode = '22023';
  end if;

  if not public.can_manage_operation_schedule(
    p_schedule_id
  ) then
    raise exception '일정 생성자 또는 담당자만 객실 Capacity를 연결할 수 있습니다.'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.operation_calendars calendar
    join public.business_units unit
      on unit.id = calendar.business_unit_id
    where calendar.id = schedule_row.calendar_id
      and (unit.code = 'daycare' or (unit.code = 'hotel' and calendar.is_active and unit.is_active
        and schedule_row.schedule_type_id = '5cadf20b-021a-4948-a5dd-471677f51d21'::uuid))
  ) then
    raise exception '데이케어 캘린더 일정만 연결할 수 있습니다.'
      using errcode = '22023';
  end if;

  perform public.assert_hotel_capacity_available(
    p_room_type_id,
    schedule_row.starts_at,
    schedule_row.ends_at,
    1,
    null
  );

  perform set_config(
    'app.operation_change_reason',
    '데이케어 객실 Capacity 등록',
    true
  );

  perform set_config(
    'app.operation_request_id',
    '',
    true
  );

  insert into public.hotel_capacity_reservations (
    source_kind,
    daycare_schedule_id,
    room_type_id,
    reserved_from,
    reserved_until,
    quantity,
    request_id,
    created_by,
    updated_by
  )
  values (
    'daycare',
    p_schedule_id,
    p_room_type_id,
    schedule_row.starts_at,
    schedule_row.ends_at,
    1,
    p_request_id,
    actor_id,
    actor_id
  )
  returning id into reservation_id;

  return (
    select to_jsonb(capacity)
    from public.hotel_capacity_reservations capacity
    where capacity.id = reservation_id
  );
end;
$function$

;
commit;
