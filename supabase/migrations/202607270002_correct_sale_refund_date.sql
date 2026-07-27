begin;

create or replace function public.correct_sale_refund_date(
  p_refund_id uuid,
  p_expected_sale_id uuid,
  p_expected_amount integer,
  p_expected_refund_date date,
  p_new_refund_date date,
  p_reason text,
  p_request_id uuid
)
returns public.sale_refunds
language plpgsql
security definer
set search_path = public
as $$
declare
  refund_row public.sale_refunds%rowtype;
  sale_row public.sales%rowtype;
  normalized_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  existing_history_id uuid;
  today_in_korea date := (now() at time zone 'Asia/Seoul')::date;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception '환불일 정정은 관리자만 처리할 수 있습니다.'
      using errcode = '42501';
  end if;

  if p_refund_id is null
    or p_expected_sale_id is null
    or p_request_id is null then
    raise exception '환불일 정정 대상과 요청 ID가 필요합니다.'
      using errcode = '22023';
  end if;

  if p_expected_amount is null or p_expected_amount <= 0 then
    raise exception '확인할 환불금액이 올바르지 않습니다.'
      using errcode = '22023';
  end if;

  if p_expected_refund_date is null or p_new_refund_date is null then
    raise exception '기존 환불일과 변경할 환불일이 필요합니다.'
      using errcode = '22023';
  end if;

  if normalized_reason is null then
    raise exception '환불일 정정 사유를 입력해 주세요.'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));

  select history.id
  into existing_history_id
  from public.sale_history as history
  where history.action = 'updated'
    and history.sale_id = p_expected_sale_id
    and history.changed_data ->> 'entity' = 'sale_refund'
    and history.changed_data ->> 'operation' = 'refund_date_correction'
    and history.changed_data ->> 'request_id' = p_request_id::text
  limit 1;

  if existing_history_id is not null then
    select *
    into refund_row
    from public.sale_refunds
    where id = p_refund_id
      and sale_id = p_expected_sale_id;

    if refund_row.id is null
      or refund_row.amount <> p_expected_amount
      or refund_row.refund_date <> p_new_refund_date then
      raise exception '이미 다른 작업에 사용된 요청 ID입니다.'
        using errcode = '23505';
    end if;

    return refund_row;
  end if;

  select *
  into refund_row
  from public.sale_refunds
  where id = p_refund_id
  for update;

  if refund_row.id is null then
    raise exception '정정할 환불원장을 찾을 수 없습니다.'
      using errcode = 'P0002';
  end if;

  if refund_row.sale_id <> p_expected_sale_id
    or refund_row.amount <> p_expected_amount
    or refund_row.refund_date is distinct from p_expected_refund_date then
    raise exception '화면에서 확인한 환불원장과 현재 데이터가 일치하지 않습니다.'
      using errcode = '23514';
  end if;

  if refund_row.voided_at is not null then
    raise exception '무효화된 환불원장의 날짜는 정정할 수 없습니다.'
      using errcode = 'P0001';
  end if;

  select *
  into sale_row
  from public.sales
  where id = refund_row.sale_id
  for update;

  if sale_row.id is null then
    raise exception '연결된 매출을 찾을 수 없습니다.'
      using errcode = 'P0002';
  end if;

  if sale_row.status = 'cancelled' then
    raise exception '취소된 거래의 환불일은 정정할 수 없습니다.'
      using errcode = 'P0001';
  end if;

  if p_new_refund_date < sale_row.sale_date then
    raise exception '환불일은 매출일보다 빠를 수 없습니다.'
      using errcode = '22023';
  end if;

  if p_new_refund_date > today_in_korea then
    raise exception '환불일은 오늘 이후일 수 없습니다.'
      using errcode = '22023';
  end if;

  if public.is_month_closed(p_expected_refund_date)
    or public.is_month_closed(p_new_refund_date) then
    raise exception '마감된 월의 환불일은 정정할 수 없습니다.'
      using errcode = 'P0001';
  end if;

  update public.sale_refunds
  set refund_date = p_new_refund_date
  where id = refund_row.id
  returning * into refund_row;

  insert into public.sale_history (
    sale_id,
    action,
    previous_data,
    changed_data,
    changed_by
  )
  values (
    sale_row.id,
    'updated',
    jsonb_build_object(
      'entity', 'sale_refund',
      'operation', 'refund_date_correction',
      'refund_id', refund_row.id,
      'amount', refund_row.amount,
      'refund_date', p_expected_refund_date
    ),
    jsonb_build_object(
      'entity', 'sale_refund',
      'operation', 'refund_date_correction',
      'refund_id', refund_row.id,
      'amount', refund_row.amount,
      'refund_date', refund_row.refund_date,
      'reason', normalized_reason,
      'request_id', p_request_id
    ),
    auth.uid()
  );

  return refund_row;
end;
$$;

revoke all on function public.correct_sale_refund_date(
  uuid,
  uuid,
  integer,
  date,
  date,
  text,
  uuid
) from public, anon;

grant execute on function public.correct_sale_refund_date(
  uuid,
  uuid,
  integer,
  date,
  date,
  text,
  uuid
) to authenticated;

commit;
