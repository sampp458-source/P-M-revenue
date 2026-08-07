begin read only;

with functions as (
  select
    proc.oid::regprocedure::text as identity,
    proc.prosecdef as security_definer,
    proc.provolatile = 's' as stable,
    coalesce(array_to_string(proc.proconfig, ','), '') like '%search_path=public, pg_temp%'
      as search_path_ready,
    has_function_privilege('authenticated', proc.oid, 'execute') as authenticated_execute,
    not has_function_privilege('anon', proc.oid, 'execute') as anon_blocked,
    md5(proc.prosrc) as fingerprint
  from pg_proc proc
  join pg_namespace namespace on namespace.oid = proc.pronamespace
  where namespace.nspname = 'public'
    and proc.oid in (
      to_regprocedure('public.get_family_booking(uuid)'),
      to_regprocedure('public.get_customer_family_bookings(uuid)')
    )
), function_summary as (
  select
    count(*) = 2
      and bool_and(security_definer)
      and bool_and(stable)
      and bool_and(search_path_ready)
      and bool_and(authenticated_execute)
      and bool_and(anon_blocked) as ready,
    jsonb_agg(to_jsonb(functions.*) order by identity) as details
  from functions
), table_contract as (
  select
    not has_table_privilege('authenticated', 'public.family_bookings', 'select')
      and not has_table_privilege('authenticated', 'public.family_booking_members', 'select')
      and not has_table_privilege('authenticated', 'public.family_shared_room_groups', 'select')
      and not has_table_privilege('authenticated', 'public.family_bookings', 'insert,update,delete')
      and not has_table_privilege('authenticated', 'public.family_booking_members', 'insert,update,delete')
      and not has_table_privilege('authenticated', 'public.family_shared_room_groups', 'insert,update,delete')
      as ready
), source_contract as (
  select
    position('is_active_operation_member()' in pg_get_functiondef(to_regprocedure('public.get_family_booking(uuid)'))) > 0
      and position('booking.archived_at is null' in pg_get_functiondef(to_regprocedure('public.get_family_booking(uuid)'))) > 0
      and position('member.archived_at is null' in pg_get_functiondef(to_regprocedure('public.get_family_booking(uuid)'))) > 0
      and position('is_active_operation_member()' in pg_get_functiondef(to_regprocedure('public.get_customer_family_bookings(uuid)'))) > 0
      and position('booking.archived_at is null' in pg_get_functiondef(to_regprocedure('public.get_customer_family_bookings(uuid)'))) > 0
      as ready
), existing_contract as (
  select count(*) = 1 as ready, md5(proc.prosrc) as family_booking_json_fingerprint
  from pg_proc proc
  where proc.oid = to_regprocedure('public.family_booking_json(uuid)')
  group by proc.prosrc
)
select
  case when function_summary.ready
    and table_contract.ready
    and source_contract.ready
    and existing_contract.ready
  then 'FAMILY_BOOKING_READ_CONTRACT_READY'
  else 'FAMILY_BOOKING_READ_CONTRACT_FAILED'
  end as postflight_status,
  function_summary.details as functions,
  table_contract.ready as direct_table_access_blocked,
  source_contract.ready as runtime_guard_contract_ready,
  existing_contract.family_booking_json_fingerprint
from function_summary
cross join table_contract
cross join source_contract
cross join existing_contract;

rollback;
