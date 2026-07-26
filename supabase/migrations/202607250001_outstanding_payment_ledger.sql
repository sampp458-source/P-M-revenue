-- 미수금 수납을 판매일과 분리된 결제일 기준 원장으로 보존한다.
-- 운영 Supabase SQL Editor에서 검토 후 직접 실행한다.
-- 기존 판매금액, 환불금액, 미수금 및 실매출 계산식은 변경하지 않는다.

begin;

-- 스키마를 변경하기 전에 기존 판매 스냅샷과 결제원장의 일관성을 감사한다.
-- 취소/환불 상태도 금액 스냅샷의 예외로 간주하지 않는다.
do $$
declare
  invalid_count bigint;
  payment_sum_expression text;
begin
  if to_regclass('public.sales') is null
    or to_regclass('public.sale_payments') is null then
    raise exception
      'sales 또는 sale_payments 테이블이 없습니다. 선행 Migration 적용 상태를 확인해주세요.'
      using errcode = 'P0001';
  end if;

  select count(*)
  into invalid_count
  from public.sales
  where original_amount + additional_amount - discount_amount < 0;

  if invalid_count > 0 then
    raise exception
      '최종 판매금액이 음수인 매출이 %건 있습니다. 데이터를 정리한 후 다시 실행해주세요.',
      invalid_count
      using errcode = 'P0001';
  end if;

  select count(*)
  into invalid_count
  from public.sales
  where paid_amount < 0;

  if invalid_count > 0 then
    raise exception
      '실제 결제금액이 음수인 매출이 %건 있습니다. 데이터를 정리한 후 다시 실행해주세요.',
      invalid_count
      using errcode = 'P0001';
  end if;

  select count(*)
  into invalid_count
  from public.sales
  where outstanding_amount < 0;

  if invalid_count > 0 then
    raise exception
      '미수금이 음수인 매출이 %건 있습니다. 데이터를 정리한 후 다시 실행해주세요.',
      invalid_count
      using errcode = 'P0001';
  end if;

  select count(*)
  into invalid_count
  from public.sales
  where paid_amount + outstanding_amount
    <> original_amount + additional_amount - discount_amount;

  if invalid_count > 0 then
    raise exception
      '실제 결제금액과 미수금의 합계가 최종 판매금액과 다른 매출이 %건 있습니다. 데이터를 정리한 후 다시 실행해주세요.',
      invalid_count
      using errcode = 'P0001';
  end if;

  select count(*)
  into invalid_count
  from public.sales
  where refund_amount > paid_amount;

  if invalid_count > 0 then
    raise exception
      '환불액이 실제 결제금액을 초과한 매출이 %건 있습니다. 데이터를 정리한 후 다시 실행해주세요.',
      invalid_count
      using errcode = 'P0001';
  end if;

  -- 전액환불과 미수잔액은 동시에 존재할 수 없다.
  select count(*)
  into invalid_count
  from public.sales
  where status = 'full_refund'
    and outstanding_amount <> 0;

  if invalid_count > 0 then
    raise exception
      '전액환불 상태이면서 미수금이 남은 매출이 %건 있습니다. 상태를 정리한 후 다시 실행해주세요.',
      invalid_count
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'sale_payments'
      and column_name = 'voided_at'
  ) then
    payment_sum_expression :=
      'coalesce(sum(sp.amount) filter (where sp.voided_at is null), 0)';
  else
    payment_sum_expression := 'coalesce(sum(sp.amount), 0)';
  end if;

  execute format(
    $audit$
      select count(*)
      from (
        select
          s.id,
          s.paid_amount,
          %s::bigint as ledger_paid_amount
        from public.sales s
        left join public.sale_payments sp on sp.sale_id = s.id
        group by s.id, s.paid_amount
      ) audited
      where audited.ledger_paid_amount <> audited.paid_amount
    $audit$,
    payment_sum_expression
  )
  into invalid_count;

  if invalid_count > 0 then
    raise exception
      '결제원장 합계와 sales.paid_amount가 다른 매출이 %건 있습니다. 데이터를 정리한 후 다시 실행해주세요.',
      invalid_count
      using errcode = 'P0001';
  end if;
end
$$;

alter table public.sale_payments
  add column if not exists payment_date date,
  add column if not exists note text,
  add column if not exists source text,
  add column if not exists request_id uuid,
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid,
  add column if not exists void_reason text;

-- 기존 결제에는 별도의 수납일 정보가 없으므로 임의의 created_at 대신
-- 연결된 원 매출의 sale_date를 가장 보수적인 기준일로 사용한다.
update public.sale_payments as payment
set
  payment_date = coalesce(payment.payment_date, sale.sale_date),
  source = coalesce(payment.source, 'initial'),
  request_id = coalesce(
    payment.request_id,
    md5('legacy-sale-payment:' || payment.id::text)::uuid
  )
from public.sales as sale
where sale.id = payment.sale_id
  and (
    payment.payment_date is null
    or payment.source is null
    or payment.request_id is null
  );

alter table public.sale_payments
  alter column payment_date set not null,
  alter column source set not null,
  alter column request_id set not null;

-- 제약 이름과 컬럼 순서에 의존하지 않고 정확히
-- (sale_id, payment_method) 두 컬럼으로 구성된 UNIQUE 제약을 모두 제거한다.
do $$
declare
  constraint_row record;
begin
  for constraint_row in
    select constraint_info.conname
    from pg_constraint as constraint_info
    where constraint_info.conrelid = 'public.sale_payments'::regclass
      and constraint_info.contype = 'u'
      and cardinality(constraint_info.conkey) = 2
      and (
        select array_agg(attribute.attname::text order by attribute.attname::text)
        from unnest(constraint_info.conkey) as key_column(attnum)
        join pg_attribute as attribute
          on attribute.attrelid = constraint_info.conrelid
          and attribute.attnum = key_column.attnum
      ) = array['payment_method', 'sale_id']::text[]
  loop
    execute format(
      'alter table public.sale_payments drop constraint %I',
      constraint_row.conname
    );
  end loop;
end
$$;

-- 동일 컬럼 조합의 독립 UNIQUE INDEX가 존재하는 경우에도 제거한다.
-- UNIQUE constraint가 소유한 index는 위에서 함께 제거되므로 여기서는 제외한다.
do $$
declare
  index_row record;
begin
  for index_row in
    select index_class.relname as index_name
    from pg_index as index_info
    join pg_class as index_class
      on index_class.oid = index_info.indexrelid
    where index_info.indrelid = 'public.sale_payments'::regclass
      and index_info.indisunique
      and index_info.indnkeyatts = 2
      and not exists (
        select 1
        from pg_constraint as constraint_info
        where constraint_info.conindid = index_info.indexrelid
      )
      and (
        select array_agg(attribute.attname::text order by attribute.attname::text)
        from unnest(
          string_to_array(index_info.indkey::text, ' ')::smallint[]
        ) with ordinality as key_column(attnum, position)
        join pg_attribute as attribute
          on attribute.attrelid = index_info.indrelid
          and attribute.attnum = key_column.attnum
        where key_column.position <= index_info.indnkeyatts
      ) = array['payment_method', 'sale_id']::text[]
  loop
    execute format(
      'drop index if exists public.%I',
      index_row.index_name
    );
  end loop;
end
$$;

alter table public.sale_payments
  drop constraint if exists sale_payments_sale_method_unique,
  drop constraint if exists sale_payments_source_check,
  drop constraint if exists sale_payments_void_metadata_check,
  drop constraint if exists sale_payments_amount_positive;

alter table public.sale_payments
  add constraint sale_payments_source_check
    check (source in ('initial', 'outstanding_collection', 'adjustment')),
  add constraint sale_payments_amount_positive
    check (amount > 0),
  add constraint sale_payments_void_metadata_check
    check (
      (
        voided_at is null
        and voided_by is null
        and void_reason is null
      )
      or (
        voided_at is not null
        and voided_by is not null
        and nullif(btrim(coalesce(void_reason, '')), '') is not null
      )
    );

-- voided_by 컬럼이 선행 작업에서 이미 생성됐더라도 profiles(id) FK를 보장한다.
do $$
begin
  if not exists (
    select 1
    from pg_constraint as constraint_info
    where constraint_info.conrelid = 'public.sale_payments'::regclass
      and constraint_info.confrelid = 'public.profiles'::regclass
      and constraint_info.contype = 'f'
      and cardinality(constraint_info.conkey) = 1
      and cardinality(constraint_info.confkey) = 1
      and (
        select attribute.attname
        from pg_attribute as attribute
        where attribute.attrelid = constraint_info.conrelid
          and attribute.attnum = constraint_info.conkey[1]
      ) = 'voided_by'
      and (
        select attribute.attname
        from pg_attribute as attribute
        where attribute.attrelid = constraint_info.confrelid
          and attribute.attnum = constraint_info.confkey[1]
      ) = 'id'
  ) then
    alter table public.sale_payments
      drop constraint if exists sale_payments_voided_by_profiles_fkey;

    alter table public.sale_payments
      add constraint sale_payments_voided_by_profiles_fkey
      foreign key (voided_by)
      references public.profiles(id)
      on delete set null;
  end if;
end
$$;

create unique index if not exists sale_payments_request_id_uidx
  on public.sale_payments(request_id);

create index if not exists sale_payments_sale_date_active_idx
  on public.sale_payments(sale_id, payment_date, created_at)
  where voided_at is null;

create index if not exists sale_payments_payment_date_active_idx
  on public.sale_payments(payment_date desc, created_at desc)
  where voided_at is null;

alter table public.sales
  add column if not exists initial_outstanding_amount integer,
  add column if not exists initial_outstanding_estimated boolean;

-- 기존 최초 미수금은 현재 outstanding_amount를 그대로 복사하지 않는다.
-- 현재 보존된 initial 원장 합계를 최종 판매금액에서 차감해 계산한다.
-- 다만 과거 미수 수납이 이미 하나의 기존 결제행으로 합쳐진 경우에는
-- 원래 최초 수납과 후속 수납을 분리할 근거가 없어 정확한 역사 복원이 불가능하다.
with initial_payment_totals as (
  select
    sale_id,
    coalesce(sum(amount) filter (where voided_at is null and source = 'initial'), 0)::integer
      as initial_paid_amount
  from public.sale_payments
  group by sale_id
)
update public.sales as sale
set initial_outstanding_amount =
  sale.original_amount
  + sale.additional_amount
  - sale.discount_amount
  - coalesce(initial_payment_totals.initial_paid_amount, 0)
from initial_payment_totals
where initial_payment_totals.sale_id = sale.id
  and sale.initial_outstanding_amount is null;

update public.sales as sale
set initial_outstanding_amount =
  sale.original_amount + sale.additional_amount - sale.discount_amount
where sale.initial_outstanding_amount is null;

-- Migration 이전 거래는 현재 보존 데이터로 계산한 추정값임을 명시한다.
-- 이 값은 정확한 최초 미수금 통계에 포함하면 안 된다.
update public.sales
set initial_outstanding_estimated = true
where initial_outstanding_estimated is null;

alter table public.sales
  alter column initial_outstanding_amount set not null,
  alter column initial_outstanding_amount set default 0,
  alter column initial_outstanding_estimated set not null,
  alter column initial_outstanding_estimated set default false,
  drop constraint if exists sales_initial_outstanding_nonnegative,
  drop constraint if exists sales_payment_balance_consistency;

alter table public.sales
  add constraint sales_initial_outstanding_nonnegative
    check (initial_outstanding_amount >= 0),
  add constraint sales_payment_balance_consistency
    check (
      paid_amount + outstanding_amount
      = original_amount + additional_amount - discount_amount
    );

drop trigger if exists sales_capture_initial_outstanding on public.sales;
drop function if exists public.capture_sale_initial_outstanding();

-- 원장 동기화 RPC만 마감된 원 판매일과 무관하게 수납 스냅샷을 갱신한다.
-- 일반 UPDATE는 기존 월 마감 및 유효성 검사를 그대로 통과해야 한다.
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
  ledger_sync_sale_id text :=
    current_setting('app.payment_ledger_sync_sale_id', true);
begin
  if tg_op = 'UPDATE'
    and ledger_sync_sale_id = new.id::text then
    if (
      to_jsonb(new)
        - array[
            'paid_amount',
            'outstanding_amount',
            'net_amount',
            'status',
            'updated_at'
          ]::text[]
    ) is distinct from (
      to_jsonb(old)
        - array[
            'paid_amount',
            'outstanding_amount',
            'net_amount',
            'status',
            'updated_at'
          ]::text[]
    ) then
      raise exception '결제원장 동기화 중에는 판매 원본 정보를 변경할 수 없습니다.'
        using errcode = 'P0001';
    end if;

    new.net_amount := new.paid_amount - new.refund_amount;

    if new.net_amount < 0 then
      raise exception '실매출은 음수가 될 수 없습니다.'
        using errcode = 'P0001';
    end if;

    if new.status = 'cancelled' then
      raise exception '취소된 매출의 결제금액은 변경할 수 없습니다.'
        using errcode = 'P0001';
    end if;

    new.status := case
      when new.refund_amount = 0 then 'normal'
      when new.refund_amount = new.paid_amount
        and new.paid_amount > 0
        and new.outstanding_amount = 0 then 'full_refund'
      else 'partial_refund'
    end;

    return new;
  end if;

  if tg_op = 'UPDATE'
    and (
      new.initial_outstanding_amount is distinct from old.initial_outstanding_amount
      or new.initial_outstanding_estimated is distinct from old.initial_outstanding_estimated
    ) then
    raise exception '최초 미수금 Snapshot은 변경할 수 없습니다.'
      using errcode = 'P0001';
  end if;

  if public.is_month_closed(new.sale_date)
    or (tg_op = 'UPDATE' and public.is_month_closed(old.sale_date)) then
    raise exception '마감된 월의 매출은 변경할 수 없습니다.'
      using errcode = 'P0001';
  end if;

  if tg_op = 'INSERT' then
    if not public.is_admin() then
      new.created_by := auth.uid();
      new.staff_id := auth.uid();
    else
      new.created_by := coalesce(new.created_by, auth.uid());
      new.staff_id := coalesce(new.staff_id, auth.uid());
    end if;

    select * into unit_row
    from public.business_units
    where id = new.business_unit_id;

    select * into product_row
    from public.products
    where id = new.product_id;

    if new.product_category_id is not null then
      select * into category_row
      from public.product_categories
      where id = new.product_category_id;
    end if;

    if unit_row.id is null or product_row.id is null then
      raise exception '유효하지 않은 사업부 또는 상품입니다.'
        using errcode = 'P0001';
    end if;

    if not unit_row.is_active or not product_row.is_active then
      raise exception '비활성 사업부 또는 상품은 선택할 수 없습니다.'
        using errcode = 'P0001';
    end if;

    if product_row.business_unit_id <> unit_row.id
      or product_row.category_id is distinct from new.product_category_id then
      raise exception '사업부와 상품 연결 정보가 일치하지 않습니다.'
        using errcode = 'P0001';
    end if;

    if new.product_category_id is not null
      and (
        category_row.id is null
        or not category_row.is_active
        or category_row.business_unit_id <> unit_row.id
      ) then
      raise exception '유효한 활성 상품 분류만 선택할 수 있습니다.'
        using errcode = 'P0001';
    end if;

    if new.dog_id is not null then
      select * into dog_row
      from public.dogs
      where id = new.dog_id;

      if dog_row.id is null or not dog_row.is_active then
        raise exception '유효한 활성 반려견만 선택할 수 있습니다.'
          using errcode = 'P0001';
      end if;

      new.customer_id := dog_row.customer_id;
      new.dog_name := dog_row.name;
    else
      new.dog_name := nullif(btrim(coalesce(new.dog_name, '')), '');
    end if;

    if new.customer_id is not null then
      select * into customer_row
      from public.customers
      where id = new.customer_id;

      if customer_row.id is null or not customer_row.is_active then
        raise exception '유효한 활성 보호자만 선택해 주세요.'
          using errcode = 'P0001';
      end if;

      new.customer_name := customer_row.name;
      new.customer_phone := customer_row.phone;
    else
      new.customer_name := nullif(btrim(coalesce(new.customer_name, '')), '');
      new.customer_phone := nullif(
        regexp_replace(coalesce(new.customer_phone, ''), '[^0-9]', '', 'g'),
        ''
      );
    end if;

    if new.staff_id is not null then
      select * into staff_row
      from public.profiles
      where id = new.staff_id;
    end if;

    new.business_unit_name := unit_row.name;
    new.product_category_name :=
      case when category_row.id is null then null else category_row.name end;
    new.product_name := product_row.name;
    new.staff_name :=
      case when staff_row.id is null then null else staff_row.name end;
  else
    if new.dog_id is distinct from old.dog_id
      or new.customer_id is distinct from old.customer_id then
      if new.dog_id is not null then
        select * into dog_row
        from public.dogs
        where id = new.dog_id;

        if dog_row.id is null or not dog_row.is_active then
          raise exception '유효한 활성 반려견만 선택할 수 있습니다.'
            using errcode = 'P0001';
        end if;

        new.customer_id := dog_row.customer_id;
        new.dog_name := dog_row.name;
      else
        new.dog_name := nullif(btrim(coalesce(new.dog_name, '')), '');
      end if;

      if new.customer_id is not null then
        select * into customer_row
        from public.customers
        where id = new.customer_id;

        if customer_row.id is null or not customer_row.is_active then
          raise exception '유효한 활성 보호자만 선택해 주세요.'
            using errcode = 'P0001';
        end if;

        new.customer_name := customer_row.name;
        new.customer_phone := customer_row.phone;
      else
        new.customer_name := nullif(btrim(coalesce(new.customer_name, '')), '');
        new.customer_phone := nullif(
          regexp_replace(coalesce(new.customer_phone, ''), '[^0-9]', '', 'g'),
          ''
        );
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
      select * into unit_row
      from public.business_units
      where id = new.business_unit_id;

      select * into product_row
      from public.products
      where id = new.product_id;

      if new.product_category_id is not null then
        select * into category_row
        from public.product_categories
        where id = new.product_category_id;
      end if;

      if unit_row.id is null
        or product_row.id is null
        or not unit_row.is_active
        or not product_row.is_active then
        raise exception '유효한 활성 사업부와 상품만 선택할 수 있습니다.'
          using errcode = 'P0001';
      end if;

      if product_row.business_unit_id <> unit_row.id
        or product_row.category_id is distinct from new.product_category_id then
        raise exception '사업부와 상품 연결 정보가 일치하지 않습니다.'
          using errcode = 'P0001';
      end if;

      if new.product_category_id is not null
        and (
          category_row.id is null
          or not category_row.is_active
          or category_row.business_unit_id <> unit_row.id
        ) then
        raise exception '유효한 활성 상품 분류만 선택할 수 있습니다.'
          using errcode = 'P0001';
      end if;

      new.business_unit_name := unit_row.name;
      new.product_category_name :=
        case when category_row.id is null then null else category_row.name end;
      new.product_name := product_row.name;
    else
      new.business_unit_name := old.business_unit_name;
      new.product_category_name := old.product_category_name;
      new.product_name := old.product_name;
    end if;

    if new.staff_id is distinct from old.staff_id then
      if new.staff_id is not null then
        select * into staff_row
        from public.profiles
        where id = new.staff_id;
      end if;

      new.staff_name :=
        case when staff_row.id is null then null else staff_row.name end;
    else
      new.staff_name := old.staff_name;
    end if;
  end if;

  new.net_amount := new.paid_amount - new.refund_amount;

  if new.net_amount < 0 then
    raise exception '실매출은 음수가 될 수 없습니다.'
      using errcode = 'P0001';
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
      when new.refund_amount = new.paid_amount and new.paid_amount > 0
        then 'full_refund'
      else 'partial_refund'
    end;
  end if;

  if tg_op = 'INSERT' then
    new.initial_outstanding_amount :=
      new.original_amount
      + new.additional_amount
      - new.discount_amount
      - new.paid_amount;
    new.initial_outstanding_estimated := false;

    if new.initial_outstanding_amount < 0 then
      raise exception '최초 미수금은 음수가 될 수 없습니다.'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

-- 기존 단일 결제 Trigger는 UPDATE 때 원장을 삭제·재생성했다.
-- 신규 매출 INSERT 시 최초 결제행을 한 번 생성하는 역할로 축소한다.
create or replace function public.sync_single_sale_payment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.paid_amount > 0
    and not exists (
      select 1
      from public.sale_payments
      where sale_id = new.id
    ) then
    insert into public.sale_payments (
      sale_id,
      payment_method,
      amount,
      payment_date,
      source,
      request_id,
      created_by,
      created_at
    )
    values (
      new.id,
      case
        when new.payment_method in ('card', 'transfer', 'cash', 'other')
          then new.payment_method
        else 'other'
      end,
      new.paid_amount,
      new.sale_date,
      'initial',
      gen_random_uuid(),
      new.created_by,
      new.created_at
    );
  end if;

  return new;
end;
$$;

drop trigger if exists sales_sync_single_payment on public.sales;
create trigger sales_sync_single_payment
  after insert on public.sales
  for each row execute function public.sync_single_sale_payment();

-- 분할결제 신규 등록도 최초 결제 원장에 sale_date와 source를 명시한다.
create or replace function public.create_sale_with_payments(
  p_sale jsonb,
  p_payments jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_sale_id uuid;
  payment_total integer;
  representative_method text;
  normalized_payments jsonb;
  new_sale_date date;
begin
  if auth.uid() is null or not public.is_active_user() then
    raise exception '권한이 없습니다.'
      using errcode = '42501';
  end if;

  normalized_payments := public.normalize_sale_payment_payload(p_payments);

  select coalesce(sum((item->>'amount')::integer), 0)
  into payment_total
  from jsonb_array_elements(normalized_payments) item;

  representative_method := normalized_payments->0->>'payment_method';
  new_sale_date := (p_sale->>'sale_date')::date;

  if payment_total <> coalesce((p_sale->>'paid_amount')::integer, 0) then
    raise exception '결제수단별 합계와 실제 결제금액이 일치하지 않습니다.'
      using errcode = '23514';
  end if;

  insert into public.sales (
    sale_date,
    business_unit_id,
    dog_id,
    customer_id,
    product_category_id,
    product_id,
    original_amount,
    quantity,
    unit_price,
    additional_amount,
    adjustment_note,
    discount_amount,
    paid_amount,
    refund_amount,
    outstanding_amount,
    net_amount,
    payment_method,
    customer_type,
    staff_id,
    memo,
    status,
    business_unit_name,
    dog_name,
    customer_name,
    customer_phone,
    product_category_name,
    product_name,
    created_by
  )
  values (
    new_sale_date,
    (p_sale->>'business_unit_id')::uuid,
    nullif(p_sale->>'dog_id', '')::uuid,
    nullif(p_sale->>'customer_id', '')::uuid,
    nullif(p_sale->>'product_category_id', '')::uuid,
    (p_sale->>'product_id')::uuid,
    coalesce((p_sale->>'original_amount')::integer, 0),
    coalesce((p_sale->>'quantity')::integer, 1),
    coalesce(
      (p_sale->>'unit_price')::integer,
      (p_sale->>'original_amount')::integer,
      0
    ),
    coalesce((p_sale->>'additional_amount')::integer, 0),
    nullif(p_sale->>'adjustment_note', ''),
    coalesce((p_sale->>'discount_amount')::integer, 0),
    payment_total,
    0,
    coalesce((p_sale->>'outstanding_amount')::integer, 0),
    payment_total,
    representative_method,
    p_sale->>'customer_type',
    nullif(p_sale->>'staff_id', '')::uuid,
    nullif(p_sale->>'memo', ''),
    'normal',
    coalesce(p_sale->>'business_unit_name', ''),
    nullif(p_sale->>'dog_name', ''),
    nullif(p_sale->>'customer_name', ''),
    nullif(p_sale->>'customer_phone', ''),
    nullif(p_sale->>'product_category_name', ''),
    coalesce(p_sale->>'product_name', ''),
    auth.uid()
  )
  returning id into new_sale_id;

  -- INSERT Trigger가 만든 대표 결제행을 같은 트랜잭션 안에서 분할 원장으로 교체한다.
  delete from public.sale_payments
  where sale_id = new_sale_id;

  insert into public.sale_payments (
    sale_id,
    payment_method,
    amount,
    payment_date,
    source,
    request_id,
    created_by
  )
  select
    new_sale_id,
    item->>'payment_method',
    (item->>'amount')::integer,
    new_sale_date,
    'initial',
    gen_random_uuid(),
    auth.uid()
  from jsonb_array_elements(normalized_payments) item;

  return new_sale_id;
end;
$$;

-- 기존 결제 상세 전체 교체 RPC는 과거 원장을 삭제하므로 더 이상 노출하지 않는다.
revoke all on function public.replace_sale_payments(uuid, jsonb)
  from public, anon, authenticated;

create or replace function public.add_sale_payment(
  p_sale_id uuid,
  p_amount integer,
  p_payment_method text,
  p_payment_date date,
  p_note text,
  p_request_id uuid
)
returns public.sale_payments
language plpgsql
security definer
set search_path = public
as $$
declare
  sale_row public.sales%rowtype;
  existing_payment public.sale_payments%rowtype;
  created_payment public.sale_payments%rowtype;
  active_paid_amount integer;
  final_sale_amount integer;
  new_outstanding_amount integer;
  normalized_note text := nullif(btrim(coalesce(p_note, '')), '');
  today_in_korea date := (now() at time zone 'Asia/Seoul')::date;
begin
  if auth.uid() is null or not public.is_active_user() then
    raise exception '승인된 활성 계정만 미수금을 수납할 수 있습니다.'
      using errcode = '42501';
  end if;

  if p_request_id is null then
    raise exception '결제 요청 식별값이 필요합니다.'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));

  select *
  into existing_payment
  from public.sale_payments
  where request_id = p_request_id;

  if existing_payment.id is not null then
    if existing_payment.sale_id = p_sale_id
      and existing_payment.amount = p_amount
      and existing_payment.payment_method = p_payment_method
      and existing_payment.payment_date = p_payment_date
      and existing_payment.source = 'outstanding_collection'
      and existing_payment.note is not distinct from normalized_note then
      return existing_payment;
    end if;

    raise exception '이미 다른 결제 요청에 사용된 요청 식별값입니다.'
      using errcode = '23505';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception '수납 금액은 0원보다 커야 합니다.'
      using errcode = '22023';
  end if;

  if p_payment_method is null
    or p_payment_method not in ('card', 'transfer', 'cash', 'other') then
    raise exception '결제수단은 카드, 계좌이체, 현금, 기타만 사용할 수 있습니다.'
      using errcode = '22023';
  end if;

  if p_payment_date is null then
    raise exception '결제일을 입력해 주세요.'
      using errcode = '22023';
  end if;

  if p_payment_date > today_in_korea then
    raise exception '미래 날짜로 결제를 처리할 수 없습니다.'
      using errcode = '22023';
  end if;

  select *
  into sale_row
  from public.sales
  where id = p_sale_id
  for update;

  if sale_row.id is null then
    raise exception '수납할 매출을 찾을 수 없습니다.'
      using errcode = 'P0002';
  end if;

  if p_payment_date < sale_row.sale_date then
    raise exception '결제일은 매출일보다 빠를 수 없습니다.'
      using errcode = '22023';
  end if;

  if public.is_month_closed(p_payment_date) then
    raise exception '마감된 월의 결제는 등록할 수 없습니다.'
      using errcode = 'P0001';
  end if;

  if sale_row.status = 'cancelled' then
    raise exception '취소된 매출에는 결제를 추가할 수 없습니다.'
      using errcode = 'P0001';
  end if;

  if sale_row.status = 'full_refund' then
    if sale_row.outstanding_amount <> 0 then
      raise exception '전액환불 상태와 미수금이 동시에 존재합니다. 관리자에게 문의해주세요.'
        using errcode = 'P0001';
    end if;

    raise exception '전액환불된 매출에는 결제를 추가할 수 없습니다.'
      using errcode = 'P0001';
  end if;

  if sale_row.status not in ('normal', 'partial_refund') then
    raise exception '현재 상태에서는 결제를 추가할 수 없습니다.'
      using errcode = 'P0001';
  end if;

  if sale_row.outstanding_amount <= 0 then
    raise exception '남아 있는 미수금이 없습니다.'
      using errcode = 'P0001';
  end if;

  if p_amount > sale_row.outstanding_amount then
    raise exception '수납 금액이 현재 미수금을 초과합니다.'
      using errcode = '23514';
  end if;

  insert into public.sale_payments (
    sale_id,
    payment_method,
    amount,
    payment_date,
    note,
    source,
    request_id,
    created_by
  )
  values (
    sale_row.id,
    p_payment_method,
    p_amount,
    p_payment_date,
    normalized_note,
    'outstanding_collection',
    p_request_id,
    auth.uid()
  )
  returning * into created_payment;

  select coalesce(sum(amount), 0)::integer
  into active_paid_amount
  from public.sale_payments
  where sale_id = sale_row.id
    and voided_at is null;

  final_sale_amount :=
    sale_row.original_amount
    + sale_row.additional_amount
    - sale_row.discount_amount;
  new_outstanding_amount := final_sale_amount - active_paid_amount;

  if new_outstanding_amount < 0 then
    raise exception '유효 결제원장 합계가 최종 판매금액을 초과합니다.'
      using errcode = '23514';
  end if;

  if active_paid_amount < sale_row.refund_amount then
    raise exception '유효 수납액이 누적 환불액보다 작을 수 없습니다.'
      using errcode = '23514';
  end if;

  perform set_config(
    'app.payment_ledger_sync_sale_id',
    sale_row.id::text,
    true
  );

  update public.sales
  set
    paid_amount = active_paid_amount,
    outstanding_amount = new_outstanding_amount,
    net_amount = active_paid_amount - refund_amount
  where id = sale_row.id;

  perform set_config('app.payment_ledger_sync_sale_id', '', true);

  return created_payment;
end;
$$;

create or replace function public.void_sale_payment(
  p_payment_id uuid,
  p_reason text
)
returns public.sale_payments
language plpgsql
security definer
set search_path = public
as $$
declare
  payment_row public.sale_payments%rowtype;
  sale_row public.sales%rowtype;
  active_paid_amount integer;
  final_sale_amount integer;
  new_outstanding_amount integer;
  normalized_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception '결제 무효화는 관리자만 처리할 수 있습니다.'
      using errcode = '42501';
  end if;

  select *
  into payment_row
  from public.sale_payments
  where id = p_payment_id
  for update;

  if payment_row.id is null then
    raise exception '결제 기록을 찾을 수 없습니다.'
      using errcode = 'P0002';
  end if;

  if payment_row.voided_at is not null then
    return payment_row;
  end if;

  if normalized_reason is null then
    raise exception '결제 무효화 사유를 입력해 주세요.'
      using errcode = '22023';
  end if;

  if public.is_month_closed(payment_row.payment_date) then
    raise exception '마감된 월의 결제는 무효화할 수 없습니다.'
      using errcode = 'P0001';
  end if;

  select *
  into sale_row
  from public.sales
  where id = payment_row.sale_id
  for update;

  if sale_row.id is null then
    raise exception '연결된 매출을 찾을 수 없습니다.'
      using errcode = 'P0002';
  end if;

  select coalesce(sum(amount), 0)::integer
  into active_paid_amount
  from public.sale_payments
  where sale_id = sale_row.id
    and voided_at is null
    and id <> payment_row.id;

  if active_paid_amount < sale_row.refund_amount then
    raise exception '환불액에 대응하는 결제는 무효화할 수 없습니다.'
      using errcode = '23514';
  end if;

  final_sale_amount :=
    sale_row.original_amount
    + sale_row.additional_amount
    - sale_row.discount_amount;
  new_outstanding_amount := final_sale_amount - active_paid_amount;

  if new_outstanding_amount < 0 then
    raise exception '유효 결제원장 합계가 최종 판매금액을 초과합니다.'
      using errcode = '23514';
  end if;

  if sale_row.status = 'full_refund'
    and new_outstanding_amount <> 0 then
    raise exception '전액환불 거래에 미수잔액을 만들 수 없습니다.'
      using errcode = '23514';
  end if;

  update public.sale_payments
  set
    voided_at = now(),
    voided_by = auth.uid(),
    void_reason = normalized_reason
  where id = payment_row.id
  returning * into payment_row;

  perform set_config(
    'app.payment_ledger_sync_sale_id',
    sale_row.id::text,
    true
  );

  update public.sales
  set
    paid_amount = active_paid_amount,
    outstanding_amount = new_outstanding_amount,
    net_amount = active_paid_amount - refund_amount
  where id = sale_row.id;

  perform set_config('app.payment_ledger_sync_sale_id', '', true);

  return payment_row;
end;
$$;

-- 결제금액 스냅샷은 유효 결제원장과 일치할 때만 변경할 수 있다.
create or replace function public.protect_sale_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ledger_refund_amount integer;
  ledger_paid_amount integer;
  final_sale_amount integer;
begin
  if old.created_by <> new.created_by then
    raise exception '매출 등록자는 변경할 수 없습니다.'
      using errcode = 'P0001';
  end if;

  if not public.is_admin() and (
    old.refund_amount <> new.refund_amount
    or old.status <> new.status
    or old.cancelled_at is distinct from new.cancelled_at
    or old.cancelled_by is distinct from new.cancelled_by
    or old.cancellation_reason is distinct from new.cancellation_reason
    or old.staff_id is distinct from new.staff_id
  ) then
    raise exception '환불, 취소와 담당자 변경은 관리자만 처리할 수 있습니다.'
      using errcode = '42501';
  end if;

  if old.refund_amount <> new.refund_amount then
    select coalesce(sum(amount), 0)::integer
    into ledger_refund_amount
    from public.sale_refunds
    where sale_id = new.id
      and voided_at is null;

    if new.refund_amount <> ledger_refund_amount then
      raise exception '환불 금액은 환불 처리 기능을 통해서만 변경할 수 있습니다.'
        using errcode = 'P0001';
    end if;
  end if;

  if old.paid_amount <> new.paid_amount
    or old.outstanding_amount <> new.outstanding_amount then
    select coalesce(sum(amount), 0)::integer
    into ledger_paid_amount
    from public.sale_payments
    where sale_id = new.id
      and voided_at is null;

    final_sale_amount :=
      new.original_amount + new.additional_amount - new.discount_amount;

    if new.paid_amount <> ledger_paid_amount
      or new.outstanding_amount <> final_sale_amount - ledger_paid_amount
      or new.net_amount <> ledger_paid_amount - new.refund_amount then
      raise exception '결제금액과 미수금은 결제 처리 기능을 통해서만 변경할 수 있습니다.'
        using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;

alter table public.sale_payments enable row level security;

drop policy if exists sale_payments_select on public.sale_payments;
drop policy if exists sale_payments_insert on public.sale_payments;
drop policy if exists sale_payments_update on public.sale_payments;
drop policy if exists sale_payments_delete on public.sale_payments;

-- 이름이 다른 과거 쓰기 정책도 남지 않도록 제거한다.
do $$
declare
  policy_row record;
begin
  for policy_row in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'sale_payments'
      and cmd in ('ALL', 'INSERT', 'UPDATE', 'DELETE')
  loop
    execute format(
      'drop policy if exists %I on public.sale_payments',
      policy_row.policyname
    );
  end loop;
end
$$;

create policy sale_payments_select
  on public.sale_payments
  for select
  to authenticated
  using (public.is_active_user());

revoke all on table public.sale_payments from public, anon, authenticated;
grant select on table public.sale_payments to authenticated;

revoke all on function public.sync_single_sale_payment()
  from public, anon, authenticated;
revoke all on function public.create_sale_with_payments(jsonb, jsonb)
  from public, anon;
revoke all on function public.add_sale_payment(uuid, integer, text, date, text, uuid)
  from public, anon;
revoke all on function public.void_sale_payment(uuid, text)
  from public, anon;

grant execute on function public.create_sale_with_payments(jsonb, jsonb)
  to authenticated;
grant execute on function public.add_sale_payment(uuid, integer, text, date, text, uuid)
  to authenticated;
grant execute on function public.void_sale_payment(uuid, text)
  to authenticated;

-- 적용 직후에도 원장과 판매 스냅샷이 일치하지 않으면 트랜잭션 전체를 중단한다.
do $$
declare
  invalid_count bigint;
begin
  select count(*)
  into invalid_count
  from (
    select
      sale.id,
      sale.paid_amount,
      coalesce(sum(payment.amount) filter (where payment.voided_at is null), 0)::bigint
        as ledger_paid_amount
    from public.sales as sale
    left join public.sale_payments as payment
      on payment.sale_id = sale.id
    group by sale.id, sale.paid_amount
  ) audited
  where audited.ledger_paid_amount <> audited.paid_amount;

  if invalid_count > 0 then
    raise exception
      'Migration 적용 후 결제원장 합계가 일치하지 않는 매출이 %건입니다.',
      invalid_count
      using errcode = 'P0001';
  end if;
end
$$;

commit;
