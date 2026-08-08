-- CLEAN QA ONLY. Aligns two Frozen Hotel ACLs with the Production contract.

begin;

select hotel_qa.assert_isolated_environment();

do $$
declare
  environment_ready boolean;
  target_ready boolean;
  function_definition_before text;
  trigger_definition_before text;
  unrelated_acl_before text;
  function_definition_after text;
  trigger_definition_after text;
  unrelated_acl_after text;
begin
  select exists (
    select 1 from hotel_qa.environment_guard guard
    where guard.singleton_key
      and guard.enabled
      and guard.environment_kind = 'isolated-hotel-qa'
      and guard.qa_project_ref = 'wxbvwixoeczfvbqurdse'
      and guard.production_project_ref = 'zorvcuskzemehblqdbfj'
      and guard.qa_project_ref <> guard.production_project_ref
  ) into environment_ready;
  if not environment_ready then
    raise exception 'STOP_CLEAN_QA_FROZEN_ACL_ENVIRONMENT';
  end if;

  select bool_and(
    proc.oid is not null
    and md5(proc.prosrc) = expected.body_fingerprint
    and md5(pg_get_functiondef(proc.oid)) = expected.definition_fingerprint
    and pg_get_userbyid(proc.proowner) = 'postgres'
    and proc.prosecdef
    and proc.provolatile = expected.expected_volatility
    and pg_get_function_result(proc.oid) = 'jsonb'
    and 'search_path=public, pg_temp' = any(proc.proconfig)
    and coalesce(array(
      select distinct pg_get_userbyid(acl.grantee)::text
      from aclexplode(coalesce(proc.proacl, acldefault('f', proc.proowner))) acl
      where acl.privilege_type = 'EXECUTE'
      order by 1
    ), '{}'::text[]) = array['authenticated','postgres']::text[]
  ) into target_ready
  from (values
    ('public.reverse_hotel_completion(uuid,integer,text,text,uuid)',
      'dd4dd04865adfa2dc3ec83097e2b81a3',
      '4029c9e292df3a690b1040cb37debf61', 'v'),
    ('public.get_hotel_operations_snapshot_v2(date)',
      '7dac53943e2f74f207de1cd36d5023fb',
      'ddcbfba32525ed050124fa337127f366', 's')
  ) expected(identity, body_fingerprint, definition_fingerprint, expected_volatility)
  left join pg_proc proc on proc.oid = to_regprocedure(expected.identity);
  if not coalesce(target_ready, false) then
    raise exception 'STOP_CLEAN_QA_FROZEN_ACL_UNEXPECTED_BASELINE';
  end if;

  select md5(string_agg(pg_get_functiondef(proc.oid), E'\n' order by proc.oid))
  into function_definition_before
  from pg_proc proc join pg_namespace ns on ns.oid = proc.pronamespace
  where ns.nspname = 'public';
  select md5(string_agg(pg_get_triggerdef(trg.oid, true), E'\n' order by trg.oid))
  into trigger_definition_before
  from pg_trigger trg join pg_class rel on rel.oid = trg.tgrelid
  join pg_namespace ns on ns.oid = rel.relnamespace
  where ns.nspname = 'public' and not trg.tgisinternal;
  select md5(string_agg(concat_ws('|', proc.oid::text, coalesce(proc.proacl::text, 'NULL')), E'\n' order by proc.oid))
  into unrelated_acl_before
  from pg_proc proc join pg_namespace ns on ns.oid = proc.pronamespace
  where ns.nspname = 'public'
    and proc.oid not in (
      'public.reverse_hotel_completion(uuid,integer,text,text,uuid)'::regprocedure,
      'public.get_hotel_operations_snapshot_v2(date)'::regprocedure
    );

  execute 'grant execute on function public.reverse_hotel_completion(uuid,integer,text,text,uuid) to service_role';
  execute 'grant execute on function public.get_hotel_operations_snapshot_v2(date) to service_role';

  select md5(string_agg(pg_get_functiondef(proc.oid), E'\n' order by proc.oid))
  into function_definition_after
  from pg_proc proc join pg_namespace ns on ns.oid = proc.pronamespace
  where ns.nspname = 'public';
  select md5(string_agg(pg_get_triggerdef(trg.oid, true), E'\n' order by trg.oid))
  into trigger_definition_after
  from pg_trigger trg join pg_class rel on rel.oid = trg.tgrelid
  join pg_namespace ns on ns.oid = rel.relnamespace
  where ns.nspname = 'public' and not trg.tgisinternal;
  select md5(string_agg(concat_ws('|', proc.oid::text, coalesce(proc.proacl::text, 'NULL')), E'\n' order by proc.oid))
  into unrelated_acl_after
  from pg_proc proc join pg_namespace ns on ns.oid = proc.pronamespace
  where ns.nspname = 'public'
    and proc.oid not in (
      'public.reverse_hotel_completion(uuid,integer,text,text,uuid)'::regprocedure,
      'public.get_hotel_operations_snapshot_v2(date)'::regprocedure
    );

  if function_definition_before is distinct from function_definition_after then
    raise exception 'STOP_CLEAN_QA_FROZEN_ACL_FUNCTION_DEFINITION_DIFF';
  end if;
  if trigger_definition_before is distinct from trigger_definition_after then
    raise exception 'STOP_CLEAN_QA_FROZEN_ACL_TRIGGER_DIFF';
  end if;
  if unrelated_acl_before is distinct from unrelated_acl_after then
    raise exception 'STOP_CLEAN_QA_FROZEN_ACL_UNRELATED_ACL_DIFF';
  end if;
end;
$$;

commit;

select 'CLEAN_QA_FROZEN_HOTEL_ACL_BASELINE_REPAIR_APPLIED' as migration_status;
