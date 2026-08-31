-- Production Dashboard read-only catalog/postflight for the already-applied
-- Family Booking / Shared Room / Physical Occupancy contract.
-- Manual target confirmation: zorvcuskzemehblqdbfj

begin transaction read only;

with
required_relations(relation_name) as (
  values
    ('family_bookings'),
    ('family_booking_members'),
    ('family_shared_room_groups'),
    ('hotel_physical_occupancies'),
    ('hotel_physical_occupancy_members'),
    ('hotel_physical_occupancy_requests'),
    ('hotel_capacity_reservations'),
    ('hotel_room_allocations')
),
relation_catalog as (
  select
    required.relation_name,
    relation.oid,
    relation.relkind,
    relation.relrowsecurity,
    relation.relforcerowsecurity,
    relation.relowner,
    relation.relacl
  from required_relations required
  left join pg_namespace namespace
    on namespace.nspname = 'public'
  left join pg_class relation
    on relation.relnamespace = namespace.oid
   and relation.relname = required.relation_name
),
relation_columns as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'relation', column_row.table_name,
    'column', column_row.column_name,
    'type', column_row.data_type,
    'udt', column_row.udt_name,
    'nullable', column_row.is_nullable,
    'default', column_row.column_default
  ) order by column_row.table_name, column_row.ordinal_position), '[]'::jsonb) catalog
  from information_schema.columns column_row
  where column_row.table_schema = 'public'
    and column_row.table_name in (select relation_name from required_relations)
),
relation_constraints as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'relation', relation.relname,
    'name', constraint_row.conname,
    'type', constraint_row.contype,
    'definition', pg_get_constraintdef(constraint_row.oid, true)
  ) order by relation.relname, constraint_row.conname), '[]'::jsonb) catalog
  from pg_constraint constraint_row
  join pg_class relation on relation.oid = constraint_row.conrelid
  join pg_namespace namespace on namespace.oid = relation.relnamespace
  where namespace.nspname = 'public'
    and relation.relname in (select relation_name from required_relations)
),
relation_indexes as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'relation', index_row.tablename,
    'name', index_row.indexname,
    'definition', index_row.indexdef
  ) order by index_row.tablename, index_row.indexname), '[]'::jsonb) catalog
  from pg_indexes index_row
  where index_row.schemaname = 'public'
    and index_row.tablename in (select relation_name from required_relations)
),
relation_triggers as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'relation', relation.relname,
    'name', trigger_row.tgname,
    'definition', pg_get_triggerdef(trigger_row.oid, true)
  ) order by relation.relname, trigger_row.tgname), '[]'::jsonb) catalog
  from pg_trigger trigger_row
  join pg_class relation on relation.oid = trigger_row.tgrelid
  join pg_namespace namespace on namespace.oid = relation.relnamespace
  where namespace.nspname = 'public'
    and relation.relname in (select relation_name from required_relations)
    and not trigger_row.tgisinternal
),
relation_acl as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'relation', relation_row.relation_name,
    'grantee', case when acl.grantee = 0 then 'PUBLIC' else grantee.rolname end,
    'privilege', acl.privilege_type,
    'grantable', acl.is_grantable
  ) order by relation_row.relation_name,
      case when acl.grantee = 0 then 'PUBLIC' else grantee.rolname end,
      acl.privilege_type), '[]'::jsonb) catalog
  from relation_catalog relation_row
  cross join lateral aclexplode(
    coalesce(relation_row.relacl, acldefault('r', relation_row.relowner))
  ) acl
  left join pg_roles grantee on grantee.oid = acl.grantee
),
expected_functions(signature) as (
  values
    ('public.create_family_booking(uuid,text,boolean,jsonb,uuid)'),
    ('public.create_shared_hotel_room_occupancy(uuid,uuid,uuid)'),
    ('public.merge_existing_hotel_stays_into_shared_room(uuid[],integer[],boolean,uuid)'),
    ('public.get_hotel_shared_room_occupancies(date)'),
    ('public.get_shared_hotel_room_occupancy(uuid)'),
    ('public.join_shared_hotel_room_occupancy(uuid,uuid,integer,uuid)'),
    ('public.complete_shared_hotel_check_in(uuid,uuid,integer,integer,timestamp with time zone,uuid)'),
    ('public.complete_shared_hotel_member_check_out(uuid,uuid,integer,integer,timestamp with time zone,uuid)'),
    ('public.reverse_shared_hotel_member_completion(uuid,uuid,integer,integer,text,uuid)'),
    ('public.move_shared_hotel_room_occupancy(uuid,uuid,integer,text,uuid)')
),
function_catalog as (
  select
    expected.signature,
    procedure_row.oid,
    procedure_row.proowner,
    procedure_row.proacl,
    procedure_row.provolatile,
    procedure_row.prosecdef,
    pg_get_function_result(procedure_row.oid) return_type,
    pg_get_functiondef(procedure_row.oid) definition,
    lower(regexp_replace(
      coalesce(pg_get_functiondef(procedure_row.oid), ''),
      '[[:space:]]+', '', 'g'
    )) normalized_definition
  from expected_functions expected
  left join pg_proc procedure_row
    on procedure_row.oid = to_regprocedure(expected.signature)
),
function_acl_rows as (
  select
    function_row.signature,
    case when acl.grantee = 0 then 'PUBLIC' else grantee.rolname end grantee,
    acl.privilege_type,
    acl.is_grantable
  from function_catalog function_row
  cross join lateral aclexplode(
    coalesce(function_row.proacl, acldefault('f', function_row.proowner))
  ) acl
  left join pg_roles grantee on grantee.oid = acl.grantee
),
function_acl as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'signature', acl_row.signature,
    'grantee', acl_row.grantee,
    'privilege', acl_row.privilege_type,
    'grantable', acl_row.is_grantable
  ) order by acl_row.signature, acl_row.grantee, acl_row.privilege_type), '[]'::jsonb) catalog
  from function_acl_rows acl_row
),
function_summary as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'signature', function_row.signature,
    'exists', function_row.oid is not null,
    'returnType', function_row.return_type,
    'securityDefiner', function_row.prosecdef,
    'volatility', function_row.provolatile,
    'sourceMd5', case when function_row.oid is null then null
      else md5(function_row.definition) end
  ) order by function_row.signature), '[]'::jsonb) catalog
  from function_catalog function_row
),
semantic_sources as (
  select
    max(normalized_definition) filter (
      where signature = 'public.create_family_booking(uuid,text,boolean,jsonb,uuid)'
    ) family_create,
    max(normalized_definition) filter (
      where signature = 'public.create_shared_hotel_room_occupancy(uuid,uuid,uuid)'
    ) shared_create,
    max(normalized_definition) filter (
      where signature = 'public.merge_existing_hotel_stays_into_shared_room(uuid[],integer[],boolean,uuid)'
    ) existing_merge,
    max(normalized_definition) filter (
      where signature = 'public.join_shared_hotel_room_occupancy(uuid,uuid,integer,uuid)'
    ) member_join,
    max(normalized_definition) filter (
      where signature = 'public.complete_shared_hotel_check_in(uuid,uuid,integer,integer,timestamp with time zone,uuid)'
    ) member_check_in,
    max(normalized_definition) filter (
      where signature = 'public.complete_shared_hotel_member_check_out(uuid,uuid,integer,integer,timestamp with time zone,uuid)'
    ) member_check_out,
    max(normalized_definition) filter (
      where signature = 'public.reverse_shared_hotel_member_completion(uuid,uuid,integer,integer,text,uuid)'
    ) member_reverse,
    max(normalized_definition) filter (
      where signature = 'public.move_shared_hotel_room_occupancy(uuid,uuid,integer,text,uuid)'
    ) room_move
  from function_catalog
),
business_aggregate as (
  select
    (select count(*) from public.hotel_physical_occupancies) physical_occupancy_count,
    (select count(*) from public.hotel_physical_occupancy_members) physical_member_count,
    (select count(*) from public.hotel_physical_occupancy_requests) request_count,
    (select count(*)
       from public.hotel_physical_occupancies occupancy
       join public.hotel_room_types room_type on room_type.id = occupancy.room_type_id
      where occupancy.archived_at is null
        and (upper(btrim(room_type.code)) <> 'DELUXE'
          or upper(btrim(room_type.name)) <> 'DELUXE')) non_deluxe_occupancy_count,
    (select count(*)
       from public.hotel_physical_occupancy_members member
       join public.hotel_physical_occupancies occupancy on occupancy.id = member.occupancy_id
       join public.dogs dog on dog.id = member.dog_id
      where member.archived_at is null
        and occupancy.archived_at is null
        and dog.customer_id is distinct from occupancy.customer_id) cross_customer_member_count,
    (select count(*)
       from public.hotel_physical_occupancies occupancy
       left join public.hotel_capacity_reservations capacity
         on capacity.id = occupancy.capacity_reservation_id
        and capacity.archived_at is null
      where occupancy.archived_at is null
        and occupancy.status = 'active'
        and (capacity.id is null
          or capacity.source_kind <> 'shared_occupancy'
          or capacity.physical_occupancy_id is distinct from occupancy.id
          or capacity.quantity <> 1)) invalid_capacity_count,
    (select count(*)
       from public.hotel_physical_occupancies occupancy
       left join public.hotel_room_allocations allocation
         on allocation.id = occupancy.room_allocation_id
        and allocation.archived_at is null
      where occupancy.archived_at is null
        and occupancy.status = 'active'
        and (allocation.id is null
          or allocation.capacity_reservation_id is distinct from occupancy.capacity_reservation_id
          or allocation.room_id is distinct from occupancy.room_id)) invalid_allocation_count
),
contract as (
  select
    (select count(*) = count(oid) from relation_catalog) tables_ok,
    (select bool_and(relrowsecurity) from relation_catalog where oid is not null) rls_enabled,
    not exists (
      select 1 from relation_acl, jsonb_array_elements(catalog) item
      where item ->> 'grantee' in ('PUBLIC', 'anon')
        and item ->> 'privilege' in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')
    ) direct_public_mutation_revoked,
    (select count(*) = count(oid) from function_catalog) rpc_signatures_ok,
    not exists (
      select 1 from function_acl_rows
      where grantee in ('PUBLIC', 'anon') and privilege_type = 'EXECUTE'
    ) public_rpc_execute_revoked,
    not exists (
      select 1 from function_catalog function_row
      where function_row.oid is not null
        and not exists (
          select 1 from function_acl_rows acl_row
          where acl_row.signature = function_row.signature
            and acl_row.grantee = 'authenticated'
            and acl_row.privilege_type = 'EXECUTE'
        )
    ) authenticated_rpc_execute_granted,
    not exists (
      select 1 from function_catalog function_row
      where function_row.oid is not null
        and function_row.signature <> 'public.create_family_booking(uuid,text,boolean,jsonb,uuid)'
        and not exists (
          select 1 from function_acl_rows acl_row
          where acl_row.signature = function_row.signature
            and acl_row.grantee = 'service_role'
            and acl_row.privilege_type = 'EXECUTE'
        )
    ) shared_service_role_execute_granted,
    position('sharedroomgroupkey' in sources.family_create) > 0
      and position('family_shared_room_groups' in sources.family_create) > 0 family_group_contract,
    position('deluxe' in sources.shared_create) > 0
      and position('deluxe' in sources.existing_merge) > 0 deluxe_only_contract,
    position('customer_id' in sources.shared_create) > 0
      and position('customer_id' in sources.existing_merge) > 0
      and position('dogs' in sources.existing_merge) > 0 same_customer_contract,
    position('hotel_capacity_reservations' in sources.shared_create) > 0
      and position('''shared_occupancy''' in sources.shared_create) > 0
      and position('quantity' in sources.shared_create) > 0
      and position(',1,' in sources.shared_create) > 0 capacity_contract,
    position('assert_hotel_room_allocation_available' in sources.shared_create) > 0
      and position('hotel_room_allocations' in sources.shared_create) > 0 allocation_contract,
    position('claim_shared_hotel_request_internal' in sources.shared_create) > 0
      and position('claim_shared_hotel_request_internal' in sources.existing_merge) > 0
      and position('family-booking-request:' in sources.family_create) > 0 idempotency_contract,
    position('entity_audit_events' in sources.shared_create) > 0
      and position('entity_audit_events' in sources.existing_merge) > 0 audit_contract,
    position('p_shared_room_intent' in sources.existing_merge) > 0 explicit_intent_contract,
    position('p_expected_occupancy_version' in sources.member_check_in) > 0
      and position('p_expected_stay_version' in sources.member_check_in) > 0
      and position('pt409' in sources.member_check_in) > 0
      and position('p_expected_occupancy_version' in sources.member_check_out) > 0
      and position('p_expected_stay_version' in sources.member_check_out) > 0
      and position('pt409' in sources.member_check_out) > 0 lifecycle_version_contract,
    position('hotel_capacity_reservations' in sources.member_check_out) > 0
      and position('hotel_room_allocations' in sources.member_check_out) > 0 lifecycle_release_contract,
    position('assert_hotel_room_allocation_available' in sources.member_reverse) > 0
      and position('assert_hotel_room_allocation_available' in sources.room_move) > 0 lifecycle_recovery_contract
  from semantic_sources sources
),
verdict as (
  select contract.*,
    aggregate.physical_occupancy_count,
    aggregate.physical_member_count,
    aggregate.request_count,
    aggregate.non_deluxe_occupancy_count,
    aggregate.cross_customer_member_count,
    aggregate.invalid_capacity_count,
    aggregate.invalid_allocation_count,
    contract.tables_ok
      and contract.rls_enabled
      and contract.direct_public_mutation_revoked
      and contract.rpc_signatures_ok
      and contract.public_rpc_execute_revoked
      and contract.authenticated_rpc_execute_granted
      and contract.shared_service_role_execute_granted
      and contract.family_group_contract
      and contract.deluxe_only_contract
      and contract.same_customer_contract
      and contract.capacity_contract
      and contract.allocation_contract
      and contract.idempotency_contract
      and contract.audit_contract
      and contract.explicit_intent_contract
      and contract.lifecycle_version_contract
      and contract.lifecycle_release_contract
      and contract.lifecycle_recovery_contract
      and aggregate.non_deluxe_occupancy_count = 0
      and aggregate.cross_customer_member_count = 0
      and aggregate.invalid_capacity_count = 0
      and aggregate.invalid_allocation_count = 0 all_ok
  from contract
  cross join business_aggregate aggregate
)
select
  case when verdict.all_ok
    then 'HOTEL_SHARED_ROOM_CONTRACT_HISTORY_RECOVERY_POSTFLIGHT_PASS'
    else 'HOTEL_SHARED_ROOM_CONTRACT_HISTORY_RECOVERY_POSTFLIGHT_FAIL'
  end verdict,
  'MANUAL_TARGET_CONFIRMATION: zorvcuskzemehblqdbfj' target_confirmation,
  case when verdict.tables_ok then 'PASS' else 'FAIL' end shared_room_tables,
  case when verdict.family_group_contract then 'PASS' else 'FAIL' end member_relations,
  case when verdict.deluxe_only_contract and verdict.non_deluxe_occupancy_count = 0
    then 'PASS' else 'FAIL' end deluxe_only_contract,
  case when verdict.same_customer_contract and verdict.cross_customer_member_count = 0
    then 'PASS' else 'FAIL' end same_customer_contract,
  case when verdict.capacity_contract and verdict.invalid_capacity_count = 0
    then 'PASS' else 'FAIL' end capacity_single_occupancy,
  case when verdict.allocation_contract and verdict.invalid_allocation_count = 0
    then 'PASS' else 'FAIL' end room_allocation_contract,
  case when verdict.idempotency_contract then 'PASS' else 'FAIL' end idempotency,
  case when verdict.audit_contract then 'PASS' else 'FAIL' end audit,
  case when verdict.rls_enabled and verdict.direct_public_mutation_revoked
    then 'PASS' else 'FAIL' end rls,
  case when verdict.rpc_signatures_ok
      and verdict.public_rpc_execute_revoked
      and verdict.authenticated_rpc_execute_granted
      and verdict.shared_service_role_execute_granted
    then 'PASS' else 'FAIL' end rpc_signatures,
  case when verdict.explicit_intent_contract then 'PASS' else 'FAIL' end explicit_intent,
  case when verdict.lifecycle_version_contract
      and verdict.lifecycle_release_contract
      and verdict.lifecycle_recovery_contract
    then 'PASS' else 'FAIL' end member_lifecycle,
  verdict.physical_occupancy_count,
  verdict.physical_member_count,
  verdict.request_count,
  verdict.non_deluxe_occupancy_count,
  verdict.cross_customer_member_count,
  verdict.invalid_capacity_count,
  verdict.invalid_allocation_count,
  function_summary.catalog rpc_catalog,
  function_acl.catalog rpc_acl_catalog,
  relation_columns.catalog column_catalog,
  relation_constraints.catalog constraint_catalog,
  relation_indexes.catalog index_catalog,
  relation_triggers.catalog trigger_catalog,
  relation_acl.catalog relation_acl_catalog
from verdict
cross join function_summary
cross join function_acl
cross join relation_columns
cross join relation_constraints
cross join relation_indexes
cross join relation_triggers
cross join relation_acl;

rollback;
