-- 활성 직원의 신규 상품 등록만 허용한다.
-- 기존 관리자 INSERT 정책과 관리자 전용 UPDATE / DELETE 정책은 유지한다.

begin;

drop policy if exists products_insert_active_staff on public.products;

create policy products_insert_active_staff
  on public.products
  for insert
  to authenticated
  with check (
    public.is_active_user()
    and products.is_active = true
    and exists (
      select 1
      from public.product_categories as category
      where category.id = products.category_id
        and category.business_unit_id = products.business_unit_id
        and category.is_active = true
    )
  );

commit;
