-- Production-only, read-only Journal V1 roster release gate.
begin read only;
select set_config('app.release_project_ref','zorvcuskzemehblqdbfj',true);
select set_config('app.release_migration_sha256','7af383b7beb9da15addaf5a45eabd544df3494fac184180e256d4c0c3e4f07b9',true);

do $production_binding$
begin
  if current_setting('app.release_project_ref',true) is distinct from 'zorvcuskzemehblqdbfj'
    or current_setting('app.release_project_ref',true)='wxbvwixoeczfvbqurdse'
    or current_setting('app.release_migration_sha256',true) is distinct from '7af383b7beb9da15addaf5a45eabd544df3494fac184180e256d4c0c3e4f07b9'
    or current_database()<>'postgres' or current_user<>'postgres'
    or to_regclass('hotel_qa.environment_guard') is not null then
    raise exception 'STOP_JOURNAL_V1_PRODUCTION_BINDING';
  end if;
end;
$production_binding$;

do $preflight$
begin
  if to_regclass('public.journal_days') is not null
    or to_regclass('public.journal_entries') is not null
    or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname in ('get_journal_roster','register_journal_roster','set_journal_entry_status','remove_journal_roster_entry','journal_entry_json_internal','protect_journal_entry_metadata_internal')) then
    raise exception 'STOP_JOURNAL_V1_ALREADY_PRESENT';
  end if;
  if to_regclass('public.customers') is null or to_regclass('public.dogs') is null
    or to_regclass('public.operation_memberships') is null or to_regclass('public.entity_audit_events') is null
    or to_regprocedure('public.is_active_operation_member()') is null
    or to_regclass('public.operation_schedules') is null
    or to_regclass('public.hotel_stays') is null
    or to_regclass('public.long_stay_contracts') is null
    or to_regclass('public.daycare_operation_states') is null
    or to_regclass('public.family_booking_members') is null
    or to_regclass('public.sales') is null then
    raise exception 'STOP_JOURNAL_V1_PRODUCTION_BASELINE';
  end if;
end;
$preflight$;

select 'READY_TO_APPLY_JOURNAL_V1_ROSTER' status;
rollback;
