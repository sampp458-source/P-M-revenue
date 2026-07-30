begin;

drop function if exists public.get_staff_finance_day(date);

drop policy if exists sales_select on public.sales;
create policy sales_select
  on public.sales
  for select
  to authenticated
  using (public.is_active_user());

drop policy if exists sale_payments_select on public.sale_payments;
create policy sale_payments_select
  on public.sale_payments
  for select
  to authenticated
  using (public.is_active_user());

drop policy if exists sale_refunds_select_active on public.sale_refunds;
create policy sale_refunds_select_active
  on public.sale_refunds
  for select
  to authenticated
  using (public.is_active_user());

drop policy if exists sale_history_select on public.sale_history;
create policy sale_history_select
  on public.sale_history
  for select
  to authenticated
  using (public.is_active_user());

drop policy if exists targets_select on public.monthly_targets;
create policy targets_select
  on public.monthly_targets
  for select
  to authenticated
  using (public.is_active_user());

commit;
