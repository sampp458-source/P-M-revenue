-- GENERATED FILE: do not edit or assemble by hand.
-- Dashboard phase: PREFLIGHT
-- Production exact project: zorvcuskzemehblqdbfj
-- Clean QA project wxbvwixoeczfvbqurdse is rejected before any mutation.
-- Approved migration SHA-256: 5743b1c3be65031bf38284be72b1ce4ed4c8c0f8be002f07bbb417f07e99fec6
-- Embedded source SHA-256: ff11aa78c02a4cbac9fee414a3a379a9ce53978b3250ea94f75c7763d98afa46
begin read only;
-- PRODUCTION_DASHBOARD_BINDING_BEGIN
select set_config('app.release_project_ref','zorvcuskzemehblqdbfj',true);
select set_config('app.release_migration_sha256','5743b1c3be65031bf38284be72b1ce4ed4c8c0f8be002f07bbb417f07e99fec6',true);
do $production_dashboard_binding$
begin
  if current_database()<>'postgres' or current_user<>'postgres'
    or current_setting('app.release_project_ref',true) is distinct from 'zorvcuskzemehblqdbfj'
    or current_setting('app.release_project_ref',true)='wxbvwixoeczfvbqurdse'
    or current_setting('app.release_migration_sha256',true) is distinct from '5743b1c3be65031bf38284be72b1ce4ed4c8c0f8be002f07bbb417f07e99fec6'
    or to_regclass('hotel_qa.environment_guard') is not null then
    raise exception 'STOP_LONG_STAY_OUTING_PRODUCTION_DASHBOARD_BINDING';
  end if;
end;
$production_dashboard_binding$;
-- PRODUCTION_DASHBOARD_BINDING_END

-- EXISTING_DOMAIN_BASELINE_BEGIN
do $existing_domain_baseline$
begin
  if to_regclass('public.hotel_physical_occupancies') is null
    or to_regclass('public.hotel_physical_occupancy_members') is null
    or to_regclass('public.hotel_physical_occupancy_requests') is null
    or to_regprocedure('public.merge_existing_hotel_stays_into_shared_room(uuid[],integer[],boolean,uuid)') is null then
    raise exception 'STOP_LONG_STAY_OUTING_SHARED_ROOM_BASELINE';
  end if;
  if to_regclass('public.daycare_operation_states') is null
    or to_regprocedure('public.create_daycare_reservation(uuid,uuid,uuid,uuid,date,time without time zone,time without time zone,uuid,uuid,uuid[],text,uuid)') is null
    or to_regprocedure('public.complete_daycare_check_out(uuid,integer,timestamp with time zone,uuid)') is null then
    raise exception 'STOP_LONG_STAY_OUTING_DAYCARE_BASELINE';
  end if;
  if md5((select p.prosrc from pg_proc p where p.oid='public.complete_hotel_check_out(uuid,integer,timestamp with time zone,uuid)'::regprocedure))<>'7744baa7276dcb70676ec593e8ddc0e6'
    or md5((select p.prosrc from pg_proc p where p.oid='public.reverse_hotel_completion(uuid,integer,text,text,uuid)'::regprocedure))<>'dd4dd04865adfa2dc3ec83097e2b81a3'
    or md5((select p.prosrc from pg_proc p where p.oid='public.get_hotel_operations_snapshot_v2(date)'::regprocedure))<>'7dac53943e2f74f207de1cd36d5023fb'
    or (select p.provolatile from pg_proc p where p.oid='public.get_hotel_operations_snapshot_v2(date)'::regprocedure)<>'s' then
    raise exception 'STOP_LONG_STAY_OUTING_HOTEL_CALENDAR_ROOM_BOARD_BASELINE';
  end if;
  if md5((select pg_get_constraintdef(c.oid,true) from pg_constraint c
      where c.conrelid='public.sales'::regclass and c.conname='sales_payment_plan_limit'))
      <>'83538462481fcd9bd9972238587572e2' then
    raise exception 'STOP_LONG_STAY_OUTING_FINANCE_BASELINE';
  end if;
end;
$existing_domain_baseline$;
-- EXISTING_DOMAIN_BASELINE_END


do $$
begin
  if to_regclass('public.long_stay_absence_events') is null
    or to_regprocedure('public.start_long_stay_absence(uuid,integer,timestamp with time zone,timestamp with time zone,text,text,uuid)') is null
    or to_regprocedure('public.complete_long_stay_absence(uuid,integer,timestamp with time zone,text,text,uuid)') is null
    or to_regprocedure('public.get_long_stay_month(date)') is null
    or to_regprocedure('public.long_stay_contract_projection_internal(uuid)') is null then
    raise exception 'STOP_LONG_STAY_OUTING_EXPECTED_RETURN_DEPENDENCY';
  end if;
  if to_regprocedure('public.start_long_stay_absence_v2(uuid,integer,timestamp with time zone,date,time without time zone,boolean,text,text,uuid)') is not null
    or to_regprocedure('public.get_long_stay_month_v2(date)') is not null
    or exists(
      select 1 from information_schema.columns
      where table_schema='public' and table_name='long_stay_absence_events'
        and column_name in ('expected_return_date','expected_return_time_unspecified')
    ) then
    raise exception 'STOP_LONG_STAY_OUTING_EXPECTED_RETURN_ALREADY_PRESENT';
  end if;
end;
$$;

select 'READY_TO_APPLY_LONG_STAY_OUTING_REPAIR' status;
rollback;
