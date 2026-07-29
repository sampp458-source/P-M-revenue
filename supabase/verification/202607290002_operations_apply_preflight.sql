-- Operations 운영 적용 전 읽기 전용 점검
-- 모든 결과를 확인한 뒤 Foundation -> Schedule Foundation -> Single Schedule 순서로 적용한다.

with expected_tables(name) as (
  values
    ('operation_memberships'),
    ('operation_calendars'),
    ('operation_schedule_types'),
    ('entity_audit_events'),
    ('operation_schedule_series'),
    ('operation_schedules'),
    ('operation_schedule_assignees'),
    ('operation_schedule_customers'),
    ('operation_schedule_dogs')
)
select
  'table' as object_type,
  expected.name as object_name,
  to_regclass('public.' || expected.name) is not null as object_exists
from expected_tables expected
order by expected.name;

with expected_functions(name) as (
  values
    ('is_active_operation_member'),
    ('has_operation_role'),
    ('sync_operation_membership_from_profile'),
    ('protect_operation_setting_metadata'),
    ('record_operation_audit_event'),
    ('protect_operation_schedule_metadata'),
    ('protect_operation_link_metadata'),
    ('record_operation_schedule_audit_event'),
    ('block_operation_schedule_delete'),
    ('operation_schedule_json'),
    ('assert_operation_schedule_input'),
    ('sync_operation_schedule_links'),
    ('get_operation_schedules_for_day'),
    ('create_operation_schedule'),
    ('update_operation_schedule'),
    ('set_operation_schedule_status'),
    ('archive_operation_schedule')
)
select
  'function' as object_type,
  expected.name as object_name,
  exists (
    select 1
    from pg_proc procedure
    join pg_namespace namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = expected.name
  ) as object_exists
from expected_functions expected
order by expected.name;

select
  trigger.event_object_table as table_name,
  trigger.trigger_name,
  trigger.action_timing,
  trigger.event_manipulation
from information_schema.triggers trigger
where trigger.trigger_schema = 'public'
  and (
    trigger.event_object_table like 'operation_%'
    or trigger.trigger_name = 'profiles_sync_operation_membership'
  )
order by trigger.event_object_table, trigger.trigger_name, trigger.event_manipulation;

select
  policy.tablename,
  policy.policyname,
  policy.cmd,
  policy.roles,
  policy.qual,
  policy.with_check
from pg_policies policy
where policy.schemaname = 'public'
  and (
    policy.tablename like 'operation_%'
    or policy.tablename = 'entity_audit_events'
  )
order by policy.tablename, policy.policyname;

select
  column_info.table_name,
  column_info.column_name,
  column_info.data_type,
  column_info.is_nullable,
  column_info.column_default
from information_schema.columns column_info
where column_info.table_schema = 'public'
  and (
    column_info.table_name like 'operation_%'
    or column_info.table_name = 'entity_audit_events'
  )
order by column_info.table_name, column_info.ordinal_position;

with state as (
  select
    count(*) filter (
      where expected.layer = 'foundation'
        and to_regclass('public.' || expected.name) is not null
    ) as foundation_existing_count,
    count(*) filter (
      where expected.layer = 'foundation'
    ) as foundation_expected_count,
    count(*) filter (
      where expected.layer = 'schedule'
        and to_regclass('public.' || expected.name) is not null
    ) as schedule_existing_count,
    count(*) filter (
      where expected.layer = 'schedule'
    ) as schedule_expected_count
  from (
    values
      ('operation_memberships', 'foundation'),
      ('operation_calendars', 'foundation'),
      ('operation_schedule_types', 'foundation'),
      ('entity_audit_events', 'foundation'),
      ('operation_schedule_series', 'schedule'),
      ('operation_schedules', 'schedule'),
      ('operation_schedule_assignees', 'schedule'),
      ('operation_schedule_customers', 'schedule'),
      ('operation_schedule_dogs', 'schedule')
  ) expected(name, layer)
)
select
  foundation_existing_count,
  foundation_expected_count,
  schedule_existing_count,
  schedule_expected_count,
  case
    when foundation_existing_count <> foundation_expected_count
      then 'STOP_FOUNDATION_INCOMPLETE'
    when schedule_existing_count = 0
      then 'FOUNDATION_READY'
    when schedule_existing_count = schedule_expected_count
      then 'SCHEDULE_TABLES_PRESENT_REVIEW_RPC_STATE'
    else 'PARTIAL_SCHEDULE_STOP_AND_REVIEW'
  end as migration_state
from state;

select
  exists (
    select 1
    from pg_proc procedure
    join pg_namespace namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = 'record_operation_audit_event'
  ) as audit_function_exists,
  coalesce((
    select
      pg_get_functiondef(procedure.oid) like '%after_row ->> ''profile_id''%'
      and pg_get_functiondef(procedure.oid) like '%after_row ->> ''id''%'
    from pg_proc procedure
    join pg_namespace namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = 'record_operation_audit_event'
    order by procedure.oid desc
    limit 1
  ), false) as supports_profile_id_and_id;

select
  table_name,
  table_type
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'sales',
    'sale_payments',
    'sale_refunds',
    'sale_history',
    'customers',
    'dogs'
  )
order by table_name;
