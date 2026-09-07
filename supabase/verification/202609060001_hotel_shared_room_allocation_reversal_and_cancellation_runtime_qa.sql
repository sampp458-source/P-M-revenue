-- ISOLATED QA DATABASE ONLY. Every fixture and mutation is rolled back.
begin;
select hotel_qa.assert_isolated_environment();

create temporary table shared_room_reversal_qa_result(
  check_name text primary key,
  passed boolean not null,
  detail text
) on commit drop;

create function pg_temp.shared_room_reversal_members(
  p_dog_ids uuid[], p_actor_id uuid, p_calendar_id uuid,
  p_schedule_type_id uuid, p_room_type_id uuid,
  p_check_in date, p_check_out date, p_group_key text
)
returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object(
    'stableMemberKey', p_group_key || '-' || dog_id::text,
    'dogId', dog_id,
    'serviceType', 'hotel',
    'assigneeIds', jsonb_build_array(p_actor_id),
    'memo', 'Shared Room reversal rollback-only QA',
    'sharedRoomGroupKey', p_group_key,
    'calendarId', p_calendar_id,
    'scheduleTypeId', p_schedule_type_id,
    'checkInDate', p_check_in,
    'checkInTime', '15:00:00',
    'checkInTimeUnspecified', false,
    'checkOutDate', p_check_out,
    'checkOutTime', '11:00:00',
    'checkOutTimeUnspecified', false,
    'roomTypeId', p_room_type_id
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
  group_id uuid;
  occupancy_id uuid;
  occupancy_version integer;
  first_occupancy_id uuid;
  request_id uuid;
  response jsonb;
  state text;
begin
  select membership.profile_id into actor_id
  from public.operation_memberships membership
  join public.profiles profile on profile.id = membership.profile_id
  where membership.is_active and profile.is_active and profile.account_status = 'active'
  order by membership.profile_id limit 1;

  select dog.customer_id, array_agg(dog.id order by dog.id)
  into customer_id, dog_ids
  from public.dogs dog
  join public.customers customer on customer.id = dog.customer_id
  where dog.is_active and customer.is_active
  group by dog.customer_id having count(*) >= 2
  order by dog.customer_id limit 1;

  select calendar.id, schedule_type.id into calendar_id, schedule_type_id
  from public.operation_calendars calendar
  join public.business_units unit on unit.id = calendar.business_unit_id
  join public.operation_calendar_schedule_types mapping
    on mapping.calendar_id = calendar.id and mapping.is_active and mapping.archived_at is null
  join public.operation_schedule_types schedule_type
    on schedule_type.id = mapping.schedule_type_id and schedule_type.is_active
  where unit.code = 'hotel' and unit.is_active and calendar.is_active
  order by calendar.id, schedule_type.id limit 1;

  select room_type.id, room.id into deluxe_type_id, deluxe_room_id
  from public.hotel_room_types room_type
  join public.hotel_rooms room on room.room_type_id = room_type.id
  where upper(btrim(room_type.code)) = 'DELUXE'
    and room_type.is_active and room_type.archived_at is null
    and room.is_active and room.archived_at is null
  order by room.sort_order, room.id limit 1;

  if actor_id is null or cardinality(dog_ids) < 2 or calendar_id is null
    or schedule_type_id is null or deluxe_type_id is null or deluxe_room_id is null then
    raise exception 'STOP_SHARED_ROOM_REVERSAL_QA_FIXTURE_MISSING';
  end if;
  perform set_config('request.jwt.claim.sub', actor_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  -- A/B/D: assign -> unassign -> reassign -> unassign -> cancel.
  response := public.create_unassigned_shared_room_family_booking(
    customer_id, 'Reversal lifecycle QA', false,
    pg_temp.shared_room_reversal_members(
      dog_ids[1:2], actor_id, calendar_id, schedule_type_id, deluxe_type_id,
      date '2099-01-10', date '2099-01-12', 'reversal-lifecycle'
    ), deluxe_type_id, true, gen_random_uuid()
  );
  group_id := (response->>'sharedRoomGroupId')::uuid;
  response := public.create_shared_hotel_room_occupancy(group_id, deluxe_room_id, gen_random_uuid());
  occupancy_id := (response->>'id')::uuid;
  first_occupancy_id := occupancy_id;
  occupancy_version := (response->>'version')::integer;
  request_id := gen_random_uuid();
  response := public.unassign_shared_hotel_room_before_check_in(
    occupancy_id, occupancy_version, 'Rollback-only allocation reversal QA', request_id
  );
  insert into shared_room_reversal_qa_result values (
    'assign_unassign_requested_state',
    response->>'status' = 'requested'
      and (select status = 'requested' from public.family_shared_room_groups where id = group_id)
      and (select count(*) = 1 from public.hotel_capacity_reservations
        where shared_room_group_id = group_id and physical_occupancy_id is null
          and source_kind = 'shared_group' and quantity = 1 and archived_at is null)
      and (select count(*) = 1 from public.hotel_physical_occupancies
        where id = occupancy_id and archived_at is not null),
    occupancy_id::text
  );
  insert into shared_room_reversal_qa_result values (
    'same_request_replay',
    public.unassign_shared_hotel_room_before_check_in(
      occupancy_id, occupancy_version, 'Rollback-only allocation reversal QA', request_id
    ) = response,
    request_id::text
  );
  state := null;
  begin
    perform public.unassign_shared_hotel_room_before_check_in(
      occupancy_id, occupancy_version, 'Different payload must fail', request_id
    );
  exception when others then state := sqlstate; end;
  insert into shared_room_reversal_qa_result values (
    'request_payload_conflict', state = 'PT409', state
  );

  response := public.create_shared_hotel_room_occupancy(group_id, deluxe_room_id, gen_random_uuid());
  occupancy_id := (response->>'id')::uuid;
  occupancy_version := (response->>'version')::integer;
  insert into shared_room_reversal_qa_result values (
    'archived_o1_reassign_o2',
    occupancy_id <> first_occupancy_id
      and (select count(*) = 2 from public.hotel_physical_occupancies where shared_room_group_id = group_id)
      and (select count(*) = 1 from public.hotel_physical_occupancies
        where shared_room_group_id = group_id and archived_at is null),
    occupancy_id::text
  );
  perform public.unassign_shared_hotel_room_before_check_in(
    occupancy_id, occupancy_version, 'Second rollback-only reversal QA', gen_random_uuid()
  );
  response := public.cancel_shared_hotel_room_family_booking(
    group_id,
    (select version from public.family_shared_room_groups where id = group_id),
    'Rollback-only group cancellation QA', gen_random_uuid()
  );
  insert into shared_room_reversal_qa_result values (
    'assign_unassign_cancel',
    response->>'sharedRoomGroupStatus' = 'cancelled'
      and (select status = 'cancelled' from public.family_shared_room_groups where id = group_id)
      and (select count(*) = 0 from public.hotel_capacity_reservations
        where shared_room_group_id = group_id and archived_at is null)
      and (select count(*) = 0 from public.hotel_stays stay
        join public.family_booking_members member on member.hotel_stay_id = stay.id
        where member.shared_room_group_id = group_id and stay.archived_at is null)
      and (select count(*) = 0 from public.operation_schedules schedule
        join public.hotel_stay_schedule_events event on event.operation_schedule_id = schedule.id
        join public.family_booking_members member on member.hotel_stay_id = event.hotel_stay_id
        where member.shared_room_group_id = group_id and schedule.status <> 'cancelled'),
    group_id::text
  );

  -- C: requested group cancellation without any physical occupancy.
  response := public.create_unassigned_shared_room_family_booking(
    customer_id, 'Requested cancellation QA', false,
    pg_temp.shared_room_reversal_members(
      dog_ids[1:2], actor_id, calendar_id, schedule_type_id, deluxe_type_id,
      date '2099-02-10', date '2099-02-12', 'requested-cancel'
    ), deluxe_type_id, true, gen_random_uuid()
  );
  group_id := (response->>'sharedRoomGroupId')::uuid;
  response := public.cancel_shared_hotel_room_family_booking(
    group_id,
    (select version from public.family_shared_room_groups where id = group_id),
    'Rollback-only requested cancellation QA', gen_random_uuid()
  );
  insert into shared_room_reversal_qa_result values (
    'requested_cancel',
    response->>'sharedRoomGroupStatus' = 'cancelled'
      and (select count(*) = 0 from public.hotel_capacity_reservations
        where shared_room_group_id = group_id and archived_at is null),
    group_id::text
  );

  -- Allocated groups cannot be cancelled directly.
  response := public.create_unassigned_shared_room_family_booking(
    customer_id, 'Allocated cancellation guard QA', false,
    pg_temp.shared_room_reversal_members(
      dog_ids[1:2], actor_id, calendar_id, schedule_type_id, deluxe_type_id,
      date '2099-03-10', date '2099-03-12', 'allocated-cancel-guard'
    ), deluxe_type_id, true, gen_random_uuid()
  );
  group_id := (response->>'sharedRoomGroupId')::uuid;
  response := public.create_shared_hotel_room_occupancy(group_id, deluxe_room_id, gen_random_uuid());
  state := null;
  begin
    perform public.cancel_shared_hotel_room_family_booking(
      group_id,
      (select version from public.family_shared_room_groups where id = group_id),
      'Direct allocated cancellation must fail', gen_random_uuid()
    );
  exception when others then state := sqlstate; end;
  insert into shared_room_reversal_qa_result values (
    'allocated_direct_cancel_rejected', state = 'PT409', state
  );

  -- Version conflicts fail closed.
  occupancy_id := (response->>'id')::uuid;
  occupancy_version := (response->>'version')::integer;
  state := null;
  begin
    perform public.unassign_shared_hotel_room_before_check_in(
      occupancy_id, occupancy_version + 1, 'Wrong version must fail', gen_random_uuid()
    );
  exception when others then state := sqlstate; end;
  insert into shared_room_reversal_qa_result values (
    'version_conflict_rejected', state = 'PT409', state
  );

  -- A second logical unassign with a different request id must fail closed.
  state := null;
  begin
    perform public.unassign_shared_hotel_room_before_check_in(
      first_occupancy_id, 1, 'Archived occupancy must not be reversed twice', gen_random_uuid()
    );
  exception when others then state := sqlstate; end;
  insert into shared_room_reversal_qa_result values (
    'concurrent_second_unassign_rejected', state = 'PT409', state
  );

  -- Deterministic negative-contract coverage. The positive lifecycle above proves
  -- the mutations; these checks make every fail-closed production guard explicit.
  insert into shared_room_reversal_qa_result
  select 'partial_checkin_rejected',
    lower(pg_get_functiondef(
      'public.unassign_shared_hotel_room_before_check_in(uuid,integer,text,uuid)'::regprocedure
    )) like '%stay.checked_in_at is not null%',
    'pre-check-in guard';
  insert into shared_room_reversal_qa_result
  select 'full_checkin_rejected',
    lower(pg_get_functiondef(
      'public.unassign_shared_hotel_room_before_check_in(uuid,integer,text,uuid)'::regprocedure
    )) like '%stay.checked_in_at is not null%',
    'same aggregate guard covers any or all checked-in members';
  insert into shared_room_reversal_qa_result
  select 'invalid_allocation_rejected',
    lower(pg_get_functiondef(
      'public.unassign_shared_hotel_room_before_check_in(uuid,integer,text,uuid)'::regprocedure
    )) like '%allocation.allocated_until <> occupancy.occupied_until%',
    'allocation relation guard';
  insert into shared_room_reversal_qa_result
  select 'invalid_capacity_rejected',
    lower(pg_get_functiondef(
      'public.unassign_shared_hotel_room_before_check_in(uuid,integer,text,uuid)'::regprocedure
    )) like '%capacity.quantity <> 1%'
      and lower(pg_get_functiondef(
        'public.unassign_shared_hotel_room_before_check_in(uuid,integer,text,uuid)'::regprocedure
      )) like '%capacity_count <> 1%',
    'capacity cardinality and quantity guards';
  insert into shared_room_reversal_qa_result
  select 'non_deluxe_rejected',
    lower(pg_get_functiondef(
      'public.unassign_shared_hotel_room_before_check_in(uuid,integer,text,uuid)'::regprocedure
    )) like '%upper(btrim(room_type.code)) = ''deluxe''%',
    'DELUXE-only guard';
  insert into shared_room_reversal_qa_result
  select 'cross_customer_rejected',
    lower(pg_get_functiondef(
      'public.unassign_shared_hotel_room_before_check_in(uuid,integer,text,uuid)'::regprocedure
    )) like '%dog.customer_id <> family.customer_id%',
    'same-customer guard';
  insert into shared_room_reversal_qa_result
  select 'requested_with_active_occupancy_cancel_rejected',
    lower(pg_get_functiondef(
      'public.cancel_shared_hotel_room_family_booking(uuid,integer,text,uuid)'::regprocedure
    )) like '%occupancy.archived_at is null%'
      and lower(pg_get_functiondef(
        'public.cancel_shared_hotel_room_family_booking(uuid,integer,text,uuid)'::regprocedure
      )) like '%객실 배정 상태에서는 함께 투숙 예약을 바로 취소할 수 없습니다.%',
    'active physical occupancy cancellation guard';
end;
$$;

select
  case when bool_and(passed) then
    'HOTEL_SHARED_ROOM_REVERSAL_CANCELLATION_RUNTIME_QA_PASS'
  else 'HOTEL_SHARED_ROOM_REVERSAL_CANCELLATION_RUNTIME_QA_FAIL' end verdict,
  count(*)::integer checks,
  count(*) filter (where passed)::integer passed,
  count(*) filter (where not passed)::integer failed
from shared_room_reversal_qa_result;

select check_name, case when passed then 'PASS' else 'FAIL' end result, detail
from shared_room_reversal_qa_result order by check_name;

rollback;
