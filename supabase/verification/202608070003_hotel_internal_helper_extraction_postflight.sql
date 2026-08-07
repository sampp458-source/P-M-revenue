-- Read-only postflight for the Hotel internal helper extraction.

begin read only;

with expected(identity, fingerprint, kind) as (
  values
    ('public.create_flexible_hotel_reservation(uuid,uuid,date,time without time zone,boolean,date,time without time zone,boolean,uuid,uuid,uuid,uuid[],text,uuid)', 'cca668cd6142942eb9af87dcfada05d8', 'public'),
    ('public.change_room_type_before_check_in(uuid,integer,uuid,text,uuid)', 'e18904d6698133d3b735af55d3e2209f', 'public'),
    ('public.change_room_type_after_check_in(uuid,integer,uuid,timestamp with time zone,text,uuid)', '34804fd6ef82d8ac99cd042816d3e93b', 'public'),
    ('public.prepare_hotel_reservation_runtime_input_internal(uuid,uuid,date,time without time zone,boolean,date,time without time zone,boolean,uuid,uuid,uuid,uuid[],text)', '471673afbfe5dfff9fcac28356b07603', 'internal'),
    ('public.create_hotel_reservation_runtime_internal(uuid,uuid,uuid,uuid,uuid[],text,uuid,uuid,uuid,uuid,jsonb)', '48d9146603c1462a02cb8df65458cc8f', 'internal'),
    ('public.change_hotel_room_type_and_allocation_internal(text,uuid,integer,uuid,uuid,text,text,timestamp with time zone,text,text,uuid,uuid)', '2a344bee4a21279f1d6a4a7c4dac1445', 'internal')
), functions as (
  select
    expected.*,
    procedure_row.oid,
    md5(procedure_row.prosrc) actual_fingerprint,
    md5(pg_get_functiondef(procedure_row.oid)) definition_fingerprint,
    pg_get_userbyid(procedure_row.proowner) owner_name,
    procedure_row.prosecdef security_definer,
    procedure_row.provolatile volatility,
    pg_get_function_result(procedure_row.oid) result_type,
    procedure_row.proconfig,
    lower(regexp_replace(procedure_row.prosrc, '\s+', ' ', 'g')) normalized_body
  from expected
  left join pg_proc procedure_row
    on procedure_row.oid = to_regprocedure(expected.identity)
), acl as (
  select
    functions.identity,
    coalesce(array_agg(distinct pg_get_userbyid(item.grantee)::text
      order by pg_get_userbyid(item.grantee)::text) filter (
        where item.privilege_type = 'EXECUTE'
      ), '{}'::text[]) execute_grantees
  from functions
  left join lateral aclexplode(
    case when functions.oid is null then '{}'::aclitem[] else coalesce(
      (select p.proacl from pg_proc p where p.oid = functions.oid),
      acldefault('f', (select p.proowner from pg_proc p where p.oid = functions.oid))
    )
    end
  ) item on true
  group by functions.identity
), frozen(identity, fingerprint) as (
  values
    ('public.complete_hotel_check_out(uuid,integer,timestamp with time zone,uuid)', '7744baa7276dcb70676ec593e8ddc0e6'),
    ('public.reverse_hotel_completion(uuid,integer,text,text,uuid)', 'dd4dd04865adfa2dc3ec83097e2b81a3'),
    ('public.get_hotel_operations_snapshot_v2(date)', '7dac53943e2f74f207de1cd36d5023fb')
), checks as (
  select
    (select count(*) from functions where oid is not null) = 6
      as exact_function_count_ready,
    coalesce((select bool_and(actual_fingerprint = fingerprint) from functions), false)
      as expected_fingerprints_ready,
    coalesce((select bool_and(
      owner_name = 'postgres'
      and security_definer
      and volatility = 'v'
      and result_type = 'jsonb'
      and 'search_path=public, pg_temp' = any(proconfig)
    ) from functions), false) as metadata_ready,
    coalesce((select bool_and(
      case when functions.kind = 'internal'
        then acl.execute_grantees = array['postgres']::text[]
        else acl.execute_grantees =
          array['authenticated', 'postgres', 'service_role']::text[]
      end
    ) from functions join acl using (identity)), false) as exact_acl_ready,
    coalesce((select bool_and(
      case
        when identity like 'public.create_flexible%'
          then normalized_body like '%prepare_hotel_reservation_runtime_input_internal%'
            and normalized_body like '%create_hotel_reservation_runtime_internal%'
            and normalized_body like '%hotel-request:%'
            and normalized_body like '%동일 request_id의 입력 계약이 일치하지 않습니다.%'
        when identity like 'public.change_room_type_before%'
          then normalized_body like '%change_hotel_room_type_and_allocation_internal%'
            and normalized_body like '%before_check_in%'
            and normalized_body like '%hotel-request:%'
            and normalized_body like '%동일 request_id의 입력 계약 불일치%'
        when identity like 'public.change_room_type_after%'
          then normalized_body like '%change_hotel_room_type_and_allocation_internal%'
            and normalized_body like '%after_check_in%'
            and normalized_body like '%hotel-request:%'
            and normalized_body like '%동일 request_id의 입력 계약 불일치%'
        else true
      end
    ) from functions where kind = 'public'), false) as wrapper_contract_ready,
    coalesce((select bool_and(
      case
        when identity like '%prepare_hotel%'
          then normalized_body like '%asia/seoul%'
            and normalized_body like '%capacityuntil%'
        when identity like '%create_hotel_reservation_runtime%'
          then normalized_body like '%assert_hotel_capacity_available%'
            and normalized_body like '%create_operation_schedule%'
            and normalized_body like '%insert into public.hotel_stays%'
            and normalized_body like '%insert into public.hotel_capacity_reservations%'
        else normalized_body like '%for update%'
          and normalized_body like '%hotel-capacity:%'
          and normalized_body like '%hotel-room:%'
          and normalized_body like '%assert_hotel_room_allocation_available%'
          and normalized_body like '%hotel stay root audit이 정확히 한 건%'
      end
    ) from functions where kind = 'internal'), false) as helper_contract_ready,
    coalesce((select bool_and(
      procedure_row.oid is not null
      and md5(procedure_row.prosrc) = frozen.fingerprint
    )
    from frozen
    left join pg_proc procedure_row
      on procedure_row.oid = to_regprocedure(frozen.identity)), false)
      as frozen_hotel_contract_ready,
    not exists (
      select 1 from functions
      where normalized_body like '%long_stay%'
         or normalized_body like '%infinity%'
    ) as forbidden_runtime_contract_absent
)
select
  case
    when not exact_function_count_ready then 'STOP_HOTEL_HELPER_EXTRACTION_FUNCTION_COUNT'
    when not expected_fingerprints_ready then 'STOP_HOTEL_HELPER_EXTRACTION_FINGERPRINT'
    when not metadata_ready then 'STOP_HOTEL_HELPER_EXTRACTION_METADATA'
    when not exact_acl_ready then 'STOP_HOTEL_HELPER_EXTRACTION_ACL'
    when not wrapper_contract_ready then 'STOP_HOTEL_HELPER_EXTRACTION_WRAPPER_CONTRACT'
    when not helper_contract_ready then 'STOP_HOTEL_HELPER_EXTRACTION_HELPER_CONTRACT'
    when not frozen_hotel_contract_ready then 'STOP_HOTEL_HELPER_EXTRACTION_FROZEN_DIFF'
    when not forbidden_runtime_contract_absent then 'STOP_HOTEL_HELPER_EXTRACTION_FORBIDDEN_RUNTIME'
    else 'HOTEL_INTERNAL_HELPER_EXTRACTION_READY'
  end as postflight_status,
  checks.*,
  (
    select jsonb_agg(
      jsonb_build_object(
        'identity', functions.identity,
        'kind', functions.kind,
        'expected_fingerprint', functions.fingerprint,
        'actual_fingerprint', functions.actual_fingerprint,
        'definition_fingerprint', functions.definition_fingerprint,
        'owner_name', functions.owner_name,
        'security_definer', functions.security_definer,
        'volatility', functions.volatility,
        'result_type', functions.result_type,
        'proconfig', functions.proconfig,
        'execute_grantees', acl.execute_grantees
      )
      order by functions.kind, functions.identity
    )
    from functions
    join acl using (identity)
  ) as function_contracts
from checks;

rollback;
