begin;

alter table public.sales
  drop constraint if exists sales_payment_method_check;

alter table public.sales
  add constraint sales_payment_method_check
  check (payment_method in ('card', 'transfer', 'cash', 'outstanding', 'other'));

create table if not exists public.sale_payments (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete cascade,
  payment_method text not null check (payment_method in ('card', 'transfer', 'cash', 'other')),
  amount integer not null check (amount > 0),
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint sale_payments_sale_method_unique unique (sale_id, payment_method)
);

create index if not exists sale_payments_sale_id_idx
  on public.sale_payments(sale_id);

alter table public.sale_payments enable row level security;

drop policy if exists sale_payments_select on public.sale_payments;
drop policy if exists sale_payments_insert on public.sale_payments;
drop policy if exists sale_payments_update on public.sale_payments;
drop policy if exists sale_payments_delete on public.sale_payments;

create policy sale_payments_select on public.sale_payments
  for select to authenticated using (public.is_active_user());

create policy sale_payments_insert on public.sale_payments
  for insert to authenticated with check (
    public.is_active_user()
    and exists (
      select 1 from public.sales s
      where s.id = sale_payments.sale_id
        and (public.is_admin() or s.created_by = auth.uid())
        and s.status <> 'cancelled'
        and not public.is_month_closed(s.sale_date)
        and sale_payments.created_by = s.created_by
    )
  );

create policy sale_payments_delete on public.sale_payments
  for delete to authenticated using (
    public.is_active_user()
    and exists (
      select 1 from public.sales s
      where s.id = sale_payments.sale_id
        and (public.is_admin() or (s.created_by = auth.uid() and s.status = 'normal'))
        and s.status <> 'cancelled'
        and not public.is_month_closed(s.sale_date)
    )
  );

insert into public.sale_payments (sale_id, payment_method, amount, created_by, created_at)
select
  s.id,
  case when s.payment_method in ('card', 'transfer', 'cash', 'other')
    then s.payment_method else 'other' end,
  s.paid_amount,
  s.created_by,
  s.created_at
from public.sales s
where s.paid_amount > 0
on conflict (sale_id, payment_method) do nothing;

create or replace function public.sync_single_sale_payment()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  payment_count integer;
  payment_creator uuid;
begin
  select count(*) into payment_count
  from public.sale_payments
  where sale_id = new.id;

  if tg_op = 'INSERT' or payment_count <= 1 then
    select created_by into payment_creator
    from public.sale_payments
    where sale_id = new.id
    order by created_at, id
    limit 1;

    delete from public.sale_payments where sale_id = new.id;
    if new.paid_amount > 0 then
      insert into public.sale_payments (sale_id, payment_method, amount, created_by)
      values (
        new.id,
        case when new.payment_method in ('card', 'transfer', 'cash', 'other')
          then new.payment_method else 'other' end,
        new.paid_amount,
        coalesce(payment_creator, new.created_by)
      );
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists sales_sync_single_payment on public.sales;
create trigger sales_sync_single_payment
after insert or update of paid_amount, payment_method on public.sales
for each row execute function public.sync_single_sale_payment();

create or replace function public.normalize_sale_payment_payload(p_payments jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  normalized_payments jsonb;
  raw_total numeric;
begin
  if p_payments is null or jsonb_typeof(p_payments) is distinct from 'array' then
    raise exception '결제 정보는 배열 형식이어야 합니다.' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_payments) item
    where jsonb_typeof(item) is distinct from 'object'
      or coalesce(item->>'amount', '') !~ '^-?[0-9]+$'
  ) then
    raise exception '결제금액은 정수로 입력해 주세요.' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_payments) item
    where (item->>'amount')::numeric < 0
  ) then
    raise exception '결제금액은 0원 이상이어야 합니다.' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_payments) item
    where (item->>'amount')::numeric > 0
      and coalesce(item->>'payment_method', '') not in ('card', 'transfer', 'cash', 'other')
  ) then
    raise exception '결제수단은 카드, 계좌이체, 현금, 기타만 사용할 수 있습니다.' using errcode = '22023';
  end if;

  select coalesce(sum((item->>'amount')::numeric), 0)
    into raw_total
  from jsonb_array_elements(p_payments) item
  where (item->>'amount')::numeric > 0;

  if raw_total > 2147483647 then
    raise exception '총 결제금액이 저장 가능한 범위를 초과했습니다.' using errcode = '22003';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'payment_method', grouped.payment_method,
        'amount', grouped.amount
      )
      order by grouped.first_position
    ),
    '[]'::jsonb
  )
    into normalized_payments
  from (
    select
      item->>'payment_method' as payment_method,
      sum((item->>'amount')::numeric)::integer as amount,
      min(position) as first_position
    from jsonb_array_elements(p_payments) with ordinality as rows(item, position)
    where (item->>'amount')::numeric > 0
    group by item->>'payment_method'
  ) grouped;

  if jsonb_array_length(normalized_payments) < 2 then
    raise exception '분할결제는 두 개 이상의 유효한 결제수단이 필요합니다.' using errcode = '22023';
  end if;

  return normalized_payments;
end;
$$;

revoke all on function public.normalize_sale_payment_payload(jsonb) from public;
grant execute on function public.normalize_sale_payment_payload(jsonb) to authenticated;

create or replace function public.create_sale_with_payments(
  p_sale jsonb,
  p_payments jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  new_sale_id uuid;
  payment_total integer;
  representative_method text;
  normalized_payments jsonb;
begin
  if not public.is_active_user() then
    raise exception '권한이 없습니다.' using errcode = '42501';
  end if;
  normalized_payments := public.normalize_sale_payment_payload(p_payments);

  select coalesce(sum((item->>'amount')::integer), 0)
    into payment_total
  from jsonb_array_elements(normalized_payments) item;

  representative_method := normalized_payments->0->>'payment_method';
  if payment_total <> coalesce((p_sale->>'paid_amount')::integer, 0) then
    raise exception '결제수단별 합계와 실제 결제금액이 일치하지 않습니다.' using errcode = '23514';
  end if;

  insert into public.sales (
    sale_date, business_unit_id, dog_id, customer_id, product_category_id, product_id,
    original_amount, quantity, unit_price, additional_amount, adjustment_note,
    discount_amount, paid_amount, refund_amount, outstanding_amount, net_amount,
    payment_method, customer_type, staff_id, memo, status,
    business_unit_name, dog_name, customer_name, customer_phone,
    product_category_name, product_name, created_by
  ) values (
    (p_sale->>'sale_date')::date,
    (p_sale->>'business_unit_id')::uuid,
    nullif(p_sale->>'dog_id', '')::uuid,
    nullif(p_sale->>'customer_id', '')::uuid,
    nullif(p_sale->>'product_category_id', '')::uuid,
    (p_sale->>'product_id')::uuid,
    coalesce((p_sale->>'original_amount')::integer, 0),
    coalesce((p_sale->>'quantity')::integer, 1),
    coalesce((p_sale->>'unit_price')::integer, (p_sale->>'original_amount')::integer, 0),
    coalesce((p_sale->>'additional_amount')::integer, 0),
    nullif(p_sale->>'adjustment_note', ''),
    coalesce((p_sale->>'discount_amount')::integer, 0),
    payment_total,
    coalesce((p_sale->>'refund_amount')::integer, 0),
    coalesce((p_sale->>'outstanding_amount')::integer, 0),
    coalesce((p_sale->>'net_amount')::integer, payment_total),
    representative_method,
    p_sale->>'customer_type',
    nullif(p_sale->>'staff_id', '')::uuid,
    nullif(p_sale->>'memo', ''),
    coalesce(p_sale->>'status', 'normal'),
    coalesce(p_sale->>'business_unit_name', ''),
    coalesce(p_sale->>'dog_name', ''),
    nullif(p_sale->>'customer_name', ''),
    nullif(p_sale->>'customer_phone', ''),
    nullif(p_sale->>'product_category_name', ''),
    coalesce(p_sale->>'product_name', ''),
    auth.uid()
  ) returning id into new_sale_id;

  delete from public.sale_payments where sale_id = new_sale_id;
  insert into public.sale_payments (sale_id, payment_method, amount, created_by)
  select new_sale_id, item->>'payment_method', (item->>'amount')::integer, auth.uid()
  from jsonb_array_elements(normalized_payments) item;

  return new_sale_id;
end;
$$;

revoke all on function public.create_sale_with_payments(jsonb, jsonb) from public;
grant execute on function public.create_sale_with_payments(jsonb, jsonb) to authenticated;

create or replace function public.replace_sale_payments(
  p_sale_id uuid,
  p_payments jsonb
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  payment_total integer;
  method_count integer;
  normalized_payments jsonb;
  payment_creator uuid;
begin
  if not public.is_active_user() then
    raise exception '권한이 없습니다.' using errcode = '42501';
  end if;

  normalized_payments := public.normalize_sale_payment_payload(p_payments);

  select coalesce(sum((item->>'amount')::integer), 0), count(distinct item->>'payment_method')
    into payment_total, method_count
  from jsonb_array_elements(normalized_payments) item;

  if method_count < 2 then
    raise exception '분할결제는 두 개 이상의 결제수단이 필요합니다.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.sales s
    where s.id = p_sale_id
      and s.paid_amount = payment_total
      and (public.is_admin() or (s.created_by = auth.uid() and s.status = 'normal'))
      and s.status <> 'cancelled'
      and not public.is_month_closed(s.sale_date)
  ) then
    raise exception '결제정보 변경 권한 또는 결제 합계를 확인해 주세요.' using errcode = '42501';
  end if;

  select coalesce(
    (
      select sp.created_by
      from public.sale_payments sp
      where sp.sale_id = p_sale_id
      order by sp.created_at, sp.id
      limit 1
    ),
    (
      select s.created_by
      from public.sales s
      where s.id = p_sale_id
    )
  ) into payment_creator;

  delete from public.sale_payments where sale_id = p_sale_id;
  insert into public.sale_payments (sale_id, payment_method, amount, created_by)
  select p_sale_id, item->>'payment_method', (item->>'amount')::integer, payment_creator
  from jsonb_array_elements(normalized_payments) item;
end;
$$;

revoke all on function public.replace_sale_payments(uuid, jsonb) from public;
grant execute on function public.replace_sale_payments(uuid, jsonb) to authenticated;

commit;
