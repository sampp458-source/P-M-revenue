\set ON_ERROR_STOP on
begin read only;

do $$
declare
  target_ref text := current_setting('app.release_project_ref', true);
  function_source text;
  normalized_source text;
begin
  if target_ref is null or target_ref not in ('wxbvwixoeczfvbqurdse', 'zorvcuskzemehblqdbfj') then
    raise exception 'STOP_JOURNAL_MEMBER_DELETE_UNAPPROVED_PROJECT';
  end if;

  if to_regprocedure('public.remove_journal_roster_entry(uuid,integer,uuid)') is null
    or to_regprocedure('public.is_active_operation_member()') is null
    or to_regclass('public.journal_entries') is null
    or to_regclass('public.journal_days') is null
    or to_regclass('public.entity_audit_events') is null then
    raise exception 'STOP_JOURNAL_MEMBER_DELETE_BASELINE_MISSING';
  end if;

  select p.prosrc into function_source
  from pg_proc p
  where p.oid = 'public.remove_journal_roster_entry(uuid,integer,uuid)'::regprocedure
    and p.prosecdef
    and p.provolatile = 'v'
    and pg_get_function_result(p.oid) = 'jsonb';
  if function_source is null then
    raise exception 'STOP_JOURNAL_MEMBER_DELETE_BASELINE_METADATA';
  end if;

  normalized_source := regexp_replace(function_source, '[[:space:]]', '', 'g');
  if normalized_source not like '%public.is_active_operation_member()%'
    or normalized_source not like '%row_before.version<>p_expected_version%'
    or normalized_source not like '%errcode=''PT409''%'
    or normalized_source not like '%deletefrompublic.journal_entries%'
    or normalized_source like '%deletefrompublic.journal_days%'
    or normalized_source like '%deletefrompublic.dogs%'
    or normalized_source like '%deletefrompublic.customers%' then
    raise exception 'STOP_JOURNAL_MEMBER_DELETE_BASELINE_UNEXPECTED';
  end if;
end;
$$;

select 'READY_TO_APPLY_JOURNAL_MEMBER_DELETE_CONTRACT' as status;
rollback;
