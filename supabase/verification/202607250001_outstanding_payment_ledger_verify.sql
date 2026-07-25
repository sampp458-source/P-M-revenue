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
      and column_name = 'initial_outstanding_amount'
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
    'sale_payments_void_metadata_check',
    'sale_payments_sale_id_fkey',
    'sale_payments_voided_by_fkey'
  )
order by conrelid::regclass::text, conname;

-- 3. 결제원장 인덱스와 기존 (sale_id, payment_method) UNIQUE 제거 여부
select
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'sale_payments'
order by indexname;

-- 4. RLS 활성화와 정책: SELECT 정책만 존재해야 한다.
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

-- 5. 테이블 직접 쓰기 권한: authenticated/anon에 INSERT/UPDATE/DELETE가 없어야 한다.
select
  grantee,
  privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name = 'sale_payments'
  and grantee in ('anon', 'authenticated')
order by grantee, privilege_type;

-- 6. RPC 속성, SECURITY DEFINER, 고정 search_path
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

-- 7. RPC EXECUTE 권한: anon=false, authenticated=true
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

-- 8. 기존 결제행 보정 결과
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

-- 9. 기존 initial 행의 결제일이 매출일과 다른 건수
select count(*) as initial_payment_date_mismatch_count
from public.sale_payments as payment
join public.sales as sale
  on sale.id = payment.sale_id
where payment.source = 'initial'
  and payment.payment_date <> sale.sale_date;

-- 10. 유효 결제원장 합계와 sales.paid_amount 불일치: 0건이어야 한다.
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

-- 11. 판매금액, 결제액, 미수금 불일치: 0건이어야 한다.
select
  id as sale_id,
  original_amount + additional_amount - discount_amount as final_sale_amount,
  paid_amount,
  outstanding_amount
from public.sales
where paid_amount + outstanding_amount
  <> original_amount + additional_amount - discount_amount;

-- 12. 현재 미수잔액: 전체와 실제 수납 가능한 상태를 함께 확인한다.
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

-- 13. 최초 미수 Snapshot 보정 현황
select
  count(*) as total_sales,
  count(*) filter (where initial_outstanding_amount > 0)
    as initially_outstanding_sales,
  coalesce(sum(initial_outstanding_amount), 0)
    as initial_outstanding_amount_total,
  count(*) filter (where initial_outstanding_amount < 0)
    as invalid_negative_snapshot
from public.sales;

-- 14. 결제일 기준 실수납액 월별 확인
select
  date_trunc('month', payment_date)::date as payment_month,
  count(*) as payment_count,
  sum(amount) as receipt_amount
from public.sale_payments
where voided_at is null
group by date_trunc('month', payment_date)
order by payment_month desc;
