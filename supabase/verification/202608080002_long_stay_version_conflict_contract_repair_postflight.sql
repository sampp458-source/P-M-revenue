-- Read-only postflight for the Long Stay version-conflict repair.
with expected(identity, body_fingerprint) as (values
  ('public.confirm_long_stay_month(uuid,integer,date,uuid,uuid,time without time zone,boolean,uuid,uuid,uuid[],text,uuid)', '64d86aa3e90d8261eaf7f716a9ed5280'),
  ('public.complete_long_stay_check_in(uuid,integer,integer,timestamp with time zone,text,uuid)', '5a6a7f0517cc96fc41cd879f8b225dad'),
  ('public.start_long_stay_absence(uuid,integer,timestamp with time zone,timestamp with time zone,text,text,uuid)', 'f259871ca7c00b73350ab6fb9c093513'),
  ('public.complete_long_stay_absence(uuid,integer,timestamp with time zone,text,text,uuid)', '63c736cc71749d1c550995cf0838980c'),
  ('public.set_long_stay_planned_checkout(uuid,integer,date,uuid,uuid,time without time zone,boolean,uuid[],text,uuid)', '1f23bc6c2044a17c05f0e34793676842'),
  ('public.complete_long_stay_check_out(uuid,integer,integer,timestamp with time zone,text,uuid)', 'ed8c217933f42b4f286f1627babf833c'),
  ('public.reverse_long_stay_completion(uuid,integer,integer,text,uuid)', '3b13b37eff7980efb99636695805499e')
), target_contract as (
  select count(*) as function_count,
    bool_and(
      md5(p.prosrc) = e.body_fingerprint
      and pg_get_userbyid(p.proowner) = 'postgres'
      and p.prosecdef and p.provolatile = 'v'
      and pg_get_function_result(p.oid) = 'jsonb'
      and 'search_path=public, pg_temp' = any(p.proconfig)
      and coalesce(array(
        select distinct pg_get_userbyid(a.grantee)::text
        from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        where a.privilege_type = 'EXECUTE' order by 1
      ), '{}') = array['authenticated','postgres','service_role']::text[]
      and position('using errcode=''40001''' in p.prosrc) = 0
      and (length(p.prosrc) - length(replace(p.prosrc, 'using errcode=''PT409''', '')))
          / length('using errcode=''PT409''') = 1
    ) as ready
  from expected e join pg_proc p on p.oid = to_regprocedure(e.identity)
), frozen as (
  select bool_and(md5(p.prosrc) = f.body_fingerprint) as ready
  from (values
    ('public.complete_hotel_check_out(uuid,integer,timestamp with time zone,uuid)', '7744baa7276dcb70676ec593e8ddc0e6'),
    ('public.reverse_hotel_completion(uuid,integer,text,text,uuid)', 'dd4dd04865adfa2dc3ec83097e2b81a3'),
    ('public.get_hotel_operations_snapshot_v2(date)', '7dac53943e2f74f207de1cd36d5023fb')
  ) f(identity, body_fingerprint)
  join pg_proc p on p.oid = to_regprocedure(f.identity)
)
select case
  when target_contract.function_count = 7 and target_contract.ready and frozen.ready
    then 'LONG_STAY_VERSION_CONFLICT_CONTRACT_REPAIR_READY'
  else 'STOP_LONG_STAY_VERSION_CONFLICT_CONTRACT_REPAIR_POSTFLIGHT'
end as status,
target_contract.function_count,
target_contract.ready as target_contract_ready,
frozen.ready as frozen_contract_ready
from target_contract, frozen;
