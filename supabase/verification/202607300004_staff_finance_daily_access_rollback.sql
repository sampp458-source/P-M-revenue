-- 수금 대기 응답을 제거하고 기존 004 운영 적용본으로 되돌린다.

begin;

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
