-- GENERATED FILE: do not edit or assemble by hand.
-- Dashboard target: production
-- Dashboard phase: PREFLIGHT
-- Production ref: zorvcuskzemehblqdbfj
-- Clean QA ref: wxbvwixoeczfvbqurdse
-- Approved migration SHA-256: 706bf28a5f497d41db065b73f033a0dfefc196cc13661fb889e51a5b52e4d731
-- Embedded source SHA-256: 9a19de9683a472d40c1bd847b4d63e5f5134d027b4741dc757fd28a9dd9a6467
begin read only;
-- PRODUCTION_DASHBOARD_BINDING_BEGIN
select set_config('app.release_project_ref','zorvcuskzemehblqdbfj',true);
select set_config('app.release_migration_sha256','706bf28a5f497d41db065b73f033a0dfefc196cc13661fb889e51a5b52e4d731',true);
do $dashboard_binding$
begin
  if current_database()<>'postgres' or current_user<>'postgres'
    or current_setting('app.release_project_ref',true) is distinct from 'zorvcuskzemehblqdbfj'
    or current_setting('app.release_project_ref',true)='wxbvwixoeczfvbqurdse'
    or current_setting('app.release_migration_sha256',true) is distinct from '706bf28a5f497d41db065b73f033a0dfefc196cc13661fb889e51a5b52e4d731'
    or to_regclass('hotel_qa.environment_guard') is not null then
    raise exception 'STOP_LONG_STAY_KEEP_TO_RELEASE_PRODUCTION_DASHBOARD_BINDING';
  end if;
end;
$dashboard_binding$;
-- PRODUCTION_DASHBOARD_BINDING_END


do $$
begin
  if to_regprocedure('public.start_long_stay_absence_v3(uuid,integer,timestamp with time zone,date,time without time zone,boolean,text,text,text,uuid)') is null
    or to_regprocedure('public.complete_long_stay_absence_v2(uuid,integer,timestamp with time zone,uuid,text,text,uuid)') is null
    or to_regprocedure('public.set_long_stay_absence_expected_return_v2(uuid,integer,date,time without time zone,boolean,text,uuid)') is null
    or to_regprocedure('public.assert_long_stay_runtime_invariant_internal(uuid)') is null then
    raise exception 'STOP_LONG_STAY_KEEP_TO_RELEASE_BASELINE_MISSING';
  end if;
  if to_regprocedure('public.release_long_stay_room_during_absence(uuid,integer,text,uuid)') is not null then
    raise exception 'STOP_LONG_STAY_KEEP_TO_RELEASE_ALREADY_PRESENT';
  end if;
  if exists (
    select 1 from public.long_stay_absence_events event
    where event.inventory_mode='release_room' and event.is_open and event.archived_at is null
      and (event.return_capacity_id is null or event.guarantee_from is null
        or event.inventory_transition_status<>'room_released')
  ) then
    raise exception 'STOP_LONG_STAY_KEEP_TO_RELEASE_BASELINE_RUNTIME_STATE';
  end if;
end;
$$;

select 'READY_TO_APPLY_LONG_STAY_KEEP_TO_RELEASE' status;
rollback;
