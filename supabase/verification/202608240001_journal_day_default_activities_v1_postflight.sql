\set ON_ERROR_STOP on
begin read only;
select hotel_qa.assert_isolated_environment();

do $$
declare register_source text; update_source text; roster_source text; execute_grantees text[];
begin
  if (select count(*) from information_schema.columns
      where table_schema='public' and table_name='journal_days'
        and column_name in ('default_manners_activity_name','default_physical_activity_name','default_activities_version'))<>3 then
    raise exception 'STOP_JOURNAL_DAY_DEFAULT_COLUMNS';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='journal_days'
      and column_name in ('default_manners_activity_name','default_physical_activity_name')
      and is_nullable<>'YES'
  ) or (select column_default from information_schema.columns
        where table_schema='public' and table_name='journal_days' and column_name='default_activities_version') not like '%1%' then
    raise exception 'STOP_JOURNAL_DAY_DEFAULT_COLUMN_CONTRACT';
  end if;
  if (select count(*) from pg_constraint
      where conrelid='public.journal_days'::regclass
        and conname in ('journal_days_default_manners_activity_length','journal_days_default_physical_activity_length','journal_days_default_activities_version_positive'))<>3 then
    raise exception 'STOP_JOURNAL_DAY_DEFAULT_CONSTRAINTS';
  end if;
  if to_regprocedure('public.register_journal_roster_v2(date,uuid[],text,text,integer,uuid)') is null
    or to_regprocedure('public.update_journal_day_default_activities(uuid,integer,text,text,uuid)') is null then
    raise exception 'STOP_JOURNAL_DAY_DEFAULT_RPCS';
  end if;
  select pg_get_functiondef('public.register_journal_roster_v2(date,uuid[],text,text,integer,uuid)'::regprocedure) into register_source;
  select pg_get_functiondef('public.update_journal_day_default_activities(uuid,integer,text,text,uuid)'::regprocedure) into update_source;
  select pg_get_functiondef('public.get_journal_roster(date)'::regprocedure) into roster_source;
  if register_source not like '%is_active_operation_member()%'
    or register_source not like '%from public.journal_days%for update%'
    or register_source not like '%manners_activity_name%day_row.default_manners_activity_name%'
    or register_source not like '%physical_activity_name%day_row.default_physical_activity_name%'
    or register_source like '%update public.journal_entries%'
    or register_source not like '%errcode=''PT409''%'
    or register_source not like '%journal_day_default_activities_register%' then
    raise exception 'STOP_JOURNAL_DAY_DEFAULT_REGISTER_CONTRACT';
  end if;
  if update_source not like '%is_active_operation_member()%'
    or update_source not like '%for update%'
    or update_source not like '%default_activities_version=default_activities_version+1%'
    or update_source not like '%journal_day_default_activities_update%'
    or update_source like '%update public.journal_entries%' then
    raise exception 'STOP_JOURNAL_DAY_DEFAULT_UPDATE_CONTRACT';
  end if;
  if roster_source not like '%''defaults''%'
    or roster_source not like '%default_manners_activity_name%'
    or roster_source not like '%default_physical_activity_name%'
    or roster_source not like '%default_activities_version%' then
    raise exception 'STOP_JOURNAL_DAY_DEFAULT_READ_CONTRACT';
  end if;
  if has_table_privilege('authenticated','public.journal_days','INSERT,UPDATE,DELETE')
    or has_table_privilege('authenticated','public.journal_entries','INSERT,UPDATE,DELETE') then
    raise exception 'STOP_JOURNAL_DAY_DEFAULT_DIRECT_MUTATION';
  end if;
  select array_agg(grantee order by grantee) into execute_grantees
  from information_schema.routine_privileges
  where specific_schema='public' and routine_name='register_journal_roster_v2' and privilege_type='EXECUTE';
  if execute_grantees is distinct from array['authenticated','postgres','service_role']::text[] then
    raise exception 'STOP_JOURNAL_DAY_DEFAULT_REGISTER_ACL';
  end if;
  select array_agg(grantee order by grantee) into execute_grantees
  from information_schema.routine_privileges
  where specific_schema='public' and routine_name='update_journal_day_default_activities' and privilege_type='EXECUTE';
  if execute_grantees is distinct from array['authenticated','postgres','service_role']::text[] then
    raise exception 'STOP_JOURNAL_DAY_DEFAULT_UPDATE_ACL';
  end if;
end;
$$;

select 'JOURNAL_DAY_DEFAULT_ACTIVITIES_V1_READY' as status;
rollback;
