-- Operations 일정 사용성 확장 적용 후 읽기 전용 점검

select
  to_regclass('public.operation_calendar_schedule_types') is not null
    as mapping_table_exists,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'operation_memberships'
      and column_name = 'schedule_color'
      and is_nullable = 'YES'
  ) as nullable_schedule_color_exists,
  to_regprocedure('public.get_active_operation_assignees()') is not null
    as assignee_rpc_exists,
  to_regprocedure(
    'public.set_operation_member_schedule_color(uuid,text,timestamp with time zone,uuid)'
  ) is not null as color_rpc_exists;

select
  mapping.calendar_id,
  calendar.name as calendar_name,
  mapping.schedule_type_id,
  schedule_type.name as schedule_type_name,
  mapping.is_active,
  mapping.sort_order
from public.operation_calendar_schedule_types mapping
join public.operation_calendars calendar on calendar.id = mapping.calendar_id
join public.operation_schedule_types schedule_type
  on schedule_type.id = mapping.schedule_type_id
where mapping.archived_at is null
order by calendar.sort_order, mapping.sort_order, schedule_type.name;

select
  membership.profile_id,
  profile.name,
  membership.role,
  membership.is_active,
  membership.schedule_color,
  membership.schedule_color is null
    or membership.schedule_color ~ '^#[0-9A-Fa-f]{6}$'
    as color_is_valid
from public.operation_memberships membership
join public.profiles profile on profile.id = membership.profile_id
order by profile.name nulls last;

select
  pg_get_functiondef(procedure.oid)
    like '%operation_calendar_schedule_types%'
      as calendar_type_mapping_is_enforced,
  pg_get_functiondef(procedure.oid)
    like '%membership.is_active is distinct from true%'
      as active_membership_is_enforced
from pg_proc procedure
join pg_namespace namespace on namespace.oid = procedure.pronamespace
where namespace.nspname = 'public'
  and procedure.proname = 'assert_operation_schedule_input';

select
  has_function_privilege(
    'authenticated',
    'public.get_active_operation_assignees()',
    'EXECUTE'
  ) as authenticated_can_read_assignees,
  has_function_privilege(
    'authenticated',
    'public.set_operation_member_schedule_color(uuid,text,timestamp with time zone,uuid)',
    'EXECUTE'
  ) as authenticated_can_call_color_rpc,
  not has_table_privilege(
    'authenticated',
    'public.operation_calendar_schedule_types',
    'INSERT'
  ) as direct_mapping_insert_is_blocked,
  not has_table_privilege(
    'authenticated',
    'public.operation_calendar_schedule_types',
    'UPDATE'
  ) as direct_mapping_update_is_blocked;

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
