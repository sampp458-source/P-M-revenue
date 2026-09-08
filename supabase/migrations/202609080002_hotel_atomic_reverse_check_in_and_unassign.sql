-- Atomic checked-in room reversal and unassignment for Single and Shared Hotel stays.
-- Append-only facade migration. Existing lifecycle RPCs remain unchanged.

begin;

do $$
declare
  current_operation_kinds text[];
begin
  if to_regclass('public.hotel_stays') is null
    or to_regclass('public.hotel_capacity_reservations') is null
    or to_regclass('public.hotel_room_allocations') is null
    or to_regclass('public.hotel_physical_occupancies') is null
    or to_regclass('public.hotel_physical_occupancy_members') is null
    or to_regclass('public.hotel_physical_occupancy_requests') is null
    or to_regclass('public.family_booking_members') is null
    or to_regprocedure('public.reverse_hotel_completion(uuid,integer,text,text,uuid)') is null
    or to_regprocedure('public.unassign_hotel_room_before_check_in(uuid,integer,text,uuid)') is null
    or to_regprocedure('public.reverse_shared_hotel_member_check_in(uuid,uuid,integer,integer,text,uuid)') is null
    or to_regprocedure('public.unassign_shared_hotel_room_before_check_in(uuid,integer,text,uuid)') is null
    or to_regprocedure('public.hotel_stay_json(uuid)') is null
  then
    raise exception 'STOP_ATOMIC_REVERSE_UNASSIGN_REQUIRED_CONTRACT_MISSING';
  end if;

  if to_regclass('public.hotel_atomic_reverse_unassign_requests') is not null
    or to_regprocedure('public.hotel_atomic_child_request_id_internal(uuid,text)') is not null
    or to_regprocedure('public.reverse_check_in_and_unassign_hotel_room(uuid,integer,text,uuid)') is not null
    or to_regprocedure('public.reverse_check_in_and_unassign_shared_hotel_room(uuid,integer,text,uuid)') is not null
  then
    raise exception 'STOP_ATOMIC_REVERSE_UNASSIGN_ALREADY_APPLIED';
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
    'move','reverse_check_in','reverse_completion','unassign'
  ]::text[] then
    raise exception 'STOP_ATOMIC_REVERSE_UNASSIGN_UNEXPECTED_REQUEST_OPERATION_KINDS: %', current_operation_kinds;
  end if;
end;
$$;

create table public.hotel_atomic_reverse_unassign_requests (
  request_id uuid primary key,
  operation_kind text not null check (operation_kind in ('single', 'shared')),
  target_id uuid not null,
  actor_id uuid not null references auth.users(id),
  request_payload jsonb not null,
  response_payload jsonb,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint hotel_atomic_reverse_unassign_requests_completion_check
    check ((response_payload is null and completed_at is null)
      or (response_payload is not null and completed_at is not null))
);

alter table public.hotel_atomic_reverse_unassign_requests enable row level security;
revoke all on table public.hotel_atomic_reverse_unassign_requests from public, anon, authenticated;
grant all on table public.hotel_atomic_reverse_unassign_requests to service_role;

create function public.hotel_atomic_child_request_id_internal(
  p_request_id uuid,
  p_step text
)
returns uuid
language sql
immutable
strict
set search_path = public, pg_temp
as $$
  select (
    substr(md5(p_request_id::text || ':' || p_step), 1, 8) || '-' ||
    substr(md5(p_request_id::text || ':' || p_step), 9, 4) || '-' ||
    substr(md5(p_request_id::text || ':' || p_step), 13, 4) || '-' ||
    substr(md5(p_request_id::text || ':' || p_step), 17, 4) || '-' ||
    substr(md5(p_request_id::text || ':' || p_step), 21, 12)
  )::uuid
$$;

revoke all on function public.hotel_atomic_child_request_id_internal(uuid,text)
  from public, anon, authenticated;
grant execute on function public.hotel_atomic_child_request_id_internal(uuid,text)
  to service_role;

create function public.reverse_check_in_and_unassign_hotel_room(
  p_hotel_stay_id uuid,
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
  existing_request public.hotel_atomic_reverse_unassign_requests%rowtype;
  stay public.hotel_stays%rowtype;
  reverse_result jsonb;
  result jsonb;
  allocation_count integer;
begin
  if actor_id is null or not public.has_operation_role(array['owner','manager']) then
    raise exception 'Operations Owner/Manager만 입실 취소 후 배정 해제를 할 수 있습니다.' using errcode = '42501';
  end if;
  if p_hotel_stay_id is null or p_expected_version is null
    or normalized_reason is null or p_request_id is null then
    raise exception '호텔 예약, 기존 버전, 처리 사유, 요청 ID가 필요합니다.' using errcode = '22023';
  end if;

  payload := jsonb_build_object(
    'expectedVersion', p_expected_version,
    'hotelStayId', p_hotel_stay_id,
    'reason', normalized_reason
  );
  perform pg_advisory_xact_lock(
    hashtextextended('hotel-atomic-reverse-unassign:' || p_request_id::text, 0)
  );
  select * into existing_request
  from public.hotel_atomic_reverse_unassign_requests target
  where target.request_id = p_request_id
  for update;
  if found then
    if existing_request.operation_kind <> 'single'
      or existing_request.target_id <> p_hotel_stay_id
      or existing_request.actor_id <> actor_id
      or existing_request.request_payload is distinct from payload then
      raise exception '동일 request_id의 입력 계약 불일치' using errcode = '23505';
    end if;
    if existing_request.response_payload is null then
      raise exception '동일 요청이 아직 처리 중입니다.' using errcode = 'PT409';
    end if;
    return existing_request.response_payload;
  end if;

  select * into stay
  from public.hotel_stays target
  where target.id = p_hotel_stay_id
  for update;
  if not found or stay.archived_at is not null
    or stay.version <> p_expected_version
    or stay.checked_in_at is null
    or stay.checked_out_at is not null then
    raise exception '입실 완료 상태이며 퇴실 전인 최신 Hotel Stay만 처리할 수 있습니다.' using errcode = 'PT409';
  end if;
  select count(*)::integer into allocation_count
  from public.hotel_room_allocations allocation
  join public.hotel_capacity_reservations capacity
    on capacity.id = allocation.capacity_reservation_id
  where capacity.hotel_stay_id = stay.id
    and capacity.archived_at is null
    and allocation.archived_at is null;
  if allocation_count <> 1 then
    raise exception '활성 호실 배정이 정확히 한 건이어야 합니다.' using errcode = 'PT409';
  end if;

  insert into public.hotel_atomic_reverse_unassign_requests (
    request_id, operation_kind, target_id, actor_id, request_payload
  ) values (
    p_request_id, 'single', p_hotel_stay_id, actor_id, payload
  );

  reverse_result := public.reverse_hotel_completion(
    p_hotel_stay_id,
    p_expected_version,
    'check_in',
    normalized_reason,
    public.hotel_atomic_child_request_id_internal(p_request_id, 'single-reverse-check-in')
  );
  result := public.unassign_hotel_room_before_check_in(
    p_hotel_stay_id,
    (reverse_result ->> 'version')::integer,
    normalized_reason,
    public.hotel_atomic_child_request_id_internal(p_request_id, 'single-unassign-room')
  );

  update public.hotel_atomic_reverse_unassign_requests target
  set response_payload = result,
      completed_at = clock_timestamp()
  where target.request_id = p_request_id;
  return result;
end;
$$;

create function public.reverse_check_in_and_unassign_shared_hotel_room(
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
  existing_request public.hotel_atomic_reverse_unassign_requests%rowtype;
  occupancy public.hotel_physical_occupancies%rowtype;
  member record;
  current_occupancy_version integer;
  checked_in_count integer;
  active_member_count integer;
  reverse_result jsonb;
  result jsonb;
begin
  if actor_id is null or not public.has_operation_role(array['owner','manager']) then
    raise exception 'Operations Owner/Manager만 공유 객실 입실 취소 후 배정 해제를 할 수 있습니다.' using errcode = '42501';
  end if;
  if p_occupancy_id is null or p_expected_version is null
    or normalized_reason is null or p_request_id is null then
    raise exception '공유 객실, 기존 버전, 처리 사유, 요청 ID가 필요합니다.' using errcode = '22023';
  end if;

  payload := jsonb_build_object(
    'expectedVersion', p_expected_version,
    'occupancyId', p_occupancy_id,
    'reason', normalized_reason
  );
  perform pg_advisory_xact_lock(
    hashtextextended('hotel-atomic-reverse-unassign:' || p_request_id::text, 0)
  );
  select * into existing_request
  from public.hotel_atomic_reverse_unassign_requests target
  where target.request_id = p_request_id
  for update;
  if found then
    if existing_request.operation_kind <> 'shared'
      or existing_request.target_id <> p_occupancy_id
      or existing_request.actor_id <> actor_id
      or existing_request.request_payload is distinct from payload then
      raise exception '동일 request_id의 입력 계약 불일치' using errcode = '23505';
    end if;
    if existing_request.response_payload is null then
      raise exception '동일 요청이 아직 처리 중입니다.' using errcode = 'PT409';
    end if;
    return existing_request.response_payload;
  end if;

  select * into occupancy
  from public.hotel_physical_occupancies target
  where target.id = p_occupancy_id
  for update;
  if not found or occupancy.archived_at is not null or occupancy.status <> 'active'
    or occupancy.version <> p_expected_version then
    raise exception '최신 활성 공유 객실만 처리할 수 있습니다.' using errcode = 'PT409';
  end if;

  select count(*)::integer,
         count(*) filter (where stay.checked_in_at is not null)::integer
  into active_member_count, checked_in_count
  from public.hotel_physical_occupancy_members physical_member
  join public.hotel_stays stay on stay.id = physical_member.hotel_stay_id
  join public.family_booking_members family_member
    on family_member.id = physical_member.family_booking_member_id
  where physical_member.occupancy_id = occupancy.id
    and physical_member.archived_at is null
    and physical_member.status = 'active'
    and physical_member.left_at is null
    and family_member.archived_at is null
    and family_member.shared_room_group_id = occupancy.shared_room_group_id
    and family_member.hotel_stay_id = stay.id
    and stay.archived_at is null
    and stay.checked_out_at is null;
  if active_member_count < 2 or checked_in_count < 1
    or active_member_count <> (
      select count(*)
      from public.hotel_physical_occupancy_members target
      where target.occupancy_id = occupancy.id and target.archived_at is null
    ) then
    raise exception '퇴실 전 활성 Shared Room Member 계약이 올바르지 않습니다.' using errcode = 'PT409';
  end if;

  insert into public.hotel_atomic_reverse_unassign_requests (
    request_id, operation_kind, target_id, actor_id, request_payload
  ) values (
    p_request_id, 'shared', p_occupancy_id, actor_id, payload
  );

  current_occupancy_version := p_expected_version;
  for member in
    select stay.id as hotel_stay_id, stay.version as hotel_stay_version
    from public.hotel_physical_occupancy_members physical_member
    join public.hotel_stays stay on stay.id = physical_member.hotel_stay_id
    where physical_member.occupancy_id = occupancy.id
      and physical_member.archived_at is null
      and physical_member.status = 'active'
      and physical_member.left_at is null
      and stay.archived_at is null
      and stay.checked_in_at is not null
      and stay.checked_out_at is null
    order by stay.id
  loop
    reverse_result := public.reverse_shared_hotel_member_check_in(
      p_occupancy_id,
      member.hotel_stay_id,
      current_occupancy_version,
      member.hotel_stay_version,
      normalized_reason,
      public.hotel_atomic_child_request_id_internal(
        p_request_id,
        'shared-reverse-check-in:' || member.hotel_stay_id::text
      )
    );
    current_occupancy_version := (reverse_result -> 'occupancy' ->> 'version')::integer;
  end loop;

  result := public.unassign_shared_hotel_room_before_check_in(
    p_occupancy_id,
    current_occupancy_version,
    normalized_reason,
    public.hotel_atomic_child_request_id_internal(p_request_id, 'shared-unassign-room')
  );

  update public.hotel_atomic_reverse_unassign_requests target
  set response_payload = result,
      completed_at = clock_timestamp()
  where target.request_id = p_request_id;
  return result;
end;
$$;

comment on function public.reverse_check_in_and_unassign_hotel_room(uuid,integer,text,uuid)
  is 'Atomically reverses one checked-in Single Hotel Stay and releases its room allocation while preserving the reservation and capacity.';
comment on function public.reverse_check_in_and_unassign_shared_hotel_room(uuid,integer,text,uuid)
  is 'Atomically reverses every checked-in active Shared Room member and releases the shared allocation while preserving the family reservation and capacity.';

revoke all on function public.reverse_check_in_and_unassign_hotel_room(uuid,integer,text,uuid)
  from public, anon;
grant execute on function public.reverse_check_in_and_unassign_hotel_room(uuid,integer,text,uuid)
  to authenticated, service_role;
revoke all on function public.reverse_check_in_and_unassign_shared_hotel_room(uuid,integer,text,uuid)
  from public, anon;
grant execute on function public.reverse_check_in_and_unassign_shared_hotel_room(uuid,integer,text,uuid)
  to authenticated, service_role;

commit;
