-- Operations 운영 적용 후 읽기 전용 검증

do $$
declare
  missing_objects text;
begin
  select string_agg(expected.name, ', ' order by expected.name)
  into missing_objects
  from (
    values
      ('operation_memberships'),
      ('operation_calendars'),
      ('operation_schedule_types'),
      ('entity_audit_events'),
      ('operation_schedules'),
      ('operation_schedule_assignees'),
      ('operation_schedule_customers'),
      ('operation_schedule_dogs')
  ) expected(name)
  where to_regclass('public.' || expected.name) is null;

  if missing_objects is not null then
    raise exception 'Operations 필수 테이블 누락: %', missing_objects;
  end if;
end;
$$;

with required_columns(table_name, column_name) as (
  values
    ('operation_memberships', 'profile_id'),
    ('operation_memberships', 'role'),
    ('operation_memberships', 'is_active'),
    ('operation_calendars', 'id'),
    ('operation_calendars', 'scope_type'),
    ('operation_calendars', 'business_unit_id'),
    ('operation_schedule_types', 'id'),
    ('operation_schedules', 'id'),
    ('operation_schedules', 'calendar_id'),
    ('operation_schedules', 'schedule_type_id'),
    ('operation_schedules', 'starts_at'),
    ('operation_schedules', 'ends_at'),
    ('operation_schedules', 'status'),
    ('operation_schedules', 'version'),
    ('operation_schedules', 'request_id'),
    ('operation_schedules', 'updated_by'),
    ('operation_schedules', 'archived_at'),
    ('operation_schedule_assignees', 'schedule_id'),
    ('operation_schedule_assignees', 'profile_id'),
    ('operation_schedule_customers', 'schedule_id'),
    ('operation_schedule_customers', 'customer_id'),
    ('operation_schedule_dogs', 'schedule_id'),
    ('operation_schedule_dogs', 'dog_id'),
    ('entity_audit_events', 'entity_id'),
    ('entity_audit_events', 'changed_by'),
    ('entity_audit_events', 'request_id')
)
select
  required.table_name,
  required.column_name
from required_columns required
left join information_schema.columns actual
  on actual.table_schema = 'public'
 and actual.table_name = required.table_name
 and actual.column_name = required.column_name
where actual.column_name is null
order by required.table_name, required.column_name;

select
  table_info.relname as table_name,
  table_info.relrowsecurity as rls_enabled
from pg_class table_info
join pg_namespace namespace
  on namespace.oid = table_info.relnamespace
where namespace.nspname = 'public'
  and table_info.relname in (
    'operation_memberships',
    'operation_calendars',
    'operation_schedule_types',
    'entity_audit_events',
    'operation_schedules',
    'operation_schedule_assignees',
    'operation_schedule_customers',
    'operation_schedule_dogs'
  )
order by table_info.relname;

select
  constraint_info.table_name,
  constraint_info.constraint_name,
  constraint_info.constraint_type
from information_schema.table_constraints constraint_info
where constraint_info.table_schema = 'public'
  and constraint_info.table_name in (
    'operation_memberships',
    'operation_calendars',
    'operation_schedule_types',
    'operation_schedules',
    'operation_schedule_assignees',
    'operation_schedule_customers',
    'operation_schedule_dogs'
  )
  and constraint_info.constraint_type in (
    'PRIMARY KEY',
    'FOREIGN KEY',
    'UNIQUE',
    'CHECK'
  )
order by constraint_info.table_name, constraint_info.constraint_type,
  constraint_info.constraint_name;

select
  index_info.tablename,
  index_info.indexname,
  index_info.indexdef
from pg_indexes index_info
where index_info.schemaname = 'public'
  and index_info.tablename like 'operation_%'
order by index_info.tablename, index_info.indexname;

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
order by trigger.event_object_table, trigger.trigger_name,
  trigger.event_manipulation;

select
  procedure.proname as function_name,
  pg_get_function_identity_arguments(procedure.oid) as arguments,
  procedure.prosecdef as security_definer,
  has_function_privilege(
    'authenticated',
    procedure.oid,
    'EXECUTE'
  ) as authenticated_can_execute,
  has_function_privilege(
    'anon',
    procedure.oid,
    'EXECUTE'
  ) as anon_can_execute
from pg_proc procedure
join pg_namespace namespace
  on namespace.oid = procedure.pronamespace
where namespace.nspname = 'public'
  and procedure.proname in (
    'is_active_operation_member',
    'has_operation_role',
    'get_operation_schedules_for_day',
    'create_operation_schedule',
    'update_operation_schedule',
    'set_operation_schedule_status',
    'archive_operation_schedule'
  )
order by procedure.proname;

select
  pg_get_functiondef(procedure.oid)
    like '%cardinality(coalesce(p_assignee_ids, ''{}''::uuid[])) = 0%'
      as at_least_one_assignee_required,
  pg_get_functiondef(procedure.oid)
    like '%profile.account_status is distinct from ''active''%'
      as inactive_profile_rejected,
  pg_get_functiondef(procedure.oid)
    like '%left join public.operation_memberships membership%'
      as membership_is_checked,
  pg_get_functiondef(procedure.oid)
    like '%membership.is_active is distinct from true%'
      as inactive_membership_rejected
from pg_proc procedure
join pg_namespace namespace
  on namespace.oid = procedure.pronamespace
where namespace.nspname = 'public'
  and procedure.proname = 'assert_operation_schedule_input'
order by procedure.oid desc
limit 1;

select
  table_info.table_name,
  has_table_privilege(
    'authenticated',
    format('public.%I', table_info.table_name),
    'INSERT'
  ) as authenticated_can_insert_directly,
  has_table_privilege(
    'authenticated',
    format('public.%I', table_info.table_name),
    'UPDATE'
  ) as authenticated_can_update_directly,
  has_table_privilege(
    'authenticated',
    format('public.%I', table_info.table_name),
    'DELETE'
  ) as authenticated_can_delete_directly
from (
  values
    ('operation_schedules'),
    ('operation_schedule_assignees'),
    ('operation_schedule_customers'),
    ('operation_schedule_dogs')
) table_info(table_name)
order by table_info.table_name;

select
  procedure.proname as function_name,
  pg_get_functiondef(procedure.oid)
    like '%(p_starts_at at time zone ''Asia/Seoul'')::time <> time ''00:00''%'
      as all_day_start_is_seoul_midnight,
  pg_get_functiondef(procedure.oid)
    like '%(p_ends_at at time zone ''Asia/Seoul'')::time <> time ''00:00''%'
      as all_day_end_is_seoul_midnight,
  pg_get_functiondef(procedure.oid)
    like '%(p_starts_at at time zone ''Asia/Seoul'')::date + 1%'
      as all_day_end_is_exclusive_next_day
from pg_proc procedure
join pg_namespace namespace
  on namespace.oid = procedure.pronamespace
where namespace.nspname = 'public'
  and procedure.proname in (
    'create_operation_schedule',
    'update_operation_schedule'
  )
order by procedure.proname;

select
  pg_get_functiondef(procedure.oid)
    like '%after_row ->> ''profile_id''%' as supports_membership_profile_id,
  pg_get_functiondef(procedure.oid)
    like '%after_row ->> ''id''%' as supports_standard_id,
  pg_get_functiondef(procedure.oid)
    like '%after_row ->> ''schedule_id''%' as supports_schedule_id_fallback
from pg_proc procedure
join pg_namespace namespace
  on namespace.oid = procedure.pronamespace
where namespace.nspname = 'public'
  and procedure.proname = 'record_operation_audit_event';

select
  pg_get_functiondef(procedure.oid)
    like '%tg_table_name = ''operation_schedules''%'
      as request_id_is_limited_to_schedule_root,
  pg_get_functiondef(procedure.oid)
    like '%parsed_request_id := null%'
      as link_audit_request_id_is_null,
  (
    pg_get_functiondef(procedure.oid) like '%to_jsonb(new)%'
    and (
      select count(*)
      from information_schema.columns column_info
      where column_info.table_schema = 'public'
        and column_info.table_name in (
          'operation_schedule_assignees',
          'operation_schedule_customers',
          'operation_schedule_dogs'
        )
        and column_info.column_name = 'schedule_id'
    ) = 3
  ) as link_after_data_keeps_schedule_id
from pg_proc procedure
join pg_namespace namespace
  on namespace.oid = procedure.pronamespace
where namespace.nspname = 'public'
  and procedure.proname = 'record_operation_schedule_audit_event';

with request_id_attribute as (
  select
    attribute.attnum,
    not attribute.attnotnull as is_nullable
  from pg_attribute attribute
  where attribute.attrelid = 'public.entity_audit_events'::regclass
    and attribute.attname = 'request_id'
    and attribute.attisdropped = false
)
select
  attribute.is_nullable as request_id_is_nullable,
  exists (
    select 1
    from pg_index index_info
    where index_info.indrelid = 'public.entity_audit_events'::regclass
      and index_info.indisunique = true
      and index_info.indnkeyatts = 1
      and attribute.attnum = any(index_info.indkey)
  ) as request_id_unique_is_preserved,
  attribute.is_nullable
  and exists (
    select 1
    from pg_index index_info
    where index_info.indrelid = 'public.entity_audit_events'::regclass
      and index_info.indisunique = true
      and index_info.indnkeyatts = 1
      and attribute.attnum = any(index_info.indkey)
  ) as one_root_and_multiple_null_link_audits_are_supported
from request_id_attribute attribute;

select
  procedure.proname as function_name,
  case
    when procedure.proname = 'create_operation_schedule' then
      pg_get_functiondef(procedure.oid)
        like '%schedule.request_id = p_request_id%'
    else
      pg_get_functiondef(procedure.oid)
        like '%audit.entity_type = ''operation_schedules''%'
      and pg_get_functiondef(procedure.oid)
        like '%audit.request_id = p_request_id%'
  end as root_request_idempotency_lookup_is_valid
from pg_proc procedure
join pg_namespace namespace
  on namespace.oid = procedure.pronamespace
where namespace.nspname = 'public'
  and procedure.proname in (
    'create_operation_schedule',
    'update_operation_schedule',
    'set_operation_schedule_status',
    'archive_operation_schedule'
  )
order by procedure.proname;

select
  pg_get_functiondef(procedure.oid)
    like '%schedule_row.status = ''scheduled''%'
      as scheduled_transition_is_guarded,
  pg_get_functiondef(procedure.oid)
    like '%schedule_row.status = ''completed''%'
      as completed_transition_is_guarded,
  pg_get_functiondef(procedure.oid)
    like '%schedule_row.status = ''cancelled''%'
      as cancelled_is_terminal,
  pg_get_functiondef(procedure.oid)
    not like '%p_status = ''scheduled''%'
      as no_restore_transition_is_exposed
from pg_proc procedure
join pg_namespace namespace
  on namespace.oid = procedure.pronamespace
where namespace.nspname = 'public'
  and procedure.proname = 'set_operation_schedule_status';

select
  count(*) filter (
    where profile.is_active = true
      and profile.account_status = 'active'
  ) as active_profiles,
  count(*) filter (
    where profile.is_active = true
      and profile.account_status = 'active'
      and membership.profile_id is not null
      and membership.is_active = true
  ) as active_operation_members,
  count(*) filter (
    where profile.is_active = true
      and profile.account_status = 'active'
      and membership.profile_id is null
  ) as missing_memberships
from public.profiles profile
left join public.operation_memberships membership
  on membership.profile_id = profile.id;

select
  calendar.name,
  calendar.scope_type,
  unit.code as business_unit_code,
  calendar.is_active,
  calendar.sort_order
from public.operation_calendars calendar
left join public.business_units unit
  on unit.id = calendar.business_unit_id
order by calendar.sort_order, calendar.name;

select
  schedule_type.name,
  schedule_type.is_active,
  schedule_type.sort_order
from public.operation_schedule_types schedule_type
order by schedule_type.sort_order, schedule_type.name;

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
