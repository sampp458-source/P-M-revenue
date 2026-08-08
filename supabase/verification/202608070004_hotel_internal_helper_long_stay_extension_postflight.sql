-- Read-only postflight for the Hotel Internal Helper Long Stay Extension.

begin read only;

with public_contract(
  identity, fingerprint, definition_fingerprint,
  expected_volatility, expected_return_type, expected_acl
) as (
  values
    ('public.create_flexible_hotel_reservation(uuid,uuid,date,time without time zone,boolean,date,time without time zone,boolean,uuid,uuid,uuid,uuid[],text,uuid)', 'cca668cd6142942eb9af87dcfada05d8', '04cac0ee426974d370d97195436c6efc', 'v', 'jsonb', array['authenticated','postgres','service_role']::text[]),
    ('public.change_room_type_before_check_in(uuid,integer,uuid,text,uuid)', 'e18904d6698133d3b735af55d3e2209f', '7dbc179de63f3174ad90d46658404390', 'v', 'jsonb', array['authenticated','postgres','service_role']::text[]),
    ('public.change_room_type_after_check_in(uuid,integer,uuid,timestamp with time zone,text,uuid)', '34804fd6ef82d8ac99cd042816d3e93b', '6c80e5e91a89c8efcee9dc8ae3711369', 'v', 'jsonb', array['authenticated','postgres','service_role']::text[]),
    ('public.complete_hotel_check_out(uuid,integer,timestamp with time zone,uuid)', '7744baa7276dcb70676ec593e8ddc0e6', 'd73c90ca6f9f454f5867feed5d8fe496', 'v', 'jsonb', array['authenticated','postgres','service_role']::text[]),
    ('public.reverse_hotel_completion(uuid,integer,text,text,uuid)', 'dd4dd04865adfa2dc3ec83097e2b81a3', '4029c9e292df3a690b1040cb37debf61', 'v', 'jsonb', array['authenticated','postgres','service_role']::text[]),
    ('public.get_hotel_operations_snapshot_v2(date)', '7dac53943e2f74f207de1cd36d5023fb', 'ddcbfba32525ed050124fa337127f366', 's', 'jsonb', array['authenticated','postgres','service_role']::text[])
), helper_contract(identity, kind, expected_fingerprint) as (
  values
    ('public.prepare_hotel_reservation_runtime_input_internal(uuid,uuid,date,time without time zone,boolean,date,time without time zone,boolean,uuid,uuid,uuid,uuid[],text)', 'compat', 'a381a89f745550528114030dad88f954'),
    ('public.create_hotel_reservation_runtime_internal(uuid,uuid,uuid,uuid,uuid[],text,uuid,uuid,uuid,uuid,jsonb)', 'compat', 'e00da45677db792f67d73271671062e9'),
    ('public.change_hotel_room_type_and_allocation_internal(text,uuid,integer,uuid,uuid,text,text,timestamp with time zone,text,text,uuid,uuid)', 'compat', '2e1d1d038e5013e68b668b794e92f812'),
    ('public.prepare_hotel_reservation_runtime_input_extended_internal(uuid,uuid,date,time without time zone,boolean,date,time without time zone,boolean,boolean,timestamp with time zone,uuid,uuid,uuid,uuid[],text)', 'extended', '20bdaf193ebba7ef970d7b160a380f2a'),
    ('public.create_hotel_reservation_runtime_extended_internal(uuid,uuid,uuid,uuid,uuid[],text,uuid,uuid,uuid,uuid,jsonb,boolean)', 'extended', '6c1ab1e0f7f6aa10ad7811699fc917c7'),
    ('public.change_hotel_room_type_and_allocation_extended_internal(text,uuid,integer,uuid,uuid,text,text,timestamp with time zone,text,text,uuid,uuid,text[])', 'extended', 'dc5c996ccff3e3416a31451e512d0f1c')
), helper as (
  select helper_contract.*, procedure_row.oid,
    md5(procedure_row.prosrc) as body_fingerprint,
    lower(regexp_replace(procedure_row.prosrc, '\s+', ' ', 'g')) as body,
    pg_get_userbyid(procedure_row.proowner) as owner_name,
    procedure_row.prosecdef, procedure_row.provolatile,
    pg_get_function_result(procedure_row.oid) as result_type,
    procedure_row.proconfig
  from helper_contract
  left join pg_proc procedure_row
    on procedure_row.oid = to_regprocedure(helper_contract.identity)
), helper_acl as (
  select helper.identity,
    coalesce(array_agg(distinct pg_get_userbyid(entry.grantee)::text
      order by pg_get_userbyid(entry.grantee)::text)
      filter (where entry.privilege_type = 'EXECUTE'), '{}'::text[])
      as execute_grantees
  from helper
  left join pg_proc procedure_row on procedure_row.oid = helper.oid
  left join lateral aclexplode(coalesce(
    procedure_row.proacl, acldefault('f', procedure_row.proowner)
  )) entry on true
  group by helper.identity
), public_target as (
  select public_contract.*, procedure_row.oid,
    md5(procedure_row.prosrc) as actual_fingerprint,
    md5(pg_get_functiondef(procedure_row.oid)) as actual_definition_fingerprint,
    pg_get_userbyid(procedure_row.proowner) as owner_name,
    procedure_row.prosecdef, procedure_row.provolatile,
    pg_get_function_result(procedure_row.oid) as result_type,
    procedure_row.proconfig
  from public_contract
  left join pg_proc procedure_row
    on procedure_row.oid = to_regprocedure(public_contract.identity)
), public_acl as (
  select public_target.identity,
    coalesce(array_agg(distinct pg_get_userbyid(entry.grantee)::text
      order by pg_get_userbyid(entry.grantee)::text)
      filter (where entry.privilege_type = 'EXECUTE'), '{}'::text[])
      as execute_grantees
  from public_target
  left join pg_proc procedure_row on procedure_row.oid = public_target.oid
  left join lateral aclexplode(coalesce(
    procedure_row.proacl, acldefault('f', procedure_row.proowner)
  )) entry on true
  group by public_target.identity
), checks as (
  select
    coalesce((select bool_and(
      public_target.oid is not null
      and public_target.actual_fingerprint = public_target.fingerprint
      and public_target.actual_definition_fingerprint = public_target.definition_fingerprint
      and public_target.owner_name = 'postgres'
      and public_target.prosecdef
      and public_target.provolatile = public_target.expected_volatility
      and public_target.result_type = public_target.expected_return_type
      and 'search_path=public, pg_temp' = any(public_target.proconfig)
      and public_acl.execute_grantees = public_target.expected_acl
    ) from public_target join public_acl using (identity)), false)
      as public_contract_unchanged,
    (select count(*) from helper where oid is not null) = 6
      as exact_helper_count,
    coalesce((select bool_and(
      body_fingerprint = expected_fingerprint
    ) from helper), false) as exact_helper_fingerprints,
    coalesce((select bool_and(
      owner_name = 'postgres' and prosecdef and provolatile = 'v'
      and result_type = 'jsonb'
      and 'search_path=public, pg_temp' = any(proconfig)
    ) from helper), false) as helper_metadata_ready,
    coalesce((select bool_and(
      helper_acl.execute_grantees = array['postgres']::text[]
    ) from helper join helper_acl using (identity)), false)
      as helper_acl_ready,
    coalesce((select bool_and(
      case helper.identity
        when 'public.prepare_hotel_reservation_runtime_input_internal(uuid,uuid,date,time without time zone,boolean,date,time without time zone,boolean,uuid,uuid,uuid,uuid[],text)'
          then body like '%prepare_hotel_reservation_runtime_input_extended_internal%'
            and body like '%true, null%'
        when 'public.create_hotel_reservation_runtime_internal(uuid,uuid,uuid,uuid,uuid[],text,uuid,uuid,uuid,uuid,jsonb)'
          then body like '%create_hotel_reservation_runtime_extended_internal%'
            and body like '%jsonb_build_object(''includecheckoutevent'', true)%'
        when 'public.change_hotel_room_type_and_allocation_internal(text,uuid,integer,uuid,uuid,text,text,timestamp with time zone,text,text,uuid,uuid)'
          then body like '%change_hotel_room_type_and_allocation_extended_internal%'
            and body like '%array[''check_in'', ''check_out'']%'
        else true
      end
    ) from helper where kind = 'compat'), false) as compatibility_wrappers_ready,
    coalesce((select bool_and(
      case
        when identity like '%prepare_hotel_reservation_runtime_input_extended_internal%'
          then body like '%p_include_check_out_event%'
            and body like '%p_capacity_until_override%'
            and body like '%''checkouttitle'', case when include_check_out%'
        when identity like '%create_hotel_reservation_runtime_extended_internal%'
          then body like '%if include_check_out then%'
            and body like '%insert into public.hotel_stay_schedule_events%'
        when identity like '%change_hotel_room_type_and_allocation_extended_internal%'
          then body like '%p_required_event_kinds%'
            and body like '%cardinality_check.event_count <> 1%'
            and body like '%for update of schedule%'
        else false
      end
    ) from helper where kind = 'extended'), false) as extension_contract_ready,
    not exists (
      select 1 from pg_proc procedure_row
      join pg_namespace schema_row on schema_row.oid = procedure_row.pronamespace
      where schema_row.nspname = 'public'
        and procedure_row.proname like '%long_stay%'
    ) as long_stay_runtime_absent
)
select case
  when not public_contract_unchanged then 'STOP_LONG_STAY_EXTENSION_PUBLIC_CONTRACT_DIFF'
  when not exact_helper_count then 'STOP_LONG_STAY_EXTENSION_HELPER_COUNT'
  when not exact_helper_fingerprints then 'STOP_LONG_STAY_EXTENSION_HELPER_FINGERPRINT'
  when not helper_metadata_ready then 'STOP_LONG_STAY_EXTENSION_HELPER_METADATA'
  when not helper_acl_ready then 'STOP_LONG_STAY_EXTENSION_HELPER_ACL'
  when not compatibility_wrappers_ready then 'STOP_LONG_STAY_EXTENSION_COMPATIBILITY_WRAPPER'
  when not extension_contract_ready then 'STOP_LONG_STAY_EXTENSION_CONTRACT'
  when not long_stay_runtime_absent then 'STOP_LONG_STAY_EXTENSION_RUNTIME_OBJECT_FOUND'
  else 'HOTEL_INTERNAL_HELPER_LONG_STAY_EXTENSION_READY'
end as postflight_status,
checks.*,
(select jsonb_agg(jsonb_build_object(
  'identity', helper.identity,
  'kind', helper.kind,
  'fingerprint', helper.body_fingerprint,
  'acl', helper_acl.execute_grantees
) order by helper.identity) from helper join helper_acl using (identity)) as helper_contract
from checks;

rollback;
