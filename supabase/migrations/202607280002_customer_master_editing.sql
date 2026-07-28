-- P&M OS shared Customer Master editing
-- Finance와 Operations가 같은 public.customers 원장을 사용한다.
-- 기존 sales의 고객 Snapshot과 회계 객체는 변경하지 않는다.

begin;

do $$
begin
  if to_regclass('public.entity_audit_events') is null then
    raise exception
      '202607280001_operations_foundation.sql을 먼저 적용해 공용 감사 원장을 준비해 주세요.';
  end if;
end
$$;

alter table public.customers
  add column if not exists updated_by uuid;

alter table public.customers
  alter column updated_by set default auth.uid();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'customers_updated_by_fkey'
      and conrelid = 'public.customers'::regclass
  ) then
    alter table public.customers
      add constraint customers_updated_by_fkey
      foreign key (updated_by)
      references public.profiles(id)
      on delete set null;
  end if;
end
$$;

create index if not exists customers_updated_by_idx
  on public.customers(updated_by);

create or replace function public.stamp_customer_master_metadata()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id
      or new.created_at is distinct from old.created_at
      or new.created_by is distinct from old.created_by then
      raise exception '보호자 원장의 생성 정보는 변경할 수 없습니다.'
        using errcode = 'P0001';
    end if;
  end if;

  new.updated_by := auth.uid();
  return new;
end;
$$;

drop trigger if exists customers_master_metadata
  on public.customers;

create trigger customers_master_metadata
  before insert or update
  on public.customers
  for each row
  execute function public.stamp_customer_master_metadata();

create or replace function public.record_customer_master_audit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  audit_action text;
  audit_reason text;
begin
  if tg_op = 'INSERT' then
    audit_action := 'created';
    audit_reason := 'Customer Master 등록';
  elsif old.is_active = true and new.is_active = false then
    audit_action := 'archived';
    audit_reason := 'Customer Master 비활성화';
  elsif old.is_active = false and new.is_active = true then
    audit_action := 'restored';
    audit_reason := 'Customer Master 활성 복구';
  else
    audit_action := 'updated';
    audit_reason := 'Customer Master 정보 수정';
  end if;

  insert into public.entity_audit_events (
    module_code,
    entity_type,
    entity_id,
    action,
    before_data,
    after_data,
    changed_by,
    change_reason
  )
  values (
    'shared_master',
    'customer',
    new.id,
    audit_action,
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,
    to_jsonb(new),
    coalesce(new.updated_by, auth.uid()),
    audit_reason
  );

  return new;
end;
$$;

drop trigger if exists customers_master_audit
  on public.customers;

create trigger customers_master_audit
  after insert or update
  on public.customers
  for each row
  execute function public.record_customer_master_audit();

create or replace function public.prevent_customer_master_delete()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception
    '보호자 원장은 삭제할 수 없습니다. 비활성화로 처리해 주세요.'
    using errcode = 'P0001';
end;
$$;

drop trigger if exists customers_prevent_delete
  on public.customers;

create trigger customers_prevent_delete
  before delete
  on public.customers
  for each row
  execute function public.prevent_customer_master_delete();

drop policy if exists customers_update
  on public.customers;
drop policy if exists customers_update_admin
  on public.customers;
drop policy if exists customers_update_active_user
  on public.customers;

create policy customers_update_active_user
  on public.customers
  for update
  to authenticated
  using (public.is_active_user())
  with check (public.is_active_user());

drop policy if exists customers_delete
  on public.customers;
drop policy if exists customers_delete_admin
  on public.customers;

grant update on table public.customers
  to authenticated;
revoke delete on table public.customers
  from authenticated;

revoke all on function public.stamp_customer_master_metadata()
  from public;
revoke all on function public.record_customer_master_audit()
  from public;
revoke all on function public.prevent_customer_master_delete()
  from public;

commit;
