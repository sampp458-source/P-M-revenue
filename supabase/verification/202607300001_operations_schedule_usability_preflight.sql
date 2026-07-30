-- Operations 일정 사용성 확장 적용 전 읽기 전용 점검

with required_objects(object_type, object_name, object_exists) as (
  values
    ('table', 'operation_memberships', to_regclass('public.operation_memberships') is not null),
    ('table', 'operation_calendars', to_regclass('public.operation_calendars') is not null),
    ('table', 'operation_schedule_types', to_regclass('public.operation_schedule_types') is not null),
    ('table', 'operation_schedules', to_regclass('public.operation_schedules') is not null),
    ('table', 'entity_audit_events', to_regclass('public.entity_audit_events') is not null),
    ('function', 'set_updated_at()', to_regprocedure('public.set_updated_at()') is not null),
    ('function', 'is_active_operation_member()', to_regprocedure('public.is_active_operation_member()') is not null),
    ('function', 'has_operation_role(text[])', to_regprocedure('public.has_operation_role(text[])') is not null),
    ('function', 'assert_operation_schedule_input(...)', exists (
      select 1 from pg_proc procedure
      join pg_namespace namespace on namespace.oid = procedure.pronamespace
      where namespace.nspname = 'public'
        and procedure.proname = 'assert_operation_schedule_input'
    ))
)
select * from required_objects order by object_type, object_name;

select
  to_regclass('public.operation_calendar_schedule_types') is not null
    as mapping_table_already_exists,
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'operation_memberships'
      and column_name = 'schedule_color'
  ) as schedule_color_already_exists,
  to_regprocedure(
    'public.get_active_operation_assignees()'
  ) is not null as assignee_rpc_already_exists,
  exists (
    select 1 from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = 'set_operation_member_schedule_color'
  ) as color_rpc_already_exists;

select
  column_info.is_nullable = 'YES' as request_id_is_nullable,
  exists (
    select 1
    from pg_index index_info
    join pg_attribute attribute
      on attribute.attrelid = index_info.indrelid
     and attribute.attnum = any(index_info.indkey)
    where index_info.indrelid = 'public.entity_audit_events'::regclass
      and index_info.indisunique = true
      and index_info.indnkeyatts = 1
      and attribute.attname = 'request_id'
  ) as request_id_unique_is_preserved
from information_schema.columns column_info
where column_info.table_schema = 'public'
  and column_info.table_name = 'entity_audit_events'
  and column_info.column_name = 'request_id';

select
  calendar.id,
  calendar.name,
  calendar.scope_type,
  unit.code as business_unit_code,
  calendar.is_active
from public.operation_calendars calendar
left join public.business_units unit on unit.id = calendar.business_unit_id
order by calendar.sort_order, calendar.name;

select
  schedule_type.id,
  schedule_type.name,
  schedule_type.is_active,
  schedule_type.sort_order
from public.operation_schedule_types schedule_type
order by schedule_type.sort_order, schedule_type.name;

select
  membership.profile_id,
  profile.name,
  membership.role,
  membership.is_active,
  profile.is_active as profile_is_active,
  profile.account_status
from public.operation_memberships membership
join public.profiles profile on profile.id = membership.profile_id
order by profile.name nulls last, membership.profile_id;

select
  schedule.calendar_id,
  calendar.name as calendar_name,
  schedule.schedule_type_id,
  schedule_type.name as schedule_type_name,
  count(*) as existing_schedule_count
from public.operation_schedules schedule
join public.operation_calendars calendar on calendar.id = schedule.calendar_id
join public.operation_schedule_types schedule_type
  on schedule_type.id = schedule.schedule_type_id
group by schedule.calendar_id, calendar.name,
  schedule.schedule_type_id, schedule_type.name
order by calendar.name, schedule_type.name;

select
  (select count(*) from public.sales) as finance_sales_rows,
  (select count(*) from public.sale_payments) as finance_payment_rows,
  (select count(*) from public.sale_refunds) as finance_refund_rows,
  (
    select count(*)
    from public.operation_memberships membership
    join public.profiles profile on profile.id = membership.profile_id
    where membership.role = 'owner'
      and membership.is_active = true
      and profile.is_active = true
      and profile.account_status = 'active'
  ) as active_owner_count;

with state as (
  select
    to_regclass('public.operation_memberships') is not null
      and to_regclass('public.operation_calendars') is not null
      and to_regclass('public.operation_schedule_types') is not null
      and to_regclass('public.operation_schedules') is not null
      and to_regclass('public.entity_audit_events') is not null
      and to_regprocedure('public.set_updated_at()') is not null
      and to_regprocedure('public.is_active_operation_member()') is not null
      as foundation_ready,
    to_regclass('public.operation_calendar_schedule_types') is not null
      or exists (
        select 1 from information_schema.columns
        where table_schema = 'public'
          and table_name = 'operation_memberships'
          and column_name = 'schedule_color'
      )
      or to_regprocedure('public.get_active_operation_assignees()') is not null
      or exists (
        select 1 from pg_proc procedure
        join pg_namespace namespace on namespace.oid = procedure.pronamespace
        where namespace.nspname = 'public'
          and procedure.proname = 'set_operation_member_schedule_color'
      ) as target_objects_exist,
    exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'entity_audit_events'
        and column_name = 'request_id'
        and is_nullable = 'YES'
    ) as audit_request_nullable,
    exists (
      select 1
      from pg_index index_info
      join pg_attribute attribute
        on attribute.attrelid = index_info.indrelid
       and attribute.attnum = any(index_info.indkey)
      where index_info.indrelid = 'public.entity_audit_events'::regclass
        and index_info.indisunique = true
        and index_info.indnkeyatts = 1
        and attribute.attname = 'request_id'
    ) as audit_request_unique,
    exists (
      select 1
      from public.operation_memberships membership
      join public.profiles profile on profile.id = membership.profile_id
      where membership.role = 'owner'
        and membership.is_active = true
        and profile.is_active = true
        and profile.account_status = 'active'
    ) as active_owner_exists
)
select
  case
    when not foundation_ready then 'STOP_FOUNDATION_NOT_READY'
    when target_objects_exist then 'WARNING_PARTIAL_OR_EXISTING_TARGET_OBJECTS'
    when not audit_request_nullable then 'STOP_AUDIT_REQUEST_ID_NOT_NULL'
    when not audit_request_unique then 'STOP_AUDIT_REQUEST_ID_UNIQUE_MISSING'
    when not active_owner_exists then 'STOP_ACTIVE_OWNER_MISSING'
    else 'READY'
  end as preflight_status,
  *
from state;
