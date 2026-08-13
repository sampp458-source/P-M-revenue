begin;
select hotel_qa.assert_isolated_environment();

do $guard$
declare guard hotel_qa.environment_guard%rowtype;
begin
  select * into guard from hotel_qa.environment_guard where singleton_key;
  if guard.qa_project_ref<>'wxbvwixoeczfvbqurdse'
    or guard.production_project_ref<>'zorvcuskzemehblqdbfj'
    or to_regclass('hotel_qa.hotel_lifecycle_2session_context') is not null
    or to_regclass('hotel_qa.hotel_lifecycle_2session_results') is not null then
    raise exception 'STOP_HOTEL_LIFECYCLE_2SESSION_BINDING_OR_RESIDUE';
  end if;
end;
$guard$;

create table hotel_qa.hotel_lifecycle_2session_context(
  singleton boolean primary key default true check(singleton),
  actor_id uuid not null,
  customer_id uuid not null,
  dog_id uuid not null,
  stay_id uuid not null,
  expected_version integer not null,
  request_a uuid not null,
  request_b uuid not null,
  start_at timestamptz not null
);
create table hotel_qa.hotel_lifecycle_2session_results(
  session_code text primary key check(session_code in('A','B')),
  succeeded boolean not null,
  sqlstate text null,
  returned_version integer null,
  started_at timestamptz not null,
  finished_at timestamptz not null
);

do $setup$
declare
  actor uuid; customer_id uuid:=gen_random_uuid(); dog_id uuid:=gen_random_uuid();
  calendar_id uuid; schedule_type_id uuid; target_room_type_id uuid; room_id uuid;
  result jsonb; stay_id uuid; version_value integer;
begin
  select membership.profile_id into actor
  from public.operation_memberships membership
  join public.profiles profile on profile.id=membership.profile_id
  where membership.is_active and membership.role in('owner','manager')
    and profile.is_active and profile.account_status='active'
  order by case membership.role when 'owner' then 0 else 1 end,membership.profile_id limit 1;
  select calendar.id,mapping.schedule_type_id into calendar_id,schedule_type_id
  from public.operation_calendars calendar
  join public.business_units unit on unit.id=calendar.business_unit_id
  join public.operation_calendar_schedule_types mapping
    on mapping.calendar_id=calendar.id and mapping.is_active and mapping.archived_at is null
  where unit.code='hotel' and unit.is_active and calendar.is_active
  order by calendar.sort_order,mapping.created_at limit 1;
  select id into target_room_type_id from public.hotel_room_types
    where code='STANDARD' and is_active and archived_at is null;
  select id into room_id from public.hotel_rooms
    where room_type_id=target_room_type_id and is_active and archived_at is null
    order by sort_order,id limit 1;
  if actor is null or calendar_id is null or schedule_type_id is null
    or target_room_type_id is null or room_id is null then
    raise exception 'STOP_HOTEL_LIFECYCLE_2SESSION_REFERENCE_DATA';
  end if;
  perform set_config('request.jwt.claim.sub',actor::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  insert into public.customers(id,name,phone,is_active)
    values(customer_id,'Hotel Lifecycle Two Session QA','01099998501',true);
  insert into public.dogs(id,customer_id,name,is_active)
    values(dog_id,customer_id,'Hotel Lifecycle Two Session QA',true);
  result:=public.create_flexible_hotel_reservation(
    calendar_id,schedule_type_id,date '2099-12-01',time '15:00',false,
    date '2099-12-03',time '11:00',false,target_room_type_id,dog_id,customer_id,
    array[actor],'Hotel lifecycle two-session QA',gen_random_uuid()
  );
  stay_id:=(result->>'id')::uuid;
  perform public.assign_hotel_room(
    stay_id,(result->>'version')::integer,room_id,'Hotel lifecycle two-session QA',gen_random_uuid()
  );
  select version into version_value from public.hotel_stays where id=stay_id;
  perform public.complete_hotel_check_in(
    stay_id,version_value,timestamptz '2099-12-01 15:00+09',gen_random_uuid()
  );
  select version into version_value from public.hotel_stays where id=stay_id;
  insert into hotel_qa.hotel_lifecycle_2session_context(
    actor_id,customer_id,dog_id,stay_id,expected_version,request_a,request_b,start_at
  ) values(
    actor,customer_id,dog_id,stay_id,version_value,gen_random_uuid(),gen_random_uuid(),
    clock_timestamp()+interval '8 seconds'
  );
end;
$setup$;

select 'HOTEL_LIFECYCLE_2SESSION_FIXTURE_READY' status;
commit;
