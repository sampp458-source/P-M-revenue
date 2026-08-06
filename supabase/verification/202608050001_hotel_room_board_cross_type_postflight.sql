-- Read-only postflight for Hotel Room Board cross-type operations.

begin read only;

select
  procedure_row.oid::regprocedure::text as function_identity,
  md5(pg_get_functiondef(procedure_row.oid)) as function_fingerprint,
  procedure_row.prosecdef as security_definer,
  procedure_row.provolatile,
  has_function_privilege('authenticated', procedure_row.oid, 'EXECUTE')
    as authenticated_execute
from pg_proc procedure_row
join pg_namespace schema_row on schema_row.oid = procedure_row.pronamespace
where schema_row.nspname = 'public'
  and procedure_row.proname in (
    'unassign_hotel_room_before_check_in',
    'change_room_type_before_check_in',
    'change_room_type_after_check_in'
  )
order by procedure_row.oid::regprocedure::text;

with definitions as (
  select
    procedure_row.proname,
    lower(regexp_replace(
      pg_get_functiondef(procedure_row.oid), '\s+', ' ', 'g'
    )) as definition,
    procedure_row.prosecdef,
    procedure_row.proconfig,
    has_function_privilege('authenticated', procedure_row.oid, 'EXECUTE')
      as authenticated_execute
  from pg_proc procedure_row
  join pg_namespace schema_row on schema_row.oid = procedure_row.pronamespace
  where schema_row.nspname = 'public'
    and procedure_row.proname in (
      'unassign_hotel_room_before_check_in',
      'change_room_type_before_check_in',
      'change_room_type_after_check_in'
    )
), signatures as (
  select
    to_regprocedure('public.unassign_hotel_room_before_check_in(uuid,integer,text,uuid)')
      is not null as unassign_exists,
    to_regprocedure('public.change_room_type_before_check_in(uuid,integer,uuid,text,uuid)')
      is not null as before_change_exists,
    to_regprocedure('public.change_room_type_after_check_in(uuid,integer,uuid,timestamp with time zone,text,uuid)')
      is not null as after_change_exists
), contract as (
  select
    signatures.*,
    (select count(*) = 3 from definitions) as exactly_three_functions,
    coalesce((select bool_and(
      definition_row.prosecdef
      and definition_row.authenticated_execute
      and definition_row.proconfig @> array['search_path=public, pg_temp']::text[]
    ) from definitions definition_row), false) as security_contract_ready,
    coalesce((select
      definition like '%is_active_operation_member()%'
      and definition like '%checked_in_at is not null%'
      and definition like '%update public.hotel_room_allocations%'
      and definition like '%archived_at = clock_timestamp()%'
      and definition like '%hotel-capacity:%'
      and definition like '%hotel-room:%'
      and definition like '%hotel stay root audit이 정확히 한 건%'
      from definitions where proname = 'unassign_hotel_room_before_check_in'
    ), false) as unassign_contract_ready,
    coalesce((select
      definition like '%has_operation_role(array[''owner'', ''manager''])%'
      and definition like '%같은 객실 유형은 기존 호실 재배정%'
      and definition like '%allocation_count <> 1%'
      and definition like '%assert_hotel_capacity_available%'
      and definition like '%assert_hotel_room_allocation_available%'
      and definition not like '%update public.operation_schedules%'
      and strpos(definition, 'hotel-capacity:') < strpos(definition, 'hotel-room:')
      and strpos(definition, 'hotel-room:') < strpos(definition, 'update public.hotel_capacity_reservations')
      from definitions where proname = 'change_room_type_before_check_in'
    ), false) as before_change_contract_ready,
    coalesce((select
      definition like '%has_operation_role(array[''owner'', ''manager''])%'
      and definition like '%p_effective_at > clock_timestamp()%'
      and definition like '%current_allocation_count <> 1%'
      and definition like '%allocation.allocated_from < p_effective_at%'
      and definition like '%allocation.allocated_until > p_effective_at%'
      and definition like '%같은 객실 유형은 기존 객실 이동%'
      and definition like '%assert_hotel_capacity_available%'
      and definition like '%assert_hotel_room_allocation_available%'
      and definition not like '%update public.operation_schedules%'
      and strpos(definition, 'hotel-capacity:') < strpos(definition, 'hotel-room:')
      and strpos(definition, 'hotel-room:') < strpos(definition, 'update public.hotel_capacity_reservations')
      from definitions where proname = 'change_room_type_after_check_in'
    ), false) as after_change_contract_ready,
    coalesce((select bool_and(
      definition like '%normalized_reason text := nullif(btrim(p_reason), '''')%'
      and definition like '%hotel-request:%'
      and definition like '%동일 request_id의 입력 계약 불일치%'
      and definition like '%return public.hotel_stay_json%'
    ) from definitions), false) as replay_and_reason_ready,
    coalesce((select
      definition like '%room=%s · type=%s%'
      from definitions where proname = 'change_room_type_before_check_in'
    ), false)
    and coalesce((select
      definition like '%room=%s · type=%s · effective_at=%s%'
      from definitions where proname = 'change_room_type_after_check_in'
    ), false) as replay_payload_ready,
    to_regprocedure('public.assign_hotel_room(uuid,integer,uuid,text,uuid)') is not null
      and to_regprocedure('public.reassign_hotel_room_before_check_in(uuid,integer,uuid,text,uuid)') is not null
      and to_regprocedure('public.move_hotel_room_same_type(uuid,integer,uuid,timestamp with time zone,text,uuid)') is not null
      and to_regprocedure('public.update_flexible_hotel_reservation(uuid,integer,uuid,uuid,date,time without time zone,boolean,date,time without time zone,boolean,uuid,uuid,uuid,uuid[],text,uuid)') is not null
      as existing_rpc_contract_ready
  from signatures
)
select
  contract.*,
  case
    when not unassign_exists then 'FAILED_UNASSIGN_RPC_MISSING'
    when not before_change_exists then 'FAILED_BEFORE_CHANGE_RPC_MISSING'
    when not after_change_exists then 'FAILED_AFTER_CHANGE_RPC_MISSING'
    when not exactly_three_functions then 'FAILED_FUNCTION_COUNT'
    when not security_contract_ready then 'FAILED_SECURITY_CONTRACT'
    when not unassign_contract_ready then 'FAILED_UNASSIGN_CONTRACT'
    when not before_change_contract_ready then 'FAILED_BEFORE_CHANGE_CONTRACT'
    when not after_change_contract_ready then 'FAILED_AFTER_CHANGE_CONTRACT'
    when not replay_and_reason_ready then 'FAILED_REPLAY_REASON_CONTRACT'
    when not replay_payload_ready then 'FAILED_REPLAY_PAYLOAD_CONTRACT'
    when not existing_rpc_contract_ready then 'FAILED_EXISTING_RPC_CONTRACT'
    else 'HOTEL_ROOM_BOARD_CROSS_TYPE_READY'
  end as postflight_status
from contract;

rollback;
