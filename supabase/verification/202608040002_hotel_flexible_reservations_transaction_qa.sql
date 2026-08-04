-- Hotel flexible reservation transaction QA.
-- The entire probe is rolled back and leaves no permanent rows.

begin;

create temporary table hotel_flexible_transaction_qa_result (
  identical_request_replayed boolean not null,
  replay_mutation_free boolean not null,
  different_payload_rejected boolean not null,
  schedule_version_incremented boolean not null,
  schedule_time_confirmed boolean not null,
  calendar_audit_created boolean not null,
  stay_root_audit_exactly_one boolean not null,
  failed_call_raised boolean not null,
  failed_capacity_rolled_back boolean not null,
  failed_allocation_rolled_back boolean not null,
  failed_schedule_rolled_back boolean not null,
  failed_stay_rolled_back boolean not null,
  failed_audit_rolled_back boolean not null
) on commit drop;

-- QA 트랜잭션 안에서만 존재하는 실패 주입 장치다. 두 번째 Stay의 최종
-- UPDATE에서 예외를 발생시켜, 그 전에 수행된 Capacity/Allocation/Schedule/Audit
-- 변경이 PL/pgSQL 하위 트랜잭션과 함께 원자적으로 복원되는지 검증한다.
create function pg_temp.fail_hotel_flexible_transaction_qa()
returns trigger
language plpgsql
as $$
begin
  if new.id = nullif(
    current_setting('app.hotel_flexible_qa_fail_stay_id', true), ''
  )::uuid then
    raise exception 'HOTEL_FLEXIBLE_TRANSACTION_QA_INJECTED_FAILURE'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger hotel_flexible_transaction_qa_failure
before update on public.hotel_stays
for each row
execute function pg_temp.fail_hotel_flexible_transaction_qa();

do $$
declare
  actor_id uuid;
  dog_id uuid;
  customer_id uuid;
  calendar_id uuid;
  schedule_type_id uuid;
  room_type_id uuid;
  room_id uuid;
  base_date date := (now() at time zone 'Asia/Seoul')::date + 20000;
  first_create_request uuid := gen_random_uuid();
  first_check_in_request uuid := gen_random_uuid();
  second_create_request uuid := gen_random_uuid();
  first_stay jsonb;
  replayed_first_stay jsonb;
  second_stay jsonb;
  first_stay_id uuid;
  second_stay_id uuid;
  first_check_in_schedule_id uuid;
  second_capacity_id uuid;
  first_schedule_version_before integer;
  first_schedule_version_after integer;
  first_replay_fingerprint_before text;
  first_replay_fingerprint_after text;
  first_replay_audit_count_before bigint;
  first_replay_audit_count_after bigint;
  second_stay_version_before integer;
  second_stay_before jsonb;
  second_capacity_before jsonb;
  second_schedule_fingerprint_before text;
  second_schedule_fingerprint_after text;
  second_audit_count_before bigint;
  second_audit_count_after bigint;
  failed_call_raised boolean := false;
  different_payload_rejected boolean := false;
  replay_mutation_free boolean := false;
begin
  select membership.profile_id
  into actor_id
  from public.operation_memberships membership
  join public.profiles profile on profile.id = membership.profile_id
  where membership.role = 'owner'
    and membership.is_active
    and profile.is_active
    and profile.account_status = 'active'
  order by membership.updated_at, membership.profile_id
  limit 1;

  select dog.id, customer.id
  into dog_id, customer_id
  from public.dogs dog
  join public.customers customer on customer.id = dog.customer_id
  where dog.is_active and customer.is_active
  order by dog.created_at, dog.id
  limit 1;

  select calendar.id, mapping.schedule_type_id
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
  where calendar.is_active
    and unit.is_active
    and unit.code = 'hotel'
  order by calendar.sort_order, schedule_type.sort_order
  limit 1;

  select room_type.id, room.id
  into room_type_id, room_id
  from public.hotel_room_types room_type
  join public.hotel_rooms room on room.room_type_id = room_type.id
  where room_type.is_active and room_type.archived_at is null
    and room.is_active and room.archived_at is null
  order by room_type.sort_order, room.sort_order, room.name
  limit 1;

  if actor_id is null or dog_id is null or customer_id is null
    or calendar_id is null or schedule_type_id is null
    or room_type_id is null or room_id is null then
    raise exception 'Transaction QA에 필요한 활성 Owner, 반려견, Hotel Calendar 또는 호실이 없습니다.';
  end if;

  perform set_config('request.jwt.claim.sub', actor_id::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', actor_id::text, 'role', 'authenticated')::text,
    true
  );

  first_stay := public.create_flexible_hotel_reservation(
    calendar_id, schedule_type_id,
    base_date, null, true,
    base_date + 1, null, true,
    null, dog_id, customer_id, array[actor_id],
    'rollback-only transaction QA', first_create_request
  );
  first_stay_id := (first_stay ->> 'id')::uuid;

  select md5(concat_ws('|',
    (select to_jsonb(stay)::text
     from public.hotel_stays stay
     where stay.id = first_stay_id),
    (select coalesce(jsonb_agg(to_jsonb(capacity) order by capacity.id), '[]'::jsonb)::text
     from public.hotel_capacity_reservations capacity
     where capacity.hotel_stay_id = first_stay_id),
    (select coalesce(jsonb_agg(to_jsonb(event) order by event.id), '[]'::jsonb)::text
     from public.hotel_stay_schedule_events event
     where event.hotel_stay_id = first_stay_id),
    (select coalesce(jsonb_agg(to_jsonb(schedule) order by schedule.id), '[]'::jsonb)::text
     from public.hotel_stay_schedule_events event
     join public.operation_schedules schedule
       on schedule.id = event.operation_schedule_id
     where event.hotel_stay_id = first_stay_id)
  )) into first_replay_fingerprint_before;

  select count(*)
  into first_replay_audit_count_before
  from public.entity_audit_events audit
  where audit.entity_id = first_stay_id
     or audit.entity_id in (
       select event.id
       from public.hotel_stay_schedule_events event
       where event.hotel_stay_id = first_stay_id
     )
     or audit.entity_id in (
       select event.operation_schedule_id
       from public.hotel_stay_schedule_events event
       where event.hotel_stay_id = first_stay_id
     )
     or audit.entity_id in (
       select capacity.id
       from public.hotel_capacity_reservations capacity
       where capacity.hotel_stay_id = first_stay_id
     );

  replayed_first_stay := public.create_flexible_hotel_reservation(
    calendar_id, schedule_type_id,
    base_date, time '19:30', true,
    base_date + 1, time '08:15', true,
    null, dog_id, customer_id, array[actor_id],
    'rollback-only transaction QA', first_create_request
  );

  select md5(concat_ws('|',
    (select to_jsonb(stay)::text
     from public.hotel_stays stay
     where stay.id = first_stay_id),
    (select coalesce(jsonb_agg(to_jsonb(capacity) order by capacity.id), '[]'::jsonb)::text
     from public.hotel_capacity_reservations capacity
     where capacity.hotel_stay_id = first_stay_id),
    (select coalesce(jsonb_agg(to_jsonb(event) order by event.id), '[]'::jsonb)::text
     from public.hotel_stay_schedule_events event
     where event.hotel_stay_id = first_stay_id),
    (select coalesce(jsonb_agg(to_jsonb(schedule) order by schedule.id), '[]'::jsonb)::text
     from public.hotel_stay_schedule_events event
     join public.operation_schedules schedule
       on schedule.id = event.operation_schedule_id
     where event.hotel_stay_id = first_stay_id)
  )) into first_replay_fingerprint_after;

  select count(*)
  into first_replay_audit_count_after
  from public.entity_audit_events audit
  where audit.entity_id = first_stay_id
     or audit.entity_id in (
       select event.id
       from public.hotel_stay_schedule_events event
       where event.hotel_stay_id = first_stay_id
     )
     or audit.entity_id in (
       select event.operation_schedule_id
       from public.hotel_stay_schedule_events event
       where event.hotel_stay_id = first_stay_id
     )
     or audit.entity_id in (
       select capacity.id
       from public.hotel_capacity_reservations capacity
       where capacity.hotel_stay_id = first_stay_id
     );

  replay_mutation_free := first_replay_fingerprint_after
      = first_replay_fingerprint_before
    and first_replay_audit_count_after = first_replay_audit_count_before;

  begin
    perform public.create_flexible_hotel_reservation(
      calendar_id, schedule_type_id,
      base_date, null, true,
      base_date + 1, null, true,
      null, dog_id, customer_id, array[actor_id],
      'different replay payload', first_create_request
    );
  exception
    when unique_violation then
      different_payload_rejected := true;
  end;

  select event.operation_schedule_id, schedule.version
  into first_check_in_schedule_id, first_schedule_version_before
  from public.hotel_stay_schedule_events event
  join public.operation_schedules schedule
    on schedule.id = event.operation_schedule_id
  where event.hotel_stay_id = first_stay_id
    and event.event_kind = 'check_in'
    and event.archived_at is null;

  perform public.finalize_and_complete_hotel_check_in(
    first_stay_id,
    (first_stay ->> 'version')::integer,
    (base_date::timestamp + time '15:00') at time zone 'Asia/Seoul',
    room_type_id,
    room_id,
    first_check_in_request
  );

  select schedule.version
  into first_schedule_version_after
  from public.operation_schedules schedule
  where schedule.id = first_check_in_schedule_id;

  second_stay := public.create_flexible_hotel_reservation(
    calendar_id, schedule_type_id,
    base_date + 10, null, true,
    base_date + 11, null, true,
    null, dog_id, customer_id, array[actor_id],
    'rollback-only failure QA', second_create_request
  );
  second_stay_id := (second_stay ->> 'id')::uuid;

  select capacity.id, to_jsonb(capacity)
  into second_capacity_id, second_capacity_before
  from public.hotel_capacity_reservations capacity
  where capacity.hotel_stay_id = second_stay_id
    and capacity.archived_at is null;

  select stay.version
  into second_stay_version_before
  from public.hotel_stays stay
  where stay.id = second_stay_id;

  select to_jsonb(stay)
  into second_stay_before
  from public.hotel_stays stay
  where stay.id = second_stay_id;

  select md5(coalesce(jsonb_agg(to_jsonb(schedule) order by schedule.id), '[]'::jsonb)::text)
  into second_schedule_fingerprint_before
  from public.hotel_stay_schedule_events event
  join public.operation_schedules schedule
    on schedule.id = event.operation_schedule_id
  where event.hotel_stay_id = second_stay_id;

  select count(*)
  into second_audit_count_before
  from public.entity_audit_events audit
  where audit.entity_id = second_stay_id
     or audit.entity_id = second_capacity_id
     or audit.entity_id in (
       select event.id
       from public.hotel_stay_schedule_events event
       where event.hotel_stay_id = second_stay_id
     )
     or audit.entity_id in (
       select event.operation_schedule_id
       from public.hotel_stay_schedule_events event
       where event.hotel_stay_id = second_stay_id
     )
     or (
       audit.entity_type = 'hotel_room_allocations'
       and audit.after_data ->> 'capacity_reservation_id' = second_capacity_id::text
     );

  perform set_config(
    'app.hotel_flexible_qa_fail_stay_id', second_stay_id::text, true
  );

  begin
    perform public.finalize_and_complete_hotel_check_in(
      second_stay_id,
      second_stay_version_before,
      ((base_date + 10)::timestamp + time '15:00') at time zone 'Asia/Seoul',
      room_type_id,
      room_id,
      gen_random_uuid()
    );
  exception
    when sqlstate 'P0001' then
      if sqlerrm = 'HOTEL_FLEXIBLE_TRANSACTION_QA_INJECTED_FAILURE' then
        failed_call_raised := true;
      else
        raise;
      end if;
  end;
  perform set_config('app.hotel_flexible_qa_fail_stay_id', '', true);

  select md5(coalesce(jsonb_agg(to_jsonb(schedule) order by schedule.id), '[]'::jsonb)::text)
  into second_schedule_fingerprint_after
  from public.hotel_stay_schedule_events event
  join public.operation_schedules schedule
    on schedule.id = event.operation_schedule_id
  where event.hotel_stay_id = second_stay_id;

  select count(*)
  into second_audit_count_after
  from public.entity_audit_events audit
  where audit.entity_id = second_stay_id
     or audit.entity_id = second_capacity_id
     or audit.entity_id in (
       select event.id
       from public.hotel_stay_schedule_events event
       where event.hotel_stay_id = second_stay_id
     )
     or audit.entity_id in (
       select event.operation_schedule_id
       from public.hotel_stay_schedule_events event
       where event.hotel_stay_id = second_stay_id
     )
     or (
       audit.entity_type = 'hotel_room_allocations'
       and audit.after_data ->> 'capacity_reservation_id' = second_capacity_id::text
     );

  insert into hotel_flexible_transaction_qa_result
  select
    (replayed_first_stay ->> 'id')::uuid = first_stay_id,
    replay_mutation_free,
    different_payload_rejected,
    first_schedule_version_after = first_schedule_version_before + 1,
    exists (
      select 1 from public.operation_schedules schedule
      where schedule.id = first_check_in_schedule_id
        and not schedule.time_unspecified
    ),
    exists (
      select 1 from public.entity_audit_events audit
      where audit.module_code = 'operations'
        and audit.entity_type = 'operation_schedules'
        and audit.entity_id = first_check_in_schedule_id
        and audit.action = 'updated'
    ),
    (
      select count(*) = 1
      from public.entity_audit_events audit
      where audit.module_code = 'hotel_operations'
        and audit.entity_type = 'hotel_stays'
        and audit.entity_id = first_stay_id
        and audit.request_id = first_check_in_request
    ),
    failed_call_raised,
    exists (
      select 1 from public.hotel_capacity_reservations capacity
      where capacity.id = second_capacity_id
        and to_jsonb(capacity) = second_capacity_before
    ),
    not exists (
      select 1 from public.hotel_room_allocations allocation
      where allocation.capacity_reservation_id = second_capacity_id
        and allocation.archived_at is null
    ),
    second_schedule_fingerprint_after = second_schedule_fingerprint_before,
    exists (
      select 1 from public.hotel_stays stay
      where stay.id = second_stay_id
        and to_jsonb(stay) = second_stay_before
    ),
    second_audit_count_after = second_audit_count_before;
end;
$$;

select
  case
    when identical_request_replayed
      and replay_mutation_free
      and different_payload_rejected
      and schedule_version_incremented
      and schedule_time_confirmed
      and calendar_audit_created
      and stay_root_audit_exactly_one
      and failed_call_raised
      and failed_capacity_rolled_back
      and failed_allocation_rolled_back
      and failed_schedule_rolled_back
      and failed_stay_rolled_back
      and failed_audit_rolled_back
      then 'HOTEL_FLEXIBLE_TRANSACTION_QA_READY'
    else 'FAILED_HOTEL_FLEXIBLE_TRANSACTION_QA'
  end as transaction_qa_status,
  result.*
from hotel_flexible_transaction_qa_result result;

rollback;
