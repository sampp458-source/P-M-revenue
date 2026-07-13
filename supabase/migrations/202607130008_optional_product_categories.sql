-- 신규 상품과 매출에서 상품 분류를 선택값으로 전환한다.
-- 기존 상품/매출의 분류 값과 스냅샷은 변경하지 않는다.

begin;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'products_id_unit_unique'
      and conrelid = 'public.products'::regclass
  ) then
    alter table public.products
      add constraint products_id_unit_unique unique (id, business_unit_id);
  end if;
end
$$;

alter table public.sales
  drop constraint if exists sales_product_scope_fk;

alter table public.products
  alter column category_id drop not null;

alter table public.sales
  alter column product_category_id drop not null,
  alter column product_category_name drop not null;

alter table public.sales
  drop constraint if exists sales_product_unit_fk;

alter table public.sales
  add constraint sales_product_unit_fk
  foreign key (product_id, business_unit_id)
  references public.products(id, business_unit_id);

drop policy if exists products_insert_active_staff
  on public.products;

create policy products_insert_active_staff
  on public.products
  for insert
  to authenticated
  with check (
    public.is_active_user()
    and products.is_active = true
    and (
      products.category_id is null
      or exists (
        select 1
        from public.product_categories as category
        where category.id = products.category_id
          and category.business_unit_id = products.business_unit_id
          and category.is_active = true
      )
    )
  );

create or replace function public.prepare_sale()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  unit_row public.business_units%rowtype;
  dog_row public.dogs%rowtype;
  customer_row public.customers%rowtype;
  category_row public.product_categories%rowtype;
  product_row public.products%rowtype;
  staff_row public.profiles%rowtype;
begin
  if public.is_month_closed(new.sale_date)
    or (tg_op = 'UPDATE' and public.is_month_closed(old.sale_date)) then
    raise exception '마감된 월의 매출은 변경할 수 없습니다.' using errcode = 'P0001';
  end if;

  if tg_op = 'INSERT' then
    if not public.is_admin() then
      new.created_by := auth.uid();
      new.staff_id := auth.uid();
    else
      new.created_by := coalesce(new.created_by, auth.uid());
      new.staff_id := coalesce(new.staff_id, auth.uid());
    end if;

    select * into unit_row from public.business_units where id = new.business_unit_id;
    select * into product_row from public.products where id = new.product_id;
    if new.product_category_id is not null then
      select * into category_row from public.product_categories where id = new.product_category_id;
    end if;

    if unit_row.id is null or product_row.id is null then
      raise exception '유효하지 않은 사업부 또는 상품입니다.' using errcode = 'P0001';
    end if;
    if not unit_row.is_active or not product_row.is_active then
      raise exception '비활성 사업부 또는 상품은 선택할 수 없습니다.' using errcode = 'P0001';
    end if;
    if product_row.business_unit_id <> unit_row.id
      or product_row.category_id is distinct from new.product_category_id then
      raise exception '사업부와 상품 연결 정보가 일치하지 않습니다.' using errcode = 'P0001';
    end if;
    if new.product_category_id is not null
      and (category_row.id is null or not category_row.is_active or category_row.business_unit_id <> unit_row.id) then
      raise exception '유효한 활성 상품 분류만 선택할 수 있습니다.' using errcode = 'P0001';
    end if;

    if new.dog_id is not null then
      select * into dog_row from public.dogs where id = new.dog_id;
      if dog_row.id is null or not dog_row.is_active then
        raise exception '유효한 활성 반려견만 선택할 수 있습니다.' using errcode = 'P0001';
      end if;
      new.customer_id := dog_row.customer_id;
      new.dog_name := dog_row.name;
    else
      new.dog_name := nullif(btrim(coalesce(new.dog_name, '')), '');
    end if;

    if new.customer_id is not null then
      select * into customer_row from public.customers where id = new.customer_id;
      if customer_row.id is null or not customer_row.is_active then
        raise exception '유효한 활성 보호자만 선택할 수 있습니다.' using errcode = 'P0001';
      end if;
      new.customer_name := customer_row.name;
      new.customer_phone := customer_row.phone;
    else
      new.customer_name := nullif(btrim(coalesce(new.customer_name, '')), '');
      new.customer_phone := nullif(regexp_replace(coalesce(new.customer_phone, ''), '[^0-9]', '', 'g'), '');
    end if;

    if new.staff_id is not null then
      select * into staff_row from public.profiles where id = new.staff_id;
    end if;

    new.business_unit_name := unit_row.name;
    new.product_category_name := case when category_row.id is null then null else category_row.name end;
    new.product_name := product_row.name;
    new.staff_name := case when staff_row.id is null then null else staff_row.name end;
  else
    if new.dog_id is distinct from old.dog_id
      or new.customer_id is distinct from old.customer_id then
      if new.dog_id is not null then
        select * into dog_row from public.dogs where id = new.dog_id;
        if dog_row.id is null or not dog_row.is_active then
          raise exception '유효한 활성 반려견만 선택할 수 있습니다.' using errcode = 'P0001';
        end if;
        new.customer_id := dog_row.customer_id;
        new.dog_name := dog_row.name;
      else
        new.dog_name := nullif(btrim(coalesce(new.dog_name, '')), '');
      end if;

      if new.customer_id is not null then
        select * into customer_row from public.customers where id = new.customer_id;
        if customer_row.id is null or not customer_row.is_active then
          raise exception '유효한 활성 보호자만 선택할 수 있습니다.' using errcode = 'P0001';
        end if;
        new.customer_name := customer_row.name;
        new.customer_phone := customer_row.phone;
      else
        new.customer_name := nullif(btrim(coalesce(new.customer_name, '')), '');
        new.customer_phone := nullif(regexp_replace(coalesce(new.customer_phone, ''), '[^0-9]', '', 'g'), '');
      end if;
    else
      new.customer_id := old.customer_id;
      new.dog_name := old.dog_name;
      new.customer_name := old.customer_name;
      new.customer_phone := old.customer_phone;
    end if;

    if new.business_unit_id is distinct from old.business_unit_id
      or new.product_category_id is distinct from old.product_category_id
      or new.product_id is distinct from old.product_id then
      select * into unit_row from public.business_units where id = new.business_unit_id;
      select * into product_row from public.products where id = new.product_id;
      if new.product_category_id is not null then
        select * into category_row from public.product_categories where id = new.product_category_id;
      end if;
      if unit_row.id is null or product_row.id is null
        or not unit_row.is_active or not product_row.is_active then
        raise exception '유효한 활성 사업부와 상품만 선택할 수 있습니다.'
          using errcode = 'P0001';
      end if;
      if product_row.business_unit_id <> unit_row.id
        or product_row.category_id is distinct from new.product_category_id then
        raise exception '사업부와 상품 연결 정보가 일치하지 않습니다.' using errcode = 'P0001';
      end if;
      if new.product_category_id is not null
        and (category_row.id is null or not category_row.is_active or category_row.business_unit_id <> unit_row.id) then
        raise exception '유효한 활성 상품 분류만 선택할 수 있습니다.' using errcode = 'P0001';
      end if;
      new.business_unit_name := unit_row.name;
      new.product_category_name := case when category_row.id is null then null else category_row.name end;
      new.product_name := product_row.name;
    else
      new.business_unit_name := old.business_unit_name;
      new.product_category_name := old.product_category_name;
      new.product_name := old.product_name;
    end if;

    if new.staff_id is distinct from old.staff_id then
      if new.staff_id is not null then
        select * into staff_row from public.profiles where id = new.staff_id;
      end if;
      new.staff_name := case when staff_row.id is null then null else staff_row.name end;
    else
      new.staff_name := old.staff_name;
    end if;
  end if;

  new.net_amount := new.paid_amount - new.refund_amount;
  if new.net_amount < 0 then
    raise exception '실매출은 음수가 될 수 없습니다.' using errcode = 'P0001';
  end if;

  if new.status = 'cancelled' then
    new.cancelled_at := coalesce(new.cancelled_at, now());
    new.cancelled_by := coalesce(new.cancelled_by, auth.uid());
  else
    new.cancelled_at := null;
    new.cancelled_by := null;
    new.cancellation_reason := null;
    new.status := case
      when new.refund_amount = 0 then 'normal'
      when new.refund_amount = new.paid_amount and new.paid_amount > 0 then 'full_refund'
      else 'partial_refund'
    end;
  end if;

  return new;
end;
$$;

commit;
