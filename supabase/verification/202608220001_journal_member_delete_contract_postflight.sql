\set ON_ERROR_STOP on
begin read only;

do $$
declare
  target_ref text := current_setting('app.release_project_ref', true);
  function_source text;
  normalized_source text;
  execute_grantees text[];
begin
  if target_ref is null or target_ref not in ('wxbvwixoeczfvbqurdse', 'zorvcuskzemehblqdbfj') then
    raise exception 'STOP_JOURNAL_MEMBER_DELETE_UNAPPROVED_PROJECT';
  end if;

  select p.prosrc into function_source
  from pg_proc p
  where p.oid = 'public.remove_journal_roster_entry(uuid,integer,uuid)'::regprocedure
    and p.prosecdef
    and p.provolatile = 'v'
    and pg_get_function_result(p.oid) = 'jsonb'
    and p.proconfig @> array['search_path=public, pg_temp'];
  if function_source is null then
    raise exception 'STOP_JOURNAL_MEMBER_DELETE_FUNCTION_METADATA';
  end if;

  normalized_source := regexp_replace(function_source, '[[:space:]]', '', 'g');
  if normalized_source not like '%actor_idisnullornotpublic.is_active_operation_member()%'
    or normalized_source like '%public.is_admin()%'
    or normalized_source like '%row_before.status<>%'
    or normalized_source not like '%pg_advisory_xact_lock%'
    or normalized_source not like '%row_before.version<>p_expected_version%'
    or normalized_source not like '%errcode=''PT409''%'
    or normalized_source not like '%replay_event.entity_idisdistinctfromp_entry_id%'
    or normalized_source not like '%journal_entry_delete%'
    or normalized_source not like '%statusBeforeDelete%'
    or normalized_source not like '%deletefrompublic.journal_entries%'
    or normalized_source not like '%deleted_count<>1%'
    or normalized_source like '%deletefrompublic.journal_days%'
    or normalized_source like '%deletefrompublic.dogs%'
    or normalized_source like '%deletefrompublic.customers%' then
    raise exception 'STOP_JOURNAL_MEMBER_DELETE_FUNCTION_CONTRACT';
  end if;

  select array_agg(distinct grantee order by grantee) into execute_grantees
  from information_schema.routine_privileges
  where specific_schema = 'public'
    and routine_name = 'remove_journal_roster_entry'
    and privilege_type = 'EXECUTE';
  if execute_grantees is distinct from array['authenticated', 'postgres', 'service_role']::text[] then
    raise exception 'STOP_JOURNAL_MEMBER_DELETE_ACL';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.journal_entries'::regclass)
    or has_table_privilege('authenticated', 'public.journal_entries', 'DELETE')
    or has_table_privilege('anon', 'public.journal_entries', 'DELETE') then
    raise exception 'STOP_JOURNAL_MEMBER_DELETE_DIRECT_TABLE_CONTRACT';
  end if;
end;
$$;

select 'JOURNAL_MEMBER_DELETE_CONTRACT_READY' as status;
rollback;
