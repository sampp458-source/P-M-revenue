-- Long Stay Hotel Platform Runtime Foundation (append-only).
-- This file creates Long Stay-owned objects only. Existing Hotel/Operations/
-- Finance/Family Booking functions and tables are not redefined.

begin;

do $$
begin
  if to_regclass('public.long_stay_contracts') is not null
    or to_regclass('public.long_stay_monthly_occupancies') is not null
    or to_regclass('public.long_stay_absence_events') is not null
    or to_regclass('public.long_stay_operation_audit_events') is not null then
    raise exception 'STOP_LONG_STAY_OBJECTS_ALREADY_EXIST';
  end if;
  if to_regprocedure('public.prepare_hotel_reservation_runtime_input_extended_internal(uuid,uuid,date,time without time zone,boolean,date,time without time zone,boolean,boolean,timestamp with time zone,uuid,uuid,uuid,uuid[],text)') is null
    or to_regprocedure('public.create_hotel_reservation_runtime_extended_internal(uuid,uuid,uuid,uuid,uuid[],text,uuid,uuid,uuid,uuid,jsonb,boolean)') is null
    or to_regprocedure('public.change_hotel_room_type_and_allocation_extended_internal(text,uuid,integer,uuid,uuid,text,text,timestamp with time zone,text,text,uuid,uuid,text[])') is null
    or to_regprocedure('public.complete_hotel_check_in(uuid,integer,timestamp with time zone,uuid)') is null
    or to_regprocedure('public.complete_hotel_check_out(uuid,integer,timestamp with time zone,uuid)') is null
    or to_regprocedure('public.reverse_hotel_completion(uuid,integer,text,text,uuid)') is null then
    raise exception 'STOP_LONG_STAY_APPROVED_HOTEL_RUNTIME_MISSING';
  end if;
end;
$$;

create table public.long_stay_contracts (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete restrict,
  dog_id uuid not null references public.dogs(id) on delete restrict,
  current_hotel_stay_id uuid null unique
    references public.hotel_stays(id) on delete restrict,
  status text not null default 'pending'
    check (status in ('pending','active','completed','cancelled')),
  started_on date not null,
  planned_check_out_date date null,
  preferred_room_type_id uuid null
    references public.hotel_room_types(id) on delete restrict,
  preferred_room_id uuid null references public.hotel_rooms(id) on delete restrict,
  monthly_rate numeric(14,2) null check (monthly_rate is null or monthly_rate >= 0),
  billing_anchor_day integer null
    check (billing_anchor_day is null or billing_anchor_day between 1 and 31),
  memo text null,
  version integer not null default 1 check (version > 0),
  create_request_id uuid not null unique,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  updated_by uuid not null references public.profiles(id) on delete restrict,
  updated_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz null,
  completed_by uuid null references public.profiles(id) on delete restrict,
  cancelled_at timestamptz null,
  cancelled_by uuid null references public.profiles(id) on delete restrict,
  archive_reason text null,
  archived_at timestamptz null,
  archived_by uuid null references public.profiles(id) on delete restrict,
  check (planned_check_out_date is null or planned_check_out_date >= started_on),
  check ((status = 'completed') = (completed_at is not null)),
  check ((status = 'cancelled') = (cancelled_at is not null))
);

create unique index long_stay_contracts_active_dog_uidx
  on public.long_stay_contracts(dog_id)
  where status in ('pending','active') and archived_at is null;
create index long_stay_contracts_customer_idx
  on public.long_stay_contracts(customer_id, created_at desc)
  where archived_at is null;

create table public.long_stay_monthly_occupancies (
  id uuid primary key default gen_random_uuid(),
  long_stay_contract_id uuid not null
    references public.long_stay_contracts(id) on delete restrict,
  hotel_stay_id uuid not null references public.hotel_stays(id) on delete restrict,
  service_month date not null check (service_month = date_trunc('month', service_month)::date),
  planned_occupied_from timestamptz not null,
  planned_occupied_until_exclusive timestamptz not null,
  room_type_id uuid not null references public.hotel_room_types(id) on delete restrict,
  room_id uuid not null references public.hotel_rooms(id) on delete restrict,
  runtime_capacity_reservation_id uuid not null
    references public.hotel_capacity_reservations(id) on delete restrict,
  status text not null default 'confirmed' check (status in ('confirmed','cancelled')),
  version integer not null default 1 check (version > 0),
  request_id uuid not null unique,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  updated_by uuid not null references public.profiles(id) on delete restrict,
  updated_at timestamptz not null default clock_timestamp(),
  archived_at timestamptz null,
  archived_by uuid null references public.profiles(id) on delete restrict,
  archive_reason text null,
  check (planned_occupied_until_exclusive > planned_occupied_from)
);

create unique index long_stay_monthly_occupancies_active_month_uidx
  on public.long_stay_monthly_occupancies(long_stay_contract_id, service_month)
  where status = 'confirmed' and archived_at is null;
create index long_stay_monthly_occupancies_runtime_idx
  on public.long_stay_monthly_occupancies(runtime_capacity_reservation_id, service_month);

create table public.long_stay_absence_events (
  id uuid primary key default gen_random_uuid(),
  long_stay_contract_id uuid not null
    references public.long_stay_contracts(id) on delete restrict,
  hotel_stay_id uuid not null references public.hotel_stays(id) on delete restrict,
  event_type text not null check (event_type in ('leave','return')),
  is_open boolean not null default false,
  paired_leave_event_id uuid null
    references public.long_stay_absence_events(id) on delete restrict,
  occurred_at timestamptz not null,
  expected_return_at timestamptz null,
  memo text null,
  reason text not null check (nullif(btrim(reason),'') is not null),
  request_id uuid not null unique,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  archived_at timestamptz null,
  archived_by uuid null references public.profiles(id) on delete restrict,
  archive_reason text null,
  check ((event_type = 'leave' and paired_leave_event_id is null)
      or (event_type = 'return' and paired_leave_event_id is not null)),
  check ((event_type = 'leave') or not is_open)
);

create unique index long_stay_absence_open_leave_uidx
  on public.long_stay_absence_events(long_stay_contract_id)
  where event_type = 'leave' and is_open and archived_at is null;

create table public.long_stay_operation_audit_events (
  id uuid primary key default gen_random_uuid(),
  long_stay_contract_id uuid not null
    references public.long_stay_contracts(id) on delete restrict,
  monthly_occupancy_id uuid null
    references public.long_stay_monthly_occupancies(id) on delete restrict,
  absence_event_id uuid null
    references public.long_stay_absence_events(id) on delete restrict,
  operation_kind text not null,
  request_id uuid not null unique,
  canonical_payload jsonb not null,
  canonical_payload_hash text not null check (canonical_payload_hash ~ '^[0-9a-f]{64}$'),
  before_state jsonb null,
  after_state jsonb not null,
  linked_hotel_request_ids uuid[] not null default '{}',
  changed_by uuid not null references public.profiles(id) on delete restrict,
  change_reason text not null check (nullif(btrim(change_reason),'') is not null),
  created_at timestamptz not null default clock_timestamp()
);

create index long_stay_operation_audit_contract_idx
  on public.long_stay_operation_audit_events(long_stay_contract_id, created_at desc);

create function public.long_stay_internal_request_id(
  p_root_request_id uuid, p_operation_kind text, p_entity_id uuid, p_child_kind text
) returns uuid
language sql immutable strict
set search_path = public, pg_temp
as $$
  select (
    substr(h,1,8)||'-'||substr(h,9,4)||'-5'||substr(h,14,3)||
    '-a'||substr(h,18,3)||'-'||substr(h,21,12)
  )::uuid
  from (select encode(extensions.digest(
    p_root_request_id::text||'|'||btrim(p_operation_kind)||'|'||
    p_entity_id::text||'|'||btrim(p_child_kind), 'sha256'
  ),'hex') h) digest_value;
$$;

create function public.long_stay_payload_hash_internal(p_payload jsonb)
returns text language sql immutable strict
set search_path = public, pg_temp
as $$ select encode(extensions.digest(p_payload::text,'sha256'),'hex'); $$;

create function public.long_stay_contract_projection_internal(p_contract_id uuid)
returns jsonb language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare result_value jsonb;
begin
  select jsonb_build_object(
    'id', contract.id, 'customerId', contract.customer_id,
    'customerName', customer.name, 'dogId', contract.dog_id,
    'dogName', dog.name, 'storedStatus', contract.status,
    'derivedStatus', case
      when contract.status = 'active' and contract.planned_check_out_date <
        (clock_timestamp() at time zone 'Asia/Seoul')::date
        and stay.checked_out_at is null then 'overstay'
      else contract.status end,
    'startedOn', contract.started_on,
    'plannedCheckOutDate', contract.planned_check_out_date,
    'checkedInAt', stay.checked_in_at, 'checkedOutAt', stay.checked_out_at,
    'hotelStayId', contract.current_hotel_stay_id,
    'version', contract.version,
    'isOpenEnded', capacity.reserved_until = 'infinity'::timestamptz,
    'runtimeCapacityUntil', case when capacity.reserved_until = 'infinity'::timestamptz
      then null else to_jsonb(capacity.reserved_until) end,
    'runtimeAllocationUntil', case when allocation.allocated_until = 'infinity'::timestamptz
      then null else to_jsonb(allocation.allocated_until) end,
    'currentRoom', case when room.id is null then null else jsonb_build_object(
      'id',room.id,'name',room.name,'roomTypeId',room.room_type_id) end,
    'isAway', exists (
      select 1 from public.long_stay_absence_events leave_event
      where leave_event.long_stay_contract_id = contract.id
        and leave_event.event_type = 'leave' and leave_event.is_open
        and leave_event.archived_at is null
    )
  ) into result_value
  from public.long_stay_contracts contract
  join public.customers customer on customer.id = contract.customer_id
  join public.dogs dog on dog.id = contract.dog_id
  left join public.hotel_stays stay on stay.id = contract.current_hotel_stay_id
  left join public.hotel_capacity_reservations capacity
    on capacity.hotel_stay_id = stay.id and capacity.archived_at is null
  left join lateral (
    select allocation.* from public.hotel_room_allocations allocation
    where allocation.capacity_reservation_id = capacity.id
      and allocation.archived_at is null
      and allocation.allocated_until = 'infinity'::timestamptz
    order by allocation.allocated_from desc limit 1
  ) allocation on true
  left join public.hotel_rooms room on room.id = allocation.room_id
  where contract.id = p_contract_id and contract.archived_at is null;
  return result_value;
end;
$$;

create function public.long_stay_replay_internal(
  p_request_id uuid, p_operation_kind text, p_payload jsonb
) returns jsonb language plpgsql security definer
set search_path = public, pg_temp
as $$
declare audit_row public.long_stay_operation_audit_events%rowtype;
begin
  if p_request_id is null then
    raise exception 'request_id가 필요합니다.' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('long-stay-request:'||p_request_id::text,0));
  select * into audit_row from public.long_stay_operation_audit_events
  where request_id = p_request_id;
  if found then
    if audit_row.operation_kind <> p_operation_kind
      or audit_row.canonical_payload_hash <> public.long_stay_payload_hash_internal(p_payload) then
      raise exception '동일 request_id의 Long Stay 입력이 다릅니다.' using errcode='23505';
    end if;
    return public.long_stay_contract_projection_internal(audit_row.long_stay_contract_id)
      || jsonb_build_object('replayed',true);
  end if;
  return null;
end;
$$;

create function public.long_stay_record_operation_internal(
  p_contract_id uuid, p_monthly_occupancy_id uuid, p_absence_event_id uuid,
  p_operation_kind text, p_request_id uuid, p_payload jsonb,
  p_before_state jsonb, p_linked_hotel_request_ids uuid[], p_reason text,
  p_actor_id uuid
) returns void language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.long_stay_operation_audit_events(
    long_stay_contract_id,monthly_occupancy_id,absence_event_id,operation_kind,
    request_id,canonical_payload,canonical_payload_hash,before_state,after_state,
    linked_hotel_request_ids,changed_by,change_reason
  ) values (
    p_contract_id,p_monthly_occupancy_id,p_absence_event_id,p_operation_kind,
    p_request_id,p_payload,public.long_stay_payload_hash_internal(p_payload),
    p_before_state,public.long_stay_contract_projection_internal(p_contract_id),
    coalesce(p_linked_hotel_request_ids,'{}'),p_actor_id,
    coalesce(nullif(btrim(p_reason),''),p_operation_kind)
  );
end;
$$;

create function public.assert_long_stay_runtime_invariant_internal(p_contract_id uuid)
returns void language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare contract_row public.long_stay_contracts%rowtype; stay_row public.hotel_stays%rowtype;
declare capacity_count integer; allocation_count integer; capacity_until timestamptz;
declare allocation_until timestamptz; capacity_type uuid; room_type uuid;
begin
  select * into contract_row from public.long_stay_contracts where id=p_contract_id;
  if not found or contract_row.archived_at is not null or contract_row.current_hotel_stay_id is null then return; end if;
  select * into stay_row from public.hotel_stays where id=contract_row.current_hotel_stay_id;
  select count(*),max(reserved_until) into capacity_count,capacity_until
  from public.hotel_capacity_reservations where hotel_stay_id=stay_row.id and archived_at is null;
  select capacity.room_type_id into capacity_type
  from public.hotel_capacity_reservations capacity
  where capacity.hotel_stay_id=stay_row.id and capacity.archived_at is null
  limit 1;
  select count(*),max(allocation.allocated_until)
    into allocation_count,allocation_until
  from public.hotel_room_allocations allocation
  join public.hotel_capacity_reservations capacity on capacity.id=allocation.capacity_reservation_id
  where capacity.hotel_stay_id=stay_row.id and capacity.archived_at is null
    and allocation.archived_at is null
    and allocation.allocated_until='infinity'::timestamptz;
  select room.room_type_id into room_type
  from public.hotel_room_allocations allocation
  join public.hotel_capacity_reservations capacity on capacity.id=allocation.capacity_reservation_id
  join public.hotel_rooms room on room.id=allocation.room_id
  where capacity.hotel_stay_id=stay_row.id and capacity.archived_at is null
    and allocation.archived_at is null
    and allocation.allocated_until='infinity'::timestamptz
  order by allocation.allocated_from desc limit 1;
  if contract_row.status in ('pending','active') and stay_row.checked_out_at is null then
    if capacity_count<>1 or capacity_until<>'infinity'::timestamptz
      or allocation_count<>1 or allocation_until<>'infinity'::timestamptz
      or capacity_type is distinct from room_type then
      raise exception 'LONG_STAY_RUNTIME_INVARIANT_VIOLATION' using errcode='23514';
    end if;
  elsif contract_row.status='completed' then
    if stay_row.checked_out_at is null or capacity_count<>1
      or capacity_until is distinct from stay_row.checked_out_at
      or exists (select 1 from public.hotel_room_allocations allocation
        join public.hotel_capacity_reservations capacity on capacity.id=allocation.capacity_reservation_id
        where capacity.hotel_stay_id=stay_row.id and capacity.archived_at is null
          and allocation.archived_at is null and allocation.allocated_until='infinity'::timestamptz) then
      raise exception 'LONG_STAY_COMPLETED_INVARIANT_VIOLATION' using errcode='23514';
    end if;
  end if;
end;
$$;

create function public.long_stay_deferred_invariant_trigger()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
declare contract_id uuid;
begin
  if tg_table_name='long_stay_contracts' then contract_id:=coalesce(new.id,old.id);
  elsif tg_table_name='hotel_stays' then
    select id into contract_id from public.long_stay_contracts where current_hotel_stay_id=coalesce(new.id,old.id);
  elsif tg_table_name='hotel_capacity_reservations' then
    select contract.id into contract_id from public.long_stay_contracts contract
    where contract.current_hotel_stay_id=coalesce(new.hotel_stay_id,old.hotel_stay_id);
  else
    select contract.id into contract_id from public.long_stay_contracts contract
    join public.hotel_capacity_reservations capacity on capacity.hotel_stay_id=contract.current_hotel_stay_id
    where capacity.id=coalesce(new.capacity_reservation_id,old.capacity_reservation_id);
  end if;
  if contract_id is not null then perform public.assert_long_stay_runtime_invariant_internal(contract_id); end if;
  return null;
end;
$$;

create constraint trigger long_stay_contract_runtime_invariant
after insert or update on public.long_stay_contracts deferrable initially deferred
for each row execute function public.long_stay_deferred_invariant_trigger();
create constraint trigger long_stay_hotel_stay_runtime_invariant
after update on public.hotel_stays deferrable initially deferred
for each row execute function public.long_stay_deferred_invariant_trigger();
create constraint trigger long_stay_capacity_runtime_invariant
after insert or update on public.hotel_capacity_reservations deferrable initially deferred
for each row execute function public.long_stay_deferred_invariant_trigger();
create constraint trigger long_stay_allocation_runtime_invariant
after insert or update on public.hotel_room_allocations deferrable initially deferred
for each row execute function public.long_stay_deferred_invariant_trigger();

create function public.create_long_stay_contract(
  p_customer_id uuid,p_dog_id uuid,p_started_on date,p_planned_check_out_date date,
  p_preferred_room_type_id uuid,p_preferred_room_id uuid,p_monthly_rate numeric,
  p_billing_anchor_day integer,p_memo text,p_request_id uuid
) returns jsonb language plpgsql security definer
set search_path = public, pg_temp
as $$
declare actor_id uuid:=auth.uid(); replay jsonb; payload jsonb; contract_id uuid;
begin
  if actor_id is null or not public.has_operation_role(array['owner','manager']) then
    raise exception '장기호텔 계약 등록 권한이 없습니다.' using errcode='42501'; end if;
  payload:=jsonb_build_object('customerId',p_customer_id,'dogId',p_dog_id,
    'startedOn',p_started_on,'plannedCheckOutDate',p_planned_check_out_date,
    'preferredRoomTypeId',p_preferred_room_type_id,'preferredRoomId',p_preferred_room_id,
    'monthlyRate',p_monthly_rate,'billingAnchorDay',p_billing_anchor_day,
    'memo',nullif(btrim(p_memo),''));
  replay:=public.long_stay_replay_internal(p_request_id,'create_contract',payload);
  if replay is not null then return replay; end if;
  if p_customer_id is null or p_dog_id is null or p_started_on is null
    or p_planned_check_out_date<p_started_on then raise exception '장기호텔 계약 입력이 올바르지 않습니다.' using errcode='22023'; end if;
  if not exists(select 1 from public.dogs dog join public.customers customer on customer.id=dog.customer_id
    where dog.id=p_dog_id and customer.id=p_customer_id and dog.is_active and customer.is_active) then
    raise exception '활성 반려견과 보호자 관계를 확인해 주세요.' using errcode='22023'; end if;
  insert into public.long_stay_contracts(customer_id,dog_id,started_on,planned_check_out_date,
    preferred_room_type_id,preferred_room_id,monthly_rate,billing_anchor_day,memo,
    create_request_id,created_by,updated_by)
  values(p_customer_id,p_dog_id,p_started_on,p_planned_check_out_date,p_preferred_room_type_id,
    p_preferred_room_id,p_monthly_rate,p_billing_anchor_day,nullif(btrim(p_memo),''),
    p_request_id,actor_id,actor_id) returning id into contract_id;
  perform public.long_stay_record_operation_internal(contract_id,null,null,'create_contract',
    p_request_id,payload,null,'{}','장기호텔 계약 등록',actor_id);
  return public.long_stay_contract_projection_internal(contract_id)||jsonb_build_object('replayed',false);
end;
$$;

-- Monthly confirmation is the only command that creates or hands off the
-- open-ended Hotel runtime. The same active Capacity row is reused.
create function public.confirm_long_stay_month(
  p_contract_id uuid,p_expected_contract_version integer,p_service_month date,
  p_calendar_id uuid,p_schedule_type_id uuid,p_check_in_time time,
  p_check_in_time_unspecified boolean,p_room_type_id uuid,p_room_id uuid,
  p_assignee_ids uuid[],p_reason text,p_request_id uuid
) returns jsonb language plpgsql security definer
set search_path = public, pg_temp
as $$
declare actor_id uuid:=auth.uid(); contract_row public.long_stay_contracts%rowtype;
declare replay jsonb; payload jsonb; runtime_input jsonb; stay_result jsonb;
declare stay_id uuid; capacity_row public.hotel_capacity_reservations%rowtype;
declare allocation_row public.hotel_room_allocations%rowtype; occupancy_id uuid;
declare month_from timestamptz; month_until timestamptz; child_create uuid; child_checkin uuid; child_checkout uuid;
declare child_room uuid; required_events text[]; new_type_code text; new_room_name text;
begin
  if actor_id is null or not public.is_active_operation_member() then raise exception '장기호텔 월 확정 권한이 없습니다.' using errcode='42501'; end if;
  payload:=jsonb_build_object('contractId',p_contract_id,'serviceMonth',date_trunc('month',p_service_month)::date,
    'roomTypeId',p_room_type_id,'roomId',p_room_id,'calendarId',p_calendar_id,
    'scheduleTypeId',p_schedule_type_id,'checkInTime',p_check_in_time,
    'checkInTimeUnspecified',coalesce(p_check_in_time_unspecified,false),
    'assigneeIds',(select coalesce(jsonb_agg(id order by id),'[]') from unnest(coalesce(p_assignee_ids,'{}')) id),
    'reason',nullif(btrim(p_reason),''));
  replay:=public.long_stay_replay_internal(p_request_id,'confirm_month',payload); if replay is not null then return replay; end if;
  select * into contract_row from public.long_stay_contracts where id=p_contract_id and archived_at is null for update;
  if not found then raise exception '장기호텔 계약을 찾을 수 없습니다.' using errcode='P0002'; end if;
  if contract_row.version<>p_expected_contract_version then raise exception '다른 사용자가 먼저 장기호텔 계약을 변경했습니다.' using errcode='40001'; end if;
  if contract_row.status not in ('pending','active') then raise exception '진행 중인 장기호텔 계약만 월 확정할 수 있습니다.' using errcode='22023'; end if;
  if p_service_month<>date_trunc('month',p_service_month)::date then raise exception 'service_month는 월 첫 날짜여야 합니다.' using errcode='22023'; end if;
  if exists(select 1 from public.long_stay_monthly_occupancies where long_stay_contract_id=p_contract_id and service_month=p_service_month and status='confirmed' and archived_at is null) then
    raise exception '해당 월은 이미 확정되었습니다.' using errcode='23505'; end if;
  month_from:=greatest(p_service_month::timestamp at time zone 'Asia/Seoul',contract_row.started_on::timestamp at time zone 'Asia/Seoul');
  month_until:=least((p_service_month+interval '1 month')::timestamp at time zone 'Asia/Seoul',
    coalesce((contract_row.planned_check_out_date+1)::timestamp at time zone 'Asia/Seoul','infinity'::timestamptz));
  if month_until<=month_from then raise exception '계약 기간 밖의 월은 확정할 수 없습니다.' using errcode='22023'; end if;
  child_create:=public.long_stay_internal_request_id(p_request_id,'confirm_month',p_contract_id,'create-runtime');
  child_checkin:=public.long_stay_internal_request_id(p_request_id,'confirm_month',p_contract_id,'check-in-schedule');
  child_checkout:=public.long_stay_internal_request_id(p_request_id,'confirm_month',p_contract_id,'check-out-schedule');
  child_room:=public.long_stay_internal_request_id(p_request_id,'confirm_month',p_contract_id,'room');
  if contract_row.current_hotel_stay_id is null then
    runtime_input:=public.prepare_hotel_reservation_runtime_input_extended_internal(
      p_calendar_id,p_schedule_type_id,contract_row.started_on,p_check_in_time,
      p_check_in_time_unspecified,contract_row.planned_check_out_date,null,true,
      contract_row.planned_check_out_date is not null,'infinity'::timestamptz,
      p_room_type_id,contract_row.dog_id,contract_row.customer_id,p_assignee_ids,contract_row.memo);
    stay_result:=public.create_hotel_reservation_runtime_extended_internal(
      p_calendar_id,p_schedule_type_id,contract_row.dog_id,p_room_type_id,p_assignee_ids,
      contract_row.memo,actor_id,child_create,child_checkin,
      case when contract_row.planned_check_out_date is null then null else child_checkout end,
      runtime_input,contract_row.planned_check_out_date is not null);
    stay_id:=(stay_result->>'id')::uuid;
    select * into capacity_row from public.hotel_capacity_reservations where hotel_stay_id=stay_id and archived_at is null for update;
    perform public.assert_hotel_room_allocation_available(p_room_id,capacity_row.id,capacity_row.reserved_from,'infinity'::timestamptz,null);
    insert into public.hotel_room_allocations(capacity_reservation_id,room_id,allocated_from,allocated_until,assignment_reason,request_id,created_by,updated_by)
    values(capacity_row.id,p_room_id,capacity_row.reserved_from,'infinity'::timestamptz,btrim(p_reason),child_room,actor_id,actor_id);
    update public.long_stay_contracts set current_hotel_stay_id=stay_id,updated_by=actor_id,updated_at=clock_timestamp(),version=version+1 where id=p_contract_id;
  else
    stay_id:=contract_row.current_hotel_stay_id;
    select * into capacity_row from public.hotel_capacity_reservations where hotel_stay_id=stay_id and archived_at is null for update;
    select allocation.* into allocation_row from public.hotel_room_allocations allocation where allocation.capacity_reservation_id=capacity_row.id and allocation.archived_at is null and allocation.allocated_until='infinity'::timestamptz order by allocated_from desc limit 1 for update;
    if allocation_row.room_id is distinct from p_room_id or capacity_row.room_type_id is distinct from p_room_type_id then
      if capacity_row.room_type_id is distinct from p_room_type_id then
        if not public.has_operation_role(array['owner','manager']) then raise exception '객실 유형 변경 권한이 없습니다.' using errcode='42501'; end if;
        select code into new_type_code from public.hotel_room_types where id=p_room_type_id and is_active and archived_at is null;
        select name into new_room_name from public.hotel_rooms where id=p_room_id and room_type_id=p_room_type_id and is_active and archived_at is null;
        if new_type_code is null or new_room_name is null then raise exception '대상 객실 유형과 호실을 확인해 주세요.' using errcode='P0002'; end if;
        required_events:=case when contract_row.planned_check_out_date is null then array['check_in']::text[] else array['check_in','check_out']::text[] end;
        perform public.change_hotel_room_type_and_allocation_extended_internal(
          case when (select checked_in_at is null from public.hotel_stays where id=stay_id) then 'before_check_in' else 'after_check_in' end,
          stay_id,(select version from public.hotel_stays where id=stay_id),p_room_id,p_room_type_id,new_type_code,new_room_name,
          case when (select checked_in_at is null from public.hotel_stays where id=stay_id) then capacity_row.reserved_from else clock_timestamp() end,
          btrim(p_reason),'장기호텔 월 객실 유형 확정',actor_id,child_room,required_events);
      else
        if (select checked_in_at is null from public.hotel_stays where id=stay_id) then
          perform public.reassign_hotel_room_before_check_in(stay_id,(select version from public.hotel_stays where id=stay_id),p_room_id,btrim(p_reason),child_room);
        else
          perform public.move_hotel_room_same_type(stay_id,(select version from public.hotel_stays where id=stay_id),p_room_id,clock_timestamp(),btrim(p_reason),child_room);
        end if;
      end if;
    end if;
    update public.long_stay_contracts set updated_by=actor_id,updated_at=clock_timestamp(),version=version+1 where id=p_contract_id;
  end if;
  select * into capacity_row from public.hotel_capacity_reservations where hotel_stay_id=stay_id and archived_at is null;
  insert into public.long_stay_monthly_occupancies(long_stay_contract_id,hotel_stay_id,service_month,
    planned_occupied_from,planned_occupied_until_exclusive,room_type_id,room_id,
    runtime_capacity_reservation_id,request_id,created_by,updated_by)
  values(p_contract_id,stay_id,p_service_month,month_from,month_until,p_room_type_id,p_room_id,
    capacity_row.id,p_request_id,actor_id,actor_id) returning id into occupancy_id;
  perform public.long_stay_record_operation_internal(p_contract_id,occupancy_id,null,'confirm_month',p_request_id,payload,
    public.long_stay_contract_projection_internal(p_contract_id),
    array_remove(array[child_create,child_checkin,child_checkout,child_room],null),p_reason,actor_id);
  return public.long_stay_contract_projection_internal(p_contract_id)||jsonb_build_object('replayed',false,'monthlyOccupancyId',occupancy_id);
end;
$$;

create function public.complete_long_stay_check_in(p_contract_id uuid,p_expected_contract_version integer,p_expected_stay_version integer,p_completed_at timestamptz,p_reason text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor_id uuid:=auth.uid(); c public.long_stay_contracts%rowtype; replay jsonb; payload jsonb; child uuid;
begin
 if actor_id is null or not public.is_active_operation_member() then raise exception '장기호텔 입실 권한이 없습니다.' using errcode='42501'; end if;
 payload:=jsonb_build_object('contractId',p_contract_id,'completedAt',p_completed_at,'reason',nullif(btrim(p_reason),'')); replay:=public.long_stay_replay_internal(p_request_id,'complete_check_in',payload); if replay is not null then return replay; end if;
 select * into c from public.long_stay_contracts where id=p_contract_id and archived_at is null for update; if not found then raise exception '장기호텔 계약을 찾을 수 없습니다.' using errcode='P0002'; end if;
 if c.version<>p_expected_contract_version then raise exception '다른 사용자가 먼저 변경했습니다.' using errcode='40001'; end if;
 child:=public.long_stay_internal_request_id(p_request_id,'complete_check_in',p_contract_id,'hotel'); perform public.complete_hotel_check_in(c.current_hotel_stay_id,p_expected_stay_version,p_completed_at,child);
 update public.long_stay_contracts set status='active',version=version+1,updated_by=actor_id,updated_at=clock_timestamp() where id=p_contract_id;
 perform public.long_stay_record_operation_internal(p_contract_id,null,null,'complete_check_in',p_request_id,payload,null,array[child],p_reason,actor_id);
 return public.long_stay_contract_projection_internal(p_contract_id)||jsonb_build_object('replayed',false);
end; $$;

create function public.start_long_stay_absence(p_contract_id uuid,p_expected_contract_version integer,p_left_at timestamptz,p_expected_return_at timestamptz,p_memo text,p_reason text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor_id uuid:=auth.uid(); c public.long_stay_contracts%rowtype; replay jsonb; payload jsonb; event_id uuid;
begin
 if actor_id is null or not public.is_active_operation_member() then raise exception '외출 기록 권한이 없습니다.' using errcode='42501'; end if;
 payload:=jsonb_build_object('contractId',p_contract_id,'leftAt',p_left_at,'expectedReturnAt',p_expected_return_at,'memo',nullif(btrim(p_memo),''),'reason',nullif(btrim(p_reason),'')); replay:=public.long_stay_replay_internal(p_request_id,'start_absence',payload); if replay is not null then return replay; end if;
 select * into c from public.long_stay_contracts where id=p_contract_id and archived_at is null for update; if c.version<>p_expected_contract_version then raise exception '다른 사용자가 먼저 변경했습니다.' using errcode='40001'; end if;
 if c.status<>'active' or p_left_at is null or exists(select 1 from public.long_stay_absence_events l where l.long_stay_contract_id=p_contract_id and l.event_type='leave' and l.is_open and l.archived_at is null) then raise exception '현재 외출 상태를 확인해 주세요.' using errcode='23505'; end if;
  insert into public.long_stay_absence_events(long_stay_contract_id,hotel_stay_id,event_type,is_open,occurred_at,expected_return_at,memo,reason,request_id,created_by)
  values(p_contract_id,c.current_hotel_stay_id,'leave',true,p_left_at,p_expected_return_at,nullif(btrim(p_memo),''),btrim(p_reason),p_request_id,actor_id) returning id into event_id;
 update public.long_stay_contracts set version=version+1,updated_by=actor_id,updated_at=clock_timestamp() where id=p_contract_id;
 perform public.long_stay_record_operation_internal(p_contract_id,null,event_id,'start_absence',p_request_id,payload,null,'{}',p_reason,actor_id);
 return public.long_stay_contract_projection_internal(p_contract_id)||jsonb_build_object('replayed',false);
end; $$;

create function public.complete_long_stay_absence(p_contract_id uuid,p_expected_contract_version integer,p_returned_at timestamptz,p_memo text,p_reason text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor_id uuid:=auth.uid(); c public.long_stay_contracts%rowtype; leave_id uuid; replay jsonb; payload jsonb; event_id uuid;
begin
 if actor_id is null or not public.is_active_operation_member() then raise exception '복귀 기록 권한이 없습니다.' using errcode='42501'; end if;
 payload:=jsonb_build_object('contractId',p_contract_id,'returnedAt',p_returned_at,'memo',nullif(btrim(p_memo),''),'reason',nullif(btrim(p_reason),'')); replay:=public.long_stay_replay_internal(p_request_id,'complete_absence',payload); if replay is not null then return replay; end if;
 select * into c from public.long_stay_contracts where id=p_contract_id and archived_at is null for update; if c.version<>p_expected_contract_version then raise exception '다른 사용자가 먼저 변경했습니다.' using errcode='40001'; end if;
  select l.id into leave_id from public.long_stay_absence_events l where l.long_stay_contract_id=p_contract_id and l.event_type='leave' and l.is_open and l.archived_at is null for update;
 if leave_id is null then raise exception '복귀 처리할 외출 기록이 없습니다.' using errcode='P0002'; end if;
  insert into public.long_stay_absence_events(long_stay_contract_id,hotel_stay_id,event_type,paired_leave_event_id,occurred_at,memo,reason,request_id,created_by)
  values(p_contract_id,c.current_hotel_stay_id,'return',leave_id,p_returned_at,nullif(btrim(p_memo),''),btrim(p_reason),p_request_id,actor_id) returning id into event_id;
 update public.long_stay_absence_events set is_open=false where id=leave_id;
 update public.long_stay_contracts set version=version+1,updated_by=actor_id,updated_at=clock_timestamp() where id=p_contract_id;
 perform public.long_stay_record_operation_internal(p_contract_id,null,event_id,'complete_absence',p_request_id,payload,null,'{}',p_reason,actor_id);
 return public.long_stay_contract_projection_internal(p_contract_id)||jsonb_build_object('replayed',false);
end; $$;

-- Planned checkout lifecycle uses the official schedule create/update RPCs.
create function public.set_long_stay_planned_checkout(p_contract_id uuid,p_expected_contract_version integer,p_planned_check_out_date date,p_calendar_id uuid,p_schedule_type_id uuid,p_check_out_time time,p_time_unspecified boolean,p_assignee_ids uuid[],p_reason text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor_id uuid:=auth.uid(); c public.long_stay_contracts%rowtype; s public.hotel_stays%rowtype; event_row public.hotel_stay_schedule_events%rowtype; schedule_row public.operation_schedules%rowtype; payload jsonb; replay jsonb; child uuid; result jsonb; starts timestamptz;
begin
 if actor_id is null or not public.has_operation_role(array['owner','manager']) then raise exception '퇴실 예정 변경 권한이 없습니다.' using errcode='42501'; end if;
 payload:=jsonb_build_object('contractId',p_contract_id,'plannedCheckOutDate',p_planned_check_out_date,'calendarId',p_calendar_id,'scheduleTypeId',p_schedule_type_id,'checkOutTime',p_check_out_time,'timeUnspecified',coalesce(p_time_unspecified,false),'assigneeIds',(select coalesce(jsonb_agg(id order by id),'[]') from unnest(coalesce(p_assignee_ids,'{}')) id),'reason',nullif(btrim(p_reason),'')); replay:=public.long_stay_replay_internal(p_request_id,'set_planned_checkout',payload); if replay is not null then return replay; end if;
 select * into c from public.long_stay_contracts where id=p_contract_id and archived_at is null for update; if c.version<>p_expected_contract_version then raise exception '다른 사용자가 먼저 변경했습니다.' using errcode='40001'; end if;
 if c.status not in ('pending','active') or p_planned_check_out_date<c.started_on then raise exception '퇴실 예정일 계약이 올바르지 않습니다.' using errcode='22023'; end if;
 select * into s from public.hotel_stays where id=c.current_hotel_stay_id for update; if not found or s.checked_out_at is not null then raise exception '진행 중인 Hotel Stay가 필요합니다.' using errcode='P0002'; end if;
 select e.* into event_row from public.hotel_stay_schedule_events e where e.hotel_stay_id=s.id and e.event_kind='check_out' and e.archived_at is null for update;
 child:=public.long_stay_internal_request_id(p_request_id,'set_planned_checkout',p_contract_id,'schedule');
 if p_planned_check_out_date is null then
   if event_row.id is not null then update public.hotel_stay_schedule_events set archived_at=clock_timestamp(),archived_by=actor_id,archive_reason=btrim(p_reason),updated_by=actor_id where id=event_row.id; update public.operation_schedules set archived_at=clock_timestamp(),archived_by=actor_id,archive_reason=btrim(p_reason),updated_by=actor_id where id=event_row.operation_schedule_id; end if;
 else
   starts:=case when coalesce(p_time_unspecified,false) then p_planned_check_out_date::timestamp at time zone 'Asia/Seoul' else (p_planned_check_out_date::timestamp+p_check_out_time) at time zone 'Asia/Seoul' end;
   if event_row.id is null then
     result:=public.create_operation_schedule(p_calendar_id,p_schedule_type_id,(select dog.name from public.dogs dog where dog.id=c.dog_id)||' · 호텔링 · 퇴실',starts,starts+interval '1 hour',false,coalesce(p_time_unspecified,false),c.memo,p_assignee_ids,array[c.customer_id],array[c.dog_id],child);
     insert into public.hotel_stay_schedule_events(hotel_stay_id,operation_schedule_id,event_kind,created_by,updated_by) values(s.id,(result->>'id')::uuid,'check_out',actor_id,actor_id);
   else
     select * into schedule_row from public.operation_schedules where id=event_row.operation_schedule_id for update;
     perform public.update_operation_schedule(schedule_row.id,schedule_row.version,p_calendar_id,p_schedule_type_id,schedule_row.title,starts,starts+interval '1 hour',false,coalesce(p_time_unspecified,false),c.memo,p_assignee_ids,array[c.customer_id],array[c.dog_id],child);
   end if;
 end if;
 update public.long_stay_contracts set planned_check_out_date=p_planned_check_out_date,version=version+1,updated_by=actor_id,updated_at=clock_timestamp() where id=p_contract_id;
 perform public.long_stay_record_operation_internal(p_contract_id,null,null,'set_planned_checkout',p_request_id,payload,null,array[child],p_reason,actor_id);
 return public.long_stay_contract_projection_internal(p_contract_id)||jsonb_build_object('replayed',false);
end; $$;

create function public.complete_long_stay_check_out(p_contract_id uuid,p_expected_contract_version integer,p_expected_stay_version integer,p_completed_at timestamptz,p_reason text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor_id uuid:=auth.uid(); c public.long_stay_contracts%rowtype; replay jsonb; payload jsonb; child uuid; effective timestamptz:=coalesce(p_completed_at,clock_timestamp());
begin
 if actor_id is null or not public.is_active_operation_member() then raise exception '장기호텔 퇴실 권한이 없습니다.' using errcode='42501'; end if;
 payload:=jsonb_build_object('contractId',p_contract_id,'completedAt',effective,'reason',nullif(btrim(p_reason),'')); replay:=public.long_stay_replay_internal(p_request_id,'complete_check_out',payload); if replay is not null then return replay; end if;
 select * into c from public.long_stay_contracts where id=p_contract_id and archived_at is null for update; if c.version<>p_expected_contract_version then raise exception '다른 사용자가 먼저 변경했습니다.' using errcode='40001'; end if;
 child:=public.long_stay_internal_request_id(p_request_id,'complete_check_out',p_contract_id,'hotel'); perform public.complete_hotel_check_out(c.current_hotel_stay_id,p_expected_stay_version,effective,child);
 update public.hotel_capacity_reservations set reserved_until=effective,updated_by=actor_id where hotel_stay_id=c.current_hotel_stay_id and archived_at is null;
 update public.hotel_room_allocations allocation set allocated_until=effective,updated_by=actor_id from public.hotel_capacity_reservations capacity where allocation.capacity_reservation_id=capacity.id and capacity.hotel_stay_id=c.current_hotel_stay_id and capacity.archived_at is null and allocation.archived_at is null and allocation.allocated_until='infinity'::timestamptz;
 update public.long_stay_contracts set status='completed',completed_at=effective,completed_by=actor_id,version=version+1,updated_by=actor_id,updated_at=clock_timestamp() where id=p_contract_id;
 perform public.long_stay_record_operation_internal(p_contract_id,null,null,'complete_check_out',p_request_id,payload,null,array[child],p_reason,actor_id);
 return public.long_stay_contract_projection_internal(p_contract_id)||jsonb_build_object('replayed',false);
end; $$;

create function public.reverse_long_stay_completion(p_contract_id uuid,p_expected_contract_version integer,p_expected_stay_version integer,p_reason text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor_id uuid:=auth.uid(); c public.long_stay_contracts%rowtype; replay jsonb; payload jsonb; child uuid;
begin
 if actor_id is null or not public.has_operation_role(array['owner','manager']) then raise exception '장기호텔 완료 취소 권한이 없습니다.' using errcode='42501'; end if;
 payload:=jsonb_build_object('contractId',p_contract_id,'reason',nullif(btrim(p_reason),'')); replay:=public.long_stay_replay_internal(p_request_id,'reverse_completion',payload); if replay is not null then return replay; end if;
 select * into c from public.long_stay_contracts where id=p_contract_id and archived_at is null for update; if c.version<>p_expected_contract_version then raise exception '다른 사용자가 먼저 변경했습니다.' using errcode='40001'; end if;
 child:=public.long_stay_internal_request_id(p_request_id,'reverse_completion',p_contract_id,'hotel'); perform public.reverse_hotel_completion(c.current_hotel_stay_id,p_expected_stay_version,'check_out',btrim(p_reason),child);
 update public.hotel_capacity_reservations set reserved_until='infinity'::timestamptz,updated_by=actor_id where hotel_stay_id=c.current_hotel_stay_id and archived_at is null;
 update public.hotel_room_allocations allocation set allocated_until='infinity'::timestamptz,updated_by=actor_id from public.hotel_capacity_reservations capacity where allocation.capacity_reservation_id=capacity.id and capacity.hotel_stay_id=c.current_hotel_stay_id and capacity.archived_at is null and allocation.archived_at is null and allocation.allocated_until=(select max(a.allocated_until) from public.hotel_room_allocations a where a.capacity_reservation_id=capacity.id and a.archived_at is null);
 update public.long_stay_contracts set status='active',completed_at=null,completed_by=null,version=version+1,updated_by=actor_id,updated_at=clock_timestamp() where id=p_contract_id;
 perform public.long_stay_record_operation_internal(p_contract_id,null,null,'reverse_completion',p_request_id,payload,null,array[child],p_reason,actor_id);
 return public.long_stay_contract_projection_internal(p_contract_id)||jsonb_build_object('replayed',false);
end; $$;

create function public.get_long_stay_contract(p_contract_id uuid) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$ begin if not public.is_active_operation_member() then raise exception '장기호텔 조회 권한이 없습니다.' using errcode='42501'; end if; return public.long_stay_contract_projection_internal(p_contract_id); end; $$;
create function public.get_customer_long_stays(p_customer_id uuid) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$ declare result jsonb; begin if not public.is_active_operation_member() then raise exception '장기호텔 조회 권한이 없습니다.' using errcode='42501'; end if; select coalesce(jsonb_agg(public.long_stay_contract_projection_internal(id) order by created_at desc),'[]') into result from public.long_stay_contracts where customer_id=p_customer_id and archived_at is null; return result; end; $$;
create function public.get_long_stay_month(p_service_month date) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$ declare result jsonb; begin if not public.is_active_operation_member() then raise exception '장기호텔 조회 권한이 없습니다.' using errcode='42501'; end if; if p_service_month<>date_trunc('month',p_service_month)::date then raise exception 'service_month는 월 첫 날짜여야 합니다.' using errcode='22023'; end if; select jsonb_build_object('serviceMonth',p_service_month,'contracts',coalesce(jsonb_agg(public.long_stay_contract_projection_internal(c.id)||jsonb_build_object('monthlyOccupancy',case when o.id is null then null else jsonb_build_object('id',o.id,'status',o.status,'roomTypeId',o.room_type_id,'roomId',o.room_id,'plannedOccupiedFrom',o.planned_occupied_from,'plannedOccupiedUntilExclusive',o.planned_occupied_until_exclusive,'billingSourceId',o.id) end,'monthlyState',case when o.id is null then 'unassigned' when o.status='cancelled' then 'cancelled' when (clock_timestamp() at time zone 'Asia/Seoul')::date<p_service_month then 'upcoming' when (clock_timestamp() at time zone 'Asia/Seoul')::date>=p_service_month+interval '1 month' then 'completed' else 'active' end) order by c.created_at),'[]')) into result from public.long_stay_contracts c left join public.long_stay_monthly_occupancies o on o.long_stay_contract_id=c.id and o.service_month=p_service_month and o.archived_at is null where c.archived_at is null and c.status in ('pending','active'); return result; end; $$;

alter table public.long_stay_contracts enable row level security;
alter table public.long_stay_monthly_occupancies enable row level security;
alter table public.long_stay_absence_events enable row level security;
alter table public.long_stay_operation_audit_events enable row level security;
revoke all on table public.long_stay_contracts,public.long_stay_monthly_occupancies,public.long_stay_absence_events,public.long_stay_operation_audit_events from public,anon,authenticated,service_role;

-- Internal surface: owner/postgres only.
revoke all on function public.long_stay_internal_request_id(uuid,text,uuid,text),public.long_stay_payload_hash_internal(jsonb),public.long_stay_contract_projection_internal(uuid),public.long_stay_replay_internal(uuid,text,jsonb),public.long_stay_record_operation_internal(uuid,uuid,uuid,text,uuid,jsonb,jsonb,uuid[],text,uuid),public.assert_long_stay_runtime_invariant_internal(uuid),public.long_stay_deferred_invariant_trigger() from public,anon,authenticated,service_role;

revoke all on function public.create_long_stay_contract(uuid,uuid,date,date,uuid,uuid,numeric,integer,text,uuid),public.confirm_long_stay_month(uuid,integer,date,uuid,uuid,time,boolean,uuid,uuid,uuid[],text,uuid),public.complete_long_stay_check_in(uuid,integer,integer,timestamptz,text,uuid),public.start_long_stay_absence(uuid,integer,timestamptz,timestamptz,text,text,uuid),public.complete_long_stay_absence(uuid,integer,timestamptz,text,text,uuid),public.set_long_stay_planned_checkout(uuid,integer,date,uuid,uuid,time,boolean,uuid[],text,uuid),public.complete_long_stay_check_out(uuid,integer,integer,timestamptz,text,uuid),public.reverse_long_stay_completion(uuid,integer,integer,text,uuid),public.get_long_stay_contract(uuid),public.get_customer_long_stays(uuid),public.get_long_stay_month(date) from public,anon;

grant execute on function public.create_long_stay_contract(uuid,uuid,date,date,uuid,uuid,numeric,integer,text,uuid),public.confirm_long_stay_month(uuid,integer,date,uuid,uuid,time,boolean,uuid,uuid,uuid[],text,uuid),public.complete_long_stay_check_in(uuid,integer,integer,timestamptz,text,uuid),public.start_long_stay_absence(uuid,integer,timestamptz,timestamptz,text,text,uuid),public.complete_long_stay_absence(uuid,integer,timestamptz,text,text,uuid),public.set_long_stay_planned_checkout(uuid,integer,date,uuid,uuid,time,boolean,uuid[],text,uuid),public.complete_long_stay_check_out(uuid,integer,integer,timestamptz,text,uuid),public.reverse_long_stay_completion(uuid,integer,integer,text,uuid),public.get_long_stay_contract(uuid),public.get_customer_long_stays(uuid),public.get_long_stay_month(date) to authenticated,service_role;

commit;
