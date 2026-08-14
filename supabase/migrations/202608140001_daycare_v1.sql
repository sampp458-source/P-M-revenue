-- Daycare V1: one operation_schedule root with an atomic room-capacity lifecycle.

begin;

do $$
begin
  if to_regclass('public.daycare_operation_states') is not null
    or to_regprocedure('public.create_daycare_reservation(uuid,uuid,uuid,uuid,date,time without time zone,time without time zone,uuid,uuid,uuid[],text,uuid)') is not null then
    raise exception 'STOP_DAYCARE_V1_ALREADY_APPLIED';
  end if;
  if to_regclass('public.operation_schedules') is null
    or to_regclass('public.hotel_capacity_reservations') is null
    or to_regclass('public.hotel_room_allocations') is null
    or to_regprocedure('public.create_operation_schedule(uuid,uuid,text,timestamp with time zone,timestamp with time zone,boolean,boolean,text,uuid[],uuid[],uuid[],uuid)') is null
    or to_regprocedure('public.update_operation_schedule(uuid,integer,uuid,uuid,text,timestamp with time zone,timestamp with time zone,boolean,boolean,text,uuid[],uuid[],uuid[],uuid)') is null
    or to_regprocedure('public.set_operation_schedule_status(uuid,integer,text,text,uuid)') is null
    or to_regprocedure('public.register_hotel_daycare_capacity(uuid,uuid,uuid)') is null
    or to_regprocedure('public.assign_hotel_daycare_room(uuid,uuid,text,uuid)') is null then
    raise exception 'STOP_DAYCARE_V1_DEPENDENCY_MISSING';
  end if;
end;
$$;

create table public.daycare_operation_states (
  operation_schedule_id uuid primary key
    references public.operation_schedules(id) on delete restrict,
  lifecycle_status text not null default 'scheduled'
    check (lifecycle_status in ('scheduled','checked_in','completed','cancelled')),
  room_type_id uuid not null references public.hotel_room_types(id) on delete restrict,
  schedule_version integer not null check (schedule_version > 0),
  version integer not null default 1 check (version > 0),
  checked_in_at timestamptz null,
  checked_in_by uuid null references public.profiles(id) on delete restrict,
  checked_out_at timestamptz null,
  checked_out_by uuid null references public.profiles(id) on delete restrict,
  cancelled_at timestamptz null,
  cancelled_by uuid null references public.profiles(id) on delete restrict,
  cancel_reason text null,
  create_request_id uuid not null unique,
  canonical_payload jsonb not null,
  canonical_payload_hash text not null check (canonical_payload_hash ~ '^[0-9a-f]{64}$'),
  request_history jsonb not null default '{}'::jsonb
    check (jsonb_typeof(request_history) = 'object'),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  updated_by uuid not null references public.profiles(id) on delete restrict,
  updated_at timestamptz not null default clock_timestamp(),
  constraint daycare_operation_states_lifecycle_check check (
    (lifecycle_status='scheduled' and checked_in_at is null and checked_in_by is null
      and checked_out_at is null and checked_out_by is null
      and cancelled_at is null and cancelled_by is null and cancel_reason is null)
    or (lifecycle_status='checked_in' and checked_in_at is not null and checked_in_by is not null
      and checked_out_at is null and checked_out_by is null
      and cancelled_at is null and cancelled_by is null and cancel_reason is null)
    or (lifecycle_status='completed' and checked_in_at is not null and checked_in_by is not null
      and checked_out_at is not null and checked_out_by is not null
      and checked_out_at >= checked_in_at
      and cancelled_at is null and cancelled_by is null and cancel_reason is null)
    or (lifecycle_status='cancelled' and checked_in_at is null and checked_in_by is null
      and checked_out_at is null and checked_out_by is null
      and cancelled_at is not null and cancelled_by is not null
      and nullif(btrim(cancel_reason),'') is not null)
  )
);

create index daycare_operation_states_status_idx
  on public.daycare_operation_states(lifecycle_status, updated_at desc);
create index daycare_operation_states_room_type_idx
  on public.daycare_operation_states(room_type_id, lifecycle_status);

create function public.daycare_payload_hash_internal(p_payload jsonb)
returns text language sql immutable security definer
set search_path=public,pg_temp
as $$ select encode(extensions.digest(p_payload::text,'sha256'),'hex') $$;

create function public.daycare_child_request_id_internal(p_request_id uuid,p_label text)
returns uuid language sql immutable security definer
set search_path=public,pg_temp
as $$
  select (substr(h,1,8)||'-'||substr(h,9,4)||'-'||substr(h,13,4)||'-'||substr(h,17,4)||'-'||substr(h,21,12))::uuid
  from (select md5(p_request_id::text||':'||p_label) h) value;
$$;

create function public.protect_daycare_operation_state_internal()
returns trigger language plpgsql security definer
set search_path=public,pg_temp
as $$
begin
  if new.operation_schedule_id<>old.operation_schedule_id
    or new.create_request_id<>old.create_request_id
    or new.created_by<>old.created_by
    or new.created_at<>old.created_at then
    raise exception 'Daycare lifecycle identity metadata cannot be changed.' using errcode='22023';
  end if;
  new.version:=old.version+1;
  new.updated_at:=clock_timestamp();
  return new;
end;
$$;

create function public.prevent_daycare_operation_state_delete_internal()
returns trigger language plpgsql security definer
set search_path=public,pg_temp
as $$ begin raise exception 'Daycare lifecycle ledger cannot be deleted.' using errcode='P0001'; end $$;

create function public.record_daycare_operation_audit_internal()
returns trigger language plpgsql security definer
set search_path=public,pg_temp
as $$
declare request_text text:=nullif(current_setting('app.operation_request_id',true),'');
begin
  insert into public.entity_audit_events(
    module_code,entity_type,entity_id,action,before_data,after_data,
    changed_by,change_reason,request_id
  ) values (
    'daycare_operations','daycare_operation_states',new.operation_schedule_id,
    case when tg_op='INSERT' then 'created' else 'updated' end,
    case when tg_op='INSERT' then null else to_jsonb(old) end,to_jsonb(new),
    new.updated_by,coalesce(nullif(current_setting('app.operation_change_reason',true),''),'Daycare lifecycle change'),
    case when request_text is null then null else request_text::uuid end
  );
  return new;
end;
$$;

create trigger daycare_operation_states_protect
before update on public.daycare_operation_states for each row
execute function public.protect_daycare_operation_state_internal();
create trigger daycare_operation_states_no_delete
before delete on public.daycare_operation_states for each row
execute function public.prevent_daycare_operation_state_delete_internal();
create trigger daycare_operation_states_audit
after insert or update on public.daycare_operation_states for each row
execute function public.record_daycare_operation_audit_internal();

create function public.guard_daycare_schedule_generic_mutation_internal()
returns trigger language plpgsql security definer
set search_path=public,pg_temp
as $$
begin
  if exists(select 1 from public.daycare_operation_states state where state.operation_schedule_id=old.id)
    and current_setting('app.daycare_orchestration',true) is distinct from 'on'
    and (new.calendar_id,new.schedule_type_id,new.title,new.description,new.starts_at,new.ends_at,
      new.all_day,new.time_unspecified,new.status,new.archived_at,new.archive_reason)
      is distinct from
      (old.calendar_id,old.schedule_type_id,old.title,old.description,old.starts_at,old.ends_at,
       old.all_day,old.time_unspecified,old.status,old.archived_at,old.archive_reason) then
    raise exception '객실형 Daycare 예약은 Daycare 전용 화면에서 변경해 주세요.' using errcode='P0001';
  end if;
  return new;
end;
$$;

create trigger operation_schedules_daycare_guard
before update on public.operation_schedules for each row
execute function public.guard_daycare_schedule_generic_mutation_internal();

create function public.daycare_reservation_json(p_schedule_id uuid)
returns jsonb language sql stable security definer
set search_path=public,pg_temp
as $$
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
    'lifecycleStatus',state.lifecycle_status,
    'roomTypeId',room_type.id,
    'roomTypeCode',room_type.code,
    'roomTypeName',room_type.name,
    'checkedInAt',state.checked_in_at,
    'checkedOutAt',state.checked_out_at,
    'cancelledAt',state.cancelled_at,
    'dog',jsonb_build_object('id',dog.id,'name',dog.name,'customerId',dog.customer_id),
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
  order by capacity.archived_at nulls first,capacity.created_at desc
  limit 1;
$$;

create function public.assert_daycare_reservation_input_internal(
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

create function public.daycare_request_replayed_internal(
  p_schedule_id uuid,p_request_id uuid,p_operation_kind text,p_payload jsonb
)
returns boolean language plpgsql security definer
set search_path=public,pg_temp
as $$
declare existing jsonb; other_schedule uuid;
begin
  if p_request_id is null then raise exception '요청 ID가 필요합니다.' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('daycare-request:'||p_request_id::text,0));
  select state.operation_schedule_id into other_schedule
  from public.daycare_operation_states state
  where state.request_history ? p_request_id::text and state.operation_schedule_id<>p_schedule_id
  limit 1;
  if other_schedule is not null then
    raise exception '이미 다른 Daycare 예약에 사용된 요청 ID입니다.' using errcode='23505';
  end if;
  select state.request_history->p_request_id::text into existing
  from public.daycare_operation_states state where state.operation_schedule_id=p_schedule_id;
  if existing is null then return false; end if;
  if existing->>'operationKind'<>p_operation_kind
    or existing->>'payloadHash'<>public.daycare_payload_hash_internal(p_payload) then
    raise exception '동일 요청 ID의 Daycare 입력이 기존 요청과 다릅니다.' using errcode='23505';
  end if;
  return true;
end;
$$;

create function public.daycare_append_request_internal(
  p_schedule_id uuid,p_request_id uuid,p_operation_kind text,p_payload jsonb,
  p_actor_id uuid,p_reason text
)
returns void language plpgsql security definer
set search_path=public,pg_temp
as $$
begin
  perform set_config('app.operation_change_reason',p_reason,true);
  perform set_config('app.operation_request_id',p_request_id::text,true);
  update public.daycare_operation_states state
  set request_history=state.request_history||jsonb_build_object(p_request_id::text,jsonb_build_object(
        'operationKind',p_operation_kind,'payloadHash',public.daycare_payload_hash_internal(p_payload))),
      updated_by=p_actor_id
  where state.operation_schedule_id=p_schedule_id;
end;
$$;

create function public.create_daycare_reservation(
  p_calendar_id uuid,p_schedule_type_id uuid,p_customer_id uuid,p_dog_id uuid,
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
  capacity_result jsonb; capacity_id uuid; dog_name text; room_type_code text;
begin
  if actor_id is null or not public.is_active_operation_member() then
    raise exception 'Daycare 예약 등록 권한이 없습니다.' using errcode='42501';
  end if;
  if p_request_id is null then raise exception '요청 ID가 필요합니다.' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('daycare-request:'||p_request_id::text,0));
  select * into state_row from public.daycare_operation_states where create_request_id=p_request_id;
  payload:=jsonb_build_object('calendarId',p_calendar_id,'scheduleTypeId',p_schedule_type_id,
    'customerId',p_customer_id,'dogId',p_dog_id,'serviceDate',p_service_date,
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
  perform public.assert_daycare_reservation_input_internal(p_calendar_id,p_schedule_type_id,p_customer_id,p_dog_id,
    p_service_date,p_check_in_time,p_check_out_time,p_room_type_id,p_room_id,p_assignee_ids);
  start_at:=(p_service_date+p_check_in_time) at time zone 'Asia/Seoul';
  end_at:=(p_service_date+p_check_out_time) at time zone 'Asia/Seoul';
  select dog.name,room_type.code into dog_name,room_type_code
  from public.dogs dog cross join public.hotel_room_types room_type
  where dog.id=p_dog_id and room_type.id=p_room_type_id;
  schedule_result:=public.create_operation_schedule(
    p_calendar_id,p_schedule_type_id,dog_name||' · 데이케어 · '||room_type_code,
    start_at,end_at,false,false,p_memo,p_assignee_ids,array[p_customer_id],array[p_dog_id],
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

create function public.update_daycare_reservation(
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
  dog_name text; room_type_code text; schedule_result jsonb;
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
  select dog.name,room_type.code into dog_name,room_type_code from public.dogs dog cross join public.hotel_room_types room_type where dog.id=p_dog_id and room_type.id=p_room_type_id;
  perform set_config('app.daycare_orchestration','on',true);
  schedule_result:=public.update_operation_schedule(p_operation_schedule_id,schedule_row.version,p_calendar_id,p_schedule_type_id,
    dog_name||' · 데이케어 · '||room_type_code,start_at,end_at,false,false,p_memo,p_assignee_ids,array[p_customer_id],array[p_dog_id],
    public.daycare_child_request_id_internal(p_request_id,'schedule-update'));
  perform set_config('app.daycare_orchestration','off',true);
  perform set_config('app.operation_change_reason','Daycare 예약 수정',true); perform set_config('app.operation_request_id',p_request_id::text,true);
  update public.daycare_operation_states set room_type_id=p_room_type_id,schedule_version=(schedule_result->>'version')::integer,
    canonical_payload=payload,canonical_payload_hash=public.daycare_payload_hash_internal(payload),
    request_history=request_history||jsonb_build_object(p_request_id::text,jsonb_build_object('operationKind','update','payloadHash',public.daycare_payload_hash_internal(payload))),updated_by=actor_id
  where operation_schedule_id=p_operation_schedule_id;
  return public.daycare_reservation_json(p_operation_schedule_id);
end;
$$;

create function public.cancel_daycare_reservation(p_operation_schedule_id uuid,p_expected_version integer,p_reason text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp
as $$
declare actor_id uuid:=auth.uid(); state_row public.daycare_operation_states%rowtype; schedule_row public.operation_schedules%rowtype; payload jsonb; schedule_result jsonb;
begin
  if actor_id is null or not public.is_active_operation_member() then raise exception 'Daycare 예약 취소 권한이 없습니다.' using errcode='42501'; end if;
  if nullif(btrim(p_reason),'') is null then raise exception '취소 사유가 필요합니다.' using errcode='22023'; end if;
  payload:=jsonb_build_object('scheduleId',p_operation_schedule_id,'expectedVersion',p_expected_version,'reason',btrim(p_reason));
  if public.daycare_request_replayed_internal(p_operation_schedule_id,p_request_id,'cancel',payload) then return public.daycare_reservation_json(p_operation_schedule_id); end if;
  select * into state_row from public.daycare_operation_states where operation_schedule_id=p_operation_schedule_id for update;
  if not found then raise exception 'Daycare 예약을 확인할 수 없습니다.' using errcode='P0002'; end if;
  if state_row.version<>p_expected_version then raise exception '다른 사용자가 먼저 Daycare 예약을 변경했습니다.' using errcode='PT409'; end if;
  if state_row.lifecycle_status<>'scheduled' then raise exception '입실 전 예정 Daycare만 취소할 수 있습니다.' using errcode='22023'; end if;
  select * into schedule_row from public.operation_schedules where id=p_operation_schedule_id for update;
  perform set_config('app.daycare_orchestration','on',true);
  schedule_result:=public.set_operation_schedule_status(p_operation_schedule_id,schedule_row.version,'cancelled',p_reason,public.daycare_child_request_id_internal(p_request_id,'schedule-cancel'));
  perform set_config('app.daycare_orchestration','off',true);
  update public.hotel_room_allocations allocation set archived_at=clock_timestamp(),archived_by=actor_id,archive_reason=btrim(p_reason),updated_by=actor_id
    from public.hotel_capacity_reservations capacity where capacity.daycare_schedule_id=p_operation_schedule_id and capacity.archived_at is null and allocation.capacity_reservation_id=capacity.id and allocation.archived_at is null;
  update public.hotel_capacity_reservations set archived_at=clock_timestamp(),archived_by=actor_id,archive_reason=btrim(p_reason),updated_by=actor_id
    where daycare_schedule_id=p_operation_schedule_id and source_kind='daycare' and archived_at is null;
  perform set_config('app.operation_change_reason','Daycare 예약 취소',true); perform set_config('app.operation_request_id',p_request_id::text,true);
  update public.daycare_operation_states set lifecycle_status='cancelled',schedule_version=(schedule_result->>'version')::integer,
    cancelled_at=clock_timestamp(),cancelled_by=actor_id,cancel_reason=btrim(p_reason),
    request_history=request_history||jsonb_build_object(p_request_id::text,jsonb_build_object('operationKind','cancel','payloadHash',public.daycare_payload_hash_internal(payload))),updated_by=actor_id
  where operation_schedule_id=p_operation_schedule_id;
  return public.daycare_reservation_json(p_operation_schedule_id);
end;
$$;

create function public.assign_daycare_room(p_operation_schedule_id uuid,p_expected_version integer,p_room_id uuid,p_reason text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp
as $$
declare actor_id uuid:=auth.uid(); state_row public.daycare_operation_states%rowtype; capacity_row public.hotel_capacity_reservations%rowtype; allocation_row public.hotel_room_allocations%rowtype; payload jsonb;
begin
  if actor_id is null or not public.is_active_operation_member() then raise exception 'Daycare 호실 배정 권한이 없습니다.' using errcode='42501'; end if;
  payload:=jsonb_build_object('scheduleId',p_operation_schedule_id,'expectedVersion',p_expected_version,'roomId',p_room_id,'reason',coalesce(nullif(btrim(p_reason),''),''));
  if public.daycare_request_replayed_internal(p_operation_schedule_id,p_request_id,'assign_room',payload) then return public.daycare_reservation_json(p_operation_schedule_id); end if;
  select * into state_row from public.daycare_operation_states where operation_schedule_id=p_operation_schedule_id for update;
  if not found then raise exception 'Daycare 예약을 확인할 수 없습니다.' using errcode='P0002'; end if;
  if state_row.version<>p_expected_version then raise exception '다른 사용자가 먼저 Daycare 예약을 변경했습니다.' using errcode='PT409'; end if;
  if state_row.lifecycle_status<>'scheduled' then raise exception '입실 전 Daycare만 호실을 배정할 수 있습니다.' using errcode='22023'; end if;
  select * into capacity_row from public.hotel_capacity_reservations where daycare_schedule_id=p_operation_schedule_id and archived_at is null for update;
  if not found then raise exception '활성 Daycare Capacity를 확인할 수 없습니다.' using errcode='P0002'; end if;
  select * into allocation_row from public.hotel_room_allocations where capacity_reservation_id=capacity_row.id and archived_at is null order by created_at desc limit 1 for update;
  if allocation_row.id is not null and allocation_row.room_id=p_room_id then
    perform public.daycare_append_request_internal(p_operation_schedule_id,p_request_id,'assign_room',payload,actor_id,'Daycare 동일 호실 재확인');
    return public.daycare_reservation_json(p_operation_schedule_id);
  end if;
  perform public.assert_hotel_room_allocation_available(p_room_id,capacity_row.id,capacity_row.reserved_from,capacity_row.reserved_until,null);
  if allocation_row.id is not null then update public.hotel_room_allocations set archived_at=clock_timestamp(),archived_by=actor_id,archive_reason='Daycare 호실 변경',updated_by=actor_id where id=allocation_row.id; end if;
  perform public.assign_hotel_daycare_room(capacity_row.id,p_room_id,coalesce(nullif(btrim(p_reason),''),'Daycare 호실 배정'),public.daycare_child_request_id_internal(p_request_id,'room-assignment'));
  perform public.daycare_append_request_internal(p_operation_schedule_id,p_request_id,'assign_room',payload,actor_id,'Daycare 호실 배정');
  return public.daycare_reservation_json(p_operation_schedule_id);
end;
$$;

create function public.unassign_daycare_room(p_operation_schedule_id uuid,p_expected_version integer,p_reason text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp
as $$
declare actor_id uuid:=auth.uid(); state_row public.daycare_operation_states%rowtype; payload jsonb;
begin
  if actor_id is null or not public.is_active_operation_member() then raise exception 'Daycare 호실 배정 해제 권한이 없습니다.' using errcode='42501'; end if;
  if nullif(btrim(p_reason),'') is null then raise exception '배정 해제 사유가 필요합니다.' using errcode='22023'; end if;
  payload:=jsonb_build_object('scheduleId',p_operation_schedule_id,'expectedVersion',p_expected_version,'reason',btrim(p_reason));
  if public.daycare_request_replayed_internal(p_operation_schedule_id,p_request_id,'unassign_room',payload) then return public.daycare_reservation_json(p_operation_schedule_id); end if;
  select * into state_row from public.daycare_operation_states where operation_schedule_id=p_operation_schedule_id for update;
  if not found then raise exception 'Daycare 예약을 확인할 수 없습니다.' using errcode='P0002'; end if;
  if state_row.version<>p_expected_version then raise exception '다른 사용자가 먼저 Daycare 예약을 변경했습니다.' using errcode='PT409'; end if;
  if state_row.lifecycle_status<>'scheduled' then raise exception '입실 전 Daycare만 배정을 해제할 수 있습니다.' using errcode='22023'; end if;
  update public.hotel_room_allocations allocation set archived_at=clock_timestamp(),archived_by=actor_id,archive_reason=btrim(p_reason),updated_by=actor_id
    from public.hotel_capacity_reservations capacity where capacity.daycare_schedule_id=p_operation_schedule_id and capacity.archived_at is null and allocation.capacity_reservation_id=capacity.id and allocation.archived_at is null;
  perform public.daycare_append_request_internal(p_operation_schedule_id,p_request_id,'unassign_room',payload,actor_id,'Daycare 호실 배정 해제');
  return public.daycare_reservation_json(p_operation_schedule_id);
end;
$$;

create function public.complete_daycare_check_in(p_operation_schedule_id uuid,p_expected_version integer,p_checked_in_at timestamptz,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp
as $$
declare actor_id uuid:=auth.uid(); state_row public.daycare_operation_states%rowtype; schedule_row public.operation_schedules%rowtype; payload jsonb;
begin
  if actor_id is null or not public.is_active_operation_member() then raise exception 'Daycare 입실 처리 권한이 없습니다.' using errcode='42501'; end if;
  payload:=jsonb_build_object('scheduleId',p_operation_schedule_id,'expectedVersion',p_expected_version,'checkedInAt',p_checked_in_at);
  if public.daycare_request_replayed_internal(p_operation_schedule_id,p_request_id,'check_in',payload) then return public.daycare_reservation_json(p_operation_schedule_id); end if;
  select * into state_row from public.daycare_operation_states where operation_schedule_id=p_operation_schedule_id for update;
  if not found then raise exception 'Daycare 예약을 확인할 수 없습니다.' using errcode='P0002'; end if;
  select * into schedule_row from public.operation_schedules where id=p_operation_schedule_id;
  if not found then raise exception 'Daycare 예약을 확인할 수 없습니다.' using errcode='P0002'; end if;
  if state_row.version<>p_expected_version then raise exception '다른 사용자가 먼저 Daycare 예약을 변경했습니다.' using errcode='PT409'; end if;
  if state_row.lifecycle_status<>'scheduled' then raise exception '예정 Daycare만 입실 처리할 수 있습니다.' using errcode='22023'; end if;
  if p_checked_in_at is null or (p_checked_in_at at time zone 'Asia/Seoul')::date<>(schedule_row.starts_at at time zone 'Asia/Seoul')::date or p_checked_in_at>=schedule_row.ends_at then
    raise exception 'Daycare 서비스 날짜 안의 입실 시간이 필요합니다.' using errcode='22023';
  end if;
  if not exists(select 1 from public.hotel_room_allocations allocation join public.hotel_capacity_reservations capacity on capacity.id=allocation.capacity_reservation_id
    where capacity.daycare_schedule_id=p_operation_schedule_id and capacity.archived_at is null and allocation.archived_at is null) then
    raise exception '호실 배정 후 Daycare 입실을 처리해 주세요.' using errcode='22023';
  end if;
  perform set_config('app.operation_change_reason','Daycare 입실 완료',true); perform set_config('app.operation_request_id',p_request_id::text,true);
  update public.daycare_operation_states set lifecycle_status='checked_in',checked_in_at=p_checked_in_at,checked_in_by=actor_id,
    request_history=request_history||jsonb_build_object(p_request_id::text,jsonb_build_object('operationKind','check_in','payloadHash',public.daycare_payload_hash_internal(payload))),updated_by=actor_id
  where operation_schedule_id=p_operation_schedule_id;
  return public.daycare_reservation_json(p_operation_schedule_id);
end;
$$;

create function public.complete_daycare_check_out(p_operation_schedule_id uuid,p_expected_version integer,p_checked_out_at timestamptz,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp
as $$
declare actor_id uuid:=auth.uid(); state_row public.daycare_operation_states%rowtype; schedule_row public.operation_schedules%rowtype;
  capacity_row public.hotel_capacity_reservations%rowtype; allocation_row public.hotel_room_allocations%rowtype; payload jsonb; schedule_result jsonb;
begin
  if actor_id is null or not public.is_active_operation_member() then raise exception 'Daycare 퇴실 처리 권한이 없습니다.' using errcode='42501'; end if;
  payload:=jsonb_build_object('scheduleId',p_operation_schedule_id,'expectedVersion',p_expected_version,'checkedOutAt',p_checked_out_at);
  if public.daycare_request_replayed_internal(p_operation_schedule_id,p_request_id,'check_out',payload) then return public.daycare_reservation_json(p_operation_schedule_id); end if;
  select * into state_row from public.daycare_operation_states where operation_schedule_id=p_operation_schedule_id for update;
  if not found then raise exception 'Daycare 예약을 확인할 수 없습니다.' using errcode='P0002'; end if;
  select * into schedule_row from public.operation_schedules where id=p_operation_schedule_id for update;
  if not found then raise exception 'Daycare 예약을 확인할 수 없습니다.' using errcode='P0002'; end if;
  if state_row.version<>p_expected_version then raise exception '다른 사용자가 먼저 Daycare 예약을 변경했습니다.' using errcode='PT409'; end if;
  if state_row.lifecycle_status<>'checked_in' then raise exception '입실 완료된 Daycare만 퇴실 처리할 수 있습니다.' using errcode='22023'; end if;
  if p_checked_out_at is null or p_checked_out_at<state_row.checked_in_at or (p_checked_out_at at time zone 'Asia/Seoul')::date<>(schedule_row.starts_at at time zone 'Asia/Seoul')::date then
    raise exception '입실 이후 같은 서비스 날짜의 퇴실 시간이 필요합니다.' using errcode='22023';
  end if;
  select * into capacity_row from public.hotel_capacity_reservations where daycare_schedule_id=p_operation_schedule_id and archived_at is null for update;
  if not found then raise exception '활성 Daycare Capacity를 확인할 수 없습니다.' using errcode='P0002'; end if;
  select * into allocation_row from public.hotel_room_allocations where capacity_reservation_id=capacity_row.id and archived_at is null order by created_at desc limit 1 for update;
  if not found then raise exception 'Daycare 호실 배정을 확인할 수 없습니다.' using errcode='P0002'; end if;
  if p_checked_out_at>capacity_row.reserved_until then
    perform public.assert_hotel_capacity_available(capacity_row.room_type_id,capacity_row.reserved_from,p_checked_out_at,1,capacity_row.id);
    perform public.assert_hotel_room_allocation_available(allocation_row.room_id,capacity_row.id,allocation_row.allocated_from,p_checked_out_at,allocation_row.id);
    update public.hotel_capacity_reservations set reserved_until=p_checked_out_at,updated_by=actor_id where id=capacity_row.id;
    update public.hotel_room_allocations set allocated_until=p_checked_out_at,updated_by=actor_id where id=allocation_row.id;
  end if;
  perform set_config('app.daycare_orchestration','on',true);
  schedule_result:=public.set_operation_schedule_status(p_operation_schedule_id,schedule_row.version,'completed','Daycare 퇴실 완료',public.daycare_child_request_id_internal(p_request_id,'schedule-complete'));
  perform set_config('app.daycare_orchestration','off',true);
  perform set_config('app.operation_change_reason','Daycare 퇴실 완료',true); perform set_config('app.operation_request_id',p_request_id::text,true);
  update public.daycare_operation_states set lifecycle_status='completed',schedule_version=(schedule_result->>'version')::integer,
    checked_out_at=p_checked_out_at,checked_out_by=actor_id,
    request_history=request_history||jsonb_build_object(p_request_id::text,jsonb_build_object('operationKind','check_out','payloadHash',public.daycare_payload_hash_internal(payload))),updated_by=actor_id
  where operation_schedule_id=p_operation_schedule_id;
  return public.daycare_reservation_json(p_operation_schedule_id);
end;
$$;

create function public.get_daycare_operations_for_date(p_local_date date)
returns jsonb language sql stable security definer set search_path=public,pg_temp
as $$
  select coalesce(jsonb_agg(public.daycare_reservation_json(state.operation_schedule_id)
    order by schedule.starts_at,state.created_at),'[]'::jsonb)
  from public.daycare_operation_states state
  join public.operation_schedules schedule on schedule.id=state.operation_schedule_id
  where schedule.archived_at is null
    and state.lifecycle_status<>'cancelled'
    and public.is_active_operation_member()
    and (schedule.starts_at at time zone 'Asia/Seoul')::date=p_local_date;
$$;

alter table public.daycare_operation_states enable row level security;
create policy daycare_operation_states_select_members on public.daycare_operation_states
for select to authenticated using(public.is_active_operation_member());
revoke all on table public.daycare_operation_states from public,anon,authenticated,service_role;
grant select on table public.daycare_operation_states to authenticated,service_role;

do $$ declare signature text; begin
  foreach signature in array array[
    'public.create_daycare_reservation(uuid,uuid,uuid,uuid,date,time without time zone,time without time zone,uuid,uuid,uuid[],text,uuid)',
    'public.update_daycare_reservation(uuid,integer,uuid,uuid,uuid,uuid,date,time without time zone,time without time zone,uuid,uuid,uuid[],text,uuid)',
    'public.cancel_daycare_reservation(uuid,integer,text,uuid)',
    'public.assign_daycare_room(uuid,integer,uuid,text,uuid)',
    'public.unassign_daycare_room(uuid,integer,text,uuid)',
    'public.complete_daycare_check_in(uuid,integer,timestamp with time zone,uuid)',
    'public.complete_daycare_check_out(uuid,integer,timestamp with time zone,uuid)',
    'public.get_daycare_operations_for_date(date)'
  ] loop
    execute format('revoke all on function %s from public,anon',signature);
    execute format('grant execute on function %s to authenticated,service_role',signature);
  end loop;
end $$;

revoke all on function public.daycare_payload_hash_internal(jsonb),
  public.daycare_child_request_id_internal(uuid,text),
  public.protect_daycare_operation_state_internal(),
  public.prevent_daycare_operation_state_delete_internal(),
  public.record_daycare_operation_audit_internal(),
  public.guard_daycare_schedule_generic_mutation_internal(),
  public.assert_daycare_reservation_input_internal(uuid,uuid,uuid,uuid,date,time without time zone,time without time zone,uuid,uuid,uuid[]),
  public.daycare_request_replayed_internal(uuid,uuid,text,jsonb),
  public.daycare_append_request_internal(uuid,uuid,text,jsonb,uuid,text)
from public,anon,authenticated,service_role;

revoke all on function public.daycare_reservation_json(uuid) from public,anon;
grant execute on function public.daycare_reservation_json(uuid) to authenticated,service_role;

commit;
