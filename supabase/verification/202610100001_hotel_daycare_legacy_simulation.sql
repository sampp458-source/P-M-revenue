-- Synthetic seven-row legacy repair simulation only. Never run remotely.
begin;
do $$ begin if current_database() not in ('daycare_department_qa','daycare_department_final_qa') or inet_server_addr() is not null then raise exception 'LOCAL_ONLY'; end if; end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000900',true);
update notification_push_config set enabled=false where singleton;
update notification_schedule_config set enabled=true where singleton;
create temp table repair_ids(id uuid primary key);
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
    where calendar.id=p_calendar_id and calendar.is_active and unit.is_active and unit.code='daycare') then
    raise exception '활성 Daycare Calendar를 확인할 수 없습니다.' using errcode='22023';
  end if;
  if not exists(select 1 from public.operation_calendar_schedule_types mapping
    join public.operation_schedule_types schedule_type on schedule_type.id=mapping.schedule_type_id
    where mapping.calendar_id=p_calendar_id and mapping.schedule_type_id=p_schedule_type_id
      and mapping.is_active and mapping.archived_at is null and schedule_type.is_active) then
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


do $$
declare i integer; r jsonb; cid uuid; tid uuid; room uuid; dog uuid; customer uuid;
begin
 select c.id,m.schedule_type_id into cid,tid from operation_calendars c join business_units b on b.id=c.business_unit_id join operation_calendar_schedule_types m on m.calendar_id=c.id where b.code='daycare' and m.archived_at is null limit 1;
 select id into room from hotel_rooms where room_type_id='00000000-0000-4000-8000-000000000040' order by id limit 1;
 select id,customer_id into dog,customer from dogs where customer_id='00000000-0000-4000-8000-000000000800' limit 1;
 for i in 1..7 loop
  r:=create_daycare_reservation(cid,tid,customer,dog,date '2099-09-01'+i,'10:00','18:00','00000000-0000-4000-8000-000000000040',room,array[auth.uid()],'legacy synthetic',gen_random_uuid());
  insert into repair_ids values((r->>'operationScheduleId')::uuid);
  if i<=5 then
   r:=complete_daycare_check_in((r->>'operationScheduleId')::uuid,(r->>'version')::integer,(date '2099-09-01'+i+time '10:00') at time zone 'Asia/Seoul',gen_random_uuid());
   r:=complete_daycare_check_out((r->>'operationScheduleId')::uuid,(r->>'version')::integer,(date '2099-09-01'+i+time '18:00') at time zone 'Asia/Seoul',gen_random_uuid());
  else
   r:=cancel_daycare_reservation((r->>'operationScheduleId')::uuid,(r->>'version')::integer,'synthetic cancel',gen_random_uuid());
  end if;
 end loop;
end $$;
set constraints all immediate;
set constraints all deferred;
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


create temp table repair_before as select
 (select count(*) from notifications) notification_count,
 (select md5(string_agg(to_jsonb(c)::text,',' order by c.id)) from hotel_capacity_reservations c where daycare_schedule_id in(select id from repair_ids)) capacity_digest,
 (select md5(string_agg(to_jsonb(a)::text,',' order by a.id)) from hotel_room_allocations a join hotel_capacity_reservations c on c.id=a.capacity_reservation_id where c.daycare_schedule_id in(select id from repair_ids)) allocation_digest;
create temp table old_audit as select * from entity_audit_events where entity_id in(select id from repair_ids);
do $$
declare sid uuid; hc uuid;
begin
 select c.id into hc from operation_calendars c join business_units b on b.id=c.business_unit_id where b.code='hotel' and c.is_active;
 perform set_config('app.daycare_orchestration','on',true);
 perform set_config('app.operation_change_reason','Hotel Daycare department correction simulation',true);
 for sid in select id from repair_ids order by id loop
  perform 1 from operation_schedules where id=sid for update;
  perform 1 from daycare_operation_states where operation_schedule_id=sid for update;
  update operation_schedules set calendar_id=hc,schedule_type_id='5cadf20b-021a-4948-a5dd-471677f51d21',version=version+1,updated_by=auth.uid() where id=sid;
  update daycare_operation_states set schedule_version=(select version from operation_schedules where id=sid),version=version+1,updated_by=auth.uid() where operation_schedule_id=sid;
 end loop;
 perform set_config('app.daycare_orchestration','off',true);
end $$;
set constraints all immediate;
do $$ begin
 if (select count(*) from notifications)<>(select notification_count from repair_before) then raise exception 'REPAIR_EMITTED_NOTIFICATION'; end if;
 if (select md5(string_agg(to_jsonb(c)::text,',' order by c.id)) from hotel_capacity_reservations c where daycare_schedule_id in(select id from repair_ids)) is distinct from (select capacity_digest from repair_before) then raise exception 'CAPACITY_CHANGED'; end if;
 if (select md5(string_agg(to_jsonb(a)::text,',' order by a.id)) from hotel_room_allocations a join hotel_capacity_reservations c on c.id=a.capacity_reservation_id where c.daycare_schedule_id in(select id from repair_ids)) is distinct from (select allocation_digest from repair_before) then raise exception 'ALLOCATION_CHANGED'; end if;
 if exists(select * from old_audit except select * from entity_audit_events) then raise exception 'HISTORICAL_AUDIT_CHANGED'; end if;
 if (select count(*) from operation_schedules s join repair_ids r on r.id=s.id join operation_calendars c on c.id=s.calendar_id join business_units b on b.id=c.business_unit_id where b.code='hotel')<>7 then raise exception 'REPAIR_COUNT'; end if;
 if exists(select 1 from operation_schedules s join repair_ids r on r.id=s.id join daycare_operation_states d on d.operation_schedule_id=s.id where s.version<>d.schedule_version) then raise exception 'VERSION_DESYNC'; end if;
end $$;
select 'PASS: seven terminal rows; capacity/allocation immutable; audit preserved; notifications delta 0' result;
rollback;
