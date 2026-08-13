begin;

do $$
begin
  if to_regprocedure('public.get_long_stay_room_availability_v2(uuid,date,date,time without time zone,boolean)') is not null
    or to_regprocedure('public.confirm_long_stay_month_v2(uuid,integer,date,date,uuid,uuid,time without time zone,boolean,uuid,uuid,uuid[],text,uuid)') is not null then
    raise exception 'STOP_LONG_STAY_EXPLICIT_PHYSICAL_START_ALREADY_APPLIED';
  end if;
  if to_regprocedure('public.long_stay_first_assignment_effective_date_internal(date,date)') is null
    or to_regprocedure('public.get_long_stay_room_availability(uuid,date,time without time zone,boolean)') is null
    or to_regprocedure('public.confirm_long_stay_month(uuid,integer,date,uuid,uuid,time without time zone,boolean,uuid,uuid,uuid[],text,uuid)') is null then
    raise exception 'STOP_LONG_STAY_EXPLICIT_PHYSICAL_START_DEPENDENCY_MISSING';
  end if;
end;
$$;

create function public.get_long_stay_room_availability_v2(
  p_contract_id uuid,
  p_service_month date,
  p_physical_start_date date,
  p_check_in_time time,
  p_check_in_time_unspecified boolean
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  contract_row public.long_stay_contracts%rowtype;
  stay_row public.hotel_stays%rowtype;
  capacity_row public.hotel_capacity_reservations%rowtype;
  availability_from timestamptz;
  exclude_allocation_id uuid;
  rooms jsonb;
begin
  if auth.uid() is null or not public.is_active_operation_member() then
    raise exception '장기호텔 객실 가용성 조회 권한이 없습니다.' using errcode='42501';
  end if;
  if p_service_month is null
    or p_service_month <> date_trunc('month',p_service_month)::date then
    raise exception 'service_month는 월 첫 날짜여야 합니다.' using errcode='22023';
  end if;

  select * into contract_row
  from public.long_stay_contracts
  where id=p_contract_id and archived_at is null;
  if not found then
    raise exception '장기호텔 계약을 찾을 수 없습니다.' using errcode='P0002';
  end if;
  if contract_row.status not in ('pending','active') then
    raise exception '진행 중인 장기호텔 계약만 객실 가용성을 확인할 수 있습니다.' using errcode='22023';
  end if;
  if (p_service_month+interval '1 month')::date <= contract_row.started_on
    or (contract_row.planned_check_out_date is not null
      and p_service_month > contract_row.planned_check_out_date) then
    raise exception '계약 기간 밖의 월은 확인할 수 없습니다.' using errcode='22023';
  end if;

  if contract_row.current_hotel_stay_id is null then
    if p_physical_start_date is null then
      raise exception '첫 객실 배정에는 객실 사용 시작일이 필요합니다.' using errcode='22023';
    end if;
    if p_physical_start_date < contract_row.started_on then
      raise exception '객실 사용 시작일은 계약 시작일보다 빠를 수 없습니다.' using errcode='22023';
    end if;
    if p_physical_start_date < p_service_month
      or p_physical_start_date >= (p_service_month+interval '1 month')::date then
      raise exception '객실 사용 시작일은 선택한 운영 월 안이어야 합니다.' using errcode='22023';
    end if;
    if contract_row.planned_check_out_date is not null
      and p_physical_start_date > contract_row.planned_check_out_date then
      raise exception '객실 사용 시작일은 퇴실 예정일보다 늦을 수 없습니다.' using errcode='22023';
    end if;
    if not coalesce(p_check_in_time_unspecified,false) and p_check_in_time is null then
      raise exception '입실 시간이 확정된 경우 입실 시간이 필요합니다.' using errcode='22023';
    end if;
    availability_from := case when coalesce(p_check_in_time_unspecified,false)
      then p_physical_start_date::timestamp at time zone 'Asia/Seoul'
      else (p_physical_start_date::timestamp+p_check_in_time) at time zone 'Asia/Seoul'
    end;
  else
    if p_physical_start_date is not null then
      raise exception '기존 Runtime의 객실 사용 시작일은 다시 설정할 수 없습니다.' using errcode='22023';
    end if;
    select * into stay_row from public.hotel_stays where id=contract_row.current_hotel_stay_id;
    select * into capacity_row from public.hotel_capacity_reservations
      where hotel_stay_id=contract_row.current_hotel_stay_id and archived_at is null;
    if stay_row.id is null or capacity_row.id is null then
      raise exception '연결된 장기호텔 Runtime을 확인할 수 없습니다.' using errcode='P0002';
    end if;
    availability_from := case when stay_row.checked_in_at is null
      then capacity_row.reserved_from else statement_timestamp() end;
    select allocation.id into exclude_allocation_id
    from public.hotel_room_allocations allocation
    where allocation.capacity_reservation_id=capacity_row.id
      and allocation.archived_at is null
      and allocation.allocated_until='infinity'::timestamptz
    order by allocation.allocated_from desc,allocation.id
    limit 1;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'roomId',room.id,
    'roomName',room.name,
    'roomTypeId',room_type.id,
    'roomTypeCode',room_type.code,
    'roomTypeName',room_type.name,
    'assignable',conflict.allocation_id is null,
    'nextConflictFrom',conflict.allocated_from,
    'nextConflictUntil',case when conflict.allocated_until='infinity'::timestamptz then null else conflict.allocated_until end,
    'conflictSource',conflict.source_category,
    'conflictPhase',conflict.conflict_phase,
    'reason',coalesce(conflict.reason,'사용 가능')
  ) order by room_type.sort_order,room.sort_order,room.name),'[]'::jsonb)
  into rooms
  from public.hotel_rooms room
  join public.hotel_room_types room_type on room_type.id=room.room_type_id
  left join lateral (
    select allocation.id allocation_id,allocation.allocated_from,allocation.allocated_until,
      case
        when capacity.source_kind='shared_occupancy' then 'shared_room'
        when capacity.source_kind='daycare' then 'daycare'
        when capacity.source_kind='stay' and exists(
          select 1 from public.long_stay_contracts other_contract
          where other_contract.current_hotel_stay_id=capacity.hotel_stay_id
            and other_contract.archived_at is null
        ) then 'long_stay'
        when capacity.source_kind='stay' then 'hotel'
        else 'other'
      end source_category,
      case when allocation.allocated_from<=availability_from
        then 'effective_start_overlap' else 'future' end conflict_phase,
      case when allocation.allocated_from<=availability_from
        then '객실 사용 시작 시점에 사용 중' else '미래 예약 있음' end reason
    from public.hotel_room_allocations allocation
    join public.hotel_capacity_reservations capacity
      on capacity.id=allocation.capacity_reservation_id and capacity.archived_at is null
    where allocation.room_id=room.id
      and allocation.archived_at is null
      and allocation.id is distinct from exclude_allocation_id
      and allocation.allocated_from<'infinity'::timestamptz
      and allocation.allocated_until>availability_from
    order by greatest(allocation.allocated_from,availability_from),allocation.id
    limit 1
  ) conflict on true
  where room.is_active and room.archived_at is null
    and room_type.is_active and room_type.archived_at is null;

  return jsonb_build_object(
    'contractId',contract_row.id,
    'serviceMonth',p_service_month,
    'availabilityFrom',availability_from,
    'isOpenEnded',true,
    'rooms',rooms
  );
end;
$$;

create function public.confirm_long_stay_month_v2(
  p_contract_id uuid,p_expected_contract_version integer,p_service_month date,
  p_physical_start_date date,p_calendar_id uuid,p_schedule_type_id uuid,p_check_in_time time,
  p_check_in_time_unspecified boolean,p_room_type_id uuid,p_room_id uuid,
  p_assignee_ids uuid[],p_reason text,p_request_id uuid
)
returns jsonb language plpgsql security definer
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
    'physicalStartDate',p_physical_start_date,'roomTypeId',p_room_type_id,'roomId',p_room_id,'calendarId',p_calendar_id,
    'scheduleTypeId',p_schedule_type_id,'checkInTime',p_check_in_time,
    'checkInTimeUnspecified',coalesce(p_check_in_time_unspecified,false),
    'assigneeIds',(select coalesce(jsonb_agg(id order by id),'[]') from unnest(coalesce(p_assignee_ids,'{}')) id),
    'reason',nullif(btrim(p_reason),''));
  replay:=public.long_stay_replay_internal(p_request_id,'confirm_month',payload); if replay is not null then return replay; end if;
  select * into contract_row from public.long_stay_contracts where id=p_contract_id and archived_at is null for update;
  if not found then raise exception '장기호텔 계약을 찾을 수 없습니다.' using errcode='P0002'; end if;
  if contract_row.version<>p_expected_contract_version then raise exception '다른 사용자가 먼저 장기호텔 계약을 변경했습니다.' using errcode='PT409'; end if;
  if contract_row.status not in ('pending','active') then raise exception '진행 중인 장기호텔 계약만 월 확정할 수 있습니다.' using errcode='22023'; end if;
  if p_service_month<>date_trunc('month',p_service_month)::date then raise exception 'service_month는 월 첫 날짜여야 합니다.' using errcode='22023'; end if;
  if exists(select 1 from public.long_stay_monthly_occupancies where long_stay_contract_id=p_contract_id and service_month=p_service_month and status='confirmed' and archived_at is null) then
    raise exception '해당 월은 이미 확정되었습니다.' using errcode='23505';
  end if;
  month_from:=public.long_stay_first_assignment_effective_date_internal(contract_row.started_on,p_service_month)::timestamp at time zone 'Asia/Seoul';
  month_until:=least((p_service_month+interval '1 month')::timestamp at time zone 'Asia/Seoul',
    coalesce((contract_row.planned_check_out_date+1)::timestamp at time zone 'Asia/Seoul','infinity'::timestamptz));
  if month_until<=month_from then raise exception '계약 기간 밖의 월은 확정할 수 없습니다.' using errcode='22023'; end if;
  if contract_row.current_hotel_stay_id is null then
    if p_physical_start_date is null then raise exception '첫 객실 배정에는 객실 사용 시작일이 필요합니다.' using errcode='22023'; end if;
    if p_physical_start_date<contract_row.started_on then raise exception '객실 사용 시작일은 계약 시작일보다 빠를 수 없습니다.' using errcode='22023'; end if;
    if p_physical_start_date<p_service_month or p_physical_start_date>=(p_service_month+interval '1 month')::date then
      raise exception '객실 사용 시작일은 선택한 운영 월 안이어야 합니다.' using errcode='22023';
    end if;
    if contract_row.planned_check_out_date is not null and p_physical_start_date>contract_row.planned_check_out_date then
      raise exception '객실 사용 시작일은 퇴실 예정일보다 늦을 수 없습니다.' using errcode='22023';
    end if;
  elsif p_physical_start_date is not null then
    raise exception '기존 Runtime의 객실 사용 시작일은 다시 설정할 수 없습니다.' using errcode='22023';
  end if;
  child_create:=public.long_stay_internal_request_id(p_request_id,'confirm_month',p_contract_id,'create-runtime');
  child_checkin:=public.long_stay_internal_request_id(p_request_id,'confirm_month',p_contract_id,'check-in-schedule');
  child_checkout:=public.long_stay_internal_request_id(p_request_id,'confirm_month',p_contract_id,'check-out-schedule');
  child_room:=public.long_stay_internal_request_id(p_request_id,'confirm_month',p_contract_id,'room');
  if contract_row.current_hotel_stay_id is null then
    runtime_input:=public.prepare_hotel_reservation_runtime_input_extended_internal(
      p_calendar_id,p_schedule_type_id,p_physical_start_date,p_check_in_time,
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

revoke all on function public.get_long_stay_room_availability_v2(uuid,date,date,time,boolean)
  from public,anon;
grant execute on function public.get_long_stay_room_availability_v2(uuid,date,date,time,boolean)
  to authenticated,service_role;
revoke all on function public.confirm_long_stay_month_v2(uuid,integer,date,date,uuid,uuid,time,boolean,uuid,uuid,uuid[],text,uuid)
  from public,anon;
grant execute on function public.confirm_long_stay_month_v2(uuid,integer,date,date,uuid,uuid,time,boolean,uuid,uuid,uuid[],text,uuid)
  to authenticated,service_role;

comment on function public.get_long_stay_room_availability_v2(uuid,date,date,time,boolean)
  is 'Long Stay first physical assignment availability from an explicit operator-confirmed KST date/time.';
comment on function public.confirm_long_stay_month_v2(uuid,integer,date,date,uuid,uuid,time,boolean,uuid,uuid,uuid[],text,uuid)
  is 'Confirms a Long Stay service month while preserving monthly boundaries and using an explicit first physical runtime start.';

commit;
