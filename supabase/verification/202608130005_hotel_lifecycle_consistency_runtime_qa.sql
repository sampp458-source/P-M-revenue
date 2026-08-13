-- Rollback-only Clean QA runtime matrix for Hotel lifecycle consistency.
begin;
select hotel_qa.assert_isolated_environment();

create temporary table hotel_lifecycle_qa_results(
  scenario text primary key,
  passed boolean not null,
  detail text
) on commit drop;
create temporary table hotel_lifecycle_qa_context(
  actor_id uuid,
  customer_id uuid,
  calendar_id uuid,
  schedule_type_id uuid,
  standard_type_id uuid,
  deluxe_type_id uuid,
  standard_room_id uuid,
  deluxe_room_id uuid
) on commit drop;
create temporary table hotel_lifecycle_qa_dogs(
  sequence integer primary key,
  dog_id uuid not null unique
) on commit drop;

do $$
declare
  actor uuid;
  customer uuid:=gen_random_uuid();
  calendar_id uuid;
  schedule_type_id uuid;
  standard_type uuid;
  deluxe_type uuid;
  standard_room uuid;
  deluxe_room uuid;
begin
  select membership.profile_id into actor
  from public.operation_memberships membership
  join public.profiles profile on profile.id=membership.profile_id
  where membership.is_active and membership.role in ('owner','manager')
    and profile.is_active and profile.account_status='active'
  order by case membership.role when 'owner' then 0 else 1 end,membership.profile_id
  limit 1;
  perform set_config('request.jwt.claim.sub',actor::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object(
    'sub',actor,'role','authenticated'
  )::text,true);
  select calendar.id,mapping.schedule_type_id into calendar_id,schedule_type_id
  from public.operation_calendars calendar
  join public.business_units unit on unit.id=calendar.business_unit_id
  join public.operation_calendar_schedule_types mapping
    on mapping.calendar_id=calendar.id and mapping.is_active and mapping.archived_at is null
  where unit.code='hotel' and unit.is_active and calendar.is_active
  order by mapping.created_at limit 1;
  select id into standard_type from public.hotel_room_types
    where code='STANDARD' and is_active and archived_at is null;
  select id into deluxe_type from public.hotel_room_types
    where code='DELUXE' and is_active and archived_at is null;
  select id into standard_room from public.hotel_rooms
    where room_type_id=standard_type and is_active and archived_at is null
    order by sort_order,id limit 1;
  select id into deluxe_room from public.hotel_rooms
    where room_type_id=deluxe_type and is_active and archived_at is null
    order by sort_order,id limit 1;
  if actor is null or calendar_id is null or schedule_type_id is null
    or standard_type is null or deluxe_type is null
    or standard_room is null or deluxe_room is null then
    raise exception 'STOP_HOTEL_LIFECYCLE_QA_REFERENCE_DATA';
  end if;
  insert into public.customers(id,name,phone,is_active)
    values(customer,'Hotel Lifecycle Rollback QA','01000000991',true);
  insert into hotel_lifecycle_qa_dogs(sequence,dog_id)
    select sequence,gen_random_uuid() from generate_series(1,40) sequence;
  insert into public.dogs(id,customer_id,name,is_active)
    select dog_id,customer,format('Hotel Lifecycle QA %s',sequence),true
    from hotel_lifecycle_qa_dogs;
  insert into hotel_lifecycle_qa_context values(
    actor,customer,calendar_id,schedule_type_id,standard_type,deluxe_type,
    standard_room,deluxe_room
  );
end;
$$;

create function pg_temp.hotel_lifecycle_make_stay(
  p_dog_sequence integer,
  p_room_type_id uuid,
  p_check_in_date date,
  p_check_out_date date
) returns uuid language plpgsql as $$
declare
  context hotel_lifecycle_qa_context%rowtype;
  dog_id uuid;
  result jsonb;
begin
  select * into context from hotel_lifecycle_qa_context;
  select row.dog_id into dog_id from hotel_lifecycle_qa_dogs row
    where row.sequence=p_dog_sequence;
  result:=public.create_flexible_hotel_reservation(
    context.calendar_id,context.schedule_type_id,
    p_check_in_date,time '15:00',false,
    p_check_out_date,time '11:00',false,
    p_room_type_id,dog_id,context.customer_id,array[context.actor_id],
    'Hotel lifecycle rollback QA',gen_random_uuid()
  );
  return (result->>'id')::uuid;
end;
$$;

create function pg_temp.hotel_lifecycle_shared_member(
  p_key text,p_dog_sequence integer,p_room_type_id uuid,p_start date,p_end date
) returns jsonb language sql stable as $$
select jsonb_build_object(
  'stableMemberKey',p_key,'dogId',dog.dog_id,'serviceType','hotel',
  'assigneeIds',jsonb_build_array(context.actor_id),
  'memo','Hotel lifecycle Shared Room rollback QA',
  'sharedRoomGroupKey','hotel-lifecycle-shared',
  'calendarId',context.calendar_id,'scheduleTypeId',context.schedule_type_id,
  'checkInDate',p_start,'checkInTime','15:00','checkInTimeUnspecified',false,
  'checkOutDate',p_end,'checkOutTime','11:00','checkOutTimeUnspecified',false,
  'roomTypeId',p_room_type_id
)
from hotel_lifecycle_qa_context context
join hotel_lifecycle_qa_dogs dog on dog.sequence=p_dog_sequence;
$$;

do $$
declare
  context hotel_lifecycle_qa_context%rowtype;
  stay_a uuid;
  stay_b uuid;
  stay_type uuid;
  stay_total uuid;
  version_value integer;
  request_value uuid;
  result jsonb;
  capacity_id uuid;
  allocation_id uuid;
  check_in_schedule uuid;
  check_out_schedule uuid;
  family jsonb;
  family_id uuid;
  group_id uuid;
  occupancy_id uuid;
  occupancy_version integer;
  shared_a uuid;
  shared_b uuid;
  shared_capacity uuid;
  shared_allocation uuid;
  i integer;
begin
  select * into context from hotel_lifecycle_qa_context;

  stay_a:=pg_temp.hotel_lifecycle_make_stay(
    1,context.standard_type_id,date '2099-03-01',date '2099-03-03'
  );
  select version into version_value from public.hotel_stays where id=stay_a;
  perform public.assign_hotel_room(
    stay_a,version_value,context.standard_room_id,'Lifecycle QA',gen_random_uuid()
  );
  select version into version_value from public.hotel_stays where id=stay_a;
  perform public.complete_hotel_check_in(
    stay_a,version_value,timestamptz '2099-03-01 15:00+09',gen_random_uuid()
  );
  select event.operation_schedule_id into check_in_schedule
  from public.hotel_stay_schedule_events event
  where event.hotel_stay_id=stay_a and event.event_kind='check_in' and event.archived_at is null;
  select event.operation_schedule_id into check_out_schedule
  from public.hotel_stay_schedule_events event
  where event.hotel_stay_id=stay_a and event.event_kind='check_out' and event.archived_at is null;
  insert into hotel_lifecycle_qa_results values(
    'K_CHECKIN_CALENDAR_SYNC',
    (select status='completed' from public.operation_schedules where id=check_in_schedule),null
  );

  select version into version_value from public.hotel_stays where id=stay_a;
  request_value:=gen_random_uuid();
  result:=public.update_checked_in_hotel_planned_checkout(
    stay_a,version_value,date '2099-03-04',time '11:00',false,request_value
  );
  select id into capacity_id from public.hotel_capacity_reservations
    where hotel_stay_id=stay_a and archived_at is null;
  select id into allocation_id from public.hotel_room_allocations
    where capacity_reservation_id=capacity_id and archived_at is null;
  insert into hotel_lifecycle_qa_results values(
    'A_CHECKED_IN_SINGLE_EXTENSION',
    (select reserved_until=timestamptz '2099-03-04 11:00+09'
      from public.hotel_capacity_reservations where id=capacity_id)
    and (select allocated_until=timestamptz '2099-03-04 11:00+09'
      from public.hotel_room_allocations where id=allocation_id)
    and (select starts_at=timestamptz '2099-03-04 11:00+09'
      from public.operation_schedules where id=check_out_schedule),null
  );
  if public.update_checked_in_hotel_planned_checkout(
      stay_a,version_value,date '2099-03-04',time '11:00',false,request_value
    )<>result then
    raise exception 'STOP_HOTEL_LIFECYCLE_REPLAY_RESPONSE';
  end if;
  insert into hotel_lifecycle_qa_results values(
    'G_REPLAY_DUPLICATE_ZERO',
    (select count(*)=1 from public.hotel_planned_checkout_requests where request_id=request_value),null
  );

  select version into version_value from public.hotel_stays where id=stay_a;
  perform public.update_checked_in_hotel_planned_checkout(
    stay_a,version_value,date '2099-03-03',time '12:00',false,gen_random_uuid()
  );
  insert into hotel_lifecycle_qa_results values(
    'E_SHORTENING',
    (select reserved_until=timestamptz '2099-03-03 12:00+09'
      from public.hotel_capacity_reservations where id=capacity_id)
    and (select allocated_until=timestamptz '2099-03-03 12:00+09'
      from public.hotel_room_allocations where id=allocation_id),null
  );
  select version into version_value from public.hotel_stays where id=stay_a;
  begin
    perform public.update_checked_in_hotel_planned_checkout(
      stay_a,version_value,date '2099-03-01',time '14:00',false,gen_random_uuid()
    );
    raise exception 'invalid shortening accepted';
  exception when invalid_parameter_value then
    insert into hotel_lifecycle_qa_results values('F_INVALID_SHORTENING_REJECTED',true,sqlstate);
  end;

  stay_b:=pg_temp.hotel_lifecycle_make_stay(
    2,context.standard_type_id,date '2099-03-03',date '2099-03-05'
  );
  select version into version_value from public.hotel_stays where id=stay_b;
  perform public.assign_hotel_room(
    stay_b,version_value,context.standard_room_id,'Lifecycle room conflict QA',gen_random_uuid()
  );
  select version into version_value from public.hotel_stays where id=stay_a;
  begin
    perform public.update_checked_in_hotel_planned_checkout(
      stay_a,version_value,date '2099-03-04',time '11:00',false,gen_random_uuid()
    );
    raise exception 'room conflict accepted';
  exception when exclusion_violation then
    insert into hotel_lifecycle_qa_results values(
      'B_EXTENSION_ROOM_CONFLICT',
      (select reserved_until=timestamptz '2099-03-03 12:00+09'
        from public.hotel_capacity_reservations where id=capacity_id),sqlstate
    );
  end;

  stay_type:=pg_temp.hotel_lifecycle_make_stay(
    3,context.standard_type_id,date '2099-04-01',date '2099-04-02'
  );
  select version into version_value from public.hotel_stays where id=stay_type;
  perform public.assign_hotel_room(
    stay_type,version_value,context.standard_room_id,'Lifecycle type QA',gen_random_uuid()
  );
  select version into version_value from public.hotel_stays where id=stay_type;
  perform public.complete_hotel_check_in(
    stay_type,version_value,timestamptz '2099-04-01 15:00+09',gen_random_uuid()
  );
  for i in 4..8 loop
    perform pg_temp.hotel_lifecycle_make_stay(
      i,context.standard_type_id,date '2099-04-02',date '2099-04-03'
    );
  end loop;
  select version into version_value from public.hotel_stays where id=stay_type;
  begin
    perform public.update_checked_in_hotel_planned_checkout(
      stay_type,version_value,date '2099-04-03',time '11:00',false,gen_random_uuid()
    );
    raise exception 'type capacity conflict accepted';
  exception when check_violation then
    insert into hotel_lifecycle_qa_results values('C_TYPE_CAPACITY_CONFLICT',true,sqlstate);
  end;

  stay_total:=pg_temp.hotel_lifecycle_make_stay(
    9,context.deluxe_type_id,date '2099-05-01',date '2099-05-02'
  );
  select version into version_value from public.hotel_stays where id=stay_total;
  perform public.assign_hotel_room(
    stay_total,version_value,context.deluxe_room_id,'Lifecycle total QA',gen_random_uuid()
  );
  select version into version_value from public.hotel_stays where id=stay_total;
  perform public.complete_hotel_check_in(
    stay_total,version_value,timestamptz '2099-05-01 15:00+09',gen_random_uuid()
  );
  for i in 10..14 loop
    perform pg_temp.hotel_lifecycle_make_stay(
      i,context.deluxe_type_id,date '2099-05-02',date '2099-05-03'
    );
  end loop;
  for i in 15..19 loop
    perform pg_temp.hotel_lifecycle_make_stay(
      i,context.standard_type_id,date '2099-05-02',date '2099-05-03'
    );
  end loop;
  perform pg_temp.hotel_lifecycle_make_stay(
    20,null,date '2099-05-02',date '2099-05-03'
  );
  select version into version_value from public.hotel_stays where id=stay_total;
  begin
    perform public.update_checked_in_hotel_planned_checkout(
      stay_total,version_value,date '2099-05-03',time '11:00',false,gen_random_uuid()
    );
    raise exception 'total capacity conflict accepted';
  exception when check_violation then
    insert into hotel_lifecycle_qa_results values('D_TOTAL_CAPACITY_CONFLICT',true,sqlstate);
  end;

  family:=public.create_family_booking(
    context.customer_id,'Lifecycle Shared QA',false,jsonb_build_array(
      pg_temp.hotel_lifecycle_shared_member('shared-a',21,context.deluxe_type_id,date '2099-06-01',date '2099-06-03'),
      pg_temp.hotel_lifecycle_shared_member('shared-b',22,context.deluxe_type_id,date '2099-06-01',date '2099-06-03')
    ),gen_random_uuid()
  );
  family_id:=(family->>'id')::uuid;
  select id into group_id from public.family_shared_room_groups
    where family_booking_id=family_id and archived_at is null;
  select hotel_stay_id into shared_a from public.family_booking_members
    where family_booking_id=family_id and stable_member_key='shared-a';
  select hotel_stay_id into shared_b from public.family_booking_members
    where family_booking_id=family_id and stable_member_key='shared-b';
  result:=public.create_shared_hotel_room_occupancy(
    group_id,context.deluxe_room_id,gen_random_uuid()
  );
  occupancy_id:=(result->>'id')::uuid;
  select version,capacity_reservation_id,room_allocation_id
    into occupancy_version,shared_capacity,shared_allocation
  from public.hotel_physical_occupancies where id=occupancy_id;
  select version into version_value from public.hotel_stays where id=shared_a;
  perform public.complete_shared_hotel_check_in(
    occupancy_id,shared_a,occupancy_version,version_value,
    timestamptz '2099-06-01 15:00+09',gen_random_uuid()
  );
  select version into occupancy_version from public.hotel_physical_occupancies where id=occupancy_id;
  select version into version_value from public.hotel_stays where id=shared_b;
  perform public.complete_shared_hotel_check_in(
    occupancy_id,shared_b,occupancy_version,version_value,
    timestamptz '2099-06-01 15:05+09',gen_random_uuid()
  );
  select version into version_value from public.hotel_stays where id=shared_a;
  perform public.update_checked_in_hotel_planned_checkout(
    shared_a,version_value,date '2099-06-04',time '11:00',false,gen_random_uuid()
  );
  insert into hotel_lifecycle_qa_results values(
    'I_SHARED_ROOM_EXTENSION_MAX_BOUNDARY',
    (select occupied_until=timestamptz '2099-06-04 11:00+09'
      from public.hotel_physical_occupancies where id=occupancy_id)
    and (select reserved_until=timestamptz '2099-06-04 11:00+09'
      from public.hotel_capacity_reservations where id=shared_capacity)
    and (select allocated_until=timestamptz '2099-06-04 11:00+09'
      from public.hotel_room_allocations where id=shared_allocation),null
  );
  select version into version_value from public.hotel_stays where id=shared_b;
  perform public.update_checked_in_hotel_planned_checkout(
    shared_b,version_value,date '2099-06-02',time '11:00',false,gen_random_uuid()
  );
  insert into hotel_lifecycle_qa_results values(
    'J_SHARED_ROOM_SHORTENING_PRESERVES_MAX',
    (select occupied_until=timestamptz '2099-06-04 11:00+09'
      from public.hotel_physical_occupancies where id=occupancy_id)
    and (select reserved_until=timestamptz '2099-06-04 11:00+09'
      from public.hotel_capacity_reservations where id=shared_capacity)
    and (select allocated_until=timestamptz '2099-06-04 11:00+09'
      from public.hotel_room_allocations where id=shared_allocation),null
  );

  select version into version_value from public.hotel_stays where id=stay_a;
  perform public.complete_hotel_check_out(
    stay_a,version_value,timestamptz '2099-03-03 11:00+09',gen_random_uuid()
  );
  insert into hotel_lifecycle_qa_results values(
    'L_CHECKOUT_CALENDAR_SYNC',
    (select status='completed' from public.operation_schedules where id=check_out_schedule),null
  );
  select version into version_value from public.hotel_stays where id=stay_a;
  perform public.reverse_hotel_completion(
    stay_a,version_value,'check_out','Lifecycle reverse QA',gen_random_uuid()
  );
  insert into hotel_lifecycle_qa_results values(
    'M_REVERSE_CALENDAR_SYNC',
    (select status='scheduled' from public.operation_schedules where id=check_out_schedule),null
  );

  select version into version_value from public.hotel_stays where id=stay_a;
  begin
    perform public.update_checked_in_hotel_planned_checkout(
      stay_a,version_value-1,date '2099-03-03',time '11:30',false,gen_random_uuid()
    );
    raise exception 'stale version accepted';
  exception when sqlstate 'PT409' then
    insert into hotel_lifecycle_qa_results values('H_STALE_VERSION_PT409',true,sqlstate);
  end;
end;
$$;

do $$
begin
  if exists(select 1 from hotel_lifecycle_qa_results where not passed) then
    raise exception 'STOP_HOTEL_LIFECYCLE_RUNTIME_QA_FAILURE';
  end if;
  if (select count(*) from hotel_lifecycle_qa_results)<>13 then
    raise exception 'STOP_HOTEL_LIFECYCLE_RUNTIME_QA_ASSERTION_COUNT';
  end if;
end;
$$;

select 'HOTEL_LIFECYCLE_CONSISTENCY_RUNTIME_QA_READY' as status,
  (select jsonb_agg(to_jsonb(result) order by scenario)
   from hotel_lifecycle_qa_results result) as results;
rollback;
