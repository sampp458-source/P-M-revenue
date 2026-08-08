begin read only;

select hotel_qa.assert_isolated_environment();

with latest_run as (
  select * from hotel_qa.runs
  where status in ('ready','running','completed')
  order by created_at desc limit 1
), expected as (
  select * from (values
    ('extension_room_competition'::text, '23P01'::text),
    ('extension_type_capacity_competition', '23514'),
    ('extension_version_competition', '40001'),
    ('ordinary_type_capacity_regression', '23514')
  ) expected(scenario_code, expected_failure_state)
), scenario_result as (
  select
    expected.scenario_code,
    count(result.*)::integer as session_count,
    count(*) filter (where result.succeeded)::integer as success_count,
    count(*) filter (
      where not result.succeeded and result.sqlstate=expected.expected_failure_state
    )::integer as expected_failure_count,
    count(*) filter (where result.sqlstate='40P01')::integer as deadlock_count,
    array_agg(coalesce(result.sqlstate,'SUCCESS') order by result.session_code) as outcomes
  from expected
  cross join latest_run run
  left join hotel_qa.session_results result
    on result.run_id=run.id and result.scenario_code=expected.scenario_code
  group by expected.scenario_code,expected.expected_failure_state
)
select
  scenario_code,
  session_count,
  success_count,
  expected_failure_count,
  deadlock_count,
  outcomes,
  session_count=2 and success_count=1 and expected_failure_count=1 and deadlock_count=0 as passed
from scenario_result
order by scenario_code;

with latest_run as (
  select * from hotel_qa.runs
  where status in ('ready','running','completed')
  order by created_at desc limit 1
), fixture_stays as (
  select fixture.fixture_key,fixture.hotel_stay_id
  from hotel_qa.fixtures fixture join latest_run run on run.id=fixture.run_id
  where fixture.hotel_stay_id is not null
), aggregate_contract as (
  select
    fixture.fixture_key,
    fixture.hotel_stay_id,
    count(distinct capacity.id) filter(where capacity.archived_at is null) active_capacity_count,
    count(distinct event.id) filter(where event.archived_at is null) active_event_count
  from fixture_stays fixture
  join public.hotel_stays stay on stay.id=fixture.hotel_stay_id and stay.archived_at is null
  left join public.hotel_capacity_reservations capacity on capacity.hotel_stay_id=stay.id
  left join public.hotel_stay_schedule_events event on event.hotel_stay_id=stay.id
  group by fixture.fixture_key,fixture.hotel_stay_id
), room_conflicts as (
  select count(*)::integer conflict_count
  from public.hotel_room_allocations left_allocation
  join public.hotel_room_allocations right_allocation
    on right_allocation.room_id=left_allocation.room_id
   and right_allocation.id>left_allocation.id
   and right_allocation.archived_at is null
   and right_allocation.allocated_from<left_allocation.allocated_until
   and right_allocation.allocated_until>left_allocation.allocated_from
  join public.hotel_capacity_reservations left_capacity on left_capacity.id=left_allocation.capacity_reservation_id
  join public.hotel_capacity_reservations right_capacity on right_capacity.id=right_allocation.capacity_reservation_id
  join fixture_stays left_fixture on left_fixture.hotel_stay_id=left_capacity.hotel_stay_id
  join fixture_stays right_fixture on right_fixture.hotel_stay_id=right_capacity.hotel_stay_id
  where left_allocation.archived_at is null
    and left_capacity.archived_at is null and right_capacity.archived_at is null
), endpoints as (
  select capacity.reserved_from instant
  from public.hotel_capacity_reservations capacity
  join fixture_stays fixture on fixture.hotel_stay_id=capacity.hotel_stay_id
  where capacity.archived_at is null
  union
  select capacity.reserved_until-interval '1 microsecond'
  from public.hotel_capacity_reservations capacity
  join fixture_stays fixture on fixture.hotel_stay_id=capacity.hotel_stay_id
  where capacity.archived_at is null
), active_room_counts as (
  select room_type_id,count(*)::integer room_count
  from public.hotel_rooms where is_active and archived_at is null group by room_type_id
), type_overflow as (
  select count(*)::integer overflow_count
  from endpoints endpoint cross join active_room_counts rooms
  where (select count(*) from public.hotel_capacity_reservations capacity
    where capacity.archived_at is null and capacity.room_type_id=rooms.room_type_id
      and capacity.reserved_from<=endpoint.instant and capacity.reserved_until>endpoint.instant
  )>rooms.room_count
), total_overflow as (
  select count(*)::integer overflow_count
  from endpoints endpoint
  where (select count(*) from public.hotel_capacity_reservations capacity
    where capacity.archived_at is null
      and capacity.reserved_from<=endpoint.instant and capacity.reserved_until>endpoint.instant
  )>(select count(*) from public.hotel_rooms where is_active and archived_at is null)
), scenario_contract as (
  select
    count(distinct scenario_code) filter(where scenario_code in(
      'extension_room_competition','extension_type_capacity_competition',
      'extension_version_competition','ordinary_type_capacity_regression'
    ))::integer scenario_count,
    count(*) filter(where sqlstate='40P01')::integer deadlock_count
  from hotel_qa.session_results result join latest_run run on run.id=result.run_id
), failure_state as (
  select
    (select room_type.code from hotel_qa.fixtures fixture
      join public.hotel_capacity_reservations capacity on capacity.hotel_stay_id=fixture.hotel_stay_id and capacity.archived_at is null
      join public.hotel_room_types room_type on room_type.id=capacity.room_type_id
      join latest_run run on run.id=fixture.run_id
      where fixture.fixture_key='ext_room_b')='STANDARD' as room_loser_rolled_back,
    (select room_type.code from hotel_qa.fixtures fixture
      join public.hotel_capacity_reservations capacity on capacity.hotel_stay_id=fixture.hotel_stay_id and capacity.archived_at is null
      join public.hotel_room_types room_type on room_type.id=capacity.room_type_id
      join latest_run run on run.id=fixture.run_id
      where fixture.fixture_key='ext_capacity_b')='STANDARD' as capacity_loser_rolled_back,
    (select capacity.room_type_id is null from hotel_qa.fixtures fixture
      join public.hotel_capacity_reservations capacity on capacity.hotel_stay_id=fixture.hotel_stay_id and capacity.archived_at is null
      join latest_run run on run.id=fixture.run_id
      where fixture.fixture_key='race_type_candidate_a') as ordinary_loser_rolled_back
)
select
  (select count(*) from aggregate_contract
    where active_capacity_count<>1
       or active_event_count<>case when fixture_key like 'ext_%' then 1 else 2 end) as broken_aggregate_count,
  (select conflict_count from room_conflicts) room_conflict_count,
  (select overflow_count from type_overflow) type_capacity_overflow_count,
  (select overflow_count from total_overflow) total_capacity_overflow_count,
  scenario_contract.deadlock_count,
  failure_state.room_loser_rolled_back,
  failure_state.capacity_loser_rolled_back,
  failure_state.ordinary_loser_rolled_back,
  case
    when scenario_contract.scenario_count<>4 then 'WAITING_FOR_EXTENSION_SCENARIOS'
    when scenario_contract.deadlock_count<>0 then 'FAILED_DEADLOCK_DETECTED'
    when exists(select 1 from aggregate_contract
      where active_capacity_count<>1
         or active_event_count<>case when fixture_key like 'ext_%' then 1 else 2 end)
      then 'FAILED_AGGREGATE_CONTRACT'
    when (select conflict_count from room_conflicts)<>0 then 'FAILED_ROOM_CONFLICT_REMAINED'
    when (select overflow_count from type_overflow)<>0 then 'FAILED_TYPE_CAPACITY_OVERFLOW'
    when (select overflow_count from total_overflow)<>0 then 'FAILED_TOTAL_CAPACITY_OVERFLOW'
    when not failure_state.room_loser_rolled_back
      or not failure_state.capacity_loser_rolled_back
      or not failure_state.ordinary_loser_rolled_back
      then 'FAILED_LOSER_MUTATION_REMAINED'
    else 'HOTEL_INTERNAL_HELPER_LONG_STAY_EXTENSION_2SESSION_INTEGRITY_READY'
  end as integrity_status
from scenario_contract cross join failure_state;

rollback;
