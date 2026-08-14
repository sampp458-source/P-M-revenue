-- ISOLATED CLEAN QA ONLY. Every fixture and ledger mutation is rolled back.
\set ON_ERROR_STOP on
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

create temporary table long_stay_outing_inventory_qa_result(
  scenario text primary key,
  passed boolean not null,
  detail text null
) on commit drop;

do $$
declare
  actor_id uuid:=auth.uid(); dog_ids uuid[]; customer_id uuid; dog_id uuid;
  hotel_calendar uuid; hotel_schedule_type uuid; daycare_calendar uuid; daycare_schedule_type uuid;
  room_type_id uuid:=gen_random_uuid(); other_room_type_id uuid:=gen_random_uuid();
  room_1 uuid:=gen_random_uuid(); room_2 uuid:=gen_random_uuid(); wrong_room uuid:=gen_random_uuid();
  contract_json jsonb; result_json jsonb; hotel_json jsonb; daycare_json jsonb;
  contract_id uuid; stay_id uuid; contract_version integer; stay_version integer;
  old_capacity_id uuid; future_capacity_id uuid; old_allocation_id uuid; returned_allocation_id uuid;
  leave_id uuid; request_id uuid; blocker_stay_id uuid; blocker_stay_version integer;
  failure_state text; rooms_json jsonb; boundary_before timestamptz;
begin
  if actor_id is null or not public.is_active_operation_member() then
    raise exception 'STOP_OUTING_INVENTORY_QA_ACTOR';
  end if;
  select array_agg(selected.id order by selected.created_at,selected.id)
  into dog_ids
  from (
    select dog.id,dog.created_at
    from public.dogs dog
    join public.customers customer on customer.id=dog.customer_id
    where dog.is_active and customer.is_active
      and not exists (
        select 1 from public.long_stay_contracts contract
        where contract.dog_id=dog.id and contract.status in ('pending','active')
          and contract.archived_at is null
      )
    order by dog.created_at,dog.id
    limit 3
  ) selected;
  if cardinality(coalesce(dog_ids,'{}'::uuid[]))<3 then
    raise exception 'STOP_OUTING_INVENTORY_QA_DOGS';
  end if;
  dog_id:=dog_ids[1];
  select dog.customer_id into customer_id from public.dogs dog where dog.id=dog_id;

  select calendar.id,mapping.schedule_type_id
  into hotel_calendar,hotel_schedule_type
  from public.operation_calendars calendar
  join public.business_units unit on unit.id=calendar.business_unit_id and unit.code='hotel'
  join public.operation_calendar_schedule_types mapping
    on mapping.calendar_id=calendar.id and mapping.is_active and mapping.archived_at is null
  where calendar.is_active
  order by calendar.sort_order,mapping.created_at
  limit 1;
  select calendar.id,mapping.schedule_type_id
  into daycare_calendar,daycare_schedule_type
  from public.operation_calendars calendar
  join public.business_units unit on unit.id=calendar.business_unit_id and unit.code='daycare'
  join public.operation_calendar_schedule_types mapping
    on mapping.calendar_id=calendar.id and mapping.is_active and mapping.archived_at is null
  where calendar.is_active
  order by calendar.sort_order,mapping.created_at
  limit 1;
  if hotel_calendar is null or daycare_calendar is null then
    raise exception 'STOP_OUTING_INVENTORY_QA_CALENDARS';
  end if;

  insert into public.hotel_room_types(id,code,name,is_active,sort_order,created_by,updated_by)
  values
    (room_type_id,'QA_OUTING_INV_'||upper(substr(replace(room_type_id::text,'-',''),1,8)),
      'QA Outing Inventory',true,9900,actor_id,actor_id),
    (other_room_type_id,'QA_OUTING_OTHER_'||upper(substr(replace(other_room_type_id::text,'-',''),1,8)),
      'QA Outing Other',true,9901,actor_id,actor_id);
  insert into public.hotel_rooms(id,room_type_id,name,is_active,sort_order,created_by,updated_by)
  values
    (room_1,room_type_id,'QA Outing Room 1 '||substr(room_1::text,1,8),true,9900,actor_id,actor_id),
    (room_2,room_type_id,'QA Outing Room 2 '||substr(room_2::text,1,8),true,9901,actor_id,actor_id),
    (wrong_room,other_room_type_id,'QA Outing Wrong Room '||substr(wrong_room::text,1,8),true,9902,actor_id,actor_id);

  contract_json:=public.create_long_stay_contract(
    customer_id,dog_id,date '2097-01-10',null,room_type_id,room_1,
    1000000,17,'LONG_STAY_OUTING_INVENTORY_RUNTIME_QA_202608140003',gen_random_uuid()
  );
  contract_id:=(contract_json->>'id')::uuid;
  select version into contract_version from public.long_stay_contracts where id=contract_id;
  contract_json:=public.confirm_long_stay_month_v2(
    contract_id,contract_version,date '2097-01-01',date '2097-01-10',
    hotel_calendar,hotel_schedule_type,time '15:00',false,room_type_id,room_1,
    array[actor_id],'Outing inventory QA',gen_random_uuid()
  );
  stay_id:=(contract_json->>'hotelStayId')::uuid;
  select version into stay_version from public.hotel_stays where id=stay_id;
  perform public.complete_hotel_check_in(
    stay_id,stay_version,timestamptz '2097-01-10 15:05+09',gen_random_uuid()
  );

  -- A/Y: the new KEEP_ROOM mode and the legacy V2 path both preserve inventory.
  select version into contract_version from public.long_stay_contracts where id=contract_id;
  request_id:=gen_random_uuid();
  result_json:=public.start_long_stay_absence_v3(
    contract_id,contract_version,timestamptz '2097-01-11 10:00+09',null,null,true,
    'keep_room','KEEP QA','KEEP QA',request_id
  );
  select id into old_capacity_id from public.hotel_capacity_reservations
  where hotel_stay_id=stay_id and archived_at is null;
  select id into old_allocation_id from public.hotel_room_allocations
  where capacity_reservation_id=old_capacity_id and archived_at is null
    and allocated_until='infinity'::timestamptz;
  insert into long_stay_outing_inventory_qa_result values(
    'A_KEEP_ROOM',
    result_json->'currentAbsence'->>'inventoryMode'='keep_room'
      and old_capacity_id is not null and old_allocation_id is not null,
    null
  );
  result_json:=public.start_long_stay_absence_v3(
    contract_id,contract_version,timestamptz '2097-01-11 10:00+09',null,null,true,
    'keep_room','KEEP QA','KEEP QA',request_id
  );
  insert into long_stay_outing_inventory_qa_result values(
    'S_REPLAY',coalesce((result_json->>'replayed')::boolean,false),null
  );
  select version into contract_version from public.long_stay_contracts where id=contract_id;
  perform public.complete_long_stay_absence_v2(
    contract_id,contract_version,timestamptz '2097-01-11 12:00+09',null,
    'KEEP return','KEEP return',gen_random_uuid()
  );
  select version into contract_version from public.long_stay_contracts where id=contract_id;
  perform public.start_long_stay_absence_v2(
    contract_id,contract_version,timestamptz '2097-01-11 13:00+09',null,null,true,
    'legacy keep','legacy keep',gen_random_uuid()
  );
  select version into contract_version from public.long_stay_contracts where id=contract_id;
  perform public.complete_long_stay_absence(
    contract_id,contract_version,timestamptz '2097-01-11 14:00+09',
    'legacy return','legacy return',gen_random_uuid()
  );
  insert into long_stay_outing_inventory_qa_result values(
    'Y_KEEP_ROOM_LEGACY',
    exists(select 1 from public.hotel_capacity_reservations where id=old_capacity_id and archived_at is null and reserved_until='infinity'::timestamptz)
      and exists(select 1 from public.hotel_room_allocations where id=old_allocation_id and archived_at is null and allocated_until='infinity'::timestamptz),
    null
  );

  -- D: RELEASE_ROOM cannot be combined with an unknown date.
  failure_state:=null;
  select version into contract_version from public.long_stay_contracts where id=contract_id;
  begin
    perform public.start_long_stay_absence_v3(
      contract_id,contract_version,timestamptz '2097-01-12 10:00+09',null,null,true,
      'release_room',null,'date unknown',gen_random_uuid()
    );
  exception when others then failure_state:=sqlstate; end;
  insert into long_stay_outing_inventory_qa_result values(
    'D_DATE_UNKNOWN_RELEASE_REJECT',failure_state='22023',failure_state
  );

  -- B/C: release with a date-only return creates historical and future segments.
  select version into contract_version from public.long_stay_contracts where id=contract_id;
  request_id:=gen_random_uuid();
  result_json:=public.start_long_stay_absence_v3(
    contract_id,contract_version,timestamptz '2097-01-12 10:00+09',date '2097-01-15',null,true,
    'release_room','release QA','release QA',request_id
  );
  leave_id:=(result_json->'currentAbsence'->>'id')::uuid;
  select released_capacity_id,released_allocation_id,return_capacity_id
  into old_capacity_id,old_allocation_id,future_capacity_id
  from public.long_stay_absence_events where id=leave_id;
  insert into long_stay_outing_inventory_qa_result values(
    'B_RELEASE_ROOM_SEGMENTS',
    exists(select 1 from public.hotel_capacity_reservations where id=old_capacity_id
      and reserved_until=timestamptz '2097-01-12 10:00+09' and archived_at is not null)
    and exists(select 1 from public.hotel_room_allocations where id=old_allocation_id
      and allocated_until=timestamptz '2097-01-12 10:00+09' and archived_at is null)
    and exists(select 1 from public.hotel_capacity_reservations where id=future_capacity_id
      and reserved_from=timestamptz '2097-01-15 00:00+09' and reserved_until='infinity'::timestamptz),
    null
  );
  insert into long_stay_outing_inventory_qa_result values(
    'C_TIME_UNKNOWN_BOUNDARY',
    result_json->'currentAbsence'->>'expectedReturnAt' is null
      and result_json->'currentAbsence'->>'guaranteeFrom'='2097-01-14T15:00:00+00:00',
    null
  );
  insert into long_stay_outing_inventory_qa_result values(
    'U_ROOM_BOARD_RELEASE',
    not exists(select 1 from public.hotel_room_allocations allocation
      where allocation.room_id=room_1 and allocation.archived_at is null
        and allocation.allocated_from<=timestamptz '2097-01-12 11:00+09'
        and allocation.allocated_until>timestamptz '2097-01-12 11:00+09'),
    null
  );
  insert into long_stay_outing_inventory_qa_result values(
    'V_ENDED_ALLOCATION_NOT_ACTIVE',
    not exists(select 1 from public.hotel_room_allocations allocation
      where allocation.id=old_allocation_id
        and allocation.allocated_from<=timestamptz '2097-01-12 11:00+09'
        and allocation.allocated_until>timestamptz '2097-01-12 11:00+09'),
    null
  );

  -- O/P/R: move the future capacity boundary later, earlier, and reject unknown date.
  select version into contract_version from public.long_stay_contracts where id=contract_id;
  perform public.set_long_stay_absence_expected_return_v2(
    contract_id,contract_version,date '2097-01-15',time '15:00',false,'exact boundary',gen_random_uuid()
  );
  select version into contract_version from public.long_stay_contracts where id=contract_id;
  perform public.set_long_stay_absence_expected_return_v2(
    contract_id,contract_version,date '2097-01-16',time '15:00',false,'later boundary',gen_random_uuid()
  );
  insert into long_stay_outing_inventory_qa_result values(
    'O_EXPECTED_RETURN_LATER',
    exists(select 1 from public.hotel_capacity_reservations where id=future_capacity_id
      and reserved_from=timestamptz '2097-01-16 15:00+09'),null
  );
  select version into contract_version from public.long_stay_contracts where id=contract_id;
  perform public.set_long_stay_absence_expected_return_v2(
    contract_id,contract_version,date '2097-01-15',time '15:00',false,'earlier boundary',gen_random_uuid()
  );
  insert into long_stay_outing_inventory_qa_result values(
    'P_EXPECTED_RETURN_EARLIER',
    exists(select 1 from public.hotel_capacity_reservations where id=future_capacity_id
      and reserved_from=timestamptz '2097-01-15 15:00+09'),null
  );
  failure_state:=null;
  select version into contract_version from public.long_stay_contracts where id=contract_id;
  begin
    perform public.set_long_stay_absence_expected_return_v2(
      contract_id,contract_version,null,null,true,'unknown forbidden',gen_random_uuid()
    );
  exception when others then failure_state:=sqlstate; end;
  insert into long_stay_outing_inventory_qa_result values(
    'R_RELEASED_DATE_UNKNOWN_CHANGE_REJECT',failure_state='22023',failure_state
  );

  -- E/G: actual Hotel and Daycare creates succeed wholly inside the sellable gap.
  begin
    select dog.customer_id into customer_id from public.dogs dog where dog.id=dog_ids[2];
    hotel_json:=public.create_flexible_hotel_reservation(
      hotel_calendar,hotel_schedule_type,date '2097-01-13',time '10:00',false,
      date '2097-01-14',time '11:00',false,room_type_id,dog_ids[2],customer_id,
      array[actor_id],'OUTING GAP HOTEL QA',gen_random_uuid()
    );
    if hotel_json->>'id' is null then raise exception 'STOP_E_GAP_HOTEL'; end if;
    raise exception 'ROLLBACK_E_GAP_HOTEL' using errcode='PZ001';
  exception when sqlstate 'PZ001' then
    insert into long_stay_outing_inventory_qa_result values('E_HOTEL_GAP_BOOKING',true,null);
  end;
  begin
    select dog.customer_id into customer_id from public.dogs dog where dog.id=dog_ids[2];
    daycare_json:=public.create_daycare_reservation(
      daycare_calendar,daycare_schedule_type,customer_id,dog_ids[2],date '2097-01-14',
      time '10:00',time '12:00',room_type_id,null,array[actor_id],
      'OUTING GAP DAYCARE QA',gen_random_uuid()
    );
    if daycare_json->>'operationScheduleId' is null then raise exception 'STOP_G_GAP_DAYCARE'; end if;
    raise exception 'ROLLBACK_G_GAP_DAYCARE' using errcode='PZ002';
  exception when sqlstate 'PZ002' then
    insert into long_stay_outing_inventory_qa_result values('G_DAYCARE_GAP_BOOKING',true,null);
  end;

  -- M/Q: two legitimate gap bookings fill capacity; early guarantee/return must fail atomically.
  begin
    select dog.customer_id into customer_id from public.dogs dog where dog.id=dog_ids[2];
    perform public.create_flexible_hotel_reservation(
      hotel_calendar,hotel_schedule_type,date '2097-01-14',time '10:00',false,
      date '2097-01-15',time '14:00',false,room_type_id,dog_ids[2],customer_id,
      array[actor_id],'EARLY CONFLICT 1',gen_random_uuid()
    );
    select dog.customer_id into customer_id from public.dogs dog where dog.id=dog_ids[3];
    perform public.create_flexible_hotel_reservation(
      hotel_calendar,hotel_schedule_type,date '2097-01-14',time '10:00',false,
      date '2097-01-15',time '14:00',false,room_type_id,dog_ids[3],customer_id,
      array[actor_id],'EARLY CONFLICT 2',gen_random_uuid()
    );
    select version into contract_version from public.long_stay_contracts where id=contract_id;
    boundary_before:=(select reserved_from from public.hotel_capacity_reservations where id=future_capacity_id);
    begin
      perform public.set_long_stay_absence_expected_return_v2(
        contract_id,contract_version,date '2097-01-14',time '12:00',false,'conflict earlier',gen_random_uuid()
      );
      raise exception 'STOP_Q_EXPECTED_RETURN_CONFLICT_NOT_REJECTED';
    exception when check_violation or exclusion_violation then null; end;
    if (select reserved_from from public.hotel_capacity_reservations where id=future_capacity_id)<>boundary_before then
      raise exception 'STOP_Q_BOUNDARY_CHANGED';
    end if;
    select version into contract_version from public.long_stay_contracts where id=contract_id;
    begin
      perform public.complete_long_stay_absence_v2(
        contract_id,contract_version,timestamptz '2097-01-14 12:00+09',room_1,
        'early conflict','early conflict',gen_random_uuid()
      );
      raise exception 'STOP_M_EARLY_RETURN_CONFLICT_NOT_REJECTED';
    exception when check_violation or exclusion_violation then null; end;
    raise exception 'ROLLBACK_MQ' using errcode='PZ003';
  exception when sqlstate 'PZ003' then
    insert into long_stay_outing_inventory_qa_result values('M_EARLY_RETURN_CONFLICT',true,null);
    insert into long_stay_outing_inventory_qa_result values('Q_EXPECTED_RETURN_CONFLICT',true,null);
  end;

  -- A real future Hotel capacity fills the second slot and previous physical room.
  select dog.customer_id into customer_id from public.dogs dog where dog.id=dog_ids[2];
  hotel_json:=public.create_flexible_hotel_reservation(
    hotel_calendar,hotel_schedule_type,date '2097-01-15',time '15:00',false,
    date '2097-01-20',time '11:00',false,room_type_id,dog_ids[2],customer_id,
    array[actor_id],'RETURN BOUNDARY BLOCKER',gen_random_uuid()
  );
  blocker_stay_id:=(hotel_json->>'id')::uuid;
  select version into blocker_stay_version from public.hotel_stays where id=blocker_stay_id;
  perform public.assign_hotel_room(
    blocker_stay_id,blocker_stay_version,room_1,'occupy previous room',gen_random_uuid()
  );

  -- F/H: a third capacity crossing the guarantee boundary is rejected.
  failure_state:=null;
  select dog.customer_id into customer_id from public.dogs dog where dog.id=dog_ids[3];
  begin
    perform public.create_flexible_hotel_reservation(
      hotel_calendar,hotel_schedule_type,date '2097-01-15',time '14:00',false,
      date '2097-01-16',time '11:00',false,room_type_id,dog_ids[3],customer_id,
      array[actor_id],'RETURN BOUNDARY HOTEL',gen_random_uuid()
    );
  exception when others then failure_state:=sqlstate; end;
  insert into long_stay_outing_inventory_qa_result values(
    'F_HOTEL_RETURN_BOUNDARY_BLOCK',failure_state in ('23514','23P01'),failure_state
  );
  failure_state:=null;
  begin
    perform public.create_daycare_reservation(
      daycare_calendar,daycare_schedule_type,customer_id,dog_ids[3],date '2097-01-15',
      time '10:00',time '18:00',room_type_id,null,array[actor_id],
      'RETURN BOUNDARY DAYCARE',gen_random_uuid()
    );
  exception when others then failure_state:=sqlstate; end;
  insert into long_stay_outing_inventory_qa_result values(
    'H_DAYCARE_RETURN_BOUNDARY_BLOCK',failure_state in ('23514','23P01'),failure_state
  );

  -- K: wrong type cannot be selected for return.
  failure_state:=null;
  select version into contract_version from public.long_stay_contracts where id=contract_id;
  begin
    perform public.complete_long_stay_absence_v2(
      contract_id,contract_version,timestamptz '2097-01-15 15:00+09',wrong_room,
      'wrong type','wrong type',gen_random_uuid()
    );
  exception when others then failure_state:=sqlstate; end;
  insert into long_stay_outing_inventory_qa_result values(
    'K_WRONG_ROOM_TYPE_REJECT',failure_state='22023',failure_state
  );

  -- X: every checkout path is blocked while the room is released.
  failure_state:=null;
  begin
    update public.hotel_stays
    set checked_out_at=timestamptz '2097-01-15 15:00+09',checked_out_by=actor_id
    where id=stay_id;
  exception when others then failure_state:=sqlstate; end;
  insert into long_stay_outing_inventory_qa_result values(
    'X_RELEASED_CHECKOUT_BLOCK',failure_state='22023',failure_state
  );

  -- I/J: previous room is suggested but unavailable; alternate same-type room succeeds.
  rooms_json:=public.get_long_stay_return_room_availability(
    contract_id,timestamptz '2097-01-15 15:00+09'
  );
  insert into long_stay_outing_inventory_qa_result values(
    'I_PREVIOUS_ROOM_SUGGESTION',
    rooms_json->>'previousRoomId'=room_1::text
      and exists(select 1 from jsonb_array_elements(rooms_json->'rooms') room
        where room->>'roomId'=room_1::text and (room->>'isPreviousRoom')::boolean
          and not (room->>'available')::boolean),
    null
  );
  select version into contract_version from public.long_stay_contracts where id=contract_id;
  result_json:=public.complete_long_stay_absence_v2(
    contract_id,contract_version,timestamptz '2097-01-15 15:00+09',room_2,
    'alternate return','alternate return',gen_random_uuid()
  );
  select event.returned_allocation_id into returned_allocation_id
  from public.long_stay_absence_events event where event.id=leave_id;
  insert into long_stay_outing_inventory_qa_result values(
    'J_ALTERNATE_ROOM_RETURN',
    exists(select 1 from public.hotel_room_allocations where id=returned_allocation_id
      and room_id=room_2 and allocated_from=timestamptz '2097-01-15 15:00+09'
      and allocated_until='infinity'::timestamptz),null
  );
  insert into long_stay_outing_inventory_qa_result values(
    'W_ONE_CURRENT_ALLOCATION',
    (select count(*)=1 from public.hotel_room_allocations allocation
      join public.hotel_capacity_reservations capacity on capacity.id=allocation.capacity_reservation_id
      where capacity.hotel_stay_id=stay_id and capacity.archived_at is null
        and allocation.archived_at is null and allocation.allocated_until='infinity'::timestamptz),null
  );

  -- L: a later episode can return early when capacity and the selected room are free.
  select version into contract_version from public.long_stay_contracts where id=contract_id;
  perform public.start_long_stay_absence_v3(
    contract_id,contract_version,timestamptz '2097-01-20 12:00+09',date '2097-01-22',time '15:00',false,
    'release_room','early return episode','early return episode',gen_random_uuid()
  );
  select version into contract_version from public.long_stay_contracts where id=contract_id;
  perform public.complete_long_stay_absence_v2(
    contract_id,contract_version,timestamptz '2097-01-21 15:00+09',room_1,
    'early return','early return',gen_random_uuid()
  );
  insert into long_stay_outing_inventory_qa_result values(
    'L_EARLY_RETURN_AVAILABLE',
    exists(select 1 from public.hotel_room_allocations allocation
      join public.hotel_capacity_reservations capacity on capacity.id=allocation.capacity_reservation_id
      where capacity.hotel_stay_id=stay_id and capacity.archived_at is null
        and allocation.room_id=room_1 and allocation.allocated_from=timestamptz '2097-01-21 15:00+09'
        and allocation.allocated_until='infinity'::timestamptz),null
  );

  -- N/T: late return keeps the guarantee; a stale update remains PT409.
  select version into contract_version from public.long_stay_contracts where id=contract_id;
  perform public.start_long_stay_absence_v3(
    contract_id,contract_version,timestamptz '2097-01-22 10:00+09',date '2097-01-24',time '15:00',false,
    'release_room','late return episode','late return episode',gen_random_uuid()
  );
  select return_capacity_id into future_capacity_id from public.long_stay_absence_events
  where long_stay_contract_id=contract_id and event_type='leave' and is_open;
  failure_state:=null;
  begin
    perform public.set_long_stay_absence_expected_return_v2(
      contract_id,contract_version-1,date '2097-01-25',time '15:00',false,'stale',gen_random_uuid()
    );
  exception when others then failure_state:=sqlstate; end;
  insert into long_stay_outing_inventory_qa_result values(
    'T_STALE_VERSION_PT409',failure_state='PT409',failure_state
  );
  select version into contract_version from public.long_stay_contracts where id=contract_id;
  perform public.complete_long_stay_absence_v2(
    contract_id,contract_version,timestamptz '2097-01-25 15:00+09',room_1,
    'late return','late return',gen_random_uuid()
  );
  insert into long_stay_outing_inventory_qa_result values(
    'N_LATE_RETURN_PRESERVES_GUARANTEE',
    exists(select 1 from public.hotel_capacity_reservations where id=future_capacity_id
      and reserved_from=timestamptz '2097-01-24 15:00+09'
      and reserved_until='infinity'::timestamptz),null
  );
end;
$$;

select case when bool_and(passed) and count(*)=25
  then 'LONG_STAY_OUTING_INVENTORY_RUNTIME_QA_READY'
  else 'STOP_LONG_STAY_OUTING_INVENTORY_RUNTIME_QA' end status,
  count(*) scenario_count,
  jsonb_object_agg(scenario,jsonb_build_object('passed',passed,'detail',detail) order by scenario) scenarios
from long_stay_outing_inventory_qa_result;

rollback;
