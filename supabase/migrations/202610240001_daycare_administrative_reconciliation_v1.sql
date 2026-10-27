begin;
do $$ begin
 if current_user<>'postgres' or (select md5(prosrc) from pg_proc where oid=to_regprocedure('public.complete_verified_daycare_check_out_v1(uuid,integer,timestamptz,uuid,boolean)')) is distinct from '0ab77df751ddef2d4805701412df8d26' or (select md5(prosrc) from pg_proc where oid=to_regprocedure('public.protect_daycare_operation_state_internal()')) is distinct from 'cea3c868fc9f44d9711eb0a72522bfac' or (select md5(prosrc) from pg_proc where oid=to_regprocedure('public.daycare_reservation_json(uuid)')) is distinct from '56d544f4fb89c45f0e2e60f76f7936aa' or (select md5(prosrc) from pg_proc where oid=to_regprocedure('public.complete_daycare_check_in(uuid,integer,timestamptz,uuid)')) is distinct from '0067886142e26b1538c9e1182a52b440' or (select md5(prosrc) from pg_proc where oid=to_regprocedure('public.complete_daycare_check_out(uuid,integer,timestamptz,uuid)')) is distinct from '27ef3dddcbbd8c1e20dda80b25e7c83c' or (select md5(prosrc) from pg_proc where oid=to_regprocedure('public.daycare_reversed_allocation_proven_v1(uuid)')) is distinct from '0e3b3211600c25b450640a01482fce05' or (select md5(prosrc) from pg_proc where oid=to_regprocedure('public.daycare_closed_long_stay_bound_v1(uuid)')) is distinct from 'bc1c6dc667d83a07809b395bde995c92' then raise exception 'STOP_RECOVERY_PREDECESSOR'; end if;
end $$;
alter table public.daycare_operation_states
 add column administrative_approved_at timestamptz,
 add column administrative_approved_by uuid references public.profiles(id) on delete restrict,
 add column administrative_released_at timestamptz,
 add column administrative_released_by uuid references public.profiles(id) on delete restrict,
 add column administrative_release_reason text,
 add column administrative_release_evidence text,
 add column administrative_release_approval text,
 add column administrative_release_request_id uuid unique;
alter table public.daycare_operation_states drop constraint daycare_operation_states_lifecycle_status_check;
alter table public.daycare_operation_states add constraint daycare_operation_states_lifecycle_status_check check(lifecycle_status in('scheduled','checked_in','completed','cancelled','administratively_released'));
alter table public.daycare_operation_states drop constraint daycare_operation_states_lifecycle_check;
alter table public.daycare_operation_states add constraint daycare_operation_states_lifecycle_check check (

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
 or (lifecycle_status='administratively_released' and checked_in_at is not null and checked_in_by is not null and checked_out_at is null and checked_out_by is null and cancelled_at is null and cancelled_by is null and cancel_reason is null)
);
alter table public.daycare_operation_states add constraint daycare_administrative_release_metadata_check check (
 (lifecycle_status='administratively_released' and administrative_approved_at is not null and administrative_approved_by is not null and administrative_released_at is not null and administrative_released_by is not null and nullif(btrim(administrative_release_reason),'') is not null and nullif(btrim(administrative_release_evidence),'') is not null and nullif(btrim(administrative_release_approval),'') is not null and administrative_release_request_id is not null)
 or (lifecycle_status<>'administratively_released' and administrative_approved_at is null and administrative_approved_by is null and administrative_released_at is null and administrative_released_by is null and administrative_release_reason is null and administrative_release_evidence is null and administrative_release_approval is null and administrative_release_request_id is null)
);
create function public.administratively_release_daycare_occupancy_v1(p_operation_schedule_id uuid,p_dog_id uuid,p_expected_version integer,p_reason text,p_evidence text,p_approval text,p_confirmed_vacant boolean,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=auth.uid(); d public.daycare_operation_states%rowtype; s public.operation_schedules%rowtype; c public.hotel_capacity_reservations%rowtype; a public.hotel_room_allocations%rowtype; payload jsonb;
begin
 if actor is null or not public.is_admin() or not public.is_active_operation_member() or not public.can_operate_hotel() or not public.can_manage_operation_schedule(p_operation_schedule_id) then raise exception '관리자 호텔 정합성 복구 권한이 필요합니다.' using errcode='42501'; end if;
 if p_request_id is null or p_expected_version is null or p_dog_id is null or p_confirmed_vacant is distinct from true or nullif(btrim(p_reason),'') is null or nullif(btrim(p_evidence),'') is null or nullif(btrim(p_approval),'') is null then raise exception '정확한 대상, 현재 공실 확인, 근거와 승인이 필요합니다.' using errcode='22023'; end if;
 payload:=jsonb_build_object('scheduleId',p_operation_schedule_id,'dogId',p_dog_id,'expectedVersion',p_expected_version,'reason',p_reason,'evidence',p_evidence,'approval',p_approval,'confirmedVacant',p_confirmed_vacant);
 perform pg_advisory_xact_lock(hashtextextended('daycare-request:'||p_request_id::text,0));
 select * into strict d from public.daycare_operation_states where operation_schedule_id=p_operation_schedule_id for update;
 if public.daycare_request_replayed_internal(p_operation_schedule_id,p_request_id,'administrative_release',payload) then return public.daycare_reservation_json(p_operation_schedule_id); end if;
 select * into strict s from public.operation_schedules where id=p_operation_schedule_id for update;
 if d.version is distinct from p_expected_version or d.schedule_version is distinct from s.version then raise exception 'VERSION_CONFLICT' using errcode='PT409'; end if;
 if d.lifecycle_status<>'checked_in' or d.checked_out_at is not null or s.archived_at is not null or s.status<>'scheduled' or (s.starts_at at time zone 'Asia/Seoul')::date>=(statement_timestamp() at time zone 'Asia/Seoul')::date then raise exception '과거 미퇴실 기록만 행정 해제할 수 있습니다.' using errcode='22023'; end if;
 if d.canonical_payload->>'dogId' is distinct from p_dog_id::text or (select count(*) from public.operation_schedule_dogs where schedule_id=s.id and archived_at is null)<>1 or not exists(select 1 from public.operation_schedule_dogs where schedule_id=s.id and dog_id=p_dog_id and archived_at is null) then raise exception '반려견 연결 불일치' using errcode='22023'; end if;
 select * into strict c from public.hotel_capacity_reservations where daycare_schedule_id=s.id and source_kind='daycare' and archived_at is null for update;
 if c.quantity<>1 or c.hotel_stay_id is not null or c.physical_occupancy_id is not null or c.shared_room_group_id is not null or not isfinite(c.reserved_until) or c.reserved_until>statement_timestamp() then raise exception '단독 과거 Daycare Capacity 확인 필요' using errcode='22023'; end if;
 perform public.assert_hotel_total_capacity_available(c.reserved_from,c.reserved_until,1,c.id);
 perform public.assert_hotel_capacity_available(c.room_type_id,c.reserved_from,c.reserved_until,1,c.id);
 if (select count(*) from public.hotel_room_allocations where capacity_reservation_id=c.id and archived_at is null)<>1 then raise exception '다중 배정은 별도 확인이 필요합니다.' using errcode='22023'; end if;
 select * into strict a from public.hotel_room_allocations where capacity_reservation_id=c.id and archived_at is null for update;
 if not isfinite(a.allocated_until) or a.allocated_until>statement_timestamp() or exists(select 1 from public.hotel_physical_occupancies where capacity_reservation_id=c.id or room_allocation_id=a.id) then raise exception '독립 Physical 또는 미래 배정은 자동 정리할 수 없습니다.' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('hotel-room:'||a.room_id::text,0));
 if exists(select 1 from public.hotel_current_physical_rooms_internal() p where p.room_id=a.room_id and p.capacity_id is distinct from c.id) or exists(select 1 from public.hotel_physical_occupancies o where o.room_id=a.room_id and o.archived_at is null and (o.status<>'completed' or exists(select 1 from public.hotel_physical_occupancy_members m where m.occupancy_id=o.id and m.archived_at is null and (m.status='active' or m.left_at is null)))) then raise exception '다른 유효 점유가 있어 행정 해제를 중단합니다.' using errcode='23P01'; end if;
 perform set_config('app.operation_change_reason','행정 점유 해제 · 실제 퇴실시각 미확정: '||p_reason||' [request:'||p_request_id::text||']',true);
 perform set_config('app.operation_request_id',p_request_id::text,true);
 update public.hotel_room_allocations set archived_at=clock_timestamp(),archived_by=actor,archive_reason='daycare_administrative_release: '||p_reason,updated_by=actor where id=a.id;
 update public.hotel_capacity_reservations set archived_at=clock_timestamp(),archived_by=actor,archive_reason='daycare_administrative_release: '||p_reason,updated_by=actor where id=c.id;
 update public.daycare_operation_states set lifecycle_status='administratively_released',administrative_approved_at=clock_timestamp(),administrative_approved_by=actor,administrative_released_at=clock_timestamp(),administrative_released_by=actor,administrative_release_reason=p_reason,administrative_release_evidence=p_evidence,administrative_release_approval=p_approval,administrative_release_request_id=p_request_id,updated_by=actor,request_history=request_history||jsonb_build_object(p_request_id::text,jsonb_build_object('operationKind','administrative_release','payloadHash',public.daycare_payload_hash_internal(payload))) where operation_schedule_id=s.id;
 return public.daycare_reservation_json(s.id);
end $$;
revoke all on function public.administratively_release_daycare_occupancy_v1(uuid,uuid,integer,text,text,text,boolean,uuid) from public,anon,service_role;
grant execute on function public.administratively_release_daycare_occupancy_v1(uuid,uuid,integer,text,text,text,boolean,uuid) to authenticated;
create or replace function public.protect_daycare_operation_state_internal() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if old.lifecycle_status='administratively_released' then raise exception '행정 해제 기록은 변경할 수 없습니다.' using errcode='22023'; end if;
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
create function public.record_verified_daycare_visit_v1(p_operation_schedule_id uuid,p_expected_version integer,p_checked_in_at timestamptz,p_checked_out_at timestamptz,p_request_id uuid,p_confirmed boolean) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  actor uuid := auth.uid();
  state_row public.daycare_operation_states%rowtype;
  schedule_row public.operation_schedules%rowtype;
  capacity_row public.hotel_capacity_reservations%rowtype;
  allocation_row public.hotel_room_allocations%rowtype;
  payload jsonb;
  result jsonb;
  reason text := '확인된 실제 이용 시각 사후 기록';
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
    'checkedInAt',p_checked_in_at,'checkedOutAt',p_checked_out_at,'confirmed',p_confirmed);
  -- Same request lock/hash contract as the existing daycare commands.
  perform pg_advisory_xact_lock(hashtextextended('daycare-request:'||p_request_id::text,0));
  select * into state_row from public.daycare_operation_states where operation_schedule_id=p_operation_schedule_id for update;
  if not found then raise exception using errcode='P0002',message='Daycare 예약을 확인할 수 없습니다.'; end if;
  if public.daycare_request_replayed_internal(p_operation_schedule_id,p_request_id,'retrospective_visit',payload) then
    return public.daycare_reservation_json(p_operation_schedule_id);
  end if;
  select * into schedule_row from public.operation_schedules where id=p_operation_schedule_id for update;
  if not found or schedule_row.archived_at is not null then raise exception using errcode='P0002',message='활성 Daycare 일정을 확인할 수 없습니다.'; end if;
  if state_row.version is distinct from p_expected_version then raise exception using errcode='PT409',message='다른 사용자가 먼저 Daycare 예약을 변경했습니다.'; end if;
  if state_row.schedule_version is distinct from schedule_row.version then raise exception using errcode='PT409',message='VERSION_DESYNC: 일정과 예약 버전을 확인해 주세요.'; end if;
  if state_row.lifecycle_status<>'scheduled' or state_row.checked_in_at is not null or state_row.checked_out_at is not null or schedule_row.status<>'scheduled' then raise exception '미처리 예약만 사후 이용 기록이 가능합니다.' using errcode='22023'; end if;
  if p_checked_in_at is null or not isfinite(p_checked_in_at) or p_checked_in_at>=p_checked_out_at or p_checked_in_at>statement_timestamp() or (p_checked_in_at at time zone 'Asia/Seoul')::date<>(schedule_row.starts_at at time zone 'Asia/Seoul')::date or p_checked_in_at>=schedule_row.ends_at then raise exception '확인된 실제 입퇴실 시각의 날짜와 순서를 확인해 주세요.' using errcode='22023'; end if;


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
  if allocation_row.allocated_from>p_checked_in_at or capacity_row.reserved_from>p_checked_in_at then
    raise exception using errcode='22023',message='실제 입실을 포함하는 배정 이력을 확인해 주세요.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('hotel-room:'||allocation_row.room_id::text,0));

  -- Retain all history; only an audit-proven entry reversal is non-occupying.
  if exists(select 1 from public.hotel_room_allocations a
    where a.room_id=allocation_row.room_id and a.capacity_reservation_id<>capacity_row.id
      and a.allocated_from<greatest(allocation_row.allocated_until,p_checked_out_at)
      and a.allocated_until>allocation_row.allocated_from
      and not public.daycare_reversed_allocation_proven_v1(a.id)) then
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
        least(coalesce(a.next_from,'infinity'::timestamptz),coalesce(s.checked_out_at,'infinity'::timestamptz),
          coalesce(public.daycare_closed_long_stay_bound_v1(a.id),'infinity'::timestamptz)) hi
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
    ) select 1 from actual where room_id=allocation_row.room_id and lo<p_checked_out_at and hi>p_checked_in_at
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
    checked_in_at=p_checked_in_at,checked_in_by=actor,checked_out_at=p_checked_out_at,checked_out_by=actor,updated_by=actor,
    request_history=request_history||jsonb_build_object(p_request_id::text,jsonb_build_object('operationKind','retrospective_visit',
      'payloadHash',public.daycare_payload_hash_internal(payload)))
    where operation_schedule_id=p_operation_schedule_id;
  -- Historical extension happens after actual checkout, inside this same atomic command.
  -- Existing triggers remain enabled; current-room acquisition is not misclassified as a historical update.
  if p_checked_out_at>allocation_row.allocated_until then
    update public.hotel_room_allocations set allocated_until=p_checked_out_at,updated_by=actor where id=allocation_row.id;
  end if;
  select * into state_row from public.daycare_operation_states where operation_schedule_id=p_operation_schedule_id;
  return public.daycare_reservation_json(p_operation_schedule_id);
end;
$$;
revoke all on function public.record_verified_daycare_visit_v1(uuid,integer,timestamptz,timestamptz,uuid,boolean) from public,anon,service_role;
grant execute on function public.record_verified_daycare_visit_v1(uuid,integer,timestamptz,timestamptz,uuid,boolean) to authenticated;

-- Normal commands retain their bodies/ACLs; explicit actual timestamps cannot be future/infinite.
create or replace function public.complete_daycare_check_in(p_operation_schedule_id uuid,p_expected_version integer,p_checked_in_at timestamptz,p_request_id uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor_id uuid:=auth.uid(); state_row public.daycare_operation_states%rowtype; schedule_row public.operation_schedules%rowtype; payload jsonb;
begin
  if actor_id is null or not public.is_active_operation_member() then raise exception 'Daycare 입실 처리 권한이 없습니다.' using errcode='42501'; end if;
  if p_checked_in_at is null or not isfinite(p_checked_in_at) or p_checked_in_at>statement_timestamp() then raise exception '미래 또는 미확인 시각을 실제 이용 시각으로 기록할 수 없습니다.' using errcode='22023'; end if;
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
create or replace function public.complete_daycare_check_out(p_operation_schedule_id uuid,p_expected_version integer,p_checked_out_at timestamptz,p_request_id uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor_id uuid:=auth.uid(); state_row public.daycare_operation_states%rowtype; schedule_row public.operation_schedules%rowtype;
  capacity_row public.hotel_capacity_reservations%rowtype; allocation_row public.hotel_room_allocations%rowtype; payload jsonb; schedule_result jsonb;
begin
  if actor_id is null or not public.is_active_operation_member() then raise exception 'Daycare 퇴실 처리 권한이 없습니다.' using errcode='42501'; end if;
  if p_checked_out_at is null or not isfinite(p_checked_out_at) or p_checked_out_at>statement_timestamp() then raise exception '미래 또는 미확인 시각을 실제 이용 시각으로 기록할 수 없습니다.' using errcode='22023'; end if;
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

-- Terminal reconciliation cannot reacquire inventory through older low-level commands.
-- This adds protection only for the new state; normal inventory/physical guards are untouched.
create function public.guard_administratively_released_daycare_inventory_v1()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare schedule_id uuid;
begin
 if new.archived_at is null then
  if tg_table_name='hotel_capacity_reservations' then schedule_id:=new.daycare_schedule_id;
  else select daycare_schedule_id into schedule_id from public.hotel_capacity_reservations where id=new.capacity_reservation_id;
  end if;
  if exists(select 1 from public.daycare_operation_states where operation_schedule_id=schedule_id and lifecycle_status='administratively_released') then raise exception '행정 해제 기록은 재배정할 수 없습니다.' using errcode='22023'; end if;
 end if;
 return new;
end $$;
revoke all on function public.guard_administratively_released_daycare_inventory_v1() from public,anon,authenticated,service_role;
create trigger daycare_administrative_capacity_guard before insert or update on public.hotel_capacity_reservations for each row execute function public.guard_administratively_released_daycare_inventory_v1();
create trigger daycare_administrative_allocation_guard before insert or update on public.hotel_room_allocations for each row execute function public.guard_administratively_released_daycare_inventory_v1();
commit;
