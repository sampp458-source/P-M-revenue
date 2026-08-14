-- GENERATED FILE: do not edit or assemble by hand.
-- Dashboard phase: MIGRATION
-- Production exact project: zorvcuskzemehblqdbfj
-- Clean QA project wxbvwixoeczfvbqurdse is rejected before any mutation.
-- Approved migration SHA-256: 6bd23b9c74d8d4ca7d2ff2a33f3c992f3f8d7adb6a6c6f26e56b92c41ebf7de9
-- Embedded source SHA-256: 6bd23b9c74d8d4ca7d2ff2a33f3c992f3f8d7adb6a6c6f26e56b92c41ebf7de9
-- Long Stay Outing Inventory V1
-- KEEP_ROOM remains backward compatible. RELEASE_ROOM creates a sellable gap
-- while reserving room-type capacity from the expected-return boundary.
begin;
-- PRODUCTION_DASHBOARD_BINDING_BEGIN
select set_config('app.release_project_ref','zorvcuskzemehblqdbfj',true);
select set_config('app.release_migration_sha256','6bd23b9c74d8d4ca7d2ff2a33f3c992f3f8d7adb6a6c6f26e56b92c41ebf7de9',true);
do $production_dashboard_binding$
begin
  if current_database()<>'postgres' or current_user<>'postgres'
    or current_setting('app.release_project_ref',true) is distinct from 'zorvcuskzemehblqdbfj'
    or current_setting('app.release_project_ref',true)='wxbvwixoeczfvbqurdse'
    or current_setting('app.release_migration_sha256',true) is distinct from '6bd23b9c74d8d4ca7d2ff2a33f3c992f3f8d7adb6a6c6f26e56b92c41ebf7de9'
    or to_regclass('hotel_qa.environment_guard') is not null then
    raise exception 'STOP_LONG_STAY_OUTING_INVENTORY_PRODUCTION_DASHBOARD_BINDING';
  end if;
end;
$production_dashboard_binding$;
-- PRODUCTION_DASHBOARD_BINDING_END


do $$
begin
  if to_regprocedure('public.start_long_stay_absence_v3(uuid,integer,timestamp with time zone,date,time without time zone,boolean,text,text,text,uuid)') is not null
    or exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name='long_stay_absence_events'
        and column_name='inventory_mode'
    ) then
    raise exception 'STOP_LONG_STAY_OUTING_INVENTORY_V1_ALREADY_APPLIED';
  end if;
  if to_regprocedure('public.start_long_stay_absence_v2(uuid,integer,timestamp with time zone,date,time without time zone,boolean,text,text,uuid)') is null
    or to_regprocedure('public.complete_long_stay_absence(uuid,integer,timestamp with time zone,text,text,uuid)') is null
    or to_regprocedure('public.assert_hotel_total_capacity_available(timestamp with time zone,timestamp with time zone,integer,uuid)') is null
    or to_regprocedure('public.assert_hotel_room_allocation_available(uuid,uuid,timestamp with time zone,timestamp with time zone,uuid)') is null then
    raise exception 'STOP_LONG_STAY_OUTING_INVENTORY_V1_BASELINE_MISSING';
  end if;
end;
$$;

alter table public.long_stay_absence_events
  add column inventory_mode text not null default 'keep_room',
  add column previous_room_id uuid null references public.hotel_rooms(id) on delete restrict,
  add column released_allocation_id uuid null references public.hotel_room_allocations(id) on delete restrict,
  add column released_capacity_id uuid null references public.hotel_capacity_reservations(id) on delete restrict,
  add column return_capacity_id uuid null references public.hotel_capacity_reservations(id) on delete restrict,
  add column guarantee_from timestamptz null,
  add column returned_room_id uuid null references public.hotel_rooms(id) on delete restrict,
  add column returned_allocation_id uuid null references public.hotel_room_allocations(id) on delete restrict,
  add column inventory_transition_status text not null default 'room_retained';

alter table public.long_stay_absence_events
  add constraint long_stay_absence_inventory_mode_chk
    check (inventory_mode in ('keep_room','release_room')),
  add constraint long_stay_absence_inventory_status_chk
    check (inventory_transition_status in ('room_retained','room_released','room_returned')),
  add constraint long_stay_absence_inventory_semantics_chk check (
    event_type='return'
    or (
      inventory_mode='keep_room'
      and inventory_transition_status='room_retained'
      and previous_room_id is null
      and released_allocation_id is null
      and released_capacity_id is null
      and return_capacity_id is null
      and guarantee_from is null
      and returned_room_id is null
      and returned_allocation_id is null
    )
    or (
      inventory_mode='release_room'
      and expected_return_date is not null
      and guarantee_from is not null
      and previous_room_id is not null
      and released_allocation_id is not null
      and released_capacity_id is not null
      and return_capacity_id is not null
      and (
        (inventory_transition_status='room_released'
          and returned_room_id is null and returned_allocation_id is null)
        or
        (inventory_transition_status='room_returned'
          and returned_room_id is not null and returned_allocation_id is not null)
      )
    )
  );

create index long_stay_absence_inventory_capacity_idx
  on public.long_stay_absence_events(return_capacity_id)
  where inventory_mode='release_room' and archived_at is null;

comment on column public.long_stay_absence_events.inventory_mode is
  'keep_room preserves physical inventory; release_room releases it until guarantee_from.';
comment on column public.long_stay_absence_events.guarantee_from is
  'Computed inventory boundary. Date-only expected return uses KST start-of-day without fabricating expected_return_at.';

create or replace function public.long_stay_current_absence_projection_internal(p_contract_id uuid)
returns jsonb language sql stable security definer
set search_path=public,pg_temp
as $$
  select jsonb_build_object(
    'currentAbsence', case when leave_event.id is null then null else jsonb_build_object(
      'id',leave_event.id,
      'leftAt',leave_event.occurred_at,
      'expectedReturnAt',leave_event.expected_return_at,
      'expectedReturnDate',coalesce(
        leave_event.expected_return_date,
        (leave_event.expected_return_at at time zone 'Asia/Seoul')::date
      ),
      'expectedReturnTimeUnspecified',case
        when leave_event.expected_return_date is null and leave_event.expected_return_at is null then true
        else leave_event.expected_return_time_unspecified
      end,
      'inventoryMode',leave_event.inventory_mode,
      'inventoryTransitionStatus',leave_event.inventory_transition_status,
      'guaranteeFrom',leave_event.guarantee_from,
      'previousRoom',case when previous_room.id is null then null else jsonb_build_object(
        'id',previous_room.id,'name',previous_room.name,'roomTypeId',previous_room.room_type_id
      ) end,
      'returnRoomTypeId',return_capacity.room_type_id,
      'returnedRoom',case when returned_room.id is null then null else jsonb_build_object(
        'id',returned_room.id,'name',returned_room.name,'roomTypeId',returned_room.room_type_id
      ) end
    ) end
  )
  from (select 1) seed
  left join lateral (
    select event.*
    from public.long_stay_absence_events event
    where event.long_stay_contract_id=p_contract_id
      and event.event_type='leave'
      and event.is_open
      and event.archived_at is null
    order by event.occurred_at desc,event.id
    limit 1
  ) leave_event on true
  left join public.hotel_rooms previous_room on previous_room.id=leave_event.previous_room_id
  left join public.hotel_capacity_reservations return_capacity on return_capacity.id=leave_event.return_capacity_id
  left join public.hotel_rooms returned_room on returned_room.id=leave_event.returned_room_id;
$$;

create or replace function public.assert_long_stay_runtime_invariant_internal(p_contract_id uuid)
returns void language plpgsql stable security definer
set search_path=public,pg_temp
as $$
declare contract_row public.long_stay_contracts%rowtype;
declare stay_row public.hotel_stays%rowtype;
declare leave_row public.long_stay_absence_events%rowtype;
declare capacity_count integer; allocation_count integer;
declare capacity_row public.hotel_capacity_reservations%rowtype;
declare allocation_row public.hotel_room_allocations%rowtype;
begin
  select * into contract_row from public.long_stay_contracts where id=p_contract_id;
  if not found or contract_row.archived_at is not null or contract_row.current_hotel_stay_id is null then return; end if;
  select * into stay_row from public.hotel_stays where id=contract_row.current_hotel_stay_id;
  select * into leave_row from public.long_stay_absence_events event
  where event.long_stay_contract_id=p_contract_id and event.event_type='leave'
    and event.is_open and event.archived_at is null
  order by event.occurred_at desc,event.id limit 1;

  select count(*) into capacity_count from public.hotel_capacity_reservations capacity
  where capacity.hotel_stay_id=stay_row.id and capacity.archived_at is null;
  select * into capacity_row from public.hotel_capacity_reservations capacity
  where capacity.hotel_stay_id=stay_row.id and capacity.archived_at is null
  order by capacity.reserved_from desc limit 1;
  select count(*) into allocation_count
  from public.hotel_room_allocations allocation
  join public.hotel_capacity_reservations capacity on capacity.id=allocation.capacity_reservation_id
  where capacity.hotel_stay_id=stay_row.id and capacity.archived_at is null
    and allocation.archived_at is null and allocation.allocated_until='infinity'::timestamptz;
  select allocation.* into allocation_row
  from public.hotel_room_allocations allocation
  join public.hotel_capacity_reservations capacity on capacity.id=allocation.capacity_reservation_id
  where capacity.hotel_stay_id=stay_row.id and capacity.archived_at is null
    and allocation.archived_at is null and allocation.allocated_until='infinity'::timestamptz
  order by allocation.allocated_from desc limit 1;

  if contract_row.status in ('pending','active') and stay_row.checked_out_at is null then
    if capacity_count<>1 or capacity_row.reserved_until<>'infinity'::timestamptz then
      raise exception 'LONG_STAY_RUNTIME_CAPACITY_INVARIANT_VIOLATION' using errcode='23514';
    end if;
    if leave_row.id is not null and leave_row.inventory_mode='release_room'
      and leave_row.inventory_transition_status='room_released' then
      if capacity_row.id is distinct from leave_row.return_capacity_id
        or capacity_row.reserved_from is distinct from leave_row.guarantee_from
        or allocation_count<>0
        or not exists(select 1 from public.hotel_room_allocations a where a.id=leave_row.released_allocation_id and a.allocated_until=leave_row.occurred_at)
        or not exists(select 1 from public.hotel_capacity_reservations c where c.id=leave_row.released_capacity_id and c.reserved_until=leave_row.occurred_at and c.archived_at is not null) then
        raise exception 'LONG_STAY_OUTING_RELEASED_INVARIANT_VIOLATION' using errcode='23514';
      end if;
    else
      if allocation_count<>1 or allocation_row.allocated_until<>'infinity'::timestamptz
        or not exists(select 1 from public.hotel_rooms room where room.id=allocation_row.room_id and room.room_type_id=capacity_row.room_type_id) then
        raise exception 'LONG_STAY_RUNTIME_ALLOCATION_INVARIANT_VIOLATION' using errcode='23514';
      end if;
    end if;
  elsif contract_row.status='completed' then
    if stay_row.checked_out_at is null or capacity_count<>1
      or capacity_row.reserved_until is distinct from stay_row.checked_out_at
      or allocation_count<>0 then
      raise exception 'LONG_STAY_COMPLETED_INVARIANT_VIOLATION' using errcode='23514';
    end if;
  end if;
end;
$$;

create function public.guard_long_stay_outing_released_checkout()
returns trigger language plpgsql security definer
set search_path=public,pg_temp
as $$
begin
  if old.checked_out_at is null and new.checked_out_at is not null
    and exists (
      select 1
      from public.long_stay_contracts contract
      join public.long_stay_absence_events event
        on event.long_stay_contract_id=contract.id
       and event.hotel_stay_id=contract.current_hotel_stay_id
      where contract.current_hotel_stay_id=new.id
        and contract.archived_at is null
        and event.event_type='leave'
        and event.is_open
        and event.archived_at is null
        and event.inventory_mode='release_room'
        and event.inventory_transition_status='room_released'
    ) then
    raise exception '객실이 임시 해제된 외출 상태입니다. 먼저 복귀 처리 후 퇴실해 주세요.'
      using errcode='22023';
  end if;
  return new;
end;
$$;

create trigger long_stay_outing_released_checkout_guard
before update of checked_out_at on public.hotel_stays
for each row execute function public.guard_long_stay_outing_released_checkout();

create function public.start_long_stay_absence_v3(
  p_contract_id uuid,
  p_expected_contract_version integer,
  p_left_at timestamptz,
  p_expected_return_date date,
  p_expected_return_time time,
  p_expected_return_time_unspecified boolean,
  p_inventory_mode text,
  p_memo text,
  p_reason text,
  p_request_id uuid
)
returns jsonb language plpgsql security definer
set search_path=public,pg_temp
as $$
declare actor_id uuid:=auth.uid(); contract_row public.long_stay_contracts%rowtype;
declare stay_row public.hotel_stays%rowtype; capacity_row public.hotel_capacity_reservations%rowtype;
declare allocation_row public.hotel_room_allocations%rowtype; future_capacity_id uuid;
declare replay jsonb; payload jsonb; event_id uuid;
declare expected_return_at_value timestamptz; guarantee_from_value timestamptz;
declare mode_value text:=coalesce(nullif(btrim(p_inventory_mode),''),'keep_room');
begin
  if actor_id is null or not public.is_active_operation_member() then
    raise exception '외출 기록 권한이 없습니다.' using errcode='42501';
  end if;
  if p_left_at is null or nullif(btrim(p_reason),'') is null
    or mode_value not in ('keep_room','release_room') then
    raise exception '외출 시각, 객실 처리 방식과 사유가 필요합니다.' using errcode='22023';
  end if;
  if p_expected_return_date is null then
    if p_expected_return_time is not null or not coalesce(p_expected_return_time_unspecified,false) then
      raise exception '예상 복귀 날짜 미정이면 시간도 미정이어야 합니다.' using errcode='22023';
    end if;
    if mode_value='release_room' then
      raise exception '객실 임시 해제에는 예상 복귀 날짜가 필요합니다.' using errcode='22023';
    end if;
    expected_return_at_value:=null; guarantee_from_value:=null;
  elsif coalesce(p_expected_return_time_unspecified,false) then
    if p_expected_return_time is not null then
      raise exception '예상 복귀 시간 미정에는 시간값을 함께 저장할 수 없습니다.' using errcode='22023';
    end if;
    expected_return_at_value:=null;
    guarantee_from_value:=p_expected_return_date::timestamp at time zone 'Asia/Seoul';
  else
    if p_expected_return_time is null then
      raise exception '예상 복귀 시간을 입력하거나 시간 미정을 선택해 주세요.' using errcode='22023';
    end if;
    expected_return_at_value:=(p_expected_return_date::timestamp+p_expected_return_time) at time zone 'Asia/Seoul';
    guarantee_from_value:=expected_return_at_value;
  end if;
  if guarantee_from_value is not null and guarantee_from_value<=p_left_at then
    raise exception '복귀 보장 시각은 외출 시각보다 늦어야 합니다.' using errcode='22023';
  end if;

  payload:=jsonb_build_object(
    'contractId',p_contract_id,'leftAt',p_left_at,'expectedReturnDate',p_expected_return_date,
    'expectedReturnTime',p_expected_return_time,
    'expectedReturnTimeUnspecified',coalesce(p_expected_return_time_unspecified,false),
    'inventoryMode',mode_value,'memo',nullif(btrim(p_memo),''),'reason',nullif(btrim(p_reason),'')
  );
  replay:=public.long_stay_replay_internal(p_request_id,'start_absence_inventory_v1',payload);
  if replay is not null then return replay||public.long_stay_current_absence_projection_internal(p_contract_id); end if;

  select * into contract_row from public.long_stay_contracts
  where id=p_contract_id and archived_at is null for update;
  if not found then raise exception '장기호텔 계약을 찾을 수 없습니다.' using errcode='P0002'; end if;
  if contract_row.version<>p_expected_contract_version then
    raise exception '다른 사용자가 먼저 변경했습니다.' using errcode='PT409';
  end if;
  select * into stay_row from public.hotel_stays
  where id=contract_row.current_hotel_stay_id and archived_at is null for update;
  if contract_row.status not in ('pending','active') or stay_row.id is null
    or stay_row.checked_in_at is null or stay_row.checked_out_at is not null then
    raise exception '입실 중인 장기호텔만 외출 처리할 수 있습니다.' using errcode='22023';
  end if;
  if exists(select 1 from public.long_stay_absence_events event
    where event.long_stay_contract_id=p_contract_id and event.event_type='leave'
      and event.is_open and event.archived_at is null) then
    raise exception '이미 외출 중입니다.' using errcode='23505';
  end if;

  if mode_value='release_room' then
    select * into capacity_row from public.hotel_capacity_reservations capacity
    where capacity.hotel_stay_id=stay_row.id and capacity.archived_at is null for update;
    if not found or capacity_row.reserved_until<>'infinity'::timestamptz
      or p_left_at<=capacity_row.reserved_from then
      raise exception '현재 장기호텔 Capacity를 임시 해제할 수 없습니다.' using errcode='23514';
    end if;
    select allocation.* into allocation_row from public.hotel_room_allocations allocation
    where allocation.capacity_reservation_id=capacity_row.id and allocation.archived_at is null
      and allocation.allocated_until='infinity'::timestamptz for update;
    if not found or p_left_at<=allocation_row.allocated_from then
      raise exception '현재 장기호텔 객실 배정을 임시 해제할 수 없습니다.' using errcode='23514';
    end if;

    -- The availability check and both segment mutations share the canonical
    -- hotel capacity lock and one transaction. Failure preserves the old hold.
    perform public.assert_hotel_total_capacity_available(
      guarantee_from_value,'infinity'::timestamptz,1,capacity_row.id
    );
    perform public.assert_hotel_capacity_available(
      capacity_row.room_type_id,guarantee_from_value,'infinity'::timestamptz,1,capacity_row.id
    );

    update public.hotel_room_allocations set allocated_until=p_left_at,
      version=version+1,updated_by=actor_id,updated_at=clock_timestamp()
    where id=allocation_row.id;
    update public.hotel_capacity_reservations set reserved_until=p_left_at,
      version=version+1,updated_by=actor_id,updated_at=clock_timestamp(),
      archived_at=clock_timestamp(),archived_by=actor_id,
      archive_reason='long_stay_outing_inventory_segment_closed'
    where id=capacity_row.id;
    insert into public.hotel_capacity_reservations(
      source_kind,hotel_stay_id,room_type_id,reserved_from,reserved_until,quantity,
      request_id,created_by,updated_by
    ) values(
      'stay',stay_row.id,capacity_row.room_type_id,guarantee_from_value,'infinity'::timestamptz,1,
      public.long_stay_internal_request_id(p_request_id,'start_absence_inventory_v1',p_contract_id,'return_capacity'),
      actor_id,actor_id
    ) returning id into future_capacity_id;
    update public.long_stay_monthly_occupancies
    set runtime_capacity_reservation_id=future_capacity_id,version=version+1,
      updated_by=actor_id,updated_at=clock_timestamp()
    where long_stay_contract_id=p_contract_id and status='confirmed' and archived_at is null
      and runtime_capacity_reservation_id=capacity_row.id;
  end if;

  insert into public.long_stay_absence_events(
    long_stay_contract_id,hotel_stay_id,event_type,is_open,occurred_at,
    expected_return_at,expected_return_date,expected_return_time_unspecified,
    inventory_mode,previous_room_id,released_allocation_id,released_capacity_id,
    return_capacity_id,guarantee_from,inventory_transition_status,
    memo,reason,request_id,created_by
  ) values(
    p_contract_id,stay_row.id,'leave',true,p_left_at,
    expected_return_at_value,p_expected_return_date,coalesce(p_expected_return_time_unspecified,false),
    mode_value,case when mode_value='release_room' then allocation_row.room_id else null end,
    case when mode_value='release_room' then allocation_row.id else null end,
    case when mode_value='release_room' then capacity_row.id else null end,
    future_capacity_id,case when mode_value='release_room' then guarantee_from_value else null end,
    case when mode_value='release_room' then 'room_released' else 'room_retained' end,
    nullif(btrim(p_memo),''),btrim(p_reason),p_request_id,actor_id
  ) returning id into event_id;
  update public.long_stay_contracts set status='active',version=version+1,
    updated_by=actor_id,updated_at=clock_timestamp() where id=p_contract_id;
  perform public.long_stay_record_operation_internal(
    p_contract_id,null,event_id,'start_absence_inventory_v1',p_request_id,payload,null,'{}',p_reason,actor_id
  );
  return public.long_stay_contract_projection_internal(p_contract_id)
    ||public.long_stay_current_absence_projection_internal(p_contract_id)
    ||jsonb_build_object('replayed',false);
end;
$$;

create function public.get_long_stay_return_room_availability(
  p_contract_id uuid,p_returned_at timestamptz
)
returns jsonb language plpgsql stable security definer
set search_path=public,pg_temp
as $$
declare leave_row public.long_stay_absence_events%rowtype;
declare capacity_row public.hotel_capacity_reservations%rowtype; result_value jsonb;
begin
  if not public.is_active_operation_member() then
    raise exception '장기호텔 조회 권한이 없습니다.' using errcode='42501';
  end if;
  if p_returned_at is null then raise exception '복귀 시각이 필요합니다.' using errcode='22023'; end if;
  select * into leave_row from public.long_stay_absence_events event
  where event.long_stay_contract_id=p_contract_id and event.event_type='leave'
    and event.is_open and event.archived_at is null;
  if not found or leave_row.inventory_mode<>'release_room' then
    raise exception '객실이 임시 해제된 외출 기록이 없습니다.' using errcode='P0002';
  end if;
  select * into capacity_row from public.hotel_capacity_reservations
  where id=leave_row.return_capacity_id and archived_at is null;
  select jsonb_build_object(
    'contractId',p_contract_id,'roomTypeId',capacity_row.room_type_id,
    'previousRoomId',leave_row.previous_room_id,'returnedAt',p_returned_at,
    'rooms',coalesce(jsonb_agg(jsonb_build_object(
      'roomId',room.id,'roomName',room.name,'roomTypeId',room.room_type_id,
      'isPreviousRoom',room.id=leave_row.previous_room_id,
      'available',not exists(select 1 from public.hotel_room_allocations allocation
        where allocation.room_id=room.id and allocation.archived_at is null
          and allocation.allocated_from<'infinity'::timestamptz
          and allocation.allocated_until>p_returned_at)
    ) order by (room.id=leave_row.previous_room_id) desc,room.sort_order,room.name),'[]'::jsonb)
  ) into result_value
  from public.hotel_rooms room
  where room.room_type_id=capacity_row.room_type_id and room.is_active and room.archived_at is null;
  return result_value;
end;
$$;

create function public.complete_long_stay_absence_v2(
  p_contract_id uuid,p_expected_contract_version integer,p_returned_at timestamptz,
  p_room_id uuid,p_memo text,p_reason text,p_request_id uuid
)
returns jsonb language plpgsql security definer
set search_path=public,pg_temp
as $$
declare actor_id uuid:=auth.uid(); contract_row public.long_stay_contracts%rowtype;
declare leave_row public.long_stay_absence_events%rowtype;
declare capacity_row public.hotel_capacity_reservations%rowtype; room_row public.hotel_rooms%rowtype;
declare replay jsonb; payload jsonb; return_event_id uuid; allocation_id uuid;
begin
  if actor_id is null or not public.is_active_operation_member() then
    raise exception '복귀 기록 권한이 없습니다.' using errcode='42501';
  end if;
  if p_returned_at is null or nullif(btrim(p_reason),'') is null then
    raise exception '복귀 시각과 사유가 필요합니다.' using errcode='22023';
  end if;
  payload:=jsonb_build_object('contractId',p_contract_id,'returnedAt',p_returned_at,
    'roomId',p_room_id,'memo',nullif(btrim(p_memo),''),'reason',nullif(btrim(p_reason),''));
  replay:=public.long_stay_replay_internal(p_request_id,'complete_absence_inventory_v1',payload);
  if replay is not null then return replay; end if;
  select * into contract_row from public.long_stay_contracts
  where id=p_contract_id and archived_at is null for update;
  if not found then raise exception '장기호텔 계약을 찾을 수 없습니다.' using errcode='P0002'; end if;
  if contract_row.version<>p_expected_contract_version then
    raise exception '다른 사용자가 먼저 변경했습니다.' using errcode='PT409';
  end if;
  select * into leave_row from public.long_stay_absence_events event
  where event.long_stay_contract_id=p_contract_id and event.event_type='leave'
    and event.is_open and event.archived_at is null for update;
  if not found then raise exception '복귀 처리할 외출 기록이 없습니다.' using errcode='P0002'; end if;
  if p_returned_at<leave_row.occurred_at then
    raise exception '복귀 시각은 외출 시각보다 빠를 수 없습니다.' using errcode='22023';
  end if;

  if leave_row.inventory_mode='release_room' then
    if p_room_id is null then raise exception '복귀할 객실을 선택해 주세요.' using errcode='22023'; end if;
    select * into capacity_row from public.hotel_capacity_reservations capacity
    where capacity.id=leave_row.return_capacity_id and capacity.archived_at is null for update;
    if not found or capacity_row.reserved_until<>'infinity'::timestamptz then
      raise exception '복귀 Capacity를 확인할 수 없습니다.' using errcode='23514';
    end if;
    select * into room_row from public.hotel_rooms room
    where room.id=p_room_id and room.is_active and room.archived_at is null;
    if not found or room_row.room_type_id<>capacity_row.room_type_id then
      raise exception '복귀 시 동일한 객실 유형을 선택해 주세요.' using errcode='22023';
    end if;
    if p_returned_at<capacity_row.reserved_from then
      perform public.assert_hotel_total_capacity_available(
        p_returned_at,'infinity'::timestamptz,1,capacity_row.id
      );
      perform public.assert_hotel_capacity_available(
        capacity_row.room_type_id,p_returned_at,'infinity'::timestamptz,1,capacity_row.id
      );
      update public.hotel_capacity_reservations set reserved_from=p_returned_at,
        version=version+1,updated_by=actor_id,updated_at=clock_timestamp()
      where id=capacity_row.id;
    end if;
    perform public.assert_hotel_room_allocation_available(
      p_room_id,capacity_row.id,p_returned_at,'infinity'::timestamptz,null
    );
    insert into public.hotel_room_allocations(
      capacity_reservation_id,room_id,allocated_from,allocated_until,
      assignment_reason,request_id,created_by,updated_by
    ) values(
      capacity_row.id,p_room_id,p_returned_at,'infinity'::timestamptz,
      'long_stay_outing_return',
      public.long_stay_internal_request_id(p_request_id,'complete_absence_inventory_v1',p_contract_id,'room_allocation'),
      actor_id,actor_id
    ) returning id into allocation_id;
    update public.long_stay_absence_events set returned_room_id=p_room_id,
      returned_allocation_id=allocation_id,inventory_transition_status='room_returned'
    where id=leave_row.id;
  elsif p_room_id is not null then
    raise exception '객실 유지 외출의 복귀에는 새 객실을 지정할 수 없습니다.' using errcode='22023';
  end if;

  insert into public.long_stay_absence_events(
    long_stay_contract_id,hotel_stay_id,event_type,paired_leave_event_id,
    occurred_at,memo,reason,request_id,created_by
  ) values(
    p_contract_id,contract_row.current_hotel_stay_id,'return',leave_row.id,
    p_returned_at,nullif(btrim(p_memo),''),btrim(p_reason),p_request_id,actor_id
  ) returning id into return_event_id;
  update public.long_stay_absence_events set is_open=false where id=leave_row.id;
  update public.long_stay_contracts set version=version+1,updated_by=actor_id,
    updated_at=clock_timestamp() where id=p_contract_id;
  perform public.long_stay_record_operation_internal(
    p_contract_id,null,return_event_id,'complete_absence_inventory_v1',p_request_id,payload,null,'{}',p_reason,actor_id
  );
  return public.long_stay_contract_projection_internal(p_contract_id)
    ||public.long_stay_current_absence_projection_internal(p_contract_id)
    ||jsonb_build_object('replayed',false);
end;
$$;

create function public.set_long_stay_absence_expected_return_v2(
  p_contract_id uuid,p_expected_contract_version integer,p_expected_return_date date,
  p_expected_return_time time,p_expected_return_time_unspecified boolean,
  p_reason text,p_request_id uuid
)
returns jsonb language plpgsql security definer
set search_path=public,pg_temp
as $$
declare actor_id uuid:=auth.uid(); contract_row public.long_stay_contracts%rowtype;
declare leave_row public.long_stay_absence_events%rowtype;
declare capacity_row public.hotel_capacity_reservations%rowtype;
declare boundary timestamptz; exact_return timestamptz; payload jsonb; replay jsonb;
begin
  if actor_id is null or not public.is_active_operation_member() then
    raise exception '복귀 예정 변경 권한이 없습니다.' using errcode='42501';
  end if;
  if p_expected_return_date is null then
    raise exception '객실 임시 해제 중에는 복귀 예정 날짜가 필요합니다.' using errcode='22023';
  end if;
  if coalesce(p_expected_return_time_unspecified,false) then
    if p_expected_return_time is not null then raise exception '시간 미정에는 시간값을 저장할 수 없습니다.' using errcode='22023'; end if;
    exact_return:=null; boundary:=p_expected_return_date::timestamp at time zone 'Asia/Seoul';
  else
    if p_expected_return_time is null then raise exception '예상 복귀 시간을 입력해 주세요.' using errcode='22023'; end if;
    exact_return:=(p_expected_return_date::timestamp+p_expected_return_time) at time zone 'Asia/Seoul';
    boundary:=exact_return;
  end if;
  payload:=jsonb_build_object('contractId',p_contract_id,'expectedReturnDate',p_expected_return_date,
    'expectedReturnTime',p_expected_return_time,
    'expectedReturnTimeUnspecified',coalesce(p_expected_return_time_unspecified,false),
    'reason',nullif(btrim(p_reason),''));
  replay:=public.long_stay_replay_internal(p_request_id,'set_absence_expected_return_inventory_v1',payload);
  if replay is not null then return replay||public.long_stay_current_absence_projection_internal(p_contract_id); end if;
  select * into contract_row from public.long_stay_contracts
  where id=p_contract_id and archived_at is null for update;
  if contract_row.version<>p_expected_contract_version then
    raise exception '다른 사용자가 먼저 변경했습니다.' using errcode='PT409';
  end if;
  select * into leave_row from public.long_stay_absence_events event
  where event.long_stay_contract_id=p_contract_id and event.event_type='leave'
    and event.is_open and event.archived_at is null for update;
  if not found or leave_row.inventory_mode<>'release_room'
    or leave_row.inventory_transition_status<>'room_released' then
    raise exception '객실이 임시 해제된 외출만 복귀 예정일을 변경할 수 있습니다.' using errcode='22023';
  end if;
  if boundary<=leave_row.occurred_at then
    raise exception '복귀 보장 시각은 외출 시각보다 늦어야 합니다.' using errcode='22023';
  end if;
  select * into capacity_row from public.hotel_capacity_reservations
  where id=leave_row.return_capacity_id and archived_at is null for update;
  perform public.assert_hotel_total_capacity_available(boundary,'infinity'::timestamptz,1,capacity_row.id);
  perform public.assert_hotel_capacity_available(capacity_row.room_type_id,boundary,'infinity'::timestamptz,1,capacity_row.id);
  update public.hotel_capacity_reservations set reserved_from=boundary,
    version=version+1,updated_by=actor_id,updated_at=clock_timestamp()
  where id=capacity_row.id;
  update public.long_stay_absence_events set expected_return_date=p_expected_return_date,
    expected_return_at=exact_return,
    expected_return_time_unspecified=coalesce(p_expected_return_time_unspecified,false),
    guarantee_from=boundary where id=leave_row.id;
  update public.long_stay_contracts set version=version+1,updated_by=actor_id,
    updated_at=clock_timestamp() where id=p_contract_id;
  perform public.long_stay_record_operation_internal(
    p_contract_id,null,leave_row.id,'set_absence_expected_return_inventory_v1',p_request_id,
    payload,null,'{}',p_reason,actor_id
  );
  return public.long_stay_contract_projection_internal(p_contract_id)
    ||public.long_stay_current_absence_projection_internal(p_contract_id)
    ||jsonb_build_object('replayed',false);
end;
$$;

revoke all on function public.start_long_stay_absence_v3(uuid,integer,timestamptz,date,time,boolean,text,text,text,uuid) from public,anon;
grant execute on function public.start_long_stay_absence_v3(uuid,integer,timestamptz,date,time,boolean,text,text,text,uuid) to authenticated,service_role;
revoke all on function public.get_long_stay_return_room_availability(uuid,timestamptz) from public,anon;
grant execute on function public.get_long_stay_return_room_availability(uuid,timestamptz) to authenticated,service_role;
revoke all on function public.complete_long_stay_absence_v2(uuid,integer,timestamptz,uuid,text,text,uuid) from public,anon;
grant execute on function public.complete_long_stay_absence_v2(uuid,integer,timestamptz,uuid,text,text,uuid) to authenticated,service_role;
revoke all on function public.set_long_stay_absence_expected_return_v2(uuid,integer,date,time,boolean,text,uuid) from public,anon;
grant execute on function public.set_long_stay_absence_expected_return_v2(uuid,integer,date,time,boolean,text,uuid) to authenticated,service_role;

revoke all on function public.long_stay_current_absence_projection_internal(uuid) from public,anon,authenticated,service_role;
revoke all on function public.assert_long_stay_runtime_invariant_internal(uuid) from public,anon,authenticated,service_role;
revoke all on function public.guard_long_stay_outing_released_checkout() from public,anon,authenticated,service_role;

comment on function public.start_long_stay_absence_v3(uuid,integer,timestamptz,date,time,boolean,text,text,text,uuid) is
  'Starts KEEP_ROOM or RELEASE_ROOM Long Stay outing atomically; RELEASE_ROOM preserves historical segments and creates future room-type capacity.';
comment on function public.complete_long_stay_absence_v2(uuid,integer,timestamptz,uuid,text,text,uuid) is
  'Completes Long Stay outing; RELEASE_ROOM requires an operator-confirmed same-type room and atomically handles early return.';

commit;
