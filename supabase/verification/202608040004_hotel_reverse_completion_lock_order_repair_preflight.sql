-- Read-only preflight for reverse_hotel_completion() lock-order repair.

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
  'public.reverse_hotel_completion(uuid,integer,text,text,uuid)'
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
    'public.reverse_hotel_completion(uuid,integer,text,text,uuid)'
  )
), checks as (
  select
    exists (select 1 from target) as target_function_exists,
    coalesce((
      select function_body_fingerprint =
        'a694cfa7ab7ed47afdc2fcae44a2f87d'
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
        strpos(normalized_definition, 'assert_hotel_capacity_available') > 0
        and strpos(normalized_definition, 'update public.hotel_capacity_reservations') > 0
        and strpos(normalized_definition, 'assert_hotel_room_allocation_available') > 0
        and strpos(normalized_definition, 'assert_hotel_capacity_available')
          < strpos(normalized_definition, 'update public.hotel_capacity_reservations')
        and strpos(normalized_definition, 'update public.hotel_capacity_reservations')
          < strpos(normalized_definition, 'assert_hotel_room_allocation_available')
      from target
    ), false) as current_type_total_room_order_detected,
    coalesce((
      select md5(procedure_row.prosrc) =
        '321e35c3ac5180215086adf5d0f7d5ac'
      from pg_proc procedure_row
      where procedure_row.oid = to_regprocedure(
        'public.update_hotel_reservation(uuid,integer,uuid,uuid,text,timestamp with time zone,timestamp with time zone,uuid,uuid,uuid,uuid[],text,uuid)'
      )
    ), false) as update_lock_order_repair_ready,
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
      ) as flexible_migration_not_applied
)
select
  case
    when not target_function_exists
      then 'STOP_REVERSE_HOTEL_COMPLETION_MISSING'
    when not expected_function_version_ready
      then 'STOP_REVERSE_HOTEL_COMPLETION_UNEXPECTED_VERSION'
    when not security_definer_ready
      or not fixed_search_path_ready
      or not authenticated_execute_ready
      then 'STOP_REVERSE_HOTEL_COMPLETION_SECURITY_CONTRACT_MISMATCH'
    when not current_type_total_room_order_detected
      then 'STOP_EXPECTED_TYPE_TOTAL_ROOM_ORDER_NOT_FOUND'
    when not update_lock_order_repair_ready
      then 'STOP_UPDATE_LOCK_ORDER_REPAIR_REQUIRED'
    when not flexible_migration_not_applied
      then 'STOP_FLEXIBLE_MIGRATION_ALREADY_APPLIED'
    else 'READY_TO_APPLY_REVERSE_COMPLETION_LOCK_ORDER_REPAIR'
  end as preflight_status,
  checks.*
from checks;


rollback;
