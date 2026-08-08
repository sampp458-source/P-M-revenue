-- Read-only Long Stay Platform postflight.
with target_tables as (
  select count(*) count from pg_class where oid in (
    to_regclass('public.long_stay_contracts'),
    to_regclass('public.long_stay_monthly_occupancies'),
    to_regclass('public.long_stay_absence_events'),
    to_regclass('public.long_stay_operation_audit_events'))
), public_functions(identity) as (values
  ('public.create_long_stay_contract(uuid,uuid,date,date,uuid,uuid,numeric,integer,text,uuid)'),
  ('public.confirm_long_stay_month(uuid,integer,date,uuid,uuid,time without time zone,boolean,uuid,uuid,uuid[],text,uuid)'),
  ('public.complete_long_stay_check_in(uuid,integer,integer,timestamp with time zone,text,uuid)'),
  ('public.start_long_stay_absence(uuid,integer,timestamp with time zone,timestamp with time zone,text,text,uuid)'),
  ('public.complete_long_stay_absence(uuid,integer,timestamp with time zone,text,text,uuid)'),
  ('public.set_long_stay_planned_checkout(uuid,integer,date,uuid,uuid,time without time zone,boolean,uuid[],text,uuid)'),
  ('public.complete_long_stay_check_out(uuid,integer,integer,timestamp with time zone,text,uuid)'),
  ('public.reverse_long_stay_completion(uuid,integer,integer,text,uuid)'),
  ('public.get_long_stay_contract(uuid)'),
  ('public.get_customer_long_stays(uuid)'),
  ('public.get_long_stay_month(date)')
), public_contract as (
  select count(*) count, bool_and(p.prosecdef and pg_get_userbyid(p.proowner)='postgres'
    and 'search_path=public, pg_temp'=any(p.proconfig)
    and coalesce(array(select distinct pg_get_userbyid(x.grantee)::text
      from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x
      where x.privilege_type='EXECUTE' order by 1),'{}')
      =array['authenticated','postgres','service_role']::text[]) ready
  from public_functions f join pg_proc p on p.oid=to_regprocedure(f.identity)
), internal_functions(identity) as (values
  ('public.long_stay_internal_request_id(uuid,text,uuid,text)'),
  ('public.long_stay_payload_hash_internal(jsonb)'),
  ('public.long_stay_contract_projection_internal(uuid)'),
  ('public.long_stay_replay_internal(uuid,text,jsonb)'),
  ('public.long_stay_record_operation_internal(uuid,uuid,uuid,text,uuid,jsonb,jsonb,uuid[],text,uuid)'),
  ('public.assert_long_stay_runtime_invariant_internal(uuid)'),
  ('public.long_stay_deferred_invariant_trigger()')
), internal_contract as (
  select count(*) count, bool_and(coalesce(array(select distinct pg_get_userbyid(x.grantee)::text
    from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x
    where x.privilege_type='EXECUTE' order by 1),'{}')=array['postgres']::text[]) ready
  from internal_functions f join pg_proc p on p.oid=to_regprocedure(f.identity)
), frozen as (
  select bool_and(md5(p.prosrc)=x.hash) ready from (values
    ('public.complete_hotel_check_out(uuid,integer,timestamp with time zone,uuid)','7744baa7276dcb70676ec593e8ddc0e6'),
    ('public.reverse_hotel_completion(uuid,integer,text,text,uuid)','dd4dd04865adfa2dc3ec83097e2b81a3'),
    ('public.get_hotel_operations_snapshot_v2(date)','7dac53943e2f74f207de1cd36d5023fb')
  ) x(identity,hash) join pg_proc p on p.oid=to_regprocedure(x.identity)
), rls as (
  select count(*) filter(where relrowsecurity) count from pg_class where oid in(
    'public.long_stay_contracts'::regclass,'public.long_stay_monthly_occupancies'::regclass,
    'public.long_stay_absence_events'::regclass,'public.long_stay_operation_audit_events'::regclass)
), invariant_triggers as (
  select count(*) count from pg_trigger where not tgisinternal and tgname in(
    'long_stay_contract_runtime_invariant','long_stay_hotel_stay_runtime_invariant',
    'long_stay_capacity_runtime_invariant','long_stay_allocation_runtime_invariant') and tgenabled<>'D'
)
select case when target_tables.count=4 and public_contract.count=11 and public_contract.ready
  and internal_contract.count=7 and internal_contract.ready and frozen.ready
  and rls.count=4 and invariant_triggers.count=4
then 'LONG_STAY_HOTEL_PLATFORM_READY' else 'STOP_LONG_STAY_HOTEL_PLATFORM_POSTFLIGHT' end status,
target_tables.count table_count,public_contract.count public_function_count,
internal_contract.count internal_function_count,invariant_triggers.count invariant_trigger_count,
frozen.ready frozen_contract_unchanged
from target_tables,public_contract,internal_contract,frozen,rls,invariant_triggers;
