-- Hotel flexible reservation extension: read-only preflight

with required_objects(object_name, object_kind, object_exists) as (
  values
    ('public.hotel_stays', 'table', to_regclass('public.hotel_stays') is not null),
    ('public.hotel_capacity_reservations', 'table', to_regclass('public.hotel_capacity_reservations') is not null),
    ('public.hotel_room_allocations', 'table', to_regclass('public.hotel_room_allocations') is not null),
    ('public.hotel_stay_schedule_events', 'table', to_regclass('public.hotel_stay_schedule_events') is not null),
    ('public.hotel_room_types', 'table', to_regclass('public.hotel_room_types') is not null),
    ('public.hotel_rooms', 'table', to_regclass('public.hotel_rooms') is not null),
    ('public.business_units', 'table', to_regclass('public.business_units') is not null),
    ('public.operation_calendars', 'table', to_regclass('public.operation_calendars') is not null),
    ('public.operation_schedule_types', 'table', to_regclass('public.operation_schedule_types') is not null),
    ('public.operation_schedules', 'table', to_regclass('public.operation_schedules') is not null),
    ('public.entity_audit_events', 'table', to_regclass('public.entity_audit_events') is not null),
    ('public.can_manage_operation_schedule(uuid)', 'function',
      to_regprocedure('public.can_manage_operation_schedule(uuid)') is not null),
    ('public.create_operation_schedule(uuid,uuid,text,timestamptz,timestamptz,boolean,boolean,text,uuid[],uuid[],uuid[],uuid)', 'function',
      to_regprocedure('public.create_operation_schedule(uuid,uuid,text,timestamp with time zone,timestamp with time zone,boolean,boolean,text,uuid[],uuid[],uuid[],uuid)') is not null),
    ('public.update_operation_schedule(uuid,integer,uuid,uuid,text,timestamptz,timestamptz,boolean,boolean,text,uuid[],uuid[],uuid[],uuid)', 'function',
      to_regprocedure('public.update_operation_schedule(uuid,integer,uuid,uuid,text,timestamp with time zone,timestamp with time zone,boolean,boolean,text,uuid[],uuid[],uuid[],uuid)') is not null),
    ('public.assert_hotel_capacity_available(uuid,timestamptz,timestamptz,integer,uuid)', 'function',
      to_regprocedure('public.assert_hotel_capacity_available(uuid,timestamp with time zone,timestamp with time zone,integer,uuid)') is not null),
    ('public.assert_hotel_room_allocation_available(uuid,uuid,timestamptz,timestamptz,uuid)', 'function',
      to_regprocedure('public.assert_hotel_room_allocation_available(uuid,uuid,timestamp with time zone,timestamp with time zone,uuid)') is not null),
    ('public.hotel_stay_json(uuid)', 'function', to_regprocedure('public.hotel_stay_json(uuid)') is not null),
    ('public.get_hotel_operations_snapshot(date)', 'function', to_regprocedure('public.get_hotel_operations_snapshot(date)') is not null),
    ('public.create_hotel_reservation(...) legacy', 'function',
      to_regprocedure('public.create_hotel_reservation(uuid,uuid,text,timestamp with time zone,timestamp with time zone,uuid,uuid,uuid,uuid[],text,uuid)') is not null),
    ('public.update_hotel_reservation(...) legacy', 'function',
      to_regprocedure('public.update_hotel_reservation(uuid,integer,uuid,uuid,text,timestamp with time zone,timestamp with time zone,uuid,uuid,uuid,uuid[],text,uuid)') is not null),
    ('public.complete_hotel_check_in(...) legacy', 'function',
      to_regprocedure('public.complete_hotel_check_in(uuid,integer,timestamp with time zone,uuid)') is not null),
    ('public.complete_hotel_check_out(...) legacy', 'function',
      to_regprocedure('public.complete_hotel_check_out(uuid,integer,timestamp with time zone,uuid)') is not null)
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
    (column_row.table_name = 'hotel_capacity_reservations'
      and column_row.column_name in (
        'id', 'source_kind', 'hotel_stay_id', 'daycare_schedule_id',
        'room_type_id', 'reserved_from', 'reserved_until', 'quantity',
        'version', 'archived_at', 'updated_by'
      ))
    or (column_row.table_name = 'operation_schedules'
      and column_row.column_name in (
        'id', 'starts_at', 'ends_at', 'time_unspecified', 'version',
        'archived_at', 'updated_by'
      ))
  )
order by column_row.table_name, column_row.ordinal_position;

select
  procedure_row.oid::regprocedure::text as function_identity,
  md5(pg_get_functiondef(procedure_row.oid)) as function_fingerprint,
  procedure_row.prosecdef as security_definer,
  procedure_row.provolatile,
  has_function_privilege(
    'authenticated', procedure_row.oid, 'EXECUTE'
  ) as authenticated_execute
from pg_proc procedure_row
join pg_namespace schema_row on schema_row.oid = procedure_row.pronamespace
where schema_row.nspname = 'public'
  and procedure_row.proname in (
    'create_hotel_reservation',
    'update_hotel_reservation',
    'complete_hotel_check_in',
    'complete_hotel_check_out',
    'get_hotel_operations_snapshot',
    'hotel_stay_json'
  )
order by procedure_row.oid::regprocedure::text;

with required_objects as (
  select bool_and(item.ready) as ready
  from (
    values
      (to_regclass('public.hotel_stays') is not null),
      (to_regclass('public.hotel_capacity_reservations') is not null),
      (to_regclass('public.hotel_room_allocations') is not null),
      (to_regclass('public.hotel_stay_schedule_events') is not null),
      (to_regclass('public.hotel_room_types') is not null),
      (to_regclass('public.hotel_rooms') is not null),
      (to_regclass('public.business_units') is not null),
      (to_regclass('public.operation_calendars') is not null),
      (to_regclass('public.operation_schedule_types') is not null),
      (to_regclass('public.operation_schedules') is not null),
      (to_regclass('public.entity_audit_events') is not null),
      (to_regprocedure('public.can_manage_operation_schedule(uuid)') is not null),
      (to_regprocedure('public.create_operation_schedule(uuid,uuid,text,timestamp with time zone,timestamp with time zone,boolean,boolean,text,uuid[],uuid[],uuid[],uuid)') is not null),
      (to_regprocedure('public.update_operation_schedule(uuid,integer,uuid,uuid,text,timestamp with time zone,timestamp with time zone,boolean,boolean,text,uuid[],uuid[],uuid[],uuid)') is not null),
      (to_regprocedure('public.assert_hotel_capacity_available(uuid,timestamp with time zone,timestamp with time zone,integer,uuid)') is not null),
      (to_regprocedure('public.assert_hotel_room_allocation_available(uuid,uuid,timestamp with time zone,timestamp with time zone,uuid)') is not null),
      (to_regprocedure('public.hotel_stay_json(uuid)') is not null),
      (to_regprocedure('public.get_hotel_operations_snapshot(date)') is not null),
      (to_regprocedure('public.create_hotel_reservation(uuid,uuid,text,timestamp with time zone,timestamp with time zone,uuid,uuid,uuid,uuid[],text,uuid)') is not null),
      (to_regprocedure('public.update_hotel_reservation(uuid,integer,uuid,uuid,text,timestamp with time zone,timestamp with time zone,uuid,uuid,uuid,uuid[],text,uuid)') is not null),
      (to_regprocedure('public.complete_hotel_check_in(uuid,integer,timestamp with time zone,uuid)') is not null),
      (to_regprocedure('public.complete_hotel_check_out(uuid,integer,timestamp with time zone,uuid)') is not null)
  ) item(ready)
), required_columns as (
  select bool_and(column_row.column_name is not null) as ready
  from (
    values
      ('hotel_capacity_reservations', 'room_type_id'),
      ('hotel_capacity_reservations', 'reserved_from'),
      ('hotel_capacity_reservations', 'reserved_until'),
      ('hotel_capacity_reservations', 'source_kind'),
      ('hotel_capacity_reservations', 'hotel_stay_id'),
      ('operation_schedules', 'time_unspecified'),
      ('operation_schedules', 'starts_at'),
      ('operation_schedules', 'ends_at')
  ) required(table_name, column_name)
  left join information_schema.columns column_row
    on column_row.table_schema = 'public'
   and column_row.table_name = required.table_name
   and column_row.column_name = required.column_name
), contract as (
  select
    exists (
      select 1 from information_schema.columns column_row
      where column_row.table_schema = 'public'
        and column_row.table_name = 'hotel_capacity_reservations'
        and column_row.column_name = 'room_type_id'
        and column_row.is_nullable = 'NO'
    ) as room_type_currently_not_null,
    exists (
      select 1 from information_schema.columns column_row
      where column_row.table_schema = 'public'
        and column_row.table_name = 'operation_schedules'
        and column_row.column_name = 'time_unspecified'
        and column_row.is_nullable = 'NO'
        and replace(lower(coalesce(column_row.column_default, '')), ' ', '')
          in ('false', 'false::boolean')
    ) as schedule_time_unspecified_ready,
    (select count(*) from public.hotel_capacity_reservations
      where room_type_id is null) = 0 as no_existing_null_room_type,
    (select count(*) from public.hotel_rooms room
      join public.hotel_room_types room_type on room_type.id = room.room_type_id
      where room.is_active and room.archived_at is null
        and room_type.is_active and room_type.archived_at is null) = 11
      as active_room_total_ready,
    (select count(*) from public.hotel_rooms room
      join public.hotel_room_types room_type on room_type.id = room.room_type_id
      where room.is_active and room.archived_at is null
        and room_type.is_active and room_type.archived_at is null
        and room_type.code = 'STANDARD') = 5
      as standard_room_seed_ready,
    (select count(*) from public.hotel_rooms room
      join public.hotel_room_types room_type on room_type.id = room.room_type_id
      where room.is_active and room.archived_at is null
        and room_type.is_active and room_type.archived_at is null
        and room_type.code = 'DELUXE') = 6
      as deluxe_room_seed_ready,
    (select count(*) from public.hotel_room_types room_type
      where room_type.is_active and room_type.archived_at is null
        and room_type.code in ('STANDARD', 'DELUXE')) = 2
      as standard_deluxe_ready,
    not exists (
      select 1 from public.hotel_stay_schedule_events event
      where event.archived_at is null
      group by event.hotel_stay_id
      having count(*) filter (where event.event_kind = 'check_in') <> 1
        or count(*) filter (where event.event_kind = 'check_out') <> 1
        or count(*) <> 2
    ) as event_link_contract_ready,
    exists (
      select 1 from information_schema.columns column_row
      where column_row.table_schema = 'public'
        and column_row.table_name = 'entity_audit_events'
        and column_row.column_name = 'request_id'
        and column_row.is_nullable = 'YES'
    ) as audit_request_nullable,
    exists (
      select 1
      from pg_index index_row
      join pg_class table_row on table_row.oid = index_row.indrelid
      join pg_namespace schema_row on schema_row.oid = table_row.relnamespace
      join pg_attribute attribute_row
        on attribute_row.attrelid = table_row.oid
       and attribute_row.attnum = any(index_row.indkey)
      where schema_row.nspname = 'public'
        and table_row.relname = 'entity_audit_events'
        and attribute_row.attname = 'request_id'
        and index_row.indisunique
    ) as audit_request_unique,
    not exists (
      select 1
      from (values
        ('operation_schedules_protect_metadata'),
        ('operation_schedules_updated_at'),
        ('operation_schedules_write_permission'),
        ('operation_schedules_audit')
      ) required_trigger(trigger_name)
      where not exists (
        select 1
        from pg_trigger trigger_row
        where trigger_row.tgrelid = 'public.operation_schedules'::regclass
          and trigger_row.tgname = required_trigger.trigger_name
          and not trigger_row.tgisinternal
          and trigger_row.tgenabled <> 'D'
      )
    ) as schedule_write_triggers_ready,
    exists (
      select 1
      from pg_constraint constraint_row
      join pg_class table_row on table_row.oid = constraint_row.conrelid
      join pg_namespace schema_row on schema_row.oid = table_row.relnamespace
      where schema_row.nspname = 'public'
        and table_row.relname = 'hotel_capacity_reservations'
        and constraint_row.conname = 'hotel_capacity_reservations_source_check'
        and constraint_row.contype = 'c'
        and constraint_row.convalidated
        and lower(pg_get_constraintdef(constraint_row.oid)) like
          '%source_kind = ''stay''%hotel_stay_id is not null%daycare_schedule_id is null%'
        and lower(pg_get_constraintdef(constraint_row.oid)) like
          '%source_kind = ''daycare''%hotel_stay_id is null%daycare_schedule_id is not null%'
    ) as capacity_source_xor_constraint_ready,
    coalesce((
      select
        strpos(normalized.definition, 'hotel-capacity:') > 0
        and strpos(normalized.definition, 'hotel-room:') > 0
        and strpos(normalized.definition, 'assert_hotel_capacity_available') > 0
        and strpos(normalized.definition, 'hotel-capacity:')
          < strpos(normalized.definition, 'hotel-room:')
        and strpos(normalized.definition, 'hotel-room:')
          < strpos(normalized.definition, 'assert_hotel_capacity_available')
      from (
        select lower(regexp_replace(
          pg_get_functiondef(procedure_row.oid), '\s+', ' ', 'g'
        )) as definition
        from pg_proc procedure_row
        join pg_namespace schema_row
          on schema_row.oid = procedure_row.pronamespace
        where schema_row.nspname = 'public'
          and procedure_row.oid = to_regprocedure(
            'public.update_hotel_reservation(uuid,integer,uuid,uuid,text,timestamp with time zone,timestamp with time zone,uuid,uuid,uuid,uuid[],text,uuid)'
          )
      ) normalized
    ), false) as legacy_update_type_before_room_ready,
    coalesce((
      select
        strpos(normalized.definition, 'assert_hotel_capacity_available') > 0
        and strpos(normalized.definition, 'hotel-room:') > 0
        and strpos(normalized.definition, 'assert_hotel_capacity_available')
          < strpos(normalized.definition, 'hotel-room:')
      from (
        select lower(regexp_replace(
          pg_get_functiondef(procedure_row.oid), '\s+', ' ', 'g'
        )) as definition
        from pg_proc procedure_row
        join pg_namespace schema_row
          on schema_row.oid = procedure_row.pronamespace
        where schema_row.nspname = 'public'
          and procedure_row.oid = to_regprocedure(
            'public.complete_hotel_check_out(uuid,integer,timestamp with time zone,uuid)'
          )
      ) normalized
    ), false) as legacy_checkout_type_before_room_ready,
    coalesce((
      select
        strpos(normalized.definition, 'assert_hotel_capacity_available') > 0
        and strpos(normalized.definition, 'hotel-room:') > 0
        and strpos(normalized.definition, 'update public.hotel_capacity_reservations') > 0
        and strpos(normalized.definition, 'assert_hotel_room_allocation_available') > 0
        and strpos(normalized.definition, 'assert_hotel_capacity_available')
          < strpos(normalized.definition, 'hotel-room:')
        and strpos(normalized.definition, 'hotel-room:')
          < strpos(normalized.definition, 'update public.hotel_capacity_reservations')
        and strpos(normalized.definition, 'update public.hotel_capacity_reservations')
          < strpos(normalized.definition, 'assert_hotel_room_allocation_available')
      from (
        select lower(regexp_replace(
          pg_get_functiondef(procedure_row.oid), '\s+', ' ', 'g'
        )) as definition
        from pg_proc procedure_row
        where procedure_row.oid = to_regprocedure(
          'public.reverse_hotel_completion(uuid,integer,text,text,uuid)'
        )
      ) normalized
    ), false) as legacy_reverse_type_room_total_ready,
    coalesce((
      select md5(procedure_row.prosrc) =
        'dd4dd04865adfa2dc3ec83097e2b81a3'
      from pg_proc procedure_row
      where procedure_row.oid = to_regprocedure(
        'public.reverse_hotel_completion(uuid,integer,text,text,uuid)'
      )
    ), false) as legacy_reverse_lock_repair_version_ready,
    coalesce((
      select md5(procedure_row.prosrc) =
        '321e35c3ac5180215086adf5d0f7d5ac'
      from pg_proc procedure_row
      where procedure_row.oid = to_regprocedure(
        'public.update_hotel_reservation(uuid,integer,uuid,uuid,text,timestamp with time zone,timestamp with time zone,uuid,uuid,uuid,uuid[],text,uuid)'
      )
    ), false) as legacy_update_lock_repair_version_ready,
    (
      not exists (
      select 1 from pg_proc procedure_row
      join pg_namespace schema_row on schema_row.oid = procedure_row.pronamespace
      where schema_row.nspname = 'public'
        and procedure_row.proname in (
          'assert_hotel_total_capacity_available',
          'enforce_hotel_total_capacity',
          'enforce_hotel_allocation_room_type',
          'create_flexible_hotel_reservation',
          'update_flexible_hotel_reservation',
          'finalize_and_complete_hotel_check_in',
          'finalize_and_complete_hotel_check_out',
          'get_hotel_operations_snapshot_v2'
        )
      )
      and not exists (
        select 1 from pg_trigger trigger_row
        where trigger_row.tgname in (
          'hotel_capacity_reservations_total_capacity_guard',
          'hotel_room_allocations_room_type_guard'
        )
          and not trigger_row.tgisinternal
      )
      and to_regclass(
        'public.hotel_capacity_reservations_unspecified_overlap_idx'
      ) is null
      and not exists (
        select 1
        from pg_constraint constraint_row
        join pg_class table_row on table_row.oid = constraint_row.conrelid
        join pg_namespace schema_row on schema_row.oid = table_row.relnamespace
        where schema_row.nspname = 'public'
          and table_row.relname = 'hotel_capacity_reservations'
          and constraint_row.conname =
            'hotel_capacity_reservations_room_type_state_check'
      )
    ) as extension_objects_absent
)
select
  required_objects.ready as required_objects_ready,
  required_columns.ready as required_columns_ready,
  contract.*,
  case
    when not required_objects.ready then 'STOP_MISSING_REQUIRED_OBJECTS'
    when not required_columns.ready then 'STOP_MISSING_REQUIRED_COLUMNS'
    when not contract.room_type_currently_not_null
      then 'STOP_ROOM_TYPE_NULLABILITY_NOT_CLEAN'
    when not contract.schedule_time_unspecified_ready
      then 'STOP_SCHEDULE_TIME_UNSPECIFIED_NOT_READY'
    when not contract.no_existing_null_room_type
      then 'STOP_EXISTING_NULL_ROOM_TYPE_REVIEW_REQUIRED'
    when not contract.active_room_total_ready
      or not contract.standard_room_seed_ready
      or not contract.deluxe_room_seed_ready
      or not contract.standard_deluxe_ready
      then 'STOP_ROOM_INVENTORY_CONTRACT_MISMATCH'
    when not contract.event_link_contract_ready
      then 'STOP_EVENT_LINK_CONTRACT_MISMATCH'
    when not contract.audit_request_nullable
      or not contract.audit_request_unique
      then 'STOP_AUDIT_REQUEST_CONTRACT_MISMATCH'
    when not contract.schedule_write_triggers_ready
      then 'STOP_SCHEDULE_WRITE_TRIGGER_CONTRACT_MISMATCH'
    when not contract.capacity_source_xor_constraint_ready
      then 'STOP_CAPACITY_SOURCE_XOR_CONTRACT_MISMATCH'
    when not contract.legacy_update_type_before_room_ready
      or not contract.legacy_checkout_type_before_room_ready
      then 'STOP_EXISTING_GLOBAL_LOCK_ORDER_CONFLICT'
    when not contract.legacy_reverse_type_room_total_ready
      then 'STOP_REVERSE_COMPLETION_GLOBAL_LOCK_ORDER_CONFLICT'
    when not contract.legacy_reverse_lock_repair_version_ready
      then 'STOP_REVERSE_COMPLETION_LOCK_REPAIR_VERSION_MISMATCH'
    when not contract.legacy_update_lock_repair_version_ready
      then 'STOP_UPDATE_LOCK_REPAIR_VERSION_MISMATCH'
    when not contract.extension_objects_absent
      then 'STOP_EXTENSION_OBJECTS_ALREADY_EXIST'
    else 'READY_TO_APPLY_HOTEL_FLEXIBLE_RESERVATIONS'
  end as preflight_status
from required_objects
cross join required_columns
cross join contract;
