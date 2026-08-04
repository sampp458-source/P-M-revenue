-- Read-only preflight for the Hotel update lock-order repair.

begin read only;

select
  procedure_row.oid::regprocedure::text as function_identity,
  md5(pg_get_functiondef(procedure_row.oid)) as function_fingerprint,
  md5(procedure_row.prosrc) as function_body_fingerprint,
  procedure_row.prosecdef as security_definer,
  procedure_row.proconfig,
  has_function_privilege(
    'authenticated', procedure_row.oid, 'EXECUTE'
  ) as authenticated_execute
from pg_proc procedure_row
where procedure_row.oid = to_regprocedure(
  'public.update_hotel_reservation(uuid,integer,uuid,uuid,text,timestamp with time zone,timestamp with time zone,uuid,uuid,uuid,uuid[],text,uuid)'
);

with target as (
  select
    procedure_row.oid,
    procedure_row.oid::regprocedure::text as function_identity,
    md5(pg_get_functiondef(procedure_row.oid)) as function_fingerprint,
    md5(procedure_row.prosrc) as function_body_fingerprint,
    procedure_row.prosecdef as security_definer,
    procedure_row.proconfig,
    has_function_privilege(
      'authenticated', procedure_row.oid, 'EXECUTE'
    ) as authenticated_execute,
    lower(regexp_replace(
      pg_get_functiondef(procedure_row.oid), '\s+', ' ', 'g'
    )) as normalized_definition
  from pg_proc procedure_row
  where procedure_row.oid = to_regprocedure(
    'public.update_hotel_reservation(uuid,integer,uuid,uuid,text,timestamp with time zone,timestamp with time zone,uuid,uuid,uuid,uuid[],text,uuid)'
  )
), checks as (
  select
    exists (select 1 from target) as target_function_exists,
    coalesce((
      select function_body_fingerprint =
        '11bfba2f2cf38dc814908bff25e38f8f'
      from target
    ), false) as expected_function_version_ready,
    coalesce((select security_definer from target), false)
      as security_definer_ready,
    coalesce((
      select 'search_path=public, pg_temp' = any(proconfig)
      from target
    ), false) as fixed_search_path_ready,
    coalesce((select authenticated_execute from target), false)
      as authenticated_execute_ready,
    coalesce((
      select
        strpos(normalized_definition, 'hotel-room:') > 0
        and strpos(normalized_definition, 'assert_hotel_capacity_available') > 0
        and strpos(normalized_definition, 'hotel-room:')
          < strpos(normalized_definition, 'assert_hotel_capacity_available')
      from target
    ), false) as current_room_before_type_detected,
    to_regprocedure(
      'public.create_flexible_hotel_reservation(uuid,uuid,date,time without time zone,boolean,date,time without time zone,boolean,uuid,uuid,uuid,uuid[],text,uuid)'
    ) is null
      and to_regprocedure(
        'public.get_hotel_operations_snapshot_v2(date)'
      ) is null
      and to_regprocedure(
        'public.assert_hotel_total_capacity_available(timestamp with time zone,timestamp with time zone,integer,uuid)'
      ) is null
      and not exists (
        select 1 from pg_trigger trigger_row
        where trigger_row.tgname in (
          'hotel_capacity_reservations_total_capacity_guard',
          'hotel_room_allocations_room_type_guard'
        )
          and not trigger_row.tgisinternal
      )
      and not exists (
        select 1
        from pg_constraint constraint_row
        where constraint_row.conrelid =
            'public.hotel_capacity_reservations'::regclass
          and constraint_row.conname =
            'hotel_capacity_reservations_room_type_state_check'
      ) as flexible_migration_not_applied
)
select
  case
    when not target_function_exists
      then 'STOP_UPDATE_HOTEL_RESERVATION_MISSING'
    when not expected_function_version_ready
      then 'STOP_UPDATE_HOTEL_RESERVATION_UNEXPECTED_VERSION'
    when not security_definer_ready
      or not fixed_search_path_ready
      or not authenticated_execute_ready
      then 'STOP_UPDATE_HOTEL_RESERVATION_SECURITY_CONTRACT_MISMATCH'
    when not current_room_before_type_detected
      then 'STOP_EXPECTED_ROOM_BEFORE_TYPE_ORDER_NOT_FOUND'
    when not flexible_migration_not_applied
      then 'STOP_FLEXIBLE_MIGRATION_ALREADY_APPLIED'
    else 'READY_TO_APPLY_HOTEL_UPDATE_LOCK_ORDER_REPAIR'
  end as preflight_status,
  checks.*
from checks;


rollback;
