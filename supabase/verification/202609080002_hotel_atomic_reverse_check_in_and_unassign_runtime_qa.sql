-- ISOLATED QA DATABASE ONLY. Every fixture and mutation is rolled back.
begin;
select hotel_qa.assert_isolated_environment();

create temporary table atomic_reverse_unassign_qa_result (
  check_name text primary key,
  passed boolean not null,
  detail text
) on commit drop;

with fixture(
  check_name, capacity_archived, allocation_has_room, allocation_open,
  provenance_present, released_allocation_match, released_capacity_match,
  archive_reason_match, end_time_match, after_occurred_at,
  before_guarantee_from, return_capacity_valid, transition_status_valid,
  expected_valid
) as (values
  ('single_lifecycle_pre_check_in_active', false, true, false, false, false, false, false, false, false, false, false, false, true),
  ('single_lifecycle_checked_in_active', false, true, false, false, false, false, false, false, false, false, false, false, true),
  ('single_lifecycle_direct_release_history', true, true, false, true, true, true, true, true, true, true, true, true, true),
  ('single_lifecycle_keep_to_release_history', true, true, false, true, true, true, true, true, true, true, true, true, true),
  ('single_lifecycle_room_returned_history', true, true, false, true, true, true, true, true, true, true, true, true, true),
  ('single_lifecycle_archived_capacity_without_provenance', true, true, false, false, true, true, true, true, true, true, true, true, false),
  ('single_lifecycle_open_allocation_with_archived_capacity', true, true, true, true, true, true, true, true, true, true, true, true, false),
  ('single_lifecycle_released_allocation_mismatch', true, true, false, true, false, true, true, true, true, true, true, true, false),
  ('single_lifecycle_released_capacity_mismatch', true, true, false, true, true, false, true, true, true, true, true, true, false),
  ('single_lifecycle_archive_reason_mismatch', true, true, false, true, true, true, false, true, true, true, true, true, false),
  ('single_lifecycle_end_time_mismatch', true, true, false, true, true, true, true, false, true, true, true, true, false),
  ('single_lifecycle_before_occurred_at', true, true, false, true, true, true, true, true, false, true, true, true, false),
  ('single_lifecycle_after_guarantee_from', true, true, false, true, true, true, true, true, true, false, true, true, false),
  ('single_lifecycle_invalid_return_capacity', true, true, false, true, true, true, true, true, true, true, false, true, false)
), evaluated as (
  select
    check_name,
    case
      when not capacity_archived then allocation_has_room
      else allocation_has_room
        and not allocation_open
        and provenance_present
        and released_allocation_match
        and released_capacity_match
        and archive_reason_match
        and end_time_match
        and after_occurred_at
        and before_guarantee_from
        and return_capacity_valid
        and transition_status_valid
    end as actual_valid,
    expected_valid
  from fixture
)
insert into atomic_reverse_unassign_qa_result(check_name, passed, detail)
select check_name, actual_valid = expected_valid,
  format('expected=%s actual=%s', expected_valid, actual_valid)
from evaluated;

create temporary table atomic_reverse_unassign_qa_context (
  actor_id uuid,
  customer_id uuid,
  calendar_id uuid,
  schedule_type_id uuid,
  deluxe_type_id uuid,
  deluxe_room_id uuid
) on commit drop;

create temporary table atomic_reverse_unassign_qa_dogs (
  sequence integer primary key,
  dog_id uuid not null unique
) on commit drop;

do $$
declare
  actor uuid;
  customer uuid := gen_random_uuid();
  calendar_id uuid;
  schedule_type_id uuid;
  deluxe_type uuid;
  deluxe_room uuid;
begin
  select membership.profile_id into actor
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

  select room_type.id, room.id into deluxe_type, deluxe_room
  from public.hotel_room_types room_type
  join public.hotel_rooms room on room.room_type_id = room_type.id
  where upper(btrim(room_type.code)) = 'DELUXE'
    and room_type.is_active and room_type.archived_at is null
    and room.is_active and room.archived_at is null
  order by room.sort_order, room.id
  limit 1;

  if actor is null or calendar_id is null or schedule_type_id is null
    or deluxe_type is null or deluxe_room is null then
    raise exception 'STOP_ATOMIC_REVERSE_UNASSIGN_QA_REFERENCE_DATA';
  end if;

  perform set_config('request.jwt.claim.sub', actor::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', actor, 'role', 'authenticated'
  )::text, true);

  insert into public.customers(id, name, phone, is_active)
  values(customer, 'Atomic Reverse Unassign Rollback QA', '01000009802', true);
  insert into atomic_reverse_unassign_qa_dogs(sequence, dog_id)
    select sequence, gen_random_uuid() from generate_series(1, 8) sequence;
  insert into public.dogs(id, customer_id, name, is_active)
    select dog_id, customer, format('Atomic Reverse QA %s', sequence), true
    from atomic_reverse_unassign_qa_dogs;
  insert into atomic_reverse_unassign_qa_context values(
    actor, customer, calendar_id, schedule_type_id, deluxe_type, deluxe_room
  );
end;
$$;

create function pg_temp.atomic_reverse_unassign_make_single(
  p_dog_sequence integer,
  p_start date,
  p_end date
) returns uuid language plpgsql as $$
declare
  context atomic_reverse_unassign_qa_context%rowtype;
  dog uuid;
  response jsonb;
begin
  select * into context from atomic_reverse_unassign_qa_context;
  select dog_id into dog from atomic_reverse_unassign_qa_dogs
  where sequence = p_dog_sequence;
  response := public.create_flexible_hotel_reservation(
    context.calendar_id, context.schedule_type_id,
    p_start, time '15:00', false,
    p_end, time '11:00', false,
    context.deluxe_type_id, dog, context.customer_id, array[context.actor_id],
    'Atomic reverse/unassign rollback QA', gen_random_uuid()
  );
  return (response ->> 'id')::uuid;
end;
$$;

create function pg_temp.atomic_reverse_unassign_members(
  p_sequences integer[],
  p_start date,
  p_end date,
  p_group_key text
) returns jsonb language sql stable as $$
  select jsonb_agg(jsonb_build_object(
    'stableMemberKey', p_group_key || '-' || dog.sequence::text,
    'dogId', dog.dog_id,
    'serviceType', 'hotel',
    'assigneeIds', jsonb_build_array(context.actor_id),
    'memo', 'Atomic reverse/unassign rollback QA',
    'sharedRoomGroupKey', p_group_key,
    'calendarId', context.calendar_id,
    'scheduleTypeId', context.schedule_type_id,
    'checkInDate', p_start,
    'checkInTime', '15:00:00',
    'checkInTimeUnspecified', false,
    'checkOutDate', p_end,
    'checkOutTime', '11:00:00',
    'checkOutTimeUnspecified', false,
    'roomTypeId', context.deluxe_type_id
  ) order by dog.sequence)
  from atomic_reverse_unassign_qa_context context
  join atomic_reverse_unassign_qa_dogs dog on dog.sequence = any(p_sequences);
$$;

do $$
declare
  context atomic_reverse_unassign_qa_context%rowtype;
  stay_id uuid;
  stay_version integer;
  capacity_id uuid;
  allocation_id uuid;
  request_id uuid;
  response jsonb;
  replay jsonb;
  state text;
begin
  select * into context from atomic_reverse_unassign_qa_context;
  stay_id := pg_temp.atomic_reverse_unassign_make_single(
    1, date '2099-10-01', date '2099-10-03'
  );
  select version into stay_version from public.hotel_stays where id = stay_id;
  perform public.assign_hotel_room(
    stay_id, stay_version, context.deluxe_room_id,
    'Atomic reverse/unassign rollback QA', gen_random_uuid()
  );
  select capacity.id, allocation.id
  into capacity_id, allocation_id
  from public.hotel_capacity_reservations capacity
  join public.hotel_room_allocations allocation
    on allocation.capacity_reservation_id = capacity.id
  where capacity.hotel_stay_id = stay_id
    and capacity.archived_at is null and allocation.archived_at is null;
  select version into stay_version from public.hotel_stays where id = stay_id;
  perform public.complete_hotel_check_in(
    stay_id, stay_version, timestamptz '2099-10-01 15:00+09', gen_random_uuid()
  );

  select version into stay_version from public.hotel_stays where id = stay_id;
  request_id := gen_random_uuid();
  response := public.reverse_check_in_and_unassign_hotel_room(
    stay_id, stay_version, 'Single atomic rollback QA', request_id
  );
  insert into atomic_reverse_unassign_qa_result values(
    'single_atomic_reverse_unassign',
    (select checked_in_at is null and checked_out_at is null and archived_at is null
      from public.hotel_stays where id = stay_id)
      and (select archived_at is null from public.hotel_capacity_reservations where id = capacity_id)
      and (select archived_at is not null from public.hotel_room_allocations where id = allocation_id)
      and (select bool_and(schedule.status = 'scheduled')
        from public.hotel_stay_schedule_events event
        join public.operation_schedules schedule on schedule.id = event.operation_schedule_id
        where event.hotel_stay_id = stay_id and event.archived_at is null),
    response::text
  );

  replay := public.reverse_check_in_and_unassign_hotel_room(
    stay_id, stay_version, 'Single atomic rollback QA', request_id
  );
  insert into atomic_reverse_unassign_qa_result values(
    'same_request_replay', replay = response
      and (select count(*) = 1 from public.hotel_atomic_reverse_unassign_requests
        where hotel_atomic_reverse_unassign_requests.request_id = request_id),
    request_id::text
  );

  state := null;
  begin
    perform public.reverse_check_in_and_unassign_hotel_room(
      stay_id, stay_version, 'Different payload', request_id
    );
  exception when others then state := sqlstate; end;
  insert into atomic_reverse_unassign_qa_result values(
    'request_payload_conflict', state = '23505', state
  );

  stay_id := pg_temp.atomic_reverse_unassign_make_single(
    2, date '2099-10-05', date '2099-10-07'
  );
  select version into stay_version from public.hotel_stays where id = stay_id;
  perform public.assign_hotel_room(
    stay_id, stay_version, context.deluxe_room_id,
    'Checked-out guard QA', gen_random_uuid()
  );
  select version into stay_version from public.hotel_stays where id = stay_id;
  perform public.complete_hotel_check_in(
    stay_id, stay_version, timestamptz '2099-10-05 15:00+09', gen_random_uuid()
  );
  select version into stay_version from public.hotel_stays where id = stay_id;
  perform public.complete_hotel_check_out(
    stay_id, stay_version, timestamptz '2099-10-07 11:00+09', gen_random_uuid()
  );
  select version into stay_version from public.hotel_stays where id = stay_id;
  state := null;
  begin
    perform public.reverse_check_in_and_unassign_hotel_room(
      stay_id, stay_version, 'Checked-out guard QA', gen_random_uuid()
    );
  exception when others then state := sqlstate; end;
  insert into atomic_reverse_unassign_qa_result values(
    'checked_out_guard', state = 'PT409', state
  );
end;
$$;

create function pg_temp.atomic_reverse_unassign_make_shared(
  p_sequences integer[],
  p_start date,
  p_end date,
  p_group_key text
) returns jsonb language plpgsql as $$
declare
  context atomic_reverse_unassign_qa_context%rowtype;
  response jsonb;
  group_id uuid;
begin
  select * into context from atomic_reverse_unassign_qa_context;
  response := public.create_unassigned_shared_room_family_booking(
    context.customer_id,
    'Atomic reverse/unassign rollback QA',
    false,
    pg_temp.atomic_reverse_unassign_members(p_sequences, p_start, p_end, p_group_key),
    context.deluxe_type_id,
    true,
    gen_random_uuid()
  );
  group_id := (response ->> 'sharedRoomGroupId')::uuid;
  return public.create_shared_hotel_room_occupancy(
    group_id, context.deluxe_room_id, gen_random_uuid()
  );
end;
$$;

do $$
declare
  response jsonb;
  occupancy_id uuid;
  occupancy_version integer;
  group_id uuid;
  family_id uuid;
  capacity_id uuid;
  allocation_id uuid;
  stay_ids uuid[];
  stay_id uuid;
  stay_version integer;
  checked_in_target integer;
  scenario text;
begin
  foreach checked_in_target in array array[1, 2]
  loop
    scenario := case checked_in_target when 1 then 'partial_shared_checkin' else 'full_shared_checkin' end;
    response := pg_temp.atomic_reverse_unassign_make_shared(
      case checked_in_target when 1 then array[3,4] else array[5,6] end,
      case checked_in_target when 1 then date '2099-11-01' else date '2099-11-05' end,
      case checked_in_target when 1 then date '2099-11-03' else date '2099-11-07' end,
      scenario
    );
    occupancy_id := (response ->> 'id')::uuid;
    select occupancy.version, occupancy.shared_room_group_id,
           occupancy.capacity_reservation_id, occupancy.room_allocation_id
    into occupancy_version, group_id, capacity_id, allocation_id
    from public.hotel_physical_occupancies occupancy where occupancy.id = occupancy_id;
    select family_booking_id into family_id
    from public.family_shared_room_groups where id = group_id;
    select array_agg(hotel_stay_id order by hotel_stay_id) into stay_ids
    from public.family_booking_members where shared_room_group_id = group_id;

    for stay_id in select unnest(stay_ids[1:checked_in_target])
    loop
      select version into stay_version from public.hotel_stays where id = stay_id;
      perform public.complete_shared_hotel_check_in(
        occupancy_id, stay_id, occupancy_version, stay_version,
        case checked_in_target
          when 1 then timestamptz '2099-11-01 15:00+09'
          else timestamptz '2099-11-05 15:00+09'
        end,
        gen_random_uuid()
      );
      select version into occupancy_version
      from public.hotel_physical_occupancies where id = occupancy_id;
    end loop;

    response := public.reverse_check_in_and_unassign_shared_hotel_room(
      occupancy_id, occupancy_version, scenario, gen_random_uuid()
    );
    insert into atomic_reverse_unassign_qa_result values(
      scenario,
      (select count(*) = 2 from public.hotel_stays stay
        join public.family_booking_members member on member.hotel_stay_id = stay.id
        where member.shared_room_group_id = group_id
          and stay.checked_in_at is null and stay.checked_out_at is null
          and stay.archived_at is null and member.status = 'confirmed')
        and (select status = 'requested' and archived_at is null
          from public.family_shared_room_groups where id = group_id)
        and (select status = 'active' and archived_at is null
          from public.family_bookings where id = family_id)
        and (select archived_at is not null
          from public.hotel_physical_occupancies where id = occupancy_id)
        and (select archived_at is null
          and source_kind = 'shared_group'
          and physical_occupancy_id is null
          and shared_room_group_id = group_id
          and quantity = 1
          from public.hotel_capacity_reservations where id = capacity_id)
        and (select archived_at is not null
          from public.hotel_room_allocations where id = allocation_id)
        and (select count(*) = 1 from public.hotel_capacity_reservations
          where shared_room_group_id = group_id and source_kind = 'shared_group'
            and physical_occupancy_id is null and quantity = 1 and archived_at is null)
        and (select bool_and(schedule.status = 'scheduled')
          from public.operation_schedules schedule
          join public.hotel_stay_schedule_events event on event.operation_schedule_id = schedule.id
          join public.family_booking_members member on member.hotel_stay_id = event.hotel_stay_id
          where member.shared_room_group_id = group_id and event.archived_at is null),
      response::text
    );
  end loop;
end;
$$;

do $$
declare
  response jsonb;
  target_occupancy_id uuid;
  occupancy_version integer;
  stay_ids uuid[];
  stay_id uuid;
  stay_version integer;
  state text;
begin
  response := pg_temp.atomic_reverse_unassign_make_shared(
    array[7,8], date '2099-12-01', date '2099-12-03', 'shared-checked-out-guard'
  );
  target_occupancy_id := (response ->> 'id')::uuid;
  select version into occupancy_version
  from public.hotel_physical_occupancies where id = target_occupancy_id;
  select array_agg(hotel_stay_id order by hotel_stay_id) into stay_ids
  from public.hotel_physical_occupancy_members physical_member
  where physical_member.occupancy_id = target_occupancy_id
    and physical_member.archived_at is null;
  foreach stay_id in array stay_ids
  loop
    select version into stay_version from public.hotel_stays where id = stay_id;
    perform public.complete_shared_hotel_check_in(
      target_occupancy_id, stay_id, occupancy_version, stay_version,
      timestamptz '2099-12-01 15:00+09', gen_random_uuid()
    );
    select version into occupancy_version
    from public.hotel_physical_occupancies where id = target_occupancy_id;
  end loop;
  stay_id := stay_ids[1];
  select version into stay_version from public.hotel_stays where id = stay_id;
  perform public.complete_shared_hotel_member_check_out(
    target_occupancy_id, stay_id, occupancy_version, stay_version,
    timestamptz '2099-12-03 11:00+09', gen_random_uuid()
  );
  select version into occupancy_version
  from public.hotel_physical_occupancies where id = target_occupancy_id;
  state := null;
  begin
    perform public.reverse_check_in_and_unassign_shared_hotel_room(
      target_occupancy_id, occupancy_version, 'Shared checked-out guard QA', gen_random_uuid()
    );
  exception when others then state := sqlstate; end;
  insert into atomic_reverse_unassign_qa_result values(
    'shared_checked_out_guard', state = 'PT409', state
  );
end;
$$;

do $$
declare failed text;
begin
  select string_agg(check_name || coalesce(': ' || detail, ''), ', ' order by check_name)
  into failed from atomic_reverse_unassign_qa_result where not passed;
  if failed is not null then
    raise exception 'STOP_ATOMIC_REVERSE_UNASSIGN_RUNTIME_QA: %', failed;
  end if;
end;
$$;

select
  'HOTEL_ATOMIC_REVERSE_UNASSIGN_RUNTIME_QA_PASS'::text as verdict,
  count(*) as checks,
  count(*) filter (where passed) as passed
from atomic_reverse_unassign_qa_result;

rollback;
