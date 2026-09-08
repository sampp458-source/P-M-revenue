-- ISOLATED QA DATABASE ONLY. Every fixture and mutation is rolled back.
begin;
select hotel_qa.assert_isolated_environment();

create temporary table shared_checkin_reversal_qa_result(
  check_name text primary key,
  passed boolean not null,
  detail text
) on commit drop;

create function pg_temp.shared_checkin_reversal_members(
  p_dog_ids uuid[],
  p_actor_id uuid,
  p_calendar_id uuid,
  p_schedule_type_id uuid,
  p_room_type_id uuid
)
returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object(
    'stableMemberKey', 'reverse-checkin-' || dog_id::text,
    'dogId', dog_id,
    'serviceType', 'hotel',
    'assigneeIds', jsonb_build_array(p_actor_id),
    'memo', 'Shared check-in reversal rollback-only QA',
    'sharedRoomGroupKey', 'reverse-checkin-group',
    'calendarId', p_calendar_id,
    'scheduleTypeId', p_schedule_type_id,
    'checkInDate', date '2099-09-10',
    'checkInTime', '15:00:00',
    'checkInTimeUnspecified', false,
    'checkOutDate', date '2099-09-12',
    'checkOutTime', '11:00:00',
    'checkOutTimeUnspecified', false,
    'roomTypeId', p_room_type_id
  ) order by dog_id)
  from unnest(p_dog_ids) dog_id;
$$;

do $$
declare
  actor_id uuid;
  customer_id uuid := gen_random_uuid();
  dog_ids uuid[] := array[gen_random_uuid(), gen_random_uuid()];
  calendar_id uuid;
  schedule_type_id uuid;
  deluxe_type_id uuid;
  deluxe_room_id uuid;
  family_id uuid;
  group_id uuid;
  occupancy_id uuid;
  occupancy_version integer;
  stay_a uuid;
  stay_b uuid;
  stay_version integer;
  capacity_id uuid;
  allocation_id uuid;
  physical_member_a uuid;
  physical_member_b uuid;
  reverse_request_id uuid;
  response jsonb;
  replay jsonb;
  state text;
begin
  select membership.profile_id into actor_id
  from public.operation_memberships membership
  join public.profiles profile on profile.id = membership.profile_id
  where membership.is_active
    and membership.role in ('owner', 'manager')
    and profile.is_active
    and profile.account_status = 'active'
  order by case membership.role when 'owner' then 0 else 1 end, membership.profile_id
  limit 1;

  select calendar.id, mapping.schedule_type_id
  into calendar_id, schedule_type_id
  from public.operation_calendars calendar
  join public.business_units unit on unit.id = calendar.business_unit_id
  join public.operation_calendar_schedule_types mapping
    on mapping.calendar_id = calendar.id
    and mapping.is_active
    and mapping.archived_at is null
  where unit.code = 'hotel' and unit.is_active and calendar.is_active
  order by mapping.created_at
  limit 1;

  select room_type.id, room.id into deluxe_type_id, deluxe_room_id
  from public.hotel_room_types room_type
  join public.hotel_rooms room on room.room_type_id = room_type.id
  where upper(btrim(room_type.code)) = 'DELUXE'
    and room_type.is_active and room_type.archived_at is null
    and room.is_active and room.archived_at is null
  order by room.sort_order, room.id
  limit 1;

  if actor_id is null or calendar_id is null or schedule_type_id is null
    or deluxe_type_id is null or deluxe_room_id is null then
    raise exception 'STOP_SHARED_CHECKIN_REVERSAL_QA_REFERENCE_DATA';
  end if;

  perform set_config('request.jwt.claim.sub', actor_id::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', actor_id, 'role', 'authenticated'
  )::text, true);

  insert into public.customers(id, name, phone, is_active)
  values(customer_id, 'Shared Check-in Reversal Rollback QA', '01000000908', true);
  insert into public.dogs(id, customer_id, name, is_active)
  values
    (dog_ids[1], customer_id, 'Shared Reverse QA A', true),
    (dog_ids[2], customer_id, 'Shared Reverse QA B', true);

  response := public.create_unassigned_shared_room_family_booking(
    customer_id,
    'Shared check-in reversal rollback-only QA',
    false,
    pg_temp.shared_checkin_reversal_members(
      dog_ids, actor_id, calendar_id, schedule_type_id, deluxe_type_id
    ),
    deluxe_type_id,
    true,
    gen_random_uuid()
  );
  group_id := (response->>'sharedRoomGroupId')::uuid;
  select family_booking_id into family_id
  from public.family_shared_room_groups where id = group_id;
  select hotel_stay_id into stay_a
  from public.family_booking_members
  where shared_room_group_id = group_id and dog_id = dog_ids[1];
  select hotel_stay_id into stay_b
  from public.family_booking_members
  where shared_room_group_id = group_id and dog_id = dog_ids[2];

  response := public.create_shared_hotel_room_occupancy(
    group_id, deluxe_room_id, gen_random_uuid()
  );
  occupancy_id := (response->>'id')::uuid;
  select version, capacity_reservation_id, room_allocation_id
  into occupancy_version, capacity_id, allocation_id
  from public.hotel_physical_occupancies where id = occupancy_id;
  select id into physical_member_a
  from public.hotel_physical_occupancy_members member
  where member.occupancy_id = occupancy_id and member.hotel_stay_id = stay_a;
  select id into physical_member_b
  from public.hotel_physical_occupancy_members member
  where member.occupancy_id = occupancy_id and member.hotel_stay_id = stay_b;

  select version into stay_version from public.hotel_stays where id = stay_a;
  perform public.complete_shared_hotel_check_in(
    occupancy_id, stay_a, occupancy_version, stay_version,
    timestamptz '2099-09-10 15:00+09', gen_random_uuid()
  );
  select version into occupancy_version from public.hotel_physical_occupancies where id = occupancy_id;
  select version into stay_version from public.hotel_stays where id = stay_b;
  perform public.complete_shared_hotel_check_in(
    occupancy_id, stay_b, occupancy_version, stay_version,
    timestamptz '2099-09-10 15:05+09', gen_random_uuid()
  );

  select version into occupancy_version from public.hotel_physical_occupancies where id = occupancy_id;
  select version into stay_version from public.hotel_stays where id = stay_a;
  reverse_request_id := gen_random_uuid();
  response := public.reverse_shared_hotel_member_check_in(
    occupancy_id, stay_a, occupancy_version, stay_version,
    'Rollback-only partial member reversal QA', reverse_request_id
  );

  insert into shared_checkin_reversal_qa_result values (
    'partial_member_reversal',
    (select checked_in_at is null and checked_in_by is null from public.hotel_stays where id = stay_a)
      and (select status = 'confirmed' from public.family_booking_members where hotel_stay_id = stay_a)
      and (select status = 'active' and left_at is null from public.hotel_physical_occupancy_members where id = physical_member_a)
      and (select checked_in_at is not null and checked_out_at is null from public.hotel_stays where id = stay_b)
      and (select status = 'checked_in' from public.family_booking_members where hotel_stay_id = stay_b)
      and (select status = 'active' and left_at is null from public.hotel_physical_occupancy_members where id = physical_member_b),
    response::text
  );

  insert into shared_checkin_reversal_qa_result values (
    'physical_contract_preserved',
    (select status = 'active' and archived_at is null
      and capacity_reservation_id = capacity_id and room_allocation_id = allocation_id
      from public.hotel_physical_occupancies where id = occupancy_id)
      and (select status = 'allocated' and archived_at is null
        from public.family_shared_room_groups where id = group_id)
      and (select source_kind = 'shared_occupancy' and quantity = 1 and archived_at is null
        and physical_occupancy_id = occupancy_id
        from public.hotel_capacity_reservations where id = capacity_id)
      and (select archived_at is null and room_id = deluxe_room_id
        and capacity_reservation_id = capacity_id
        from public.hotel_room_allocations where id = allocation_id),
    occupancy_id::text
  );

  insert into shared_checkin_reversal_qa_result values (
    'checkin_schedule_restored',
    (select schedule.status = 'scheduled'
      from public.hotel_stay_schedule_events event
      join public.operation_schedules schedule on schedule.id = event.operation_schedule_id
      where event.hotel_stay_id = stay_a and event.event_kind = 'check_in'
        and event.archived_at is null),
    stay_a::text
  );

  replay := public.reverse_shared_hotel_member_check_in(
    occupancy_id, stay_a, occupancy_version, stay_version,
    'Rollback-only partial member reversal QA', reverse_request_id
  );
  insert into shared_checkin_reversal_qa_result values (
    'same_request_replay',
    replay = response
      and (select count(*) = 1 from public.hotel_physical_occupancy_requests
        where hotel_physical_occupancy_requests.request_id = reverse_request_id
          and operation_kind = 'reverse_check_in'),
    reverse_request_id::text
  );

  state := null;
  begin
    perform public.reverse_shared_hotel_member_check_in(
      occupancy_id, stay_a, occupancy_version, stay_version,
      'Different payload must fail', reverse_request_id
    );
  exception when others then state := sqlstate; end;
  insert into shared_checkin_reversal_qa_result values (
    'request_collision_rejected', state = 'PT409', state
  );

  state := null;
  begin
    perform public.unassign_shared_hotel_room_before_check_in(
      occupancy_id,
      (select version from public.hotel_physical_occupancies where id = occupancy_id),
      'Checked-in member must block unassign',
      gen_random_uuid()
    );
  exception when others then state := sqlstate; end;
  insert into shared_checkin_reversal_qa_result values (
    'partial_checkin_blocks_unassign', state = 'PT409', state
  );

  select version into occupancy_version from public.hotel_physical_occupancies where id = occupancy_id;
  select version into stay_version from public.hotel_stays where id = stay_b;
  perform public.reverse_shared_hotel_member_check_in(
    occupancy_id, stay_b, occupancy_version, stay_version,
    'Rollback-only final member reversal QA', gen_random_uuid()
  );
  insert into shared_checkin_reversal_qa_result values (
    'all_members_reversed',
    (select count(*) = 2 from public.hotel_stays stay
      join public.family_booking_members member on member.hotel_stay_id = stay.id
      where member.shared_room_group_id = group_id
        and stay.checked_in_at is null and stay.checked_out_at is null
        and member.status = 'confirmed')
      and (select count(*) = 2 from public.hotel_physical_occupancy_members member
        where member.occupancy_id = occupancy_id and member.status = 'active'
          and member.left_at is null and member.archived_at is null),
    group_id::text
  );

  response := public.unassign_shared_hotel_room_before_check_in(
    occupancy_id,
    (select version from public.hotel_physical_occupancies where id = occupancy_id),
    'All members reversed; unassign may proceed',
    gen_random_uuid()
  );
  insert into shared_checkin_reversal_qa_result values (
    'unassign_after_all_reversed',
    response->>'status' = 'requested'
      and (select status = 'requested' from public.family_shared_room_groups where id = group_id)
      and (select archived_at is not null from public.hotel_physical_occupancies where id = occupancy_id)
      and (select count(*) = 1 from public.hotel_capacity_reservations
        where shared_room_group_id = group_id and source_kind = 'shared_group'
          and physical_occupancy_id is null and quantity = 1 and archived_at is null),
    response::text
  );

  state := null;
  begin
    perform public.reverse_shared_hotel_member_check_in(
      occupancy_id, stay_a, -1, -1, 'Stale version must fail', gen_random_uuid()
    );
  exception when others then state := sqlstate; end;
  insert into shared_checkin_reversal_qa_result values (
    'stale_or_inactive_rejected', state = 'PT409', state
  );

  insert into shared_checkin_reversal_qa_result values (
    'family_booking_preserved',
    (select status = 'active' and archived_at is null
      from public.family_bookings where id = family_id),
    family_id::text
  );
end;
$$;

do $$
declare failed text;
begin
  select string_agg(check_name || coalesce(': ' || detail, ''), ', ' order by check_name)
  into failed from shared_checkin_reversal_qa_result where not passed;
  if failed is not null then
    raise exception 'STOP_SHARED_CHECKIN_REVERSAL_RUNTIME_QA: %', failed;
  end if;
end;
$$;

select
  'HOTEL_SHARED_ROOM_MEMBER_CHECKIN_REVERSAL_RUNTIME_QA_PASS'::text as verdict,
  count(*) as checks,
  count(*) filter (where passed) as passed
from shared_checkin_reversal_qa_result;

rollback;
