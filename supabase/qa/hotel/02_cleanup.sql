-- ISOLATED QA DATABASE ONLY. Soft-archives every persisted object registered by the open run.
begin;

select hotel_qa.assert_isolated_environment();

do $$
declare
  qa_run hotel_qa.runs%rowtype;
  fixture_row record;
  schedule_row record;
  actor_id uuid;
  archive_time timestamptz := clock_timestamp();
  cleanup_reason text := '격리 Hotel QA Fixture 정리';
  root_request_id uuid;
begin
  perform hotel_qa.assert_isolated_environment();

  select * into qa_run
  from hotel_qa.runs run
  where run.status in ('ready', 'running', 'completed', 'failed')
  order by run.created_at desc
  limit 1
  for update;

  if not found then
    raise exception 'STOP_NO_OPEN_HOTEL_QA_RUN';
  end if;

  actor_id := qa_run.actor_profile_id;
  perform set_config('request.jwt.claim.sub', actor_id::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', actor_id, 'role', 'authenticated')::text,
    true
  );

  -- Capture successful race-created stays by their pre-registered request IDs.
  update hotel_qa.fixtures fixture
  set hotel_stay_id = stay.id
  from public.hotel_stays stay
  where fixture.run_id = qa_run.id
    and fixture.hotel_stay_id is null
    and fixture.request_id = stay.request_id;

  for fixture_row in
    select distinct fixture.hotel_stay_id
    from hotel_qa.fixtures fixture
    where fixture.run_id = qa_run.id
      and fixture.hotel_stay_id is not null
  loop
    for schedule_row in
      select schedule.id, schedule.version
      from public.hotel_stay_schedule_events event
      join public.operation_schedules schedule
        on schedule.id = event.operation_schedule_id
      where event.hotel_stay_id = fixture_row.hotel_stay_id
        and event.archived_at is null
        and schedule.archived_at is null
      order by event.event_kind
    loop
      perform public.archive_operation_schedule(
        schedule_row.id,
        schedule_row.version,
        cleanup_reason,
        gen_random_uuid()
      );
    end loop;

    perform set_config('app.operation_change_reason', cleanup_reason, true);
    perform set_config('app.operation_request_id', '', true);

    update public.hotel_room_allocations allocation
    set archived_at = archive_time,
        archived_by = actor_id,
        archive_reason = cleanup_reason,
        updated_by = actor_id
    from public.hotel_capacity_reservations capacity
    where capacity.hotel_stay_id = fixture_row.hotel_stay_id
      and allocation.capacity_reservation_id = capacity.id
      and allocation.archived_at is null;

    update public.hotel_capacity_reservations capacity
    set archived_at = archive_time,
        archived_by = actor_id,
        archive_reason = cleanup_reason,
        updated_by = actor_id
    where capacity.hotel_stay_id = fixture_row.hotel_stay_id
      and capacity.archived_at is null;

    update public.hotel_stay_schedule_events event
    set archived_at = archive_time,
        archived_by = actor_id,
        archive_reason = cleanup_reason,
        updated_by = actor_id
    where event.hotel_stay_id = fixture_row.hotel_stay_id
      and event.archived_at is null;

    root_request_id := gen_random_uuid();
    perform set_config('app.operation_request_id', root_request_id::text, true);
    update public.hotel_stays stay
    set archived_at = archive_time,
        archived_by = actor_id,
        archive_reason = cleanup_reason,
        updated_by = actor_id
    where stay.id = fixture_row.hotel_stay_id
      and stay.archived_at is null;

    if not exists (
      select 1
      from public.entity_audit_events audit
      where audit.module_code = 'hotel_operations'
        and audit.entity_type = 'hotel_stays'
        and audit.entity_id = fixture_row.hotel_stay_id
        and audit.request_id = root_request_id
    ) then
      raise exception 'STOP_HOTEL_QA_CLEANUP_ROOT_AUDIT_MISSING';
    end if;
  end loop;

  update hotel_qa.runs
  set status = 'cleaned', cleaned_at = archive_time
  where id = qa_run.id;
end;
$$;

commit;

with target_run as (
  select run.*
  from hotel_qa.runs run
  where run.status = 'cleaned'
  order by run.cleaned_at desc
  limit 1
), target_fixtures as (
  select fixture.*
  from hotel_qa.fixtures fixture
  join target_run run on run.id = fixture.run_id
), target_stays as (
  select stay.id
  from public.hotel_stays stay
  where stay.id in (
    select fixture.hotel_stay_id
    from target_fixtures fixture
    where fixture.hotel_stay_id is not null
  )
  union
  select stay.id
  from public.hotel_stays stay
  where stay.request_id in (
    select fixture.request_id
    from target_fixtures fixture
    where fixture.request_id is not null
  )
), target_capacities as (
  select capacity.id
  from public.hotel_capacity_reservations capacity
  where capacity.hotel_stay_id in (select stay.id from target_stays stay)
), target_allocations as (
  select allocation.id
  from public.hotel_room_allocations allocation
  where allocation.capacity_reservation_id in (
    select capacity.id from target_capacities capacity
  )
), target_events as (
  select event.id, event.operation_schedule_id
  from public.hotel_stay_schedule_events event
  where event.hotel_stay_id in (select stay.id from target_stays stay)
), cleanup_counts as (
  select
    (select count(*) from public.hotel_stays stay
      where stay.id in (select target.id from target_stays target)
        and stay.archived_at is null) as active_fixture_stay_count,
    (select count(*) from public.hotel_capacity_reservations capacity
      where capacity.id in (select target.id from target_capacities target)
        and capacity.archived_at is null) as active_capacity_count,
    (select count(*) from public.hotel_room_allocations allocation
      where allocation.id in (select target.id from target_allocations target)
        and allocation.archived_at is null) as active_allocation_count,
    (select count(*) from public.hotel_stay_schedule_events event
      where event.id in (select target.id from target_events target)
        and event.archived_at is null) as active_event_link_count,
    (select count(*) from public.operation_schedules schedule
      where schedule.id in (
        select event.operation_schedule_id from target_events event
      ) and schedule.archived_at is null) as active_schedule_count,
    (select count(*) from public.hotel_stays stay
      where stay.id in (
        select fixture.hotel_stay_id
        from target_fixtures fixture
        where fixture.hotel_stay_id is not null
      ) and stay.archived_at is null) as fixture_id_unexpected_object_count,
    (select count(*) from public.hotel_stays stay
      where stay.request_id in (
        select fixture.request_id
        from target_fixtures fixture
        where fixture.request_id is not null
      ) and stay.archived_at is null) as fixture_request_id_unexpected_object_count,
    (select count(*) from public.entity_audit_events audit
      where audit.entity_id in (select stay.id from target_stays stay))
      as immutable_audit_count
)
select
  case
    when counts.active_fixture_stay_count = 0
      and counts.active_capacity_count = 0
      and counts.active_allocation_count = 0
      and counts.active_event_link_count = 0
      and counts.active_schedule_count = 0
      and counts.fixture_id_unexpected_object_count = 0
      and counts.fixture_request_id_unexpected_object_count = 0
      and run.status = 'cleaned'
    then 'HOTEL_QA_CLEANUP_READY'
    else 'HOTEL_QA_CLEANUP_FAILED'
  end as cleanup_status,
  run.id as qa_run_id,
  run.cleaned_at,
  counts.*
from target_run run
cross join cleanup_counts counts;
