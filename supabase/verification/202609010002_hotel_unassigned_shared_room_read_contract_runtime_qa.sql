-- ISOLATED QA DATABASE ONLY. All fixtures and mutations rollback.
begin;
select hotel_qa.assert_isolated_environment();

create temporary table unassigned_shared_read_qa_result(
  check_name text primary key,
  passed boolean not null,
  detail text
) on commit drop;

create function pg_temp.unassigned_shared_read_members(
  p_dog_ids uuid[], p_actor_id uuid, p_calendar_id uuid,
  p_schedule_type_id uuid, p_room_type_id uuid,
  p_check_in date, p_check_out date
)
returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object(
    'stableMemberKey','read-dog-'||dog_id::text,
    'dogId',dog_id,
    'serviceType','hotel',
    'assigneeIds',jsonb_build_array(p_actor_id),
    'memo','Shared Room read contract QA',
    'sharedRoomGroupKey','read-contract-shared',
    'calendarId',p_calendar_id,
    'scheduleTypeId',p_schedule_type_id,
    'checkInDate',p_check_in,
    'checkInTime','15:00:00',
    'checkInTimeUnspecified',false,
    'checkOutDate',p_check_out,
    'checkOutTime','11:00:00',
    'checkOutTimeUnspecified',false,
    'roomTypeId',p_room_type_id
  ) order by dog_id)
  from unnest(p_dog_ids) dog_id;
$$;

do $$
declare
  actor_id uuid;
  customer_id uuid;
  dog_ids uuid[];
  calendar_id uuid;
  schedule_type_id uuid;
  deluxe_type_id uuid;
  deluxe_room_id uuid;
  response jsonb;
  projection jsonb;
  group_id uuid;
  state text;
begin
  select membership.profile_id into actor_id
  from public.operation_memberships membership
  join public.profiles profile on profile.id = membership.profile_id
  where membership.is_active
    and profile.is_active
    and profile.account_status = 'active'
  order by membership.profile_id
  limit 1;

  select dog.customer_id, array_agg(dog.id order by dog.id)
  into customer_id, dog_ids
  from public.dogs dog
  join public.customers customer on customer.id = dog.customer_id
  where dog.is_active and customer.is_active
  group by dog.customer_id
  having count(*) >= 3
  order by dog.customer_id
  limit 1;

  select calendar.id, schedule_type.id
  into calendar_id, schedule_type_id
  from public.operation_calendars calendar
  join public.business_units unit on unit.id = calendar.business_unit_id
  join public.operation_calendar_schedule_types mapping
    on mapping.calendar_id = calendar.id
   and mapping.is_active
   and mapping.archived_at is null
  join public.operation_schedule_types schedule_type
    on schedule_type.id = mapping.schedule_type_id
   and schedule_type.is_active
  where unit.code = 'hotel'
    and unit.is_active
    and calendar.is_active
  order by calendar.id, schedule_type.id
  limit 1;

  select room_type.id, room.id
  into deluxe_type_id, deluxe_room_id
  from public.hotel_room_types room_type
  join public.hotel_rooms room on room.room_type_id = room_type.id
  where upper(btrim(room_type.code)) = 'DELUXE'
    and upper(btrim(room_type.name)) = 'DELUXE'
    and room_type.is_active
    and room_type.archived_at is null
    and room.is_active
    and room.archived_at is null
  order by room.sort_order, room.id
  limit 1;

  if actor_id is null or cardinality(dog_ids) < 3
    or calendar_id is null or schedule_type_id is null
    or deluxe_type_id is null or deluxe_room_id is null then
    raise exception 'STOP_UNASSIGNED_SHARED_READ_QA_FIXTURE_MISSING';
  end if;

  perform set_config('request.jwt.claim.sub', actor_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  projection := public.get_unassigned_shared_hotel_room_groups(date '2097-01-10');
  insert into unassigned_shared_read_qa_result values (
    'canonical_empty_response',
    projection = '[]'::jsonb,
    jsonb_array_length(projection)::text
  );

  response := public.create_unassigned_shared_room_family_booking(
    customer_id, '2 Dog read QA', false,
    pg_temp.unassigned_shared_read_members(
      dog_ids[1:2], actor_id, calendar_id, schedule_type_id,
      deluxe_type_id, date '2098-02-10', date '2098-02-12'
    ),
    deluxe_type_id, true, gen_random_uuid()
  );
  projection := public.get_unassigned_shared_hotel_room_groups(date '2098-02-10');
  insert into unassigned_shared_read_qa_result values (
    'two_dog_one_projection',
    jsonb_array_length(projection) = 1
      and jsonb_array_length(projection->0->'dogMembers') = 2
      and (projection->0->>'dogCount')::integer = 2
      and projection->0->>'roomTypeCode' = 'DELUXE'
      and (projection->0->>'requestedCapacity')::integer = 1,
    projection->0->>'sharedRoomGroupId'
  );

  response := public.create_unassigned_shared_room_family_booking(
    customer_id, '3 Dog read QA', false,
    pg_temp.unassigned_shared_read_members(
      dog_ids[1:3], actor_id, calendar_id, schedule_type_id,
      deluxe_type_id, date '2098-03-10', date '2098-03-12'
    ),
    deluxe_type_id, true, gen_random_uuid()
  );
  projection := public.get_unassigned_shared_hotel_room_groups(date '2098-03-11');
  insert into unassigned_shared_read_qa_result values (
    'three_dog_one_projection',
    jsonb_array_length(projection) = 1
      and jsonb_array_length(projection->0->'dogMembers') = 3
      and (projection->0->>'dogCount')::integer = 3,
    projection->0->>'sharedRoomGroupId'
  );

  projection := public.get_unassigned_shared_hotel_room_groups(date '2098-03-13');
  insert into unassigned_shared_read_qa_result values (
    'end_boundary_excluded', projection = '[]'::jsonb,
    jsonb_array_length(projection)::text
  );

  response := public.create_unassigned_shared_room_family_booking(
    customer_id, 'Allocated read QA', false,
    pg_temp.unassigned_shared_read_members(
      dog_ids[1:2], actor_id, calendar_id, schedule_type_id,
      deluxe_type_id, date '2098-04-10', date '2098-04-12'
    ),
    deluxe_type_id, true, gen_random_uuid()
  );
  group_id := (response->>'sharedRoomGroupId')::uuid;
  perform public.create_shared_hotel_room_occupancy(
    group_id, deluxe_room_id, gen_random_uuid()
  );
  projection := public.get_unassigned_shared_hotel_room_groups(date '2098-04-10');
  insert into unassigned_shared_read_qa_result values (
    'allocated_group_excluded', projection = '[]'::jsonb,
    jsonb_array_length(projection)::text
  );

  response := public.create_unassigned_shared_room_family_booking(
    customer_id, 'Archived read QA', false,
    pg_temp.unassigned_shared_read_members(
      dog_ids[1:2], actor_id, calendar_id, schedule_type_id,
      deluxe_type_id, date '2098-05-10', date '2098-05-12'
    ),
    deluxe_type_id, true, gen_random_uuid()
  );
  group_id := (response->>'sharedRoomGroupId')::uuid;
  update public.family_shared_room_groups
  set status = 'cancelled',
      updated_by = actor_id,
      archived_at = now(),
      archived_by = actor_id,
      archive_reason = 'Read contract rollback-only QA'
  where id = group_id;
  projection := public.get_unassigned_shared_hotel_room_groups(date '2098-05-10');
  insert into unassigned_shared_read_qa_result values (
    'archived_group_excluded', projection = '[]'::jsonb,
    jsonb_array_length(projection)::text
  );

  state := null;
  perform set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
  begin
    perform public.get_unassigned_shared_hotel_room_groups(date '2098-02-10');
  exception when others then
    state := sqlstate;
  end;
  insert into unassigned_shared_read_qa_result values (
    'unauthorized_user_rejected', state = '42501', state
  );
  perform set_config('request.jwt.claim.sub', actor_id::text, true);

  insert into unassigned_shared_read_qa_result values (
    'authenticated_direct_table_select_revoked',
    not has_table_privilege(
      'authenticated', 'public.family_shared_room_groups', 'SELECT'
    ),
    null
  );

  projection := public.get_unassigned_shared_hotel_room_groups(date '2098-02-10');
  insert into unassigned_shared_read_qa_result values (
    'active_member_rpc_success', jsonb_array_length(projection) = 1, null
  );
end;
$$;

select
  case when bool_and(passed) then
    'HOTEL_UNASSIGNED_SHARED_ROOM_READ_CONTRACT_RUNTIME_QA_PASS'
  else 'HOTEL_UNASSIGNED_SHARED_ROOM_READ_CONTRACT_RUNTIME_QA_FAIL' end verdict,
  count(*)::integer checks,
  count(*) filter (where passed)::integer passed,
  count(*) filter (where not passed)::integer failed
from unassigned_shared_read_qa_result;

select check_name, case when passed then 'PASS' else 'FAIL' end result, detail
from unassigned_shared_read_qa_result
order by check_name;

rollback;
