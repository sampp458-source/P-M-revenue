-- Read-only gate for the Hotel Internal Helper Long Stay Extension.

begin read only;

with expected(
  identity, body_fingerprint, definition_fingerprint,
  expected_volatility, expected_return_type, expected_acl
) as (
  values
    ('public.create_flexible_hotel_reservation(uuid,uuid,date,time without time zone,boolean,date,time without time zone,boolean,uuid,uuid,uuid,uuid[],text,uuid)', 'cca668cd6142942eb9af87dcfada05d8', '04cac0ee426974d370d97195436c6efc', 'v', 'jsonb', array['authenticated','postgres','service_role']::text[]),
    ('public.change_room_type_before_check_in(uuid,integer,uuid,text,uuid)', 'e18904d6698133d3b735af55d3e2209f', '7dbc179de63f3174ad90d46658404390', 'v', 'jsonb', array['authenticated','postgres','service_role']::text[]),
    ('public.change_room_type_after_check_in(uuid,integer,uuid,timestamp with time zone,text,uuid)', '34804fd6ef82d8ac99cd042816d3e93b', '6c80e5e91a89c8efcee9dc8ae3711369', 'v', 'jsonb', array['authenticated','postgres','service_role']::text[]),
    ('public.prepare_hotel_reservation_runtime_input_internal(uuid,uuid,date,time without time zone,boolean,date,time without time zone,boolean,uuid,uuid,uuid,uuid[],text)', '471673afbfe5dfff9fcac28356b07603', '5298a977437eba4c8c8de5645899ef49', 'v', 'jsonb', array['postgres']::text[]),
    ('public.create_hotel_reservation_runtime_internal(uuid,uuid,uuid,uuid,uuid[],text,uuid,uuid,uuid,uuid,jsonb)', '48d9146603c1462a02cb8df65458cc8f', '7ad67c55f8fde942219be2bc16c86a71', 'v', 'jsonb', array['postgres']::text[]),
    ('public.change_hotel_room_type_and_allocation_internal(text,uuid,integer,uuid,uuid,text,text,timestamp with time zone,text,text,uuid,uuid)', '2a344bee4a21279f1d6a4a7c4dac1445', 'a9f0fbcb4e46bf69d2ff6a26dc26dbf0', 'v', 'jsonb', array['postgres']::text[]),
    ('public.complete_hotel_check_out(uuid,integer,timestamp with time zone,uuid)', '7744baa7276dcb70676ec593e8ddc0e6', 'd73c90ca6f9f454f5867feed5d8fe496', 'v', 'jsonb', array['authenticated','postgres','service_role']::text[]),
    ('public.reverse_hotel_completion(uuid,integer,text,text,uuid)', 'dd4dd04865adfa2dc3ec83097e2b81a3', '4029c9e292df3a690b1040cb37debf61', 'v', 'jsonb', array['authenticated','postgres','service_role']::text[]),
    ('public.get_hotel_operations_snapshot_v2(date)', '7dac53943e2f74f207de1cd36d5023fb', 'ddcbfba32525ed050124fa337127f366', 's', 'jsonb', array['authenticated','postgres','service_role']::text[])
), targets as (
  select expected.*, procedure_row.oid,
    md5(procedure_row.prosrc) as actual_fingerprint,
    pg_get_userbyid(procedure_row.proowner) as owner_name,
    procedure_row.prosecdef, procedure_row.provolatile,
    pg_get_function_result(procedure_row.oid) as result_type,
    procedure_row.proconfig
  from expected
  left join pg_proc procedure_row
    on procedure_row.oid = to_regprocedure(expected.identity)
), acl as (
  select targets.identity,
    coalesce(array_agg(distinct pg_get_userbyid(entry.grantee)::text
      order by pg_get_userbyid(entry.grantee)::text)
      filter (where entry.privilege_type = 'EXECUTE'), '{}'::text[])
      as execute_grantees
  from targets
  left join pg_proc procedure_row on procedure_row.oid = targets.oid
  left join lateral aclexplode(coalesce(
    procedure_row.proacl, acldefault('f', procedure_row.proowner)
  )) entry on true
  group by targets.identity
), checks as (
  select
    coalesce((select bool_and(
      targets.oid is not null
      and targets.actual_fingerprint = targets.body_fingerprint
      and md5(pg_get_functiondef(targets.oid)) = targets.definition_fingerprint
    ) from targets), false) as exact_baseline_fingerprints,
    coalesce((select bool_and(
      targets.owner_name = 'postgres'
      and targets.prosecdef
      and targets.provolatile = targets.expected_volatility
      and targets.result_type = targets.expected_return_type
      and 'search_path=public, pg_temp' = any(targets.proconfig)
    ) from targets), false) as metadata_ready,
    coalesce((select bool_and(
      acl.execute_grantees = targets.expected_acl
    ) from targets join acl using (identity)), false) as exact_acl_ready,
    to_regprocedure('public.prepare_hotel_reservation_runtime_input_extended_internal(uuid,uuid,date,time without time zone,boolean,date,time without time zone,boolean,boolean,timestamp with time zone,uuid,uuid,uuid,uuid[],text)') is null
      and to_regprocedure('public.create_hotel_reservation_runtime_extended_internal(uuid,uuid,uuid,uuid,uuid[],text,uuid,uuid,uuid,uuid,jsonb,boolean)') is null
      and to_regprocedure('public.change_hotel_room_type_and_allocation_extended_internal(text,uuid,integer,uuid,uuid,text,text,timestamp with time zone,text,text,uuid,uuid,text[])') is null
      as extended_helpers_absent,
    not exists (
      select 1 from pg_proc procedure_row
      join pg_namespace schema_row on schema_row.oid = procedure_row.pronamespace
      where schema_row.nspname = 'public'
        and procedure_row.proname like '%long_stay%'
    ) as long_stay_runtime_absent
)
select case
  when not exact_baseline_fingerprints then 'STOP_LONG_STAY_EXTENSION_BASELINE_FINGERPRINT'
  when not metadata_ready then 'STOP_LONG_STAY_EXTENSION_METADATA'
  when not exact_acl_ready then 'STOP_LONG_STAY_EXTENSION_ACL'
  when not extended_helpers_absent then 'STOP_LONG_STAY_EXTENSION_ALREADY_PRESENT'
  when not long_stay_runtime_absent then 'STOP_LONG_STAY_EXTENSION_RUNTIME_ALREADY_PRESENT'
  else 'READY_TO_APPLY_HOTEL_INTERNAL_HELPER_LONG_STAY_EXTENSION'
end as preflight_status,
checks.*,
(select jsonb_agg(jsonb_build_object(
  'identity', targets.identity,
  'expected', targets.body_fingerprint,
  'actual', targets.actual_fingerprint,
  'expectedDefinition', targets.definition_fingerprint,
  'actualDefinition', md5(pg_get_functiondef(targets.oid)),
  'volatility', targets.provolatile,
  'expectedVolatility', targets.expected_volatility,
  'acl', acl.execute_grantees
) order by targets.identity) from targets join acl using (identity)) as contract_detail
from checks;

rollback;
