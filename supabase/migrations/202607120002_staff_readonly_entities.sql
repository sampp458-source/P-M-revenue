-- P&M 배포 전 권한 마무리
-- 관리자: SELECT / INSERT / UPDATE / DELETE
-- 직원: SELECT only
-- 이 파일은 검토용으로 생성되었으며 자동 실행하지 않는다.

begin;

-- customers: 기존에는 모든 활성 사용자가 INSERT/UPDATE 가능했다.
drop policy if exists customers_insert on public.customers;
drop policy if exists customers_update on public.customers;
drop policy if exists customers_delete_admin on public.customers;

create policy customers_insert_admin
  on public.customers
  for insert
  to authenticated
  with check (public.is_admin());

create policy customers_update_admin
  on public.customers
  for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy customers_delete_admin
  on public.customers
  for delete
  to authenticated
  using (public.is_admin());

-- dogs: 기존에는 모든 활성 사용자가 INSERT/UPDATE 가능했다.
drop policy if exists dogs_insert on public.dogs;
drop policy if exists dogs_update on public.dogs;
drop policy if exists dogs_delete_admin on public.dogs;

create policy dogs_insert_admin
  on public.dogs
  for insert
  to authenticated
  with check (public.is_admin());

create policy dogs_update_admin
  on public.dogs
  for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy dogs_delete_admin
  on public.dogs
  for delete
  to authenticated
  using (public.is_admin());

-- product_categories와 products의 INSERT/UPDATE는 이미 관리자 전용이다.
-- 누락된 관리자 DELETE 정책만 추가한다.
drop policy if exists categories_delete_admin on public.product_categories;
create policy categories_delete_admin
  on public.product_categories
  for delete
  to authenticated
  using (public.is_admin());

drop policy if exists products_delete_admin on public.products;
create policy products_delete_admin
  on public.products
  for delete
  to authenticated
  using (public.is_admin());

commit;
