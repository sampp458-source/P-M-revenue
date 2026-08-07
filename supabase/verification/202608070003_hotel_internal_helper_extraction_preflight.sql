-- Read-only preflight for the meaning-preserving Hotel internal helper extraction.

begin read only;

with expected(identity, body_fingerprint) as (
  values
    (
      'public.create_flexible_hotel_reservation(uuid,uuid,date,time without time zone,boolean,date,time without time zone,boolean,uuid,uuid,uuid,uuid[],text,uuid)',
      'cad788cb79875fab06f0d84470da4698'
    ),
    (
      'public.change_room_type_before_check_in(uuid,integer,uuid,text,uuid)',
      '39c760d45df40a92cb3b82ceea8a48ea'
    ),
    (
      'public.change_room_type_after_check_in(uuid,integer,uuid,timestamp with time zone,text,uuid)',
      '7b2a2f0b1c24a3a6d92ac37d400c97d7'
    )
), target as (
  select
    expected.identity,
    expected.body_fingerprint as expected_body_fingerprint,
    procedure_row.oid,
    md5(procedure_row.prosrc) as actual_body_fingerprint,
    md5(pg_get_functiondef(procedure_row.oid)) as definition_fingerprint,
    pg_get_userbyid(procedure_row.proowner) as owner_name,
    procedure_row.prosecdef as security_definer,
    procedure_row.provolatile as volatility,
    pg_get_function_result(procedure_row.oid) as result_type,
    procedure_row.proconfig,
    lower(regexp_replace(procedure_row.prosrc, '\s+', ' ', 'g'))
      as normalized_body
  from expected
  left join pg_proc procedure_row
    on procedure_row.oid = to_regprocedure(expected.identity)
), target_acl as (
  select
    target.identity,
    coalesce(array_agg(distinct pg_get_userbyid(acl.grantee)::text
      order by pg_get_userbyid(acl.grantee)::text) filter (
        where acl.privilege_type = 'EXECUTE'
      ), '{}'::text[]) as execute_grantees
  from target
  left join lateral aclexplode(
    case when target.oid is null then '{}'::aclitem[] else coalesce(
      (select procedure_row.proacl from pg_proc procedure_row
        where procedure_row.oid = target.oid),
      acldefault('f', (select procedure_row.proowner from pg_proc procedure_row
        where procedure_row.oid = target.oid))
    )
    end
  ) acl on true
  group by target.identity
), immutable_guard(identity, expected_body_fingerprint) as (
  values
    (
      'public.complete_hotel_check_out(uuid,integer,timestamp with time zone,uuid)',
      '7744baa7276dcb70676ec593e8ddc0e6'
    ),
    (
      'public.reverse_hotel_completion(uuid,integer,text,text,uuid)',
      'dd4dd04865adfa2dc3ec83097e2b81a3'
    ),
    (
      'public.get_hotel_operations_snapshot_v2(date)',
      '7dac53943e2f74f207de1cd36d5023fb'
    )
), immutable_contract as (
  select bool_and(
    procedure_row.oid is not null
    and md5(procedure_row.prosrc) = immutable_guard.expected_body_fingerprint
  ) as ready
  from immutable_guard
  left join pg_proc procedure_row
    on procedure_row.oid = to_regprocedure(immutable_guard.identity)
), checks as (
  select
    (select count(*) from target where oid is not null) = 3
      as exact_target_signatures_ready,
    coalesce((select bool_and(
      actual_body_fingerprint = expected_body_fingerprint
    ) from target), false) as approved_source_variants_ready,
    coalesce((select bool_and(
      owner_name = 'postgres'
      and security_definer
      and volatility = 'v'
      and result_type = 'jsonb'
      and 'search_path=public, pg_temp' = any(proconfig)
    ) from target), false) as metadata_contract_ready,
    coalesce((select bool_and(
      execute_grantees = array['authenticated', 'postgres', 'service_role']::text[]
    ) from target_acl), false) as exact_public_acl_ready,
    to_regprocedure(
      'public.prepare_hotel_reservation_runtime_input_internal(uuid,uuid,date,time without time zone,boolean,date,time without time zone,boolean,uuid,uuid,uuid,uuid[],text)'
    ) is null
      and to_regprocedure(
        'public.create_hotel_reservation_runtime_internal(uuid,uuid,uuid,uuid,uuid[],text,uuid,uuid,uuid,uuid,jsonb)'
      ) is null
      and to_regprocedure(
        'public.change_hotel_room_type_and_allocation_internal(text,uuid,integer,uuid,uuid,text,text,timestamp with time zone,text,text,uuid,uuid)'
      ) is null as helpers_absent,
    coalesce((select ready from immutable_contract), false)
      as frozen_hotel_contract_ready,
    coalesce((select
      normalized_body like '%호텔 예약 등록 권한이 없습니다.%'
      and normalized_body like '%hotel-request:%'
      and normalized_body like '%동일 request_id의 입력 계약이 일치하지 않습니다.%'
      and normalized_body like '%assert_hotel_capacity_available%'
      and normalized_body like '%create_operation_schedule%'
      and normalized_body like '%insert into public.hotel_stays%'
      and normalized_body like '%insert into public.hotel_capacity_reservations%'
      and normalized_body like '%return public.hotel_stay_json%'
      from target
      where identity like 'public.create_flexible_hotel_reservation(%'
    ), false) as create_semantic_contract_ready,
    coalesce((select bool_and(
      normalized_body like '%has_operation_role(array[''owner'', ''manager''])%'
      and normalized_body like '%hotel-request:%'
      and normalized_body like '%동일 request_id의 입력 계약 불일치%'
      and normalized_body like '%assert_hotel_capacity_available%'
      and normalized_body like '%assert_hotel_room_allocation_available%'
      and normalized_body like '%hotel stay root audit이 정확히 한 건%'
      and normalized_body not like '%update public.operation_schedules%'
    ) from target
    where identity like 'public.change_room_type_%'), false)
      as cross_type_semantic_contract_ready,
    to_regprocedure(
      'public.create_operation_schedule(uuid,uuid,text,timestamp with time zone,timestamp with time zone,boolean,boolean,text,uuid[],uuid[],uuid[],uuid)'
    ) is not null
      and to_regprocedure(
        'public.assert_hotel_capacity_available(uuid,timestamp with time zone,timestamp with time zone,integer,uuid)'
      ) is not null
      and to_regprocedure(
        'public.assert_hotel_room_allocation_available(uuid,uuid,timestamp with time zone,timestamp with time zone,uuid)'
      ) is not null
      and to_regprocedure('public.hotel_stay_json(uuid)') is not null
      and to_regprocedure('public.is_replayed_hotel_stay_request(uuid,uuid)')
        is not null as dependency_contract_ready,
    not exists (
      select 1
      from pg_proc procedure_row
      join pg_namespace schema_row
        on schema_row.oid = procedure_row.pronamespace
      where schema_row.nspname = 'public'
        and procedure_row.proname like '%long_stay%'
    ) as no_long_stay_runtime_objects
)
select
  case
    when not exact_target_signatures_ready
      then 'STOP_HELPER_EXTRACTION_TARGET_SIGNATURE_MISMATCH'
    when not approved_source_variants_ready
      then 'STOP_HELPER_EXTRACTION_UNAPPROVED_SOURCE_VARIANT'
    when not metadata_contract_ready
      then 'STOP_HELPER_EXTRACTION_METADATA_CONTRACT_MISMATCH'
    when not exact_public_acl_ready
      then 'STOP_HELPER_EXTRACTION_PUBLIC_ACL_MISMATCH'
    when not helpers_absent
      then 'STOP_HELPER_EXTRACTION_HELPER_ALREADY_EXISTS'
    when not frozen_hotel_contract_ready
      then 'STOP_HELPER_EXTRACTION_FROZEN_HOTEL_DRIFT'
    when not create_semantic_contract_ready
      then 'STOP_HELPER_EXTRACTION_CREATE_CONTRACT_MISMATCH'
    when not cross_type_semantic_contract_ready
      then 'STOP_HELPER_EXTRACTION_CROSS_TYPE_CONTRACT_MISMATCH'
    when not dependency_contract_ready
      then 'STOP_HELPER_EXTRACTION_DEPENDENCY_MISMATCH'
    when not no_long_stay_runtime_objects
      then 'STOP_HELPER_EXTRACTION_LONG_STAY_OBJECT_PRESENT'
    else 'READY_TO_APPLY_HOTEL_INTERNAL_HELPER_EXTRACTION'
  end as preflight_status,
  checks.*,
  (
    select jsonb_agg(
      jsonb_build_object(
        'function_identity', target.identity,
        'expected_body_fingerprint', target.expected_body_fingerprint,
        'actual_body_fingerprint', target.actual_body_fingerprint,
        'definition_fingerprint', target.definition_fingerprint,
        'owner_name', target.owner_name,
        'security_definer', target.security_definer,
        'volatility', target.volatility,
        'result_type', target.result_type,
        'proconfig', target.proconfig,
        'execute_grantees', target_acl.execute_grantees
      )
      order by target.identity
    )
    from target
    join target_acl using (identity)
  ) as target_contracts
from checks;

rollback;
