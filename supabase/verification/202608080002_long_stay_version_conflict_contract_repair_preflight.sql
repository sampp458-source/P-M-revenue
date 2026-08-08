-- Read-only gate for the Long Stay optimistic-version error contract repair.
-- PT409 is a PostgREST custom HTTP 409 and is intentionally outside PostgreSQL
-- class 40 (transaction rollback / serialization failure).
with expected(identity, body_fingerprint) as (values
  ('public.confirm_long_stay_month(uuid,integer,date,uuid,uuid,time without time zone,boolean,uuid,uuid,uuid[],text,uuid)', 'b5c84bb83b7c3091e60e6eae876cc7da'),
  ('public.complete_long_stay_check_in(uuid,integer,integer,timestamp with time zone,text,uuid)', '591a667ecf68b7cda59805dbece4e2bf'),
  ('public.start_long_stay_absence(uuid,integer,timestamp with time zone,timestamp with time zone,text,text,uuid)', '02c06fb2a159adc2f1656254f30f4d38'),
  ('public.complete_long_stay_absence(uuid,integer,timestamp with time zone,text,text,uuid)', '82a57a24ca283bbc848af7f248ae57b8'),
  ('public.set_long_stay_planned_checkout(uuid,integer,date,uuid,uuid,time without time zone,boolean,uuid[],text,uuid)', '20a20262edb54e4638acc31e823f7f86'),
  ('public.complete_long_stay_check_out(uuid,integer,integer,timestamp with time zone,text,uuid)', '1742cc4ea2c30f5a6955dc49e606caa0'),
  ('public.reverse_long_stay_completion(uuid,integer,integer,text,uuid)', 'd049bb24e4b8062b9bc3b20f90204970')
), target_contract as (
  select count(*) as function_count,
    bool_and(
      p.oid is not null
      and md5(p.prosrc) = e.body_fingerprint
      and pg_get_userbyid(p.proowner) = 'postgres'
      and p.prosecdef
      and p.provolatile = 'v'
      and pg_get_function_result(p.oid) = 'jsonb'
      and 'search_path=public, pg_temp' = any(p.proconfig)
      and coalesce(array(
        select distinct pg_get_userbyid(a.grantee)::text
        from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        where a.privilege_type = 'EXECUTE'
        order by 1
      ), '{}') = array['authenticated','postgres','service_role']::text[]
      and (length(p.prosrc) - length(replace(p.prosrc, 'using errcode=''40001''', '')))
          / length('using errcode=''40001''') = 1
      and position('PT409' in p.prosrc) = 0
    ) as ready
  from expected e
  left join pg_proc p on p.oid = to_regprocedure(e.identity)
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
    then 'READY_TO_APPLY_LONG_STAY_VERSION_CONFLICT_CONTRACT_REPAIR'
  else 'STOP_LONG_STAY_VERSION_CONFLICT_CONTRACT_REPAIR_PREFLIGHT'
end as status,
target_contract.function_count,
target_contract.ready as target_contract_ready,
frozen.ready as frozen_contract_ready
from target_contract, frozen;
