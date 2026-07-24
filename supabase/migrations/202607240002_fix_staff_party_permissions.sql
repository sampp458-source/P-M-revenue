-- 활성 직원의 보호자·반려견 등록과 본인 정상 매출 연결 권한을 최소 범위로 허용한다.
-- customers/dogs UPDATE·DELETE 및 sales 범용 UPDATE 정책은 변경하지 않는다.

begin;

alter table public.customers
  add column if not exists created_by uuid;

alter table public.customers
  alter column created_by set default auth.uid();

alter table public.dogs
  add column if not exists created_by uuid;

alter table public.dogs
  alter column created_by set default auth.uid();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'customers_created_by_fkey'
      and conrelid = 'public.customers'::regclass
  ) then
    alter table public.customers
      add constraint customers_created_by_fkey
      foreign key (created_by)
      references public.profiles(id)
      on delete set null;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'dogs_created_by_fkey'
      and conrelid = 'public.dogs'::regclass
  ) then
    alter table public.dogs
      add constraint dogs_created_by_fkey
      foreign key (created_by)
      references public.profiles(id)
      on delete set null;
  end if;
end
$$;

create index if not exists customers_created_by_idx
  on public.customers(created_by);

create index if not exists dogs_created_by_idx
  on public.dogs(created_by);

drop policy if exists customers_insert
  on public.customers;
drop policy if exists customers_insert_admin
  on public.customers;
drop policy if exists customers_insert_active_staff
  on public.customers;
drop policy if exists customers_insert_active_user
  on public.customers;

create policy customers_insert_active_user
  on public.customers
  for insert
  to authenticated
  with check (
    public.is_active_user()
    and customers.is_active = true
    and customers.created_by = auth.uid()
  );

drop policy if exists dogs_insert
  on public.dogs;
drop policy if exists dogs_insert_admin
  on public.dogs;
drop policy if exists dogs_insert_active_staff
  on public.dogs;
drop policy if exists dogs_insert_active_user
  on public.dogs;

create policy dogs_insert_active_user
  on public.dogs
  for insert
  to authenticated
  with check (
    public.is_active_user()
    and dogs.is_active = true
    and dogs.created_by = auth.uid()
    and (
      public.is_admin()
      or dogs.customer_id is not null
    )
    and (
      dogs.customer_id is null
      or exists (
        select 1
        from public.customers as customer
        where customer.id = dogs.customer_id
          and customer.is_active = true
      )
    )
  );

create or replace function public.link_sale_party(
  p_sale_id uuid,
  p_customer_id uuid,
  p_dog_id uuid
)
returns table (
  customer_id uuid,
  dog_id uuid,
  customer_name text,
  customer_phone text,
  dog_name text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  sale_row public.sales%rowtype;
  customer_row public.customers%rowtype;
  dog_row public.dogs%rowtype;
begin
  if auth.uid() is null or not public.is_active_user() then
    raise exception '승인된 활성 계정만 고객 정보를 연결할 수 있습니다.'
      using errcode = '42501';
  end if;

  select *
  into sale_row
  from public.sales
  where id = p_sale_id
  for update;

  if sale_row.id is null then
    raise exception '매출 정보를 찾을 수 없습니다.'
      using errcode = 'P0002';
  end if;

  if sale_row.status <> 'normal' then
    raise exception '정상 상태의 매출만 고객 정보를 변경할 수 있습니다.'
      using errcode = 'P0001';
  end if;

  if public.is_month_closed(sale_row.sale_date) then
    raise exception '마감된 월의 매출은 변경할 수 없습니다.'
      using errcode = 'P0001';
  end if;

  if not public.is_admin()
    and sale_row.created_by is distinct from auth.uid() then
    raise exception '다른 직원이 등록한 매출은 수정할 수 없습니다.'
      using errcode = '42501';
  end if;

  if p_customer_id is not null then
    select *
    into customer_row
    from public.customers
    where id = p_customer_id
      and is_active = true;

    if customer_row.id is null then
      raise exception '유효한 활성 보호자를 선택해 주세요.'
        using errcode = 'P0001';
    end if;
  end if;

  if p_dog_id is not null then
    if p_customer_id is null then
      raise exception '반려견을 연결하려면 보호자를 먼저 선택해 주세요.'
        using errcode = 'P0001';
    end if;

    select *
    into dog_row
    from public.dogs
    where id = p_dog_id
      and is_active = true;

    if dog_row.id is null then
      raise exception '유효한 활성 반려견을 선택해 주세요.'
        using errcode = 'P0001';
    end if;

    if dog_row.customer_id is distinct from p_customer_id then
      raise exception '선택한 보호자와 반려견의 연결 정보가 일치하지 않습니다.'
        using errcode = 'P0001';
    end if;
  end if;

  return query
  update public.sales as sale
  set
    customer_id = p_customer_id,
    dog_id = p_dog_id,
    customer_name = null,
    customer_phone = null,
    dog_name = null
  where sale.id = p_sale_id
  returning
    sale.customer_id,
    sale.dog_id,
    sale.customer_name,
    sale.customer_phone,
    sale.dog_name;
end;
$$;

revoke all on function public.link_sale_party(uuid, uuid, uuid)
  from public;
revoke all on function public.link_sale_party(uuid, uuid, uuid)
  from anon;
grant execute on function public.link_sale_party(uuid, uuid, uuid)
  to authenticated;

commit;
