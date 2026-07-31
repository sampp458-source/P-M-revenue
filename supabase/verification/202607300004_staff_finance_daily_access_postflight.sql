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
  policy_info.permissive,
  policy_info.qual
from pg_policies policy_info
where policy_info.schemaname = 'public'
  and policy_info.tablename in (
    'sales',
    'sale_payments',
    'sale_refunds',
    'sale_history',
    'monthly_targets'
  )
  and policy_info.cmd = 'SELECT'
order by policy_info.tablename, policy_info.policyname;

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
