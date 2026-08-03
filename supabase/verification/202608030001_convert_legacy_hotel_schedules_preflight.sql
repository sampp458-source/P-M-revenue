-- Read-only preflight for legacy Hotel schedule conversion.
begin read only;

with required_objects(object_name, object_kind, object_identity) as (
  values
    ('operation_schedules', 'table', 'public.operation_schedules'),
    ('operation_calendars', 'table', 'public.operation_calendars'),
    ('operation_schedule_types', 'table', 'public.operation_schedule_types'),
    ('operation_calendar_schedule_types', 'table', 'public.operation_calendar_schedule_types'),
    ('operation_schedule_assignees', 'table', 'public.operation_schedule_assignees'),
    ('operation_schedule_customers', 'table', 'public.operation_schedule_customers'),
    ('operation_schedule_dogs', 'table', 'public.operation_schedule_dogs'),
    ('operation_memberships', 'table', 'public.operation_memberships'),
    ('profiles', 'table', 'public.profiles'),
    ('dogs', 'table', 'public.dogs'),
    ('customers', 'table', 'public.customers'),
    ('business_units', 'table', 'public.business_units'),
    ('entity_audit_events', 'table', 'public.entity_audit_events'),
    ('hotel_room_types', 'table', 'public.hotel_room_types'),
    ('hotel_stays', 'table', 'public.hotel_stays'),
    ('hotel_capacity_reservations', 'table', 'public.hotel_capacity_reservations'),
    ('hotel_stay_schedule_events', 'table', 'public.hotel_stay_schedule_events'),
    ('has_operation_role(text[])', 'function', 'public.has_operation_role(text[])'),
    ('assert_hotel_capacity_available(uuid,timestamptz,timestamptz,integer,uuid)', 'function', 'public.assert_hotel_capacity_available(uuid,timestamp with time zone,timestamp with time zone,integer,uuid)'),
    ('update_operation_schedule(uuid,integer,uuid,uuid,text,timestamptz,timestamptz,boolean,boolean,text,uuid[],uuid[],uuid[],uuid)', 'function', 'public.update_operation_schedule(uuid,integer,uuid,uuid,text,timestamp with time zone,timestamp with time zone,boolean,boolean,text,uuid[],uuid[],uuid[],uuid)'),
    ('hotel_stay_json(uuid)', 'function', 'public.hotel_stay_json(uuid)')
), diagnosed as (
  select object_name, object_kind,
    case when object_kind = 'table'
      then to_regclass(object_identity) is not null
      else to_regprocedure(object_identity) is not null
    end as exists
  from required_objects
)
select object_name, object_kind, exists
from diagnosed
order by object_kind, object_name;

with required_columns(table_name, column_name) as (
  values
    ('operation_schedules', 'id'),
    ('operation_schedules', 'starts_at'),
    ('operation_schedules', 'ends_at'),
    ('operation_schedules', 'all_day'),
    ('operation_schedules', 'time_unspecified'),
    ('operation_schedules', 'status'),
    ('operation_schedules', 'version'),
    ('operation_schedules', 'archived_at'),
    ('operation_calendars', 'business_unit_id'),
    ('operation_calendars', 'is_active'),
    ('business_units', 'code'),
    ('business_units', 'is_active'),
    ('hotel_stays', 'dog_id'),
    ('hotel_stays', 'request_id'),
    ('hotel_stays', 'archived_at'),
    ('hotel_capacity_reservations', 'hotel_stay_id'),
    ('hotel_capacity_reservations', 'room_type_id'),
    ('hotel_capacity_reservations', 'reserved_from'),
    ('hotel_capacity_reservations', 'reserved_until'),
    ('hotel_capacity_reservations', 'archived_at'),
    ('hotel_stay_schedule_events', 'hotel_stay_id'),
    ('hotel_stay_schedule_events', 'operation_schedule_id'),
    ('hotel_stay_schedule_events', 'event_kind'),
    ('hotel_stay_schedule_events', 'archived_at')
)
select required.table_name, required.column_name,
  column_row.column_name is not null as exists
from required_columns required
left join information_schema.columns column_row
  on column_row.table_schema = 'public'
  and column_row.table_name = required.table_name
  and column_row.column_name = required.column_name
order by required.table_name, required.column_name;

select
  to_regprocedure('public.convert_legacy_hotel_schedules_to_reservation(uuid,uuid,uuid,uuid,uuid,uuid[],text,uuid)') is not null
    as conversion_rpc_already_exists,
  exists (
    select 1
    from pg_index index_row
    join pg_class table_row on table_row.oid = index_row.indrelid
    join pg_namespace namespace_row on namespace_row.oid = table_row.relnamespace
    where namespace_row.nspname = 'public'
      and table_row.relname = 'hotel_stay_schedule_events'
      and index_row.indisunique
      and pg_get_indexdef(index_row.indexrelid) ilike '%(operation_schedule_id)%'
      and coalesce(pg_get_expr(index_row.indpred, index_row.indrelid), '') ilike '%archived_at is null%'
  ) as active_schedule_link_unique,
  exists (
    select 1
    from pg_index index_row
    join pg_class table_row on table_row.oid = index_row.indrelid
    join pg_namespace namespace_row on namespace_row.oid = table_row.relnamespace
    where namespace_row.nspname = 'public'
      and table_row.relname = 'hotel_stay_schedule_events'
      and index_row.indisunique
      and pg_get_indexdef(index_row.indexrelid) ilike '%(hotel_stay_id, event_kind)%'
      and coalesce(pg_get_expr(index_row.indpred, index_row.indrelid), '') ilike '%archived_at is null%'
  ) as active_stay_event_kind_unique,
  exists (
    select 1
    from information_schema.columns column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = 'entity_audit_events'
      and column_row.column_name = 'request_id'
      and column_row.is_nullable = 'YES'
  ) as audit_request_id_nullable,
  exists (
    select 1
    from pg_index index_row
    join pg_class table_row on table_row.oid = index_row.indrelid
    join pg_namespace namespace_row on namespace_row.oid = table_row.relnamespace
    where namespace_row.nspname = 'public'
      and table_row.relname = 'entity_audit_events'
      and index_row.indisunique
      and pg_get_indexdef(index_row.indexrelid) ilike '%(request_id)%'
  ) as audit_request_id_unique;

select
  calendar.id as hotel_calendar_id,
  calendar.name as hotel_calendar_name,
  schedule_type.id as hotel_schedule_type_id,
  schedule_type.name as hotel_schedule_type_name,
  mapping.is_active as mapping_is_active
from public.operation_calendars calendar
join public.business_units unit on unit.id = calendar.business_unit_id
join public.operation_calendar_schedule_types mapping
  on mapping.calendar_id = calendar.id and mapping.archived_at is null
join public.operation_schedule_types schedule_type
  on schedule_type.id = mapping.schedule_type_id
where unit.code = 'hotel'
  and unit.is_active
  and calendar.is_active
  and schedule_type.is_active
  and schedule_type.name = '입실·퇴실'
order by calendar.id, schedule_type.id;

select
  membership.profile_id,
  membership.role,
  membership.is_active as membership_is_active,
  profile.is_active as profile_is_active,
  profile.account_status
from public.operation_memberships membership
join public.profiles profile on profile.id = membership.profile_id
where membership.role in ('owner', 'manager')
  and membership.is_active
  and profile.is_active
  and profile.account_status = 'active'
order by membership.role, membership.profile_id;

select object_name, row_count
from (
  values
    ('operation_schedules', (select count(*)::bigint from public.operation_schedules)),
    ('hotel_stays', (select count(*)::bigint from public.hotel_stays)),
    ('hotel_capacity_reservations', (select count(*)::bigint from public.hotel_capacity_reservations)),
    ('hotel_stay_schedule_events', (select count(*)::bigint from public.hotel_stay_schedule_events))
) baseline(object_name, row_count)
order by object_name;

select
  procedure_row.oid::regprocedure::text as function_signature,
  md5(pg_get_functiondef(procedure_row.oid)) as function_fingerprint
from pg_proc procedure_row
where procedure_row.oid in (
  to_regprocedure('public.update_operation_schedule(uuid,integer,uuid,uuid,text,timestamp with time zone,timestamp with time zone,boolean,boolean,text,uuid[],uuid[],uuid[],uuid)'),
  to_regprocedure('public.assert_hotel_capacity_available(uuid,timestamp with time zone,timestamp with time zone,integer,uuid)'),
  to_regprocedure('public.hotel_stay_json(uuid)'),
  to_regprocedure('public.create_hotel_reservation(uuid,uuid,text,timestamp with time zone,timestamp with time zone,uuid,uuid,uuid,uuid[],text,uuid)')
)
order by function_signature;

with required_identities(identity) as (
  values
    ('public.operation_schedules'::text),
    ('public.operation_calendars'),
    ('public.operation_schedule_types'),
    ('public.operation_calendar_schedule_types'),
    ('public.operation_schedule_assignees'),
    ('public.operation_schedule_customers'),
    ('public.operation_schedule_dogs'),
    ('public.operation_memberships'),
    ('public.profiles'), ('public.dogs'), ('public.customers'),
    ('public.business_units'), ('public.entity_audit_events'),
    ('public.hotel_room_types'), ('public.hotel_stays'),
    ('public.hotel_capacity_reservations'),
    ('public.hotel_stay_schedule_events')
), checks as (
  select
    not exists (select 1 from required_identities where to_regclass(identity) is null)
      as objects_ready,
    not exists (
      select 1
      from (values
        ('operation_schedules', 'id'),
        ('operation_schedules', 'starts_at'),
        ('operation_schedules', 'ends_at'),
        ('operation_schedules', 'all_day'),
        ('operation_schedules', 'time_unspecified'),
        ('operation_schedules', 'status'),
        ('operation_schedules', 'version'),
        ('operation_schedules', 'archived_at'),
        ('operation_calendars', 'business_unit_id'),
        ('operation_calendars', 'is_active'),
        ('business_units', 'code'),
        ('business_units', 'is_active'),
        ('hotel_stays', 'dog_id'),
        ('hotel_stays', 'request_id'),
        ('hotel_stays', 'archived_at'),
        ('hotel_capacity_reservations', 'hotel_stay_id'),
        ('hotel_capacity_reservations', 'room_type_id'),
        ('hotel_capacity_reservations', 'reserved_from'),
        ('hotel_capacity_reservations', 'reserved_until'),
        ('hotel_capacity_reservations', 'archived_at'),
        ('hotel_stay_schedule_events', 'hotel_stay_id'),
        ('hotel_stay_schedule_events', 'operation_schedule_id'),
        ('hotel_stay_schedule_events', 'event_kind'),
        ('hotel_stay_schedule_events', 'archived_at')
      ) required(table_name, column_name)
      where not exists (
        select 1 from information_schema.columns column_row
        where column_row.table_schema = 'public'
          and column_row.table_name = required.table_name
          and column_row.column_name = required.column_name
      )
    ) as column_contracts_ready,
    to_regprocedure('public.has_operation_role(text[])') is not null
      and to_regprocedure('public.assert_hotel_capacity_available(uuid,timestamp with time zone,timestamp with time zone,integer,uuid)') is not null
      and to_regprocedure('public.update_operation_schedule(uuid,integer,uuid,uuid,text,timestamp with time zone,timestamp with time zone,boolean,boolean,text,uuid[],uuid[],uuid[],uuid)') is not null
      and to_regprocedure('public.hotel_stay_json(uuid)') is not null
      as functions_ready,
    to_regprocedure('public.convert_legacy_hotel_schedules_to_reservation(uuid,uuid,uuid,uuid,uuid,uuid[],text,uuid)') is null
      as conversion_rpc_absent,
    exists (
      select 1 from public.operation_calendars calendar
      join public.business_units unit on unit.id = calendar.business_unit_id
      join public.operation_calendar_schedule_types mapping
        on mapping.calendar_id = calendar.id and mapping.archived_at is null
      join public.operation_schedule_types schedule_type
        on schedule_type.id = mapping.schedule_type_id
      where unit.code = 'hotel' and unit.is_active
        and calendar.is_active and mapping.is_active
        and schedule_type.is_active and schedule_type.name = '입실·퇴실'
    ) as hotel_mapping_ready,
    exists (
      select 1 from public.operation_memberships membership
      join public.profiles profile on profile.id = membership.profile_id
      where membership.role in ('owner', 'manager') and membership.is_active
        and profile.is_active and profile.account_status = 'active'
    ) as manager_ready,
    exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'entity_audit_events'
        and column_name = 'request_id' and is_nullable = 'YES'
    ) and exists (
      select 1 from pg_index index_row
      join pg_class table_row on table_row.oid = index_row.indrelid
      join pg_namespace namespace_row on namespace_row.oid = table_row.relnamespace
      where namespace_row.nspname = 'public'
        and table_row.relname = 'entity_audit_events'
        and index_row.indisunique
        and pg_get_indexdef(index_row.indexrelid) ilike '%(request_id)%'
    ) as audit_ready,
    exists (
      select 1 from pg_index index_row
      join pg_class table_row on table_row.oid = index_row.indrelid
      join pg_namespace namespace_row on namespace_row.oid = table_row.relnamespace
      where namespace_row.nspname = 'public'
        and table_row.relname = 'hotel_stay_schedule_events'
        and index_row.indisunique
        and pg_get_indexdef(index_row.indexrelid) ilike '%(operation_schedule_id)%'
        and coalesce(pg_get_expr(index_row.indpred, index_row.indrelid), '') ilike '%archived_at is null%'
    ) as link_uniqueness_ready
)
select *, case
  when not objects_ready then 'STOP_MISSING_REQUIRED_OBJECTS'
  when not column_contracts_ready then 'STOP_MISSING_REQUIRED_COLUMNS'
  when not functions_ready then 'STOP_MISSING_REQUIRED_FUNCTIONS'
  when not conversion_rpc_absent then 'STOP_CONVERSION_RPC_ALREADY_EXISTS'
  when not hotel_mapping_ready then 'STOP_HOTEL_MAPPING_NOT_READY'
  when not manager_ready then 'STOP_NO_ACTIVE_OWNER_OR_MANAGER'
  when not audit_ready then 'STOP_AUDIT_REQUEST_CONTRACT_NOT_READY'
  when not link_uniqueness_ready then 'STOP_EVENT_LINK_UNIQUENESS_NOT_READY'
  else 'READY_TO_APPLY'
end as preflight_status
from checks;

rollback;
