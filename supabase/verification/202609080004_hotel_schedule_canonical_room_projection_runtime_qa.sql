-- Isolated deterministic QA only. All fixture rows are rolled back.
begin;

select hotel_qa.assert_isolated_environment();

create temporary table hotel_schedule_room_projection_qa_context (
  actor_id uuid not null,
  calendar_id uuid not null,
  schedule_type_id uuid not null,
  customer_id uuid not null,
  room_type_id uuid not null,
  room_a_id uuid not null,
  room_a_name text not null,
  room_b_id uuid not null,
  room_b_name text not null
) on commit drop;

create temporary table hotel_schedule_room_projection_qa_results (
  case_id text primary key,
  expected_status text not null,
  expected_room_name text null,
  actual_projection jsonb not null
) on commit drop;

do $$
declare
  actor uuid;
  calendar uuid;
  schedule_type uuid;
  customer uuid := gen_random_uuid();
  room_type uuid;
  room_a uuid;
  room_b uuid;
  room_a_name text;
  room_b_name text;
begin
  select membership.profile_id
  into actor
  from public.operation_memberships membership
  join public.profiles profile on profile.id = membership.profile_id
  where membership.is_active
    and membership.role in ('owner', 'manager')
    and profile.is_active
    and profile.account_status = 'active'
  order by case membership.role when 'owner' then 0 else 1 end,
    membership.profile_id
  limit 1;

  select target.id
  into calendar
  from public.operation_calendars target
  where target.is_active and target.archived_at is null
  order by target.sort_order, target.id
  limit 1;

  select target.id
  into schedule_type
  from public.operation_schedule_types target
  where target.is_active and target.archived_at is null
  order by target.sort_order, target.id
  limit 1;

  select
    (array_agg(room.id order by room.sort_order, room.id))[1],
    (array_agg(room.id order by room.sort_order, room.id))[2],
    (array_agg(room.name order by room.sort_order, room.id))[1],
    (array_agg(room.name order by room.sort_order, room.id))[2],
    (array_agg(room.room_type_id order by room.sort_order, room.id))[1]
  into room_a, room_b, room_a_name, room_b_name, room_type
  from public.hotel_rooms room
  join public.hotel_room_types room_kind on room_kind.id = room.room_type_id
  where room.is_active and room.archived_at is null
    and room_kind.is_active and room_kind.archived_at is null
    and upper(btrim(room_kind.code)) = 'DELUXE';

  if actor is null or calendar is null or schedule_type is null
    or room_a is null or room_b is null then
    raise exception 'STOP_HOTEL_SCHEDULE_ROOM_PROJECTION_QA_REFERENCE_MISSING';
  end if;

  perform set_config('request.jwt.claim.sub', actor::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', actor, 'role', 'authenticated')::text,
    true
  );
  perform set_config('app.operation_change_reason', 'Hotel room projection QA', true);
  perform set_config('app.operation_request_id', gen_random_uuid()::text, true);

  insert into public.customers(id, name, phone, is_active)
  values(customer, 'Hotel Schedule Projection QA', '01000000804', true);

  insert into hotel_schedule_room_projection_qa_context values(
    actor, calendar, schedule_type, customer, room_type,
    room_a, room_a_name, room_b, room_b_name
  );
end;
$$;

create function pg_temp.create_hotel_event_schedule(
  p_stay_id uuid,
  p_dog_id uuid,
  p_event_kind text,
  p_starts_at timestamptz
) returns uuid
language plpgsql
as $$
declare
  context hotel_schedule_room_projection_qa_context%rowtype;
  schedule_id uuid := gen_random_uuid();
begin
  select * into context from hotel_schedule_room_projection_qa_context;
  insert into public.operation_schedules(
    id, calendar_id, schedule_type_id, title, starts_at, ends_at,
    request_id, created_by
  ) values(
    schedule_id, context.calendar_id, context.schedule_type_id,
    'Hotel room projection QA', p_starts_at, p_starts_at + interval '1 hour',
    gen_random_uuid(), context.actor_id
  );
  insert into public.operation_schedule_dogs(schedule_id, dog_id, created_by)
  values(schedule_id, p_dog_id, context.actor_id);
  insert into public.hotel_stay_schedule_events(
    hotel_stay_id, operation_schedule_id, event_kind, created_by, updated_by
  ) values(
    p_stay_id, schedule_id, p_event_kind, context.actor_id, context.actor_id
  );
  return schedule_id;
end;
$$;

create function pg_temp.capture_projection(
  p_case_id text,
  p_schedule_id uuid,
  p_expected_status text,
  p_expected_room_name text default null
) returns void
language plpgsql
as $$
declare
  projection jsonb;
begin
  select item
  into projection
  from jsonb_array_elements(
    public.get_operation_hotel_room_projections(array[p_schedule_id])
  ) item;
  if projection is null then
    raise exception 'STOP_ROOM_PROJECTION_QA_MISSING_RESULT_%', p_case_id;
  end if;
  insert into hotel_schedule_room_projection_qa_results values(
    p_case_id, p_expected_status, p_expected_room_name, projection
  );
end;
$$;

-- Single current allocation: exactly one candidate resolves.
do $$
declare
  c hotel_schedule_room_projection_qa_context%rowtype;
  dog uuid := gen_random_uuid();
  stay uuid := gen_random_uuid();
  capacity uuid := gen_random_uuid();
  schedule uuid;
begin
  select * into c from hotel_schedule_room_projection_qa_context;
  insert into public.dogs(id, customer_id, name, is_active)
  values(dog, c.customer_id, 'QA Single Current', true);
  insert into public.hotel_stays(id, dog_id, request_id, created_by, updated_by)
  values(stay, dog, gen_random_uuid(), c.actor_id, c.actor_id);
  insert into public.hotel_capacity_reservations(
    id, source_kind, hotel_stay_id, room_type_id,
    reserved_from, reserved_until, quantity, created_by, updated_by
  ) values(
    capacity, 'stay', stay, c.room_type_id,
    timestamptz '2098-01-01 15:00+09', timestamptz '2098-01-03 11:00+09',
    1, c.actor_id, c.actor_id
  );
  insert into public.hotel_room_allocations(
    capacity_reservation_id, room_id, allocated_from, allocated_until,
    created_by, updated_by
  ) values(
    capacity, c.room_a_id,
    timestamptz '2098-01-01 15:00+09', timestamptz '2098-01-03 11:00+09',
    c.actor_id, c.actor_id
  );
  schedule := pg_temp.create_hotel_event_schedule(
    stay, dog, 'check_in', timestamptz '2098-01-01 15:00+09'
  );
  perform pg_temp.capture_projection(
    '01_single_current_resolved', schedule, 'resolved', c.room_a_name
  );
end;
$$;

-- Single capacity without an allocation is a genuine unassigned state.
do $$
declare
  c hotel_schedule_room_projection_qa_context%rowtype;
  dog uuid := gen_random_uuid();
  stay uuid := gen_random_uuid();
  schedule uuid;
begin
  select * into c from hotel_schedule_room_projection_qa_context;
  insert into public.dogs(id, customer_id, name, is_active)
  values(dog, c.customer_id, 'QA Single Unassigned', true);
  insert into public.hotel_stays(id, dog_id, request_id, created_by, updated_by)
  values(stay, dog, gen_random_uuid(), c.actor_id, c.actor_id);
  insert into public.hotel_capacity_reservations(
    source_kind, hotel_stay_id, room_type_id,
    reserved_from, reserved_until, quantity, created_by, updated_by
  ) values(
    'stay', stay, c.room_type_id,
    timestamptz '2098-02-01 15:00+09', timestamptz '2098-02-03 11:00+09',
    1, c.actor_id, c.actor_id
  );
  schedule := pg_temp.create_hotel_event_schedule(
    stay, dog, 'check_in', timestamptz '2098-02-01 15:00+09'
  );
  perform pg_temp.capture_projection(
    '02_single_unassigned', schedule, 'unassigned', null
  );
end;
$$;

-- Two temporal allocation candidates must fail closed instead of selecting one.
do $$
declare
  c hotel_schedule_room_projection_qa_context%rowtype;
  dog uuid := gen_random_uuid();
  stay uuid := gen_random_uuid();
  capacity_a uuid := gen_random_uuid();
  capacity_b uuid := gen_random_uuid();
  schedule uuid;
begin
  select * into c from hotel_schedule_room_projection_qa_context;
  insert into public.dogs(id, customer_id, name, is_active)
  values(dog, c.customer_id, 'QA Single Ambiguous', true);
  insert into public.hotel_stays(id, dog_id, request_id, created_by, updated_by)
  values(stay, dog, gen_random_uuid(), c.actor_id, c.actor_id);
  insert into public.hotel_capacity_reservations(
    id, source_kind, hotel_stay_id, room_type_id,
    reserved_from, reserved_until, quantity, created_by, updated_by,
    archived_at, archived_by, archive_reason
  ) values
    (capacity_a, 'stay', stay, c.room_type_id,
      timestamptz '2098-03-01 15:00+09', timestamptz '2098-03-03 11:00+09',
      1, c.actor_id, c.actor_id, clock_timestamp(), c.actor_id, 'QA history A'),
    (capacity_b, 'stay', stay, c.room_type_id,
      timestamptz '2098-03-01 15:00+09', timestamptz '2098-03-03 11:00+09',
      1, c.actor_id, c.actor_id, clock_timestamp(), c.actor_id, 'QA history B');
  insert into public.hotel_room_allocations(
    capacity_reservation_id, room_id, allocated_from, allocated_until,
    created_by, updated_by, archived_at, archived_by, archive_reason
  ) values
    (capacity_a, c.room_a_id,
      timestamptz '2098-03-01 15:00+09', timestamptz '2098-03-03 11:00+09',
      c.actor_id, c.actor_id, clock_timestamp(), c.actor_id, 'QA history A'),
    (capacity_b, c.room_b_id,
      timestamptz '2098-03-01 15:00+09', timestamptz '2098-03-03 11:00+09',
      c.actor_id, c.actor_id, clock_timestamp(), c.actor_id, 'QA history B');
  schedule := pg_temp.create_hotel_event_schedule(
    stay, dog, 'check_in', timestamptz '2098-03-01 15:00+09'
  );
  perform pg_temp.capture_projection(
    '03_single_overlap_unavailable', schedule, 'unavailable', null
  );
end;
$$;

-- Requested Shared Group remains unassigned and does not invent a room.
do $$
declare
  c hotel_schedule_room_projection_qa_context%rowtype;
  family uuid := gen_random_uuid();
  room_group uuid := gen_random_uuid();
  dog_a uuid := gen_random_uuid(); dog_b uuid := gen_random_uuid();
  stay_a uuid := gen_random_uuid(); stay_b uuid := gen_random_uuid();
  member_a uuid := gen_random_uuid(); member_b uuid := gen_random_uuid();
  schedule uuid;
begin
  select * into c from hotel_schedule_room_projection_qa_context;
  insert into public.dogs(id, customer_id, name, is_active) values
    (dog_a, c.customer_id, 'QA Shared Requested A', true),
    (dog_b, c.customer_id, 'QA Shared Requested B', true);
  insert into public.hotel_stays(id, dog_id, request_id, created_by, updated_by) values
    (stay_a, dog_a, gen_random_uuid(), c.actor_id, c.actor_id),
    (stay_b, dog_b, gen_random_uuid(), c.actor_id, c.actor_id);
  insert into public.family_bookings(
    id, customer_id, canonical_payload, canonical_payload_hash,
    request_id, created_by, updated_by
  ) values(
    family, c.customer_id, '{}'::jsonb, repeat('0', 64),
    gen_random_uuid(), c.actor_id, c.actor_id
  );
  insert into public.family_booking_members(
    id, family_booking_id, stable_member_key, dog_id, service_type,
    hotel_stay_id, created_by, updated_by
  ) values
    (member_a, family, 'requested-a', dog_a, 'hotel', stay_a, c.actor_id, c.actor_id),
    (member_b, family, 'requested-b', dog_b, 'hotel', stay_b, c.actor_id, c.actor_id);
  insert into public.family_shared_room_groups(
    id, family_booking_id, stable_group_key, leader_member_id, room_type_id,
    normalized_starts_at, normalized_ends_at, requested_capacity,
    created_by, updated_by
  ) values(
    room_group, family, 'requested', member_a, c.room_type_id,
    timestamptz '2098-04-01 15:00+09', timestamptz '2098-04-03 11:00+09',
    2, c.actor_id, c.actor_id
  );
  update public.family_booking_members
  set shared_room_group_id = room_group
  where id in (member_a, member_b);
  insert into public.hotel_capacity_reservations(
    source_kind, shared_room_group_id, room_type_id,
    reserved_from, reserved_until, quantity, created_by, updated_by
  ) values(
    'shared_group', room_group, c.room_type_id,
    timestamptz '2098-04-01 15:00+09', timestamptz '2098-04-03 11:00+09',
    1, c.actor_id, c.actor_id
  );
  schedule := pg_temp.create_hotel_event_schedule(
    stay_a, dog_a, 'check_in', timestamptz '2098-04-01 15:00+09'
  );
  perform pg_temp.capture_projection(
    '04_shared_requested_unassigned', schedule, 'unassigned', null
  );
end;
$$;

-- Two Shared members resolve through one current Physical Occupancy.
do $$
declare
  c hotel_schedule_room_projection_qa_context%rowtype;
  family uuid := gen_random_uuid(); room_group uuid := gen_random_uuid();
  dog_a uuid := gen_random_uuid(); dog_b uuid := gen_random_uuid();
  stay_a uuid := gen_random_uuid(); stay_b uuid := gen_random_uuid();
  member_a uuid := gen_random_uuid(); member_b uuid := gen_random_uuid();
  occupancy uuid := gen_random_uuid(); capacity uuid := gen_random_uuid();
  allocation uuid := gen_random_uuid(); schedule_a uuid; schedule_b uuid;
begin
  select * into c from hotel_schedule_room_projection_qa_context;
  insert into public.dogs(id, customer_id, name, is_active) values
    (dog_a, c.customer_id, 'QA Shared Current A', true),
    (dog_b, c.customer_id, 'QA Shared Current B', true);
  insert into public.hotel_stays(id, dog_id, request_id, created_by, updated_by) values
    (stay_a, dog_a, gen_random_uuid(), c.actor_id, c.actor_id),
    (stay_b, dog_b, gen_random_uuid(), c.actor_id, c.actor_id);
  insert into public.family_bookings(
    id, customer_id, status, canonical_payload, canonical_payload_hash,
    request_id, created_by, updated_by
  ) values(
    family, c.customer_id, 'active', '{}'::jsonb, repeat('1', 64),
    gen_random_uuid(), c.actor_id, c.actor_id
  );
  insert into public.family_booking_members(
    id, family_booking_id, stable_member_key, dog_id, service_type,
    hotel_stay_id, created_by, updated_by
  ) values
    (member_a, family, 'current-a', dog_a, 'hotel', stay_a, c.actor_id, c.actor_id),
    (member_b, family, 'current-b', dog_b, 'hotel', stay_b, c.actor_id, c.actor_id);
  insert into public.family_shared_room_groups(
    id, family_booking_id, stable_group_key, leader_member_id, room_type_id,
    normalized_starts_at, normalized_ends_at, requested_capacity, status,
    created_by, updated_by
  ) values(
    room_group, family, 'current', member_a, c.room_type_id,
    timestamptz '2098-05-01 15:00+09', timestamptz '2098-05-03 11:00+09',
    2, 'allocated', c.actor_id, c.actor_id
  );
  update public.family_booking_members
  set shared_room_group_id = room_group
  where id in (member_a, member_b);
  insert into public.hotel_physical_occupancies(
    id, family_booking_id, shared_room_group_id, customer_id, room_type_id,
    room_id, occupied_from, occupied_until, request_id,
    canonical_payload_hash, created_by, updated_by
  ) values(
    occupancy, family, room_group, c.customer_id, c.room_type_id,
    c.room_a_id, timestamptz '2098-05-01 15:00+09',
    timestamptz '2098-05-03 11:00+09', gen_random_uuid(), repeat('2', 32),
    c.actor_id, c.actor_id
  );
  insert into public.hotel_capacity_reservations(
    id, source_kind, physical_occupancy_id, room_type_id,
    reserved_from, reserved_until, quantity, created_by, updated_by
  ) values(
    capacity, 'shared_occupancy', occupancy, c.room_type_id,
    timestamptz '2098-05-01 15:00+09', timestamptz '2098-05-03 11:00+09',
    1, c.actor_id, c.actor_id
  );
  insert into public.hotel_room_allocations(
    id, capacity_reservation_id, room_id, allocated_from, allocated_until,
    created_by, updated_by
  ) values(
    allocation, capacity, c.room_a_id,
    timestamptz '2098-05-01 15:00+09', timestamptz '2098-05-03 11:00+09',
    c.actor_id, c.actor_id
  );
  update public.hotel_physical_occupancies
  set capacity_reservation_id = capacity, room_allocation_id = allocation
  where id = occupancy;
  insert into public.hotel_physical_occupancy_members(
    occupancy_id, family_booking_member_id, hotel_stay_id, dog_id,
    created_by, updated_by
  ) values
    (occupancy, member_a, stay_a, dog_a, c.actor_id, c.actor_id),
    (occupancy, member_b, stay_b, dog_b, c.actor_id, c.actor_id);
  schedule_a := pg_temp.create_hotel_event_schedule(
    stay_a, dog_a, 'check_in', timestamptz '2098-05-01 15:00+09'
  );
  schedule_b := pg_temp.create_hotel_event_schedule(
    stay_b, dog_b, 'check_in', timestamptz '2098-05-01 15:00+09'
  );
  perform pg_temp.capture_projection(
    '05_shared_current_member_a', schedule_a, 'resolved', c.room_a_name
  );
  perform pg_temp.capture_projection(
    '06_shared_current_member_b', schedule_b, 'resolved', c.room_a_name
  );
  -- Conflicting current room evidence is not an arbitrary occupancy fallback.
  update public.hotel_physical_occupancies set room_id=c.room_b_id where id=occupancy;
  perform pg_temp.capture_projection(
    '29_shared_current_room_relation_conflict',schedule_a,'unavailable',null);
  update public.hotel_physical_occupancies set room_id=c.room_a_id where id=occupancy;

  -- A member attached to the wrong family relation must not resolve this stay.
  update public.hotel_physical_occupancy_members set status='left',left_at=now()
    where hotel_stay_id=stay_a;
  perform pg_temp.capture_projection(
    '30_shared_current_member_relation_missing',schedule_a,'unavailable',null);
  update public.hotel_physical_occupancy_members set status='active',left_at=null
    where hotel_stay_id=stay_a;

  -- The source UNIQUE contract rejects two unarchived relations for one stay.
  begin
    insert into public.hotel_physical_occupancy_members(
      occupancy_id,family_booking_member_id,hotel_stay_id,dog_id,created_by,updated_by)
      values(occupancy,member_a,stay_a,dog_a,c.actor_id,c.actor_id);
    raise exception 'QA_SHARED_DUPLICATE_MEMBER_ACCEPTED';
  exception when unique_violation then null; end;

  update public.hotel_stays set checked_in_at=timestamptz '2098-05-01 15:00+09',
    checked_in_by=c.actor_id where id=stay_a;
  perform pg_temp.capture_projection(
    '27_shared_completed_event_unchanged',schedule_a,'resolved',c.room_a_name);
  update public.hotel_room_allocations set room_id=c.room_b_id,version=version+1,
    updated_at=timestamptz '2098-05-02 15:00+09' where id=allocation;
  update public.hotel_physical_occupancies set room_id=c.room_b_id where id=occupancy;
  perform pg_temp.capture_projection(
    '22_shared_moved_historical_unavailable',schedule_a,'unavailable',null);
  update public.hotel_room_allocations set updated_at=now() where id=allocation;
  perform pg_temp.capture_projection(
    '28_shared_same_transaction_move_unavailable',schedule_a,'unavailable',null);

end;
$$;

-- Two possible Shared group identities remain unavailable, even with one active link.
do $$
declare
  c hotel_schedule_room_projection_qa_context%rowtype;
  dog uuid := gen_random_uuid(); stay uuid := gen_random_uuid();
  family uuid; member uuid; room_group uuid; schedule uuid; n integer;
begin
  select * into c from hotel_schedule_room_projection_qa_context;
  insert into public.dogs(id,customer_id,name,is_active)
    values(dog,c.customer_id,'QA ambiguous group relation',true);
  insert into public.hotel_stays(id,dog_id,request_id,created_by,updated_by)
    values(stay,dog,gen_random_uuid(),c.actor_id,c.actor_id);
  for n in 1..2 loop
    family:=gen_random_uuid();member:=gen_random_uuid();room_group:=gen_random_uuid();
    insert into public.family_bookings(
      id,customer_id,canonical_payload,canonical_payload_hash,request_id,created_by,updated_by)
      values(family,c.customer_id,'{}',repeat('5',64),gen_random_uuid(),c.actor_id,c.actor_id);
    insert into public.family_booking_members(
      id,family_booking_id,stable_member_key,dog_id,service_type,hotel_stay_id,
      archived_at,archived_by,archive_reason,created_by,updated_by)
      values(member,family,'ambiguous',dog,'hotel',stay,
        case when n=1 then now() end,case when n=1 then c.actor_id end,
        case when n=1 then 'QA retired group membership' end,c.actor_id,c.actor_id);
    insert into public.family_shared_room_groups(
      id,family_booking_id,stable_group_key,leader_member_id,room_type_id,
      normalized_starts_at,normalized_ends_at,requested_capacity,created_by,updated_by)
      values(room_group,family,'ambiguous',member,c.room_type_id,
        timestamptz '2098-12-01 06:00+00',timestamptz '2098-12-03 06:00+00',
        2,c.actor_id,c.actor_id);
    update public.family_booking_members set shared_room_group_id=room_group where id=member;
  end loop;
  schedule:=pg_temp.create_hotel_event_schedule(stay,dog,'check_in',
    timestamptz '2098-12-01 06:00+00');
  perform pg_temp.capture_projection('31_shared_group_identity_ambiguous',schedule,'unavailable',null);
end;
$$;

-- MODEL A: released Shared history without a direct canonical segment fails closed.
do $$
declare
  c hotel_schedule_room_projection_qa_context%rowtype;
  family uuid := gen_random_uuid(); room_group uuid := gen_random_uuid();
  dog_a uuid := gen_random_uuid(); dog_b uuid := gen_random_uuid();
  stay_a uuid := gen_random_uuid(); stay_b uuid := gen_random_uuid();
  member_a uuid := gen_random_uuid(); member_b uuid := gen_random_uuid();
  schedule uuid;
begin
  select * into c from hotel_schedule_room_projection_qa_context;
  insert into public.dogs(id, customer_id, name, is_active) values
    (dog_a, c.customer_id, 'QA Shared History A', true),
    (dog_b, c.customer_id, 'QA Shared History B', true);
  insert into public.hotel_stays(id, dog_id, request_id, created_by, updated_by) values
    (stay_a, dog_a, gen_random_uuid(), c.actor_id, c.actor_id),
    (stay_b, dog_b, gen_random_uuid(), c.actor_id, c.actor_id);
  insert into public.family_bookings(
    id, customer_id, status, canonical_payload, canonical_payload_hash,
    request_id, created_by, updated_by
  ) values(
    family, c.customer_id, 'completed', '{}'::jsonb, repeat('3', 64),
    gen_random_uuid(), c.actor_id, c.actor_id
  );
  insert into public.family_booking_members(
    id, family_booking_id, stable_member_key, dog_id, service_type,
    hotel_stay_id, status, created_by, updated_by
  ) values
    (member_a, family, 'history-a', dog_a, 'hotel', stay_a, 'completed', c.actor_id, c.actor_id),
    (member_b, family, 'history-b', dog_b, 'hotel', stay_b, 'completed', c.actor_id, c.actor_id);
  insert into public.family_shared_room_groups(
    id, family_booking_id, stable_group_key, leader_member_id, room_type_id,
    normalized_starts_at, normalized_ends_at, requested_capacity, status,
    created_by, updated_by
  ) values(
    room_group, family, 'history', member_a, c.room_type_id,
    timestamptz '2098-06-01 15:00+09', timestamptz '2098-06-03 11:00+09',
    2, 'released', c.actor_id, c.actor_id
  );
  update public.family_booking_members
  set shared_room_group_id = room_group
  where id in (member_a, member_b);
  schedule := pg_temp.create_hotel_event_schedule(
    stay_a, dog_a, 'check_out', timestamptz '2098-06-03 11:00+09'
  );
  perform pg_temp.capture_projection(
    '07_shared_history_insufficient_unavailable', schedule, 'unavailable', null
  );
  perform pg_temp.capture_projection(
    '13_shared_audit_missing_no_fallback', schedule, 'unavailable', null
  );
end;
$$;

-- Archived-only history has no retained physical segment: fail closed.
do $$
declare
  c hotel_schedule_room_projection_qa_context%rowtype;
  dog uuid := gen_random_uuid(); stay uuid := gen_random_uuid();
  capacity uuid := gen_random_uuid(); schedule uuid;
begin
  select * into c from hotel_schedule_room_projection_qa_context;
  insert into public.dogs(id, customer_id, name, is_active)
  values(dog, c.customer_id, 'QA Single Historical', true);
  insert into public.hotel_stays(id, dog_id, request_id, created_by, updated_by)
  values(stay, dog, gen_random_uuid(), c.actor_id, c.actor_id);
  insert into public.hotel_capacity_reservations(
    id, source_kind, hotel_stay_id, room_type_id,
    reserved_from, reserved_until, quantity, created_by, updated_by,
    archived_at, archived_by, archive_reason
  ) values(
    capacity, 'stay', stay, c.room_type_id,
    timestamptz '2098-07-01 15:00+09', timestamptz '2098-07-03 11:00+09',
    1, c.actor_id, c.actor_id, clock_timestamp(), c.actor_id, 'QA completed history'
  );
  insert into public.hotel_room_allocations(
    capacity_reservation_id, room_id, allocated_from, allocated_until,
    created_by, updated_by, archived_at, archived_by, archive_reason
  ) values(
    capacity, c.room_a_id,
    timestamptz '2098-07-01 15:00+09', timestamptz '2098-07-03 11:00+09',
    c.actor_id, c.actor_id, clock_timestamp(), c.actor_id, 'QA completed history'
  );
  schedule := pg_temp.create_hotel_event_schedule(
    stay, dog, 'check_out', timestamptz '2098-07-03 11:00+09'
  );
  perform pg_temp.capture_projection(
    '08_single_archived_history_unavailable', schedule, 'unavailable', null
  );
end;
$$;

-- Unproven retired capacities are not canonical historical segments.
do $$
declare
  c hotel_schedule_room_projection_qa_context%rowtype;
  dog uuid := gen_random_uuid(); stay uuid := gen_random_uuid();
  capacity_a uuid := gen_random_uuid(); capacity_b uuid := gen_random_uuid();
  schedule uuid;
begin
  select * into c from hotel_schedule_room_projection_qa_context;
  insert into public.dogs(id, customer_id, name, is_active)
  values(dog, c.customer_id, 'QA Single Moved', true);
  insert into public.hotel_stays(id, dog_id, request_id, created_by, updated_by)
  values(stay, dog, gen_random_uuid(), c.actor_id, c.actor_id);
  insert into public.hotel_capacity_reservations(
    id, source_kind, hotel_stay_id, room_type_id,
    reserved_from, reserved_until, quantity, created_by, updated_by,
    archived_at, archived_by, archive_reason
  ) values
    (capacity_a, 'stay', stay, c.room_type_id,
      timestamptz '2098-08-01 15:00+09', timestamptz '2098-08-02 10:00+09',
      1, c.actor_id, c.actor_id, clock_timestamp(), c.actor_id, 'QA room move history'),
    (capacity_b, 'stay', stay, c.room_type_id,
      timestamptz '2098-08-02 10:00+09', timestamptz '2098-08-03 11:00+09',
      1, c.actor_id, c.actor_id, clock_timestamp(), c.actor_id, 'QA room move history');
  insert into public.hotel_room_allocations(
    capacity_reservation_id, room_id, allocated_from, allocated_until,
    created_by, updated_by, archived_at, archived_by, archive_reason
  ) values
    (capacity_a, c.room_a_id,
      timestamptz '2098-08-01 15:00+09', timestamptz '2098-08-02 10:00+09',
      c.actor_id, c.actor_id, clock_timestamp(), c.actor_id, 'QA room move history'),
    (capacity_b, c.room_b_id,
      timestamptz '2098-08-02 10:00+09', timestamptz '2098-08-03 11:00+09',
      c.actor_id, c.actor_id, clock_timestamp(), c.actor_id, 'QA room move history');
  schedule := pg_temp.create_hotel_event_schedule(
    stay, dog, 'check_out', timestamptz '2098-08-03 11:00+09'
  );
  perform pg_temp.capture_projection(
    '09_retired_capacity_unavailable', schedule, 'unavailable', null
  );
end;
$$;

-- Canonical Long Stay release-room provenance allows its historical segment.
do $$
declare
  c hotel_schedule_room_projection_qa_context%rowtype;
  dog uuid := gen_random_uuid(); stay uuid := gen_random_uuid();
  contract uuid := gen_random_uuid(); released_capacity uuid := gen_random_uuid();
  return_capacity uuid := gen_random_uuid(); released_allocation uuid := gen_random_uuid();
  schedule uuid;
begin
  select * into c from hotel_schedule_room_projection_qa_context;
  insert into public.dogs(id, customer_id, name, is_active)
  values(dog, c.customer_id, 'QA Long Stay Valid', true);
  insert into public.hotel_stays(id, dog_id, request_id, created_by, updated_by)
  values(stay, dog, gen_random_uuid(), c.actor_id, c.actor_id);
  insert into public.long_stay_contracts(
    id, customer_id, dog_id, current_hotel_stay_id, status, started_on,
    create_request_id, created_by, updated_by
  ) values(
    contract, c.customer_id, dog, stay, 'active', date '2098-09-01',
    gen_random_uuid(), c.actor_id, c.actor_id
  );
  insert into public.hotel_capacity_reservations(
    id, source_kind, hotel_stay_id, room_type_id,
    reserved_from, reserved_until, quantity, created_by, updated_by,
    archived_at, archived_by, archive_reason
  ) values(
    released_capacity, 'stay', stay, c.room_type_id,
    timestamptz '2098-09-01 15:00+09', timestamptz '2098-09-02 09:30+09',
    1, c.actor_id, c.actor_id, clock_timestamp(), c.actor_id,
    'long_stay_outing_inventory_segment_closed'
  );
  insert into public.hotel_room_allocations(
    id, capacity_reservation_id, room_id, allocated_from, allocated_until,
    created_by, updated_by
  ) values(
    released_allocation, released_capacity, c.room_a_id,
    timestamptz '2098-09-01 15:00+09', timestamptz '2098-09-02 09:30+09',
    c.actor_id, c.actor_id
  );
  insert into public.hotel_capacity_reservations(
    id, source_kind, hotel_stay_id, room_type_id,
    reserved_from, reserved_until, quantity, created_by, updated_by
  ) values(
    return_capacity, 'stay', stay, c.room_type_id,
    timestamptz '2098-09-03 15:00+09', 'infinity'::timestamptz,
    1, c.actor_id, c.actor_id
  );
  insert into public.long_stay_absence_events(
    long_stay_contract_id, hotel_stay_id, event_type, is_open, occurred_at,
    expected_return_at, expected_return_date, expected_return_time_unspecified,
    inventory_mode, previous_room_id, released_allocation_id,
    released_capacity_id, return_capacity_id, guarantee_from,
    inventory_transition_status, reason, request_id, created_by
  ) values(
    contract, stay, 'leave', true, timestamptz '2098-09-02 09:00+09',
    timestamptz '2098-09-03 15:00+09', date '2098-09-03', false,
    'release_room', c.room_a_id, released_allocation, released_capacity,
    return_capacity, timestamptz '2098-09-03 15:00+09',
    'room_released', 'QA canonical provenance', gen_random_uuid(), c.actor_id
  );
  schedule := pg_temp.create_hotel_event_schedule(
    stay, dog, 'check_in', timestamptz '2098-09-01 15:00+09'
  );
  perform pg_temp.capture_projection(
    '10_long_stay_valid_resolved', schedule, 'resolved', c.room_a_name
  );
  update public.long_stay_absence_events
    set occurred_at=timestamptz '2098-09-02 09:30+09'
    where hotel_stay_id=stay;
  perform pg_temp.capture_projection(
    '23_long_stay_direct_release',schedule,'resolved',c.room_a_name);
  update public.long_stay_absence_events
    set occurred_at=timestamptz '2098-09-02 09:00+09'
    where hotel_stay_id=stay;
  perform pg_temp.capture_projection(
    '24_long_stay_keep_to_release',schedule,'resolved',c.room_a_name);
  insert into public.hotel_room_allocations(
    capacity_reservation_id,room_id,allocated_from,allocated_until,created_by,updated_by)
    values(return_capacity,c.room_b_id,timestamptz '2098-09-03 15:00+09',
      'infinity'::timestamptz,c.actor_id,c.actor_id);
  update public.long_stay_absence_events set is_open=false,
    inventory_transition_status='room_returned',returned_room_id=c.room_b_id,
    returned_allocation_id=(select a.id from public.hotel_room_allocations a
      where a.capacity_reservation_id=return_capacity)
    where hotel_stay_id=stay;
  perform pg_temp.capture_projection(
    '25_long_stay_returned_old_segment',schedule,'resolved',c.room_a_name);
  schedule := pg_temp.create_hotel_event_schedule(
    stay,dog,'check_out',timestamptz '2098-09-04 11:00+09');
  perform pg_temp.capture_projection(
    '26_long_stay_returned_new_segment',schedule,'resolved',c.room_b_name);

end;
$$;

-- A Long Stay-marked segment without matching leave provenance fails closed.
do $$
declare
  c hotel_schedule_room_projection_qa_context%rowtype;
  dog uuid := gen_random_uuid(); stay uuid := gen_random_uuid();
  capacity uuid := gen_random_uuid(); schedule uuid;
begin
  select * into c from hotel_schedule_room_projection_qa_context;
  insert into public.dogs(id, customer_id, name, is_active)
  values(dog, c.customer_id, 'QA Long Stay Invalid', true);
  insert into public.hotel_stays(id, dog_id, request_id, created_by, updated_by)
  values(stay, dog, gen_random_uuid(), c.actor_id, c.actor_id);
  insert into public.hotel_capacity_reservations(
    id, source_kind, hotel_stay_id, room_type_id,
    reserved_from, reserved_until, quantity, created_by, updated_by,
    archived_at, archived_by, archive_reason
  ) values(
    capacity, 'stay', stay, c.room_type_id,
    timestamptz '2098-10-01 15:00+09', timestamptz '2098-10-02 09:30+09',
    1, c.actor_id, c.actor_id, clock_timestamp(), c.actor_id,
    'long_stay_outing_inventory_segment_closed'
  );
  insert into public.hotel_room_allocations(
    capacity_reservation_id, room_id, allocated_from, allocated_until,
    created_by, updated_by
  ) values(
    capacity, c.room_a_id,
    timestamptz '2098-10-01 15:00+09', timestamptz '2098-10-02 09:30+09',
    c.actor_id, c.actor_id
  );
  schedule := pg_temp.create_hotel_event_schedule(
    stay, dog, 'check_in', timestamptz '2098-10-01 15:00+09'
  );
  perform pg_temp.capture_projection(
    '11_long_stay_invalid_unavailable', schedule, 'unavailable', null
  );
end;
$$;

-- An allocated Shared Group without a canonical Physical Occupancy is unavailable.
do $$
declare
  c hotel_schedule_room_projection_qa_context%rowtype;
  family uuid := gen_random_uuid(); room_group uuid := gen_random_uuid();
  dog uuid := gen_random_uuid(); second_dog uuid := gen_random_uuid();
  stay uuid := gen_random_uuid(); second_stay uuid := gen_random_uuid();
  member uuid := gen_random_uuid(); second_member uuid := gen_random_uuid();
  schedule uuid;
begin
  select * into c from hotel_schedule_room_projection_qa_context;
  insert into public.dogs(id, customer_id, name, is_active) values
    (dog, c.customer_id, 'QA Shared Missing Relation A', true),
    (second_dog, c.customer_id, 'QA Shared Missing Relation B', true);
  insert into public.hotel_stays(id, dog_id, request_id, created_by, updated_by) values
    (stay, dog, gen_random_uuid(), c.actor_id, c.actor_id),
    (second_stay, second_dog, gen_random_uuid(), c.actor_id, c.actor_id);
  insert into public.family_bookings(
    id, customer_id, canonical_payload, canonical_payload_hash,
    request_id, created_by, updated_by
  ) values(
    family, c.customer_id, '{}'::jsonb, repeat('4', 64),
    gen_random_uuid(), c.actor_id, c.actor_id
  );
  insert into public.family_booking_members(
    id, family_booking_id, stable_member_key, dog_id, service_type,
    hotel_stay_id, created_by, updated_by
  ) values
    (member, family, 'missing-a', dog, 'hotel', stay, c.actor_id, c.actor_id),
    (second_member, family, 'missing-b', second_dog, 'hotel', second_stay, c.actor_id, c.actor_id);
  insert into public.family_shared_room_groups(
    id, family_booking_id, stable_group_key, leader_member_id, room_type_id,
    normalized_starts_at, normalized_ends_at, requested_capacity, status,
    created_by, updated_by
  ) values(
    room_group, family, 'missing', member, c.room_type_id,
    timestamptz '2098-11-01 15:00+09', timestamptz '2098-11-03 11:00+09',
    2, 'allocated', c.actor_id, c.actor_id
  );
  update public.family_booking_members set shared_room_group_id = room_group
  where id in (member, second_member);
  schedule := pg_temp.create_hotel_event_schedule(
    stay, dog, 'check_in', timestamptz '2098-11-01 15:00+09'
  );
  perform pg_temp.capture_projection(
    '12_shared_relation_missing_unavailable', schedule, 'unavailable', null
  );
end;
$$;


-- Real retained Single segments, revocation, temporal boundaries and reversals.
do $$
declare
  c hotel_schedule_room_projection_qa_context%rowtype;
  dog uuid; stay uuid; capacity uuid; allocation uuid; obsolete uuid;
  schedule_in uuid; schedule_out uuid; standard_room uuid; standard_type uuid;
  standard_name text; starts timestamptz := '2099-01-01 06:00+00';
  ends timestamptz := '2099-01-04 06:00+00';
  middle timestamptz := '2099-01-02 06:00+00';
  n integer;
begin
  select * into c from hotel_schedule_room_projection_qa_context;
  select r.id, r.room_type_id, r.name into standard_room, standard_type, standard_name
  from public.hotel_rooms r join public.hotel_room_types rt on rt.id = r.room_type_id
  where rt.code = 'STANDARD' and r.archived_at is null and r.is_active
  order by r.id limit 1;
  if standard_room is null then raise exception 'QA_STANDARD_REFERENCE_REQUIRED'; end if;

  dog := gen_random_uuid(); stay := gen_random_uuid(); capacity := gen_random_uuid();
  allocation := gen_random_uuid(); obsolete := gen_random_uuid();
  insert into public.dogs(id,customer_id,name,is_active)
    values(dog,c.customer_id,'QA retained lifecycle',true);
  insert into public.hotel_stays(id,dog_id,request_id,created_by,updated_by)
    values(stay,dog,gen_random_uuid(),c.actor_id,c.actor_id);
  insert into public.hotel_capacity_reservations(
    id,source_kind,hotel_stay_id,room_type_id,reserved_from,reserved_until,
    quantity,created_by,updated_by)
    values(capacity,'stay',stay,standard_type,starts,ends,1,c.actor_id,c.actor_id);
  insert into public.hotel_room_allocations(
    id,capacity_reservation_id,room_id,allocated_from,allocated_until,
    created_by,updated_by)
    values(allocation,capacity,standard_room,starts,ends,c.actor_id,c.actor_id);
  schedule_in := pg_temp.create_hotel_event_schedule(stay,dog,'check_in',starts);
  schedule_out := pg_temp.create_hotel_event_schedule(stay,dog,'check_out',ends);

  -- Before-check-in type change revokes an old planned row; the retained row wins.
  insert into public.hotel_room_allocations(
    id,capacity_reservation_id,room_id,allocated_from,allocated_until,
    archived_at,archived_by,archive_reason,created_by,updated_by)
    values(obsolete,capacity,c.room_a_id,starts,middle,
      starts-interval '10 minutes',c.actor_id,'QA pre-check-in restore',
      c.actor_id,c.actor_id);
  -- CASE 5 shape: seven revoked STANDARD plans, one revoked DELUXE plan,
  -- and one retained STANDARD segment. No Production identity is used.
  for n in 1..7 loop
    insert into public.hotel_room_allocations(
      capacity_reservation_id,room_id,allocated_from,allocated_until,
      archived_at,archived_by,archive_reason,created_by,updated_by)
      values(capacity,standard_room,starts,middle,starts-interval '5 minutes',
        c.actor_id,'QA revoked STANDARD plan',c.actor_id,c.actor_id);
  end loop;
  update public.hotel_stays set checked_in_at=starts,checked_in_by=c.actor_id
    where id=stay;
  perform pg_temp.capture_projection(
    '14_pre_check_in_type_change',schedule_in,'resolved',standard_name);

  -- Same-type movement retains the previous segment; capacity can later change type.
  update public.hotel_room_allocations set allocated_until=middle where id=allocation;
  update public.hotel_capacity_reservations set room_type_id=c.room_type_id
    where id=capacity;
  insert into public.hotel_room_allocations(
    capacity_reservation_id,room_id,allocated_from,allocated_until,created_by,updated_by)
    values(capacity,c.room_b_id,middle,ends,c.actor_id,c.actor_id);
  perform pg_temp.capture_projection(
    '15_case5_retained_standard_not_revoked_deluxe',schedule_in,'resolved',standard_name);

  -- Recorded actual checkout resolves the right-inclusive final segment.
  update public.hotel_stays set checked_out_at=ends,checked_out_by=c.actor_id,
    checkout_previous_reserved_until=ends,
    checkout_previous_allocation_id=(select a.id from public.hotel_room_allocations a
      where a.capacity_reservation_id=capacity and a.allocated_from=middle),
    checkout_previous_allocation_until=ends
    where id=stay;
  perform pg_temp.capture_projection(
    '16_historical_exact_checkout',schedule_out,'resolved',c.room_b_name);

  -- Checkout reversal clears completion provenance and restores the planned interval.
  update public.hotel_stays set checked_out_at=null,checked_out_by=null,
    checkout_previous_reserved_until=null,checkout_previous_allocation_id=null,
    checkout_previous_allocation_until=null where id=stay;
  perform pg_temp.capture_projection(
    '17_checkout_reversal',schedule_out,'resolved',c.room_b_name);

  -- Retained overlaps must remain ambiguous even when room types differ.
  insert into public.hotel_room_allocations(
    capacity_reservation_id,room_id,allocated_from,allocated_until,created_by,updated_by)
    values(capacity,c.room_a_id,starts,middle,c.actor_id,c.actor_id)
    returning id into obsolete;
  perform pg_temp.capture_projection(
    '18_historical_cross_type_ambiguous',schedule_in,'unavailable',null);
  update public.hotel_room_allocations set archived_at=clock_timestamp(),
    archived_by=c.actor_id,archive_reason='QA revoke duplicate' where id=obsolete;

  -- Archive is NOT a physical end time. With no retained event segment, fail closed.
  update public.hotel_room_allocations set archived_at=clock_timestamp(),
    archived_by=c.actor_id,archive_reason='QA lifecycle archived' where id=allocation;
  perform pg_temp.capture_projection(
    '19_historical_archived_only',schedule_in,'unavailable',null);

  -- Check-in reversal + unassign is a planned, genuinely unassigned event again.
  update public.hotel_stays set checked_in_at=null,checked_in_by=null where id=stay;
  perform pg_temp.capture_projection(
    '20_check_in_reversal_unassigned',schedule_in,'unassigned',null);
  insert into public.hotel_room_allocations(
    capacity_reservation_id,room_id,allocated_from,allocated_until,created_by,updated_by)
    values(capacity,c.room_b_id,starts,middle,c.actor_id,c.actor_id);
  update public.hotel_stays set checked_in_at=starts,checked_in_by=c.actor_id where id=stay;
  perform pg_temp.capture_projection(
    '21_immediate_reassign_recheck_in',schedule_in,'resolved',c.room_b_name);

  -- Synthetic variants model the 13 A cases' retained+archived shape, not Production IDs.
  for n in 1..13 loop
    insert into public.hotel_room_allocations(
      capacity_reservation_id,room_id,allocated_from,allocated_until,
      archived_at,archived_by,archive_reason,created_by,updated_by)
      values(capacity,c.room_a_id,starts,middle,
        clock_timestamp(),c.actor_id,'QA superseded plan',c.actor_id,c.actor_id);
    perform pg_temp.capture_projection(
      'shape_A_'||lpad(n::text,2,'0'),schedule_in,'resolved',c.room_b_name);
  end loop;
end;
$$;

-- Anonymous and inactive members cannot use the definer RPC; staff can.
do $$
declare c hotel_schedule_room_projection_qa_context%rowtype;
begin
  select * into c from hotel_schedule_room_projection_qa_context;
  perform set_config('request.jwt.claim.sub','',true);
  begin
    perform public.get_operation_hotel_room_projections(array[]::uuid[]);
    raise exception 'QA_ANONYMOUS_ACCEPTED';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claim.sub',c.actor_id::text,true);
  update public.operation_memberships set is_active=false where profile_id=c.actor_id;
  begin
    perform public.get_operation_hotel_room_projections(array[]::uuid[]);
    raise exception 'QA_INACTIVE_ACCEPTED';
  exception when insufficient_privilege then null; end;
  update public.operation_memberships set is_active=true,role='staff'
    where profile_id=c.actor_id;
  if public.get_operation_hotel_room_projections(array[]::uuid[]) <> '[]'::jsonb
    then raise exception 'QA_STAFF_BATCH_FAILED'; end if;
end;
$$;

do $$
declare
  failed_case text;
begin
  select result.case_id
  into failed_case
  from hotel_schedule_room_projection_qa_results result
  where result.actual_projection ->> 'roomResolutionStatus'
      is distinct from result.expected_status
    or result.actual_projection ->> 'hotelRoomName'
      is distinct from result.expected_room_name
  order by result.case_id
  limit 1;
  if failed_case is not null then
    raise exception 'STOP_HOTEL_SCHEDULE_ROOM_PROJECTION_QA_%', failed_case;
  end if;
  if (select count(*) from hotel_schedule_room_projection_qa_results) <> 44 then
    raise exception 'STOP_HOTEL_SCHEDULE_ROOM_PROJECTION_QA_CASE_COUNT';
  end if;
  if public.get_operation_hotel_room_projections(array[]::uuid[]) <> '[]'::jsonb then
    raise exception 'STOP_HOTEL_SCHEDULE_ROOM_PROJECTION_EMPTY_BATCH';
  end if;
end;
$$;

select
  'HOTEL_SCHEDULE_CANONICAL_ROOM_PROJECTION_RUNTIME_QA_PASS' as verdict,
  count(*) as deterministic_fixture_count,
  bool_and(actual_projection ->> 'roomResolutionStatus' = expected_status)
    as status_contract,
  bool_and(actual_projection ->> 'hotelRoomName' is not distinct from expected_room_name)
    as room_contract,
  jsonb_agg(jsonb_build_object(
    'caseId', case_id,
    'status', actual_projection ->> 'roomResolutionStatus',
    'roomName', actual_projection ->> 'hotelRoomName'
  ) order by case_id) as fixture_results
from hotel_schedule_room_projection_qa_results;

rollback;
