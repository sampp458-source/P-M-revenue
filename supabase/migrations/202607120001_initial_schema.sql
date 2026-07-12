begin;

create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  role text not null default 'staff' check (role in ('admin', 'staff')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.business_units (
  id uuid primary key default gen_random_uuid(),
  code text unique not null check (code in ('daycare', 'training', 'hotel')),
  name text unique not null,
  sort_order integer unique not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  name text null,
  phone text null,
  memo text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customers_has_identity check (
    nullif(btrim(coalesce(name, '')), '') is not null
    or nullif(btrim(coalesce(phone, '')), '') is not null
  )
);

create table public.dogs (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid null references public.customers(id) on delete set null,
  name text not null check (btrim(name) <> ''),
  breed text null,
  sex text null check (sex is null or sex in ('male', 'female')),
  birth_date date null,
  weight numeric(6,2) null check (weight is null or weight >= 0),
  neutered boolean null,
  photo_url text null,
  memo text null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.product_categories (
  id uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references public.business_units(id),
  name text not null check (btrim(name) <> ''),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index product_categories_unit_name_uidx
  on public.product_categories (business_unit_id, lower(btrim(name)));
alter table public.product_categories
  add constraint product_categories_id_unit_unique unique (id, business_unit_id);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references public.business_units(id),
  category_id uuid not null,
  name text not null check (btrim(name) <> ''),
  default_price integer not null default 0 check (default_price >= 0),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  memo text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_category_unit_fk foreign key (category_id, business_unit_id)
    references public.product_categories(id, business_unit_id)
);

create unique index products_unit_name_uidx
  on public.products (business_unit_id, lower(btrim(name)));
alter table public.products
  add constraint products_id_unit_category_unique unique (id, business_unit_id, category_id);

create table public.sales (
  id uuid primary key default gen_random_uuid(),
  sale_date date not null,
  business_unit_id uuid not null references public.business_units(id),
  dog_id uuid not null references public.dogs(id),
  customer_id uuid null references public.customers(id) on delete set null,
  product_category_id uuid not null references public.product_categories(id),
  product_id uuid not null references public.products(id),
  business_unit_name text not null,
  dog_name text not null,
  customer_name text null,
  product_category_name text not null,
  product_name text not null,
  original_amount integer not null default 0 check (original_amount >= 0),
  discount_amount integer not null default 0 check (discount_amount >= 0),
  paid_amount integer not null default 0 check (paid_amount >= 0),
  refund_amount integer not null default 0 check (refund_amount >= 0),
  outstanding_amount integer not null default 0 check (outstanding_amount >= 0),
  net_amount integer not null default 0 check (net_amount >= 0),
  payment_method text not null check (payment_method in ('card', 'transfer', 'cash', 'outstanding')),
  customer_type text not null check (customer_type in ('new', 'renewal')),
  status text not null default 'normal' check (status in ('normal', 'partial_refund', 'full_refund', 'cancelled')),
  staff_id uuid null default auth.uid() references public.profiles(id) on delete set null,
  staff_name text null,
  memo text null,
  cancelled_at timestamptz null,
  cancelled_by uuid null references public.profiles(id) on delete set null,
  cancellation_reason text null,
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sales_amount_formula check (net_amount = paid_amount - refund_amount),
  constraint sales_refund_within_paid check (refund_amount <= paid_amount),
  constraint sales_payment_plan_limit check (
    paid_amount + outstanding_amount <= greatest(original_amount - discount_amount, 0)
  ),
  constraint sales_refund_status_consistency check (
    status = 'cancelled'
    or (refund_amount = 0 and status = 'normal')
    or (refund_amount > 0 and refund_amount < paid_amount and status = 'partial_refund')
    or (refund_amount = paid_amount and paid_amount > 0 and status = 'full_refund')
  ),
  constraint sales_cancellation_consistency check (
    (
      status = 'cancelled'
      and cancelled_at is not null
      and cancelled_by is not null
      and nullif(btrim(coalesce(cancellation_reason, '')), '') is not null
    )
    or (
      status <> 'cancelled'
      and cancelled_at is null
      and cancelled_by is null
      and cancellation_reason is null
    )
  ),
  constraint sales_product_scope_fk foreign key (product_id, business_unit_id, product_category_id)
    references public.products(id, business_unit_id, category_id)
);

create table public.sale_history (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete cascade,
  action text not null check (action in ('created', 'updated', 'partial_refund', 'full_refund', 'cancelled', 'reopened')),
  previous_data jsonb null,
  changed_data jsonb null,
  changed_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.monthly_targets (
  id uuid primary key default gen_random_uuid(),
  year integer not null check (year between 2000 and 2200),
  month integer not null check (month between 1 and 12),
  business_unit_id uuid null references public.business_units(id),
  target_amount integer not null default 0 check (target_amount >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index monthly_targets_period_unit_uidx
  on public.monthly_targets (year, month, coalesce(business_unit_id, '00000000-0000-0000-0000-000000000000'::uuid));

create table public.monthly_closings (
  id uuid primary key default gen_random_uuid(),
  year integer not null check (year between 2000 and 2200),
  month integer not null check (month between 1 and 12),
  total_amount integer not null default 0 check (total_amount >= 0),
  net_amount integer not null default 0 check (net_amount >= 0),
  refund_amount integer not null default 0 check (refund_amount >= 0),
  outstanding_amount integer not null default 0 check (outstanding_amount >= 0),
  closed_by uuid not null references public.profiles(id),
  closed_at timestamptz not null default now(),
  memo text null,
  reopened_by uuid null references public.profiles(id),
  reopened_at timestamptz null,
  is_closed boolean not null default true,
  unique (year, month)
);

create index dogs_customer_idx on public.dogs(customer_id);
create index dogs_name_idx on public.dogs(lower(name));
create index categories_unit_active_idx on public.product_categories(business_unit_id, is_active, sort_order);
create index products_unit_category_active_idx on public.products(business_unit_id, category_id, is_active, sort_order);
create index sales_date_idx on public.sales(sale_date desc);
create index sales_unit_date_idx on public.sales(business_unit_id, sale_date desc);
create index sales_dog_date_idx on public.sales(dog_id, sale_date desc);
create index sales_created_by_date_idx on public.sales(created_by, sale_date desc);
create index sale_history_sale_date_idx on public.sale_history(sale_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger business_units_updated_at before update on public.business_units for each row execute function public.set_updated_at();
create trigger customers_updated_at before update on public.customers for each row execute function public.set_updated_at();
create trigger dogs_updated_at before update on public.dogs for each row execute function public.set_updated_at();
create trigger categories_updated_at before update on public.product_categories for each row execute function public.set_updated_at();
create trigger products_updated_at before update on public.products for each row execute function public.set_updated_at();
create trigger sales_updated_at before update on public.sales for each row execute function public.set_updated_at();
create trigger targets_updated_at before update on public.monthly_targets for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, name, role)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'name', ''), split_part(coalesce(new.email, '직원'), '@', 1)),
    'staff'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active = true
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active = true and role = 'admin'
  );
$$;

create or replace function public.is_month_closed(target_date date)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.monthly_closings
    where year = extract(year from target_date)::integer
      and month = extract(month from target_date)::integer
      and is_closed = true
  );
$$;

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
      new.created_by = auth.uid();
      new.staff_id = auth.uid();
    else
      new.created_by = coalesce(new.created_by, auth.uid());
      new.staff_id = coalesce(new.staff_id, auth.uid());
    end if;

    select * into unit_row from public.business_units where id = new.business_unit_id;
    select * into dog_row from public.dogs where id = new.dog_id;
    select * into category_row from public.product_categories where id = new.product_category_id;
    select * into product_row from public.products where id = new.product_id;

    if unit_row.id is null or dog_row.id is null or category_row.id is null or product_row.id is null then
      raise exception '유효하지 않은 사업부, 반려견 또는 상품입니다.' using errcode = 'P0001';
    end if;
    if not unit_row.is_active or not dog_row.is_active or not category_row.is_active or not product_row.is_active then
      raise exception '비활성 사업부, 반려견, 분류 또는 상품은 선택할 수 없습니다.' using errcode = 'P0001';
    end if;

    new.customer_id = dog_row.customer_id;
    if new.customer_id is not null then
      select * into customer_row from public.customers where id = new.customer_id;
    end if;
    if new.staff_id is not null then
      select * into staff_row from public.profiles where id = new.staff_id;
    end if;

    new.business_unit_name = unit_row.name;
    new.dog_name = dog_row.name;
    new.customer_name = case when customer_row.id is null then null else customer_row.name end;
    new.product_category_name = category_row.name;
    new.product_name = product_row.name;
    new.staff_name = case when staff_row.id is null then null else staff_row.name end;
  else
    if new.dog_id is distinct from old.dog_id then
      select * into dog_row from public.dogs where id = new.dog_id;
      if dog_row.id is null or not dog_row.is_active then
        raise exception '유효한 활성 반려견만 선택할 수 있습니다.' using errcode = 'P0001';
      end if;
      new.customer_id = dog_row.customer_id;
      if new.customer_id is not null then
        select * into customer_row from public.customers where id = new.customer_id;
      end if;
      new.dog_name = dog_row.name;
      new.customer_name = case when customer_row.id is null then null else customer_row.name end;
    else
      new.customer_id = old.customer_id;
      new.dog_name = old.dog_name;
      new.customer_name = old.customer_name;
    end if;

    if new.business_unit_id is distinct from old.business_unit_id
      or new.product_category_id is distinct from old.product_category_id
      or new.product_id is distinct from old.product_id then
      select * into unit_row from public.business_units where id = new.business_unit_id;
      select * into category_row from public.product_categories where id = new.product_category_id;
      select * into product_row from public.products where id = new.product_id;
      if unit_row.id is null or category_row.id is null or product_row.id is null
        or not unit_row.is_active or not category_row.is_active or not product_row.is_active then
        raise exception '유효한 활성 사업부, 분류와 상품만 선택할 수 있습니다.' using errcode = 'P0001';
      end if;
      new.business_unit_name = unit_row.name;
      new.product_category_name = category_row.name;
      new.product_name = product_row.name;
    else
      new.business_unit_name = old.business_unit_name;
      new.product_category_name = old.product_category_name;
      new.product_name = old.product_name;
    end if;

    if new.staff_id is distinct from old.staff_id then
      if new.staff_id is not null then
        select * into staff_row from public.profiles where id = new.staff_id;
      end if;
      new.staff_name = case when staff_row.id is null then null else staff_row.name end;
    else
      new.staff_name = old.staff_name;
    end if;
  end if;

  new.net_amount = new.paid_amount - new.refund_amount;

  if new.net_amount < 0 then
    raise exception '실매출은 음수가 될 수 없습니다.' using errcode = 'P0001';
  end if;

  if new.status = 'cancelled' then
    new.cancelled_at = coalesce(new.cancelled_at, now());
    new.cancelled_by = coalesce(new.cancelled_by, auth.uid());
  else
    new.cancelled_at = null;
    new.cancelled_by = null;
    new.cancellation_reason = null;
    new.status = case
      when new.refund_amount = 0 then 'normal'
      when new.refund_amount = new.paid_amount and new.paid_amount > 0 then 'full_refund'
      else 'partial_refund'
    end;
  end if;

  return new;
end;
$$;

create trigger sales_prepare_before_write
  before insert or update on public.sales
  for each row execute function public.prepare_sale();

create or replace function public.protect_sale_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.created_by <> new.created_by then
    raise exception '매출 등록자는 변경할 수 없습니다.' using errcode = 'P0001';
  end if;
  if not public.is_admin() and (
    old.refund_amount <> new.refund_amount
    or old.status <> new.status
    or old.cancelled_at is distinct from new.cancelled_at
    or old.cancelled_by is distinct from new.cancelled_by
    or old.cancellation_reason is distinct from new.cancellation_reason
    or old.staff_id is distinct from new.staff_id
  ) then
    raise exception '환불, 취소와 담당자 변경은 관리자만 처리할 수 있습니다.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger sales_protect_before_update
  before update on public.sales
  for each row execute function public.protect_sale_changes();

create or replace function public.record_sale_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  action_name text;
begin
  if tg_op = 'INSERT' then
    action_name := 'created';
    insert into public.sale_history (sale_id, action, previous_data, changed_data, changed_by)
    values (new.id, action_name, null, to_jsonb(new), auth.uid());
    return new;
  end if;

  action_name := case
    when old.status <> 'cancelled' and new.status = 'cancelled' then 'cancelled'
    when old.status = 'cancelled' and new.status <> 'cancelled' then 'reopened'
    when new.refund_amount = new.paid_amount and old.refund_amount <> new.refund_amount then 'full_refund'
    when old.refund_amount <> new.refund_amount then 'partial_refund'
    else 'updated'
  end;
  insert into public.sale_history (sale_id, action, previous_data, changed_data, changed_by)
  values (new.id, action_name, to_jsonb(old), to_jsonb(new), auth.uid());
  return new;
end;
$$;

create trigger sales_history_after_write
  after insert or update on public.sales
  for each row execute function public.record_sale_history();

alter table public.profiles enable row level security;
alter table public.business_units enable row level security;
alter table public.customers enable row level security;
alter table public.dogs enable row level security;
alter table public.product_categories enable row level security;
alter table public.products enable row level security;
alter table public.sales enable row level security;
alter table public.sale_history enable row level security;
alter table public.monthly_targets enable row level security;
alter table public.monthly_closings enable row level security;

create policy profiles_select on public.profiles for select to authenticated using (public.is_active_user());
create policy profiles_update_admin on public.profiles for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy business_units_select on public.business_units for select to authenticated using (public.is_active_user());
create policy business_units_insert_admin on public.business_units for insert to authenticated with check (public.is_admin());
create policy business_units_update_admin on public.business_units for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy customers_select on public.customers for select to authenticated using (public.is_active_user());
create policy customers_insert on public.customers for insert to authenticated with check (public.is_active_user());
create policy customers_update on public.customers for update to authenticated using (public.is_active_user()) with check (public.is_active_user());

create policy dogs_select on public.dogs for select to authenticated using (public.is_active_user());
create policy dogs_insert on public.dogs for insert to authenticated with check (public.is_active_user());
create policy dogs_update on public.dogs for update to authenticated using (public.is_active_user()) with check (public.is_active_user());

create policy categories_select on public.product_categories for select to authenticated using (public.is_active_user());
create policy categories_insert_admin on public.product_categories for insert to authenticated with check (public.is_admin());
create policy categories_update_admin on public.product_categories for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy products_select on public.products for select to authenticated using (public.is_active_user());
create policy products_insert_admin on public.products for insert to authenticated with check (public.is_admin());
create policy products_update_admin on public.products for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy sales_select on public.sales for select to authenticated using (public.is_active_user());
create policy sales_insert on public.sales for insert to authenticated with check (public.is_active_user() and created_by = auth.uid());
create policy sales_update on public.sales for update to authenticated
  using (public.is_admin() or (created_by = auth.uid() and status = 'normal'))
  with check (public.is_admin() or (created_by = auth.uid() and status = 'normal'));

create policy sale_history_select on public.sale_history for select to authenticated using (public.is_active_user());

create policy targets_select on public.monthly_targets for select to authenticated using (public.is_active_user());
create policy targets_insert_admin on public.monthly_targets for insert to authenticated with check (public.is_admin());
create policy targets_update_admin on public.monthly_targets for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy targets_delete_admin on public.monthly_targets for delete to authenticated using (public.is_admin());

create policy closings_select on public.monthly_closings for select to authenticated using (public.is_active_user());
create policy closings_insert_admin on public.monthly_closings for insert to authenticated with check (public.is_admin());
create policy closings_update_admin on public.monthly_closings for update to authenticated using (public.is_admin()) with check (public.is_admin());

revoke all on function public.is_active_user() from public;
revoke all on function public.is_admin() from public;
revoke all on function public.is_month_closed(date) from public;
grant execute on function public.is_active_user() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_month_closed(date) to authenticated;

commit;
