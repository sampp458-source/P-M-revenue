-- ISOLATED QA DATABASE ONLY. All fixtures, fault triggers and mutations rollback.
begin;
select hotel_qa.assert_isolated_environment();

create temporary table unassigned_shared_qa_result(
  check_name text primary key,
  passed boolean not null,
  detail text
) on commit drop;

create function pg_temp.unassigned_shared_counts()
returns jsonb language sql as $$
  select jsonb_build_object(
    'families',(select count(*) from public.family_bookings),
    'members',(select count(*) from public.family_booking_members),
    'stays',(select count(*) from public.hotel_stays),
    'events',(select count(*) from public.hotel_stay_schedule_events),
    'groups',(select count(*) from public.family_shared_room_groups),
    'capacities',(select count(*) from public.hotel_capacity_reservations),
    'occupancies',(select count(*) from public.hotel_physical_occupancies),
    'occupancyMembers',(select count(*) from public.hotel_physical_occupancy_members),
    'allocations',(select count(*) from public.hotel_room_allocations),
    'requests',(select count(*) from public.hotel_physical_occupancy_requests),
    'audits',(select count(*) from public.entity_audit_events)
  );
$$;

create function pg_temp.unassigned_shared_members(
  p_dog_ids uuid[], p_actor_id uuid, p_calendar_id uuid,
  p_schedule_type_id uuid, p_room_type_id uuid,
  p_check_in date, p_check_out date
)
returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object(
    'stableMemberKey','dog-'||dog_id::text,
    'dogId',dog_id,
    'serviceType','hotel',
    'assigneeIds',jsonb_build_array(p_actor_id),
    'memo','Unassigned Shared QA',
    'sharedRoomGroupKey','unassigned-shared',
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

create function pg_temp.fail_unassigned_shared_stage()
returns trigger language plpgsql as $$
declare stage text := current_setting('app.unassigned_shared_qa_stage',true);
begin
  if stage='family' and tg_table_name='family_bookings'
    or stage='member' and tg_table_name='family_booking_members'
    or stage='stay' and tg_table_name='hotel_stays'
    or stage='schedule' and tg_table_name='operation_schedules'
    or stage='group' and tg_table_name='family_shared_room_groups'
    or stage='shared_capacity' and tg_table_name='hotel_capacity_reservations'
      and tg_op='INSERT' and to_jsonb(new)->>'source_kind'='shared_group'
    or stage='occupancy' and tg_table_name='hotel_physical_occupancies'
    or stage='occupancy_member' and tg_table_name='hotel_physical_occupancy_members'
    or stage='capacity_transition' and tg_table_name='hotel_capacity_reservations'
      and tg_op='UPDATE' and to_jsonb(old)->>'source_kind'='shared_group'
      and to_jsonb(new)->>'source_kind'='shared_occupancy'
    or stage='allocation_before' and tg_table_name='hotel_room_allocations'
      and tg_when='BEFORE'
    or stage='allocation_after' and tg_table_name='hotel_room_allocations'
      and tg_when='AFTER'
    or stage='audit' and tg_table_name='entity_audit_events'
      and to_jsonb(new)->>'change_reason' in (
        '미배정 함께 투숙 예약 생성','다견 DELUXE 공유 객실 배정'
      )
  then
    raise exception 'unassigned_shared_qa_injected_failure:%',stage
      using errcode='P0001';
  end if;
  return new;
end;
$$;

create trigger unassigned_qa_family after insert on public.family_bookings
for each row execute function pg_temp.fail_unassigned_shared_stage();
create trigger unassigned_qa_member after insert on public.family_booking_members
for each row execute function pg_temp.fail_unassigned_shared_stage();
create trigger unassigned_qa_stay after insert on public.hotel_stays
for each row execute function pg_temp.fail_unassigned_shared_stage();
create trigger unassigned_qa_schedule after insert on public.operation_schedules
for each row execute function pg_temp.fail_unassigned_shared_stage();
create trigger unassigned_qa_group after insert on public.family_shared_room_groups
for each row execute function pg_temp.fail_unassigned_shared_stage();
create trigger unassigned_qa_capacity after insert or update on public.hotel_capacity_reservations
for each row execute function pg_temp.fail_unassigned_shared_stage();
create trigger unassigned_qa_occupancy after insert on public.hotel_physical_occupancies
for each row execute function pg_temp.fail_unassigned_shared_stage();
create trigger unassigned_qa_occupancy_member after insert on public.hotel_physical_occupancy_members
for each row execute function pg_temp.fail_unassigned_shared_stage();
create trigger unassigned_qa_allocation_before before insert on public.hotel_room_allocations
for each row execute function pg_temp.fail_unassigned_shared_stage();
create trigger unassigned_qa_allocation_after after insert on public.hotel_room_allocations
for each row execute function pg_temp.fail_unassigned_shared_stage();
create trigger unassigned_qa_audit before insert on public.entity_audit_events
for each row execute function pg_temp.fail_unassigned_shared_stage();

do $$
declare
  actor_id uuid;
  customer_id uuid;
  dog_ids uuid[];
  calendar_id uuid;
  schedule_type_id uuid;
  deluxe_type_id uuid;
  deluxe_room_ids uuid[];
  standard_type_id uuid;
  members jsonb;
  result jsonb;
  replay jsonb;
  family_id uuid;
  group_id uuid;
  qa_occupancy_id uuid;
  capacity_id uuid;
  guarded_stay_id uuid;
  request_id uuid;
  before_counts jsonb;
  after_counts jsonb;
  state text;
  stage text;
  stage_index integer := 0;
begin
  select membership.profile_id into actor_id
  from public.operation_memberships membership
  join public.profiles profile on profile.id=membership.profile_id
  where membership.role='owner' and membership.is_active
    and profile.is_active and profile.account_status='active'
  order by membership.profile_id limit 1;
  select dog.customer_id,array_agg(dog.id order by dog.id)
  into customer_id,dog_ids
  from public.dogs dog join public.customers customer on customer.id=dog.customer_id
  where dog.is_active and customer.is_active
  group by dog.customer_id having count(*)>=4
  order by dog.customer_id limit 1;
  select calendar.id,schedule_type.id into calendar_id,schedule_type_id
  from public.operation_calendars calendar
  join public.business_units unit on unit.id=calendar.business_unit_id
  join public.operation_calendar_schedule_types mapping
    on mapping.calendar_id=calendar.id and mapping.is_active
    and mapping.archived_at is null
  join public.operation_schedule_types schedule_type
    on schedule_type.id=mapping.schedule_type_id and schedule_type.is_active
  where unit.code='hotel' and unit.is_active and calendar.is_active
  order by calendar.id,schedule_type.id limit 1;
  select room_type.id,array_agg(room.id order by room.sort_order,room.id)
  into deluxe_type_id,deluxe_room_ids
  from public.hotel_room_types room_type
  join public.hotel_rooms room on room.room_type_id=room_type.id
  where upper(btrim(room_type.code))='DELUXE'
    and upper(btrim(room_type.name))='DELUXE'
    and room_type.is_active and room_type.archived_at is null
    and room.is_active and room.archived_at is null
  group by room_type.id having count(*)>=2 order by room_type.id limit 1;
  select room_type.id into standard_type_id
  from public.hotel_room_types room_type
  where upper(btrim(room_type.code))='STANDARD'
    and room_type.is_active and room_type.archived_at is null limit 1;
  if actor_id is null or cardinality(dog_ids)<4 or calendar_id is null
    or cardinality(deluxe_room_ids)<2 or standard_type_id is null then
    raise exception 'STOP_UNASSIGNED_SHARED_QA_FIXTURE_MISSING';
  end if;
  perform set_config('request.jwt.claim.sub',actor_id::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);

  members:=pg_temp.unassigned_shared_members(
    dog_ids[1:2],actor_id,calendar_id,schedule_type_id,deluxe_type_id,
    date '2098-01-10',date '2098-01-12'
  );
  request_id:=gen_random_uuid();
  result:=public.create_unassigned_shared_room_family_booking(
    customer_id,'2 Dog unassigned QA',false,members,
    deluxe_type_id,true,request_id
  );
  family_id:=(result->'familyBooking'->>'id')::uuid;
  group_id:=(result->>'sharedRoomGroupId')::uuid;
  insert into unassigned_shared_qa_result values(
    'two_dog_unassigned_state',
    family_id is not null and group_id is not null
      and (select count(*)=2 from public.family_booking_members where family_booking_id=family_id and archived_at is null)
      and (select count(*)=2 from public.hotel_stays stay where exists(select 1 from public.family_booking_members member where member.family_booking_id=family_id and member.hotel_stay_id=stay.id))
      and (select count(*)=4 from public.hotel_stay_schedule_events event join public.family_booking_members member on member.hotel_stay_id=event.hotel_stay_id where member.family_booking_id=family_id and event.archived_at is null)
      and (select count(*)=1 from public.hotel_capacity_reservations capacity where capacity.shared_room_group_id=group_id and capacity.source_kind='shared_group' and capacity.quantity=1 and capacity.archived_at is null)
      and (select count(*)=0 from public.hotel_capacity_reservations capacity join public.family_booking_members member on member.hotel_stay_id=capacity.hotel_stay_id where member.family_booking_id=family_id and capacity.archived_at is null)
      and (select count(*)=0 from public.hotel_physical_occupancies where shared_room_group_id=group_id and archived_at is null),null
  );
  before_counts:=pg_temp.unassigned_shared_counts();
  replay:=public.create_unassigned_shared_room_family_booking(
    customer_id,'2 Dog unassigned QA',false,members,
    deluxe_type_id,true,request_id
  );
  after_counts:=pg_temp.unassigned_shared_counts();
  insert into unassigned_shared_qa_result values(
    'reservation_response_loss_replay',
    (replay->>'replayed')::boolean and before_counts=after_counts,null
  );
  state:=null;
  begin
    perform public.create_unassigned_shared_room_family_booking(
      customer_id,'changed',false,members,deluxe_type_id,true,request_id
    );
  exception when others then state:=sqlstate; end;
  insert into unassigned_shared_qa_result values(
    'different_payload_rejected',state='23505',state
  );

  members:=pg_temp.unassigned_shared_members(
    dog_ids[1:3],actor_id,calendar_id,schedule_type_id,deluxe_type_id,
    date '2098-02-10',date '2098-02-12'
  );
  result:=public.create_unassigned_shared_room_family_booking(
    customer_id,'3 Dog unassigned QA',false,members,
    deluxe_type_id,true,gen_random_uuid()
  );
  family_id:=(result->'familyBooking'->>'id')::uuid;
  insert into unassigned_shared_qa_result values(
    'three_dog_unassigned_state',
    (select count(*)=3 from public.family_booking_members where family_booking_id=family_id and archived_at is null)
      and (select count(*)=6 from public.hotel_stay_schedule_events event join public.family_booking_members member on member.hotel_stay_id=event.hotel_stay_id where member.family_booking_id=family_id and event.archived_at is null)
      and (select count(*)=1 from public.hotel_capacity_reservations capacity join public.family_shared_room_groups shared_group on shared_group.id=capacity.shared_room_group_id where shared_group.family_booking_id=family_id and capacity.quantity=1 and capacity.archived_at is null),null
  );

  state:=null; before_counts:=pg_temp.unassigned_shared_counts();
  begin
    perform public.create_unassigned_shared_room_family_booking(
      customer_id,'STANDARD reject',false,
      pg_temp.unassigned_shared_members(dog_ids[1:2],actor_id,calendar_id,schedule_type_id,standard_type_id,date '2098-03-10',date '2098-03-12'),
      standard_type_id,true,gen_random_uuid()
    );
  exception when others then state:=sqlstate; end;
  after_counts:=pg_temp.unassigned_shared_counts();
  insert into unassigned_shared_qa_result values(
    'standard_rejected_without_residue',state='23514' and before_counts=after_counts,state
  );

  -- Allocation from a persisted requested shared Capacity reuses that exact row.
  members:=pg_temp.unassigned_shared_members(
    dog_ids[1:2],actor_id,calendar_id,schedule_type_id,deluxe_type_id,
    date '2098-04-10',date '2098-04-12'
  );
  result:=public.create_unassigned_shared_room_family_booking(
    customer_id,'allocate QA',false,members,deluxe_type_id,true,gen_random_uuid()
  );
  group_id:=(result->>'sharedRoomGroupId')::uuid;
  select id into capacity_id from public.hotel_capacity_reservations
  where shared_room_group_id=group_id and archived_at is null;
  replay:=public.create_shared_hotel_room_occupancy(
    group_id,deluxe_room_ids[1],gen_random_uuid()
  );
  qa_occupancy_id:=(replay->>'id')::uuid;
  insert into unassigned_shared_qa_result values(
    'shared_capacity_transitions_without_double_count',
    qa_occupancy_id is not null
      and (select source_kind='shared_occupancy' and physical_occupancy_id=qa_occupancy_id and shared_room_group_id is null and quantity=1 from public.hotel_capacity_reservations where id=capacity_id)
      and (select count(*)=2 from public.hotel_physical_occupancy_members occupancy_member where occupancy_member.occupancy_id=qa_occupancy_id and occupancy_member.archived_at is null)
      and (select count(*)=1 from public.hotel_room_allocations allocation where allocation.capacity_reservation_id=capacity_id and allocation.archived_at is null),null
  );

  -- Requested members cannot be mutated or cancelled through a single-Stay RPC.
  result:=public.create_unassigned_shared_room_family_booking(
    customer_id,'edit guard QA',false,
    pg_temp.unassigned_shared_members(dog_ids[1:2],actor_id,calendar_id,schedule_type_id,deluxe_type_id,date '2098-05-10',date '2098-05-12'),
    deluxe_type_id,true,gen_random_uuid()
  );
  group_id:=(result->>'sharedRoomGroupId')::uuid;
  select member.hotel_stay_id into guarded_stay_id
  from public.family_booking_members member
  where member.shared_room_group_id=group_id order by member.id limit 1;
  state:=null; before_counts:=pg_temp.unassigned_shared_counts();
  begin
    perform public.cancel_hotel_reservation(
      guarded_stay_id,(select version from public.hotel_stays where id=guarded_stay_id),
      'must fail closed',gen_random_uuid()
    );
  exception when others then state:=sqlstate; end;
  after_counts:=pg_temp.unassigned_shared_counts();
  insert into unassigned_shared_qa_result values(
    'single_stay_cancel_guard',state='PT409' and before_counts=after_counts,state
  );

  foreach stage in array array[
    'family','member','stay','schedule','group','shared_capacity','audit'
  ] loop
    stage_index:=stage_index+1;
    before_counts:=pg_temp.unassigned_shared_counts(); state:=null;
    perform set_config('app.unassigned_shared_qa_stage',stage,true);
    begin
      perform public.create_unassigned_shared_room_family_booking(
        customer_id,'fault '||stage,false,
        pg_temp.unassigned_shared_members(dog_ids[1:2],actor_id,calendar_id,schedule_type_id,deluxe_type_id,date '2099-01-01'+stage_index*3,date '2099-01-03'+stage_index*3),
        deluxe_type_id,true,gen_random_uuid()
      );
    exception when others then state:=sqlstate; end;
    perform set_config('app.unassigned_shared_qa_stage','',true);
    after_counts:=pg_temp.unassigned_shared_counts();
    insert into unassigned_shared_qa_result values(
      'reservation_fault_'||stage,state='P0001' and before_counts=after_counts,state
    );
  end loop;

  -- One requested group is reused for each allocation fault attempt because every
  -- injected failure rolls the complete allocation transaction back to requested.
  result:=public.create_unassigned_shared_room_family_booking(
    customer_id,'allocation faults',false,
    pg_temp.unassigned_shared_members(dog_ids[1:2],actor_id,calendar_id,schedule_type_id,deluxe_type_id,date '2099-06-10',date '2099-06-12'),
    deluxe_type_id,true,gen_random_uuid()
  );
  group_id:=(result->>'sharedRoomGroupId')::uuid;
  foreach stage in array array[
    'occupancy','occupancy_member','capacity_transition',
    'allocation_before','allocation_after','audit'
  ] loop
    before_counts:=pg_temp.unassigned_shared_counts(); state:=null;
    perform set_config('app.unassigned_shared_qa_stage',stage,true);
    begin
      perform public.create_shared_hotel_room_occupancy(
        group_id,deluxe_room_ids[2],gen_random_uuid()
      );
    exception when others then state:=sqlstate; end;
    perform set_config('app.unassigned_shared_qa_stage','',true);
    after_counts:=pg_temp.unassigned_shared_counts();
    insert into unassigned_shared_qa_result values(
      'allocation_fault_'||stage,state='P0001' and before_counts=after_counts,state
    );
  end loop;
end;
$$;

select
  case when bool_and(passed) then
    'HOTEL_UNASSIGNED_SHARED_ROOM_BACKEND_APPEND_RUNTIME_QA_PASS'
  else 'HOTEL_UNASSIGNED_SHARED_ROOM_BACKEND_APPEND_RUNTIME_QA_FAIL' end verdict,
  count(*)::integer checks,
  count(*) filter(where passed)::integer passed,
  count(*) filter(where not passed)::integer failed
from unassigned_shared_qa_result;

select check_name,case when passed then 'PASS' else 'FAIL' end result,detail
from unassigned_shared_qa_result order by check_name;

rollback;
