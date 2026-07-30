-- 직원 Finance 단일 날짜 조회와 회사 전체 원장 직접 조회 제한
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

drop policy if exists sales_select on public.sales;
create policy sales_select
  on public.sales
  for select
  to authenticated
  using (
    public.is_admin()
    or staff_id = auth.uid()
    or created_by = auth.uid()
  );

drop policy if exists sale_payments_select on public.sale_payments;
create policy sale_payments_select
  on public.sale_payments
  for select
  to authenticated
  using (
    public.is_admin()
    or created_by = auth.uid()
    or exists (
      select 1
      from public.sales sale
      where sale.id = sale_payments.sale_id
        and (sale.staff_id = auth.uid() or sale.created_by = auth.uid())
    )
  );

drop policy if exists sale_refunds_select_active on public.sale_refunds;
create policy sale_refunds_select_active
  on public.sale_refunds
  for select
  to authenticated
  using (
    public.is_admin()
    or exists (
      select 1
      from public.sales sale
      where sale.id = sale_refunds.sale_id
        and (sale.staff_id = auth.uid() or sale.created_by = auth.uid())
    )
  );

drop policy if exists sale_history_select on public.sale_history;
create policy sale_history_select
  on public.sale_history
  for select
  to authenticated
  using (
    public.is_admin()
    or exists (
      select 1
      from public.sales sale
      where sale.id = sale_history.sale_id
        and (sale.staff_id = auth.uid() or sale.created_by = auth.uid())
    )
  );

drop policy if exists targets_select on public.monthly_targets;
create policy targets_select
  on public.monthly_targets
  for select
  to authenticated
  using (public.is_admin());

commit;
