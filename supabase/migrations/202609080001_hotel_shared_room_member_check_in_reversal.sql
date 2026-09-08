-- Shared Room member check-in reversal.
-- Append-only change set. Physical occupancy, allocation, and capacity remain unchanged.

begin;

do $$
declare
  current_operation_kinds text[];
begin
  if to_regclass('public.hotel_physical_occupancies') is null
    or to_regclass('public.hotel_physical_occupancy_members') is null
    or to_regclass('public.hotel_physical_occupancy_requests') is null
    or to_regclass('public.family_bookings') is null
    or to_regclass('public.family_booking_members') is null
    or to_regclass('public.family_shared_room_groups') is null
    or to_regclass('public.hotel_stays') is null
    or to_regclass('public.hotel_capacity_reservations') is null
    or to_regclass('public.hotel_room_allocations') is null
    or to_regprocedure('public.claim_shared_hotel_request_internal(uuid,text,jsonb,uuid)') is null
    or to_regprocedure('public.finish_shared_hotel_request_internal(uuid,uuid,jsonb)') is null
    or to_regprocedure('public.shared_hotel_occupancy_json_internal(uuid)') is null
    or to_regprocedure('public.hotel_stay_json(uuid)') is null
    or to_regprocedure('public.reverse_hotel_completion(uuid,integer,text,text,uuid)') is null
  then
    raise exception 'STOP_SHARED_CHECKIN_REVERSAL_REQUIRED_CONTRACT_MISSING';
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
    'cancel_booking','check_in','check_out','create','join','merge_existing_stays',
    'move','reverse_completion','unassign'
  ]::text[] then
    raise exception 'STOP_SHARED_CHECKIN_REVERSAL_UNEXPECTED_REQUEST_OPERATION_KINDS: %', current_operation_kinds;
  end if;

  if to_regprocedure('public.reverse_shared_hotel_member_check_in(uuid,uuid,integer,integer,text,uuid)') is not null then
    raise exception 'STOP_SHARED_CHECKIN_REVERSAL_ALREADY_APPLIED';
  end if;
end;
$$;

alter table public.hotel_physical_occupancy_requests
  drop constraint hotel_physical_occupancy_requests_operation_kind_check;
alter table public.hotel_physical_occupancy_requests
  add constraint hotel_physical_occupancy_requests_operation_kind_check
  check (operation_kind in (
    'create','join','check_in','check_out','reverse_check_in','reverse_completion',
    'move','merge_existing_stays','unassign','cancel_booking'
  ));

create function public.reverse_shared_hotel_member_check_in(
  p_occupancy_id uuid,
  p_hotel_stay_id uuid,
  p_expected_occupancy_version integer,
  p_expected_stay_version integer,
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
  stay public.hotel_stays%rowtype;
  physical_member public.hotel_physical_occupancy_members%rowtype;
  family_member public.family_booking_members%rowtype;
  capacity public.hotel_capacity_reservations%rowtype;
  allocation public.hotel_room_allocations%rowtype;
  result jsonb;
begin
  if actor_id is null or not public.has_operation_role(array['owner','manager']) then
    raise exception 'Operations Owner/Manager만 입실 완료를 취소할 수 있습니다.' using errcode = '42501';
  end if;
  if p_occupancy_id is null or p_hotel_stay_id is null
    or p_expected_occupancy_version is null or p_expected_stay_version is null
    or normalized_reason is null or p_request_id is null then
    raise exception '공유 객실, Stay, 기존 버전, 취소 사유, 요청 ID가 필요합니다.' using errcode = '22023';
  end if;

  payload := jsonb_build_object(
    'expectedOccupancyVersion', p_expected_occupancy_version,
    'expectedStayVersion', p_expected_stay_version,
    'hotelStayId', p_hotel_stay_id,
    'occupancyId', p_occupancy_id,
    'reason', normalized_reason
  );
  replay := public.claim_shared_hotel_request_internal(
    p_request_id, 'reverse_check_in', payload, p_occupancy_id
  );
  if replay is not null then return replay; end if;

  select * into occupancy
  from public.hotel_physical_occupancies target
  where target.id = p_occupancy_id
  for update;
  if not found or occupancy.archived_at is not null or occupancy.status <> 'active' then
    raise exception '활성 공유 객실을 확인할 수 없습니다.' using errcode = 'PT409';
  end if;
  if occupancy.version <> p_expected_occupancy_version then
    raise exception '다른 사용자가 먼저 공유 객실을 변경했습니다.' using errcode = 'PT409';
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
  where target.id = occupancy.family_booking_id
  for update;
  if not found or family.archived_at is not null or family.status <> 'active'
    or family.customer_id <> occupancy.customer_id then
    raise exception '활성 Family Booking 계약이 올바르지 않습니다.' using errcode = '23514';
  end if;

  select * into stay
  from public.hotel_stays target
  where target.id = p_hotel_stay_id
  for update;
  if not found or stay.archived_at is not null or stay.checked_in_at is null
    or stay.checked_out_at is not null then
    raise exception '입실 완료 상태이며 퇴실 전인 Stay만 되돌릴 수 있습니다.' using errcode = 'PT409';
  end if;
  if stay.version <> p_expected_stay_version then
    raise exception '다른 사용자가 먼저 Hotel Stay를 변경했습니다.' using errcode = 'PT409';
  end if;

  select * into physical_member
  from public.hotel_physical_occupancy_members target
  where target.occupancy_id = occupancy.id
    and target.hotel_stay_id = stay.id
    and target.archived_at is null
  for update;
  if not found or physical_member.status <> 'active' or physical_member.left_at is not null
    or physical_member.dog_id <> stay.dog_id then
    raise exception '활성 Shared Room Physical Member 계약이 올바르지 않습니다.' using errcode = '23514';
  end if;

  select * into family_member
  from public.family_booking_members target
  where target.id = physical_member.family_booking_member_id
  for update;
  if not found or family_member.archived_at is not null
    or family_member.family_booking_id <> family.id
    or family_member.shared_room_group_id <> shared_group.id
    or family_member.hotel_stay_id <> stay.id
    or family_member.dog_id <> stay.dog_id
    or family_member.service_type <> 'hotel'
    or family_member.status <> 'checked_in'
    or not exists (
      select 1 from public.dogs dog
      where dog.id = stay.dog_id and dog.customer_id = family.customer_id
    ) then
    raise exception '입실 완료된 Family Booking Member 계약이 올바르지 않습니다.' using errcode = '23514';
  end if;

  select * into capacity
  from public.hotel_capacity_reservations target
  where target.id = occupancy.capacity_reservation_id
  for update;
  select * into allocation
  from public.hotel_room_allocations target
  where target.id = occupancy.room_allocation_id
  for update;
  if capacity.id is null or capacity.archived_at is not null
    or capacity.source_kind <> 'shared_occupancy'
    or capacity.physical_occupancy_id <> occupancy.id
    or capacity.quantity <> 1
    or capacity.room_type_id <> occupancy.room_type_id
    or capacity.reserved_from <> occupancy.occupied_from
    or capacity.reserved_until <> occupancy.occupied_until
    or allocation.id is null or allocation.archived_at is not null
    or allocation.capacity_reservation_id <> capacity.id
    or allocation.room_id <> occupancy.room_id
    or allocation.allocated_from <> occupancy.occupied_from
    or allocation.allocated_until <> occupancy.occupied_until
    or not exists (
      select 1
      from public.hotel_rooms room
      join public.hotel_room_types room_type on room_type.id = room.room_type_id
      where room.id = occupancy.room_id
        and room.archived_at is null and room.is_active
        and room_type.id = occupancy.room_type_id
        and room_type.archived_at is null and room_type.is_active
        and upper(btrim(room_type.code)) = 'DELUXE'
    ) then
    raise exception '공유 객실 Capacity/Allocation 계약이 올바르지 않습니다.' using errcode = '23514';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('hotel-capacity:all', 0));
  perform pg_advisory_xact_lock(hashtextextended('hotel-capacity:' || occupancy.room_type_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('hotel-room:' || occupancy.room_id::text, 0));
  perform set_config('app.operation_change_reason', normalized_reason, true);
  perform set_config('app.operation_request_id', p_request_id::text, true);

  update public.hotel_stays target
  set checked_in_at = null,
      checked_in_by = null,
      updated_by = actor_id
  where target.id = stay.id;

  perform set_config('app.operation_request_id', '', true);
  update public.family_booking_members target
  set status = 'confirmed', updated_by = actor_id
  where target.id = family_member.id;
  update public.hotel_physical_occupancies target
  set updated_by = actor_id
  where target.id = occupancy.id;

  result := jsonb_build_object(
    'occupancy', public.shared_hotel_occupancy_json_internal(occupancy.id),
    'stay', public.hotel_stay_json(stay.id)
  );
  return public.finish_shared_hotel_request_internal(
    p_request_id, occupancy.id, result
  );
end;
$$;

comment on function public.reverse_shared_hotel_member_check_in(
  uuid, uuid, integer, integer, text, uuid
) is 'Reverses one checked-in Shared Room member to confirmed while preserving physical occupancy, allocation, capacity, and other members.';

revoke all on function public.reverse_shared_hotel_member_check_in(
  uuid, uuid, integer, integer, text, uuid
) from public, anon;
grant execute on function public.reverse_shared_hotel_member_check_in(
  uuid, uuid, integer, integer, text, uuid
) to authenticated, service_role;

commit;
