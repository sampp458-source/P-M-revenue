-- CLEAN QA ONLY. Restores the prior Clean QA ACL drift variant exactly.

begin;

select hotel_qa.assert_isolated_environment();

do $$
declare
  contract_ready boolean;
begin
  if not exists (
    select 1 from hotel_qa.environment_guard guard
    where guard.singleton_key and guard.enabled
      and guard.qa_project_ref = 'wxbvwixoeczfvbqurdse'
      and guard.production_project_ref = 'zorvcuskzemehblqdbfj'
      and guard.qa_project_ref <> guard.production_project_ref
  ) then
    raise exception 'STOP_CLEAN_QA_FROZEN_ACL_ENVIRONMENT';
  end if;

  select bool_and(
    proc.oid is not null
    and md5(proc.prosrc) = expected.body_fingerprint
    and md5(pg_get_functiondef(proc.oid)) = expected.definition_fingerprint
    and coalesce(array(
      select distinct pg_get_userbyid(acl.grantee)::text
      from aclexplode(coalesce(proc.proacl, acldefault('f', proc.proowner))) acl
      where acl.privilege_type = 'EXECUTE'
      order by 1
    ), '{}'::text[]) = array['authenticated','postgres','service_role']::text[]
  ) into contract_ready
  from (values
    ('public.reverse_hotel_completion(uuid,integer,text,text,uuid)',
      'dd4dd04865adfa2dc3ec83097e2b81a3', '4029c9e292df3a690b1040cb37debf61'),
    ('public.get_hotel_operations_snapshot_v2(date)',
      '7dac53943e2f74f207de1cd36d5023fb', 'ddcbfba32525ed050124fa337127f366')
  ) expected(identity, body_fingerprint, definition_fingerprint)
  left join pg_proc proc on proc.oid = to_regprocedure(expected.identity);
  if not coalesce(contract_ready, false) then
    raise exception 'STOP_CLEAN_QA_FROZEN_ACL_ROLLBACK_UNEXPECTED_VARIANT';
  end if;

  execute 'revoke execute on function public.reverse_hotel_completion(uuid,integer,text,text,uuid) from service_role';
  execute 'revoke execute on function public.get_hotel_operations_snapshot_v2(date) from service_role';
end;
$$;

commit;

select 'CLEAN_QA_FROZEN_HOTEL_ACL_BASELINE_ROLLED_BACK' as rollback_status;
