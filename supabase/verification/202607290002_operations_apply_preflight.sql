-- Operations Single Schedule 적용 전 읽기 전용 점검
-- 모든 결과를 확인하고 preflight_status = READY인 경우에만 Migration을 적용한다.

with required_objects(object_type, object_name, object_exists) as (
  values
    (
      'table',
      'operation_memberships',
      to_regclass('public.operation_memberships') is not null
    ),
    (
      'table',
      'operation_calendars',
      to_regclass('public.operation_calendars') is not null
    ),
    (
      'table',
      'operation_schedule_types',
      to_regclass('public.operation_schedule_types') is not null
    ),
    (
      'table',
      'entity_audit_events',
      to_regclass('public.entity_audit_events') is not null
    ),
    (
      'function',
      'set_updated_at()',
      to_regprocedure('public.set_updated_at()') is not null
    ),
    (
      'function',
      'is_active_operation_member()',
      to_regprocedure('public.is_active_operation_member()') is not null
    )
)
select *
from required_objects
order by object_type, object_name;

with required_columns(table_name, column_name) as (
  values
    ('profiles', 'is_active'),
    ('profiles', 'account_status'),
    ('customers', 'is_active'),
    ('dogs', 'is_active'),
    ('entity_audit_events', 'request_id')
)
select
  required.table_name,
  required.column_name,
  actual.column_name is not null as column_exists,
  actual.data_type,
  actual.is_nullable
from required_columns required
left join information_schema.columns actual
  on actual.table_schema = 'public'
 and actual.table_name = required.table_name
 and actual.column_name = required.column_name
order by required.table_name, required.column_name;

with expected_schedule_tables(name) as (
  values
    ('operation_schedules'),
    ('operation_schedule_assignees'),
    ('operation_schedule_customers'),
    ('operation_schedule_dogs')
)
select
  expected.name as table_name,
  to_regclass('public.' || expected.name) is not null as already_exists
from expected_schedule_tables expected
order by expected.name;

with expected_schedule_functions(name) as (
  values
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
  expected.name as function_name,
  coalesce(actual.existing_overload_count, 0) as existing_overload_count
from expected_schedule_functions expected
left join (
  select
    procedure.proname,
    count(*) as existing_overload_count
  from pg_proc procedure
  join pg_namespace namespace
    on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public'
  group by procedure.proname
) actual on actual.proname = expected.name
order by expected.name;

select
  trigger.event_object_table as table_name,
  trigger.trigger_name,
  trigger.action_timing,
  trigger.event_manipulation
from information_schema.triggers trigger
where trigger.trigger_schema = 'public'
  and (
    trigger.event_object_table in (
      'operation_schedules',
      'operation_schedule_assignees',
      'operation_schedule_customers',
      'operation_schedule_dogs'
    )
    or trigger.trigger_name in (
      'operation_schedules_protect_metadata',
      'operation_schedules_updated_at',
      'operation_schedules_audit',
      'operation_schedules_block_delete',
      'operation_schedule_assignees_protect_metadata',
      'operation_schedule_assignees_updated_at',
      'operation_schedule_assignees_audit',
      'operation_schedule_assignees_block_delete',
      'operation_schedule_customers_protect_metadata',
      'operation_schedule_customers_updated_at',
      'operation_schedule_customers_audit',
      'operation_schedule_customers_block_delete',
      'operation_schedule_dogs_protect_metadata',
      'operation_schedule_dogs_updated_at',
      'operation_schedule_dogs_audit',
      'operation_schedule_dogs_block_delete'
    )
  )
order by trigger.event_object_table, trigger.trigger_name,
  trigger.event_manipulation;

select
  constraint_info.conname as constraint_name,
  constraint_info.contype as constraint_type,
  pg_get_constraintdef(constraint_info.oid) as definition
from pg_constraint constraint_info
where constraint_info.conrelid = 'public.entity_audit_events'::regclass
  and constraint_info.contype in ('p', 'u')
order by constraint_info.conname;

select
  index_info.indexname,
  index_info.indexdef,
  index_info.indexdef ilike 'create unique index%' as is_unique
from pg_indexes index_info
where index_info.schemaname = 'public'
  and index_info.tablename = 'entity_audit_events'
  and index_info.indexdef ilike '%request_id%'
order by index_info.indexname;

with request_id_attribute as (
  select
    attribute.attnum,
    not attribute.attnotnull as is_nullable
  from pg_attribute attribute
  where attribute.attrelid = 'public.entity_audit_events'::regclass
    and attribute.attname = 'request_id'
    and attribute.attisdropped = false
),
audit_request_id_state as (
  select
    attribute.is_nullable,
    exists (
      select 1
      from pg_constraint constraint_info
      where constraint_info.conrelid =
        'public.entity_audit_events'::regclass
        and constraint_info.contype = 'u'
        and constraint_info.conkey = array[attribute.attnum]::smallint[]
    ) as has_single_column_unique_constraint,
    exists (
      select 1
      from pg_index index_info
      where index_info.indrelid = 'public.entity_audit_events'::regclass
        and index_info.indisunique = true
        and index_info.indnkeyatts = 1
        and attribute.attnum = any(index_info.indkey)
    ) as has_single_column_unique_index
  from request_id_attribute attribute
)
select
  is_nullable,
  has_single_column_unique_constraint,
  has_single_column_unique_index,
  is_nullable
  and (
    has_single_column_unique_constraint
    or has_single_column_unique_index
  ) as root_only_audit_strategy_is_compatible
from audit_request_id_state;

select
  case
    when to_regprocedure(
      'public.record_operation_schedule_audit_event()'
    ) is null
      then 'NOT_APPLIED_ROOT_ONLY_PACKAGE_COMPATIBLE'
    when pg_get_functiondef(
      to_regprocedure('public.record_operation_schedule_audit_event()')
    ) like '%tg_table_name = ''operation_schedules''%'
      and pg_get_functiondef(
        to_regprocedure('public.record_operation_schedule_audit_event()')
      ) like '%parsed_request_id := null%'
      then 'APPLIED_ROOT_ONLY_STRATEGY_CONFIRMED'
    else 'EXISTING_FUNCTION_REQUIRES_REVIEW'
  end as schedule_audit_function_state;

select
  to_regclass('public.sales') is not null as sales_exists,
  to_regclass('public.sale_payments') is not null as sale_payments_exists,
  to_regclass('public.sale_refunds') is not null as sale_refunds_exists,
  to_regclass('public.sale_history') is not null as sale_history_exists;

select
  (select count(*) from public.sales) as sales_rows,
  (select count(*) from public.sale_payments) as sale_payment_rows,
  (select count(*) from public.sale_refunds) as sale_refund_rows,
  (select count(*) from public.sale_history) as sale_history_rows;

select
  (select count(*) from public.operation_memberships) as membership_rows,
  (
    select count(*)
    from public.operation_memberships membership
    join public.profiles profile on profile.id = membership.profile_id
    where membership.role = 'owner'
      and membership.is_active = true
      and profile.is_active = true
      and profile.account_status = 'active'
  ) as active_owner_rows,
  (select count(*) from public.operation_calendars) as calendar_rows,
  (
    select count(*)
    from public.operation_schedule_types
  ) as schedule_type_rows;

select
  membership.profile_id,
  profile.name,
  membership.role,
  membership.is_active as membership_active,
  profile.is_active as profile_active,
  profile.account_status
from public.operation_memberships membership
join public.profiles profile on profile.id = membership.profile_id
where membership.role = 'owner'
order by profile.name nulls last, membership.profile_id;

with required_foundation as (
  select count(*) filter (where object_exists = false) as missing_count
  from (
    values
      (to_regclass('public.operation_memberships') is not null),
      (to_regclass('public.operation_calendars') is not null),
      (to_regclass('public.operation_schedule_types') is not null),
      (to_regclass('public.entity_audit_events') is not null),
      (to_regprocedure('public.set_updated_at()') is not null),
      (to_regprocedure('public.is_active_operation_member()') is not null)
  ) required(object_exists)
),
required_columns as (
  select count(*) filter (where actual.column_name is null) as missing_count
  from (
    values
      ('profiles', 'is_active'),
      ('profiles', 'account_status'),
      ('customers', 'is_active'),
      ('dogs', 'is_active'),
      ('entity_audit_events', 'request_id')
  ) required(table_name, column_name)
  left join information_schema.columns actual
    on actual.table_schema = 'public'
   and actual.table_name = required.table_name
   and actual.column_name = required.column_name
),
existing_schedule_tables as (
  select count(*) filter (
    where to_regclass('public.' || name) is not null
  ) as existing_count
  from (
    values
      ('operation_schedules'),
      ('operation_schedule_assignees'),
      ('operation_schedule_customers'),
      ('operation_schedule_dogs')
  ) expected(name)
),
existing_schedule_functions as (
  select count(distinct procedure.proname) as existing_count
  from pg_proc procedure
  join pg_namespace namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public'
    and procedure.proname in (
      'protect_operation_schedule_metadata',
      'protect_operation_link_metadata',
      'record_operation_schedule_audit_event',
      'block_operation_schedule_delete',
      'operation_schedule_json',
      'assert_operation_schedule_input',
      'sync_operation_schedule_links',
      'get_operation_schedules_for_day',
      'create_operation_schedule',
      'update_operation_schedule',
      'set_operation_schedule_status',
      'archive_operation_schedule'
    )
),
existing_schedule_triggers as (
  select count(distinct trigger.trigger_name) as existing_count
  from information_schema.triggers trigger
  where trigger.trigger_schema = 'public'
    and (
      trigger.event_object_table in (
        'operation_schedules',
        'operation_schedule_assignees',
        'operation_schedule_customers',
        'operation_schedule_dogs'
      )
      or trigger.trigger_name in (
        'operation_schedules_protect_metadata',
        'operation_schedules_updated_at',
        'operation_schedules_audit',
        'operation_schedules_block_delete',
        'operation_schedule_assignees_protect_metadata',
        'operation_schedule_assignees_updated_at',
        'operation_schedule_assignees_audit',
        'operation_schedule_assignees_block_delete',
        'operation_schedule_customers_protect_metadata',
        'operation_schedule_customers_updated_at',
        'operation_schedule_customers_audit',
        'operation_schedule_customers_block_delete',
        'operation_schedule_dogs_protect_metadata',
        'operation_schedule_dogs_updated_at',
        'operation_schedule_dogs_audit',
        'operation_schedule_dogs_block_delete'
      )
    )
),
audit_request_id_state as (
  select
    not attribute.attnotnull as is_nullable,
    exists (
      select 1
      from pg_index index_info
      where index_info.indrelid = attribute.attrelid
        and index_info.indisunique = true
        and index_info.indnkeyatts = 1
        and attribute.attnum = any(index_info.indkey)
    ) as is_unique
  from pg_attribute attribute
  where attribute.attrelid = 'public.entity_audit_events'::regclass
    and attribute.attname = 'request_id'
    and attribute.attisdropped = false
),
owner_state as (
  select count(*) as active_owner_count
  from public.operation_memberships membership
  join public.profiles profile on profile.id = membership.profile_id
  where membership.role = 'owner'
    and membership.is_active = true
    and profile.is_active = true
    and profile.account_status = 'active'
),
finance_state as (
  select (
    to_regclass('public.sales') is not null
    and to_regclass('public.sale_payments') is not null
    and to_regclass('public.sale_refunds') is not null
    and to_regclass('public.sale_history') is not null
  ) as ready
)
select
  case
    when required_foundation.missing_count > 0
      then 'STOP_FOUNDATION_OBJECT_MISSING'
    when required_columns.missing_count > 0
      then 'STOP_REQUIRED_COLUMN_MISSING'
    when audit_request_id_state.is_nullable = false
      then 'STOP_AUDIT_REQUEST_ID_NOT_NULL'
    when audit_request_id_state.is_unique = false
      then 'STOP_AUDIT_REQUEST_ID_UNIQUE_MISSING'
    when owner_state.active_owner_count = 0
      then 'STOP_ACTIVE_OWNER_MISSING'
    when finance_state.ready = false
      then 'STOP_FINANCE_BASELINE_MISSING'
    when existing_schedule_tables.existing_count > 0
      or existing_schedule_functions.existing_count > 0
      or existing_schedule_triggers.existing_count > 0
      then 'WARNING_EXISTING_SCHEDULE_OBJECTS_REVIEW_REQUIRED'
    else 'READY'
  end as preflight_status,
  required_foundation.missing_count as missing_foundation_objects,
  required_columns.missing_count as missing_required_columns,
  existing_schedule_tables.existing_count as existing_schedule_tables,
  existing_schedule_functions.existing_count as existing_schedule_functions,
  existing_schedule_triggers.existing_count as existing_schedule_triggers,
  audit_request_id_state.is_nullable as audit_request_id_is_nullable,
  audit_request_id_state.is_unique as audit_request_id_is_unique,
  (
    audit_request_id_state.is_nullable
    and audit_request_id_state.is_unique
  ) as root_only_audit_strategy_is_compatible,
  owner_state.active_owner_count,
  finance_state.ready as finance_baseline_ready
from required_foundation
cross join required_columns
cross join existing_schedule_tables
cross join existing_schedule_functions
cross join existing_schedule_triggers
cross join audit_request_id_state
cross join owner_state
cross join finance_state;
