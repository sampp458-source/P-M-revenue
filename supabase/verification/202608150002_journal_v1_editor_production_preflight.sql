-- Production-only, read-only Journal V1 Editor release gate.
begin read only;
select set_config('app.release_project_ref','zorvcuskzemehblqdbfj',true);
select set_config('app.release_migration_sha256','497fbd16f349212405b2ba22d3388d00ac55423070698ebd9fc3a29a5a0ccff1',true);

do $$
begin
  if current_setting('app.release_project_ref',true) is distinct from 'zorvcuskzemehblqdbfj'
    or current_setting('app.release_project_ref',true)='wxbvwixoeczfvbqurdse'
    or current_setting('app.release_migration_sha256',true) is distinct from '497fbd16f349212405b2ba22d3388d00ac55423070698ebd9fc3a29a5a0ccff1'
    or current_database()<>'postgres' or current_user<>'postgres'
    or to_regclass('hotel_qa.environment_guard') is not null then
    raise exception 'STOP_JOURNAL_EDITOR_PRODUCTION_BINDING';
  end if;
  if to_regclass('public.journal_entries') is null
    or to_regprocedure('public.get_journal_roster(date)') is null
    or to_regprocedure('public.journal_entry_json_internal(uuid)') is null
    or to_regprocedure('public.set_journal_entry_status(uuid,integer,text,uuid)') is null
    or to_regclass('public.operation_schedules') is null
    or to_regclass('public.hotel_stays') is null
    or to_regclass('public.long_stay_contracts') is null
    or to_regclass('public.hotel_physical_occupancies') is null
    or to_regclass('public.daycare_operation_states') is null
    or to_regclass('public.family_booking_members') is null
    or to_regclass('public.sales') is null then
    raise exception 'STOP_JOURNAL_EDITOR_PRODUCTION_BASELINE';
  end if;
  if to_regprocedure('public.get_journal_entry(uuid)') is not null
    or to_regprocedure('public.complete_journal_entry(uuid,integer,uuid)') is not null
    or to_regprocedure('public.update_journal_entry_draft(uuid,integer,text[],boolean,boolean,text,text[],text,text,uuid,text,text,text,text,text,uuid)') is not null then
    raise exception 'STOP_JOURNAL_EDITOR_ALREADY_APPLIED';
  end if;
  if exists(select 1 from public.journal_entries where char_length(coalesce(teacher_comment,''))>500) then
    raise exception 'STOP_JOURNAL_EDITOR_COMMENT_BASELINE';
  end if;
end;
$$;

select 'READY_TO_APPLY_JOURNAL_V1_EDITOR';
rollback;
