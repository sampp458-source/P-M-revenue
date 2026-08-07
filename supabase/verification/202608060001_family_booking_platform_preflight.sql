-- Family Booking Platform read-only preflight.
-- This script never mutates the database.

begin read only;

with required_objects(object_name, object_ready) as (
  values
    ('public.profiles', to_regclass('public.profiles') is not null),
    ('public.customers', to_regclass('public.customers') is not null),
    ('public.dogs', to_regclass('public.dogs') is not null),
    ('public.business_units', to_regclass('public.business_units') is not null),
    ('public.operation_memberships',
      to_regclass('public.operation_memberships') is not null),
    ('public.operation_calendars',
      to_regclass('public.operation_calendars') is not null),
    ('public.operation_schedule_types',
      to_regclass('public.operation_schedule_types') is not null),
    ('public.operation_calendar_schedule_types',
      to_regclass('public.operation_calendar_schedule_types') is not null),
    ('public.operation_schedules',
      to_regclass('public.operation_schedules') is not null),
    ('public.entity_audit_events',
      to_regclass('public.entity_audit_events') is not null),
    ('public.hotel_room_types',
      to_regclass('public.hotel_room_types') is not null),
    ('public.hotel_stays', to_regclass('public.hotel_stays') is not null),
    ('public.hotel_capacity_reservations',
      to_regclass('public.hotel_capacity_reservations') is not null),
    ('extensions.digest(text,text)',
      to_regprocedure('extensions.digest(text,text)') is not null)
), required_columns(table_name, column_name) as (
  values
    ('customers', 'id'), ('customers', 'is_active'),
    ('dogs', 'id'), ('dogs', 'customer_id'), ('dogs', 'is_active'),
    ('profiles', 'id'), ('profiles', 'is_active'),
    ('profiles', 'account_status'),
    ('operation_memberships', 'profile_id'),
    ('operation_memberships', 'role'),
    ('operation_memberships', 'is_active'),
    ('entity_audit_events', 'module_code'),
    ('entity_audit_events', 'entity_type'),
    ('entity_audit_events', 'entity_id'),
    ('entity_audit_events', 'request_id')
), column_contract as (
  select
    bool_and(column_row.column_name is not null) as ready,
    coalesce(jsonb_agg(
      jsonb_build_object(
        'column', required.table_name || '.' || required.column_name,
        'exists', column_row.column_name is not null
      ) order by required.table_name, required.column_name
    ), '[]'::jsonb) as diagnostics
  from required_columns required
  left join information_schema.columns column_row
    on column_row.table_schema = 'public'
   and column_row.table_name = required.table_name
   and column_row.column_name = required.column_name
), expected_functions(
  function_identity,
  expected_normalized_fingerprint,
  expected_volatility,
  expected_authenticated_execute
) as (
  values
    (
      'public.is_active_operation_member()',
      '28bebce9a045d5c583ff1dab9b0a73ee', 's', true
    ),
    (
      'public.assert_operation_schedule_input(uuid,uuid,text,timestamp with time zone,timestamp with time zone,uuid[],uuid[],uuid[])',
      '5c188581f9de3c5c8dac8abc41a736f4', 'v', false
    ),
    (
      'public.create_operation_schedule(uuid,uuid,text,timestamp with time zone,timestamp with time zone,boolean,boolean,text,uuid[],uuid[],uuid[],uuid)',
      'e8cb3acc5a02700a03ae08c859f671dc', 'v', true
    ),
    (
      'public.create_flexible_hotel_reservation(uuid,uuid,date,time without time zone,boolean,date,time without time zone,boolean,uuid,uuid,uuid,uuid[],text,uuid)',
      'e9d0db772303dbbf76ac3d905f161d68', 'v', true
    )
), function_contract as (
  select
    expected.function_identity,
    procedure_row.oid is not null as identity_ready,
    coalesce(procedure_row.prosecdef, false) as security_definer_ready,
    coalesce(
      'search_path=public, pg_temp' = any(procedure_row.proconfig), false
    ) as search_path_ready,
    coalesce(
      procedure_row.provolatile = expected.expected_volatility, false
    ) as volatility_ready,
    coalesce(
      pg_get_userbyid(procedure_row.proowner) = 'postgres', false
    ) as owner_ready,
    coalesce(
      has_function_privilege('authenticated', procedure_row.oid, 'EXECUTE')
        = expected.expected_authenticated_execute,
      false
    ) as execute_ready,
    coalesce(
      md5(regexp_replace(lower(procedure_row.prosrc), '\s+', '', 'g'))
        = expected.expected_normalized_fingerprint,
      false
    ) as fingerprint_ready,
    md5(procedure_row.prosrc) as raw_fingerprint,
    md5(regexp_replace(lower(procedure_row.prosrc), '\s+', '', 'g'))
      as normalized_fingerprint
  from expected_functions expected
  left join pg_proc procedure_row
    on procedure_row.oid = to_regprocedure(expected.function_identity)
), function_summary as (
  select
    bool_and(
      identity_ready and security_definer_ready and search_path_ready
      and volatility_ready and owner_ready and execute_ready
      and fingerprint_ready
    ) as ready,
    jsonb_agg(to_jsonb(function_contract)
      order by function_identity) as diagnostics
  from function_contract
), replay_contract as (
  select
    coalesce(schedule_proc.prosrc ilike '%where schedule.request_id = p_request_id%'
      and schedule_proc.prosrc ilike '%return public.operation_schedule_json%'
      and schedule_proc.prosrc not ilike '%동일 request_id의 입력 계약%'
    , false) as schedule_request_id_only_ready,
    coalesce(hotel_proc.prosrc ilike '%동일 request_id의 입력 계약%'
      and hotel_proc.prosrc ilike '%existing_capacity.room_type_id%'
      and hotel_proc.prosrc ilike '%replay_check_in_schedule%'
      and hotel_proc.prosrc ilike '%p_assignee_ids%'
    , false) as flexible_full_payload_ready
  from (select 1) seed
  left join pg_proc schedule_proc
    on schedule_proc.oid = to_regprocedure(
      'public.create_operation_schedule(uuid,uuid,text,timestamp with time zone,timestamp with time zone,boolean,boolean,text,uuid[],uuid[],uuid[],uuid)'
    )
  left join pg_proc hotel_proc
    on hotel_proc.oid = to_regprocedure(
      'public.create_flexible_hotel_reservation(uuid,uuid,date,time without time zone,boolean,date,time without time zone,boolean,uuid,uuid,uuid,uuid[],text,uuid)'
    )
), lock_contract as (
  select
    coalesce(schedule_proc.prosrc ilike
      '%pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0))%',
      false
    ) as schedule_request_lock_ready,
    coalesce(hotel_proc.prosrc ilike '%hotel-request:%'
      and hotel_proc.prosrc ilike '%assert_hotel_capacity_available%'
    , false) as hotel_request_and_type_lock_ready,
    coalesce(total_proc.prosrc ilike '%hotel-capacity:all%'
      and trigger_row.oid is not null
    , false) as total_capacity_lock_ready
  from (select 1) seed
  left join pg_proc schedule_proc
    on schedule_proc.oid = to_regprocedure(
      'public.create_operation_schedule(uuid,uuid,text,timestamp with time zone,timestamp with time zone,boolean,boolean,text,uuid[],uuid[],uuid[],uuid)'
    )
  left join pg_proc hotel_proc
    on hotel_proc.oid = to_regprocedure(
      'public.create_flexible_hotel_reservation(uuid,uuid,date,time without time zone,boolean,date,time without time zone,boolean,uuid,uuid,uuid,uuid[],text,uuid)'
    )
  left join pg_proc total_proc
    on total_proc.oid = to_regprocedure(
      'public.assert_hotel_total_capacity_available(timestamp with time zone,timestamp with time zone,integer,uuid)'
    )
  left join pg_trigger trigger_row
    on trigger_row.tgrelid = to_regclass('public.hotel_capacity_reservations')
   and trigger_row.tgname = 'hotel_capacity_reservations_total_capacity_guard'
   and not trigger_row.tgisinternal
), audit_contract as (
  select
    to_regprocedure('public.record_operation_schedule_audit_event()')
      is not null as schedule_audit_function_ready,
    to_regprocedure('public.record_hotel_operation_audit_event()')
      is not null as hotel_audit_function_ready,
    exists (
      select 1 from pg_trigger trigger_row
      where trigger_row.tgrelid = to_regclass('public.operation_schedules')
        and trigger_row.tgname = 'operation_schedules_audit'
        and not trigger_row.tgisinternal
    ) as schedule_audit_trigger_ready,
    exists (
      select 1 from pg_trigger trigger_row
      where trigger_row.tgrelid = to_regclass('public.hotel_stays')
        and trigger_row.tgname = 'hotel_stays_audit'
        and not trigger_row.tgisinternal
    ) as hotel_audit_trigger_ready,
    exists (
      select 1 from information_schema.columns column_row
      where column_row.table_schema = 'public'
        and column_row.table_name = 'entity_audit_events'
        and column_row.column_name = 'request_id'
        and column_row.is_nullable = 'YES'
    ) as request_id_nullable_ready
), transaction_contract as (
  select coalesce(bool_and(
    procedure_row.prosrc !~* '(^|[^A-Za-z_])(commit|rollback)([^A-Za-z_]|$)'
  ), false) as no_internal_transaction_control
  from pg_proc procedure_row
  where procedure_row.oid in (
    to_regprocedure(
      'public.create_operation_schedule(uuid,uuid,text,timestamp with time zone,timestamp with time zone,boolean,boolean,text,uuid[],uuid[],uuid[],uuid)'
    ),
    to_regprocedure(
      'public.create_flexible_hotel_reservation(uuid,uuid,date,time without time zone,boolean,date,time without time zone,boolean,uuid,uuid,uuid,uuid[],text,uuid)'
    )
  )
), clean_contract as (
  select
    count(*) filter (where object_oid is not null) = 0 as ready,
    count(*) filter (where object_oid is not null)::integer
      as existing_target_count
  from (
    values
      (to_regclass('public.family_bookings')::oid),
      (to_regclass('public.family_booking_members')::oid),
      (to_regclass('public.family_shared_room_groups')::oid),
      (to_regprocedure(
        'public.create_family_booking(uuid,text,boolean,jsonb,uuid)'
      )::oid),
      (to_regprocedure(
        'public.create_family_hotel_member(uuid,uuid,uuid,date,time without time zone,boolean,date,time without time zone,boolean,uuid,uuid,uuid,uuid[],text)'
      )::oid),
      (to_regprocedure(
        'public.create_family_training_member(uuid,uuid,uuid,text,timestamp with time zone,timestamp with time zone,boolean,boolean,uuid,uuid,uuid[],text)'
      )::oid),
      (to_regprocedure(
        'public.create_family_daycare_member(uuid,uuid,uuid,text,timestamp with time zone,timestamp with time zone,boolean,boolean,uuid,uuid,uuid[],text)'
      )::oid)
  ) target(object_oid)
), object_summary as (
  select
    bool_and(object_ready) as ready,
    jsonb_agg(jsonb_build_object(
      'object', object_name, 'exists', object_ready
    ) order by object_name) as diagnostics
  from required_objects
)
select
  case
    when not object_summary.ready then 'STOP_MISSING_REQUIRED_OBJECTS'
    when not column_contract.ready then 'STOP_REQUIRED_COLUMNS_INVALID'
    when not function_summary.ready then 'STOP_EXISTING_RPC_CONTRACT_DRIFT'
    when not replay_contract.schedule_request_id_only_ready
      or not replay_contract.flexible_full_payload_ready
      then 'STOP_REPLAY_CONTRACT_DRIFT'
    when not lock_contract.schedule_request_lock_ready
      or not lock_contract.hotel_request_and_type_lock_ready
      or not lock_contract.total_capacity_lock_ready
      then 'STOP_LOCK_CONTRACT_DRIFT'
    when not audit_contract.schedule_audit_function_ready
      or not audit_contract.hotel_audit_function_ready
      or not audit_contract.schedule_audit_trigger_ready
      or not audit_contract.hotel_audit_trigger_ready
      or not audit_contract.request_id_nullable_ready
      then 'STOP_AUDIT_CONTRACT_DRIFT'
    when not transaction_contract.no_internal_transaction_control
      then 'STOP_CHILD_TRANSACTION_CONTROL_DETECTED'
    when not clean_contract.ready then 'STOP_FAMILY_BOOKING_NOT_CLEAN'
    else 'READY_TO_APPLY_FAMILY_BOOKING_PLATFORM'
  end as preflight_status,
  object_summary.ready as required_objects_ready,
  object_summary.diagnostics as required_objects,
  column_contract.ready as required_columns_ready,
  column_contract.diagnostics as required_columns,
  function_summary.ready as existing_rpc_contract_ready,
  function_summary.diagnostics as existing_rpc_fingerprints,
  to_jsonb(replay_contract) as replay_contract,
  to_jsonb(lock_contract) as lock_contract,
  to_jsonb(audit_contract) as audit_contract,
  transaction_contract.no_internal_transaction_control,
  clean_contract.ready as family_booking_clean,
  clean_contract.existing_target_count
from object_summary
cross join column_contract
cross join function_summary
cross join replay_contract
cross join lock_contract
cross join audit_contract
cross join transaction_contract
cross join clean_contract;

rollback;
