-- Read-only Long Stay room availability projection.
begin;

do $$
begin
  if to_regprocedure('public.get_long_stay_room_availability(uuid,date,time without time zone,boolean)') is not null then
    raise exception 'STOP_LONG_STAY_ROOM_AVAILABILITY_ALREADY_APPLIED';
  end if;
  if to_regclass('public.long_stay_contracts') is null
    or to_regclass('public.hotel_rooms') is null
    or to_regclass('public.hotel_room_types') is null
    or to_regclass('public.hotel_room_allocations') is null
    or to_regclass('public.hotel_capacity_reservations') is null
    or to_regprocedure('public.confirm_long_stay_month(uuid,integer,date,uuid,uuid,time without time zone,boolean,uuid,uuid,uuid[],text,uuid)') is null then
    raise exception 'STOP_LONG_STAY_ROOM_AVAILABILITY_DEPENDENCY_MISSING';
  end if;
end;
$$;

create function public.get_long_stay_room_availability(
  p_contract_id uuid,
  p_service_month date,
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
    if not coalesce(p_check_in_time_unspecified,false) and p_check_in_time is null then
      raise exception '입실 시간이 확정된 경우 입실 시간이 필요합니다.' using errcode='22023';
    end if;
    availability_from := case when coalesce(p_check_in_time_unspecified,false)
      then contract_row.started_on::timestamp at time zone 'Asia/Seoul'
      else (contract_row.started_on::timestamp+p_check_in_time) at time zone 'Asia/Seoul'
    end;
  else
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
      case
        when allocation.allocated_from<=statement_timestamp()
          and allocation.allocated_until>statement_timestamp() then 'current'
        when allocation.allocated_from>statement_timestamp() then 'future'
        else 'past_overlap'
      end conflict_phase,
      case
        when allocation.allocated_from<=statement_timestamp()
          and allocation.allocated_until>statement_timestamp() then '현재 사용 중'
        when allocation.allocated_from>statement_timestamp() then '미래 예약 있음'
        else '계약 시작 이후 사용 이력과 겹침'
      end reason
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

revoke all on function public.get_long_stay_room_availability(uuid,date,time,boolean)
  from public,anon;
grant execute on function public.get_long_stay_room_availability(uuid,date,time,boolean)
  to authenticated,service_role;

commit;
