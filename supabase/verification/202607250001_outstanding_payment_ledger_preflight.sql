-- 202607250001_outstanding_payment_ledger.sql 실행 전 운영 DB 사전 검증
-- 모든 문장은 읽기 전용 SELECT이다.
-- 첫 번째 결과의 모든 status가 PASS이고, 이후 상세 결과가 모두 0건일 때만 Migration을 실행한다.

-- 1. 종합 사전 검증
with
required_relations(relation_name) as (
  values
    ('public.sales'),
    ('public.sale_payments'),
    ('public.sale_refunds'),
    ('public.profiles'),
    ('public.business_units'),
    ('public.dogs'),
    ('public.customers'),
    ('public.product_categories'),
    ('public.products')
),
missing_relations as (
  select relation_name
  from required_relations
  where to_regclass(relation_name) is null
),
required_sales_columns(column_name) as (
  values
    ('id'),
    ('sale_date'),
    ('original_amount'),
    ('additional_amount'),
    ('discount_amount'),
    ('paid_amount'),
    ('refund_amount'),
    ('outstanding_amount'),
    ('net_amount'),
    ('payment_method'),
    ('status'),
    ('created_by')
),
missing_sales_columns as (
  select required.column_name
  from required_sales_columns as required
  where not exists (
    select 1
    from information_schema.columns as existing
    where existing.table_schema = 'public'
      and existing.table_name = 'sales'
      and existing.column_name = required.column_name
  )
),
required_payment_columns(column_name) as (
  values
    ('id'),
    ('sale_id'),
    ('payment_method'),
    ('amount'),
    ('created_by'),
    ('created_at')
),
missing_payment_columns as (
  select required.column_name
  from required_payment_columns as required
  where not exists (
    select 1
    from information_schema.columns as existing
    where existing.table_schema = 'public'
      and existing.table_name = 'sale_payments'
      and existing.column_name = required.column_name
  )
),
required_functions(function_signature) as (
  values
    ('public.is_active_user()'),
    ('public.is_admin()'),
    ('public.is_month_closed(date)'),
    ('public.normalize_sale_payment_payload(jsonb)'),
    ('public.replace_sale_payments(uuid,jsonb)')
),
missing_functions as (
  select function_signature
  from required_functions
  where to_regprocedure(function_signature) is null
),
effective_payments as (
  select
    payment.id,
    payment.sale_id,
    payment.payment_method,
    payment.amount,
    payment.created_by,
    payment.created_at,
    nullif(to_jsonb(payment) ->> 'payment_date', '') as payment_date_text,
    nullif(btrim(coalesce(to_jsonb(payment) ->> 'source', '')), '')
      as source_text,
    nullif(to_jsonb(payment) ->> 'request_id', '') as request_id_text,
    nullif(to_jsonb(payment) ->> 'voided_at', '') as voided_at_text,
    nullif(to_jsonb(payment) ->> 'voided_by', '') as voided_by_text,
    nullif(btrim(coalesce(to_jsonb(payment) ->> 'void_reason', '')), '')
      as void_reason_text,
    coalesce(
      nullif(to_jsonb(payment) ->> 'request_id', ''),
      (md5('legacy-sale-payment:' || payment.id::text)::uuid)::text
    ) as effective_request_id,
    coalesce(
      nullif(btrim(coalesce(to_jsonb(payment) ->> 'source', '')), ''),
      'initial'
    ) as effective_source
  from public.sale_payments as payment
),
ledger_totals as (
  select
    sale.id as sale_id,
    sale.paid_amount,
    coalesce(
      sum(payment.amount) filter (where payment.voided_at_text is null),
      0
    )::bigint as ledger_paid_amount
  from public.sales as sale
  left join effective_payments as payment
    on payment.sale_id = sale.id
  group by sale.id, sale.paid_amount
),
effective_request_id_duplicates as (
  select effective_request_id
  from effective_payments
  group by effective_request_id
  having count(*) > 1
),
checks(check_order, check_name, actual_count, expected_result) as (
  select 1, '필수 테이블 누락', count(*)::bigint, '0건'
  from missing_relations

  union all

  select 2, 'sales 필수 컬럼 누락', count(*)::bigint, '0건'
  from missing_sales_columns

  union all

  select 3, 'sale_payments 필수 컬럼 누락', count(*)::bigint, '0건'
  from missing_payment_columns

  union all

  select 4, '필수 권한 함수 누락', count(*)::bigint, '0건'
  from missing_functions

  union all

  select 5, '최종 판매금액 음수', count(*)::bigint, '0건'
  from public.sales
  where original_amount + additional_amount - discount_amount < 0

  union all

  select 6, '실제 결제금액 음수', count(*)::bigint, '0건'
  from public.sales
  where paid_amount < 0

  union all

  select 7, '미수금 음수', count(*)::bigint, '0건'
  from public.sales
  where outstanding_amount < 0

  union all

  select 8, '판매금액과 결제·미수 합계 불일치', count(*)::bigint, '0건'
  from public.sales
  where paid_amount + outstanding_amount
    <> original_amount + additional_amount - discount_amount

  union all

  select 9, '환불액이 실제 결제금액을 초과', count(*)::bigint, '0건'
  from public.sales
  where refund_amount > paid_amount

  union all

  select 10, '전액환불 상태에 미수금 존재', count(*)::bigint, '0건'
  from public.sales
  where status = 'full_refund'
    and outstanding_amount <> 0

  union all

  select 11, '결제원장 합계와 sales.paid_amount 불일치', count(*)::bigint, '0건'
  from ledger_totals
  where ledger_paid_amount <> paid_amount

  union all

  select 12, '0원 이하 결제원장', count(*)::bigint, '0건'
  from effective_payments
  where amount is null
    or amount <= 0

  union all

  select 13, '허용되지 않은 결제수단', count(*)::bigint, '0건'
  from effective_payments
  where payment_method is null
    or payment_method not in ('card', 'transfer', 'cash', 'other')

  union all

  select 14, '연결된 매출이 없는 결제원장', count(*)::bigint, '0건'
  from effective_payments as payment
  left join public.sales as sale
    on sale.id = payment.sale_id
  where sale.id is null

  union all

  select 15, '연결된 작성자 profile이 없는 결제원장', count(*)::bigint, '0건'
  from effective_payments as payment
  left join public.profiles as profile
    on profile.id = payment.created_by
  where payment.created_by is null
    or profile.id is null

  union all

  select 16, '기존 결제일을 sale_date로 보정할 수 없는 원장', count(*)::bigint, '0건'
  from effective_payments as payment
  left join public.sales as sale
    on sale.id = payment.sale_id
  where payment.payment_date_text is null
    and sale.sale_date is null

  union all

  select 17, '보정 후에도 허용되지 않는 source', count(*)::bigint, '0건'
  from effective_payments
  where effective_source not in (
    'initial',
    'outstanding_collection',
    'adjustment'
  )

  union all

  select 18, '보정 후 request_id 중복', count(*)::bigint, '0건'
  from effective_request_id_duplicates

  union all

  select 19, '무효화 메타데이터 불완전', count(*)::bigint, '0건'
  from effective_payments
  where (
      voided_at_text is null
      and (
        voided_by_text is not null
        or void_reason_text is not null
      )
    )
    or (
      voided_at_text is not null
      and (
        voided_by_text is null
        or void_reason_text is null
      )
    )

  union all

  select 20, '연결된 profile이 없는 voided_by', count(*)::bigint, '0건'
  from effective_payments as payment
  left join public.profiles as profile
    on profile.id::text = payment.voided_by_text
  where payment.voided_by_text is not null
    and profile.id is null

  union all

  select 21, '기존 initial_outstanding_amount 음수', count(*)::bigint, '0건'
  from public.sales as sale
  where nullif(to_jsonb(sale) ->> 'initial_outstanding_amount', '')::numeric < 0
)
select
  check_order,
  check_name,
  actual_count,
  expected_result,
  case when actual_count = 0 then 'PASS' else 'FAIL' end as status
from checks
order by check_order;

-- 2. 누락된 필수 테이블 상세: 0건이어야 한다.
with required_relations(relation_name) as (
  values
    ('public.sales'),
    ('public.sale_payments'),
    ('public.sale_refunds'),
    ('public.profiles'),
    ('public.business_units'),
    ('public.dogs'),
    ('public.customers'),
    ('public.product_categories'),
    ('public.products')
)
select relation_name as missing_relation
from required_relations
where to_regclass(relation_name) is null
order by relation_name;

-- 3. 누락된 필수 컬럼 상세: 0건이어야 한다.
with required_columns(table_name, column_name) as (
  values
    ('sales', 'id'),
    ('sales', 'sale_date'),
    ('sales', 'original_amount'),
    ('sales', 'additional_amount'),
    ('sales', 'discount_amount'),
    ('sales', 'paid_amount'),
    ('sales', 'refund_amount'),
    ('sales', 'outstanding_amount'),
    ('sales', 'net_amount'),
    ('sales', 'payment_method'),
    ('sales', 'status'),
    ('sales', 'created_by'),
    ('sale_payments', 'id'),
    ('sale_payments', 'sale_id'),
    ('sale_payments', 'payment_method'),
    ('sale_payments', 'amount'),
    ('sale_payments', 'created_by'),
    ('sale_payments', 'created_at')
)
select
  required.table_name,
  required.column_name as missing_column
from required_columns as required
where not exists (
  select 1
  from information_schema.columns as existing
  where existing.table_schema = 'public'
    and existing.table_name = required.table_name
    and existing.column_name = required.column_name
)
order by required.table_name, required.column_name;

-- 4. 금액 또는 상태가 일관되지 않은 매출 상세: 0건이어야 한다.
select
  id,
  sale_date,
  status,
  original_amount,
  additional_amount,
  discount_amount,
  original_amount + additional_amount - discount_amount as final_sale_amount,
  paid_amount,
  refund_amount,
  outstanding_amount,
  net_amount,
  array_remove(
    array[
      case
        when original_amount + additional_amount - discount_amount < 0
          then '최종 판매금액 음수'
      end,
      case when paid_amount < 0 then '실제 결제금액 음수' end,
      case when outstanding_amount < 0 then '미수금 음수' end,
      case
        when paid_amount + outstanding_amount
          <> original_amount + additional_amount - discount_amount
          then '판매금액과 결제·미수 합계 불일치'
      end,
      case
        when refund_amount > paid_amount
          then '환불액이 실제 결제금액 초과'
      end,
      case
        when status = 'full_refund' and outstanding_amount <> 0
          then '전액환불 상태에 미수금 존재'
      end
    ],
    null
  ) as issues
from public.sales
where original_amount + additional_amount - discount_amount < 0
  or paid_amount < 0
  or outstanding_amount < 0
  or paid_amount + outstanding_amount
    <> original_amount + additional_amount - discount_amount
  or refund_amount > paid_amount
  or (status = 'full_refund' and outstanding_amount <> 0)
order by sale_date, id;

-- 5. 결제원장 합계와 sales.paid_amount가 다른 매출 상세: 0건이어야 한다.
with effective_payments as (
  select
    payment.sale_id,
    payment.amount,
    nullif(to_jsonb(payment) ->> 'voided_at', '') as voided_at_text
  from public.sale_payments as payment
),
ledger_totals as (
  select
    sale.id,
    sale.sale_date,
    sale.status,
    sale.paid_amount,
    coalesce(
      sum(payment.amount) filter (where payment.voided_at_text is null),
      0
    )::bigint as ledger_paid_amount
  from public.sales as sale
  left join effective_payments as payment
    on payment.sale_id = sale.id
  group by sale.id, sale.sale_date, sale.status, sale.paid_amount
)
select
  id,
  sale_date,
  status,
  paid_amount,
  ledger_paid_amount,
  ledger_paid_amount - paid_amount as difference
from ledger_totals
where ledger_paid_amount <> paid_amount
order by sale_date, id;

-- 6. Migration 제약 추가 또는 기존 행 보정에 실패할 결제원장 상세: 0건이어야 한다.
with effective_payments as (
  select
    payment.id,
    payment.sale_id,
    payment.payment_method,
    payment.amount,
    payment.created_by,
    nullif(to_jsonb(payment) ->> 'payment_date', '') as payment_date_text,
    coalesce(
      nullif(btrim(coalesce(to_jsonb(payment) ->> 'source', '')), ''),
      'initial'
    ) as effective_source,
    coalesce(
      nullif(to_jsonb(payment) ->> 'request_id', ''),
      (md5('legacy-sale-payment:' || payment.id::text)::uuid)::text
    ) as effective_request_id,
    nullif(to_jsonb(payment) ->> 'voided_at', '') as voided_at_text,
    nullif(to_jsonb(payment) ->> 'voided_by', '') as voided_by_text,
    nullif(btrim(coalesce(to_jsonb(payment) ->> 'void_reason', '')), '')
      as void_reason_text
  from public.sale_payments as payment
),
duplicate_request_ids as (
  select effective_request_id
  from effective_payments
  group by effective_request_id
  having count(*) > 1
)
select
  payment.id,
  payment.sale_id,
  payment.payment_method,
  payment.amount,
  payment.created_by,
  payment.payment_date_text,
  payment.effective_source,
  payment.effective_request_id,
  array_remove(
    array[
      case
        when payment.amount is null or payment.amount <= 0
          then '결제금액 누락 또는 0원 이하'
      end,
      case
        when payment.payment_method is null
          or payment.payment_method not in ('card', 'transfer', 'cash', 'other')
          then '허용되지 않은 결제수단'
      end,
      case when sale.id is null then '연결된 매출 없음' end,
      case
        when payment.created_by is null or creator.id is null
          then '연결된 작성자 profile 없음'
      end,
      case
        when payment.payment_date_text is null and sale.sale_date is null
          then '결제일 보정 불가'
      end,
      case
        when payment.effective_source not in (
          'initial',
          'outstanding_collection',
          'adjustment'
        ) then '허용되지 않는 source'
      end,
      case
        when duplicate.effective_request_id is not null
          then '보정 후 request_id 중복'
      end,
      case
        when (
            payment.voided_at_text is null
            and (
              payment.voided_by_text is not null
              or payment.void_reason_text is not null
            )
          )
          or (
            payment.voided_at_text is not null
            and (
              payment.voided_by_text is null
              or payment.void_reason_text is null
            )
          ) then '무효화 메타데이터 불완전'
      end,
      case
        when payment.voided_by_text is not null and voider.id is null
          then '연결된 무효화 처리자 profile 없음'
      end
    ],
    null
  ) as issues
from effective_payments as payment
left join public.sales as sale
  on sale.id = payment.sale_id
left join public.profiles as creator
  on creator.id = payment.created_by
left join public.profiles as voider
  on voider.id::text = payment.voided_by_text
left join duplicate_request_ids as duplicate
  on duplicate.effective_request_id = payment.effective_request_id
where payment.amount is null
  or payment.amount <= 0
  or payment.payment_method is null
  or payment.payment_method not in ('card', 'transfer', 'cash', 'other')
  or sale.id is null
  or payment.created_by is null
  or creator.id is null
  or (payment.payment_date_text is null and sale.sale_date is null)
  or payment.effective_source not in (
    'initial',
    'outstanding_collection',
    'adjustment'
  )
  or duplicate.effective_request_id is not null
  or (
    payment.voided_at_text is null
    and (
      payment.voided_by_text is not null
      or payment.void_reason_text is not null
    )
  )
  or (
    payment.voided_at_text is not null
    and (
      payment.voided_by_text is null
      or payment.void_reason_text is null
    )
  )
  or (payment.voided_by_text is not null and voider.id is null)
order by payment.sale_id, payment.id;

-- 7. Migration 이전 원장 현황 기대값
-- informational_result는 오류가 아니며, Migration 후 동일 거래·동일 수단 복수 원장을 허용하기 위해 제거될 대상이다.
select
  count(*) as existing_payment_rows,
  count(distinct sale_id) as sales_with_payment_rows,
  count(*) filter (
    where payment_method in ('card', 'transfer', 'cash', 'other')
  ) as allowed_method_rows,
  count(*) filter (
    where payment_method is null
      or payment_method not in ('card', 'transfer', 'cash', 'other')
  ) as invalid_method_rows,
  (
    select count(*)
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
  ) as removable_sale_method_unique_constraints
from public.sale_payments;
