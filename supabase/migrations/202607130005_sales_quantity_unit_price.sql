-- 기존 매출 금액·환불·미수·실매출 계산은 유지하면서 수량과 기준 단가를 보존한다.
-- SQL Editor에서 사용자가 검토 후 직접 실행한다.

begin;

alter table public.sales
  add column if not exists quantity integer,
  add column if not exists unit_price integer;

update public.sales
set
  quantity = coalesce(quantity, 1),
  unit_price = coalesce(unit_price, original_amount)
where quantity is null
   or unit_price is null;

alter table public.sales
  alter column quantity set default 1,
  alter column quantity set not null,
  alter column unit_price set default 0,
  alter column unit_price set not null;

alter table public.sales
  drop constraint if exists sales_quantity_positive,
  drop constraint if exists sales_unit_price_nonnegative;

alter table public.sales
  add constraint sales_quantity_positive check (quantity > 0),
  add constraint sales_unit_price_nonnegative check (unit_price >= 0);

-- 할인 관계는 유지하되, 할인액이 0원인 실제 추가요금은 허용한다.
-- net_amount, refund_amount, outstanding_amount 계산식은 변경하지 않는다.
alter table public.sales
  drop constraint if exists sales_payment_plan_limit;

alter table public.sales
  add constraint sales_payment_plan_limit check (
    paid_amount + outstanding_amount <= greatest(original_amount - discount_amount, 0)
    or (
      discount_amount = 0
      and paid_amount + outstanding_amount > original_amount
    )
  );

commit;
