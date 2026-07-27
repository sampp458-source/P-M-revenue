begin;

-- 환불까지 진행된 오등록 정정은 기존 오등록 취소와 같은 원장 보호 구간을
-- 사용하되, 아래 전용 RPC에서만 세션 로컬로 활성화한다.
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
    if entry_error_cancel_sale_id is distinct from new.id::text
      or old.cancellation_type is not null
      or new.cancellation_type <> 'entry_error'
      or new.cancellation_request_id is null then
      raise exception '취소 완료 후 취소 유형은 변경할 수 없습니다.'
        using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;

-- legacy cancelled 거래를 entry_error로 재분류할 때는 상태가 cancelled로
-- 유지되므로, 환불 이벤트가 아니라 일반 변경 이력으로 정확히 남긴다.
create or replace function public.record_sale_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  action_name text;
begin
  if auth.uid() is null
    and current_setting('app.skip_sale_history', true) = 'true' then
    if tg_op = 'DELETE' then
      return old;
    end if;

    return new;
  end if;

  if tg_op = 'INSERT' then
    insert into public.sale_history
      (sale_id, action, previous_data, changed_data, changed_by)
    values (new.id, 'created', null, to_jsonb(new), auth.uid());
    return new;
  end if;

  action_name := case
    when old.status = 'cancelled'
      and new.status = 'cancelled'
      and old.cancellation_type is null
      and new.cancellation_type = 'entry_error' then 'updated'
    when old.status <> 'cancelled' and new.status = 'cancelled' then 'cancelled'
    when old.status = 'cancelled' and new.status <> 'cancelled' then 'reopened'
    when new.refund_amount = new.paid_amount
      and old.refund_amount <> new.refund_amount then 'full_refund'
    when old.refund_amount <> new.refund_amount then 'partial_refund'
    else 'updated'
  end;

  insert into public.sale_history
    (sale_id, action, previous_data, changed_data, changed_by)
  values (new.id, action_name, to_jsonb(old), to_jsonb(new), auth.uid());

  return new;
end;
$$;

create or replace function public.reclassify_sale_as_entry_error_after_refund(
  p_sale_id uuid,
  p_reason text,
  p_confirm_no_actual_payment boolean,
  p_confirm_no_actual_refund boolean,
  p_expected_payment_amount integer,
  p_expected_refund_amount integer,
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
  active_initial_count integer;
  prohibited_payment_count integer;
  active_refund_count integer;
  active_payment_amount integer;
  active_refund_amount integer;
  preserved_reason text;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception '환불 후 오등록 정정은 관리자만 처리할 수 있습니다.'
      using errcode = '42501';
  end if;

  if p_sale_id is null then
    raise exception '정정할 매출을 선택해 주세요.'
      using errcode = '22023';
  end if;

  if p_request_id is null then
    raise exception '오등록 정정 요청 ID가 필요합니다.'
      using errcode = '22023';
  end if;

  if p_confirm_no_actual_payment is distinct from true then
    raise exception '실제 입금이 없었다는 확인이 필요합니다.'
      using errcode = '22023';
  end if;

  if p_confirm_no_actual_refund is distinct from true then
    raise exception '실제 환불이 없었다는 확인이 필요합니다.'
      using errcode = '22023';
  end if;

  if normalized_reason is null then
    raise exception '오등록 정정 사유를 입력해 주세요.'
      using errcode = '22023';
  end if;

  if p_expected_payment_amount is null or p_expected_payment_amount <= 0 then
    raise exception '예상 결제금액을 확인해 주세요.'
      using errcode = '22023';
  end if;

  if p_expected_refund_amount is null or p_expected_refund_amount <= 0 then
    raise exception '예상 환불금액을 확인해 주세요.'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));

  select *
  into existing_sale
  from public.sales
  where cancellation_request_id = p_request_id;

  if existing_sale.id is not null then
    if existing_sale.id <> p_sale_id
      or existing_sale.status <> 'cancelled'
      or existing_sale.cancellation_type <> 'entry_error' then
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
    raise exception '정정할 매출을 찾을 수 없습니다.'
      using errcode = 'P0002';
  end if;

  if sale_row.cancellation_type is not null then
    raise exception '이미 취소 유형이 확정된 거래입니다.'
      using errcode = 'P0001';
  end if;

  if not (
    sale_row.status in ('partial_refund', 'full_refund')
    or (
      sale_row.status = 'cancelled'
      and sale_row.cancellation_type is null
    )
  ) then
    raise exception '부분환불·전액환불 또는 미분류 기존 취소 거래만 정정할 수 있습니다.'
      using errcode = 'P0001';
  end if;

  if public.is_month_closed(sale_row.sale_date) then
    raise exception '마감된 월의 매출은 오등록 정정할 수 없습니다.'
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

  select
    count(*) filter (where source = 'initial'),
    count(*) filter (
      where source in ('outstanding_collection', 'adjustment')
        or source is null
        or source not in ('initial', 'outstanding_collection', 'adjustment')
    ),
    coalesce(sum(amount), 0)::integer
  into
    active_initial_count,
    prohibited_payment_count,
    active_payment_amount
  from public.sale_payments
  where sale_id = sale_row.id
    and voided_at is null;

  select
    count(*),
    coalesce(sum(amount), 0)::integer
  into active_refund_count, active_refund_amount
  from public.sale_refunds
  where sale_id = sale_row.id
    and voided_at is null;

  if active_initial_count = 0 then
    raise exception '유효한 최초 결제원장을 확인할 수 없습니다.'
      using errcode = 'P0001';
  end if;

  if prohibited_payment_count > 0 then
    raise exception '미수 수납 또는 조정 결제 이력이 있는 거래는 정정할 수 없습니다.'
      using errcode = 'P0001';
  end if;

  if active_refund_count = 0 then
    raise exception '유효한 환불원장을 확인할 수 없습니다.'
      using errcode = 'P0001';
  end if;

  if active_payment_amount <> sale_row.paid_amount then
    raise exception '결제원장 합계와 거래 결제금액이 일치하지 않습니다.'
      using errcode = '23514';
  end if;

  if active_refund_amount <> sale_row.refund_amount then
    raise exception '환불원장 합계와 거래 환불금액이 일치하지 않습니다.'
      using errcode = '23514';
  end if;

  if active_payment_amount <> p_expected_payment_amount then
    raise exception '화면에서 확인한 결제금액과 현재 원장이 일치하지 않습니다.'
      using errcode = '23514';
  end if;

  if active_refund_amount <> p_expected_refund_amount then
    raise exception '화면에서 확인한 환불금액과 현재 원장이 일치하지 않습니다.'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.sale_payments
    where sale_id = sale_row.id
      and voided_at is null
      and public.is_month_closed(payment_date)
  ) then
    raise exception '마감된 월의 결제원장은 오등록 정정할 수 없습니다.'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.sale_refunds
    where sale_id = sale_row.id
      and voided_at is null
      and refund_date is not null
      and public.is_month_closed(refund_date)
  ) then
    raise exception '마감된 월의 환불원장은 오등록 정정할 수 없습니다.'
      using errcode = 'P0001';
  end if;

  update public.sale_payments
  set
    voided_at = now(),
    voided_by = auth.uid(),
    void_reason = '환불 후 오등록 정정: ' || normalized_reason
  where sale_id = sale_row.id
    and voided_at is null;

  update public.sale_refunds
  set
    voided_at = now(),
    voided_by = auth.uid(),
    void_reason = '환불 후 오등록 정정: ' || normalized_reason
  where sale_id = sale_row.id
    and voided_at is null;

  preserved_reason :=
    case
      when nullif(btrim(coalesce(sale_row.cancellation_reason, '')), '') is null
        then normalized_reason
      else sale_row.cancellation_reason
        || E'\n[환불 후 오등록 정정] '
        || normalized_reason
    end;

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
    cancellation_reason = preserved_reason,
    paid_amount = 0,
    refund_amount = 0,
    outstanding_amount = 0,
    net_amount = 0
  where id = sale_row.id
  returning * into sale_row;

  perform set_config('app.entry_error_cancel_sale_id', '', true);

  return sale_row;
end;
$$;

revoke all on function public.reclassify_sale_as_entry_error_after_refund(
  uuid,
  text,
  boolean,
  boolean,
  integer,
  integer,
  uuid
) from public, anon;

grant execute on function public.reclassify_sale_as_entry_error_after_refund(
  uuid,
  text,
  boolean,
  boolean,
  integer,
  integer,
  uuid
) to authenticated;

-- 신규 기능이 만든 결과는 기존 entry_error 무결성 규칙을 그대로 만족해야 한다.
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
      or sale.paid_amount <> 0
      or sale.refund_amount <> 0
      or sale.outstanding_amount <> 0
      or sale.net_amount <> 0
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
    );

  if invalid_count > 0 then
    raise exception
      '오등록 정정 무결성이 맞지 않는 매출이 %건 있습니다.',
      invalid_count
      using errcode = 'P0001';
  end if;
end
$$;

commit;
