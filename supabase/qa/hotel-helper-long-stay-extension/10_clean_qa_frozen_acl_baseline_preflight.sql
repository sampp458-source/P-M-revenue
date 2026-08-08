-- CLEAN QA ONLY. Read-only gate for the Frozen Hotel ACL baseline repair.

begin read only;

select hotel_qa.assert_isolated_environment();

with expected(
  identity, body_fingerprint, definition_fingerprint,
  expected_volatility, expected_return_type, expected_acl
) as (
  values
    ('public.reverse_hotel_completion(uuid,integer,text,text,uuid)',
      'dd4dd04865adfa2dc3ec83097e2b81a3',
      '4029c9e292df3a690b1040cb37debf61',
      'v', 'jsonb', array['authenticated','postgres']::text[]),
    ('public.get_hotel_operations_snapshot_v2(date)',
      '7dac53943e2f74f207de1cd36d5023fb',
      'ddcbfba32525ed050124fa337127f366',
      's', 'jsonb', array['authenticated','postgres']::text[])
), target as (
  select expected.*, proc.oid,
    md5(proc.prosrc) actual_body_fingerprint,
    md5(pg_get_functiondef(proc.oid)) actual_definition_fingerprint,
    pg_get_userbyid(proc.proowner) owner_name,
    proc.prosecdef, proc.provolatile,
    pg_get_function_result(proc.oid) result_type,
    proc.proconfig,
    coalesce(array(
      select distinct pg_get_userbyid(acl.grantee)::text
      from aclexplode(coalesce(proc.proacl, acldefault('f', proc.proowner))) acl
      where acl.privilege_type = 'EXECUTE'
      order by 1
    ), '{}'::text[]) execute_grantees
  from expected
  left join pg_proc proc on proc.oid = to_regprocedure(expected.identity)
), checks as (
  select
    exists (
      select 1 from hotel_qa.environment_guard guard
      where guard.singleton_key
        and guard.enabled
        and guard.environment_kind = 'isolated-hotel-qa'
        and guard.qa_project_ref = 'wxbvwixoeczfvbqurdse'
        and guard.production_project_ref = 'zorvcuskzemehblqdbfj'
        and guard.qa_project_ref <> guard.production_project_ref
    ) environment_ready,
    coalesce(bool_and(
      oid is not null
      and actual_body_fingerprint = body_fingerprint
      and actual_definition_fingerprint = definition_fingerprint
      and owner_name = 'postgres'
      and prosecdef
      and provolatile = expected_volatility
      and result_type = expected_return_type
      and 'search_path=public, pg_temp' = any(proconfig)
    ), false) definition_contract_ready,
    coalesce(bool_and(execute_grantees = expected_acl), false) exact_drift_acl_ready
  from target
)
select case
  when not environment_ready then 'STOP_CLEAN_QA_FROZEN_ACL_ENVIRONMENT'
  when not definition_contract_ready then 'STOP_CLEAN_QA_FROZEN_ACL_DEFINITION'
  when not exact_drift_acl_ready then 'STOP_CLEAN_QA_FROZEN_ACL_VARIANT'
  else 'READY_TO_APPLY_CLEAN_QA_FROZEN_HOTEL_ACL_BASELINE_REPAIR'
end as preflight_status,
checks.*,
(select jsonb_agg(jsonb_build_object(
  'identity', identity,
  'bodyFingerprint', actual_body_fingerprint,
  'definitionFingerprint', actual_definition_fingerprint,
  'volatility', provolatile,
  'acl', execute_grantees
) order by identity) from target) contract_detail
from checks;

rollback;
