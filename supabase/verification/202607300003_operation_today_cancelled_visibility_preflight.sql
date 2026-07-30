-- Today 취소 일정 표시 적용 전 읽기 전용 점검

select
  to_regclass('public.operation_schedules') is not null
    as operation_schedules_exists,
  to_regprocedure('public.operation_schedule_json(uuid)') is not null
    as schedule_json_function_exists,
  to_regprocedure('public.is_active_operation_member()') is not null
    as active_member_function_exists,
  to_regprocedure('public.get_operation_schedules_for_day(date)') is not null
    as today_rpc_exists;

select
  pg_get_functiondef(procedure.oid)
    like '%schedule.status <> ''cancelled''%'
      as cancelled_is_currently_excluded,
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
  schedule.status,
  count(*) as schedule_count
from public.operation_schedules schedule
where schedule.archived_at is null
group by schedule.status
order by schedule.status;

select
  (select count(*) from public.sales) as finance_sales_rows,
  (select count(*) from public.sale_payments) as finance_payment_rows,
  (select count(*) from public.sale_refunds) as finance_refund_rows;
