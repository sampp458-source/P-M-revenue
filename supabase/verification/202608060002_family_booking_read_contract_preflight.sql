begin read only;

with required_objects as (
  select
    to_regclass('public.family_bookings') is not null as family_bookings_ready,
    to_regclass('public.family_booking_members') is not null as members_ready,
    to_regclass('public.family_shared_room_groups') is not null as groups_ready,
    to_regprocedure('public.family_booking_json(uuid)') is not null as aggregate_json_ready,
    to_regprocedure('public.is_active_operation_member()') is not null as membership_guard_ready,
    to_regprocedure('public.get_family_booking(uuid)') is null as detail_rpc_absent,
    to_regprocedure('public.get_customer_family_bookings(uuid)') is null as list_rpc_absent
), required_columns as (
  select count(*) = 13 as ready
  from information_schema.columns
  where table_schema = 'public'
    and (
      (table_name = 'family_bookings' and column_name in (
        'id', 'customer_id', 'status', 'request_id', 'version',
        'created_at', 'updated_at', 'archived_at'
      ))
      or (table_name = 'family_booking_members' and column_name in (
        'family_booking_id', 'dog_id', 'service_type',
        'hotel_stay_id', 'operation_schedule_id'
      ))
    )
), function_contract as (
  select
    count(*) = 1
      and bool_and(proc.prosecdef)
      and bool_and(proc.provolatile = 's')
      and bool_and(coalesce(array_to_string(proc.proconfig, ','), '') like '%search_path=public, pg_temp%')
      and bool_and(has_function_privilege('authenticated', proc.oid, 'execute'))
      as ready,
    jsonb_agg(jsonb_build_object(
      'identity', proc.oid::regprocedure::text,
      'securityDefiner', proc.prosecdef,
      'volatility', proc.provolatile,
      'config', proc.proconfig,
      'authenticatedExecute', has_function_privilege('authenticated', proc.oid, 'execute'),
      'fingerprint', md5(proc.prosrc)
    )) as details
  from pg_proc proc
  join pg_namespace namespace on namespace.oid = proc.pronamespace
  where namespace.nspname = 'public'
    and proc.oid = to_regprocedure('public.family_booking_json(uuid)')
), summary as (
  select
    objects.*,
    columns.ready as required_columns_ready,
    functions.ready as existing_function_contract_ready,
    functions.details as existing_function_contract
  from required_objects objects
  cross join required_columns columns
  cross join function_contract functions
)
select
  case when
    family_bookings_ready
    and members_ready
    and groups_ready
    and aggregate_json_ready
    and membership_guard_ready
    and detail_rpc_absent
    and list_rpc_absent
    and required_columns_ready
    and existing_function_contract_ready
  then 'READY_TO_APPLY_FAMILY_BOOKING_READ_CONTRACT'
  else 'STOP_FAMILY_BOOKING_READ_CONTRACT_PREFLIGHT'
  end as preflight_status,
  to_jsonb(summary.*) - 'existing_function_contract' as checks,
  existing_function_contract
from summary;

rollback;
