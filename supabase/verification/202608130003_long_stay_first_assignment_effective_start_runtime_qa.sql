-- Clean QA only. All fixtures and mutations are rolled back.
begin;
select hotel_qa.assert_isolated_environment();

create temporary table long_stay_effective_start_qa_context(
  actor_id uuid, customer_id uuid, dog_id uuid, other_dog_id uuid,
  contract_id uuid, room_id uuid, room_type_id uuid,
  calendar_id uuid, schedule_type_id uuid
) on commit drop;

do $$
declare
  actor uuid; customer uuid:=gen_random_uuid(); dog uuid:=gen_random_uuid(); other_dog uuid:=gen_random_uuid();
  contract uuid:=gen_random_uuid(); room uuid; room_type uuid; calendar uuid; schedule_type uuid;
begin
  select membership.profile_id into actor
  from public.operation_memberships membership
  join public.profiles profile on profile.id=membership.profile_id
  where membership.is_active and membership.role in ('owner','manager')
    and profile.is_active and profile.account_status='active'
  order by case membership.role when 'owner' then 0 else 1 end,membership.profile_id limit 1;
  select hotel_room.id,hotel_room.room_type_id into room,room_type
  from public.hotel_rooms hotel_room
  join public.hotel_room_types room_kind on room_kind.id=hotel_room.room_type_id
  where hotel_room.is_active and hotel_room.archived_at is null
    and room_kind.is_active and room_kind.archived_at is null
  order by room_kind.sort_order,hotel_room.sort_order,hotel_room.id limit 1;
  select c.id,st.id into calendar,schedule_type
  from public.operation_calendars c
  join public.business_units unit on unit.id=c.business_unit_id and unit.code='hotel'
  join public.operation_calendar_schedule_types mapping on mapping.calendar_id=c.id and mapping.is_active and mapping.archived_at is null
  join public.operation_schedule_types st on st.id=mapping.schedule_type_id and st.is_active
  where c.is_active order by c.sort_order,st.sort_order limit 1;
  if actor is null or room is null or calendar is null or schedule_type is null then
    raise exception 'STOP_LONG_STAY_EFFECTIVE_START_QA_REFERENCE';
  end if;
  perform set_config('request.jwt.claim.sub',actor::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  insert into public.customers(id,name,phone,is_active) values(customer,'Long Stay Effective Start QA','01000000983',true);
  insert into public.dogs(id,customer_id,name,is_active) values
    (dog,customer,'Effective Start Target',true),(other_dog,customer,'Effective Start Other',true);
  insert into public.long_stay_contracts(id,customer_id,dog_id,started_on,preferred_room_type_id,preferred_room_id,
    create_request_id,created_by,updated_by)
  values(contract,customer,dog,date '2097-06-11',room_type,room,gen_random_uuid(),actor,actor);
  insert into long_stay_effective_start_qa_context values(actor,customer,dog,other_dog,contract,room,room_type,calendar,schedule_type);
end;
$$;

create function pg_temp.qa_room(p_time time default time '15:00') returns jsonb language sql stable as $$
  select room_row from long_stay_effective_start_qa_context context,
  lateral jsonb_array_elements(public.get_long_stay_room_availability(
    context.contract_id,date '2097-08-01',p_time,p_time is null)->'rooms') room_row
  where room_row->>'roomId'=context.room_id::text;
$$;

create function pg_temp.add_hotel_allocation(p_from timestamptz,p_until timestamptz) returns void language plpgsql as $$
declare c long_stay_effective_start_qa_context%rowtype; stay uuid:=gen_random_uuid(); capacity uuid:=gen_random_uuid();
begin
  select * into c from long_stay_effective_start_qa_context;
  insert into public.hotel_stays(id,dog_id,request_id,created_by,updated_by) values(stay,c.other_dog_id,gen_random_uuid(),c.actor_id,c.actor_id);
  insert into public.hotel_capacity_reservations(id,source_kind,hotel_stay_id,room_type_id,reserved_from,reserved_until,created_by,updated_by)
    values(capacity,'stay',stay,c.room_type_id,p_from,p_until,c.actor_id,c.actor_id);
  insert into public.hotel_room_allocations(capacity_reservation_id,room_id,allocated_from,allocated_until,created_by,updated_by)
    values(capacity,c.room_id,p_from,p_until,c.actor_id,c.actor_id);
end;
$$;

do $$ begin
  if (public.get_long_stay_room_availability((select contract_id from long_stay_effective_start_qa_context),date '2097-08-01',time '15:00',false)->>'availabilityFrom')::timestamptz
    <>timestamptz '2097-08-01 15:00+09' then raise exception 'STOP_EFFECTIVE_START_BACKDATED'; end if;
  if (public.get_long_stay_room_availability((select contract_id from long_stay_effective_start_qa_context),date '2097-08-01',null,true)->>'availabilityFrom')::timestamptz
    <>timestamptz '2097-08-01 00:00+09' then raise exception 'STOP_EFFECTIVE_START_TIME_UNKNOWN'; end if;
end $$;

savepoint case_a;
select pg_temp.add_hotel_allocation(timestamptz '2097-06-20 15:00+09',timestamptz '2097-06-25 11:00+09');
do $$ begin if not (pg_temp.qa_room()->>'assignable')::boolean then raise exception 'STOP_CASE_A_PAST_JUNE'; end if; end $$;
rollback to savepoint case_a;

savepoint case_b;
select pg_temp.add_hotel_allocation(timestamptz '2097-07-01 15:00+09',timestamptz '2097-07-31 11:00+09');
do $$ begin if not (pg_temp.qa_room()->>'assignable')::boolean then raise exception 'STOP_CASE_B_PAST_JULY'; end if; end $$;
rollback to savepoint case_b;

savepoint case_c;
select pg_temp.add_hotel_allocation(timestamptz '2097-07-31 15:00+09',timestamptz '2097-08-02 11:00+09');
do $$ begin
  if (pg_temp.qa_room()->>'assignable')::boolean
    or pg_temp.qa_room()->>'conflictPhase'<>'effective_start_overlap'
    or pg_temp.qa_room()->>'reason'<>'배정 시작 구간과 겹침' then raise exception 'STOP_CASE_C_EFFECTIVE_OVERLAP'; end if;
end $$;
rollback to savepoint case_c;

savepoint case_d;
select pg_temp.add_hotel_allocation(timestamptz '2097-08-20 15:00+09',timestamptz '2097-08-21 11:00+09');
do $$ begin
  if (pg_temp.qa_room()->>'assignable')::boolean or pg_temp.qa_room()->>'conflictPhase'<>'future'
    or (pg_temp.qa_room()->>'nextConflictFrom')::timestamptz<>timestamptz '2097-08-20 15:00+09' then
    raise exception 'STOP_CASE_D_FUTURE'; end if;
end $$;
rollback to savepoint case_d;

savepoint case_e;
do $$
declare c long_stay_effective_start_qa_context%rowtype; result jsonb; stay uuid;
  expected_runtime timestamptz:=timestamptz '2097-08-01 15:00+09';
  expected_month timestamptz:=timestamptz '2097-08-01 00:00+09';
begin
  select * into c from long_stay_effective_start_qa_context;
  result:=public.confirm_long_stay_month(c.contract_id,1,date '2097-08-01',c.calendar_id,c.schedule_type_id,
    time '15:00',false,c.room_type_id,c.room_id,array[c.actor_id],'effective start QA',gen_random_uuid());
  stay:=(result->>'hotelStayId')::uuid;
  if stay is null then raise exception 'STOP_CASE_E_STAY_LINK'; end if;
  if (select reserved_from from public.hotel_capacity_reservations where hotel_stay_id=stay and archived_at is null)<>expected_runtime then
    raise exception 'STOP_CASE_E_CAPACITY_START'; end if;
  if (select allocated_from from public.hotel_room_allocations allocation join public.hotel_capacity_reservations capacity on capacity.id=allocation.capacity_reservation_id where capacity.hotel_stay_id=stay and allocation.archived_at is null)<>expected_runtime then
    raise exception 'STOP_CASE_E_ALLOCATION_START'; end if;
  if (select schedule.starts_at from public.hotel_stay_schedule_events event join public.operation_schedules schedule on schedule.id=event.operation_schedule_id where event.hotel_stay_id=stay and event.event_kind='check_in' and event.archived_at is null)<>expected_runtime then
    raise exception 'STOP_CASE_E_SCHEDULE_START'; end if;
  if (select planned_occupied_from from public.long_stay_monthly_occupancies where long_stay_contract_id=c.contract_id and service_month=date '2097-08-01' and archived_at is null)<>expected_month then
    raise exception 'STOP_CASE_E_OCCUPANCY_START'; end if;
  if (select started_on from public.long_stay_contracts where id=c.contract_id)<>date '2097-06-11' then
    raise exception 'STOP_CASE_E_CONTRACT_HISTORY'; end if;
end $$;
rollback to savepoint case_e;

savepoint case_f;
do $$
declare c long_stay_effective_start_qa_context%rowtype; stay uuid:=gen_random_uuid(); capacity uuid:=gen_random_uuid(); original timestamptz:=timestamptz '2097-06-11 15:00+09';
begin
  select * into c from long_stay_effective_start_qa_context;
  insert into public.hotel_stays(id,dog_id,request_id,created_by,updated_by) values(stay,c.dog_id,gen_random_uuid(),c.actor_id,c.actor_id);
  insert into public.hotel_capacity_reservations(id,source_kind,hotel_stay_id,room_type_id,reserved_from,reserved_until,created_by,updated_by)
    values(capacity,'stay',stay,c.room_type_id,original,'infinity',c.actor_id,c.actor_id);
  insert into public.hotel_room_allocations(capacity_reservation_id,room_id,allocated_from,allocated_until,created_by,updated_by)
    values(capacity,c.room_id,original,'infinity',c.actor_id,c.actor_id);
  update public.long_stay_contracts set current_hotel_stay_id=stay,status='active' where id=c.contract_id;
  perform public.confirm_long_stay_month(c.contract_id,(select version from public.long_stay_contracts where id=c.contract_id),date '2097-09-01',
    c.calendar_id,c.schedule_type_id,time '15:00',false,c.room_type_id,c.room_id,array[c.actor_id],'existing runtime QA',gen_random_uuid());
  if (select reserved_from from public.hotel_capacity_reservations where id=capacity)<>original
    or (select allocated_from from public.hotel_room_allocations where capacity_reservation_id=capacity and archived_at is null)<>original then
    raise exception 'STOP_CASE_F_EXISTING_RUNTIME_RESET';
  end if;
end $$;
rollback to savepoint case_f;

savepoint case_g;
do $$
declare c long_stay_effective_start_qa_context%rowtype; later_contract uuid:=gen_random_uuid(); value timestamptz;
begin
  select * into c from long_stay_effective_start_qa_context;
  insert into public.long_stay_contracts(id,customer_id,dog_id,started_on,create_request_id,created_by,updated_by)
    values(later_contract,c.customer_id,c.other_dog_id,date '2097-08-15',gen_random_uuid(),c.actor_id,c.actor_id);
  value:=(public.get_long_stay_room_availability(later_contract,date '2097-08-01',time '15:00',false)->>'availabilityFrom')::timestamptz;
  if value<>timestamptz '2097-08-15 15:00+09' then raise exception 'STOP_CASE_G_CONTRACT_START_LATER'; end if;
end $$;
rollback to savepoint case_g;

rollback;

select case when count(*)=0
  then 'LONG_STAY_FIRST_ASSIGNMENT_EFFECTIVE_START_RUNTIME_QA_READY'
  else 'STOP_LONG_STAY_FIRST_ASSIGNMENT_EFFECTIVE_START_QA_RESIDUE' end status,
  true case_a,true case_b,true case_c,true case_d,true case_e,true case_f,true case_g,true time_unknown,
  count(*) fixture_residue
from public.customers where name='Long Stay Effective Start QA';
