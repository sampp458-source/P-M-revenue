-- Isolated Clean QA only. Every fixture is rolled back.
begin;
select hotel_qa.assert_isolated_environment();

create temporary table long_stay_availability_qa_context(
  actor_id uuid, customer_id uuid, dog_id uuid, other_dog_id uuid,
  contract_id uuid, room_id uuid, room_type_id uuid
) on commit drop;

do $$
declare
  actor uuid; customer uuid:=gen_random_uuid(); dog uuid:=gen_random_uuid(); other_dog uuid:=gen_random_uuid();
  contract uuid:=gen_random_uuid(); room uuid; room_type uuid;
begin
  select membership.profile_id into actor
  from public.operation_memberships membership
  join public.profiles profile on profile.id=membership.profile_id
  where membership.is_active and membership.role in ('owner','manager')
    and profile.is_active and profile.account_status='active'
  order by case membership.role when 'owner' then 0 else 1 end, membership.profile_id limit 1;
  select hotel_room.id,hotel_room.room_type_id into room,room_type
  from public.hotel_rooms hotel_room join public.hotel_room_types room_kind on room_kind.id=hotel_room.room_type_id
  where hotel_room.is_active and hotel_room.archived_at is null
    and room_kind.is_active and room_kind.archived_at is null
    and upper(btrim(room_kind.code))='DELUXE'
  order by room_kind.sort_order,hotel_room.sort_order,hotel_room.id limit 1;
  if actor is null or room is null then raise exception 'STOP_LONG_STAY_AVAILABILITY_QA_REFERENCE'; end if;
  perform set_config('request.jwt.claim.sub',actor::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  insert into public.customers(id,name,phone,is_active) values(customer,'Long Stay Availability QA','01000000981',true);
  insert into public.dogs(id,customer_id,name,is_active) values
    (dog,customer,'Availability QA Target',true),(other_dog,customer,'Availability QA Other',true);
  insert into public.long_stay_contracts(id,customer_id,dog_id,started_on,preferred_room_type_id,preferred_room_id,
    create_request_id,created_by,updated_by)
  values(contract,customer,dog,date '2097-03-10',room_type,room,gen_random_uuid(),actor,actor);
  insert into long_stay_availability_qa_context values(actor,customer,dog,other_dog,contract,room,room_type);
end;
$$;

create function pg_temp.qa_room() returns jsonb language sql stable as $$
  select room_row from long_stay_availability_qa_context context,
  lateral jsonb_array_elements(public.get_long_stay_room_availability(
    context.contract_id,date '2097-03-01',null,true)->'rooms') room_row
  where room_row->>'roomId'=context.room_id::text;
$$;

do $$ begin
  if not coalesce((pg_temp.qa_room()->>'assignable')::boolean,false)
    or (public.get_long_stay_room_availability((select contract_id from long_stay_availability_qa_context),date '2097-03-01',null,true)->>'availabilityFrom')::timestamptz
       <> timestamptz '2097-03-10 00:00+09' then
    raise exception 'STOP_AVAILABLE_OR_TIME_UNKNOWN';
  end if;
end $$;

savepoint current_occupied;
do $$ declare c long_stay_availability_qa_context%rowtype; stay uuid:=gen_random_uuid(); capacity uuid:=gen_random_uuid(); begin
  select * into c from long_stay_availability_qa_context;
  insert into public.hotel_stays(id,dog_id,request_id,created_by,updated_by) values(stay,c.other_dog_id,gen_random_uuid(),c.actor_id,c.actor_id);
  insert into public.hotel_capacity_reservations(id,source_kind,hotel_stay_id,room_type_id,reserved_from,reserved_until,created_by,updated_by)
    values(capacity,'stay',stay,c.room_type_id,clock_timestamp()-interval '1 day','infinity',c.actor_id,c.actor_id);
  insert into public.hotel_room_allocations(capacity_reservation_id,room_id,allocated_from,allocated_until,created_by,updated_by)
    values(capacity,c.room_id,clock_timestamp()-interval '1 day','infinity',c.actor_id,c.actor_id);
  if (pg_temp.qa_room()->>'assignable')::boolean or pg_temp.qa_room()->>'conflictPhase'<>'current' then raise exception 'STOP_CURRENT_OCCUPIED'; end if;
end $$;
rollback to savepoint current_occupied;

savepoint future_conflict;
do $$ declare c long_stay_availability_qa_context%rowtype; stay uuid:=gen_random_uuid(); capacity uuid:=gen_random_uuid(); begin
  select * into c from long_stay_availability_qa_context;
  insert into public.hotel_stays(id,dog_id,request_id,created_by,updated_by) values(stay,c.other_dog_id,gen_random_uuid(),c.actor_id,c.actor_id);
  insert into public.hotel_capacity_reservations(id,source_kind,hotel_stay_id,room_type_id,reserved_from,reserved_until,created_by,updated_by)
    values(capacity,'stay',stay,c.room_type_id,timestamptz '2097-03-20 15:00+09',timestamptz '2097-03-21 11:00+09',c.actor_id,c.actor_id);
  insert into public.hotel_room_allocations(capacity_reservation_id,room_id,allocated_from,allocated_until,created_by,updated_by)
    values(capacity,c.room_id,timestamptz '2097-03-20 15:00+09',timestamptz '2097-03-21 11:00+09',c.actor_id,c.actor_id);
  if (pg_temp.qa_room()->>'assignable')::boolean or pg_temp.qa_room()->>'conflictPhase'<>'future'
    or (pg_temp.qa_room()->>'nextConflictFrom')::timestamptz<>timestamptz '2097-03-20 15:00+09' then raise exception 'STOP_FUTURE_CONFLICT'; end if;
end $$;
rollback to savepoint future_conflict;

savepoint excluded_rows;
do $$ declare c long_stay_availability_qa_context%rowtype; stay_a uuid:=gen_random_uuid(); stay_b uuid:=gen_random_uuid(); cap_a uuid:=gen_random_uuid(); cap_b uuid:=gen_random_uuid(); begin
  select * into c from long_stay_availability_qa_context;
  insert into public.hotel_stays(id,dog_id,request_id,created_by,updated_by) values
    (stay_a,c.other_dog_id,gen_random_uuid(),c.actor_id,c.actor_id),(stay_b,c.other_dog_id,gen_random_uuid(),c.actor_id,c.actor_id);
  insert into public.hotel_capacity_reservations(id,source_kind,hotel_stay_id,room_type_id,reserved_from,reserved_until,created_by,updated_by) values
    (cap_a,'stay',stay_a,c.room_type_id,timestamptz '2097-03-11 15:00+09','infinity',c.actor_id,c.actor_id),
    (cap_b,'stay',stay_b,c.room_type_id,timestamptz '2097-02-01 15:00+09',timestamptz '2097-02-02 11:00+09',c.actor_id,c.actor_id);
  insert into public.hotel_room_allocations(capacity_reservation_id,room_id,allocated_from,allocated_until,created_by,updated_by,archived_at,archived_by,archive_reason) values
    (cap_a,c.room_id,timestamptz '2097-03-11 15:00+09','infinity',c.actor_id,c.actor_id,clock_timestamp(),c.actor_id,'QA archived'),
    (cap_b,c.room_id,timestamptz '2097-02-01 15:00+09',timestamptz '2097-02-02 11:00+09',c.actor_id,c.actor_id,null,null,null);
  if not (pg_temp.qa_room()->>'assignable')::boolean then raise exception 'STOP_ARCHIVED_OR_PAST_FINITE'; end if;
end $$;
rollback to savepoint excluded_rows;

savepoint long_stay_conflict;
do $$ declare c long_stay_availability_qa_context%rowtype; stay uuid:=gen_random_uuid(); capacity uuid:=gen_random_uuid(); begin
  select * into c from long_stay_availability_qa_context;
  insert into public.hotel_stays(id,dog_id,request_id,created_by,updated_by) values(stay,c.other_dog_id,gen_random_uuid(),c.actor_id,c.actor_id);
  insert into public.hotel_capacity_reservations(id,source_kind,hotel_stay_id,room_type_id,reserved_from,reserved_until,created_by,updated_by)
    values(capacity,'stay',stay,c.room_type_id,timestamptz '2097-03-15 15:00+09','infinity',c.actor_id,c.actor_id);
  insert into public.hotel_room_allocations(capacity_reservation_id,room_id,allocated_from,allocated_until,created_by,updated_by)
    values(capacity,c.room_id,timestamptz '2097-03-15 15:00+09','infinity',c.actor_id,c.actor_id);
  insert into public.long_stay_contracts(customer_id,dog_id,current_hotel_stay_id,status,started_on,create_request_id,created_by,updated_by)
    values(c.customer_id,c.other_dog_id,stay,'active',date '2097-03-15',gen_random_uuid(),c.actor_id,c.actor_id);
  if pg_temp.qa_room()->>'conflictSource'<>'long_stay' then raise exception 'STOP_LONG_STAY_CONFLICT'; end if;
end $$;
rollback to savepoint long_stay_conflict;

savepoint shared_room_conflict;
do $$
declare
  c long_stay_availability_qa_context%rowtype; stay uuid:=gen_random_uuid(); family uuid:=gen_random_uuid();
  member uuid:=gen_random_uuid(); room_group uuid:=gen_random_uuid(); occupancy uuid:=gen_random_uuid();
  capacity uuid:=gen_random_uuid(); allocation uuid:=gen_random_uuid();
begin
  select * into c from long_stay_availability_qa_context;
  insert into public.hotel_stays(id,dog_id,request_id,created_by,updated_by)
    values(stay,c.other_dog_id,gen_random_uuid(),c.actor_id,c.actor_id);
  insert into public.family_bookings(id,customer_id,canonical_payload,canonical_payload_hash,request_id,created_by,updated_by)
    values(family,c.customer_id,'{}',repeat('0',64),gen_random_uuid(),c.actor_id,c.actor_id);
  insert into public.family_booking_members(id,family_booking_id,stable_member_key,dog_id,service_type,hotel_stay_id,created_by,updated_by)
    values(member,family,'availability-qa',c.other_dog_id,'hotel',stay,c.actor_id,c.actor_id);
  insert into public.family_shared_room_groups(id,family_booking_id,stable_group_key,leader_member_id,room_type_id,
    normalized_starts_at,normalized_ends_at,requested_capacity,created_by,updated_by)
    values(room_group,family,'availability-qa',member,c.room_type_id,timestamptz '2097-03-15 15:00+09',
      timestamptz '2097-03-20 11:00+09',2,c.actor_id,c.actor_id);
  update public.family_booking_members set shared_room_group_id=room_group where id=member;
  insert into public.hotel_physical_occupancies(id,family_booking_id,shared_room_group_id,customer_id,room_type_id,room_id,
    occupied_from,occupied_until,request_id,canonical_payload_hash,created_by,updated_by)
    values(occupancy,family,room_group,c.customer_id,c.room_type_id,c.room_id,timestamptz '2097-03-15 15:00+09',
      timestamptz '2097-03-20 11:00+09',gen_random_uuid(),repeat('0',32),c.actor_id,c.actor_id);
  insert into public.hotel_capacity_reservations(id,source_kind,physical_occupancy_id,room_type_id,reserved_from,reserved_until,created_by,updated_by)
    values(capacity,'shared_occupancy',occupancy,c.room_type_id,timestamptz '2097-03-15 15:00+09',
      timestamptz '2097-03-20 11:00+09',c.actor_id,c.actor_id);
  insert into public.hotel_room_allocations(id,capacity_reservation_id,room_id,allocated_from,allocated_until,created_by,updated_by)
    values(allocation,capacity,c.room_id,timestamptz '2097-03-15 15:00+09',timestamptz '2097-03-20 11:00+09',c.actor_id,c.actor_id);
  update public.hotel_physical_occupancies set capacity_reservation_id=capacity,room_allocation_id=allocation where id=occupancy;
  if pg_temp.qa_room()->>'conflictSource'<>'shared_room' then raise exception 'STOP_SHARED_ROOM_CONFLICT'; end if;
end $$;
rollback to savepoint shared_room_conflict;

do $$ begin
  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claims','{}',true);
  begin perform public.get_long_stay_room_availability((select contract_id from long_stay_availability_qa_context),date '2097-03-01',null,true);
    raise exception 'unauthorized accepted';
  exception when insufficient_privilege then null; end;
end $$;

select 'LONG_STAY_ROOM_AVAILABILITY_RUNTIME_QA_READY' status,
  true current_occupied,true future_conflict,true next_conflict_date,true archived_excluded,
  true past_finite_excluded,true shared_room_conflict,true long_stay_conflict,true available_room,true time_unknown,true authorization;
rollback;

select 'LONG_STAY_ROOM_AVAILABILITY_QA_RESIDUE_ZERO' status,
  count(*) fixture_residue from public.customers where name='Long Stay Availability QA';
