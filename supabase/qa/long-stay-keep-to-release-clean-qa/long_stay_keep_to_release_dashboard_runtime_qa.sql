-- GENERATED FILE: do not edit or assemble by hand.
-- Dashboard target: clean-qa
-- Dashboard phase: RUNTIME_QA
-- Production ref: zorvcuskzemehblqdbfj
-- Clean QA ref: wxbvwixoeczfvbqurdse
-- Approved migration SHA-256: 706bf28a5f497d41db065b73f033a0dfefc196cc13661fb889e51a5b52e4d731
-- Embedded source SHA-256: bd0c1ebc010bf32330534aa9d29fa589849ae18ae50edda5b44ccb8f6e1ad41d
-- ISOLATED CLEAN QA ONLY. All fixture and ledger changes are rolled back.
begin;
-- CLEAN_QA_DASHBOARD_BINDING_BEGIN
select set_config('app.release_project_ref','wxbvwixoeczfvbqurdse',true);
select set_config('app.release_migration_sha256','706bf28a5f497d41db065b73f033a0dfefc196cc13661fb889e51a5b52e4d731',true);
do $dashboard_binding$
begin
  if current_database()<>'postgres' or current_user<>'postgres'
    or current_setting('app.release_project_ref',true) is distinct from 'wxbvwixoeczfvbqurdse'
    or current_setting('app.release_project_ref',true)='zorvcuskzemehblqdbfj'
    or current_setting('app.release_migration_sha256',true) is distinct from '706bf28a5f497d41db065b73f033a0dfefc196cc13661fb889e51a5b52e4d731'
    or to_regprocedure('hotel_qa.assert_isolated_environment()') is null then
    raise exception 'STOP_LONG_STAY_KEEP_TO_RELEASE_CLEAN_QA_DASHBOARD_BINDING';
  end if;
  perform hotel_qa.assert_isolated_environment();
end;
$dashboard_binding$;
-- CLEAN_QA_DASHBOARD_BINDING_END

select hotel_qa.assert_isolated_environment();

select set_config('request.jwt.claim.sub',(
  select profile.id::text from public.profiles profile
  join public.operation_memberships membership on membership.profile_id=profile.id
  where profile.role='admin' and profile.is_active and profile.account_status='active'
    and membership.role='owner' and membership.is_active
  order by profile.created_at limit 1
),true);
select set_config('request.jwt.claim.role','authenticated',true);

create temporary table long_stay_keep_to_release_qa_result(
  scenario text primary key,passed boolean not null,detail text null
) on commit drop;

do $$
declare actor_id uuid:=auth.uid(); dog_ids uuid[]; customer_id uuid; contract_customer_id uuid;
declare dog_id uuid; hotel_calendar uuid; hotel_schedule_type uuid;
declare room_type_id uuid:=gen_random_uuid(); room_1 uuid:=gen_random_uuid(); room_2 uuid:=gen_random_uuid();
declare contract_json jsonb; result_json jsonb; blocker_json jsonb; rooms_json jsonb;
declare contract_id uuid; stay_id uuid; blocker_stay_id uuid; contract_version integer; blocker_version integer;
declare old_capacity_id uuid; old_allocation_id uuid; future_capacity_id uuid; leave_id uuid;
declare release_at_value timestamptz; guarantee_value timestamptz; original_return_date date;
declare request_id uuid:=gen_random_uuid(); failure_state text; version_after integer;
declare service_month date:=(date_trunc('month',transaction_timestamp() at time zone 'Asia/Seoul'))::date;
declare physical_start date:=((transaction_timestamp() at time zone 'Asia/Seoul')::date-2);
declare return_date date:=((transaction_timestamp() at time zone 'Asia/Seoul')::date+3);
begin
  if actor_id is null or not public.is_active_operation_member() then raise exception 'STOP_KEEP_TO_RELEASE_QA_ACTOR'; end if;
  select array_agg(selected.id order by selected.created_at,selected.id) into dog_ids
  from (select dog.id,dog.created_at from public.dogs dog join public.customers customer on customer.id=dog.customer_id
    where dog.is_active and customer.is_active and not exists(select 1 from public.long_stay_contracts contract
      where contract.dog_id=dog.id and contract.status in ('pending','active') and contract.archived_at is null)
    order by dog.created_at,dog.id limit 2) selected;
  if cardinality(coalesce(dog_ids,'{}'::uuid[]))<2 then raise exception 'STOP_KEEP_TO_RELEASE_QA_DOGS'; end if;
  dog_id:=dog_ids[1];
  select dog.customer_id into contract_customer_id from public.dogs dog where dog.id=dog_id;
  select calendar.id,mapping.schedule_type_id into hotel_calendar,hotel_schedule_type
  from public.operation_calendars calendar
  join public.business_units unit on unit.id=calendar.business_unit_id and unit.code='hotel'
  join public.operation_calendar_schedule_types mapping on mapping.calendar_id=calendar.id and mapping.is_active and mapping.archived_at is null
  where calendar.is_active order by calendar.sort_order,mapping.created_at limit 1;

  insert into public.hotel_room_types(id,code,name,is_active,sort_order,created_by,updated_by)
  values(room_type_id,'QA_KEEP_RELEASE_'||upper(substr(replace(room_type_id::text,'-',''),1,8)),
    'QA Keep Release',true,9910,actor_id,actor_id);
  insert into public.hotel_rooms(id,room_type_id,name,is_active,sort_order,created_by,updated_by)
  values(room_1,room_type_id,'QA Keep Release 1',true,9910,actor_id,actor_id);

  contract_json:=public.create_long_stay_contract(contract_customer_id,dog_id,physical_start,null,
    room_type_id,room_1,1000000,17,'LONG_STAY_KEEP_TO_RELEASE_RUNTIME_QA_202608140004',gen_random_uuid());
  contract_id:=(contract_json->>'id')::uuid;
  select version into contract_version from public.long_stay_contracts where id=contract_id;
  contract_json:=public.confirm_long_stay_month_v2(contract_id,contract_version,service_month,physical_start,
    hotel_calendar,hotel_schedule_type,time '00:01',false,room_type_id,room_1,array[actor_id],
    'Keep to release QA',gen_random_uuid());
  stay_id:=(contract_json->>'hotelStayId')::uuid;
  select version into blocker_version from public.hotel_stays where id=stay_id;
  perform public.complete_hotel_check_in(stay_id,blocker_version,transaction_timestamp()-interval '1 day',gen_random_uuid());
  select version into contract_version from public.long_stay_contracts where id=contract_id;
  result_json:=public.start_long_stay_absence_v3(contract_id,contract_version,
    transaction_timestamp()-interval '1 hour',return_date,null,true,'keep_room',null,'KEEP outing',gen_random_uuid());
  leave_id:=(result_json->'currentAbsence'->>'id')::uuid;
  select id into old_capacity_id from public.hotel_capacity_reservations
    where hotel_stay_id=stay_id and archived_at is null;
  select id into old_allocation_id from public.hotel_room_allocations
    where capacity_reservation_id=old_capacity_id and archived_at is null and allocated_until='infinity'::timestamptz;

  -- F: an unknown date fails before any inventory change.
  select expected_return_date into original_return_date from public.long_stay_absence_events where id=leave_id;
  update public.long_stay_absence_events set expected_return_date=null where id=leave_id;
  select version into contract_version from public.long_stay_contracts where id=contract_id;
  failure_state:=null;
  begin perform public.release_long_stay_room_during_absence(contract_id,contract_version,'date unknown',gen_random_uuid());
  exception when others then failure_state:=sqlstate; end;
  update public.long_stay_absence_events set expected_return_date=original_return_date where id=leave_id;
  insert into long_stay_keep_to_release_qa_result values('F_DATE_UNKNOWN_REJECT',failure_state='22023',failure_state);

  -- G: filling the only room-type capacity at return rolls the transition back.
  insert into public.hotel_rooms(id,room_type_id,name,is_active,sort_order,created_by,updated_by)
  values(room_2,room_type_id,'QA Keep Release 2',true,9911,actor_id,actor_id);
  begin
    select dog.customer_id into customer_id from public.dogs dog where dog.id=dog_ids[2];
    blocker_json:=public.create_flexible_hotel_reservation(hotel_calendar,hotel_schedule_type,
      return_date,time '00:00',false,return_date+1,time '23:59',false,room_type_id,
      dog_ids[2],customer_id,array[actor_id],'KEEP TO RELEASE CAPACITY BLOCKER',gen_random_uuid());
    update public.hotel_rooms set is_active=false where id=room_2;
    select version into contract_version from public.long_stay_contracts where id=contract_id;
    begin
      perform public.release_long_stay_room_during_absence(contract_id,contract_version,'must conflict',gen_random_uuid());
      raise exception 'STOP_EXPECTED_KEEP_TO_RELEASE_CAPACITY_CONFLICT';
    exception when check_violation then
      if not exists(select 1 from public.hotel_capacity_reservations where id=old_capacity_id and archived_at is null and reserved_until='infinity'::timestamptz)
        or not exists(select 1 from public.hotel_room_allocations where id=old_allocation_id and allocated_until='infinity'::timestamptz) then
        raise exception 'STOP_KEEP_TO_RELEASE_CONFLICT_PARTIAL_MUTATION';
      end if;
      raise exception 'ROLLBACK_KEEP_TO_RELEASE_BLOCKER' using errcode='PZ001';
    end;
  exception when sqlstate 'PZ001' then
    insert into long_stay_keep_to_release_qa_result values('G_CAPACITY_CONFLICT_ROLLBACK',true,null);
  end;

  select version into contract_version from public.long_stay_contracts where id=contract_id;
  result_json:=public.release_long_stay_room_during_absence(contract_id,contract_version,'operator release',request_id);
  select released_capacity_id,released_allocation_id,return_capacity_id,guarantee_from
    into old_capacity_id,old_allocation_id,future_capacity_id,guarantee_value
  from public.long_stay_absence_events where id=leave_id;
  select allocated_until into release_at_value from public.hotel_room_allocations where id=old_allocation_id;
  select version into version_after from public.long_stay_contracts where id=contract_id;

  insert into long_stay_keep_to_release_qa_result values('A_KEEP_TO_RELEASE_SUCCESS',result_json->'currentAbsence'->>'inventoryMode'='release_room',null);
  insert into long_stay_keep_to_release_qa_result values('B_OLD_ALLOCATION_END',release_at_value=transaction_timestamp(),null);
  insert into long_stay_keep_to_release_qa_result values('C_OLD_CAPACITY_END',exists(select 1 from public.hotel_capacity_reservations where id=old_capacity_id and reserved_until=release_at_value and archived_at is not null),null);
  insert into long_stay_keep_to_release_qa_result values('D_FUTURE_CAPACITY',exists(select 1 from public.hotel_capacity_reservations where id=future_capacity_id and reserved_from=guarantee_value and reserved_until='infinity'::timestamptz),null);
  insert into long_stay_keep_to_release_qa_result values('E_TIME_UNKNOWN_BOUNDARY',guarantee_value=return_date::timestamp at time zone 'Asia/Seoul',null);
  insert into long_stay_keep_to_release_qa_result values('H_ROOM_BOARD_RELEASE',not exists(select 1 from public.hotel_room_allocations where room_id=room_1 and archived_at is null and allocated_until>transaction_timestamp()),null);
  insert into long_stay_keep_to_release_qa_result values('I_OUTING_PRESERVED',exists(select 1 from public.long_stay_absence_events where id=leave_id and is_open and inventory_transition_status='room_released'),null);
  insert into long_stay_keep_to_release_qa_result values('J_PREVIOUS_ROOM_PROVENANCE',exists(select 1 from public.long_stay_absence_events where id=leave_id and previous_room_id=room_1 and released_allocation_id=old_allocation_id),null);
  insert into long_stay_keep_to_release_qa_result values('K_RELEASE_FLOW_CONVERGENCE',result_json->'currentAbsence'->>'returnRoomTypeId'=room_type_id::text,null);

  rooms_json:=public.get_long_stay_return_room_availability(contract_id,guarantee_value+interval '1 hour');
  insert into long_stay_keep_to_release_qa_result values('L_PREVIOUS_ROOM_SUGGESTED',exists(select 1 from jsonb_array_elements(rooms_json->'rooms') room where room->>'roomId'=room_1::text and (room->>'isPreviousRoom')::boolean and (room->>'available')::boolean),null);

  select version into contract_version from public.long_stay_contracts where id=contract_id;
  perform public.set_long_stay_absence_expected_return_v2(contract_id,contract_version,return_date+1,null,true,'move boundary',gen_random_uuid());
  insert into long_stay_keep_to_release_qa_result values('N_EXPECTED_RETURN_CHANGE',exists(select 1 from public.hotel_capacity_reservations where id=future_capacity_id and reserved_from=(return_date+1)::timestamp at time zone 'Asia/Seoul'),null);

  result_json:=public.release_long_stay_room_during_absence(contract_id,contract_version,'operator release',request_id);
  insert into long_stay_keep_to_release_qa_result values('Q_REPLAY',coalesce((result_json->>'replayed')::boolean,false),null);
  failure_state:=null;
  begin perform public.release_long_stay_room_during_absence(contract_id,contract_version,'stale',gen_random_uuid());
  exception when others then failure_state:=sqlstate; end;
  insert into long_stay_keep_to_release_qa_result values('R_STALE_VERSION',failure_state='PT409',failure_state);
  failure_state:=null;
  select version into version_after from public.long_stay_contracts where id=contract_id;
  begin perform public.release_long_stay_room_during_absence(contract_id,version_after,'duplicate',gen_random_uuid());
  exception when others then failure_state:=sqlstate; end;
  insert into long_stay_keep_to_release_qa_result values('S_DOUBLE_INVOCATION',failure_state='22023' and (select count(*) from public.hotel_capacity_reservations where hotel_stay_id=stay_id and archived_at is null)=1,failure_state);
  insert into long_stay_keep_to_release_qa_result values('T_ALREADY_RELEASE_NO_DUPLICATE',(select count(*) from public.hotel_capacity_reservations where hotel_stay_id=stay_id and archived_at is null)=1,null);
  insert into long_stay_keep_to_release_qa_result values('U_KEEP_ROOM_LEGACY_UNCHANGED',to_regprocedure('public.start_long_stay_absence_v2(uuid,integer,timestamp with time zone,date,time without time zone,boolean,text,text,uuid)') is not null,null);

  -- The canonical return RPC is shared by direct RELEASE_ROOM and transitioned outings.
  select version into contract_version from public.long_stay_contracts where id=contract_id;
  result_json:=public.complete_long_stay_absence_v2(contract_id,contract_version,
    (return_date+1)::timestamp at time zone 'Asia/Seoul'+interval '2 hour',room_1,null,'late return',gen_random_uuid());
  insert into long_stay_keep_to_release_qa_result values('M_ALTERNATE_ROOM_CONTRACT',result_json->'currentAbsence'='null'::jsonb,null);
  insert into long_stay_keep_to_release_qa_result values('O_EARLY_RETURN_CONTRACT',position('p_returned_at<capacity_row.reserved_from' in pg_get_functiondef('public.complete_long_stay_absence_v2(uuid,integer,timestamp with time zone,uuid,text,text,uuid)'::regprocedure))>0,null);
  insert into long_stay_keep_to_release_qa_result values('P_LATE_RETURN',not exists(select 1 from public.long_stay_absence_events where id=leave_id and is_open),null);
end;
$$;

do $$ begin
  if (select count(*) from long_stay_keep_to_release_qa_result)<>21
    or exists(select 1 from long_stay_keep_to_release_qa_result where not passed) then
    raise exception 'STOP_LONG_STAY_KEEP_TO_RELEASE_RUNTIME_QA: %',(
      select coalesce(string_agg(scenario||coalesce('['||detail||']',''),',' order by scenario),'scenario_count='||(select count(*) from long_stay_keep_to_release_qa_result)::text)
      from long_stay_keep_to_release_qa_result where not passed
    );
  end if;
end $$;

select scenario,passed,detail from long_stay_keep_to_release_qa_result order by scenario;
rollback;
