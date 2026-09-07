-- Shared Room pre-check-in allocation reversal and requested booking cancellation.
-- Append-only change set. Existing stays and schedules are preserved on unassign.

begin;

do $$
declare
  current_unique text;
  current_operation_kinds text[];
begin
  if to_regclass('public.hotel_physical_occupancies') is null
    or to_regclass('public.hotel_physical_occupancy_members') is null
    or to_regclass('public.hotel_physical_occupancy_requests') is null
    or to_regclass('public.family_bookings') is null
    or to_regclass('public.family_booking_members') is null
    or to_regclass('public.family_shared_room_groups') is null
    or to_regclass('public.hotel_stays') is null
    or to_regclass('public.hotel_stay_schedule_events') is null
    or to_regclass('public.hotel_capacity_reservations') is null
    or to_regclass('public.hotel_room_allocations') is null
    or to_regprocedure('public.claim_shared_hotel_request_internal(uuid,text,jsonb,uuid)') is null
    or to_regprocedure('public.finish_shared_hotel_request_internal(uuid,uuid,jsonb)') is null
    or to_regprocedure('public.family_booking_derived_status(uuid)') is null
    or to_regprocedure('public.set_operation_schedule_status(uuid,integer,text,text,uuid)') is null
  then
    raise exception 'STOP_SHARED_ROOM_REVERSAL_REQUIRED_CONTRACT_MISSING';
  end if;

  select pg_get_constraintdef(constraint_row.oid)
  into current_unique
  from pg_constraint constraint_row
  where constraint_row.conrelid = 'public.hotel_physical_occupancies'::regclass
    and constraint_row.conname = 'hotel_physical_occupancies_shared_room_group_id_key';
  if current_unique is distinct from 'UNIQUE (shared_room_group_id)' then
    raise exception 'STOP_SHARED_ROOM_REVERSAL_UNEXPECTED_UNIQUE_CONTRACT: %', current_unique;
  end if;
  select array_agg(kind_match[1] order by kind_match[1])
  into current_operation_kinds
  from regexp_matches(
    pg_get_constraintdef((
      select constraint_row.oid
      from pg_constraint constraint_row
      where constraint_row.conrelid = 'public.hotel_physical_occupancy_requests'::regclass
        and constraint_row.conname = 'hotel_physical_occupancy_requests_operation_kind_check'
    )),
    '''([^'']+)''',
    'g'
  ) kind_match;
  if current_operation_kinds is distinct from array[
    'check_in','check_out','create','join','merge_existing_stays','move','reverse_completion'
  ]::text[] then
    raise exception 'STOP_SHARED_ROOM_REVERSAL_UNEXPECTED_REQUEST_OPERATION_KINDS: %', current_operation_kinds;
  end if;
  if to_regclass('public.hotel_physical_occupancies_active_shared_room_group_uidx') is not null
    or to_regprocedure('public.unassign_shared_hotel_room_before_check_in(uuid,integer,text,uuid)') is not null
    or to_regprocedure('public.cancel_shared_hotel_room_family_booking(uuid,integer,text,uuid)') is not null
  then
    raise exception 'STOP_SHARED_ROOM_REVERSAL_ALREADY_APPLIED';
  end if;
  if exists (
    select 1
    from public.hotel_physical_occupancies occupancy
    where occupancy.archived_at is null
    group by occupancy.shared_room_group_id
    having count(*) > 1
  ) then
    raise exception 'STOP_SHARED_ROOM_REVERSAL_DUPLICATE_ACTIVE_OCCUPANCY';
  end if;
end;
$$;

alter table public.hotel_physical_occupancies
  drop constraint hotel_physical_occupancies_shared_room_group_id_key;

create unique index hotel_physical_occupancies_active_shared_room_group_uidx
  on public.hotel_physical_occupancies(shared_room_group_id)
  where archived_at is null;

alter table public.hotel_physical_occupancy_requests
  drop constraint hotel_physical_occupancy_requests_operation_kind_check;
alter table public.hotel_physical_occupancy_requests
  add constraint hotel_physical_occupancy_requests_operation_kind_check
  check (operation_kind in (
    'create','join','check_in','check_out','reverse_completion','move',
    'merge_existing_stays','unassign','cancel_booking'
  ));

create function public.unassign_shared_hotel_room_before_check_in(
  p_occupancy_id uuid,
  p_expected_version integer,
  p_reason text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  normalized_reason text := nullif(btrim(p_reason), '');
  payload jsonb;
  replay jsonb;
  occupancy public.hotel_physical_occupancies%rowtype;
  shared_group public.family_shared_room_groups%rowtype;
  family public.family_bookings%rowtype;
  capacity public.hotel_capacity_reservations%rowtype;
  allocation public.hotel_room_allocations%rowtype;
  member_count integer;
  allocation_count integer;
  capacity_count integer;
  result jsonb;
begin
  if actor_id is null or not public.is_active_operation_member() then
    raise exception '공유 객실 배정 해제 권한이 없습니다.' using errcode = '42501';
  end if;
  if p_occupancy_id is null or p_expected_version is null
    or normalized_reason is null or p_request_id is null then
    raise exception '공유 객실, 기존 버전, 해제 사유, 요청 ID가 필요합니다.' using errcode = '22023';
  end if;
  payload := jsonb_build_object(
    'occupancyId', p_occupancy_id,
    'expectedVersion', p_expected_version,
    'reason', normalized_reason
  );
  replay := public.claim_shared_hotel_request_internal(
    p_request_id, 'unassign', payload, p_occupancy_id
  );
  if replay is not null then return replay; end if;

  select * into occupancy
  from public.hotel_physical_occupancies target
  where target.id = p_occupancy_id
  for update;
  if not found or occupancy.archived_at is not null or occupancy.status <> 'active' then
    raise exception '활성 공유 객실 배정을 확인할 수 없습니다.' using errcode = 'PT409';
  end if;
  if occupancy.version <> p_expected_version then
    raise exception '다른 사용자가 먼저 공유 객실을 수정했습니다.' using errcode = 'PT409';
  end if;
  select * into shared_group
  from public.family_shared_room_groups target
  where target.id = occupancy.shared_room_group_id
  for update;
  if not found or shared_group.archived_at is not null or shared_group.status <> 'allocated'
    or shared_group.family_booking_id <> occupancy.family_booking_id then
    raise exception '배정된 Shared Room Group 계약이 올바르지 않습니다.' using errcode = '23514';
  end if;
  select * into family
  from public.family_bookings target
  where target.id = occupancy.family_booking_id and target.archived_at is null
  for update;
  if not found or family.customer_id <> occupancy.customer_id then
    raise exception 'Shared Room 보호자 계약이 올바르지 않습니다.' using errcode = '23514';
  end if;

  perform 1
  from public.hotel_stays stay
  join public.family_booking_members member on member.hotel_stay_id = stay.id
  join public.dogs dog on dog.id = member.dog_id
  where member.shared_room_group_id = shared_group.id
    and member.family_booking_id = family.id
    and member.service_type = 'hotel'
    and member.archived_at is null
  order by stay.id
  for update of stay, member;
  if exists (
    select 1
    from public.family_booking_members member
    join public.hotel_stays stay on stay.id = member.hotel_stay_id
    join public.dogs dog on dog.id = member.dog_id
    where member.shared_room_group_id = shared_group.id
      and member.archived_at is null
      and (stay.archived_at is not null or stay.checked_in_at is not null
        or stay.checked_out_at is not null or dog.customer_id <> family.customer_id)
  ) then
    raise exception '입실 전 정상 상태의 Shared Room만 배정 해제할 수 있습니다.' using errcode = 'PT409';
  end if;

  select count(*)::integer into member_count
  from public.hotel_physical_occupancy_members member
  where member.occupancy_id = occupancy.id and member.archived_at is null;
  if member_count <> shared_group.requested_capacity or member_count < 2 then
    raise exception '공유 객실 Physical Member 계약이 올바르지 않습니다.' using errcode = '23514';
  end if;
  perform 1 from public.hotel_physical_occupancy_members member
  where member.occupancy_id = occupancy.id and member.archived_at is null
  order by member.id for update;

  select count(*)::integer into capacity_count
  from public.hotel_capacity_reservations target
  where target.id = occupancy.capacity_reservation_id
    and target.source_kind = 'shared_occupancy'
    and target.physical_occupancy_id = occupancy.id
    and target.shared_room_group_id is null
    and target.archived_at is null;
  select * into capacity from public.hotel_capacity_reservations target
  where target.id = occupancy.capacity_reservation_id for update;
  select count(*)::integer into allocation_count
  from public.hotel_room_allocations target
  where target.id = occupancy.room_allocation_id
    and target.capacity_reservation_id = occupancy.capacity_reservation_id
    and target.room_id = occupancy.room_id and target.archived_at is null;
  select * into allocation from public.hotel_room_allocations target
  where target.id = occupancy.room_allocation_id for update;
  if capacity_count <> 1 or allocation_count <> 1 or capacity.quantity <> 1
    or capacity.room_type_id <> occupancy.room_type_id
    or capacity.reserved_from <> occupancy.occupied_from
    or capacity.reserved_until <> occupancy.occupied_until
    or allocation.allocated_from <> occupancy.occupied_from
    or allocation.allocated_until <> occupancy.occupied_until
    or not exists (
      select 1 from public.hotel_room_types room_type
      where room_type.id = occupancy.room_type_id and room_type.archived_at is null
        and room_type.is_active and upper(btrim(room_type.code)) = 'DELUXE'
    ) then
    raise exception '공유 객실 Capacity/Allocation 계약이 올바르지 않습니다.' using errcode = '23514';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('hotel-capacity:all', 0));
  perform pg_advisory_xact_lock(hashtextextended('hotel-capacity:' || occupancy.room_type_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('hotel-room:' || occupancy.room_id::text, 0));
  perform set_config('app.operation_change_reason', normalized_reason, true);
  perform set_config('app.operation_request_id', p_request_id::text, true);

  update public.hotel_room_allocations target
  set archived_at = now(), archived_by = actor_id, archive_reason = normalized_reason,
      updated_by = actor_id
  where target.id = allocation.id;
  update public.hotel_physical_occupancy_members target
  set archived_at = now(), archived_by = actor_id, archive_reason = normalized_reason,
      updated_by = actor_id
  where target.occupancy_id = occupancy.id and target.archived_at is null;
  update public.hotel_physical_occupancies target
  set archived_at = now(), archived_by = actor_id, archive_reason = normalized_reason,
      updated_by = actor_id
  where target.id = occupancy.id;
  update public.hotel_capacity_reservations target
  set source_kind = 'shared_group', physical_occupancy_id = null,
      shared_room_group_id = shared_group.id, updated_by = actor_id
  where target.id = capacity.id;
  update public.family_shared_room_groups target
  set status = 'requested', updated_by = actor_id
  where target.id = shared_group.id;

  select jsonb_build_object(
    'physicalOccupancyId', occupancy.id,
    'sharedRoomGroupId', shared_group.id,
    'status', 'requested',
    'version', target.version
  ) into result
  from public.family_shared_room_groups target where target.id = shared_group.id;
  return public.finish_shared_hotel_request_internal(p_request_id, occupancy.id, result);
end;
$$;

create function public.cancel_shared_hotel_room_family_booking(
  p_shared_room_group_id uuid,
  p_expected_version integer,
  p_reason text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  normalized_reason text := nullif(btrim(p_reason), '');
  payload jsonb;
  replay jsonb;
  shared_group public.family_shared_room_groups%rowtype;
  family public.family_bookings%rowtype;
  capacity public.hotel_capacity_reservations%rowtype;
  schedule public.operation_schedules%rowtype;
  member_count integer;
  capacity_count integer;
  result jsonb;
begin
  if actor_id is null or not public.is_active_operation_member() then
    raise exception '함께 투숙 예약 취소 권한이 없습니다.' using errcode = '42501';
  end if;
  if p_shared_room_group_id is null or p_expected_version is null
    or normalized_reason is null or p_request_id is null then
    raise exception 'Shared Room Group, 기존 버전, 취소 사유, 요청 ID가 필요합니다.' using errcode = '22023';
  end if;
  payload := jsonb_build_object(
    'sharedRoomGroupId', p_shared_room_group_id,
    'expectedVersion', p_expected_version,
    'reason', normalized_reason
  );
  replay := public.claim_shared_hotel_request_internal(
    p_request_id, 'cancel_booking', payload, null
  );
  if replay is not null then return replay; end if;

  select * into shared_group from public.family_shared_room_groups target
  where target.id = p_shared_room_group_id for update;
  if not found or shared_group.archived_at is not null or shared_group.status <> 'requested' then
    raise exception '미배정 상태의 Shared Room Group만 취소할 수 있습니다.' using errcode = 'PT409';
  end if;
  if shared_group.version <> p_expected_version then
    raise exception '다른 사용자가 먼저 함께 투숙 예약을 수정했습니다.' using errcode = 'PT409';
  end if;
  select * into family from public.family_bookings target
  where target.id = shared_group.family_booking_id and target.archived_at is null
  for update;
  if not found then raise exception 'Family Booking을 확인할 수 없습니다.' using errcode = 'P0002'; end if;

  perform 1
  from public.family_booking_members member
  join public.hotel_stays stay on stay.id = member.hotel_stay_id
  where member.shared_room_group_id = shared_group.id and member.archived_at is null
  order by stay.id for update of member, stay;
  select count(*)::integer into member_count
  from public.family_booking_members member
  where member.shared_room_group_id = shared_group.id
    and member.family_booking_id = family.id and member.service_type = 'hotel'
    and member.archived_at is null;
  if member_count <> shared_group.requested_capacity or member_count < 2
    or exists (
      select 1 from public.family_booking_members member
      join public.hotel_stays stay on stay.id = member.hotel_stay_id
      join public.dogs dog on dog.id = member.dog_id
      where member.shared_room_group_id = shared_group.id and member.archived_at is null
        and (stay.archived_at is not null or stay.checked_in_at is not null
          or stay.checked_out_at is not null or dog.customer_id <> family.customer_id)
    ) then
    raise exception '입실 전 정상 상태의 Shared Room만 취소할 수 있습니다.' using errcode = 'PT409';
  end if;
  if exists (
    select 1 from public.hotel_physical_occupancies occupancy
    where occupancy.shared_room_group_id = shared_group.id and occupancy.archived_at is null
  ) or exists (
    select 1 from public.hotel_physical_occupancy_members physical_member
    join public.hotel_physical_occupancies occupancy on occupancy.id = physical_member.occupancy_id
    where occupancy.shared_room_group_id = shared_group.id and physical_member.archived_at is null
  ) then
    raise exception '객실 배정 상태에서는 함께 투숙 예약을 바로 취소할 수 없습니다.' using errcode = 'PT409';
  end if;

  select count(*)::integer into capacity_count
  from public.hotel_capacity_reservations target
  where target.shared_room_group_id = shared_group.id
    and target.source_kind = 'shared_group' and target.archived_at is null;
  select * into capacity from public.hotel_capacity_reservations target
  where target.shared_room_group_id = shared_group.id
    and target.source_kind = 'shared_group' and target.archived_at is null
  for update;
  if capacity_count <> 1 or capacity.quantity <> 1
    or capacity.physical_occupancy_id is not null
    or capacity.room_type_id <> shared_group.room_type_id
    or capacity.reserved_from <> shared_group.normalized_starts_at
    or capacity.reserved_until <> shared_group.normalized_ends_at
    or exists (
      select 1 from public.hotel_room_allocations allocation
      where allocation.capacity_reservation_id = capacity.id and allocation.archived_at is null
    ) or not exists (
      select 1 from public.hotel_room_types room_type
      where room_type.id = capacity.room_type_id and room_type.archived_at is null
        and room_type.is_active and upper(btrim(room_type.code)) = 'DELUXE'
    ) then
    raise exception '미배정 Shared Room Capacity 계약이 올바르지 않습니다.' using errcode = '23514';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('hotel-capacity:all', 0));
  perform pg_advisory_xact_lock(hashtextextended('hotel-capacity:' || capacity.room_type_id::text, 0));
  for schedule in
    select operation_schedule.*
    from public.hotel_stay_schedule_events event
    join public.operation_schedules operation_schedule on operation_schedule.id = event.operation_schedule_id
    join public.family_booking_members member on member.hotel_stay_id = event.hotel_stay_id
    where member.shared_room_group_id = shared_group.id
      and member.archived_at is null and event.archived_at is null
    order by operation_schedule.id
  loop
    if not public.can_manage_operation_schedule(schedule.id) then
      raise exception '호텔 예약 생성자 또는 담당자만 취소할 수 있습니다.' using errcode = '42501';
    end if;
    if schedule.status <> 'cancelled' then
      perform public.set_operation_schedule_status(
        schedule.id, schedule.version, 'cancelled', normalized_reason, gen_random_uuid()
      );
    end if;
  end loop;

  perform set_config('app.operation_change_reason', normalized_reason, true);
  perform set_config('app.operation_request_id', p_request_id::text, true);
  update public.hotel_capacity_reservations target
  set archived_at = now(), archived_by = actor_id, archive_reason = normalized_reason,
      updated_by = actor_id
  where target.id = capacity.id;
  update public.hotel_stays target
  set archived_at = now(), archived_by = actor_id, archive_reason = normalized_reason,
      updated_by = actor_id
  where target.id in (
    select member.hotel_stay_id from public.family_booking_members member
    where member.shared_room_group_id = shared_group.id and member.archived_at is null
  );
  update public.family_booking_members target
  set status = 'cancelled', updated_by = actor_id
  where target.shared_room_group_id = shared_group.id and target.archived_at is null;
  update public.family_shared_room_groups target
  set status = 'cancelled', updated_by = actor_id
  where target.id = shared_group.id;
  update public.family_bookings target
  set status = public.family_booking_derived_status(target.id), updated_by = actor_id
  where target.id = family.id;

  select jsonb_build_object(
    'sharedRoomGroupId', target.id,
    'familyBookingId', family.id,
    'sharedRoomGroupStatus', target.status,
    'familyBookingStatus', public.family_booking_derived_status(family.id),
    'version', target.version
  ) into result
  from public.family_shared_room_groups target where target.id = shared_group.id;
  return public.finish_shared_hotel_request_internal(p_request_id, null, result);
end;
$$;

comment on function public.unassign_shared_hotel_room_before_check_in(uuid,integer,text,uuid)
  is 'Atomically reverses one pre-check-in Shared Room allocation to its requested group using the same Capacity row.';
comment on function public.cancel_shared_hotel_room_family_booking(uuid,integer,text,uuid)
  is 'Atomically cancels one requested/unassigned Shared Room family booking group and its schedules/stays.';

revoke all on function public.unassign_shared_hotel_room_before_check_in(uuid,integer,text,uuid) from public, anon;
grant execute on function public.unassign_shared_hotel_room_before_check_in(uuid,integer,text,uuid) to authenticated, service_role;
revoke all on function public.cancel_shared_hotel_room_family_booking(uuid,integer,text,uuid) from public, anon;
grant execute on function public.cancel_shared_hotel_room_family_booking(uuid,integer,text,uuid) to authenticated, service_role;

commit;
