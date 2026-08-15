-- Production-only, read-only Journal V1 roster postflight.
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

do $postflight$
declare rpc_count integer; trigger_count integer;
begin
  if to_regclass('public.journal_days') is null or to_regclass('public.journal_entries') is null then
    raise exception 'STOP_JOURNAL_TABLE_CONTRACT';
  end if;
  select count(*) into rpc_count from pg_proc p where p.oid in (
    'public.get_journal_roster(date)'::regprocedure,
    'public.register_journal_roster(date,uuid[],uuid)'::regprocedure,
    'public.set_journal_entry_status(uuid,integer,text,uuid)'::regprocedure,
    'public.remove_journal_roster_entry(uuid,integer,uuid)'::regprocedure
  );
  if rpc_count<>4 then raise exception 'STOP_JOURNAL_RPC_CONTRACT'; end if;
  select count(*) into trigger_count from pg_trigger where tgrelid='public.journal_entries'::regclass and not tgisinternal;
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
  if has_table_privilege('authenticated','public.journal_days','INSERT,UPDATE,DELETE')
    or has_table_privilege('authenticated','public.journal_entries','INSERT,UPDATE,DELETE')
    or not has_table_privilege('authenticated','public.journal_days','SELECT')
    or not has_table_privilege('authenticated','public.journal_entries','SELECT') then
    raise exception 'STOP_JOURNAL_TABLE_ACL_CONTRACT';
  end if;
  if exists(select 1 from (values
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

  if to_regclass('public.operation_schedules') is null or to_regclass('public.hotel_stays') is null
    or to_regclass('public.long_stay_contracts') is null or to_regclass('public.daycare_operation_states') is null
    or to_regclass('public.family_booking_members') is null or to_regclass('public.sales') is null then
    raise exception 'STOP_JOURNAL_EXISTING_DOMAIN_DIFF';
  end if;
end;
$postflight$;

select 'JOURNAL_V1_ROSTER_READY' status;
rollback;
