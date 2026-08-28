\set ON_ERROR_STOP on
begin read only;

do $$
declare
  register_source text;
  legacy_source text;
begin
  if to_regclass('public.journal_days') is null
    or to_regclass('public.journal_entries') is null
    or to_regclass('public.entity_audit_events') is null
    or to_regclass('public.journal_entry_best_friend_targets') is null
    or to_regprocedure('public.register_journal_roster_v2(date,uuid[],text,text,integer,uuid)') is null
    or to_regprocedure('public.register_journal_roster(date,uuid[],uuid)') is null
    or to_regprocedure('public.journal_entry_json_internal(uuid)') is null
    or to_regprocedure('public.validate_journal_entry_completion_internal(public.journal_entries)') is null then
    raise exception 'STOP_JOURNAL_DEFAULT_SELECTIONS_PREFLIGHT_BASELINE';
  end if;

  if (select count(*) from information_schema.columns
      where table_schema='public' and table_name='journal_entries'
        and column_name in (
          'condition_codes','urination','defecation','stool_condition','meal_codes',
          'teacher_relationship','friend_relationship','best_friend_dog_id',
          'manners_activity_name','manners_evaluation','physical_activity_name',
          'physical_evaluation','teacher_comment','version','status'
        ))<>15
    or not exists(select 1 from pg_trigger where tgrelid='public.journal_entries'::regclass
      and tgname='journal_entries_protect_metadata' and not tgisinternal)
    or not exists(select 1 from pg_attribute attribute
      join pg_attrdef default_value on default_value.adrelid=attribute.attrelid
        and default_value.adnum=attribute.attnum
      where attribute.attrelid='public.journal_entries'::regclass
        and attribute.attname='status'
        and lower(regexp_replace(pg_get_expr(default_value.adbin,default_value.adrelid),'\s+','','g'))='''not_started''::text')
    or not exists(select 1 from pg_attribute attribute
      join pg_attrdef default_value on default_value.adrelid=attribute.attrelid
        and default_value.adnum=attribute.attnum
      where attribute.attrelid='public.journal_entries'::regclass
        and attribute.attname='version'
        and regexp_replace(pg_get_expr(default_value.adbin,default_value.adrelid),'\s+','','g')='1')
    or has_table_privilege('authenticated','public.journal_entries','INSERT,UPDATE,DELETE') then
    raise exception 'STOP_JOURNAL_DEFAULT_SELECTIONS_PREFLIGHT_CONTRACT';
  end if;

  select lower(regexp_replace(pg_get_functiondef(
    'public.register_journal_roster_v2(date,uuid[],text,text,integer,uuid)'::regprocedure
  ),'\s+','','g')) into register_source;
  select lower(regexp_replace(pg_get_functiondef(
    'public.register_journal_roster(date,uuid[],uuid)'::regprocedure
  ),'\s+','','g')) into legacy_source;
  if position('onconflict(journal_day_id,dog_id)donothing' in register_source)=0
    or position('journal_day_default_activities_register' in register_source)=0
    or position('returnpublic.register_journal_roster_v2(' in legacy_source)=0 then
    raise exception 'STOP_JOURNAL_DEFAULT_SELECTIONS_PREFLIGHT_CREATION_OWNER';
  end if;
  if coalesce(obj_description(
      'public.register_journal_roster_v2(date,uuid[],text,text,integer,uuid)'::regprocedure,
      'pg_proc'
    ),'') like '%Journal Default Selections V1%' then
    raise exception 'STOP_JOURNAL_DEFAULT_SELECTIONS_PREFLIGHT_ALREADY_APPLIED';
  end if;
end;
$$;

select 'READY_TO_APPLY_JOURNAL_DEFAULT_SELECTIONS_V1' as status;
rollback;
