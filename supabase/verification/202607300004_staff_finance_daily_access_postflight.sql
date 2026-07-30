select
  to_regprocedure('public.get_staff_finance_day(date)') is not null
    as daily_rpc_exists,
  has_function_privilege(
    'authenticated',
    'public.get_staff_finance_day(date)',
    'EXECUTE'
  ) as authenticated_can_execute_daily_rpc;

select
  policy_info.tablename,
  policy_info.policyname,
  policy_info.cmd,
  policy_info.roles,
  policy_info.qual,
  (
    policy_info.qual ilike '%is_admin%'
    and policy_info.qual not ilike '%is_active_user()%'
  ) as company_wide_staff_access_removed
from pg_policies policy_info
where policy_info.schemaname = 'public'
  and (
    (policy_info.tablename = 'sales' and policy_info.policyname = 'sales_select')
    or (policy_info.tablename = 'sale_payments' and policy_info.policyname = 'sale_payments_select')
    or (policy_info.tablename = 'sale_refunds' and policy_info.policyname = 'sale_refunds_select_active')
    or (policy_info.tablename = 'sale_history' and policy_info.policyname = 'sale_history_select')
    or (policy_info.tablename = 'monthly_targets' and policy_info.policyname = 'targets_select')
  )
order by policy_info.tablename;

select
  trigger_info.tgname,
  pg_get_triggerdef(trigger_info.oid) as trigger_definition
from pg_trigger trigger_info
where trigger_info.tgrelid = 'public.sales'::regclass
  and not trigger_info.tgisinternal
order by trigger_info.tgname;

select
  position(
    'new.staff_id := auth.uid()'
    in pg_get_functiondef('public.prepare_sale()'::regprocedure)
  ) > 0 as staff_id_is_forced_for_non_admin;
