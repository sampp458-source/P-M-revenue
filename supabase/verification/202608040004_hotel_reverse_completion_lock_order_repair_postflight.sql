-- Read-only postflight for reverse_hotel_completion() lock-order repair.

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
    (select count(*) from target) = 1 as function_identity_preserved,
    coalesce((
      select function_body_fingerprint =
        'dd4dd04865adfa2dc3ec83097e2b81a3'
      from target
    ), false) as repaired_function_version_ready,
    coalesce((select authenticated_execute from target), false)
      as authenticated_execute_preserved,
    coalesce((select security_definer from target), false)
      as security_definer_preserved,
    coalesce((
      select 'search_path=public, pg_temp' = any(proconfig)
      from target
    ), false) as fixed_search_path_preserved,
    coalesce((
      select
        strpos(normalized_definition, 'assert_hotel_capacity_available') > 0
        and strpos(normalized_definition, 'hotel-room:') > 0
        and strpos(normalized_definition, 'update public.hotel_capacity_reservations') > 0
        and strpos(normalized_definition, 'assert_hotel_room_allocation_available') > 0
        and strpos(normalized_definition, 'assert_hotel_capacity_available')
          < strpos(normalized_definition, 'hotel-room:')
        and strpos(normalized_definition, 'hotel-room:')
          < strpos(normalized_definition, 'update public.hotel_capacity_reservations')
        and strpos(normalized_definition, 'update public.hotel_capacity_reservations')
          < strpos(normalized_definition, 'assert_hotel_room_allocation_available')
      from target
    ), false) as repaired_type_room_total_order_ready,
    coalesce((
      select md5(procedure_row.prosrc) =
        '321e35c3ac5180215086adf5d0f7d5ac'
      from pg_proc procedure_row
      where procedure_row.oid = to_regprocedure(
        'public.update_hotel_reservation(uuid,integer,uuid,uuid,text,timestamp with time zone,timestamp with time zone,uuid,uuid,uuid,uuid[],text,uuid)'
      )
    ), false) as update_lock_order_repair_preserved,
    to_regprocedure(
      'public.complete_hotel_check_in(uuid,integer,timestamp with time zone,uuid)'
    ) is not null
      and to_regprocedure(
        'public.complete_hotel_check_out(uuid,integer,timestamp with time zone,uuid)'
      ) is not null
      and to_regprocedure(
        'public.hotel_stay_json(uuid)'
      ) is not null as related_hotel_rpc_contract_ready
)
select
  case
    when not function_identity_preserved
      then 'FAILED_FUNCTION_IDENTITY'
    when not repaired_function_version_ready
      then 'FAILED_REPAIRED_FUNCTION_VERSION'
    when not authenticated_execute_preserved
      or not security_definer_preserved
      or not fixed_search_path_preserved
      then 'FAILED_FUNCTION_SECURITY_CONTRACT'
    when not repaired_type_room_total_order_ready
      then 'FAILED_TYPE_ROOM_TOTAL_LOCK_ORDER'
    when not update_lock_order_repair_preserved
      then 'FAILED_UPDATE_LOCK_ORDER_REPAIR_CONTRACT'
    when not related_hotel_rpc_contract_ready
      then 'FAILED_RELATED_HOTEL_RPC_CONTRACT'
    else 'REVERSE_COMPLETION_LOCK_ORDER_REPAIR_READY'
  end as postflight_status,
  checks.*
from checks;


rollback;
