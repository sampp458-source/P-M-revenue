-- 직원 회원가입, 관리자 승인, 퇴사 계정 보존
-- 검토용 Migration: 자동 실행하지 않는다.

begin;

alter table public.profiles
  add column if not exists email text null,
  add column if not exists account_status text,
  add column if not exists approved_at timestamptz null,
  add column if not exists approved_by uuid null references public.profiles(id) on delete set null,
  add column if not exists rejection_reason text null,
  add column if not exists deactivated_at timestamptz null,
  add column if not exists deactivated_by uuid null references public.profiles(id) on delete set null,
  add column if not exists deactivation_reason text null;

update public.profiles
set account_status = case when is_active then 'active' else 'inactive' end
where account_status is null;

update public.profiles p
set email = u.email
from auth.users u
where u.id = p.id and p.email is null;

alter table public.profiles
  alter column account_status set default 'pending',
  alter column account_status set not null;

alter table public.profiles
  drop constraint if exists profiles_account_status_check;
alter table public.profiles
  add constraint profiles_account_status_check
  check (account_status in ('pending', 'active', 'rejected', 'inactive'));

create unique index if not exists profiles_email_uidx
  on public.profiles (lower(email))
  where email is not null;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, name, email, role, is_active, account_status)
  values (
    new.id,
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'name'), ''), split_part(coalesce(new.email, '직원'), '@', 1)),
    new.email,
    'staff',
    false,
    'pending'
  );
  return new;
end;
$$;

create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and is_active = true
      and account_status = 'active'
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and is_active = true
      and account_status = 'active'
      and role = 'admin'
  );
$$;

create or replace function public.protect_profile_account_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  active_admin_count integer;
begin
  if auth.uid() is null then
    if current_user not in ('postgres', 'supabase_admin') then
      raise exception '인증되지 않은 역할은 직원 계정 정보를 변경할 수 없습니다.' using errcode = '42501';
    end if;

    if new.account_status = 'active' then
      new.is_active = true;
    else
      new.is_active = false;
    end if;

    return new;
  end if;

  if not public.is_admin() then
    raise exception '직원 계정 상태는 관리자만 변경할 수 있습니다.' using errcode = '42501';
  end if;

  if old.role = 'admin' and old.id = auth.uid()
    and (new.account_status <> 'active' or not new.is_active or new.role <> 'admin') then
    raise exception '관리자는 자신의 계정을 비활성화하거나 관리자 권한을 해제할 수 없습니다.' using errcode = 'P0001';
  end if;

  if old.role = 'admin'
    and (new.account_status <> 'active' or not new.is_active or new.role <> 'admin') then
    select count(*) into active_admin_count
    from public.profiles
    where role = 'admin'
      and account_status = 'active'
      and is_active = true
      and id <> old.id;
    if active_admin_count = 0 then
      raise exception '마지막 관리자 계정은 비활성화할 수 없습니다.' using errcode = 'P0001';
    end if;
  end if;

  if new.account_status = 'active' then
    new.is_active = true;
  else
    new.is_active = false;
  end if;

  if old.role = 'staff' then
    new.role = 'staff';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_protect_account_changes on public.profiles;
create trigger profiles_protect_account_changes
  before update on public.profiles
  for each row execute function public.protect_profile_account_changes();

drop policy if exists profiles_select on public.profiles;
drop policy if exists profiles_select_self_or_active_user on public.profiles;
create policy profiles_select_self_or_active_user
  on public.profiles
  for select
  to authenticated
  using (id = auth.uid() or public.is_active_user());

drop policy if exists profiles_update_admin on public.profiles;
create policy profiles_update_admin
  on public.profiles
  for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

revoke all on function public.protect_profile_account_changes() from public;
grant execute on function public.protect_profile_account_changes() to authenticated;

commit;
