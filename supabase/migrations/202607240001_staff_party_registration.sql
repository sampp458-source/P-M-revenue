-- 활성 직원에게 보호자와 반려견의 신규 등록만 허용한다.
-- 기존 UPDATE / DELETE / 비활성화 정책은 관리자 전용으로 유지한다.

begin;

drop policy if exists customers_insert_active_staff
  on public.customers;

create policy customers_insert_active_staff
  on public.customers
  for insert
  to authenticated
  with check (
    public.is_active_user()
    and is_active = true
  );

drop policy if exists dogs_insert_active_staff
  on public.dogs;

create policy dogs_insert_active_staff
  on public.dogs
  for insert
  to authenticated
  with check (
    public.is_active_user()
    and is_active = true
    and customer_id is not null
    and exists (
      select 1
      from public.customers as customer
      where customer.id = dogs.customer_id
        and customer.is_active = true
    )
  );

commit;
