-- Read-only preflight for Hotel Room Board cross-type operations.

begin read only;

with required_objects(object_name, object_kind, object_exists) as (
  values
    ('public.hotel_stays', 'table', to_regclass('public.hotel_stays') is not null),
    ('public.hotel_capacity_reservations', 'table', to_regclass('public.hotel_capacity_reservations') is not null),
    ('public.hotel_room_allocations', 'table', to_regclass('public.hotel_room_allocations') is not null),
    ('public.hotel_rooms', 'table', to_regclass('public.hotel_rooms') is not null),
    ('public.hotel_room_types', 'table', to_regclass('public.hotel_room_types') is not null),
    ('public.hotel_stay_schedule_events', 'table', to_regclass('public.hotel_stay_schedule_events') is not null),
    ('public.operation_schedules', 'table', to_regclass('public.operation_schedules') is not null),
    ('public.entity_audit_events', 'table', to_regclass('public.entity_audit_events') is not null),
    ('public.is_active_operation_member()', 'function',
      to_regprocedure('public.is_active_operation_member()') is not null),
    ('public.has_operation_role(text[])', 'function',
      to_regprocedure('public.has_operation_role(text[])') is not null),
    ('public.assert_hotel_capacity_available(uuid,timestamptz,timestamptz,integer,uuid)', 'function',
      to_regprocedure('public.assert_hotel_capacity_available(uuid,timestamp with time zone,timestamp with time zone,integer,uuid)') is not null),
    ('public.assert_hotel_room_allocation_available(uuid,uuid,timestamptz,timestamptz,uuid)', 'function',
      to_regprocedure('public.assert_hotel_room_allocation_available(uuid,uuid,timestamp with time zone,timestamp with time zone,uuid)') is not null),
    ('public.assert_hotel_total_capacity_available(timestamptz,timestamptz,integer,uuid)', 'function',
      to_regprocedure('public.assert_hotel_total_capacity_available(timestamp with time zone,timestamp with time zone,integer,uuid)') is not null),
    ('public.hotel_stay_json(uuid)', 'function',
      to_regprocedure('public.hotel_stay_json(uuid)') is not null),
    ('public.update_flexible_hotel_reservation(...)', 'function',
      to_regprocedure('public.update_flexible_hotel_reservation(uuid,integer,uuid,uuid,date,time without time zone,boolean,date,time without time zone,boolean,uuid,uuid,uuid,uuid[],text,uuid)') is not null),
    ('public.move_hotel_room_same_type(...)', 'function',
      to_regprocedure('public.move_hotel_room_same_type(uuid,integer,uuid,timestamp with time zone,text,uuid)') is not null)
)
select * from required_objects order by object_kind, object_name;

select
  column_row.table_name,
  column_row.column_name,
  column_row.data_type,
  column_row.is_nullable,
  column_row.column_default
from information_schema.columns column_row
where column_row.table_schema = 'public'
  and (
    (column_row.table_name = 'hotel_stays'
      and column_row.column_name in (
        'id', 'version', 'checked_in_at', 'checked_out_at', 'updated_by',
        'archived_at'
      ))
    or (column_row.table_name = 'hotel_capacity_reservations'
      and column_row.column_name in (
        'id', 'hotel_stay_id', 'room_type_id', 'reserved_from',
        'reserved_until', 'quantity', 'archived_at', 'updated_by'
      ))
    or (column_row.table_name = 'hotel_room_allocations'
      and column_row.column_name in (
        'id', 'capacity_reservation_id', 'room_id', 'allocated_from',
        'allocated_until', 'assignment_reason', 'archived_at', 'archived_by',
        'archive_reason', 'updated_by'
      ))
    or (column_row.table_name = 'operation_schedules'
      and column_row.column_name in (
        'id', 'title', 'version', 'archived_at', 'updated_by'
      ))
    or (column_row.table_name = 'entity_audit_events'
      and column_row.column_name in (
        'module_code', 'entity_type', 'entity_id', 'before_data',
        'after_data', 'changed_by', 'change_reason', 'request_id'
      ))
  )
order by column_row.table_name, column_row.ordinal_position;

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
    'assign_hotel_room',
    'reassign_hotel_room_before_check_in',
    'move_hotel_room_same_type',
    'update_hotel_reservation',
    'update_flexible_hotel_reservation',
    'hotel_stay_json',
    'get_hotel_operations_snapshot_v2'
  )
order by procedure_row.oid::regprocedure::text;

with required_columns(table_name, column_name) as (
  values
    ('hotel_stays', 'id'),
    ('hotel_stays', 'version'),
    ('hotel_stays', 'checked_in_at'),
    ('hotel_stays', 'checked_out_at'),
    ('hotel_stays', 'updated_by'),
    ('hotel_stays', 'archived_at'),
    ('hotel_capacity_reservations', 'hotel_stay_id'),
    ('hotel_capacity_reservations', 'room_type_id'),
    ('hotel_capacity_reservations', 'reserved_from'),
    ('hotel_capacity_reservations', 'reserved_until'),
    ('hotel_capacity_reservations', 'quantity'),
    ('hotel_room_allocations', 'capacity_reservation_id'),
    ('hotel_room_allocations', 'room_id'),
    ('hotel_room_allocations', 'allocated_from'),
    ('hotel_room_allocations', 'allocated_until'),
    ('hotel_room_allocations', 'archived_at'),
    ('hotel_room_allocations', 'archived_by'),
    ('hotel_room_allocations', 'archive_reason'),
    ('operation_schedules', 'title'),
    ('operation_schedules', 'version'),
    ('entity_audit_events', 'request_id'),
    ('entity_audit_events', 'changed_by'),
    ('entity_audit_events', 'change_reason')
), contract as (
  select
    not exists (
      select 1 from required_columns required
      left join information_schema.columns actual
        on actual.table_schema = 'public'
       and actual.table_name = required.table_name
       and actual.column_name = required.column_name
      where actual.column_name is null
    ) as required_columns_ready,
    to_regclass('public.hotel_stays') is not null
      and to_regclass('public.hotel_capacity_reservations') is not null
      and to_regclass('public.hotel_room_allocations') is not null
      and to_regclass('public.hotel_rooms') is not null
      and to_regclass('public.hotel_room_types') is not null
      and to_regclass('public.hotel_stay_schedule_events') is not null
      and to_regclass('public.operation_schedules') is not null
      and to_regclass('public.entity_audit_events') is not null
      as required_tables_ready,
    to_regprocedure('public.is_active_operation_member()') is not null
      and to_regprocedure('public.has_operation_role(text[])') is not null
      and to_regprocedure('public.assert_hotel_capacity_available(uuid,timestamp with time zone,timestamp with time zone,integer,uuid)') is not null
      and to_regprocedure('public.assert_hotel_room_allocation_available(uuid,uuid,timestamp with time zone,timestamp with time zone,uuid)') is not null
      and to_regprocedure('public.assert_hotel_total_capacity_available(timestamp with time zone,timestamp with time zone,integer,uuid)') is not null
      and to_regprocedure('public.hotel_stay_json(uuid)') is not null
      as required_functions_ready,
    to_regprocedure('public.unassign_hotel_room_before_check_in(uuid,integer,text,uuid)') is null
      and to_regprocedure('public.change_room_type_before_check_in(uuid,integer,uuid,text,uuid)') is null
      and to_regprocedure('public.change_room_type_after_check_in(uuid,integer,uuid,timestamp with time zone,text,uuid)') is null
      as append_targets_clean,
    coalesce((
      select
        strpos(normalized.definition, 'hotel-capacity:') > 0
        and strpos(normalized.definition, 'hotel-room:') > 0
      from (
        select lower(regexp_replace(
          pg_get_functiondef(procedure_row.oid), '\s+', ' ', 'g'
        )) as definition
        from pg_proc procedure_row
        where procedure_row.oid = to_regprocedure(
          'public.update_hotel_reservation(uuid,integer,uuid,uuid,text,timestamp with time zone,timestamp with time zone,uuid,uuid,uuid,uuid[],text,uuid)'
        )
      ) normalized
    ), false) as repaired_lock_contract_ready,
    exists (
      select 1 from pg_trigger trigger_row
      where trigger_row.tgrelid = 'public.hotel_capacity_reservations'::regclass
        and trigger_row.tgname = 'hotel_capacity_reservations_total_capacity_guard'
        and not trigger_row.tgisinternal
    ) as total_capacity_trigger_ready,
    exists (
      select 1 from pg_trigger trigger_row
      where trigger_row.tgrelid = 'public.hotel_room_allocations'::regclass
        and trigger_row.tgname = 'hotel_room_allocations_room_type_guard'
        and not trigger_row.tgisinternal
    ) as allocation_type_trigger_ready,
    exists (
      select 1 from public.operation_memberships membership
      join public.profiles profile on profile.id = membership.profile_id
      where membership.role in ('owner', 'manager')
        and membership.is_active
        and profile.is_active
        and profile.account_status = 'active'
    ) as active_manager_ready
)
select
  contract.*,
  case
    when not required_tables_ready then 'STOP_MISSING_REQUIRED_TABLES'
    when not required_columns_ready then 'STOP_MISSING_REQUIRED_COLUMNS'
    when not required_functions_ready then 'STOP_MISSING_REQUIRED_FUNCTIONS'
    when not append_targets_clean then 'STOP_EXTENSION_ALREADY_PRESENT'
    when not repaired_lock_contract_ready then 'STOP_LOCK_REPAIR_CONTRACT_NOT_READY'
    when not total_capacity_trigger_ready then 'STOP_TOTAL_CAPACITY_TRIGGER_MISSING'
    when not allocation_type_trigger_ready then 'STOP_ALLOCATION_TYPE_TRIGGER_MISSING'
    when not active_manager_ready then 'STOP_ACTIVE_OWNER_MANAGER_MISSING'
    else 'READY_TO_APPLY_HOTEL_ROOM_BOARD_CROSS_TYPE'
  end as preflight_status
from contract;

rollback;
