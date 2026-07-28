-- P&M OS shared Customer Master address
-- 기존 고객 원장에 선택 주소만 추가한다.
-- Finance 매출 Snapshot과 회계 객체는 변경하지 않는다.

begin;

do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'customers'
      and column_name = 'updated_by'
  ) then
    raise exception
      '202607280002_customer_master_editing.sql을 먼저 적용해 고객 변경 이력을 준비해 주세요.';
  end if;

  if to_regclass('public.entity_audit_events') is null then
    raise exception
      '공용 감사 원장을 확인할 수 없습니다.';
  end if;
end
$$;

alter table public.customers
  add column if not exists address text null;

comment on column public.customers.address is
  'Finance와 Operations가 공유하는 보호자 주소';

commit;
