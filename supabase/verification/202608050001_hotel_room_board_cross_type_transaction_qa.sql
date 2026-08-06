-- ISOLATED QA DATABASE ONLY. Every probe is rolled back.
-- Covers atomic room unassignment and cross-room-type allocation changes.

begin;

select hotel_qa.assert_isolated_environment();

create temporary table hotel_room_board_cross_type_qa_result (
  scenario text primary key,
  passed boolean not null,
  detail text
) on commit drop;

create function pg_temp.create_assigned_hotel_stay(
  p_actor_id uuid,
  p_calendar_id uuid,
  p_schedule_type_id uuid,
  p_dog_id uuid,
  p_customer_id uuid,
  p_room_type_id uuid,
  p_room_id uuid,
  p_check_in_date date,
  p_check_out_date date
)
returns jsonb
language plpgsql
as $$
declare
  created jsonb;
begin
  created := public.create_flexible_hotel_reservation(
    p_calendar_id, p_schedule_type_id,
    p_check_in_date, time '15:00', false,
    p_check_out_date, time '11:00', false,
    p_room_type_id, p_dog_id, p_customer_id, array[p_actor_id],
    'Hotel Room Board rollback-only QA', gen_random_uuid()
  );
  return public.assign_hotel_room(
    (created ->> 'id')::uuid,
    (created ->> 'version')::integer,
    p_room_id,
    'Hotel Room Board rollback-only QA',
    gen_random_uuid()
  );
end;
$$;

create function pg_temp.fail_room_board_cross_type_qa()
returns trigger
language plpgsql
as $$
begin
  if new.id = nullif(
    current_setting('app.hotel_room_board_qa_fail_stay_id', true), ''
  )::uuid then
    raise exception 'HOTEL_ROOM_BOARD_CROSS_TYPE_QA_INJECTED_FAILURE'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger hotel_room_board_cross_type_qa_failure
before update on public.hotel_stays
for each row execute function pg_temp.fail_room_board_cross_type_qa();

do $$
declare
  actor_id uuid;
  dog_id uuid;
  customer_id uuid;
  calendar_id uuid;
  schedule_type_id uuid;
  standard_type_id uuid;
  deluxe_type_id uuid;
  standard_rooms uuid[];
  deluxe_rooms uuid[];
  base_date date := (now() at time zone 'Asia/Seoul')::date + 21000;
  result jsonb;
  replay jsonb;
  stay_id uuid;
  original_version integer;
  request_id uuid;
  capacity_id uuid;
  capacity_before jsonb;
  capacity_after jsonb;
  allocations_before jsonb;
  allocations_after jsonb;
  schedules_before jsonb;
  schedules_after jsonb;
  stay_before jsonb;
  stay_after jsonb;
  audit_before bigint;
  audit_after bigint;
  rejected boolean;
  loop_room_id uuid;
  loop_created jsonb;
begin
  select membership.profile_id into actor_id
  from public.operation_memberships membership
  join public.profiles profile on profile.id = membership.profile_id
  where membership.role = 'owner'
    and membership.is_active
    and profile.is_active
    and profile.account_status = 'active'
  order by membership.updated_at, membership.profile_id
  limit 1;

  select dog.id, dog.customer_id into dog_id, customer_id
  from public.dogs dog
  where dog.is_active
  order by dog.created_at, dog.id
  limit 1;

  select calendar.id, mapping.schedule_type_id
  into calendar_id, schedule_type_id
  from public.operation_calendars calendar
  join public.business_units unit
    on unit.id = calendar.business_unit_id and unit.code = 'hotel'
  join public.operation_calendar_schedule_types mapping
    on mapping.calendar_id = calendar.id
   and mapping.is_active and mapping.archived_at is null
  where calendar.is_active and unit.is_active
  order by calendar.sort_order, mapping.schedule_type_id
  limit 1;

  select room_type.id into standard_type_id
  from public.hotel_room_types room_type
  where room_type.code = 'STANDARD'
    and room_type.is_active and room_type.archived_at is null;
  select room_type.id into deluxe_type_id
  from public.hotel_room_types room_type
  where room_type.code = 'DELUXE'
    and room_type.is_active and room_type.archived_at is null;
  select array_agg(room.id order by room.sort_order, room.id)
  into standard_rooms
  from public.hotel_rooms room
  where room.room_type_id = standard_type_id
    and room.is_active and room.archived_at is null;
  select array_agg(room.id order by room.sort_order, room.id)
  into deluxe_rooms
  from public.hotel_rooms room
  where room.room_type_id = deluxe_type_id
    and room.is_active and room.archived_at is null;

  if actor_id is null or dog_id is null or calendar_id is null
    or schedule_type_id is null or cardinality(standard_rooms) < 2
    or cardinality(deluxe_rooms) < 2 then
    raise exception 'STOP_HOTEL_ROOM_BOARD_CROSS_TYPE_QA_FIXTURE_MISSING';
  end if;
  perform set_config('request.jwt.claim.sub', actor_id::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', actor_id, 'role', 'authenticated')::text,
    true
  );

  -- Unassign succeeds before check-in, preserves the single typed Capacity,
  -- and the identical request is mutation-free.
  result := pg_temp.create_assigned_hotel_stay(
    actor_id, calendar_id, schedule_type_id, dog_id, customer_id,
    standard_type_id, standard_rooms[1], base_date, base_date + 2
  );
  stay_id := (result ->> 'id')::uuid;
  request_id := gen_random_uuid();
  result := public.unassign_hotel_room_before_check_in(
    stay_id, (result ->> 'version')::integer,
    '  QA 배정 해제  ', request_id
  );
  replay := public.unassign_hotel_room_before_check_in(
    stay_id, (result ->> 'version')::integer,
    'QA 배정 해제', request_id
  );
  insert into hotel_room_board_cross_type_qa_result values (
    'unassign_before_check_in',
    not exists (
      select 1 from public.hotel_room_allocations allocation
      join public.hotel_capacity_reservations capacity
        on capacity.id = allocation.capacity_reservation_id
      where capacity.hotel_stay_id = stay_id
        and allocation.archived_at is null
    ) and (select count(*) = 1 from public.hotel_capacity_reservations capacity
      where capacity.hotel_stay_id = stay_id
        and capacity.archived_at is null
        and capacity.room_type_id = standard_type_id)
      and (replay ->> 'id')::uuid = stay_id,
    'Allocation archived; typed Capacity retained; replay returned same Stay'
  );

  -- Before check-in STANDARD -> DELUXE.
  result := pg_temp.create_assigned_hotel_stay(
    actor_id, calendar_id, schedule_type_id, dog_id, customer_id,
    standard_type_id, standard_rooms[1], base_date + 10, base_date + 12
  );
  stay_id := (result ->> 'id')::uuid;
  request_id := gen_random_uuid();
  result := public.change_room_type_before_check_in(
    stay_id, (result ->> 'version')::integer, deluxe_rooms[1],
    'STANDARD → DELUXE QA', request_id
  );
  insert into hotel_room_board_cross_type_qa_result values (
    'before_standard_to_deluxe',
    (select count(*) = 1 from public.hotel_capacity_reservations capacity
      where capacity.hotel_stay_id = stay_id and capacity.archived_at is null
        and capacity.room_type_id = deluxe_type_id)
    and (select count(*) = 1 from public.hotel_room_allocations allocation
      join public.hotel_capacity_reservations capacity
        on capacity.id = allocation.capacity_reservation_id
      where capacity.hotel_stay_id = stay_id and allocation.archived_at is null
        and allocation.room_id = deluxe_rooms[1])
    and (select count(*) = 1 from public.entity_audit_events audit
      where audit.entity_type = 'hotel_stays' and audit.entity_id = stay_id
        and audit.request_id = request_id),
    'Capacity row reclassified; allocation replaced; one root audit'
  );

  -- The same Stay can make a full STANDARD -> DELUXE -> STANDARD round trip
  -- without creating a second Capacity row.
  select coalesce(jsonb_agg(to_jsonb(schedule) order by schedule.id), '[]')
  into schedules_before
  from public.hotel_stay_schedule_events event
  join public.operation_schedules schedule on schedule.id = event.operation_schedule_id
  where event.hotel_stay_id = stay_id;
  result := public.change_room_type_before_check_in(
    stay_id, (result ->> 'version')::integer, standard_rooms[2],
    'DELUXE → STANDARD 왕복 QA', gen_random_uuid()
  );
  insert into hotel_room_board_cross_type_qa_result values (
    'before_standard_deluxe_standard_round_trip',
    (select count(*) = 1 from public.hotel_capacity_reservations capacity
      where capacity.hotel_stay_id = stay_id and capacity.archived_at is null
        and capacity.room_type_id = standard_type_id)
    and (select count(*) = 1 from public.hotel_room_allocations allocation
      join public.hotel_capacity_reservations capacity
        on capacity.id = allocation.capacity_reservation_id
      where capacity.hotel_stay_id = stay_id and allocation.archived_at is null
        and allocation.room_id = standard_rooms[2]),
    'One active Capacity and one active pre-check-in Allocation after round trip'
  );
  select coalesce(jsonb_agg(to_jsonb(schedule) order by schedule.id), '[]')
  into schedules_after
  from public.hotel_stay_schedule_events event
  join public.operation_schedules schedule on schedule.id = event.operation_schedule_id
  where event.hotel_stay_id = stay_id;
  insert into hotel_room_board_cross_type_qa_result values (
    'schedule_unchanged_on_room_type_round_trip',
    schedules_before = schedules_after,
    'Calendar title is resolved from event_kind and current Capacity room type'
  );

  -- Before check-in DELUXE -> STANDARD.
  result := pg_temp.create_assigned_hotel_stay(
    actor_id, calendar_id, schedule_type_id, dog_id, customer_id,
    deluxe_type_id, deluxe_rooms[1], base_date + 20, base_date + 22
  );
  stay_id := (result ->> 'id')::uuid;
  result := public.change_room_type_before_check_in(
    stay_id, (result ->> 'version')::integer, standard_rooms[1],
    'DELUXE → STANDARD QA', gen_random_uuid()
  );
  insert into hotel_room_board_cross_type_qa_result values (
    'before_deluxe_to_standard',
    (select count(*) = 1 from public.hotel_capacity_reservations capacity
      where capacity.hotel_stay_id = stay_id and capacity.archived_at is null
        and capacity.room_type_id = standard_type_id),
    'Reverse direction uses the same atomic contract'
  );

  -- Same-type and version guards.
  rejected := false;
  begin
    perform public.change_room_type_before_check_in(
      stay_id, (result ->> 'version')::integer, standard_rooms[2],
      'same type must fail', gen_random_uuid()
    );
  exception when sqlstate '22023' then rejected := true;
  end;
  insert into hotel_room_board_cross_type_qa_result values (
    'same_type_rejected', rejected, 'Existing same-type RPC remains the route'
  );
  rejected := false;
  begin
    perform public.change_room_type_before_check_in(
      stay_id, -1, deluxe_rooms[2], 'version must fail', gen_random_uuid()
    );
  exception when sqlstate '40001' then rejected := true;
  end;
  insert into hotel_room_board_cross_type_qa_result values (
    'version_conflict_rejected', rejected, 'Optimistic version is mandatory'
  );

  -- Checked-in STANDARD -> DELUXE, and post-check-in unassign guard.
  result := pg_temp.create_assigned_hotel_stay(
    actor_id, calendar_id, schedule_type_id, dog_id, customer_id,
    standard_type_id, standard_rooms[2],
    (now() at time zone 'Asia/Seoul')::date - 2,
    (now() at time zone 'Asia/Seoul')::date + 2
  );
  stay_id := (result ->> 'id')::uuid;
  result := public.complete_hotel_check_in(
    stay_id, (result ->> 'version')::integer,
    (((now() at time zone 'Asia/Seoul')::date - 1)::timestamp + time '15:00')
      at time zone 'Asia/Seoul',
    gen_random_uuid()
  );
  rejected := false;
  begin
    perform public.unassign_hotel_room_before_check_in(
      stay_id, (result ->> 'version')::integer,
      '입실 후 배정 해제 차단', gen_random_uuid()
    );
  exception when sqlstate '22023' then rejected := true;
  end;
  insert into hotel_room_board_cross_type_qa_result values (
    'unassign_after_check_in_rejected', rejected,
    'Checked-in Stay cannot return to the unassigned queue'
  );
  request_id := gen_random_uuid();
  result := public.change_room_type_after_check_in(
    stay_id, (result ->> 'version')::integer, deluxe_rooms[2],
    clock_timestamp() - interval '1 second',
    '입실 후 STANDARD → DELUXE QA', request_id
  );
  insert into hotel_room_board_cross_type_qa_result values (
    'after_standard_to_deluxe',
    (select count(*) = 1 from public.hotel_capacity_reservations capacity
      where capacity.hotel_stay_id = stay_id and capacity.archived_at is null
        and capacity.room_type_id = deluxe_type_id)
    and (select count(*) >= 2 from public.hotel_room_allocations allocation
      join public.hotel_capacity_reservations capacity
        on capacity.id = allocation.capacity_reservation_id
      where capacity.hotel_stay_id = stay_id and allocation.archived_at is null)
    and (select count(*) = 1 from public.entity_audit_events audit
      where audit.entity_type = 'hotel_stays' and audit.entity_id = stay_id
        and audit.request_id = request_id),
    'Current allocation closed; new cross-type segment and root audit created'
  );

  -- Checked-in DELUXE -> STANDARD.
  result := pg_temp.create_assigned_hotel_stay(
    actor_id, calendar_id, schedule_type_id, dog_id, customer_id,
    deluxe_type_id, deluxe_rooms[1],
    (now() at time zone 'Asia/Seoul')::date - 4,
    (now() at time zone 'Asia/Seoul')::date + 3
  );
  stay_id := (result ->> 'id')::uuid;
  result := public.complete_hotel_check_in(
    stay_id, (result ->> 'version')::integer,
    (((now() at time zone 'Asia/Seoul')::date - 3)::timestamp + time '15:00')
      at time zone 'Asia/Seoul',
    gen_random_uuid()
  );
  result := public.change_room_type_after_check_in(
    stay_id, (result ->> 'version')::integer, standard_rooms[1],
    clock_timestamp() - interval '1 second',
    '입실 후 DELUXE → STANDARD QA', gen_random_uuid()
  );
  insert into hotel_room_board_cross_type_qa_result values (
    'after_deluxe_to_standard',
    (select count(*) = 1 from public.hotel_capacity_reservations capacity
      where capacity.hotel_stay_id = stay_id and capacity.archived_at is null
        and capacity.room_type_id = standard_type_id),
    'Reverse post-check-in direction uses the same atomic contract'
  );

  -- Target room collision must reject and preserve the source type/allocation.
  result := pg_temp.create_assigned_hotel_stay(
    actor_id, calendar_id, schedule_type_id, dog_id, customer_id,
    deluxe_type_id, deluxe_rooms[1], base_date + 40, base_date + 42
  );
  loop_created := pg_temp.create_assigned_hotel_stay(
    actor_id, calendar_id, schedule_type_id, dog_id, customer_id,
    standard_type_id, standard_rooms[1], base_date + 40, base_date + 42
  );
  stay_id := (loop_created ->> 'id')::uuid;
  rejected := false;
  begin
    perform public.change_room_type_before_check_in(
      stay_id, (loop_created ->> 'version')::integer, deluxe_rooms[1],
      'occupied target must fail', gen_random_uuid()
    );
  exception when exclusion_violation then rejected := true;
  end;
  insert into hotel_room_board_cross_type_qa_result values (
    'target_room_conflict_rolled_back',
    rejected
    and (select room_type_id = standard_type_id
      from public.hotel_capacity_reservations capacity
      where capacity.hotel_stay_id = stay_id and capacity.archived_at is null),
    '23P01 leaves source Capacity and Allocation unchanged'
  );

  -- Fill the target type for an isolated future interval, then verify a
  -- cross-type change cannot exceed its active room capacity.
  foreach loop_room_id in array deluxe_rooms loop
    loop_created := public.create_flexible_hotel_reservation(
      calendar_id, schedule_type_id,
      base_date + 50, time '15:00', false,
      base_date + 52, time '11:00', false,
      deluxe_type_id, dog_id, customer_id, array[actor_id],
      'target type capacity fill QA', gen_random_uuid()
    );
  end loop;
  result := pg_temp.create_assigned_hotel_stay(
    actor_id, calendar_id, schedule_type_id, dog_id, customer_id,
    standard_type_id, standard_rooms[1], base_date + 50, base_date + 52
  );
  stay_id := (result ->> 'id')::uuid;
  rejected := false;
  begin
    perform public.change_room_type_before_check_in(
      stay_id, (result ->> 'version')::integer, deluxe_rooms[1],
      'full target type must fail', gen_random_uuid()
    );
  exception when others then
    rejected := sqlerrm ~* 'capacity|객실|잔여|만실';
  end;
  insert into hotel_room_board_cross_type_qa_result values (
    'target_type_capacity_conflict_rolled_back',
    rejected
    and (select room_type_id = standard_type_id
      from public.hotel_capacity_reservations capacity
      where capacity.hotel_stay_id = stay_id and capacity.archived_at is null),
    'Capacity shortage rejects before reclassification'
  );

  -- Failure injection occurs at the final Stay root update. All prior Capacity,
  -- Allocation and Schedule mutations and all child audits must roll back.
  result := pg_temp.create_assigned_hotel_stay(
    actor_id, calendar_id, schedule_type_id, dog_id, customer_id,
    standard_type_id, standard_rooms[1], base_date + 30, base_date + 32
  );
  stay_id := (result ->> 'id')::uuid;
  select capacity.id into capacity_id
  from public.hotel_capacity_reservations capacity
  where capacity.hotel_stay_id = stay_id and capacity.archived_at is null;
  select to_jsonb(capacity) into capacity_before
  from public.hotel_capacity_reservations capacity where capacity.id = capacity_id;
  select coalesce(jsonb_agg(to_jsonb(allocation) order by allocation.id), '[]')
  into allocations_before from public.hotel_room_allocations allocation
  where allocation.capacity_reservation_id = capacity_id;
  select coalesce(jsonb_agg(to_jsonb(schedule) order by schedule.id), '[]')
  into schedules_before
  from public.hotel_stay_schedule_events event
  join public.operation_schedules schedule on schedule.id = event.operation_schedule_id
  where event.hotel_stay_id = stay_id;
  select to_jsonb(stay) into stay_before from public.hotel_stays stay where stay.id = stay_id;
  select count(*) into audit_before from public.entity_audit_events audit
  where audit.entity_id = stay_id or audit.entity_id = capacity_id
    or audit.entity_id in (
      select event.operation_schedule_id from public.hotel_stay_schedule_events event
      where event.hotel_stay_id = stay_id
    );
  perform set_config('app.hotel_room_board_qa_fail_stay_id', stay_id::text, true);
  rejected := false;
  begin
    perform public.change_room_type_before_check_in(
      stay_id, (result ->> 'version')::integer, deluxe_rooms[1],
      'atomic rollback injection', gen_random_uuid()
    );
  exception when sqlstate 'P0001' then rejected := true;
  end;
  perform set_config('app.hotel_room_board_qa_fail_stay_id', '', true);
  select to_jsonb(capacity) into capacity_after
  from public.hotel_capacity_reservations capacity where capacity.id = capacity_id;
  select coalesce(jsonb_agg(to_jsonb(allocation) order by allocation.id), '[]')
  into allocations_after from public.hotel_room_allocations allocation
  where allocation.capacity_reservation_id = capacity_id;
  select coalesce(jsonb_agg(to_jsonb(schedule) order by schedule.id), '[]')
  into schedules_after
  from public.hotel_stay_schedule_events event
  join public.operation_schedules schedule on schedule.id = event.operation_schedule_id
  where event.hotel_stay_id = stay_id;
  select to_jsonb(stay) into stay_after from public.hotel_stays stay where stay.id = stay_id;
  select count(*) into audit_after from public.entity_audit_events audit
  where audit.entity_id = stay_id or audit.entity_id = capacity_id
    or audit.entity_id in (
      select event.operation_schedule_id from public.hotel_stay_schedule_events event
      where event.hotel_stay_id = stay_id
    );
  insert into hotel_room_board_cross_type_qa_result values (
    'failure_injection_full_rollback',
    rejected and capacity_before = capacity_after
      and allocations_before = allocations_after
      and schedules_before = schedules_after
      and stay_before = stay_after and audit_before = audit_after,
    'Capacity, Allocation, Schedule, Stay and Audit fingerprints unchanged'
  );

  if exists (select 1 from hotel_room_board_cross_type_qa_result where not passed) then
    raise exception 'HOTEL_ROOM_BOARD_CROSS_TYPE_TRANSACTION_QA_FAILED';
  end if;
end;
$$;

select *,
  case when bool_and(passed)
    then 'HOTEL_ROOM_BOARD_CROSS_TYPE_TRANSACTION_QA_READY'
    else 'HOTEL_ROOM_BOARD_CROSS_TYPE_TRANSACTION_QA_FAILED'
  end as transaction_qa_status
from hotel_room_board_cross_type_qa_result
group by scenario, passed, detail
order by scenario;

rollback;
