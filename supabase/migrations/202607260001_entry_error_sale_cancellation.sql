begin;

-- 과거 취소는 자동 분류하지 않는다. 신규 취소만 유형을 명시한다.
alter table public.sales
  add column if not exists cancellation_type text,
  add column if not exists cancellation_request_id uuid;

alter table public.sales
  drop constraint if exists sales_cancellation_type_check;

alter table public.sales
  add constraint sales_cancellation_type_check
  check (
    cancellation_type is null
    or cancellation_type in ('entry_error', 'general', 'legacy')
  );

alter table public.sales
  drop constraint if exists sales_cancellation_type_state_check;

alter table public.sales
  add constraint sales_cancellation_type_state_check
  check (
    (
      status = 'cancelled'
      and (
        cancellation_type is null
        or cancellation_type in ('entry_error', 'general', 'legacy')
      )
    )
    or (
      status <> 'cancelled'
      and cancellation_type is null
    )
  );

alter table public.sales
  drop constraint if exists sales_entry_error_request_check;

alter table public.sales
  add constraint sales_entry_error_request_check
  check (
    (
      cancellation_type = 'entry_error'
      and cancellation_request_id is not null
    )
    or (
      cancellation_type in ('general', 'legacy')
      and cancellation_request_id is null
    )
    or cancellation_type is null
  );

create unique index if not exists sales_cancellation_request_id_uidx
  on public.sales(cancellation_request_id)
  where cancellation_request_id is not null;

-- 신규 취소 유형과 원장 상태가 서로 모순되지 않도록 보호한다.
create or replace function public.protect_sale_cancellation_type()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  active_payment_count integer;
  active_refund_count integer;
  entry_error_cancel_sale_id text :=
    current_setting('app.entry_error_cancel_sale_id', true);
begin
  if tg_op = 'INSERT' then
    if new.status = 'cancelled'
      or new.cancellation_type is not null
      or new.cancellation_request_id is not null then
      raise exception '신규 매출은 취소 상태로 등록할 수 없습니다.'
        using errcode = 'P0001';
    end if;

    return new;
  end if;

  if auth.uid() is not null
    and not public.is_admin()
    and (
      new.cancellation_type is distinct from old.cancellation_type
      or new.cancellation_request_id is distinct from old.cancellation_request_id
    ) then
    raise exception '취소 유형은 관리자만 변경할 수 있습니다.'
      using errcode = '42501';
  end if;

  if old.cancellation_request_id is not null
    and new.cancellation_request_id is distinct from old.cancellation_request_id then
    raise exception '처리 완료된 취소 요청 ID는 변경할 수 없습니다.'
      using errcode = 'P0001';
  end if;

  if old.status <> 'cancelled' and new.status = 'cancelled' then
    if new.cancellation_type is null
      or new.cancellation_type not in ('entry_error', 'general') then
      raise exception '취소 유형을 선택해 주세요.'
        using errcode = '22023';
    end if;

    select count(*)
    into active_payment_count
    from public.sale_payments
    where sale_id = new.id
      and voided_at is null;

    select count(*)
    into active_refund_count
    from public.sale_refunds
    where sale_id = new.id
      and voided_at is null;

    if active_refund_count > 0 then
      raise exception '환불 이력이 있는 거래는 취소할 수 없습니다.'
        using errcode = 'P0001';
    end if;

    if new.cancellation_type = 'entry_error' then
      if entry_error_cancel_sale_id is distinct from new.id::text then
        raise exception '오등록 취소 기능을 통해서만 처리할 수 있습니다.'
          using errcode = 'P0001';
      end if;

      if new.cancellation_request_id is null then
        raise exception '오등록 취소 요청 ID가 필요합니다.'
          using errcode = '22023';
      end if;

      if active_payment_count > 0 then
        raise exception '오등록 취소 전에 연결된 결제원장을 무효화해야 합니다.'
          using errcode = 'P0001';
      end if;
    else
      if active_payment_count > 0
        or new.paid_amount <> 0
        or new.refund_amount <> 0 then
        raise exception '결제 이력이 있는 거래는 일반 취소할 수 없습니다. 환불 또는 오등록 취소를 사용해 주세요.'
          using errcode = 'P0001';
      end if;
    end if;
  end if;

  if old.status = 'cancelled' and new.status <> 'cancelled' then
    if new.cancellation_type is not null
      or new.cancellation_request_id is distinct from old.cancellation_request_id then
      raise exception '취소 복구 시 취소 유형만 초기화하고 요청 ID는 보존해야 합니다.'
        using errcode = 'P0001';
    end if;
  elsif old.status = 'cancelled'
    and (
      new.cancellation_type is distinct from old.cancellation_type
      or new.cancellation_request_id is distinct from old.cancellation_request_id
    ) then
    raise exception '취소 완료 후 취소 유형은 변경할 수 없습니다.'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists sales_protect_cancellation_type_before_update
  on public.sales;
drop trigger if exists sales_protect_cancellation_type_before_write
  on public.sales;

create trigger sales_protect_cancellation_type_before_write
  before insert or update on public.sales
  for each row execute function public.protect_sale_cancellation_type();

-- 실제 입금이 없던 오등록만 한 트랜잭션으로 취소한다.
create or replace function public.cancel_sale_as_entry_error(
  p_sale_id uuid,
  p_reason text,
  p_confirm_no_payment boolean,
  p_request_id uuid
)
returns public.sales
language plpgsql
security definer
set search_path = public
as $$
declare
  sale_row public.sales%rowtype;
  existing_sale public.sales%rowtype;
  normalized_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  prohibited_payment_count integer;
  active_refund_count integer;
  final_sale_amount integer;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception '오등록 취소는 관리자만 처리할 수 있습니다.'
      using errcode = '42501';
  end if;

  if p_sale_id is null then
    raise exception '취소할 매출을 선택해 주세요.'
      using errcode = '22023';
  end if;

  if p_request_id is null then
    raise exception '오등록 취소 요청 ID가 필요합니다.'
      using errcode = '22023';
  end if;

  if p_confirm_no_payment is distinct from true then
    raise exception '실제 입금이 없었다는 확인이 필요합니다.'
      using errcode = '22023';
  end if;

  if normalized_reason is null then
    raise exception '오등록 취소 사유를 입력해 주세요.'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_request_id::text, 0)
  );

  select *
  into existing_sale
  from public.sales
  where cancellation_request_id = p_request_id;

  if existing_sale.id is not null then
    if existing_sale.id <> p_sale_id
      or existing_sale.cancellation_type <> 'entry_error'
      or existing_sale.status <> 'cancelled' then
      raise exception '이미 다른 작업에 사용된 요청 ID입니다.'
        using errcode = '23505';
    end if;

    return existing_sale;
  end if;

  select *
  into sale_row
  from public.sales
  where id = p_sale_id
  for update;

  if sale_row.id is null then
    raise exception '취소할 매출을 찾을 수 없습니다.'
      using errcode = 'P0002';
  end if;

  if sale_row.status = 'cancelled' then
    raise exception '이미 취소된 매출입니다.'
      using errcode = 'P0001';
  end if;

  if sale_row.status <> 'normal' then
    raise exception '환불 상태의 거래는 오등록 취소할 수 없습니다.'
      using errcode = 'P0001';
  end if;

  if public.is_month_closed(sale_row.sale_date) then
    raise exception '마감된 월의 매출은 오등록 취소할 수 없습니다.'
      using errcode = 'P0001';
  end if;

  perform 1
  from public.sale_payments
  where sale_id = sale_row.id
    and voided_at is null
  for update;

  perform 1
  from public.sale_refunds
  where sale_id = sale_row.id
    and voided_at is null
  for update;

  select count(*)
  into active_refund_count
  from public.sale_refunds
  where sale_id = sale_row.id
    and voided_at is null;

  if active_refund_count > 0 or sale_row.refund_amount <> 0 then
    raise exception '환불 이력이 있는 거래는 오등록 취소할 수 없습니다.'
      using errcode = 'P0001';
  end if;

  select count(*)
  into prohibited_payment_count
  from public.sale_payments
  where sale_id = sale_row.id
    and voided_at is null
    and source is distinct from 'initial';

  if prohibited_payment_count > 0 then
    raise exception '미수 수납 또는 조정 결제 이력이 있는 거래는 오등록 취소할 수 없습니다.'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.sale_payments
    where sale_id = sale_row.id
      and voided_at is null
      and public.is_month_closed(payment_date)
  ) then
    raise exception '마감된 월의 결제원장은 오등록 취소할 수 없습니다.'
      using errcode = 'P0001';
  end if;

  update public.sale_payments
  set
    voided_at = now(),
    voided_by = auth.uid(),
    void_reason = '오등록 취소: ' || normalized_reason
  where sale_id = sale_row.id
    and voided_at is null;

  final_sale_amount :=
    sale_row.original_amount
    + sale_row.additional_amount
    - sale_row.discount_amount;

  perform set_config(
    'app.entry_error_cancel_sale_id',
    sale_row.id::text,
    true
  );

  update public.sales
  set
    status = 'cancelled',
    cancellation_type = 'entry_error',
    cancellation_request_id = p_request_id,
    cancellation_reason = normalized_reason,
    paid_amount = 0,
    outstanding_amount = final_sale_amount,
    net_amount = 0
  where id = sale_row.id
  returning * into sale_row;

  perform set_config('app.entry_error_cancel_sale_id', '', true);

  return sale_row;
end;
$$;

revoke all on function public.cancel_sale_as_entry_error(
  uuid,
  text,
  boolean,
  uuid
) from public, anon;

grant execute on function public.cancel_sale_as_entry_error(
  uuid,
  text,
  boolean,
  uuid
) to authenticated;

-- 적용 후 오등록 취소와 원장 Snapshot이 모순되면 전체를 되돌린다.
do $$
declare
  invalid_count bigint;
begin
  select count(*)
  into invalid_count
  from public.sales as sale
  where sale.cancellation_type = 'entry_error'
    and (
      sale.status <> 'cancelled'
      or sale.cancellation_request_id is null
      or sale.refund_amount <> 0
      or exists (
        select 1
        from public.sale_payments as payment
        where payment.sale_id = sale.id
          and payment.voided_at is null
      )
      or exists (
        select 1
        from public.sale_refunds as refund
        where refund.sale_id = sale.id
          and refund.voided_at is null
      )
      or sale.paid_amount <> 0
      or sale.net_amount <> 0
      or sale.paid_amount + sale.outstanding_amount
        <> sale.original_amount + sale.additional_amount - sale.discount_amount
    );

  if invalid_count > 0 then
    raise exception
      '오등록 취소 무결성이 맞지 않는 매출이 %건 있습니다.',
      invalid_count
      using errcode = 'P0001';
  end if;
end
$$;

commit;
