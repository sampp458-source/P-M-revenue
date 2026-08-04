-- Read-only postflight for the Hotel update lock-order repair.

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
    (select count(*) from target) = 1 as function_identity_preserved,
    coalesce((
      select function_body_fingerprint =
        '321e35c3ac5180215086adf5d0f7d5ac'
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
        strpos(normalized_definition, 'hotel-capacity:') > 0
        and strpos(normalized_definition, 'hotel-room:') > 0
        and strpos(normalized_definition, 'assert_hotel_capacity_available') > 0
        and strpos(normalized_definition, 'update public.hotel_capacity_reservations') > 0
        and strpos(normalized_definition, 'hotel-capacity:')
          < strpos(normalized_definition, 'hotel-room:')
        and strpos(normalized_definition, 'hotel-room:')
          < strpos(normalized_definition, 'assert_hotel_capacity_available')
        and strpos(normalized_definition, 'assert_hotel_capacity_available')
          < strpos(normalized_definition, 'update public.hotel_capacity_reservations')
      from target
    ), false) as repaired_type_before_room_ready,
    to_regprocedure(
      'public.create_hotel_reservation(uuid,uuid,text,timestamp with time zone,timestamp with time zone,uuid,uuid,uuid,uuid[],text,uuid)'
    ) is not null
      and to_regprocedure(
        'public.complete_hotel_check_in(uuid,integer,timestamp with time zone,uuid)'
      ) is not null
      and to_regprocedure(
        'public.complete_hotel_check_out(uuid,integer,timestamp with time zone,uuid)'
      ) is not null
      and to_regprocedure(
        'public.assign_hotel_room(uuid,integer,uuid,text,uuid)'
      ) is not null
      and to_regprocedure(
        'public.reassign_hotel_room_before_check_in(uuid,integer,uuid,text,uuid)'
      ) is not null
      and to_regprocedure(
        'public.move_hotel_room_same_type(uuid,integer,uuid,timestamp with time zone,text,uuid)'
      ) is not null
      and to_regprocedure(
        'public.cancel_hotel_reservation(uuid,integer,text,uuid)'
      ) is not null
      and to_regprocedure(
        'public.convert_legacy_hotel_schedules_to_reservation(uuid,uuid,uuid,uuid,uuid,uuid[],text,uuid)'
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
    when not repaired_type_before_room_ready
      then 'FAILED_TYPE_BEFORE_ROOM_LOCK_ORDER'
    when not related_hotel_rpc_contract_ready
      then 'FAILED_RELATED_HOTEL_RPC_CONTRACT'
    else 'HOTEL_UPDATE_LOCK_ORDER_REPAIR_READY'
  end as postflight_status,
  checks.*
from checks;


rollback;
