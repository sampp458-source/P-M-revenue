-- 202607280001_operations_foundation.sql 적용 후 읽기 전용 검증

select
  table_name,
  is_insertable_into
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'operation_memberships',
    'operation_calendars',
    'operation_schedule_types',
    'entity_audit_events'
  )
order by table_name;

select
  profile.id as profile_id,
  profile.name,
  profile.account_status,
  profile.is_active as profile_active,
  membership.role,
  membership.is_active as operation_active
from public.profiles profile
left join public.operation_memberships membership
  on membership.profile_id = profile.id
where profile.account_status = 'active'
  and profile.is_active = true
order by profile.name, profile.id;

select
  calendar.id,
  calendar.name,
  calendar.scope_type,
  unit.code as business_unit_code,
  unit.name as business_unit_name,
  calendar.color,
  calendar.is_active,
  calendar.sort_order,
  calendar.created_by
from public.operation_calendars calendar
left join public.business_units unit
  on unit.id = calendar.business_unit_id
order by calendar.sort_order, calendar.name;

select
  schedule_type.id,
  schedule_type.name,
  schedule_type.color,
  schedule_type.is_active,
  schedule_type.sort_order,
  schedule_type.created_by
from public.operation_schedule_types schedule_type
order by schedule_type.sort_order, schedule_type.name;

select
  schemaname,
  tablename,
  policyname,
  cmd,
  roles,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename in (
    'operation_memberships',
    'operation_calendars',
    'operation_schedule_types',
    'entity_audit_events'
  )
order by tablename, policyname;

select
  namespace.nspname as schema_name,
  procedure.proname as function_name,
  pg_get_function_identity_arguments(procedure.oid) as arguments,
  procedure.prosecdef as security_definer
from pg_proc procedure
join pg_namespace namespace
  on namespace.oid = procedure.pronamespace
where namespace.nspname = 'public'
  and procedure.proname in (
    'is_active_operation_member',
    'has_operation_role',
    'sync_operation_membership_from_profile',
    'protect_operation_setting_metadata',
    'record_operation_audit_event'
  )
order by procedure.proname;

select
  event.module_code,
  event.entity_type,
  event.action,
  count(*) as event_count
from public.entity_audit_events event
where event.module_code = 'operations'
group by event.module_code, event.entity_type, event.action
order by event.entity_type, event.action;
