-- Read-only postflight for the Operations optimistic conflict contract repair.
with expected(identity, body_fingerprint, result_type, expected_acl) as (values
  ('public.set_operation_schedule_status(uuid,integer,text,text,uuid)', '1f7ac4529e2fd621b33f0855a071964e', 'jsonb', array['authenticated','postgres','service_role']::text[])
), contract as (
  select count(*) as function_count, bool_and(
    md5(p.prosrc) = e.body_fingerprint
    and pg_get_userbyid(p.proowner) = 'postgres'
    and p.prosecdef and p.provolatile = 'v'
    and pg_get_function_result(p.oid) = e.result_type
    and 'search_path=public, pg_temp' = any(p.proconfig)
    and coalesce(array(
      select distinct pg_get_userbyid(a.grantee)::text
      from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where a.privilege_type = 'EXECUTE' order by 1
    ), '{}') = e.expected_acl
    and position('using errcode = ''40001''' in p.prosrc) = 0
    and (length(p.prosrc) - length(replace(p.prosrc, 'using errcode = ''PT409''', '')))
      / length('using errcode = ''PT409''') = 1
  ) as ready
  from expected e join pg_proc p on p.oid = to_regprocedure(e.identity)
), frozen as (
  select bool_and(md5(p.prosrc) = f.body_fingerprint) as ready
  from (values
    ('public.record_operation_schedule_audit_event()', 'a5deae851384be64c4a6df9a193269a5'),
    ('public.complete_hotel_check_out(uuid,integer,timestamp with time zone,uuid)', '7744baa7276dcb70676ec593e8ddc0e6'),
    ('public.reverse_hotel_completion(uuid,integer,text,text,uuid)', 'dd4dd04865adfa2dc3ec83097e2b81a3'),
    ('public.get_hotel_operations_snapshot_v2(date)', '7dac53943e2f74f207de1cd36d5023fb')
  ) f(identity, body_fingerprint)
  join pg_proc p on p.oid = to_regprocedure(f.identity)
)
select case when contract.function_count = 1 and contract.ready and frozen.ready
  then 'OPERATIONS_OPTIMISTIC_CONFLICT_CONTRACT_REPAIR_READY'
  else 'STOP_OPERATIONS_OPTIMISTIC_CONFLICT_CONTRACT_REPAIR_POSTFLIGHT'
end as status,
contract.function_count, contract.ready as target_contract_ready,
frozen.ready as frozen_contract_ready
from contract, frozen;
