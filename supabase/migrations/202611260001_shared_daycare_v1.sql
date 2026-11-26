-- Shared daycare: exactly two dogs from one household, one DELUXE allocation and lifecycle.
-- No existing business rows are rewritten. Legacy single-dog RPCs and JSON dog remain compatible.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $$
begin
  if (select md5(prosrc) from pg_proc where oid=to_regprocedure('public.daycare_reservation_json(uuid)')) is distinct from 'ae85fd6f8f0ae1bc1f21b90a8fb7d94b'
    or (select md5(prosrc) from pg_proc where oid=to_regprocedure('public.get_overdue_daycare_operations_v1()')) is distinct from '5c2ef18345d303158737cc0edda120e2'
    or (select md5(prosrc) from pg_proc where oid=to_regprocedure('public.guard_daycare_schedule_generic_mutation_internal()')) is distinct from '16a18fae06d887dfc627d0b23992d28d'
    or (select md5(prosrc) from pg_proc where oid=to_regprocedure('public.update_daycare_reservation(uuid,integer,uuid,uuid,uuid,uuid,date,time,time,uuid,uuid,uuid[],text,uuid)')) is distinct from 'd4b3be35343749acde33dc881ca6c2bc' then
    raise exception 'STOP_SHARED_DAYCARE_PREDECESSOR_MISMATCH';
  end if;
end $$;

create function public.assert_shared_daycare_pair_internal(
  p_calendar_id uuid,p_schedule_type_id uuid,p_customer_id uuid,p_dog_ids uuid[],
  p_service_date date,p_check_in_time time,p_check_out_time time,
  p_room_type_id uuid,p_room_id uuid,p_assignee_ids uuid[]
) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare member_id uuid;
begin
  if cardinality(p_dog_ids) is distinct from 2 or
    (select count(distinct id) from unnest(p_dog_ids) id) <> 2 then
    raise exception '함께 데이케어 예약에는 서로 다른 반려견 두 마리를 선택해 주세요.' using errcode='22023';
  end if;
  if not exists(select 1 from public.hotel_room_types where id=p_room_type_id and upper(btrim(code))='DELUXE' and is_active and archived_at is null) then
    raise exception '함께 데이케어는 디럭스 객실에서만 가능합니다.' using errcode='22023';
  end if;
  foreach member_id in array p_dog_ids loop
    perform public.assert_daycare_reservation_input_internal(p_calendar_id,p_schedule_type_id,p_customer_id,member_id,
      p_service_date,p_check_in_time,p_check_out_time,p_room_type_id,p_room_id,p_assignee_ids);
  end loop;
end;
$$;
revoke all on function public.assert_shared_daycare_pair_internal(uuid,uuid,uuid,uuid[],date,time,time,uuid,uuid,uuid[])
  from public,anon,authenticated,service_role;


create or replace function public.daycare_reservation_json(p_schedule_id uuid) returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  select jsonb_build_object(
    'operationScheduleId',schedule.id,
    'calendarId',schedule.calendar_id,
    'scheduleTypeId',schedule.schedule_type_id,
    'title',schedule.title,
    'memo',schedule.description,
    'startsAt',schedule.starts_at,
    'endsAt',schedule.ends_at,
    'scheduleStatus',schedule.status,
    'scheduleVersion',schedule.version,
    'version',state.version,
    'lifecycleStatus',state.lifecycle_status,'administrativeRelease',case when state.administrative_released_at is null then null else jsonb_build_object('releasedAt',state.administrative_released_at,'releasedBy',state.administrative_released_by,'approvedBy',state.administrative_approved_by,'approvedAt',state.administrative_approved_at,'actualCheckoutKnown',false,'reason',state.administrative_release_reason) end,
    'roomTypeId',room_type.id,
    'roomTypeCode',room_type.code,
    'roomTypeName',room_type.name,
    'checkedInAt',state.checked_in_at,
    'checkedOutAt',state.checked_out_at,
    'cancelledAt',state.cancelled_at,
    'dog',jsonb_build_object('id',dog.id,'name',dog.name,'customerId',dog.customer_id),
    'dogs', (select jsonb_agg(jsonb_build_object('id',member.id,'name',member.name,'customerId',member.customer_id)
        order by (member.id = dog.id) desc, member.name, member.id)
      from public.operation_schedule_dogs member_link join public.dogs member on member.id=member_link.dog_id
      where member_link.schedule_id=schedule.id and member_link.archived_at is null),
    'customer',jsonb_build_object('id',customer.id,'name',customer.name,'phone',customer.phone),
    'assignees',coalesce((select jsonb_agg(jsonb_build_object('id',profile.id,'name',profile.name) order by profile.name,profile.id)
      from public.operation_schedule_assignees link join public.profiles profile on profile.id=link.profile_id
      where link.schedule_id=schedule.id and link.archived_at is null),'[]'::jsonb),
    'capacityReservation',jsonb_build_object(
      'id',capacity.id,'reservedFrom',capacity.reserved_from,'reservedUntil',capacity.reserved_until,'archivedAt',capacity.archived_at
    ),
    'roomAllocation',(select jsonb_build_object(
      'id',allocation.id,'roomId',room.id,'roomName',room.name,
      'allocatedFrom',allocation.allocated_from,'allocatedUntil',allocation.allocated_until,'version',allocation.version
    ) from public.hotel_room_allocations allocation join public.hotel_rooms room on room.id=allocation.room_id
      where allocation.capacity_reservation_id=capacity.id and allocation.archived_at is null
      order by allocation.created_at desc limit 1),
    'createdAt',state.created_at,'updatedAt',state.updated_at
  )
  from public.daycare_operation_states state
  join public.operation_schedules schedule on schedule.id=state.operation_schedule_id
  join public.hotel_room_types room_type on room_type.id=state.room_type_id
  join public.operation_schedule_dogs dog_link on dog_link.schedule_id=schedule.id and dog_link.archived_at is null
  join public.dogs dog on dog.id=dog_link.dog_id
  join public.customers customer on customer.id=dog.customer_id
  left join public.hotel_capacity_reservations capacity
    on capacity.daycare_schedule_id=schedule.id and capacity.source_kind='daycare'
  where state.operation_schedule_id=p_schedule_id
    and public.is_active_operation_member()
  order by capacity.archived_at nulls first,capacity.created_at desc,
    (dog.id::text = state.canonical_payload->>'dogId') desc nulls last,dog.id
  limit 1;
$$;

create function public.create_shared_daycare_reservation_v1(
  p_calendar_id uuid,p_schedule_type_id uuid,p_customer_id uuid,p_dog_ids uuid[],
  p_service_date date,p_check_in_time time,p_check_out_time time,
  p_room_type_id uuid,p_room_id uuid,p_assignee_ids uuid[],p_memo text,p_request_id uuid
)
returns jsonb language plpgsql security definer
set search_path=public,pg_temp
as $$
declare
  actor_id uuid:=auth.uid(); start_at timestamptz; end_at timestamptz;
  payload jsonb; payload_hash text; state_row public.daycare_operation_states%rowtype;
  schedule_result jsonb; schedule_id uuid; schedule_version_value integer;
  capacity_result jsonb; capacity_id uuid; primary_dog_id uuid; normalized_dogs uuid[]; dog_name text; room_type_code text;
begin
  if actor_id is null or not public.is_active_operation_member() then
    raise exception 'Daycare 예약 등록 권한이 없습니다.' using errcode='42501';
  end if;
  if p_request_id is null then raise exception '요청 ID가 필요합니다.' using errcode='22023'; end if;
  if cardinality(p_dog_ids) is distinct from 2 or
    (select count(distinct id) from unnest(p_dog_ids) id) <> 2 then
    raise exception '함께 데이케어 예약에는 서로 다른 반려견 두 마리를 선택해 주세요.' using errcode='22023';
  end if;
  normalized_dogs:=array(select id from unnest(p_dog_ids) id order by id);
  primary_dog_id:=normalized_dogs[1];
  perform pg_advisory_xact_lock(hashtextextended('daycare-request:'||p_request_id::text,0));
  select * into state_row from public.daycare_operation_states where create_request_id=p_request_id;
  payload:=jsonb_build_object('calendarId',p_calendar_id,'scheduleTypeId',p_schedule_type_id,
    'customerId',p_customer_id,'dogId',primary_dog_id,'dogIds',to_jsonb(normalized_dogs),'serviceDate',p_service_date,
    'checkInTime',p_check_in_time,'checkOutTime',p_check_out_time,'roomTypeId',p_room_type_id,
    'roomId',p_room_id,'assigneeIds',to_jsonb(array(select distinct id from unnest(coalesce(p_assignee_ids,'{}'::uuid[])) id order by id)),
    'memo',coalesce(nullif(btrim(p_memo),''),''));
  payload_hash:=public.daycare_payload_hash_internal(payload);
  if found then
    if state_row.canonical_payload_hash<>payload_hash then
      raise exception '동일 요청 ID의 Daycare 입력이 기존 요청과 다릅니다.' using errcode='23505';
    end if;
    return public.daycare_reservation_json(state_row.operation_schedule_id);
  end if;
  if exists(select 1 from public.operation_schedules schedule where schedule.request_id=p_request_id) then
    raise exception '이미 일반 일정에 사용된 요청 ID입니다.' using errcode='23505';
  end if;
  perform public.assert_shared_daycare_pair_internal(p_calendar_id,p_schedule_type_id,p_customer_id,normalized_dogs,
    p_service_date,p_check_in_time,p_check_out_time,p_room_type_id,p_room_id,p_assignee_ids);
  start_at:=(p_service_date+p_check_in_time) at time zone 'Asia/Seoul';
  end_at:=(p_service_date+p_check_out_time) at time zone 'Asia/Seoul';
  select string_agg(dog.name,' + ' order by dog.id) into dog_name from public.dogs dog where dog.id=any(normalized_dogs);
  select code into room_type_code from public.hotel_room_types where id=p_room_type_id;
  schedule_result:=public.create_operation_schedule(
    p_calendar_id,p_schedule_type_id,dog_name||' · 데이케어 · '||room_type_code,
    start_at,end_at,false,false,p_memo,p_assignee_ids,array[p_customer_id],normalized_dogs,
    public.daycare_child_request_id_internal(p_request_id,'schedule-create'));
  schedule_id:=(schedule_result->>'id')::uuid;
  schedule_version_value:=(schedule_result->>'version')::integer;
  perform set_config('app.operation_change_reason','Daycare 예약 생성',true);
  perform set_config('app.operation_request_id',p_request_id::text,true);
  insert into public.daycare_operation_states(
    operation_schedule_id,lifecycle_status,room_type_id,schedule_version,create_request_id,
    canonical_payload,canonical_payload_hash,request_history,created_by,updated_by
  ) values(schedule_id,'scheduled',p_room_type_id,schedule_version_value,p_request_id,payload,payload_hash,
    jsonb_build_object(p_request_id::text,jsonb_build_object('operationKind','create','payloadHash',payload_hash)),actor_id,actor_id);
  capacity_result:=public.register_hotel_daycare_capacity(schedule_id,p_room_type_id,
    public.daycare_child_request_id_internal(p_request_id,'capacity-create'));
  capacity_id:=(capacity_result->>'id')::uuid;
  if p_room_id is not null then
    perform public.assign_hotel_daycare_room(capacity_id,p_room_id,'Daycare 예약 시 호실 배정',
      public.daycare_child_request_id_internal(p_request_id,'allocation-create'));
  end if;
  return public.daycare_reservation_json(schedule_id);
end;
$$;

revoke all on function public.create_shared_daycare_reservation_v1(uuid,uuid,uuid,uuid[],date,time,time,uuid,uuid,uuid[],text,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.create_shared_daycare_reservation_v1(uuid,uuid,uuid,uuid[],date,time,time,uuid,uuid,uuid[],text,uuid)
  to authenticated;


create or replace function public.update_daycare_reservation(
  p_operation_schedule_id uuid,p_expected_version integer,p_calendar_id uuid,p_schedule_type_id uuid,
  p_customer_id uuid,p_dog_id uuid,p_service_date date,p_check_in_time time,p_check_out_time time,
  p_room_type_id uuid,p_room_id uuid,p_assignee_ids uuid[],p_memo text,p_request_id uuid
)
returns jsonb language plpgsql security definer
set search_path=public,pg_temp
as $$
declare actor_id uuid:=auth.uid(); state_row public.daycare_operation_states%rowtype;
  schedule_row public.operation_schedules%rowtype; capacity_row public.hotel_capacity_reservations%rowtype;
  allocation_row public.hotel_room_allocations%rowtype; payload jsonb; start_at timestamptz; end_at timestamptz;
  dog_name text; room_type_code text; schedule_result jsonb; member_ids uuid[]; stored_payload jsonb;
begin
  if actor_id is null or not public.is_active_operation_member() then raise exception 'Daycare 예약 수정 권한이 없습니다.' using errcode='42501'; end if;
  payload:=jsonb_build_object('scheduleId',p_operation_schedule_id,'expectedVersion',p_expected_version,
    'calendarId',p_calendar_id,'scheduleTypeId',p_schedule_type_id,'customerId',p_customer_id,'dogId',p_dog_id,
    'serviceDate',p_service_date,'checkInTime',p_check_in_time,'checkOutTime',p_check_out_time,
    'roomTypeId',p_room_type_id,'roomId',p_room_id,
    'assigneeIds',to_jsonb(array(select distinct id from unnest(coalesce(p_assignee_ids,'{}'::uuid[])) id order by id)),
    'memo',coalesce(nullif(btrim(p_memo),''),''));
  if public.daycare_request_replayed_internal(p_operation_schedule_id,p_request_id,'update',payload) then return public.daycare_reservation_json(p_operation_schedule_id); end if;
  select * into state_row from public.daycare_operation_states where operation_schedule_id=p_operation_schedule_id for update;
  if not found then raise exception 'Daycare 예약을 확인할 수 없습니다.' using errcode='P0002'; end if;
  if state_row.version<>p_expected_version or state_row.lifecycle_status<>'scheduled' then
    if state_row.version<>p_expected_version then raise exception '다른 사용자가 먼저 Daycare 예약을 변경했습니다.' using errcode='PT409'; end if;
    raise exception '입실 전 예정 Daycare만 수정할 수 있습니다.' using errcode='22023';
  end if;
  select * into schedule_row from public.operation_schedules where id=p_operation_schedule_id for update;
  if schedule_row.version<>state_row.schedule_version then raise exception 'Daycare 일정이 이미 변경되었습니다.' using errcode='PT409'; end if;
  perform public.assert_daycare_reservation_input_internal(p_calendar_id,p_schedule_type_id,p_customer_id,p_dog_id,p_service_date,p_check_in_time,p_check_out_time,p_room_type_id,p_room_id,p_assignee_ids);
  member_ids:=array[p_dog_id];
  stored_payload:=payload;
  if state_row.canonical_payload ? 'dogIds' then
    if state_row.canonical_payload->>'dogId' is distinct from p_dog_id::text then
      raise exception '함께 데이케어 예약의 반려견은 수정할 수 없습니다.' using errcode='22023';
    end if;
    member_ids:=array(select id::uuid from jsonb_array_elements_text(state_row.canonical_payload->'dogIds') id order by id);
    perform public.assert_shared_daycare_pair_internal(p_calendar_id,p_schedule_type_id,p_customer_id,member_ids,
      p_service_date,p_check_in_time,p_check_out_time,p_room_type_id,p_room_id,p_assignee_ids);
    if member_ids is distinct from array(select dog_id from public.operation_schedule_dogs
        where schedule_id=p_operation_schedule_id and archived_at is null order by dog_id) then
      raise exception '함께 데이케어 예약의 반려견 기록을 확인해 주세요.' using errcode='22023';
    end if;
    stored_payload:=payload||jsonb_build_object('dogIds',to_jsonb(member_ids));
  end if;
  start_at:=(p_service_date+p_check_in_time) at time zone 'Asia/Seoul'; end_at:=(p_service_date+p_check_out_time) at time zone 'Asia/Seoul';
  select * into capacity_row from public.hotel_capacity_reservations where daycare_schedule_id=p_operation_schedule_id and source_kind='daycare' and archived_at is null for update;
  if not found then raise exception '활성 Daycare Capacity를 확인할 수 없습니다.' using errcode='P0002'; end if;
  select * into allocation_row from public.hotel_room_allocations where capacity_reservation_id=capacity_row.id and archived_at is null order by created_at desc limit 1 for update;
  perform public.assert_hotel_capacity_available(p_room_type_id,start_at,end_at,1,capacity_row.id);
  update public.hotel_capacity_reservations set room_type_id=p_room_type_id,reserved_from=start_at,reserved_until=end_at,updated_by=actor_id where id=capacity_row.id;
  if allocation_row.id is not null and (p_room_id is null or allocation_row.room_id<>p_room_id) then
    update public.hotel_room_allocations set archived_at=clock_timestamp(),archived_by=actor_id,archive_reason='Daycare 예약 수정',updated_by=actor_id where id=allocation_row.id;
    allocation_row:=null;
  end if;
  if p_room_id is not null then
    if allocation_row.id is null then
      perform public.assign_hotel_daycare_room(capacity_row.id,p_room_id,'Daycare 예약 수정',public.daycare_child_request_id_internal(p_request_id,'allocation-update'));
    else
      perform public.assert_hotel_room_allocation_available(p_room_id,capacity_row.id,start_at,end_at,allocation_row.id);
      update public.hotel_room_allocations set allocated_from=start_at,allocated_until=end_at,updated_by=actor_id where id=allocation_row.id;
    end if;
  end if;
  select string_agg(dog.name,' + ' order by dog.id) into dog_name from public.dogs dog where dog.id=any(member_ids);
  select code into room_type_code from public.hotel_room_types where id=p_room_type_id;
  perform set_config('app.daycare_orchestration','on',true);
  schedule_result:=public.update_operation_schedule(p_operation_schedule_id,schedule_row.version,p_calendar_id,p_schedule_type_id,
    dog_name||' · 데이케어 · '||room_type_code,start_at,end_at,false,false,p_memo,p_assignee_ids,array[p_customer_id],member_ids,
    public.daycare_child_request_id_internal(p_request_id,'schedule-update'));
  perform set_config('app.daycare_orchestration','off',true);
  perform set_config('app.operation_change_reason','Daycare 예약 수정',true); perform set_config('app.operation_request_id',p_request_id::text,true);
  update public.daycare_operation_states set room_type_id=p_room_type_id,schedule_version=(schedule_result->>'version')::integer,
    canonical_payload=stored_payload,canonical_payload_hash=public.daycare_payload_hash_internal(stored_payload),
    request_history=request_history||jsonb_build_object(p_request_id::text,jsonb_build_object('operationKind','update','payloadHash',public.daycare_payload_hash_internal(payload))),updated_by=actor_id
  where operation_schedule_id=p_operation_schedule_id;
  return public.daycare_reservation_json(p_operation_schedule_id);
end;
$$;

create or replace function public.guard_daycare_schedule_generic_mutation_internal()
returns trigger language plpgsql security definer
set search_path=public,pg_temp
as $$
begin
  if exists(select 1 from public.daycare_operation_states state where state.operation_schedule_id=old.id)
    and current_setting('app.daycare_orchestration',true) is distinct from 'on'
    and ((new.version is distinct from old.version and exists(
      select 1 from public.daycare_operation_states state where state.operation_schedule_id=old.id
      and state.canonical_payload ? 'dogIds')) or (new.calendar_id,new.schedule_type_id,new.title,new.description,new.starts_at,new.ends_at,
      new.all_day,new.time_unspecified,new.status,new.archived_at,new.archive_reason)
      is distinct from
      (old.calendar_id,old.schedule_type_id,old.title,old.description,old.starts_at,old.ends_at,
       old.all_day,old.time_unspecified,old.status,old.archived_at,old.archive_reason)) then
    raise exception '객실형 Daycare 예약은 Daycare 전용 화면에서 변경해 주세요.' using errcode='P0001';
  end if;
  return new;
end;
$$;

create or replace function public.get_overdue_daycare_operations_v1()
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp
as $$
begin
  if auth.uid() is null or not public.is_active_operation_member() then
    raise exception using errcode='42501',message='호텔 운영 조회 권한이 없습니다.';
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
    'operationScheduleId',s.id,'version',d.version,'startsAt',s.starts_at,
    'checkedInAt',d.checked_in_at,'checkedOutAt',d.checked_out_at,
    'dog',jsonb_build_object('name',coalesce((select string_agg(member.value->>'name',' + ' order by member.ordinality)
      from jsonb_array_elements(coalesce(nullif(j.value->'dogs','null'::jsonb),'[]'::jsonb)) with ordinality member),
      j.value->'dog'->>'name','반려견 정보 확인 필요')),
    'roomAllocation',case when j.value->'roomAllocation'='null'::jsonb then null else jsonb_build_object(
      'roomId',j.value->'roomAllocation'->>'roomId','roomName',j.value->'roomAllocation'->>'roomName') end
  ) order by d.checked_in_at,d.operation_schedule_id),'[]'::jsonb)
  from public.daycare_operation_states d join public.operation_schedules s on s.id=d.operation_schedule_id
  cross join lateral (select public.daycare_reservation_json(d.operation_schedule_id) value) j
  where s.archived_at is null and d.lifecycle_status='checked_in' and d.checked_in_at is not null and d.checked_out_at is null
    and (s.starts_at at time zone 'Asia/Seoul')::date<(statement_timestamp() at time zone 'Asia/Seoul')::date);
end;
$$;

commit;
