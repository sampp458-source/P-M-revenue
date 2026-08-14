-- GENERATED FILE: do not edit or assemble by hand.
-- Dashboard phase: RUNTIME_A_M
-- Clean QA exact project: wxbvwixoeczfvbqurdse
-- Production project zorvcuskzemehblqdbfj is rejected before any mutation.
-- Approved migration SHA-256: 5743b1c3be65031bf38284be72b1ce4ed4c8c0f8be002f07bbb417f07e99fec6
-- Embedded source SHA-256: fe45b5c69add60e69bfc4971506f92babc1246c25d5bc8be058dc5eb53b655c4
-- ISOLATED CLEAN QA ONLY. All mutations are rolled back.
begin;
-- DASHBOARD_BINDING_BEGIN
select set_config('app.release_project_ref','wxbvwixoeczfvbqurdse',true);
select set_config('app.release_migration_sha256','5743b1c3be65031bf38284be72b1ce4ed4c8c0f8be002f07bbb417f07e99fec6',true);

do $clean_qa_dashboard_binding$
declare guard hotel_qa.environment_guard%rowtype;
begin
  if current_database()<>'postgres' or current_user<>'postgres'
    or current_setting('app.release_project_ref',true) is distinct from 'wxbvwixoeczfvbqurdse'
    or current_setting('app.release_project_ref',true)='zorvcuskzemehblqdbfj'
    or current_setting('app.release_migration_sha256',true) is distinct from '5743b1c3be65031bf38284be72b1ce4ed4c8c0f8be002f07bbb417f07e99fec6' then
    raise exception 'STOP_LONG_STAY_OUTING_CLEAN_QA_DASHBOARD_BINDING';
  end if;
  select * into guard from hotel_qa.environment_guard;
  if not found
    or guard.qa_project_ref<>'wxbvwixoeczfvbqurdse'
    or guard.production_project_ref<>'zorvcuskzemehblqdbfj'
    or guard.qa_project_ref=guard.production_project_ref then
    raise exception 'STOP_LONG_STAY_OUTING_CLEAN_QA_ENVIRONMENT';
  end if;
  perform hotel_qa.assert_isolated_environment();
end;
$clean_qa_dashboard_binding$;
-- DASHBOARD_BINDING_END

select hotel_qa.assert_isolated_environment();
create temporary table long_stay_outing_qa_result(
  check_name text primary key, passed boolean not null, detail text
) on commit drop;

do $$
declare actor_id uuid; customer_id uuid; dog_id uuid; calendar_id uuid; schedule_type_id uuid;
declare room_type_id uuid; room_id uuid; contract_json jsonb; month_json jsonb;
declare contract_id uuid; stay_id uuid; capacity_id uuid; allocation_id uuid;
declare contract_version integer; stay_version integer; request_id uuid; replay_json jsonb;
declare failure_state text; capacity_count integer; allocation_count integer;
begin
  select membership.profile_id into actor_id
  from public.operation_memberships membership join public.profiles profile on profile.id=membership.profile_id
  where membership.role='owner' and membership.is_active and profile.is_active and profile.account_status='active'
  order by membership.profile_id limit 1;
  select dog.customer_id,dog.id into customer_id,dog_id
  from public.dogs dog join public.customers customer on customer.id=dog.customer_id
  where dog.is_active and customer.is_active
    and not exists(select 1 from public.long_stay_contracts contract where contract.dog_id=dog.id and contract.status in ('pending','active') and contract.archived_at is null)
  order by dog.created_at,dog.id limit 1;
  select calendar.id,schedule_type.id into calendar_id,schedule_type_id
  from public.operation_calendars calendar join public.business_units unit on unit.id=calendar.business_unit_id
  join public.operation_calendar_schedule_types mapping on mapping.calendar_id=calendar.id and mapping.is_active and mapping.archived_at is null
  join public.operation_schedule_types schedule_type on schedule_type.id=mapping.schedule_type_id and schedule_type.is_active
  where unit.code='hotel' and unit.is_active and calendar.is_active order by calendar.id,schedule_type.id limit 1;
  select room_type.id,room.id into room_type_id,room_id
  from public.hotel_room_types room_type join public.hotel_rooms room on room.room_type_id=room_type.id
  where room_type.is_active and room_type.archived_at is null and room.is_active and room.archived_at is null
    and not exists(
      select 1 from public.hotel_room_allocations allocation
      where allocation.room_id=room.id and allocation.archived_at is null
        and allocation.allocated_until>timestamptz '2096-01-10 15:00+09'
        and allocation.allocated_from<'infinity'::timestamptz
    )
  order by room_type.sort_order,room.sort_order,room.id limit 1;
  if actor_id is null or dog_id is null or calendar_id is null or room_id is null then raise exception 'STOP_LONG_STAY_OUTING_QA_FIXTURE_MISSING'; end if;
  perform set_config('request.jwt.claim.sub',actor_id::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);

  contract_json:=public.create_long_stay_contract(customer_id,dog_id,date '2096-01-10',null,room_type_id,room_id,1000000,17,'LONG_STAY_OUTING_RUNTIME_QA_202608140002',gen_random_uuid());
  contract_id:=(contract_json->>'id')::uuid;
  select version into contract_version from public.long_stay_contracts where id=contract_id;
  contract_json:=public.confirm_long_stay_month_v2(contract_id,contract_version,date '2096-01-01',date '2096-01-10',calendar_id,schedule_type_id,time '15:00',false,room_type_id,room_id,array[actor_id],'Outing QA room',gen_random_uuid());
  stay_id:=(contract_json->>'hotelStayId')::uuid;
  select version into stay_version from public.hotel_stays where id=stay_id;
  -- Reproduce the Production integration path: generic Hotel check-in leaves the Long Stay aggregate pending.
  perform public.complete_hotel_check_in(stay_id,stay_version,timestamptz '2096-01-10 15:05+09',gen_random_uuid());
  insert into long_stay_outing_qa_result values('production_path_pending_after_generic_checkin',(select status='pending' from public.long_stay_contracts where id=contract_id),null);
  select id into capacity_id from public.hotel_capacity_reservations where hotel_stay_id=stay_id and archived_at is null;
  select id into allocation_id from public.hotel_room_allocations where capacity_reservation_id=capacity_id and archived_at is null and allocated_until='infinity'::timestamptz;
  select count(*) into capacity_count from public.hotel_capacity_reservations where hotel_stay_id=stay_id and archived_at is null;
  select count(*) into allocation_count from public.hotel_room_allocations where capacity_reservation_id=capacity_id and archived_at is null and allocated_until='infinity'::timestamptz;

  -- A: exact expected return; also repairs pending -> active from the linked checked-in Hotel runtime.
  select version into contract_version from public.long_stay_contracts where id=contract_id;
  request_id:=gen_random_uuid();
  contract_json:=public.start_long_stay_absence_v2(contract_id,contract_version,timestamptz '2096-01-11 10:00+09',date '2096-01-11',time '18:00',false,'exact','외출',request_id);
  insert into long_stay_outing_qa_result values('A_exact',(contract_json->'currentAbsence'->>'expectedReturnAt') is not null and contract_json->'currentAbsence'->>'expectedReturnDate'='2096-01-11' and not (contract_json->'currentAbsence'->>'expectedReturnTimeUnspecified')::boolean,null);
  insert into long_stay_outing_qa_result values('active_transition',(select status='active' from public.long_stay_contracts where id=contract_id),null);
  replay_json:=public.start_long_stay_absence_v2(contract_id,contract_version,timestamptz '2096-01-11 10:00+09',date '2096-01-11',time '18:00',false,'exact','외출',request_id);
  insert into long_stay_outing_qa_result values('F_replay',coalesce((replay_json->>'replayed')::boolean,false),null);
  begin
    perform public.start_long_stay_absence_v2(contract_id,contract_version-1,timestamptz '2096-01-11 10:05+09',null,null,true,null,'stale',gen_random_uuid());
  exception when others then failure_state:=sqlstate; end;
  insert into long_stay_outing_qa_result values('E_stale_pt409',failure_state='PT409',failure_state);
  failure_state:=null;
  select version into contract_version from public.long_stay_contracts where id=contract_id;
  begin
    perform public.start_long_stay_absence_v2(contract_id,contract_version,timestamptz '2096-01-11 10:05+09',null,null,true,null,'duplicate',gen_random_uuid());
  exception when others then failure_state:=sqlstate; end;
  insert into long_stay_outing_qa_result values('D_duplicate_rejected',failure_state='23505',failure_state);
  select version into contract_version from public.long_stay_contracts where id=contract_id;
  perform public.complete_long_stay_absence(contract_id,contract_version,timestamptz '2096-01-11 17:00+09','early','복귀',gen_random_uuid());
  insert into long_stay_outing_qa_result values('L_actual_return_earlier',(select occurred_at=timestamptz '2096-01-11 17:00+09' from public.long_stay_absence_events where long_stay_contract_id=contract_id and event_type='return' order by occurred_at desc limit 1),null);

  -- B: date known, time unknown; actual return may be later.
  select version into contract_version from public.long_stay_contracts where id=contract_id;
  contract_json:=public.start_long_stay_absence_v2(contract_id,contract_version,timestamptz '2096-01-12 09:00+09',date '2096-01-12',null,true,'time unknown','외출',gen_random_uuid());
  insert into long_stay_outing_qa_result values('B_time_unknown',contract_json->'currentAbsence'->>'expectedReturnAt' is null and contract_json->'currentAbsence'->>'expectedReturnDate'='2096-01-12' and (contract_json->'currentAbsence'->>'expectedReturnTimeUnspecified')::boolean,null);
  select version into contract_version from public.long_stay_contracts where id=contract_id;
  perform public.complete_long_stay_absence(contract_id,contract_version,timestamptz '2096-01-13 01:00+09','late','복귀',gen_random_uuid());
  insert into long_stay_outing_qa_result values('K_actual_return_later',(select occurred_at=timestamptz '2096-01-13 01:00+09' from public.long_stay_absence_events where long_stay_contract_id=contract_id and event_type='return' order by occurred_at desc limit 1),null);

  -- C/H: date unknown and a second subsequent outing both work.
  select version into contract_version from public.long_stay_contracts where id=contract_id;
  contract_json:=public.start_long_stay_absence_v2(contract_id,contract_version,timestamptz '2096-01-13 10:00+09',null,null,true,'date unknown','외출',gen_random_uuid());
  insert into long_stay_outing_qa_result values('C_date_unknown',contract_json->'currentAbsence'->>'expectedReturnAt' is null and contract_json->'currentAbsence'->>'expectedReturnDate' is null and (contract_json->'currentAbsence'->>'expectedReturnTimeUnspecified')::boolean,null);
  insert into long_stay_outing_qa_result values('H_second_outing',(select count(*)=3 from public.long_stay_absence_events where long_stay_contract_id=contract_id and event_type='leave'),null);
  select version into contract_version from public.long_stay_contracts where id=contract_id;
  perform public.complete_long_stay_absence(contract_id,contract_version,timestamptz '2096-01-13 12:00+09','return','복귀',gen_random_uuid());
  insert into long_stay_outing_qa_result values('G_return_in_house',not (public.long_stay_contract_projection_internal(contract_id)->>'isAway')::boolean,null);

  -- M: legacy expected_return_at-only writes remain readable through V2.
  select version into contract_version from public.long_stay_contracts where id=contract_id;
  perform public.start_long_stay_absence(contract_id,contract_version,timestamptz '2096-01-14 10:00+09',timestamptz '2096-01-14 18:00+09','legacy','외출',gen_random_uuid());
  month_json:=public.get_long_stay_month_v2(date '2096-01-01');
  insert into long_stay_outing_qa_result values('M_legacy_read',exists(select 1 from jsonb_array_elements(month_json->'contracts') item where item->>'id'=contract_id::text and item->'currentAbsence'->>'expectedReturnDate'='2096-01-14' and not (item->'currentAbsence'->>'expectedReturnTimeUnspecified')::boolean),null);

  insert into long_stay_outing_qa_result values('I_allocation_preserved',(select count(*)=allocation_count and bool_and(id=allocation_id and allocated_until='infinity'::timestamptz) from public.hotel_room_allocations where capacity_reservation_id=capacity_id and archived_at is null and allocated_until='infinity'::timestamptz),null);
  insert into long_stay_outing_qa_result values('J_capacity_preserved',(select count(*)=capacity_count and bool_and(id=capacity_id and reserved_until='infinity'::timestamptz) from public.hotel_capacity_reservations where hotel_stay_id=stay_id and archived_at is null),null);
end $$;

select case when bool_and(passed) and count(*)=15
  then 'LONG_STAY_OUTING_EXPECTED_RETURN_RUNTIME_QA_READY'
  else 'STOP_LONG_STAY_OUTING_EXPECTED_RETURN_RUNTIME_QA' end status,
  jsonb_object_agg(check_name,jsonb_build_object('passed',passed,'detail',detail) order by check_name) checks
from long_stay_outing_qa_result;
rollback;
