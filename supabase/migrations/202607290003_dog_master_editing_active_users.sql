-- P&M OS shared Dog Master editing for every active profile.
-- Finance 회계 객체와 기존 비활성화 권한은 변경하지 않는다.

begin;

create table if not exists public.entity_audit_events (
  id uuid primary key default gen_random_uuid(),
  module_code text not null
    check (nullif(btrim(module_code), '') is not null),
  entity_type text not null
    check (nullif(btrim(entity_type), '') is not null),
  entity_id uuid not null,
  action text not null
    check (action in ('created', 'updated', 'archived', 'restored')),
  before_data jsonb null,
  after_data jsonb null,
  changed_by uuid null references public.profiles(id) on delete set null,
  change_reason text null,
  request_id uuid null,
  created_at timestamptz not null default now()
);

create index if not exists entity_audit_events_entity_created_idx
  on public.entity_audit_events (
    module_code,
    entity_type,
    entity_id,
    created_at desc
  );

create index if not exists entity_audit_events_request_idx
  on public.entity_audit_events (request_id)
  where request_id is not null;

alter table public.entity_audit_events enable row level security;
revoke all on table public.entity_audit_events from anon, authenticated;

alter table public.dogs
  add column if not exists updated_by uuid;

alter table public.dogs
  alter column updated_by set default auth.uid();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'dogs_updated_by_fkey'
      and conrelid = 'public.dogs'::regclass
  ) then
    alter table public.dogs
      add constraint dogs_updated_by_fkey
      foreign key (updated_by)
      references public.profiles(id)
      on delete set null;
  end if;
end
$$;

create index if not exists dogs_updated_by_idx
  on public.dogs(updated_by);

create or replace function public.stamp_dog_master_metadata()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.id is distinct from old.id
    or new.created_at is distinct from old.created_at
    or new.created_by is distinct from old.created_by then
    raise exception '반려견 원장의 생성 정보는 변경할 수 없습니다.'
      using errcode = 'P0001';
  end if;

  new.updated_by := auth.uid();
  return new;
end;
$$;

drop trigger if exists dogs_master_metadata
  on public.dogs;

create trigger dogs_master_metadata
  before update
  on public.dogs
  for each row
  execute function public.stamp_dog_master_metadata();

create or replace function public.record_dog_master_audit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  audit_action text;
  audit_reason text;
begin
  audit_action := case
    when old.is_active = true and new.is_active = false then 'archived'
    when old.is_active = false and new.is_active = true then 'restored'
    else 'updated'
  end;

  audit_reason := case audit_action
    when 'archived' then 'Dog Master 비활성화'
    when 'restored' then 'Dog Master 활성 복구'
    else 'Dog Master 정보 수정'
  end;

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
    'dog',
    new.id,
    audit_action,
    to_jsonb(old),
    to_jsonb(new),
    coalesce(new.updated_by, auth.uid()),
    audit_reason
  );

  return new;
end;
$$;

drop trigger if exists dogs_master_audit
  on public.dogs;

create trigger dogs_master_audit
  after update
  on public.dogs
  for each row
  execute function public.record_dog_master_audit();

drop policy if exists dogs_update
  on public.dogs;
drop policy if exists dogs_update_admin
  on public.dogs;
drop policy if exists dogs_update_active_user
  on public.dogs;

create policy dogs_update_active_user
  on public.dogs
  for update
  to authenticated
  using (public.is_active_user())
  with check (public.is_active_user());

grant update on table public.dogs
  to authenticated;

revoke all on function public.stamp_dog_master_metadata()
  from public;
revoke all on function public.record_dog_master_audit()
  from public;

commit;
