rollback;
begin;
select hotel_qa.assert_isolated_environment();

select set_config(
  'request.jwt.claim.sub',
  (
    select profile.id::text
    from public.profiles profile
    join public.operation_memberships membership on membership.profile_id=profile.id
    where profile.role='admin' and profile.is_active and profile.account_status='active'
      and membership.role='owner' and membership.is_active
    order by profile.created_at
    limit 1
  ),
  true
);
select set_config('request.jwt.claim.role','authenticated',true);

create temp table daycare_qa_result(
  scenario text primary key,
  result text not null
) on commit drop;

do $$
declare
  actor_id uuid:=auth.uid(); customer_id uuid; dog_id uuid; assignees uuid[];
  daycare_calendar uuid; daycare_type uuid; hotel_calendar uuid; hotel_type uuid;
  room_type uuid; room_type_code text; room_1 uuid; room_2 uuid;
  a jsonb; b jsonb; blocker jsonb; boundary jsonb; hotel jsonb; value jsonb;
  a_id uuid; b_id uuid; blocker_id uuid; b_version integer; sqlstate_value text;
  request_a uuid:=gen_random_uuid(); request_b uuid:=gen_random_uuid();
  request_blocker uuid:=gen_random_uuid(); request_boundary uuid:=gen_random_uuid();
  day_a date:=date '2099-08-14'; day_b date:=date '2099-08-15';
begin
  if actor_id is null or not public.is_active_operation_member() then
    raise exception 'STOP_DAYCARE_QA_ACTOR';
  end if;
  assignees:=array[actor_id];

  select dog.customer_id,dog.id into customer_id,dog_id
  from public.dogs dog join public.customers customer on customer.id=dog.customer_id
  where dog.is_active and customer.is_active order by dog.created_at limit 1;
  select calendar.id,mapping.schedule_type_id into daycare_calendar,daycare_type
  from public.operation_calendars calendar
  join public.business_units unit on unit.id=calendar.business_unit_id and unit.code='daycare'
  join public.operation_calendar_schedule_types mapping on mapping.calendar_id=calendar.id and mapping.is_active and mapping.archived_at is null
  where calendar.is_active order by calendar.sort_order,mapping.created_at limit 1;
  select calendar.id,mapping.schedule_type_id into hotel_calendar,hotel_type
  from public.operation_calendars calendar
  join public.business_units unit on unit.id=calendar.business_unit_id and unit.code='hotel'
  join public.operation_calendar_schedule_types mapping on mapping.calendar_id=calendar.id and mapping.is_active and mapping.archived_at is null
  where calendar.is_active order by calendar.sort_order,mapping.created_at limit 1;
  select room_type_row.id,room_type_row.code into room_type,room_type_code
  from public.hotel_room_types room_type_row
  where room_type_row.is_active and room_type_row.archived_at is null
    and (select count(*) from public.hotel_rooms room where room.room_type_id=room_type_row.id and room.is_active and room.archived_at is null)>=3
  order by room_type_row.sort_order limit 1;
  select rooms[1],rooms[2] into room_1,room_2
  from (
    select array_agg(room.id order by room.sort_order,room.name,room.id) rooms
    from public.hotel_rooms room
    where room.room_type_id=room_type and room.is_active and room.archived_at is null
  ) selected_rooms;
  if customer_id is null or daycare_calendar is null or hotel_calendar is null or room_1 is null or room_2 is null or room_1=room_2 then
    raise exception 'STOP_DAYCARE_QA_FIXTURE_CONTRACT';
  end if;

  -- A: canonical root + lifecycle + capacity, no allocation.
  a:=public.create_daycare_reservation(daycare_calendar,daycare_type,customer_id,dog_id,day_a,'10:00','18:00',room_type,null,assignees,'DAYCARE_QA_A',request_a);
  a_id:=(a->>'operationScheduleId')::uuid;
  if (select count(*) from public.operation_schedules where id=a_id)<>1
    or (select count(*) from public.daycare_operation_states where operation_schedule_id=a_id and lifecycle_status='scheduled')<>1
    or (select count(*) from public.hotel_capacity_reservations where daycare_schedule_id=a_id and archived_at is null)<>1
    or (select count(*) from public.hotel_room_allocations allocation join public.hotel_capacity_reservations capacity on capacity.id=allocation.capacity_reservation_id where capacity.daycare_schedule_id=a_id and allocation.archived_at is null)<>0 then
    raise exception 'STOP_DAYCARE_QA_A';
  end if;
  insert into daycare_qa_result values('A_UNASSIGNED_CREATE','PASS');

  -- N: identical replay returns the same schedule without a second mutation.
  value:=public.create_daycare_reservation(daycare_calendar,daycare_type,customer_id,dog_id,day_a,'10:00','18:00',room_type,null,assignees,'DAYCARE_QA_A',request_a);
  if value->>'operationScheduleId'<>a_id::text or (select count(*) from public.daycare_operation_states where create_request_id=request_a)<>1 then
    raise exception 'STOP_DAYCARE_QA_N';
  end if;
  insert into daycare_qa_result values('N_REPLAY_DUPLICATE_0','PASS');

  -- O: same request with a different payload fails closed.
  begin
    perform public.create_daycare_reservation(daycare_calendar,daycare_type,customer_id,dog_id,day_a,'10:00','17:30',room_type,null,assignees,'DAYCARE_QA_A',request_a);
    raise exception 'STOP_DAYCARE_QA_O_NOT_REJECTED';
  exception when unique_violation then null;
  end;
  insert into daycare_qa_result values('O_REPLAY_PAYLOAD_REJECT','PASS');

  -- I/L: stale version and unassigned check-in are non-retryable/fail-closed.
  begin
    perform public.update_daycare_reservation(a_id,999,daycare_calendar,daycare_type,customer_id,dog_id,day_a,'10:00','18:00',room_type,null,assignees,'DAYCARE_QA_A',gen_random_uuid());
    raise exception 'STOP_DAYCARE_QA_I_NOT_REJECTED';
  exception when sqlstate 'PT409' then null;
  end;
  insert into daycare_qa_result values('I_STALE_PT409','PASS');
  begin
    perform public.complete_daycare_check_in(a_id,(a->>'version')::integer,(day_a+time '10:05') at time zone 'Asia/Seoul',gen_random_uuid());
    raise exception 'STOP_DAYCARE_QA_L_NOT_REJECTED';
  exception when invalid_parameter_value then null;
  end;
  insert into daycare_qa_result values('L_UNASSIGNED_CHECKIN_REJECT','PASS');

  -- J: cancellation releases active capacity/allocation and completes both ledgers.
  value:=public.cancel_daycare_reservation(a_id,(a->>'version')::integer,'DAYCARE_QA_CANCEL',gen_random_uuid());
  if value->>'lifecycleStatus'<>'cancelled' or value->>'scheduleStatus'<>'cancelled'
    or exists(select 1 from public.hotel_capacity_reservations where daycare_schedule_id=a_id and archived_at is null) then
    raise exception 'STOP_DAYCARE_QA_J';
  end if;
  insert into daycare_qa_result values('J_CANCEL_RELEASE','PASS');

  -- B/G: assigned creation and exact Schedule/Capacity/Allocation update sync.
  b:=public.create_daycare_reservation(daycare_calendar,daycare_type,customer_id,dog_id,day_b,'10:00','18:00',room_type,room_1,assignees,'DAYCARE_QA_B',request_b);
  b_id:=(b->>'operationScheduleId')::uuid;
  if b->'roomAllocation' is null then raise exception 'STOP_DAYCARE_QA_B'; end if;
  insert into daycare_qa_result values('B_ASSIGNED_CREATE','PASS');
  b:=public.update_daycare_reservation(b_id,(b->>'version')::integer,daycare_calendar,daycare_type,customer_id,dog_id,day_b,'09:00','17:00',room_type,room_1,assignees,'DAYCARE_QA_B_UPDATED',gen_random_uuid());
  b_version:=(b->>'version')::integer;
  if (b->>'startsAt')::timestamptz<>(day_b+time '09:00') at time zone 'Asia/Seoul'
    or (b->>'endsAt')::timestamptz<>(day_b+time '17:00') at time zone 'Asia/Seoul'
    or (b->'capacityReservation'->>'reservedFrom')::timestamptz<>(day_b+time '09:00') at time zone 'Asia/Seoul'
    or (b->'roomAllocation'->>'allocatedUntil')::timestamptz<>(day_b+time '17:00') at time zone 'Asia/Seoul' then
    raise exception 'STOP_DAYCARE_QA_G';
  end if;
  insert into daycare_qa_result values('G_UPDATE_SYNC','PASS');

  blocker:=public.create_daycare_reservation(daycare_calendar,daycare_type,customer_id,dog_id,day_b,'12:00','16:00',room_type,room_2,assignees,'DAYCARE_QA_BLOCKER',request_blocker);
  blocker_id:=(blocker->>'operationScheduleId')::uuid;

  -- H: conflicting update rolls every linked row back.
  begin
    perform public.update_daycare_reservation(b_id,b_version,daycare_calendar,daycare_type,customer_id,dog_id,day_b,'11:00','16:30',room_type,room_2,assignees,'DAYCARE_QA_CONFLICT',gen_random_uuid());
    raise exception 'STOP_DAYCARE_QA_H_NOT_REJECTED';
  exception when exclusion_violation then null;
  end;
  value:=public.daycare_reservation_json(b_id);
  if value->'roomAllocation'->>'roomId'<>room_1::text or value->>'version'<>b_version::text then
    raise exception 'STOP_DAYCARE_QA_H_ROLLBACK';
  end if;
  insert into daycare_qa_result values('H_UPDATE_CONFLICT_ROLLBACK','PASS');

  -- E: another Daycare cannot share an overlapping physical room.
  begin
    perform public.create_daycare_reservation(daycare_calendar,daycare_type,customer_id,dog_id,day_b,'13:00','15:00',room_type,room_1,assignees,'DAYCARE_QA_E',gen_random_uuid());
    raise exception 'STOP_DAYCARE_QA_E_NOT_REJECTED';
  exception when exclusion_violation then null;
  end;
  insert into daycare_qa_result values('E_DAYCARE_ROOM_OVERLAP','PASS');

  -- F: half-open boundary permits the next allocation at exactly 17:00.
  boundary:=public.create_daycare_reservation(daycare_calendar,daycare_type,customer_id,dog_id,day_b,'17:00','19:00',room_type,room_1,assignees,'DAYCARE_QA_BOUNDARY',request_boundary);
  if boundary->'roomAllocation' is null then raise exception 'STOP_DAYCARE_QA_F'; end if;
  insert into daycare_qa_result values('F_EXACT_BOUNDARY','PASS');

  -- K/M: assigned check-in and explicit checkout complete the lifecycle and Calendar block.
  b:=public.complete_daycare_check_in(b_id,b_version,(day_b+time '09:05') at time zone 'Asia/Seoul',gen_random_uuid());
  if b->>'lifecycleStatus'<>'checked_in' then raise exception 'STOP_DAYCARE_QA_K'; end if;
  insert into daycare_qa_result values('K_ASSIGNED_CHECKIN','PASS');
  b:=public.complete_daycare_check_out(b_id,(b->>'version')::integer,(day_b+time '16:55') at time zone 'Asia/Seoul',gen_random_uuid());
  if b->>'lifecycleStatus'<>'completed' or b->>'scheduleStatus'<>'completed' then raise exception 'STOP_DAYCARE_QA_M'; end if;
  insert into daycare_qa_result values('M_CHECKOUT_COMPLETE','PASS');

  -- C: Hotel physical occupancy blocks an overlapping Daycare room assignment.
  hotel:=public.create_hotel_reservation(hotel_calendar,hotel_type,'DAYCARE_QA_HOTEL_C',(day_a+10+time '15:00') at time zone 'Asia/Seoul',(day_a+10+time '19:00') at time zone 'Asia/Seoul',room_type,dog_id,customer_id,assignees,'DAYCARE_QA',gen_random_uuid());
  hotel:=public.assign_hotel_room((hotel->>'id')::uuid,(hotel->>'version')::integer,room_1,'DAYCARE_QA',gen_random_uuid());
  begin
    perform public.create_daycare_reservation(daycare_calendar,daycare_type,customer_id,dog_id,day_a+10,'10:00','18:00',room_type,room_1,assignees,'DAYCARE_QA_C',gen_random_uuid());
    raise exception 'STOP_DAYCARE_QA_C_NOT_REJECTED';
  exception when exclusion_violation then null;
  end;
  insert into daycare_qa_result values('C_HOTEL_OVERLAP','PASS');

  -- D: a Hotel reservation beginning after the Daycare interval does not overlap.
  hotel:=public.create_hotel_reservation(hotel_calendar,hotel_type,'DAYCARE_QA_HOTEL_D',(day_a+11+time '20:00') at time zone 'Asia/Seoul',(day_a+11+time '22:00') at time zone 'Asia/Seoul',room_type,dog_id,customer_id,assignees,'DAYCARE_QA',gen_random_uuid());
  hotel:=public.assign_hotel_room((hotel->>'id')::uuid,(hotel->>'version')::integer,room_1,'DAYCARE_QA',gen_random_uuid());
  value:=public.create_daycare_reservation(daycare_calendar,daycare_type,customer_id,dog_id,day_a+11,'10:00','18:00',room_type,room_1,assignees,'DAYCARE_QA_D',gen_random_uuid());
  if value->'roomAllocation' is null then raise exception 'STOP_DAYCARE_QA_D'; end if;
  insert into daycare_qa_result values('D_HOTEL_AFTER_BOUNDARY','PASS');

  if (select count(*) from daycare_qa_result)<>15 then raise exception 'STOP_DAYCARE_QA_SCENARIO_COUNT'; end if;
end;
$$;

select scenario,result from daycare_qa_result order by scenario;
rollback;
