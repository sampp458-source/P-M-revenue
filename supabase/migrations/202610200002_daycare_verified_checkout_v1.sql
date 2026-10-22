begin;

-- Separate verified recovery command: regular checkout and all hotel guards stay unchanged.
create function public.complete_verified_daycare_check_out_v1(
  p_operation_schedule_id uuid, p_expected_version integer,
  p_checked_out_at timestamptz, p_request_id uuid, p_confirmed boolean
) returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  state_row public.daycare_operation_states%rowtype;
  schedule_row public.operation_schedules%rowtype;
  capacity_row public.hotel_capacity_reservations%rowtype;
  allocation_row public.hotel_room_allocations%rowtype;
  payload jsonb;
  result jsonb;
  reason text := '실제 퇴실 시각 확인 · 미퇴실 기록 정리';
begin
  if actor is null or not public.is_active_operation_member() or not public.can_operate_hotel() then
    raise exception using errcode='42501', message='미퇴실 기록을 처리할 권한이 없습니다.';
  end if;
  if p_confirmed is distinct from true or p_checked_out_at is null or not isfinite(p_checked_out_at)
    or p_checked_out_at > statement_timestamp() or p_request_id is null or p_expected_version is null then
    raise exception using errcode='22023', message='확인한 실제 퇴실 시각, 버전과 요청 ID가 필요합니다. 미래 시각은 사용할 수 없습니다.';
  end if;
  if not public.can_manage_operation_schedule(p_operation_schedule_id) then
    raise exception using errcode='42501', message='해당 일정의 퇴실 기록을 처리할 권한이 없습니다.';
  end if;
  payload := jsonb_build_object('scheduleId',p_operation_schedule_id,'expectedVersion',p_expected_version,
    'checkedOutAt',p_checked_out_at,'confirmed',p_confirmed);
  -- Same request lock/hash contract as the existing daycare commands.
  perform pg_advisory_xact_lock(hashtextextended('daycare-request:'||p_request_id::text,0));
  select * into state_row from public.daycare_operation_states where operation_schedule_id=p_operation_schedule_id for update;
  if not found then raise exception using errcode='P0002',message='Daycare 예약을 확인할 수 없습니다.'; end if;
  if public.daycare_request_replayed_internal(p_operation_schedule_id,p_request_id,'verified_check_out',payload) then
    return jsonb_build_object('operationScheduleId',state_row.operation_schedule_id,'version',state_row.version,
      'checkedOutAt',state_row.checked_out_at,'recordedAt',state_row.updated_at);
  end if;
  select * into schedule_row from public.operation_schedules where id=p_operation_schedule_id for update;
  if not found or schedule_row.archived_at is not null then raise exception using errcode='P0002',message='활성 Daycare 일정을 확인할 수 없습니다.'; end if;
  if state_row.version is distinct from p_expected_version then raise exception using errcode='PT409',message='다른 사용자가 먼저 Daycare 예약을 변경했습니다.'; end if;
  if state_row.schedule_version is distinct from schedule_row.version then raise exception using errcode='PT409',message='VERSION_DESYNC: 일정과 예약 버전을 확인해 주세요.'; end if;
  if state_row.lifecycle_status<>'checked_in' or state_row.checked_out_at is not null or state_row.checked_in_at is null
    or schedule_row.status<>'scheduled' then
    raise exception using errcode='22023',message='실제 입실 중인 Daycare만 퇴실 기록을 확정할 수 있습니다.';
  end if;
  if not isfinite(state_row.checked_in_at) or p_checked_out_at <= state_row.checked_in_at then raise exception using errcode='22023',message='실제 퇴실은 실제 입실보다 늦어야 합니다.'; end if;

  select * into strict capacity_row from public.hotel_capacity_reservations
    where daycare_schedule_id=p_operation_schedule_id and source_kind='daycare' and archived_at is null for update;
  if not isfinite(capacity_row.reserved_from) or not isfinite(capacity_row.reserved_until) then
    raise exception using errcode='22023',message='Daycare Capacity의 유한한 이용 구간을 확인해 주세요.';
  end if;
  if capacity_row.hotel_stay_id is not null or capacity_row.physical_occupancy_id is not null
    or capacity_row.shared_room_group_id is not null or capacity_row.quantity<>1 then
    raise exception using errcode='22023',message='단독 Daycare Capacity 연결을 확인해 주세요.';
  end if;
  -- Match the existing Capacity -> room advisory-lock order before any writes.
  perform public.assert_hotel_total_capacity_available(capacity_row.reserved_from,greatest(capacity_row.reserved_until,p_checked_out_at),1,capacity_row.id);
  perform public.assert_hotel_capacity_available(capacity_row.room_type_id,capacity_row.reserved_from,
    greatest(capacity_row.reserved_until,p_checked_out_at),1,capacity_row.id);
  if (select count(*) from public.hotel_room_allocations where capacity_reservation_id=capacity_row.id and archived_at is null)<>1 then
    raise exception using errcode='22023',message='여러 배정 구간이 있는 기록은 별도 이력 확인이 필요합니다.';
  end if;
  select * into strict allocation_row from public.hotel_room_allocations
    where capacity_reservation_id=capacity_row.id and archived_at is null for update;
  if not isfinite(allocation_row.allocated_from) or not isfinite(allocation_row.allocated_until) then
    raise exception using errcode='22023',message='Daycare 객실 배정의 유한한 이용 구간을 확인해 주세요.';
  end if;
  if allocation_row.allocated_from>state_row.checked_in_at or capacity_row.reserved_from>state_row.checked_in_at then
    raise exception using errcode='22023',message='실제 입실을 포함하는 배정 이력을 확인해 주세요.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('hotel-room:'||allocation_row.room_id::text,0));

  -- Preserve every old row. Archived planned rows are conservatively included: ambiguity blocks recovery.
  if exists(select 1 from public.hotel_room_allocations a
    where a.room_id=allocation_row.room_id and a.capacity_reservation_id<>capacity_row.id
      and a.allocated_from<greatest(allocation_row.allocated_until,p_checked_out_at)
      and a.allocated_until>allocation_row.allocated_from) then
    raise exception using errcode='23P01',message='실제 퇴실 구간과 다른 객실 배정 이력이 겹칩니다. 이력을 확인해 주세요.';
  end if;
  -- Actual stays/daycare may outlive a planned allocation. Clip preceding segments at the next segment,
  -- and retain the actual checkout bound on the last segment; never equate planned end with actual exit.
  if exists(
    with segments as (
      select a.*, lag(a.allocated_from) over(partition by a.capacity_reservation_id order by a.allocated_from,a.id) prev_from, lead(a.allocated_from) over(partition by a.capacity_reservation_id order by a.allocated_from,a.id) next_from
      from public.hotel_room_allocations a where a.archived_at is null and a.capacity_reservation_id<>capacity_row.id
    ), actual as (
      select a.room_id, case when a.prev_from is null then s.checked_in_at else greatest(a.allocated_from,s.checked_in_at) end lo,
        least(coalesce(a.next_from,'infinity'::timestamptz),coalesce(s.checked_out_at,'infinity'::timestamptz)) hi
      from segments a join public.hotel_capacity_reservations c on c.id=a.capacity_reservation_id
      join public.hotel_stays s on s.id=c.hotel_stay_id where s.checked_in_at is not null
      union all
      select a.room_id,case when a.prev_from is null then d.checked_in_at else greatest(a.allocated_from,d.checked_in_at) end,
        least(coalesce(a.next_from,'infinity'::timestamptz),coalesce(d.checked_out_at,'infinity'::timestamptz))
      from segments a join public.hotel_capacity_reservations c on c.id=a.capacity_reservation_id
      join public.daycare_operation_states d on d.operation_schedule_id=c.daycare_schedule_id where d.checked_in_at is not null
      union all
      select o.room_id,o.occupied_from,case when o.status='completed'
        and exists(select 1 from public.hotel_physical_occupancy_members m where m.occupancy_id=o.id and m.left_at is not null)
        and not exists(select 1 from public.hotel_physical_occupancy_members m where m.occupancy_id=o.id and m.archived_at is null and (m.status='active' or m.left_at is null)) then coalesce(
        (select max(m.left_at) from public.hotel_physical_occupancy_members m where m.occupancy_id=o.id),
        o.occupied_until,'infinity'::timestamptz) else 'infinity'::timestamptz end
      from public.hotel_physical_occupancies o where o.capacity_reservation_id is distinct from capacity_row.id
    ) select 1 from actual where room_id=allocation_row.room_id and lo<p_checked_out_at and hi>state_row.checked_in_at
  ) then
    raise exception using errcode='23P01',message='실제 퇴실 구간에 다른 점유 기록이 있거나 종료 근거가 부족합니다. 점유 이력을 확인해 주세요.';
  end if;

  perform set_config('app.operation_change_reason',reason,true);
  perform set_config('app.operation_request_id',p_request_id::text,true);
  if p_checked_out_at>capacity_row.reserved_until then
    update public.hotel_capacity_reservations set reserved_until=p_checked_out_at,updated_by=actor where id=capacity_row.id;
  end if;
  perform public.assert_hotel_room_allocation_available(allocation_row.room_id,capacity_row.id,allocation_row.allocated_from,
    greatest(allocation_row.allocated_until,p_checked_out_at),allocation_row.id);
  perform set_config('app.daycare_orchestration','on',true);
  result:=public.set_operation_schedule_status(p_operation_schedule_id,schedule_row.version,'completed',reason,
    public.daycare_child_request_id_internal(p_request_id,'schedule-complete'));
  perform set_config('app.daycare_orchestration','off',true);
  perform set_config('app.operation_change_reason',reason,true);
  perform set_config('app.operation_request_id',p_request_id::text,true);
  update public.daycare_operation_states set lifecycle_status='completed',schedule_version=(result->>'version')::integer,
    checked_out_at=p_checked_out_at,checked_out_by=actor,updated_by=actor,
    request_history=request_history||jsonb_build_object(p_request_id::text,jsonb_build_object('operationKind','verified_check_out',
      'payloadHash',public.daycare_payload_hash_internal(payload)))
    where operation_schedule_id=p_operation_schedule_id;
  -- Historical extension happens after actual checkout, inside this same atomic command.
  -- Existing triggers remain enabled; current-room acquisition is not misclassified as a historical update.
  if p_checked_out_at>allocation_row.allocated_until then
    update public.hotel_room_allocations set allocated_until=p_checked_out_at,updated_by=actor where id=allocation_row.id;
  end if;
  select * into state_row from public.daycare_operation_states where operation_schedule_id=p_operation_schedule_id;
  return jsonb_build_object('operationScheduleId',state_row.operation_schedule_id,'version',state_row.version,
    'checkedOutAt',state_row.checked_out_at,'recordedAt',state_row.updated_at);
end;
$$;
revoke all on function public.complete_verified_daycare_check_out_v1(uuid,integer,timestamptz,uuid,boolean) from public,anon,service_role;
grant execute on function public.complete_verified_daycare_check_out_v1(uuid,integer,timestamptz,uuid,boolean) to authenticated;

-- Minimize the new recovery read DTO; customer/contact/memo/free-text data are not returned.
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
    'dog',jsonb_build_object('name',coalesce(j.value->'dog'->>'name','반려견 정보 확인 필요')),
    'roomAllocation',case when j.value->'roomAllocation'='null'::jsonb then null else jsonb_build_object(
      'roomId',j.value->'roomAllocation'->>'roomId','roomName',j.value->'roomAllocation'->>'roomName') end
  ) order by d.checked_in_at,d.operation_schedule_id),'[]'::jsonb)
  from public.daycare_operation_states d join public.operation_schedules s on s.id=d.operation_schedule_id
  cross join lateral (select public.daycare_reservation_json(d.operation_schedule_id) value) j
  where s.archived_at is null and d.lifecycle_status='checked_in' and d.checked_in_at is not null and d.checked_out_at is null
    and (s.starts_at at time zone 'Asia/Seoul')::date<(statement_timestamp() at time zone 'Asia/Seoul')::date);
end;
$$;
revoke all on function public.get_overdue_daycare_operations_v1() from public,anon,service_role;
grant execute on function public.get_overdue_daycare_operations_v1() to authenticated;
commit;
