-- 직원 Finance 단일 날짜 조회 RPC
-- 운영 Supabase에는 자동 적용하지 않는다.

begin;

do $$
begin
  if to_regclass('public.sales') is null
    or to_regclass('public.sale_payments') is null
    or to_regclass('public.sale_refunds') is null
    or to_regclass('public.sale_history') is null
    or to_regclass('public.monthly_targets') is null
    or to_regprocedure('public.is_active_user()') is null
    or to_regprocedure('public.is_admin()') is null
  then
    raise exception 'Finance 필수 객체 또는 권한 함수를 확인할 수 없습니다.';
  end if;

  if not exists (
    select 1
    from pg_trigger trigger_info
    where trigger_info.tgrelid = 'public.sales'::regclass
      and trigger_info.tgname = 'sales_prepare_before_write'
      and not trigger_info.tgisinternal
  ) then
    raise exception '직원 담당자를 강제하는 sales_prepare_before_write Trigger를 확인할 수 없습니다.';
  end if;
end;
$$;

create or replace function public.get_staff_finance_day(
  p_date date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  result jsonb;
begin
  if not public.is_active_user() then
    raise exception 'Finance 조회 권한이 없습니다.'
      using errcode = '42501';
  end if;

  if p_date is null then
    raise exception '조회 날짜가 필요합니다.'
      using errcode = '22023';
  end if;

  with relevant_sales as (
    select sale.id
    from public.sales sale
    where sale.sale_date = p_date
       or exists (
         select 1
         from public.sale_payments payment
         where payment.sale_id = sale.id
           and payment.payment_date = p_date
           and payment.voided_at is null
       )
       or exists (
         select 1
         from public.sale_refunds refund
         where refund.sale_id = sale.id
           and refund.refund_date = p_date
           and refund.voided_at is null
       )
  )
  select jsonb_build_object(
    'sales',
      coalesce((
        select jsonb_agg(to_jsonb(sale) order by sale.sale_date desc, sale.created_at desc, sale.id)
        from public.sales sale
        join relevant_sales relevant on relevant.id = sale.id
      ), '[]'::jsonb),
    'payments',
      coalesce((
        select jsonb_agg(to_jsonb(payment) order by payment.payment_date, payment.created_at, payment.id)
        from public.sale_payments payment
        join relevant_sales relevant on relevant.id = payment.sale_id
      ), '[]'::jsonb),
    'refunds',
      coalesce((
        select jsonb_agg(to_jsonb(refund) order by refund.refund_date, refund.created_at, refund.id)
        from public.sale_refunds refund
        join relevant_sales relevant on relevant.id = refund.sale_id
      ), '[]'::jsonb),
    'outstanding_sales',
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'sale_id', sale.id,
            'customer_id', sale.customer_id,
            'customer_name', sale.customer_name,
            'customer_phone', sale.customer_phone,
            'dog_id', sale.dog_id,
            'dog_name', sale.dog_name,
            'outstanding_amount', sale.outstanding_amount,
            'outstanding_date', sale.sale_date,
            'business_unit_id', sale.business_unit_id,
            'business_unit_name', sale.business_unit_name
          )
          order by sale.sale_date, sale.created_at, sale.id
        )
        from public.sales sale
        where sale.status <> 'cancelled'
          and sale.cancellation_type is distinct from 'entry_error'
          and sale.outstanding_amount > 0
      ), '[]'::jsonb)
  )
  into result;

  return result;
end;
$$;

revoke all on function public.get_staff_finance_day(date)
  from public, anon;
grant execute on function public.get_staff_finance_day(date)
  to authenticated;

commit;
