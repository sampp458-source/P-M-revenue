-- Read-only Long Stay Platform preflight.
with required_functions(identity, body_fingerprint, volatility, result_type, acl) as (
  values
    ('public.prepare_hotel_reservation_runtime_input_extended_internal(uuid,uuid,date,time without time zone,boolean,date,time without time zone,boolean,boolean,timestamp with time zone,uuid,uuid,uuid,uuid[],text)','20bdaf193ebba7ef970d7b160a380f2a','v','jsonb',array['postgres']::text[]),
    ('public.create_hotel_reservation_runtime_extended_internal(uuid,uuid,uuid,uuid,uuid[],text,uuid,uuid,uuid,uuid,jsonb,boolean)','6c1ab1e0f7f6aa10ad7811699fc917c7','v','jsonb',array['postgres']::text[]),
    ('public.change_hotel_room_type_and_allocation_extended_internal(text,uuid,integer,uuid,uuid,text,text,timestamp with time zone,text,text,uuid,uuid,text[])','dc5c996ccff3e3416a31451e512d0f1c','v','jsonb',array['postgres']::text[]),
    ('public.complete_hotel_check_out(uuid,integer,timestamp with time zone,uuid)','7744baa7276dcb70676ec593e8ddc0e6','v','jsonb',array['authenticated','postgres','service_role']::text[]),
    ('public.reverse_hotel_completion(uuid,integer,text,text,uuid)','dd4dd04865adfa2dc3ec83097e2b81a3','v','jsonb',array['authenticated','postgres','service_role']::text[]),
    ('public.get_hotel_operations_snapshot_v2(date)','7dac53943e2f74f207de1cd36d5023fb','s','jsonb',array['authenticated','postgres','service_role']::text[])
), function_contract as (
  select bool_and(p.oid is not null and md5(p.prosrc)=r.body_fingerprint
    and pg_get_userbyid(p.proowner)='postgres' and p.prosecdef
    and p.provolatile=r.volatility and pg_get_function_result(p.oid)=r.result_type
    and 'search_path=public, pg_temp'=any(p.proconfig)
    and coalesce(array(select distinct pg_get_userbyid(x.grantee)::text
      from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x
      where x.privilege_type='EXECUTE' order by 1),'{}'::text[])=r.acl) ready
  from required_functions r left join pg_proc p on p.oid=to_regprocedure(r.identity)
), target_count as (
  select
    (select count(*) from pg_class where oid in (
      to_regclass('public.long_stay_contracts'),
      to_regclass('public.long_stay_monthly_occupancies'),
      to_regclass('public.long_stay_absence_events'),
      to_regclass('public.long_stay_operation_audit_events')))
    +(select count(*) from pg_proc where pronamespace='public'::regnamespace
      and proname like '%long_stay%') count
)
select case when function_contract.ready and target_count.count=0
  and to_regclass('public.customers') is not null
  and to_regclass('public.dogs') is not null
  and to_regclass('public.hotel_stays') is not null
  and to_regclass('public.hotel_capacity_reservations') is not null
  and to_regclass('public.hotel_room_allocations') is not null
then 'READY_TO_APPLY_LONG_STAY_HOTEL_PLATFORM'
else 'STOP_LONG_STAY_HOTEL_PLATFORM_PREFLIGHT' end as status,
function_contract.ready as production_helper_contract_ready,
target_count.count as existing_target_count
from function_contract,target_count;
