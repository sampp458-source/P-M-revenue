-- Today 취소 일정 표시 적용 후 읽기 전용 점검

select
  pg_get_functiondef(procedure.oid)
    not like '%schedule.status <> ''cancelled''%'
      as cancelled_is_visible,
  pg_get_functiondef(procedure.oid)
    like '%schedule.archived_at is null%'
      as archived_is_still_excluded,
  has_function_privilege(
    'authenticated',
    'public.get_operation_schedules_for_day(date)',
    'EXECUTE'
  ) as authenticated_can_call_today_rpc
from pg_proc procedure
join pg_namespace namespace
  on namespace.oid = procedure.pronamespace
where namespace.nspname = 'public'
  and procedure.proname = 'get_operation_schedules_for_day';

select
  (select count(*) from public.sales) as finance_sales_rows,
  (select count(*) from public.sale_payments) as finance_payment_rows,
  (select count(*) from public.sale_refunds) as finance_refund_rows;
