-- Family Booking Platform read-only postflight.

begin read only;

with expected_tables(table_name) as (
  values
    ('family_bookings'),
    ('family_booking_members'),
    ('family_shared_room_groups')
), table_contract as (
  select
    bool_and(table_row.oid is not null) as tables_ready,
    bool_and(coalesce(table_row.relrowsecurity, false)) as rls_ready,
    jsonb_agg(jsonb_build_object(
      'table', expected.table_name,
      'exists', table_row.oid is not null,
      'rls', coalesce(table_row.relrowsecurity, false)
    ) order by expected.table_name) as diagnostics
  from expected_tables expected
  left join pg_class table_row
    on table_row.relnamespace = 'public'::regnamespace
   and table_row.relname = expected.table_name
   and table_row.relkind = 'r'
), expected_functions(
  function_identity,
  expected_security_definer,
  expected_volatility,
  expected_result_type,
  expected_authenticated_execute
) as (
  values
    ('public.family_booking_internal_request_id(uuid,uuid,text,text,text)',
      false, 'i', 'uuid', false),
    ('public.canonicalize_family_booking_payload(uuid,text,boolean,jsonb)',
      false, 'v', 'jsonb', false),
    ('public.family_booking_payload_hash(jsonb)',
      false, 'i', 'text', false),
    ('public.assert_family_booking_payload(jsonb)',
      true, 'v', 'void', false),
    ('public.family_booking_derived_status(uuid)',
      true, 's', 'text', false),
    ('public.family_booking_json(uuid)',
      true, 's', 'jsonb', true),
    ('public.family_booking_set_metadata()',
      true, 'v', 'trigger', false),
    ('public.prevent_family_booking_physical_delete()',
      false, 'v', 'trigger', false),
    ('public.record_family_booking_audit_event()',
      true, 'v', 'trigger', false),
    ('public.create_family_hotel_member(uuid,uuid,uuid,date,time without time zone,boolean,date,time without time zone,boolean,uuid,uuid,uuid,uuid[],text)',
      true, 'v', 'jsonb', false),
    ('public.create_family_training_member(uuid,uuid,uuid,text,timestamp with time zone,timestamp with time zone,boolean,boolean,uuid,uuid,uuid[],text)',
      true, 'v', 'jsonb', false),
    ('public.create_family_daycare_member(uuid,uuid,uuid,text,timestamp with time zone,timestamp with time zone,boolean,boolean,uuid,uuid,uuid[],text)',
      true, 'v', 'jsonb', false),
    ('public.create_family_booking(uuid,text,boolean,jsonb,uuid)',
      true, 'v', 'jsonb', true)
), function_contract as (
  select
    expected.function_identity,
    procedure_row.oid is not null as identity_ready,
    coalesce(
      procedure_row.prosecdef = expected.expected_security_definer, false
    ) as security_ready,
    coalesce(
      'search_path=public, pg_temp' = any(procedure_row.proconfig), false
    ) as search_path_ready,
    coalesce(
      procedure_row.provolatile = expected.expected_volatility, false
    ) as volatility_ready,
    coalesce(
      procedure_row.prorettype = expected.expected_result_type::regtype,
      false
    ) as result_type_ready,
    coalesce(
      has_function_privilege('authenticated', procedure_row.oid, 'EXECUTE')
        = expected.expected_authenticated_execute,
      false
    ) as execute_ready,
    md5(procedure_row.prosrc) as body_fingerprint
  from expected_functions expected
  left join pg_proc procedure_row
    on procedure_row.oid = to_regprocedure(expected.function_identity)
), function_summary as (
  select
    bool_and(
      identity_ready and security_ready and search_path_ready
      and volatility_ready and result_type_ready and execute_ready
    ) as ready,
    jsonb_agg(to_jsonb(function_contract)
      order by function_identity) as diagnostics
  from function_contract
), policy_contract as (
  select count(*) = 3
    and bool_and(cmd = 'SELECT')
    and bool_and(roles = array['authenticated']::name[])
      as ready,
    jsonb_agg(jsonb_build_object(
      'table', tablename,
      'policy', policyname,
      'command', cmd,
      'roles', roles
    ) order by tablename) as diagnostics
  from pg_policies
  where schemaname = 'public'
    and tablename in (
      'family_bookings',
      'family_booking_members',
      'family_shared_room_groups'
    )
), trigger_contract as (
  select
    count(*) filter (
      where trigger_row.tgname in (
        'family_bookings_metadata',
        'family_booking_members_metadata',
        'family_shared_room_groups_metadata'
      )
    ) = 3 as metadata_ready,
    count(*) filter (
      where trigger_row.tgname in (
        'family_bookings_audit',
        'family_booking_members_audit',
        'family_shared_room_groups_audit'
      )
    ) = 3 as audit_ready,
    count(*) filter (
      where trigger_row.tgname in (
        'family_bookings_no_delete',
        'family_booking_members_no_delete',
        'family_shared_room_groups_no_delete'
      )
    ) = 3 as no_delete_ready
  from pg_trigger trigger_row
  where trigger_row.tgrelid in (
      to_regclass('public.family_bookings'),
      to_regclass('public.family_booking_members'),
      to_regclass('public.family_shared_room_groups')
    )
    and not trigger_row.tgisinternal
), root_contract as (
  select
    exists (
      select 1
      from pg_index index_row
      where index_row.indrelid = to_regclass('public.family_bookings')
        and index_row.indisunique
        and pg_get_indexdef(index_row.indexrelid) ilike '%(request_id)%'
    ) as request_id_unique_ready,
    exists (
      select 1
      from pg_constraint constraint_row
      where constraint_row.conrelid = to_regclass('public.family_bookings')
        and constraint_row.contype = 'c'
        and pg_get_constraintdef(constraint_row.oid, true)
          ilike '%canonical_payload_hash%'
    ) as payload_hash_constraint_ready,
    coalesce(audit_proc.prosrc ilike '%tg_table_name = ''family_bookings''%'
      and audit_proc.prosrc ilike '%new.status = ''pending''%'
      and audit_proc.prosrc ilike '%parsed_request_id := request_value::uuid%'
      and coordinator_proc.prosrc ilike '%root_audit_count <> 1%'
    , false) as root_audit_exactly_one_contract_ready,
    coalesce(coordinator_proc.prosrc ilike
      '%existing_booking.canonical_payload_hash <> payload_hash_value%'
      and coordinator_proc.prosrc ilike
        '%existing_booking.canonical_payload <> canonical_payload_value%'
      and coordinator_proc.prosrc ilike
        '%return public.family_booking_json(existing_booking.id)%'
    , false) as replay_contract_ready,
    coalesce(internal_key_proc.prosrc ilike '%p_family_request_id::text%'
      and internal_key_proc.prosrc ilike '%p_dog_id::text%'
      and internal_key_proc.prosrc ilike '%p_service_type%'
      and internal_key_proc.prosrc ilike '%p_stable_member_key%'
      and internal_key_proc.prosrc ilike '%p_operation_kind%'
    , false) as stable_member_key_contract_ready
  from (select 1) seed
  left join pg_proc audit_proc on audit_proc.oid =
      to_regprocedure('public.record_family_booking_audit_event()')
  left join pg_proc coordinator_proc on coordinator_proc.oid = to_regprocedure(
      'public.create_family_booking(uuid,text,boolean,jsonb,uuid)'
    )
  left join pg_proc internal_key_proc on internal_key_proc.oid = to_regprocedure(
      'public.family_booking_internal_request_id(uuid,uuid,text,text,text)'
    )
), shared_room_contract as (
  select
    exists (
      select 1 from pg_constraint constraint_row
      where constraint_row.conrelid =
          to_regclass('public.family_shared_room_groups')
        and constraint_row.contype = 'c'
        and pg_get_constraintdef(constraint_row.oid, true)
          ilike '%requested_capacity >= 2%'
    ) as group_size_ready,
    coalesce(validator_proc.prosrc ilike '%room_type.code <> ''DELUXE''%'
      and validator_proc.prosrc ilike '%Shared Room Group에는 Hotel Member%'
      and validator_proc.prosrc ilike '%period_count <> 1%'
    , false) as deluxe_period_validator_ready
  from (select 1) seed
  left join pg_proc validator_proc on validator_proc.oid =
    to_regprocedure('public.assert_family_booking_payload(jsonb)')
), adapter_result_contract as (
  select
    coalesce(hotel_adapter.prosrc ilike '%''dogId'', p_dog_id%'
      and hotel_adapter.prosrc ilike '%''customerId'', p_customer_id%'
      and hotel_adapter.prosrc ilike '%''serviceType'', ''hotel''%'
      and hotel_adapter.prosrc ilike '%matching_event_count <> 2%'
    , false) as hotel_ready,
    coalesce(training_adapter.prosrc ilike '%unit.code = ''training''%'
      and training_adapter.prosrc ilike '%''dogId'', p_dog_id%'
      and training_adapter.prosrc ilike '%''customerId'', p_customer_id%'
      and training_adapter.prosrc ilike '%''serviceType'', ''training''%'
    , false) as training_ready,
    coalesce(daycare_adapter.prosrc ilike '%unit.code = ''daycare''%'
      and daycare_adapter.prosrc ilike '%''dogId'', p_dog_id%'
      and daycare_adapter.prosrc ilike '%''customerId'', p_customer_id%'
      and daycare_adapter.prosrc ilike '%''serviceType'', ''daycare''%'
    , false) as daycare_ready,
    coalesce(coordinator.prosrc ilike
      '%서비스 Adapter 반환 ID·고객·반려견·서비스 계약이 일치하지 않습니다.%'
      and coordinator.prosrc ilike
        '%service_result ->> ''serviceType''%'
    , false) as coordinator_ready
  from (select 1) seed
  left join pg_proc hotel_adapter on hotel_adapter.oid = to_regprocedure(
    'public.create_family_hotel_member(uuid,uuid,uuid,date,time without time zone,boolean,date,time without time zone,boolean,uuid,uuid,uuid,uuid[],text)'
  )
  left join pg_proc training_adapter on training_adapter.oid = to_regprocedure(
    'public.create_family_training_member(uuid,uuid,uuid,text,timestamp with time zone,timestamp with time zone,boolean,boolean,uuid,uuid,uuid[],text)'
  )
  left join pg_proc daycare_adapter on daycare_adapter.oid = to_regprocedure(
    'public.create_family_daycare_member(uuid,uuid,uuid,text,timestamp with time zone,timestamp with time zone,boolean,boolean,uuid,uuid,uuid[],text)'
  )
  left join pg_proc coordinator on coordinator.oid = to_regprocedure(
    'public.create_family_booking(uuid,text,boolean,jsonb,uuid)'
  )
), existing_functions(
  function_identity,
  expected_normalized_fingerprint
) as (
  values
    ('public.is_active_operation_member()',
      '28bebce9a045d5c583ff1dab9b0a73ee'),
    ('public.assert_operation_schedule_input(uuid,uuid,text,timestamp with time zone,timestamp with time zone,uuid[],uuid[],uuid[])',
      '5c188581f9de3c5c8dac8abc41a736f4'),
    ('public.create_operation_schedule(uuid,uuid,text,timestamp with time zone,timestamp with time zone,boolean,boolean,text,uuid[],uuid[],uuid[],uuid)',
      'e8cb3acc5a02700a03ae08c859f671dc'),
    ('public.create_flexible_hotel_reservation(uuid,uuid,date,time without time zone,boolean,date,time without time zone,boolean,uuid,uuid,uuid,uuid[],text,uuid)',
      'e9d0db772303dbbf76ac3d905f161d68')
), existing_function_contract as (
  select
    coalesce(bool_and(
      md5(regexp_replace(lower(procedure_row.prosrc), '\s+', '', 'g'))
        = expected.expected_normalized_fingerprint
    ), false) as unchanged,
    jsonb_agg(jsonb_build_object(
      'function', expected.function_identity,
      'normalizedFingerprint', md5(regexp_replace(
        lower(procedure_row.prosrc), '\s+', '', 'g'
      )),
      'unchanged', md5(regexp_replace(
        lower(procedure_row.prosrc), '\s+', '', 'g'
      )) = expected.expected_normalized_fingerprint
    ) order by expected.function_identity) as diagnostics
  from existing_functions expected
  left join pg_proc procedure_row
    on procedure_row.oid = to_regprocedure(expected.function_identity)
)
select
  case
    when not table_contract.tables_ready then 'FAILED_FAMILY_BOOKING_TABLES'
    when not table_contract.rls_ready then 'FAILED_FAMILY_BOOKING_RLS'
    when not function_summary.ready then 'FAILED_FAMILY_BOOKING_FUNCTIONS'
    when not policy_contract.ready then 'FAILED_FAMILY_BOOKING_POLICIES'
    when not trigger_contract.metadata_ready
      or not trigger_contract.audit_ready
      or not trigger_contract.no_delete_ready
      then 'FAILED_FAMILY_BOOKING_TRIGGERS'
    when not root_contract.request_id_unique_ready
      or not root_contract.payload_hash_constraint_ready
      or not root_contract.root_audit_exactly_one_contract_ready
      or not root_contract.replay_contract_ready
      or not root_contract.stable_member_key_contract_ready
      then 'FAILED_FAMILY_BOOKING_ROOT_CONTRACT'
    when not shared_room_contract.group_size_ready
      or not shared_room_contract.deluxe_period_validator_ready
      then 'FAILED_FAMILY_BOOKING_SHARED_ROOM_CONTRACT'
    when not adapter_result_contract.hotel_ready
      or not adapter_result_contract.training_ready
      or not adapter_result_contract.daycare_ready
      or not adapter_result_contract.coordinator_ready
      then 'FAILED_FAMILY_BOOKING_ADAPTER_RESULT_CONTRACT'
    when not existing_function_contract.unchanged
      then 'FAILED_EXISTING_RPC_FUNCTION_DIFF'
    else 'FAMILY_BOOKING_PLATFORM_READY'
  end as postflight_status,
  table_contract.diagnostics as tables,
  function_summary.diagnostics as functions,
  policy_contract.diagnostics as policies,
  to_jsonb(trigger_contract) as triggers,
  to_jsonb(root_contract) as root_contract,
  to_jsonb(shared_room_contract) as shared_room_contract,
  to_jsonb(adapter_result_contract) as adapter_result_contract,
  existing_function_contract.unchanged as existing_function_diff_zero,
  existing_function_contract.diagnostics as existing_rpc_fingerprints
from table_contract
cross join function_summary
cross join policy_contract
cross join trigger_contract
cross join root_contract
cross join shared_room_contract
cross join adapter_result_contract
cross join existing_function_contract;

rollback;
