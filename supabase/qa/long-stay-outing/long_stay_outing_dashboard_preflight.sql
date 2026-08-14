-- GENERATED FILE: do not edit or assemble by hand.
-- Dashboard phase: PREFLIGHT
-- Clean QA exact project: wxbvwixoeczfvbqurdse
-- Production project zorvcuskzemehblqdbfj is rejected before any mutation.
-- Approved migration SHA-256: 5743b1c3be65031bf38284be72b1ce4ed4c8c0f8be002f07bbb417f07e99fec6
-- Embedded source SHA-256: ff11aa78c02a4cbac9fee414a3a379a9ce53978b3250ea94f75c7763d98afa46
begin read only;
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
