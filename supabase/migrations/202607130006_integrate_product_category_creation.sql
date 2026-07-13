-- 상품 등록 흐름에서 활성 직원이 신규 분류를 추가할 수 있게 한다.
-- 기존 상품/분류 UPDATE 및 DELETE 관리자 정책은 변경하지 않는다.

begin;

alter table public.products
  add column if not exists unit_label text null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'products_unit_label_check'
      and conrelid = 'public.products'::regclass
  ) then
    alter table public.products
      add constraint products_unit_label_check
      check (
        unit_label is null
        or (btrim(unit_label) <> '' and char_length(btrim(unit_label)) <= 20)
      );
  end if;
end
$$;

drop policy if exists categories_insert_active_staff
  on public.product_categories;

create policy categories_insert_active_staff
  on public.product_categories
  for insert
  to authenticated
  with check (
    public.is_active_user()
    and product_categories.is_active = true
    and exists (
      select 1
      from public.business_units as unit
      where unit.id = product_categories.business_unit_id
        and unit.is_active = true
    )
  );

commit;
