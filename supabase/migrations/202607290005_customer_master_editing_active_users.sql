-- P&M OS Customer Master editing for every active profile.
-- 기존 관리자 Policy, 감사 Trigger, Finance 객체는 변경하지 않는다.

begin;

drop policy if exists customers_update_active_user
  on public.customers;

create policy customers_update_active_user
  on public.customers
  for update
  to authenticated
  using (public.is_active_user())
  with check (public.is_active_user());

grant update on table public.customers
  to authenticated;

commit;
