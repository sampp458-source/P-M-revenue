-- Operations 담당자별 일정 색상 적용 후 읽기 전용 점검

select
  exists (
    select 1
    from information_schema.columns column_info
    where column_info.table_schema = 'public'
      and column_info.table_name = 'operation_memberships'
      and column_info.column_name = 'schedule_color'
      and column_info.data_type = 'text'
      and column_info.is_nullable = 'YES'
  ) as nullable_schedule_color_exists,
  exists (
    select 1
    from pg_constraint constraint_info
    where constraint_info.conrelid =
      'public.operation_memberships'::regclass
      and constraint_info.conname =
        'operation_memberships_schedule_color_check'
  ) as schedule_color_check_exists,
  to_regprocedure('public.get_active_operation_assignees()') is not null
    as assignee_rpc_exists,
  to_regprocedure(
    'public.set_operation_member_schedule_color(uuid,text,timestamp with time zone,uuid)'
  ) is not null as color_rpc_exists;

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
    'public.operation_memberships',
    'UPDATE'
  ) as direct_membership_update_is_blocked;

select
  membership.profile_id,
  profile.name,
  membership.role,
  membership.is_active,
  membership.schedule_color,
  membership.schedule_color is null
    or membership.schedule_color ~ '^#[0-9A-Fa-f]{6}$'
    as schedule_color_is_valid
from public.operation_memberships membership
join public.profiles profile
  on profile.id = membership.profile_id
order by profile.name nulls last, membership.profile_id;

select
  pg_get_functiondef(procedure.oid)
    like '%caller.role = ''admin''%'
      as admin_only_change_is_enforced,
  pg_get_functiondef(procedure.oid)
    like '%caller.id = auth.uid()%'
      as caller_identity_is_enforced,
  pg_get_functiondef(procedure.oid)
    like '%set schedule_color = normalized_color%'
      as color_update_is_scoped_to_membership
from pg_proc procedure
join pg_namespace namespace
  on namespace.oid = procedure.pronamespace
where namespace.nspname = 'public'
  and procedure.proname = 'set_operation_member_schedule_color';

select
  (select count(*) from public.sales) as finance_sales_rows,
  (select count(*) from public.sale_payments) as finance_payment_rows,
  (select count(*) from public.sale_refunds) as finance_refund_rows,
  (
    select count(*)
    from public.operation_memberships membership
    join public.profiles profile
      on profile.id = membership.profile_id
    where membership.role = 'owner'
      and membership.is_active = true
      and profile.is_active = true
      and profile.account_status = 'active'
  ) as active_owner_count;
