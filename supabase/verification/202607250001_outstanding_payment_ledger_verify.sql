-- 202607250001_outstanding_payment_ledger.sql 적용 후 읽기 전용 검증 SQL

-- 1. 필수 컬럼과 기본 속성
select
  table_name,
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and (
    (
      table_name = 'sale_payments'
      and column_name in (
        'payment_date',
        'note',
        'source',
        'request_id',
        'voided_at',
        'voided_by',
        'void_reason'
      )
    )
    or (
      table_name = 'sales'
      and column_name in (
        'initial_outstanding_amount',
        'initial_outstanding_estimated'
      )
    )
  )
order by table_name, ordinal_position;

-- 2. CHECK, FK, UNIQUE 제약
select
  conrelid::regclass as table_name,
  conname as constraint_name,
  contype as constraint_type,
  pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid in (
    'public.sales'::regclass,
    'public.sale_payments'::regclass
  )
  and conname in (
    'sales_initial_outstanding_nonnegative',
    'sales_payment_balance_consistency',
    'sale_payments_source_check',
    'sale_payments_amount_positive',
    'sale_payments_void_metadata_check',
    'sale_payments_sale_id_fkey',
    'sale_payments_voided_by_fkey',
    'sale_payments_voided_by_profiles_fkey'
  )
order by conrelid::regclass::text, conname;

-- 3. request_id UNIQUE와 결제원장 인덱스
select
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'sale_payments'
order by indexname;

-- 4. (sale_id, payment_method) UNIQUE constraint 잔존 여부: 0건이어야 한다.
select
  constraint_info.conname as remaining_unique_constraint,
  pg_get_constraintdef(constraint_info.oid) as definition
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
  ) = array['payment_method', 'sale_id']::text[];

-- 5. 동일 조합의 독립 UNIQUE INDEX 잔존 여부: 0건이어야 한다.
-- 두 결과가 모두 0건이면 동일 거래·동일 결제수단의 복수 원장행을 허용하는 구조다.
select
  index_class.relname as remaining_unique_index,
  pg_get_indexdef(index_info.indexrelid) as definition
from pg_index as index_info
join pg_class as index_class
  on index_class.oid = index_info.indexrelid
where index_info.indrelid = 'public.sale_payments'::regclass
  and index_info.indisunique
  and index_info.indnkeyatts = 2
  and (
    select array_agg(attribute.attname::text order by attribute.attname::text)
    from unnest(
      string_to_array(index_info.indkey::text, ' ')::smallint[]
    ) with ordinality as key_column(attnum, position)
    join pg_attribute as attribute
      on attribute.attrelid = index_info.indrelid
      and attribute.attnum = key_column.attnum
    where key_column.position <= index_info.indnkeyatts
  ) = array['payment_method', 'sale_id']::text[];

-- 6. 필수 NOT NULL, request_id UNIQUE, source/amount CHECK, voided_by FK 종합 확인
select
  (
    select is_nullable = 'NO'
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'sale_payments'
      and column_name = 'request_id'
  ) as request_id_not_null,
  exists (
    select 1
    from pg_index as index_info
    join pg_attribute as attribute
      on attribute.attrelid = index_info.indrelid
      and attribute.attnum = any(index_info.indkey)
    where index_info.indrelid = 'public.sale_payments'::regclass
      and index_info.indisunique
      and index_info.indnkeyatts = 1
      and attribute.attname = 'request_id'
  ) as request_id_unique,
  (
    select is_nullable = 'NO'
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'sale_payments'
      and column_name = 'payment_date'
  ) as payment_date_not_null,
  (
    select is_nullable = 'NO'
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'sale_payments'
      and column_name = 'source'
  ) as source_not_null,
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.sale_payments'::regclass
      and conname = 'sale_payments_source_check'
      and contype = 'c'
  ) as source_check_exists,
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.sale_payments'::regclass
      and conname = 'sale_payments_amount_positive'
      and contype = 'c'
  ) as amount_positive_check_exists,
  exists (
    select 1
    from pg_constraint as constraint_info
    where constraint_info.conrelid = 'public.sale_payments'::regclass
      and constraint_info.confrelid = 'public.profiles'::regclass
      and constraint_info.contype = 'f'
      and (
        select attribute.attname
        from unnest(constraint_info.conkey) as key_column(attnum)
        join pg_attribute as attribute
          on attribute.attrelid = constraint_info.conrelid
          and attribute.attnum = key_column.attnum
        limit 1
      ) = 'voided_by'
  ) as voided_by_profiles_fk_exists;

-- 7. sales Trigger 목록과 실제 실행 순서
-- PostgreSQL은 같은 timing/event의 Trigger를 trigger_name 오름차순으로 실행한다.
select
  trigger_info.tgname as trigger_name,
  case
    when (trigger_info.tgtype & 2) = 2 then 'BEFORE'
    when (trigger_info.tgtype & 64) = 64 then 'INSTEAD OF'
    else 'AFTER'
  end as timing,
  concat_ws(
    ', ',
    case when (trigger_info.tgtype & 4) = 4 then 'INSERT' end,
    case when (trigger_info.tgtype & 16) = 16 then 'UPDATE' end,
    case when (trigger_info.tgtype & 8) = 8 then 'DELETE' end,
    case when (trigger_info.tgtype & 32) = 32 then 'TRUNCATE' end
  ) as events,
  pg_get_triggerdef(trigger_info.oid) as definition
from pg_trigger as trigger_info
where trigger_info.tgrelid = 'public.sales'::regclass
  and not trigger_info.tgisinternal
order by timing, trigger_name;

-- 8. RLS 활성화와 정책: SELECT 정책만 존재해야 한다.
select
  cls.relname as table_name,
  cls.relrowsecurity as rls_enabled,
  policy.policyname,
  policy.cmd,
  policy.roles,
  policy.qual,
  policy.with_check
from pg_class as cls
left join pg_policies as policy
  on policy.schemaname = 'public'
  and policy.tablename = cls.relname
where cls.oid = 'public.sale_payments'::regclass
order by policy.policyname;

-- 9. 테이블 직접 쓰기 권한: authenticated/anon에 INSERT/UPDATE/DELETE가 없어야 한다.
select
  grantee,
  privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name = 'sale_payments'
  and grantee in ('anon', 'authenticated')
order by grantee, privilege_type;

-- 10. RPC 속성, SECURITY DEFINER, 고정 search_path
select
  routine.oid::regprocedure as function_signature,
  routine.prosecdef as security_definer,
  routine.proconfig as function_config
from pg_proc as routine
join pg_namespace as namespace
  on namespace.oid = routine.pronamespace
where namespace.nspname = 'public'
  and routine.proname in (
    'add_sale_payment',
    'void_sale_payment',
    'create_sale_with_payments'
  )
order by routine.oid::regprocedure::text;

-- 11. RPC EXECUTE 권한: anon=false, authenticated=true
select
  routine.oid::regprocedure as function_signature,
  has_function_privilege(
    'anon',
    routine.oid,
    'EXECUTE'
  ) as anon_can_execute,
  has_function_privilege(
    'authenticated',
    routine.oid,
    'EXECUTE'
  ) as authenticated_can_execute
from pg_proc as routine
join pg_namespace as namespace
  on namespace.oid = routine.pronamespace
where namespace.nspname = 'public'
  and routine.proname in ('add_sale_payment', 'void_sale_payment')
order by routine.oid::regprocedure::text;

-- 12. 기존 결제행 보정 결과
select
  count(*) as total_payment_rows,
  count(*) filter (where payment_date is null) as missing_payment_date,
  count(*) filter (where source is null) as missing_source,
  count(*) filter (where request_id is null) as missing_request_id,
  count(*) filter (where source = 'initial') as initial_rows,
  count(*) filter (where source = 'outstanding_collection') as collection_rows,
  count(*) filter (where source = 'adjustment') as adjustment_rows,
  count(*) filter (where voided_at is not null) as voided_rows
from public.sale_payments;

-- 13. 기존 initial 행의 결제일이 매출일과 다른 건수
select count(*) as initial_payment_date_mismatch_count
from public.sale_payments as payment
join public.sales as sale
  on sale.id = payment.sale_id
where payment.source = 'initial'
  and payment.payment_date <> sale.sale_date;

-- 14. 유효 결제원장 합계와 sales.paid_amount 불일치: 0건이어야 한다.
select
  sale.id as sale_id,
  sale.paid_amount,
  coalesce(sum(payment.amount) filter (where payment.voided_at is null), 0)::bigint
    as ledger_paid_amount
from public.sales as sale
left join public.sale_payments as payment
  on payment.sale_id = sale.id
group by sale.id, sale.paid_amount
having coalesce(sum(payment.amount) filter (where payment.voided_at is null), 0)
  <> sale.paid_amount;

-- 15. 판매금액, 결제액, 미수금 불일치: 0건이어야 한다.
select
  id as sale_id,
  original_amount + additional_amount - discount_amount as final_sale_amount,
  paid_amount,
  outstanding_amount
from public.sales
where paid_amount + outstanding_amount
  <> original_amount + additional_amount - discount_amount;

-- 16. 현재 미수잔액: 전체와 실제 수납 가능한 상태를 함께 확인한다.
select
  count(*) filter (where outstanding_amount > 0) as all_outstanding_sales,
  coalesce(
    sum(outstanding_amount) filter (where outstanding_amount > 0),
    0
  ) as all_outstanding_amount,
  count(*) filter (
    where outstanding_amount > 0
      and status in ('normal', 'partial_refund')
  ) as collectible_sales,
  coalesce(
    sum(outstanding_amount) filter (
      where outstanding_amount > 0
        and status in ('normal', 'partial_refund')
    ),
    0
  ) as collectible_outstanding_amount
from public.sales;

-- 17. 최초 미수 Snapshot: legacy 추정값과 신규 정확값을 분리한다.
select
  count(*) as total_sales,
  count(*) filter (where initial_outstanding_estimated)
    as legacy_estimated_sales,
  count(*) filter (where not initial_outstanding_estimated)
    as exact_new_sales,
  coalesce(
    sum(initial_outstanding_amount) filter (where initial_outstanding_estimated),
    0
  ) as legacy_estimated_amount,
  coalesce(
    sum(initial_outstanding_amount) filter (where not initial_outstanding_estimated),
    0
  ) as exact_new_amount,
  count(*) filter (where initial_outstanding_amount < 0)
    as invalid_negative_snapshot
from public.sales;

-- 18. 결제일 기준 실수납액 월별 확인
select
  date_trunc('month', payment_date)::date as payment_month,
  count(*) as payment_count,
  sum(amount) as receipt_amount
from public.sale_payments
where voided_at is null
group by date_trunc('month', payment_date)
order by payment_month desc;
