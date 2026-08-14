-- GENERATED FILE: do not edit or assemble by hand.
-- Dashboard target: clean-qa
-- Dashboard phase: MIGRATION
-- Production ref: zorvcuskzemehblqdbfj
-- Clean QA ref: wxbvwixoeczfvbqurdse
-- Approved migration SHA-256: 706bf28a5f497d41db065b73f033a0dfefc196cc13661fb889e51a5b52e4d731
-- Embedded source SHA-256: 706bf28a5f497d41db065b73f033a0dfefc196cc13661fb889e51a5b52e4d731
-- Long Stay KEEP_ROOM -> RELEASE_ROOM transition
-- Converts an already-open retained-room outing into the canonical Inventory V1
-- released-room state without changing the original leave timestamp.
begin;
-- CLEAN_QA_DASHBOARD_BINDING_BEGIN
select set_config('app.release_project_ref','wxbvwixoeczfvbqurdse',true);
select set_config('app.release_migration_sha256','706bf28a5f497d41db065b73f033a0dfefc196cc13661fb889e51a5b52e4d731',true);
do $dashboard_binding$
begin
  if current_database()<>'postgres' or current_user<>'postgres'
    or current_setting('app.release_project_ref',true) is distinct from 'wxbvwixoeczfvbqurdse'
    or current_setting('app.release_project_ref',true)='zorvcuskzemehblqdbfj'
    or current_setting('app.release_migration_sha256',true) is distinct from '706bf28a5f497d41db065b73f033a0dfefc196cc13661fb889e51a5b52e4d731'
    or to_regprocedure('hotel_qa.assert_isolated_environment()') is null then
    raise exception 'STOP_LONG_STAY_KEEP_TO_RELEASE_CLEAN_QA_DASHBOARD_BINDING';
  end if;
  perform hotel_qa.assert_isolated_environment();
end;
$dashboard_binding$;
-- CLEAN_QA_DASHBOARD_BINDING_END


do $$
begin
  if to_regprocedure('public.release_long_stay_room_during_absence(uuid,integer,text,uuid)') is not null then
    raise exception 'STOP_LONG_STAY_KEEP_TO_RELEASE_ALREADY_APPLIED';
  end if;
  if to_regprocedure('public.start_long_stay_absence_v3(uuid,integer,timestamp with time zone,date,time without time zone,boolean,text,text,text,uuid)') is null
    or to_regprocedure('public.complete_long_stay_absence_v2(uuid,integer,timestamp with time zone,uuid,text,text,uuid)') is null
    or to_regprocedure('public.set_long_stay_absence_expected_return_v2(uuid,integer,date,time without time zone,boolean,text,uuid)') is null
    or to_regprocedure('public.assert_long_stay_runtime_invariant_internal(uuid)') is null then
    raise exception 'STOP_LONG_STAY_KEEP_TO_RELEASE_INVENTORY_V1_BASELINE_MISSING';
  end if;
end;
$$;

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
      'releasedAt',released_allocation.allocated_until,
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
  left join public.hotel_room_allocations released_allocation
    on released_allocation.id=leave_event.released_allocation_id
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
        or not exists(
          select 1
          from public.hotel_room_allocations allocation
          join public.hotel_capacity_reservations released_capacity
            on released_capacity.id=leave_row.released_capacity_id
          where allocation.id=leave_row.released_allocation_id
            and allocation.allocated_until=released_capacity.reserved_until
            and allocation.allocated_until>=leave_row.occurred_at
            and allocation.allocated_until<=leave_row.guarantee_from
            and released_capacity.archived_at is not null
        ) then
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

create function public.release_long_stay_room_during_absence(
  p_contract_id uuid,
  p_expected_contract_version integer,
  p_reason text,
  p_request_id uuid
)
returns jsonb language plpgsql security definer
set search_path=public,pg_temp
as $$
declare actor_id uuid:=auth.uid();
declare contract_row public.long_stay_contracts%rowtype;
declare stay_row public.hotel_stays%rowtype;
declare leave_row public.long_stay_absence_events%rowtype;
declare capacity_row public.hotel_capacity_reservations%rowtype;
declare allocation_row public.hotel_room_allocations%rowtype;
declare future_capacity_id uuid;
declare release_at_value timestamptz:=transaction_timestamp();
declare guarantee_from_value timestamptz;
declare replay jsonb;
declare payload jsonb;
begin
  if actor_id is null or not public.is_active_operation_member() then
    raise exception '객실 임시 해제 권한이 없습니다.' using errcode='42501';
  end if;
  if p_contract_id is null or p_request_id is null or nullif(btrim(p_reason),'') is null then
    raise exception '장기호텔 계약, 요청 ID와 처리 사유가 필요합니다.' using errcode='22023';
  end if;

  payload:=jsonb_build_object(
    'contractId',p_contract_id,
    'reason',nullif(btrim(p_reason),'')
  );
  replay:=public.long_stay_replay_internal(
    p_request_id,'release_room_during_absence_inventory_v1',payload
  );
  if replay is not null then
    return replay||public.long_stay_current_absence_projection_internal(p_contract_id);
  end if;

  select * into contract_row
  from public.long_stay_contracts
  where id=p_contract_id and archived_at is null
  for update;
  if not found then
    raise exception '장기호텔 계약을 찾을 수 없습니다.' using errcode='P0002';
  end if;
  if contract_row.version<>p_expected_contract_version then
    raise exception '다른 사용자가 먼저 변경했습니다.' using errcode='PT409';
  end if;
  if contract_row.status not in ('pending','active') or contract_row.current_hotel_stay_id is null then
    raise exception '운영 중인 장기호텔 계약만 객실을 임시 해제할 수 있습니다.' using errcode='22023';
  end if;

  select * into leave_row
  from public.long_stay_absence_events event
  where event.long_stay_contract_id=p_contract_id
    and event.hotel_stay_id=contract_row.current_hotel_stay_id
    and event.event_type='leave'
    and event.is_open
    and event.archived_at is null
  for update;
  if not found then
    raise exception '진행 중인 외출 기록이 없습니다.' using errcode='P0002';
  end if;
  if leave_row.inventory_mode<>'keep_room'
    or leave_row.inventory_transition_status<>'room_retained' then
    raise exception '객실을 유지 중인 외출만 임시 해제로 전환할 수 있습니다.' using errcode='22023';
  end if;
  if leave_row.expected_return_date is null then
    raise exception '객실을 임시 해제하려면 복귀 예정 날짜가 필요합니다.' using errcode='22023';
  end if;
  if leave_row.expected_return_time_unspecified then
    guarantee_from_value:=leave_row.expected_return_date::timestamp at time zone 'Asia/Seoul';
  else
    guarantee_from_value:=leave_row.expected_return_at;
  end if;
  if guarantee_from_value is null or guarantee_from_value<=release_at_value then
    raise exception '복귀 예정 시각이 지나 객실을 임시 해제할 수 없습니다.' using errcode='22023';
  end if;

  select * into stay_row
  from public.hotel_stays
  where id=contract_row.current_hotel_stay_id and archived_at is null
  for update;
  if not found or stay_row.checked_in_at is null or stay_row.checked_out_at is not null then
    raise exception '입실 중이며 퇴실하지 않은 장기호텔만 객실을 임시 해제할 수 있습니다.' using errcode='22023';
  end if;

  select * into capacity_row
  from public.hotel_capacity_reservations capacity
  where capacity.hotel_stay_id=stay_row.id
    and capacity.archived_at is null
    and capacity.reserved_until='infinity'::timestamptz
  for update;
  if not found or release_at_value<=capacity_row.reserved_from then
    raise exception '현재 장기호텔 Capacity를 임시 해제할 수 없습니다.' using errcode='23514';
  end if;
  select * into allocation_row
  from public.hotel_room_allocations allocation
  where allocation.capacity_reservation_id=capacity_row.id
    and allocation.archived_at is null
    and allocation.allocated_until='infinity'::timestamptz
  for update;
  if not found or release_at_value<=allocation_row.allocated_from then
    raise exception '현재 장기호텔 객실 배정을 임시 해제할 수 없습니다.' using errcode='23514';
  end if;

  perform public.assert_hotel_total_capacity_available(
    guarantee_from_value,'infinity'::timestamptz,1,capacity_row.id
  );
  perform public.assert_hotel_capacity_available(
    capacity_row.room_type_id,guarantee_from_value,'infinity'::timestamptz,1,capacity_row.id
  );

  update public.hotel_room_allocations
  set allocated_until=release_at_value,
    version=version+1,updated_by=actor_id,updated_at=clock_timestamp()
  where id=allocation_row.id;
  update public.hotel_capacity_reservations
  set reserved_until=release_at_value,
    version=version+1,updated_by=actor_id,updated_at=clock_timestamp(),
    archived_at=clock_timestamp(),archived_by=actor_id,
    archive_reason='long_stay_outing_inventory_segment_closed'
  where id=capacity_row.id;
  insert into public.hotel_capacity_reservations(
    source_kind,hotel_stay_id,room_type_id,reserved_from,reserved_until,quantity,
    request_id,created_by,updated_by
  ) values(
    'stay',stay_row.id,capacity_row.room_type_id,guarantee_from_value,'infinity'::timestamptz,1,
    public.long_stay_internal_request_id(
      p_request_id,'release_room_during_absence_inventory_v1',p_contract_id,'return_capacity'
    ),actor_id,actor_id
  ) returning id into future_capacity_id;

  update public.long_stay_monthly_occupancies
  set runtime_capacity_reservation_id=future_capacity_id,
    version=version+1,updated_by=actor_id,updated_at=clock_timestamp()
  where long_stay_contract_id=p_contract_id
    and status='confirmed' and archived_at is null
    and runtime_capacity_reservation_id=capacity_row.id;

  update public.long_stay_absence_events
  set inventory_mode='release_room',
    previous_room_id=allocation_row.room_id,
    released_allocation_id=allocation_row.id,
    released_capacity_id=capacity_row.id,
    return_capacity_id=future_capacity_id,
    guarantee_from=guarantee_from_value,
    inventory_transition_status='room_released'
  where id=leave_row.id;
  update public.long_stay_contracts
  set version=version+1,updated_by=actor_id,updated_at=clock_timestamp()
  where id=p_contract_id;

  perform public.long_stay_record_operation_internal(
    p_contract_id,null,leave_row.id,'release_room_during_absence_inventory_v1',
    p_request_id,payload,null,'{}',p_reason,actor_id
  );
  perform public.assert_long_stay_runtime_invariant_internal(p_contract_id);
  return public.long_stay_contract_projection_internal(p_contract_id)
    ||public.long_stay_current_absence_projection_internal(p_contract_id)
    ||jsonb_build_object('replayed',false);
end;
$$;

revoke all on function public.release_long_stay_room_during_absence(uuid,integer,text,uuid)
  from public,anon;
grant execute on function public.release_long_stay_room_during_absence(uuid,integer,text,uuid)
  to authenticated,service_role;

revoke all on function public.long_stay_current_absence_projection_internal(uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.assert_long_stay_runtime_invariant_internal(uuid)
  from public,anon,authenticated,service_role;

comment on function public.release_long_stay_room_during_absence(uuid,integer,text,uuid) is
  'Atomically converts an open KEEP_ROOM Long Stay outing to canonical RELEASE_ROOM inventory at transaction time.';

commit;
