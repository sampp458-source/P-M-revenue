-- Production-only, read-only Journal V1 Editor postflight.
begin read only;
select set_config('app.release_project_ref','zorvcuskzemehblqdbfj',true);
select set_config('app.release_migration_sha256','497fbd16f349212405b2ba22d3388d00ac55423070698ebd9fc3a29a5a0ccff1',true);

do $$
declare signature text;
begin
  if current_setting('app.release_project_ref',true) is distinct from 'zorvcuskzemehblqdbfj'
    or current_setting('app.release_project_ref',true)='wxbvwixoeczfvbqurdse'
    or current_setting('app.release_migration_sha256',true) is distinct from '497fbd16f349212405b2ba22d3388d00ac55423070698ebd9fc3a29a5a0ccff1'
    or current_database()<>'postgres' or current_user<>'postgres'
    or to_regclass('hotel_qa.environment_guard') is not null then
    raise exception 'STOP_JOURNAL_EDITOR_PRODUCTION_BINDING';
  end if;
  if not exists(select 1 from pg_constraint where conrelid='public.journal_entries'::regclass and conname='journal_entries_teacher_comment_length') then
    raise exception 'STOP_JOURNAL_EDITOR_COMMENT_CONSTRAINT';
  end if;
  foreach signature in array array[
    'public.get_journal_entry(uuid)',
    'public.update_journal_entry_draft(uuid,integer,text[],boolean,boolean,text,text[],text,text,uuid,text,text,text,text,text,uuid)',
    'public.complete_journal_entry(uuid,integer,uuid)'
  ] loop
    if to_regprocedure(signature) is null then raise exception 'STOP_JOURNAL_EDITOR_RPC_MISSING'; end if;
    if (select array_agg(grantee order by grantee) from (
      select distinct coalesce(role.rolname,'PUBLIC')::text grantee
      from aclexplode(coalesce((select proacl from pg_proc where oid=to_regprocedure(signature)),acldefault('f',(select proowner from pg_proc where oid=to_regprocedure(signature))))) acl
      left join pg_roles role on role.oid=acl.grantee where acl.privilege_type='EXECUTE'
    ) grants) is distinct from array['authenticated','postgres','service_role']::text[] then
      raise exception 'STOP_JOURNAL_EDITOR_RPC_ACL';
    end if;
  end loop;
  if position('validate_journal_entry_completion_internal' in pg_get_functiondef('public.complete_journal_entry(uuid,integer,uuid)'::regprocedure))=0
    or position('PT409' in pg_get_functiondef('public.update_journal_entry_draft(uuid,integer,text[],boolean,boolean,text,text[],text,text,uuid,text,text,text,text,text,uuid)'::regprocedure))=0
    or position('validate_journal_entry_completion_internal' in pg_get_functiondef('public.set_journal_entry_status(uuid,integer,text,uuid)'::regprocedure))=0 then
    raise exception 'STOP_JOURNAL_EDITOR_FUNCTION_CONTRACT';
  end if;
  if not (select relrowsecurity from pg_class where oid='public.journal_entries'::regclass)
    or has_table_privilege('authenticated','public.journal_entries','INSERT,UPDATE,DELETE')
    or to_regclass('public.operation_schedules') is null
    or to_regclass('public.hotel_stays') is null
    or to_regclass('public.long_stay_contracts') is null
    or to_regclass('public.hotel_physical_occupancies') is null
    or to_regclass('public.daycare_operation_states') is null
    or to_regclass('public.family_booking_members') is null
    or to_regclass('public.sales') is null then
    raise exception 'STOP_JOURNAL_EDITOR_EXISTING_DOMAIN_CONTRACT';
  end if;
end;
$$;

select 'JOURNAL_V1_EDITOR_READY';
rollback;
