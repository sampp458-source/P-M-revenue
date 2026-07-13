-- 직원의 빠른 상품 등록에 사용할 사업부별 기본 분류를 준비한다.
-- 기존 분류가 있으면 변경하지 않고, 동일 사업부에 '기타'가 없을 때만 추가한다.

begin;

insert into public.product_categories (
  business_unit_id,
  name,
  sort_order,
  is_active
)
select
  unit.id,
  '기타',
  coalesce((
    select max(category.sort_order) + 1
    from public.product_categories as category
    where category.business_unit_id = unit.id
  ), 1),
  true
from public.business_units as unit
where unit.is_active = true
  and not exists (
    select 1
    from public.product_categories as existing
    where existing.business_unit_id = unit.id
      and lower(btrim(existing.name)) = lower('기타')
  );

commit;
