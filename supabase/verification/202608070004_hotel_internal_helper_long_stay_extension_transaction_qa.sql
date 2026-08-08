-- ISOLATED CLEAN QA ONLY. Every mutation is rolled back.

begin;

select hotel_qa.assert_isolated_environment();

create temporary table long_stay_extension_qa_result (
  check_name text primary key,
  passed boolean not null,
  detail text null
) on commit drop;

do $$
declare
  actor_id uuid;
  customer_id uuid;
  dog_id uuid;
  calendar_id uuid;
  schedule_type_id uuid;
  source_type public.hotel_room_types%rowtype;
  target_type public.hotel_room_types%rowtype;
  source_room public.hotel_rooms%rowtype;
  target_room public.hotel_rooms%rowtype;
  runtime_input jsonb;
  stay_json jsonb;
  stay_id uuid;
  stay_version integer;
  capacity_id uuid;
  missing_event_state text;
  duplicate_contract_state text;
  archived_event_state text;
  failed_before jsonb;
  failed_after jsonb;
  included_stay_id uuid;
  included_capacity_id uuid;
  included_change_request_id uuid;
  post_checkout_stay_id uuid;
  post_checkout_capacity_id uuid;
  post_checkout_schedule jsonb;
  post_checkout_change_request_id uuid;
begin
  select membership.profile_id into actor_id
  from public.operation_memberships membership
  join public.profiles profile on profile.id = membership.profile_id
  where membership.role = 'owner' and membership.is_active
    and profile.is_active and profile.account_status = 'active'
  order by membership.updated_at, membership.profile_id limit 1;

  select dog.customer_id, dog.id into customer_id, dog_id
  from public.dogs dog
  join public.customers customer on customer.id = dog.customer_id
  where dog.is_active and customer.is_active
  order by dog.created_at, dog.id limit 1;

  select calendar.id, schedule_type.id
  into calendar_id, schedule_type_id
  from public.operation_calendars calendar
  join public.business_units unit on unit.id = calendar.business_unit_id
  join public.operation_calendar_schedule_types mapping
    on mapping.calendar_id = calendar.id
   and mapping.is_active and mapping.archived_at is null
  join public.operation_schedule_types schedule_type
    on schedule_type.id = mapping.schedule_type_id
   and schedule_type.is_active
  where unit.code = 'hotel' and unit.is_active and calendar.is_active
  order by calendar.id, schedule_type.id limit 1;

  select room_type.* into source_type
  from public.hotel_room_types room_type
  where room_type.code = 'STANDARD'
    and room_type.is_active and room_type.archived_at is null;
  select room_type.* into target_type
  from public.hotel_room_types room_type
  where room_type.code = 'DELUXE'
    and room_type.is_active and room_type.archived_at is null;
  select room.* into source_room from public.hotel_rooms room
  where room.room_type_id = source_type.id
    and room.is_active and room.archived_at is null
  order by room.sort_order, room.id limit 1;
  select room.* into target_room from public.hotel_rooms room
  where room.room_type_id = target_type.id
    and room.is_active and room.archived_at is null
  order by room.sort_order, room.id limit 1;

  if actor_id is null or customer_id is null or dog_id is null
    or calendar_id is null or schedule_type_id is null
    or source_room.id is null or target_room.id is null then
    raise exception 'STOP_LONG_STAY_EXTENSION_QA_FIXTURE_MISSING';
  end if;

  perform set_config('request.jwt.claim.sub', actor_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  runtime_input := public.prepare_hotel_reservation_runtime_input_extended_internal(
    calendar_id, schedule_type_id,
    date '2094-01-10', time '15:00', false,
    null, null, null,
    false, timestamptz '2094-02-01 00:00:00+09',
    source_type.id, dog_id, customer_id, array[actor_id],
    'Long Stay Extension rollback-only QA'
  );
  if runtime_input -> 'checkOutScheduleAt' <> 'null'::jsonb
    or runtime_input -> 'expectedCheckOutEndsAt' <> 'null'::jsonb
    or runtime_input -> 'checkOutTitle' <> 'null'::jsonb then
    raise exception 'checkout excluded projection must contain JSON nulls';
  end if;

  stay_json := public.create_hotel_reservation_runtime_extended_internal(
    calendar_id, schedule_type_id, dog_id, source_type.id, array[actor_id],
    'Long Stay Extension rollback-only QA', actor_id,
    gen_random_uuid(), gen_random_uuid(), null,
    runtime_input, false
  );
  stay_id := (stay_json ->> 'id')::uuid;
  select capacity.id into capacity_id
  from public.hotel_capacity_reservations capacity
  where capacity.hotel_stay_id = stay_id and capacity.archived_at is null;

  insert into long_stay_extension_qa_result values (
    'checkout_excluded_graph',
    (select count(*) = 1 from public.hotel_stay_schedule_events event
      where event.hotel_stay_id = stay_id and event.archived_at is null)
    and not exists (
      select 1 from public.hotel_stay_schedule_events event
      where event.hotel_stay_id = stay_id and event.event_kind = 'check_out'
        and event.archived_at is null
    ), null
  );

  select stay.version into stay_version from public.hotel_stays stay
  where stay.id = stay_id;
  perform public.assign_hotel_room(
    stay_id, stay_version, source_room.id,
    'Long Stay Extension QA initial assignment', gen_random_uuid()
  );
  select stay.version into stay_version from public.hotel_stays stay
  where stay.id = stay_id;

  perform public.change_hotel_room_type_and_allocation_extended_internal(
    'before_check_in', stay_id, stay_version,
    target_room.id, target_type.id, target_type.code, target_room.name,
    timestamptz '2094-01-10 15:00:00+09',
    'Long Stay check-in-only event contract',
    'Long Stay Extension QA cross-type', actor_id, gen_random_uuid(),
    array['check_in']::text[]
  );
  insert into long_stay_extension_qa_result values (
    'check_in_only_cross_type',
    (select capacity.room_type_id = target_type.id
      from public.hotel_capacity_reservations capacity
      where capacity.id = capacity_id)
    and exists (
      select 1 from public.hotel_room_allocations allocation
      where allocation.capacity_reservation_id = capacity_id
        and allocation.room_id = target_room.id
        and allocation.archived_at is null
    ), null
  );

  select stay.version into stay_version from public.hotel_stays stay
  where stay.id = stay_id;
  select jsonb_build_object(
    'stayVersion', (select version from public.hotel_stays where id = stay_id),
    'roomType', (select room_type_id from public.hotel_capacity_reservations where id = capacity_id),
    'allocations', (select count(*) from public.hotel_room_allocations where capacity_reservation_id = capacity_id and archived_at is null),
    'audits', (select count(*) from public.entity_audit_events where entity_id in (stay_id, capacity_id))
  ) into failed_before;
  begin
    perform public.change_hotel_room_type_and_allocation_extended_internal(
      'before_check_in', stay_id, stay_version,
      source_room.id, source_type.id, source_type.code, source_room.name,
      timestamptz '2094-01-10 15:00:00+09',
      'missing checkout event', 'missing checkout event',
      actor_id, gen_random_uuid(), array['check_in','check_out']::text[]
    );
  exception when others then
    missing_event_state := sqlstate;
  end;
  insert into long_stay_extension_qa_result values (
    'required_event_missing', missing_event_state = 'P0002', missing_event_state
  );
  select jsonb_build_object(
    'stayVersion', (select version from public.hotel_stays where id = stay_id),
    'roomType', (select room_type_id from public.hotel_capacity_reservations where id = capacity_id),
    'allocations', (select count(*) from public.hotel_room_allocations where capacity_reservation_id = capacity_id and archived_at is null),
    'audits', (select count(*) from public.entity_audit_events where entity_id in (stay_id, capacity_id))
  ) into failed_after;
  insert into long_stay_extension_qa_result values (
    'failed_call_mutation_free', failed_before = failed_after,
    case when failed_before = failed_after then null else
      jsonb_build_object('before', failed_before, 'after', failed_after)::text end
  );

  begin
    perform public.change_hotel_room_type_and_allocation_extended_internal(
      'before_check_in', stay_id, stay_version,
      source_room.id, source_type.id, source_type.code, source_room.name,
      timestamptz '2094-01-10 15:00:00+09',
      'duplicate contract', 'duplicate contract',
      actor_id, gen_random_uuid(), array['check_in','check_in']::text[]
    );
  exception when others then
    duplicate_contract_state := sqlstate;
  end;
  insert into long_stay_extension_qa_result values (
    'duplicate_required_event_rejected',
    duplicate_contract_state = '22023', duplicate_contract_state
  );

  begin
    update public.hotel_stay_schedule_events event
    set archived_at = clock_timestamp(), archived_by = actor_id,
        archive_reason = 'Long Stay Extension archived event QA',
        updated_by = actor_id
    where event.hotel_stay_id = stay_id
      and event.event_kind = 'check_in' and event.archived_at is null;
    perform public.change_hotel_room_type_and_allocation_extended_internal(
      'before_check_in', stay_id, stay_version,
      source_room.id, source_type.id, source_type.code, source_room.name,
      timestamptz '2094-01-10 15:00:00+09',
      'archived event', 'archived event', actor_id, gen_random_uuid(),
      array['check_in']::text[]
    );
  exception when others then
    archived_event_state := sqlstate;
  end;
  insert into long_stay_extension_qa_result values (
    'archived_required_event_rejected',
    archived_event_state = 'P0002', archived_event_state
  );

  runtime_input := public.prepare_hotel_reservation_runtime_input_extended_internal(
    calendar_id, schedule_type_id,
    date '2094-03-10', time '15:00', false,
    date '2094-03-12', time '11:00', false,
    true, null, source_type.id, dog_id, customer_id, array[actor_id],
    'Checkout included QA'
  );
  stay_json := public.create_hotel_reservation_runtime_extended_internal(
    calendar_id, schedule_type_id, dog_id, source_type.id, array[actor_id],
    'Checkout included QA', actor_id,
    gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
    runtime_input, true
  );
  included_stay_id := (stay_json ->> 'id')::uuid;
  insert into long_stay_extension_qa_result values (
    'checkout_included_graph',
    (select count(*) = 2
      and count(*) filter (where event_kind = 'check_in') = 1
      and count(*) filter (where event_kind = 'check_out') = 1
      from public.hotel_stay_schedule_events event
      where event.hotel_stay_id = included_stay_id
        and event.archived_at is null), null
  );

  -- Ordinary Hotel compatibility: a checkout-included Stay must retain exactly
  -- one required event of each kind while Capacity and Allocation move together.
  select capacity.id into included_capacity_id
  from public.hotel_capacity_reservations capacity
  where capacity.hotel_stay_id = included_stay_id
    and capacity.archived_at is null;
  select stay.version into stay_version
  from public.hotel_stays stay where stay.id = included_stay_id;
  perform public.assign_hotel_room(
    included_stay_id, stay_version, source_room.id,
    'Long Stay Extension ordinary required-both assignment', gen_random_uuid()
  );
  select stay.version into stay_version
  from public.hotel_stays stay where stay.id = included_stay_id;
  included_change_request_id := gen_random_uuid();
  stay_json := public.change_hotel_room_type_and_allocation_extended_internal(
    'before_check_in', included_stay_id, stay_version,
    target_room.id, target_type.id, target_type.code, target_room.name,
    timestamptz '2094-03-10 15:00:00+09',
    'Ordinary required-both event contract',
    'Long Stay Extension ordinary required-both QA', actor_id,
    included_change_request_id, array['check_in','check_out']::text[]
  );
  insert into long_stay_extension_qa_result values (
    'ordinary_required_both_cross_type',
    (stay_json ->> 'id')::uuid = included_stay_id
    and (select capacity.room_type_id = target_type.id
      from public.hotel_capacity_reservations capacity
      where capacity.id = included_capacity_id)
    and (select count(*) = 1
      from public.hotel_room_allocations allocation
      where allocation.capacity_reservation_id = included_capacity_id
        and allocation.room_id = target_room.id
        and allocation.archived_at is null)
    and (select count(*) = 2
      and count(*) filter (where event_kind = 'check_in') = 1
      and count(*) filter (where event_kind = 'check_out') = 1
      from public.hotel_stay_schedule_events event
      where event.hotel_stay_id = included_stay_id
        and event.archived_at is null)
    and (select count(*) = 1
      from public.entity_audit_events audit
      where audit.entity_type = 'hotel_stays'
        and audit.entity_id = included_stay_id
        and audit.request_id = included_change_request_id),
    null
  );

  -- Planned-checkout compatibility: start with check-in only, then create the
  -- checkout through the official Schedule RPC and add only the Stay event link.
  runtime_input := public.prepare_hotel_reservation_runtime_input_extended_internal(
    calendar_id, schedule_type_id,
    date '2094-05-10', time '15:00', false,
    null, null, null,
    false, timestamptz '2094-06-01 00:00:00+09',
    source_type.id, dog_id, customer_id, array[actor_id],
    'Planned checkout post-create QA'
  );
  stay_json := public.create_hotel_reservation_runtime_extended_internal(
    calendar_id, schedule_type_id, dog_id, source_type.id, array[actor_id],
    'Planned checkout post-create QA', actor_id,
    gen_random_uuid(), gen_random_uuid(), null,
    runtime_input, false
  );
  post_checkout_stay_id := (stay_json ->> 'id')::uuid;
  select capacity.id into post_checkout_capacity_id
  from public.hotel_capacity_reservations capacity
  where capacity.hotel_stay_id = post_checkout_stay_id
    and capacity.archived_at is null;

  post_checkout_schedule := public.create_operation_schedule(
    calendar_id, schedule_type_id,
    'Long Stay Extension · planned checkout compatibility',
    timestamptz '2094-05-20 11:00:00+09',
    timestamptz '2094-05-20 12:00:00+09',
    false, false, 'Planned checkout post-create QA',
    array[actor_id], array[customer_id], array[dog_id], gen_random_uuid()
  );
  insert into public.hotel_stay_schedule_events (
    hotel_stay_id, operation_schedule_id, event_kind, created_by, updated_by
  ) values (
    post_checkout_stay_id, (post_checkout_schedule ->> 'id')::uuid,
    'check_out', actor_id, actor_id
  );
  insert into long_stay_extension_qa_result values (
    'planned_checkout_post_create_graph',
    (select count(*) = 2
      and count(*) filter (where event_kind = 'check_in') = 1
      and count(*) filter (where event_kind = 'check_out') = 1
      from public.hotel_stay_schedule_events event
      where event.hotel_stay_id = post_checkout_stay_id
        and event.archived_at is null),
    null
  );

  select stay.version into stay_version
  from public.hotel_stays stay where stay.id = post_checkout_stay_id;
  perform public.assign_hotel_room(
    post_checkout_stay_id, stay_version, source_room.id,
    'Long Stay Extension post-create assignment', gen_random_uuid()
  );
  select stay.version into stay_version
  from public.hotel_stays stay where stay.id = post_checkout_stay_id;
  post_checkout_change_request_id := gen_random_uuid();
  stay_json := public.change_hotel_room_type_and_allocation_extended_internal(
    'before_check_in', post_checkout_stay_id, stay_version,
    target_room.id, target_type.id, target_type.code, target_room.name,
    timestamptz '2094-05-10 15:00:00+09',
    'Planned checkout post-create required-both contract',
    'Long Stay Extension planned checkout post-create QA', actor_id,
    post_checkout_change_request_id, array['check_in','check_out']::text[]
  );
  insert into long_stay_extension_qa_result values (
    'planned_checkout_post_create_cross_type',
    (stay_json ->> 'id')::uuid = post_checkout_stay_id
    and (select capacity.room_type_id = target_type.id
      from public.hotel_capacity_reservations capacity
      where capacity.id = post_checkout_capacity_id)
    and (select count(*) = 1
      from public.hotel_room_allocations allocation
      where allocation.capacity_reservation_id = post_checkout_capacity_id
        and allocation.room_id = target_room.id
        and allocation.archived_at is null)
    and (select count(*) = 2
      and count(*) filter (where event_kind = 'check_in') = 1
      and count(*) filter (where event_kind = 'check_out') = 1
      from public.hotel_stay_schedule_events event
      where event.hotel_stay_id = post_checkout_stay_id
        and event.archived_at is null)
    and (select count(*) = 1
      from public.entity_audit_events audit
      where audit.entity_type = 'hotel_stays'
        and audit.entity_id = post_checkout_stay_id
        and audit.request_id = post_checkout_change_request_id),
    null
  );
end;
$$;

select case when bool_and(passed)
  then 'HOTEL_INTERNAL_HELPER_LONG_STAY_EXTENSION_TRANSACTION_QA_READY'
  else 'STOP_HOTEL_INTERNAL_HELPER_LONG_STAY_EXTENSION_TRANSACTION_QA'
end as transaction_qa_status,
jsonb_agg(jsonb_build_object(
  'check', check_name, 'passed', passed, 'detail', detail
) order by check_name) as checks
from long_stay_extension_qa_result;

rollback;
