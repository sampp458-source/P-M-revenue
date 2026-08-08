-- ISOLATED CLEAN QA ONLY. All mutations are rolled back.
begin;
select hotel_qa.assert_isolated_environment();
create temporary table long_stay_platform_qa_result(
  check_name text primary key, passed boolean not null, detail text
) on commit drop;

do $$
declare actor_id uuid; customer_id uuid; dog_id uuid; calendar_id uuid; schedule_type_id uuid;
declare room_type_id uuid; room_id uuid; contract_json jsonb; contract_id uuid; stay_id uuid;
declare contract_version integer; stay_version integer; month_id uuid; replay_json jsonb;
declare capacity_id uuid; allocation_id uuid; leave_request uuid:=gen_random_uuid();
declare read_json jsonb; request_create uuid:=gen_random_uuid(); request_month uuid:=gen_random_uuid();
declare other_payload_state text; invariant_state text; before_absence jsonb; after_absence jsonb;
begin
  select membership.profile_id into actor_id from public.operation_memberships membership
  join public.profiles profile on profile.id=membership.profile_id
  where membership.role='owner' and membership.is_active and profile.is_active
    and profile.account_status='active' order by membership.profile_id limit 1;
  select dog.customer_id,dog.id into customer_id,dog_id from public.dogs dog
  join public.customers customer on customer.id=dog.customer_id
  where dog.is_active and customer.is_active order by dog.created_at,dog.id limit 1;
  select calendar.id,schedule_type.id into calendar_id,schedule_type_id
  from public.operation_calendars calendar join public.business_units unit on unit.id=calendar.business_unit_id
  join public.operation_calendar_schedule_types mapping on mapping.calendar_id=calendar.id and mapping.is_active and mapping.archived_at is null
  join public.operation_schedule_types schedule_type on schedule_type.id=mapping.schedule_type_id and schedule_type.is_active
  where unit.code='hotel' and unit.is_active and calendar.is_active order by calendar.id,schedule_type.id limit 1;
  select rt.id,room.id into room_type_id,room_id from public.hotel_room_types rt
  join public.hotel_rooms room on room.room_type_id=rt.id
  where rt.code='STANDARD' and rt.is_active and rt.archived_at is null
    and room.is_active and room.archived_at is null order by room.sort_order,room.id limit 1;
  if actor_id is null or dog_id is null or calendar_id is null or room_id is null then raise exception 'STOP_LONG_STAY_QA_FIXTURE_MISSING'; end if;
  perform set_config('request.jwt.claim.sub',actor_id::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);

  contract_json:=public.create_long_stay_contract(customer_id,dog_id,date '2095-01-10',null,room_type_id,room_id,1000000,17,'Long Stay QA',request_create);
  contract_id:=(contract_json->>'id')::uuid;
  insert into long_stay_platform_qa_result values('create_contract',contract_id is not null and contract_json->>'storedStatus'='pending',contract_json::text);
  replay_json:=public.create_long_stay_contract(customer_id,dog_id,date '2095-01-10',null,room_type_id,room_id,1000000,17,'Long Stay QA',request_create);
  insert into long_stay_platform_qa_result values('create_replay',coalesce((replay_json->>'replayed')::boolean,false),null);
  begin perform public.create_long_stay_contract(customer_id,dog_id,date '2095-01-11',null,room_type_id,room_id,1000000,17,'Long Stay QA',request_create);
  exception when others then other_payload_state:=sqlstate; end;
  insert into long_stay_platform_qa_result values('different_payload_request_rejected',other_payload_state='23505',other_payload_state);

  select version into contract_version from public.long_stay_contracts where id=contract_id;
  contract_json:=public.confirm_long_stay_month(contract_id,contract_version,date '2095-01-01',calendar_id,schedule_type_id,time '15:00',false,room_type_id,room_id,array[actor_id],'첫 달 객실 확정',request_month);
  stay_id:=(contract_json->>'hotelStayId')::uuid;
  select id,reserved_until into capacity_id from public.hotel_capacity_reservations where hotel_stay_id=stay_id and archived_at is null;
  select id into allocation_id from public.hotel_room_allocations where capacity_reservation_id=capacity_id and archived_at is null and allocated_until='infinity'::timestamptz;
  select id into month_id from public.long_stay_monthly_occupancies where long_stay_contract_id=contract_id and service_month=date '2095-01-01' and archived_at is null;
  insert into long_stay_platform_qa_result values('monthly_runtime_open_ended',stay_id is not null and month_id is not null and capacity_id is not null and allocation_id is not null and (contract_json->>'isOpenEnded')::boolean,null);

  read_json:=public.get_long_stay_contract(contract_id);
  insert into long_stay_platform_qa_result values('read_projection_hides_infinity',read_json->'runtimeCapacityUntil'='null'::jsonb and read_json->'runtimeAllocationUntil'='null'::jsonb and read_json::text not like '%infinity%',read_json::text);

  select version into contract_version from public.long_stay_contracts where id=contract_id;
  select version into stay_version from public.hotel_stays where id=stay_id;
  perform public.complete_long_stay_check_in(contract_id,contract_version,stay_version,timestamptz '2095-01-10 15:05+09','실제 입실',gen_random_uuid());
  insert into long_stay_platform_qa_result values('check_in_active',(select status='active' from public.long_stay_contracts where id=contract_id),null);

  select version into contract_version from public.long_stay_contracts where id=contract_id;
  before_absence:=public.long_stay_contract_projection_internal(contract_id);
  perform public.start_long_stay_absence(contract_id,contract_version,timestamptz '2095-01-15 10:00+09',timestamptz '2095-01-15 18:00+09','산책','외출',leave_request);
  after_absence:=public.long_stay_contract_projection_internal(contract_id);
  insert into long_stay_platform_qa_result values('absence_preserves_runtime',(after_absence->>'isAway')::boolean and (select reserved_until='infinity'::timestamptz from public.hotel_capacity_reservations where id=capacity_id) and (select allocated_until='infinity'::timestamptz from public.hotel_room_allocations where id=allocation_id),null);
  select version into contract_version from public.long_stay_contracts where id=contract_id;
  perform public.complete_long_stay_absence(contract_id,contract_version,timestamptz '2095-01-15 17:40+09','복귀','복귀',gen_random_uuid());
  insert into long_stay_platform_qa_result values('absence_return',not (public.long_stay_contract_projection_internal(contract_id)->>'isAway')::boolean,null);

  select version into contract_version from public.long_stay_contracts where id=contract_id;
  perform public.set_long_stay_planned_checkout(contract_id,contract_version,date '2095-02-17',calendar_id,schedule_type_id,time '11:00',false,array[actor_id],'퇴실 예정 등록',gen_random_uuid());
  insert into long_stay_platform_qa_result values('planned_checkout_event',(select count(*)=1 from public.hotel_stay_schedule_events where hotel_stay_id=stay_id and event_kind='check_out' and archived_at is null) and (select reserved_until='infinity'::timestamptz from public.hotel_capacity_reservations where id=capacity_id),null);

  select version into contract_version from public.long_stay_contracts where id=contract_id;
  select version into stay_version from public.hotel_stays where id=stay_id;
  perform public.complete_long_stay_check_out(contract_id,contract_version,stay_version,timestamptz '2095-02-17 11:10+09','실제 퇴실',gen_random_uuid());
  insert into long_stay_platform_qa_result values('checkout_closes_runtime',(select status='completed' from public.long_stay_contracts where id=contract_id) and (select reserved_until=timestamptz '2095-02-17 11:10+09' from public.hotel_capacity_reservations where id=capacity_id) and not exists(select 1 from public.hotel_room_allocations where capacity_reservation_id=capacity_id and archived_at is null and allocated_until='infinity'::timestamptz),null);

  select version into contract_version from public.long_stay_contracts where id=contract_id;
  select version into stay_version from public.hotel_stays where id=stay_id;
  perform public.reverse_long_stay_completion(contract_id,contract_version,stay_version,'퇴실 취소',gen_random_uuid());
  insert into long_stay_platform_qa_result values('reverse_restores_runtime',(select status='active' from public.long_stay_contracts where id=contract_id) and (select reserved_until='infinity'::timestamptz from public.hotel_capacity_reservations where id=capacity_id) and exists(select 1 from public.hotel_room_allocations where capacity_reservation_id=capacity_id and archived_at is null and allocated_until='infinity'::timestamptz),null);

  begin update public.hotel_capacity_reservations
    set reserved_until=reserved_from+interval '1 day' where id=capacity_id;
    set constraints all immediate;
  exception when others then invariant_state:=sqlstate; end;
  insert into long_stay_platform_qa_result values('deferred_invariant_fail_closed',invariant_state='23514',invariant_state);
end $$;

select case when bool_and(passed) and count(*)=12
  then 'LONG_STAY_HOTEL_PLATFORM_TRANSACTION_QA_READY'
  else 'STOP_LONG_STAY_HOTEL_PLATFORM_TRANSACTION_QA' end status,
  jsonb_object_agg(check_name,jsonb_build_object('passed',passed,'detail',detail) order by check_name) checks
from long_stay_platform_qa_result;
rollback;
