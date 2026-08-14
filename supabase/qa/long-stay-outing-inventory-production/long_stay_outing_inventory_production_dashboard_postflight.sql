-- GENERATED FILE: do not edit or assemble by hand.
-- Dashboard phase: POSTFLIGHT
-- Production exact project: zorvcuskzemehblqdbfj
-- Clean QA project wxbvwixoeczfvbqurdse is rejected before any mutation.
-- Approved migration SHA-256: 6bd23b9c74d8d4ca7d2ff2a33f3c992f3f8d7adb6a6c6f26e56b92c41ebf7de9
-- Embedded source SHA-256: 4c86ba731ababf5b1dff0cdc8746a416bba7a210ea5ba602fa5ab12f9f4d5217
begin read only;
-- PRODUCTION_DASHBOARD_BINDING_BEGIN
select set_config('app.release_project_ref','zorvcuskzemehblqdbfj',true);
select set_config('app.release_migration_sha256','6bd23b9c74d8d4ca7d2ff2a33f3c992f3f8d7adb6a6c6f26e56b92c41ebf7de9',true);
do $production_dashboard_binding$
begin
  if current_database()<>'postgres' or current_user<>'postgres'
    or current_setting('app.release_project_ref',true) is distinct from 'zorvcuskzemehblqdbfj'
    or current_setting('app.release_project_ref',true)='wxbvwixoeczfvbqurdse'
    or current_setting('app.release_migration_sha256',true) is distinct from '6bd23b9c74d8d4ca7d2ff2a33f3c992f3f8d7adb6a6c6f26e56b92c41ebf7de9'
    or to_regclass('hotel_qa.environment_guard') is not null then
    raise exception 'STOP_LONG_STAY_OUTING_INVENTORY_PRODUCTION_DASHBOARD_BINDING';
  end if;
end;
$production_dashboard_binding$;
-- PRODUCTION_DASHBOARD_BINDING_END

-- EXISTING_DOMAIN_BASELINE_BEGIN
do $existing_domain_baseline$
begin
  if to_regprocedure('public.start_long_stay_absence_v2(uuid,integer,timestamp with time zone,date,time without time zone,boolean,text,text,uuid)') is null
    or to_regprocedure('public.complete_long_stay_absence(uuid,integer,timestamp with time zone,text,text,uuid)') is null
    or to_regprocedure('public.get_long_stay_month_v2(date)') is null then
    raise exception 'STOP_LONG_STAY_OUTING_INVENTORY_LONG_STAY_BASELINE';
  end if;
  if to_regclass('public.hotel_physical_occupancies') is null
    or to_regprocedure('public.merge_existing_hotel_stays_into_shared_room(uuid[],integer[],boolean,uuid)') is null then
    raise exception 'STOP_LONG_STAY_OUTING_INVENTORY_SHARED_ROOM_BASELINE';
  end if;
  if to_regclass('public.daycare_operation_states') is null
    or to_regprocedure('public.create_daycare_reservation(uuid,uuid,uuid,uuid,date,time without time zone,time without time zone,uuid,uuid,uuid[],text,uuid)') is null then
    raise exception 'STOP_LONG_STAY_OUTING_INVENTORY_DAYCARE_BASELINE';
  end if;
  if md5((select p.prosrc from pg_proc p where p.oid='public.complete_hotel_check_out(uuid,integer,timestamp with time zone,uuid)'::regprocedure))<>'7744baa7276dcb70676ec593e8ddc0e6'
    or md5((select p.prosrc from pg_proc p where p.oid='public.reverse_hotel_completion(uuid,integer,text,text,uuid)'::regprocedure))<>'dd4dd04865adfa2dc3ec83097e2b81a3'
    or md5((select p.prosrc from pg_proc p where p.oid='public.get_hotel_operations_snapshot_v2(date)'::regprocedure))<>'7dac53943e2f74f207de1cd36d5023fb'
    or (select p.provolatile from pg_proc p where p.oid='public.get_hotel_operations_snapshot_v2(date)'::regprocedure)<>'s' then
    raise exception 'STOP_LONG_STAY_OUTING_INVENTORY_HOTEL_BASELINE';
  end if;
  if md5((select pg_get_constraintdef(c.oid,true) from pg_constraint c
      where c.conrelid='public.sales'::regclass and c.conname='sales_payment_plan_limit'))
      <>'83538462481fcd9bd9972238587572e2' then
    raise exception 'STOP_LONG_STAY_OUTING_INVENTORY_FINANCE_BASELINE';
  end if;
end;
$existing_domain_baseline$;
-- EXISTING_DOMAIN_BASELINE_END


do $$
declare column_count integer; execute_grantees text[];
begin
  select count(*) into column_count from information_schema.columns
  where table_schema='public' and table_name='long_stay_absence_events'
    and column_name in ('inventory_mode','previous_room_id','released_allocation_id',
      'released_capacity_id','return_capacity_id','guarantee_from','returned_room_id',
      'returned_allocation_id','inventory_transition_status');
  if column_count<>9 then raise exception 'STOP_LONG_STAY_OUTING_INVENTORY_COLUMNS'; end if;
  if to_regprocedure('public.start_long_stay_absence_v3(uuid,integer,timestamp with time zone,date,time without time zone,boolean,text,text,text,uuid)') is null
    or to_regprocedure('public.complete_long_stay_absence_v2(uuid,integer,timestamp with time zone,uuid,text,text,uuid)') is null
    or to_regprocedure('public.get_long_stay_return_room_availability(uuid,timestamp with time zone)') is null
    or to_regprocedure('public.set_long_stay_absence_expected_return_v2(uuid,integer,date,time without time zone,boolean,text,uuid)') is null then
    raise exception 'STOP_LONG_STAY_OUTING_INVENTORY_FUNCTIONS';
  end if;
  if to_regprocedure('public.guard_long_stay_outing_released_checkout()') is null
    or not exists (
      select 1
      from pg_trigger trigger_row
      join pg_class relation on relation.oid=trigger_row.tgrelid
      join pg_namespace namespace on namespace.oid=relation.relnamespace
      where namespace.nspname='public' and relation.relname='hotel_stays'
        and trigger_row.tgname='long_stay_outing_released_checkout_guard'
        and not trigger_row.tgisinternal
    ) then
    raise exception 'STOP_LONG_STAY_OUTING_RELEASED_CHECKOUT_GUARD';
  end if;
  select array_agg(grantee order by grantee) into execute_grantees
  from information_schema.routine_privileges
  where specific_schema='public' and routine_name='start_long_stay_absence_v3'
    and privilege_type='EXECUTE';
  if execute_grantees is distinct from array['authenticated','postgres','service_role']::text[] then
    raise exception 'STOP_LONG_STAY_OUTING_INVENTORY_RPC_ACL';
  end if;
  if exists(select 1 from public.long_stay_absence_events event
    where event.inventory_mode='release_room' and event.is_open and event.archived_at is null
      and (event.return_capacity_id is null or event.guarantee_from is null
        or event.inventory_transition_status<>'room_released')) then
    raise exception 'STOP_LONG_STAY_OUTING_INVENTORY_RUNTIME_STATE';
  end if;
  if exists (
    select 1 from public.long_stay_contracts contract
    where contract.memo='LONG_STAY_OUTING_INVENTORY_RUNTIME_QA_202608140003'
  ) or exists (
    select 1 from public.hotel_room_types room_type
    where room_type.code like 'QA_OUTING_INV_%' or room_type.code like 'QA_OUTING_OTHER_%'
  ) or exists (
    select 1 from public.operation_schedules schedule
    where schedule.description in (
      'OUTING GAP HOTEL QA','OUTING GAP DAYCARE QA','EARLY CONFLICT 1',
      'EARLY CONFLICT 2','RETURN BOUNDARY BLOCKER','RETURN BOUNDARY HOTEL',
      'RETURN BOUNDARY DAYCARE'
    )
  ) then
    raise exception 'STOP_LONG_STAY_OUTING_INVENTORY_QA_RESIDUE';
  end if;
end;
$$;

select 'LONG_STAY_OUTING_INVENTORY_V1_READY' status;
rollback;
