-- 환불 처리일과 복수 부분환불을 보존하는 이벤트 원장.
-- 기존 sales.refund_amount, net_amount, status 계산은 그대로 유지한다.

begin;

create table public.sale_refunds (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id),
  refund_date date null,
  amount integer not null check (amount > 0),
  reason text null,
  created_by uuid null references public.profiles(id),
  created_at timestamptz not null default now(),
  source_history_id uuid null unique references public.sale_history(id),
  is_legacy boolean not null default false,
  voided_at timestamptz null,
  voided_by uuid null references public.profiles(id),
  void_reason text null,
  constraint sale_refunds_current_metadata_check check (
    is_legacy
    or (refund_date is not null and created_by is not null)
  ),
  constraint sale_refunds_void_metadata_check check (
    (voided_at is null and voided_by is null and void_reason is null)
    or (voided_at is not null and voided_by is not null)
  )
);

create index sale_refunds_sale_date_idx
  on public.sale_refunds(sale_id, refund_date, created_at);

create index sale_refunds_refund_date_idx
  on public.sale_refunds(refund_date desc)
  where voided_at is null;

-- sale_history가 증명하는 기존 환불 증액분만 처리 시각 기준으로 복원한다.
with history_refunds as (
  select
    history.id as source_history_id,
    history.sale_id,
    (history.created_at at time zone 'Asia/Seoul')::date as refund_date,
    greatest(
      coalesce((history.changed_data ->> 'refund_amount')::integer, 0)
      - coalesce((history.previous_data ->> 'refund_amount')::integer, 0),
      0
    ) as amount,
    history.changed_by as created_by,
    history.created_at
  from public.sale_history as history
  where history.action in ('partial_refund', 'full_refund')
),
recoverable_sales as (
  select event.sale_id
  from history_refunds as event
  join public.sales as sale on sale.id = event.sale_id
  group by event.sale_id, sale.refund_amount
  having sum(event.amount) <= sale.refund_amount
)
insert into public.sale_refunds (
  sale_id,
  refund_date,
  amount,
  reason,
  created_by,
  created_at,
  source_history_id,
  is_legacy
)
select
  event.sale_id,
  event.refund_date,
  event.amount,
  null,
  event.created_by,
  event.created_at,
  event.source_history_id,
  false
from history_refunds as event
join recoverable_sales on recoverable_sales.sale_id = event.sale_id
where event.amount > 0
on conflict (source_history_id) do nothing;

-- 이력으로 복원할 수 없는 잔여 환불액은 날짜와 처리자를 추측하지 않는다.
with recorded as (
  select sale_id, coalesce(sum(amount), 0)::integer as amount
  from public.sale_refunds
  where voided_at is null
  group by sale_id
),
legacy_balance as (
  select
    sale.id as sale_id,
    sale.refund_amount - coalesce(recorded.amount, 0) as amount
  from public.sales as sale
  left join recorded on recorded.sale_id = sale.id
  where sale.refund_amount > coalesce(recorded.amount, 0)
)
insert into public.sale_refunds (
  sale_id,
  refund_date,
  amount,
  reason,
  created_by,
  source_history_id,
  is_legacy
)
select
  legacy.sale_id,
  null,
  legacy.amount,
  '기존 환불 데이터 이관 (처리일 미확인)',
  null,
  null,
  true
from legacy_balance as legacy
where legacy.amount > 0;

alter table public.sale_refunds enable row level security;

drop policy if exists sale_refunds_select_active
  on public.sale_refunds;

create policy sale_refunds_select_active
  on public.sale_refunds
  for select
  to authenticated
  using (public.is_active_user());

revoke all on table public.sale_refunds from anon, authenticated;
grant select on table public.sale_refunds to authenticated;

create or replace function public.record_sale_refund(
  p_sale_id uuid,
  p_refund_date date,
  p_amount integer,
  p_reason text default null
)
returns public.sale_refunds
language plpgsql
security definer
set search_path = public
as $$
declare
  sale_row public.sales%rowtype;
  refund_row public.sale_refunds%rowtype;
  today_in_korea date := (now() at time zone 'Asia/Seoul')::date;
  remaining_amount integer;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception '환불은 관리자만 처리할 수 있습니다.' using errcode = '42501';
  end if;

  if p_refund_date is null then
    raise exception '환불 처리일을 입력해 주세요.' using errcode = 'P0001';
  end if;

  if p_refund_date > today_in_korea then
    raise exception '미래 날짜로 환불을 처리할 수 없습니다.' using errcode = 'P0001';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception '환불 금액은 0원보다 커야 합니다.' using errcode = 'P0001';
  end if;

  select *
  into sale_row
  from public.sales
  where id = p_sale_id
  for update;

  if sale_row.id is null then
    raise exception '환불할 매출을 찾을 수 없습니다.' using errcode = 'P0001';
  end if;

  if sale_row.status = 'cancelled' then
    raise exception '취소된 매출은 환불할 수 없습니다.' using errcode = 'P0001';
  end if;

  if p_refund_date < sale_row.sale_date then
    raise exception '환불 처리일은 매출일보다 빠를 수 없습니다.' using errcode = 'P0001';
  end if;

  remaining_amount := sale_row.paid_amount - sale_row.refund_amount;
  if p_amount > remaining_amount then
    raise exception '환불 금액이 남은 환불 가능액을 초과합니다.' using errcode = 'P0001';
  end if;

  insert into public.sale_refunds (
    sale_id,
    refund_date,
    amount,
    reason,
    created_by
  )
  values (
    sale_row.id,
    p_refund_date,
    p_amount,
    nullif(btrim(coalesce(p_reason, '')), ''),
    auth.uid()
  )
  returning * into refund_row;

  update public.sales
  set refund_amount = sale_row.refund_amount + p_amount
  where id = sale_row.id;

  return refund_row;
end;
$$;

create or replace function public.void_sale_refund(
  p_refund_id uuid,
  p_reason text
)
returns public.sale_refunds
language plpgsql
security definer
set search_path = public
as $$
declare
  refund_row public.sale_refunds%rowtype;
  sale_row public.sales%rowtype;
  remaining_refund integer;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception '환불 기록 취소는 관리자만 처리할 수 있습니다.' using errcode = '42501';
  end if;

  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception '환불 기록 취소 사유를 입력해 주세요.' using errcode = 'P0001';
  end if;

  select *
  into refund_row
  from public.sale_refunds
  where id = p_refund_id
  for update;

  if refund_row.id is null then
    raise exception '환불 기록을 찾을 수 없습니다.' using errcode = 'P0001';
  end if;

  if refund_row.is_legacy then
    raise exception '처리일을 확인할 수 없는 기존 환불 기록은 취소할 수 없습니다.' using errcode = 'P0001';
  end if;

  if refund_row.voided_at is not null then
    raise exception '이미 취소된 환불 기록입니다.' using errcode = 'P0001';
  end if;

  select *
  into sale_row
  from public.sales
  where id = refund_row.sale_id
  for update;

  update public.sale_refunds
  set
    voided_at = now(),
    voided_by = auth.uid(),
    void_reason = btrim(p_reason)
  where id = refund_row.id
  returning * into refund_row;

  select coalesce(sum(amount), 0)::integer
  into remaining_refund
  from public.sale_refunds
  where sale_id = refund_row.sale_id
    and voided_at is null;

  update public.sales
  set refund_amount = remaining_refund
  where id = refund_row.sale_id;

  return refund_row;
end;
$$;

-- 기존 보호 조건을 유지하면서 refund_amount가 원장 합계와 어긋나는 변경을 차단한다.
create or replace function public.protect_sale_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ledger_refund_amount integer;
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

  if old.refund_amount <> new.refund_amount then
    select coalesce(sum(amount), 0)::integer
    into ledger_refund_amount
    from public.sale_refunds
    where sale_id = new.id
      and voided_at is null;

    if new.refund_amount <> ledger_refund_amount then
      raise exception '환불 금액은 환불 처리 기능을 통해서만 변경할 수 있습니다.' using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.record_sale_refund(uuid, date, integer, text)
  from public;
revoke all on function public.void_sale_refund(uuid, text)
  from public;

grant execute on function public.record_sale_refund(uuid, date, integer, text)
  to authenticated;
grant execute on function public.void_sale_refund(uuid, text)
  to authenticated;

commit;
