select
  to_regclass('public.sales') is not null as sales_exists,
  to_regclass('public.sale_payments') is not null as sale_payments_exists,
  to_regclass('public.sale_refunds') is not null as sale_refunds_exists,
  to_regclass('public.sale_history') is not null as sale_history_exists,
  to_regclass('public.monthly_targets') is not null as monthly_targets_exists,
  to_regprocedure('public.is_active_user()') is not null as is_active_user_exists,
  to_regprocedure('public.is_admin()') is not null as is_admin_exists,
  to_regprocedure('public.get_staff_finance_day(date)') is not null
    as daily_rpc_already_exists;

select
  policy_info.tablename,
  policy_info.policyname,
  policy_info.cmd,
  policy_info.roles,
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
  (select count(*) from public.sales) as sales_count,
  (select count(*) from public.sale_payments) as sale_payments_count,
  (select count(*) from public.sale_refunds) as sale_refunds_count,
  (select count(*) from public.sale_history) as sale_history_count;
