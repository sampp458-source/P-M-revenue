-- 매출 기준금액은 기존 original_amount를 유지하고 추가금액과 조정 메모만 보존한다.
-- net_amount = paid_amount - refund_amount 및 환불/취소 Trigger는 변경하지 않는다.

begin;

alter table public.sales
  add column if not exists additional_amount integer not null default 0,
  add column if not exists adjustment_note text null;

-- 이전 화면에서 할인 없이 기준금액을 초과해 받은 매출은 암묵적 추가요금이었다.
-- 새 제약 적용 전에 그 차액만 새 컬럼으로 옮겨 환불·수정 시 기존 금액을 보존한다.
update public.sales
set additional_amount = paid_amount + outstanding_amount - original_amount
where discount_amount = 0
  and paid_amount + outstanding_amount > original_amount
  and additional_amount = 0;

alter table public.sales
  drop constraint if exists sales_additional_amount_nonnegative,
  drop constraint if exists sales_adjustment_note_length;

alter table public.sales
  add constraint sales_additional_amount_nonnegative
    check (additional_amount >= 0),
  add constraint sales_adjustment_note_length
    check (adjustment_note is null or char_length(adjustment_note) <= 500);

-- 결제 예정액은 기준금액 + 추가금액 - 할인금액이다.
-- 기존 데이터는 additional_amount = 0이므로 종전 의미를 그대로 유지한다.
alter table public.sales
  drop constraint if exists sales_payment_plan_limit;

alter table public.sales
  add constraint sales_payment_plan_limit check (
    paid_amount + outstanding_amount
      <= greatest(original_amount + additional_amount - discount_amount, 0)
  );

commit;
