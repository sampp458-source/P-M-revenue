\set ON_ERROR_STOP on
begin read only;
select hotel_qa.assert_isolated_environment();

do $$
declare rpc_count integer; table_count integer; trigger_count integer;
begin
  select count(*) into table_count from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname in ('journal_days','journal_entries') and c.relkind='r';
  if table_count<>2 then raise exception 'STOP_JOURNAL_TABLE_CONTRACT'; end if;

  select count(*) into rpc_count from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.oid in (
    'public.get_journal_roster(date)'::regprocedure,
    'public.register_journal_roster(date,uuid[],uuid)'::regprocedure,
    'public.set_journal_entry_status(uuid,integer,text,uuid)'::regprocedure,
    'public.remove_journal_roster_entry(uuid,integer,uuid)'::regprocedure
  );
  if rpc_count<>4 then raise exception 'STOP_JOURNAL_RPC_CONTRACT'; end if;

  select count(*) into trigger_count from pg_trigger
  where tgrelid='public.journal_entries'::regclass and not tgisinternal
    and tgname='journal_entries_protect_metadata';
  if trigger_count<>1 then raise exception 'STOP_JOURNAL_TRIGGER_CONTRACT'; end if;

  if not exists(select 1 from pg_constraint where conrelid='public.journal_entries'::regclass and conname='journal_entries_day_dog_unique')
    or not exists(select 1 from pg_constraint where conrelid='public.journal_entries'::regclass and conname='journal_entries_stool_semantics')
    or not exists(select 1 from pg_constraint where conrelid='public.journal_entries'::regclass and conname='journal_entries_best_friend_not_self') then
    raise exception 'STOP_JOURNAL_CONSTRAINT_CONTRACT';
  end if;

  if not (select relrowsecurity from pg_class where oid='public.journal_days'::regclass)
    or not (select relrowsecurity from pg_class where oid='public.journal_entries'::regclass)
    or (select count(*) from pg_policy where polrelid in ('public.journal_days'::regclass,'public.journal_entries'::regclass))<>2 then
    raise exception 'STOP_JOURNAL_RLS_CONTRACT';
  end if;

  if exists (
    select 1 from (values
      ('public.get_journal_roster(date)'::regprocedure),
      ('public.register_journal_roster(date,uuid[],uuid)'::regprocedure),
      ('public.set_journal_entry_status(uuid,integer,text,uuid)'::regprocedure),
      ('public.remove_journal_roster_entry(uuid,integer,uuid)'::regprocedure)
    ) expected(oid)
    where (select array_agg(grantee order by grantee) from (
      select distinct coalesce(role.rolname,'PUBLIC')::text grantee
      from aclexplode(coalesce((select proacl from pg_proc where pg_proc.oid=expected.oid),acldefault('f',(select proowner from pg_proc where pg_proc.oid=expected.oid)))) acl
      left join pg_roles role on role.oid=acl.grantee where acl.privilege_type='EXECUTE'
    ) grants) is distinct from array['authenticated','postgres','service_role']::text[]
  ) then raise exception 'STOP_JOURNAL_RPC_ACL_CONTRACT'; end if;

  if has_table_privilege('authenticated','public.journal_days','INSERT,UPDATE,DELETE')
    or has_table_privilege('authenticated','public.journal_entries','INSERT,UPDATE,DELETE')
    or not has_table_privilege('authenticated','public.journal_days','SELECT')
    or not has_table_privilege('authenticated','public.journal_entries','SELECT') then
    raise exception 'STOP_JOURNAL_TABLE_ACL_CONTRACT';
  end if;
end;
$$;

select 'JOURNAL_V1_ROSTER_READY';
rollback;
