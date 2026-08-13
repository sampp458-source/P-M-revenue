begin;
select hotel_qa.assert_isolated_environment();
create temporary table cleanup_context as select * from hotel_qa.hotel_lifecycle_2session_context;
create temporary table cleanup_stays as select stay_id id from cleanup_context;
create temporary table cleanup_events as select id,operation_schedule_id from public.hotel_stay_schedule_events where hotel_stay_id in(select id from cleanup_stays);
create temporary table cleanup_schedules as select distinct operation_schedule_id id from cleanup_events;
create temporary table cleanup_capacities as select id from public.hotel_capacity_reservations where hotel_stay_id in(select id from cleanup_stays);
create temporary table cleanup_allocations as select id from public.hotel_room_allocations where capacity_reservation_id in(select id from cleanup_capacities);
create temporary table cleanup_entities as
select customer_id id from cleanup_context union select dog_id from cleanup_context
union select id from cleanup_stays union select id from cleanup_events union select id from cleanup_schedules
union select id from cleanup_capacities union select id from cleanup_allocations;
do $guard$
begin
  if (select count(*) from cleanup_context)<>1 or (select count(*) from cleanup_stays)<>1
    or (select count(*) from cleanup_events)<>2 or (select count(*) from cleanup_capacities)<>1
    or (select count(*) from cleanup_allocations)<>1 then
    raise exception 'STOP_HOTEL_LIFECYCLE_2SESSION_CLEANUP_ALLOWLIST';
  end if;
end;
$guard$;
set local session_replication_role=replica;
delete from public.entity_audit_events where entity_id in(select id from cleanup_entities)
  or request_id in(select request_a from cleanup_context union select request_b from cleanup_context);
delete from public.hotel_planned_checkout_requests
  where hotel_stay_id in(select id from cleanup_stays);
delete from public.hotel_room_allocations where id in(select id from cleanup_allocations);
delete from public.hotel_capacity_reservations where id in(select id from cleanup_capacities);
delete from public.hotel_stay_schedule_events where id in(select id from cleanup_events);
delete from public.operation_schedule_assignees where schedule_id in(select id from cleanup_schedules);
delete from public.operation_schedule_dogs where schedule_id in(select id from cleanup_schedules);
delete from public.operation_schedule_customers where schedule_id in(select id from cleanup_schedules);
delete from public.operation_schedules where id in(select id from cleanup_schedules);
delete from public.hotel_stays where id in(select id from cleanup_stays);
delete from public.dogs where id=(select dog_id from cleanup_context);
delete from public.customers where id=(select customer_id from cleanup_context);
delete from public.entity_audit_events where entity_id in(select id from cleanup_entities);
set local session_replication_role=origin;
drop table hotel_qa.hotel_lifecycle_2session_results;
drop table hotel_qa.hotel_lifecycle_2session_context;
do $post$
begin
  if exists(select 1 from public.customers where name='Hotel Lifecycle Two Session QA')
    or exists(select 1 from public.dogs where name='Hotel Lifecycle Two Session QA')
    or exists(select 1 from public.hotel_stays where id in(select id from cleanup_stays))
    or exists(select 1 from public.hotel_planned_checkout_requests where hotel_stay_id in(select id from cleanup_stays))
    or exists(select 1 from public.entity_audit_events where entity_id in(select id from cleanup_entities)) then
    raise exception 'STOP_HOTEL_LIFECYCLE_2SESSION_CLEANUP_RESIDUE';
  end if;
end;
$post$;
select 'HOTEL_LIFECYCLE_2SESSION_CLEANUP_READY' status,0 fixture_residue,0 replay_residue,0 audit_residue;
commit;
