\set ON_ERROR_STOP on
begin read only;
select hotel_qa.assert_isolated_environment();

do $$
begin
  if to_regclass('public.journal_days') is null
    or to_regclass('public.journal_entries') is null
    or to_regprocedure('public.get_journal_roster(date)') is null
    or to_regprocedure('public.register_journal_roster(date,uuid[],uuid)') is null
    or to_regprocedure('public.update_journal_entry_draft(uuid,integer,text[],boolean,boolean,text,text[],text,text,uuid,text,text,text,text,text,uuid)') is null
    or to_regprocedure('public.complete_journal_entry(uuid,integer,uuid)') is null then
    raise exception 'STOP_JOURNAL_DAY_DEFAULT_BASELINE_MISSING';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='journal_days'
      and column_name in ('default_manners_activity_name','default_physical_activity_name','default_activities_version')
  ) or to_regprocedure('public.register_journal_roster_v2(date,uuid[],text,text,integer,uuid)') is not null
    or to_regprocedure('public.update_journal_day_default_activities(uuid,integer,text,text,uuid)') is not null then
    raise exception 'STOP_JOURNAL_DAY_DEFAULT_UNEXPECTED_OBJECT';
  end if;
  if has_table_privilege('authenticated','public.journal_days','INSERT,UPDATE,DELETE')
    or has_table_privilege('authenticated','public.journal_entries','INSERT,UPDATE,DELETE') then
    raise exception 'STOP_JOURNAL_DAY_DEFAULT_DIRECT_MUTATION_BASELINE';
  end if;
end;
$$;

select 'READY_TO_APPLY_JOURNAL_DAY_DEFAULT_ACTIVITIES_V1' as status;
rollback;
