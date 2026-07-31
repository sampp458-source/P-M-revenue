select
  to_regprocedure('public.get_staff_finance_day(date)') is not null
    as daily_rpc_exists,
  has_function_privilege(
    'authenticated',
    'public.get_staff_finance_day(date)',
    'EXECUTE'
  ) as authenticated_can_execute_daily_rpc,
  position(
    '''outstanding_sales'''
    in pg_get_functiondef('public.get_staff_finance_day(date)'::regprocedure)
  ) > 0 as outstanding_payload_exists,
  position(
    'sale.status <> ''cancelled'''
    in pg_get_functiondef('public.get_staff_finance_day(date)'::regprocedure)
  ) > 0 as cancelled_sales_excluded,
  position(
    'sale.cancellation_type is distinct from ''entry_error'''
    in pg_get_functiondef('public.get_staff_finance_day(date)'::regprocedure)
  ) > 0 as entry_error_sales_excluded,
  position(
    'sale.outstanding_amount > 0'
    in pg_get_functiondef('public.get_staff_finance_day(date)'::regprocedure)
  ) > 0 as positive_outstanding_only,
  position(
    'order by sale.sale_date, sale.created_at, sale.id'
    in pg_get_functiondef('public.get_staff_finance_day(date)'::regprocedure)
  ) > 0 as oldest_outstanding_first,
  position(
    '''customer_id'', sale.customer_id'
    in pg_get_functiondef('public.get_staff_finance_day(date)'::regprocedure)
  ) > 0 as customer_navigation_id_exists,
  position(
    '''dog_id'', sale.dog_id'
    in pg_get_functiondef('public.get_staff_finance_day(date)'::regprocedure)
  ) > 0 as dog_navigation_id_exists;

select
  pg_get_functiondef('public.get_staff_finance_day(date)'::regprocedure)
    as applied_daily_rpc_definition;

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

select
  count(*) as current_outstanding_count,
  coalesce(sum(sale.outstanding_amount), 0) as current_outstanding_amount
from public.sales sale
where sale.status <> 'cancelled'
  and sale.cancellation_type is distinct from 'entry_error'
  and sale.outstanding_amount > 0;

select
  (select count(*) from public.sales) as sales_count,
  (select count(*) from public.sale_payments) as sale_payments_count,
  (select count(*) from public.sale_refunds) as sale_refunds_count,
  (select count(*) from public.sale_history) as sale_history_count;
