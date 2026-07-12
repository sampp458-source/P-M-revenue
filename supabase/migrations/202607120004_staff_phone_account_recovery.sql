-- 직원 휴대폰, 개인정보 보호 디렉터리, 안전한 아이디 찾기
-- 202607120003_staff_account_approval.sql 적용 후 실행한다.
-- 검토용 Migration: 자동 실행하지 않는다.

begin;

alter table public.profiles
  add column if not exists phone text null;

update public.profiles p
set phone = regexp_replace(u.raw_user_meta_data ->> 'phone', '[^0-9]', '', 'g')
from auth.users u
where u.id = p.id
  and p.phone is null
  and regexp_replace(coalesce(u.raw_user_meta_data ->> 'phone', ''), '[^0-9]', '', 'g') ~ '^010[0-9]{8}$';

update public.profiles
set phone = regexp_replace(phone, '[^0-9]', '', 'g')
where phone is not null;

do $$
begin
  if exists (
    select 1
    from public.profiles
    where phone is not null
    group by phone
    having count(*) > 1
  ) then
    raise exception '기존 직원 데이터에 중복된 휴대폰 번호가 있습니다. 중복 번호를 정리한 후 다시 실행해주세요.'
      using errcode = '23505';
  end if;
end;
$$;

alter table public.profiles
  drop constraint if exists profiles_phone_format_check;
alter table public.profiles
  add constraint profiles_phone_format_check
  check (phone is null or phone ~ '^010[0-9]{8}$');

create unique index if not exists profiles_phone_uidx
  on public.profiles (phone)
  where phone is not null;

create index if not exists profiles_name_lookup_idx
  on public.profiles (lower(regexp_replace(btrim(name), '\s+', '', 'g')));

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_phone text;
begin
  normalized_phone := regexp_replace(coalesce(new.raw_user_meta_data ->> 'phone', ''), '[^0-9]', '', 'g');
  if normalized_phone !~ '^010[0-9]{8}$' then
    raise exception '올바른 휴대폰 번호가 필요합니다.' using errcode = 'P0001';
  end if;

  begin
    insert into public.profiles (id, name, email, phone, role, is_active, account_status)
    values (
      new.id,
      coalesce(nullif(btrim(new.raw_user_meta_data ->> 'name'), ''), split_part(coalesce(new.email, '직원'), '@', 1)),
      new.email,
      normalized_phone,
      'staff',
      false,
      'pending'
    );
  exception
    when unique_violation then
      raise exception '이미 사용 중인 휴대폰 번호입니다.' using errcode = '23505';
  end;
  return new;
end;
$$;

drop policy if exists profiles_select_self_or_active_user on public.profiles;
drop policy if exists profiles_select_self_or_admin on public.profiles;
create policy profiles_select_self_or_admin
  on public.profiles
  for select
  to authenticated
  using (id = auth.uid() or public.is_admin());

drop function if exists public.get_staff_directory();

create or replace function public.get_active_staff_directory()
returns table (id uuid, name text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_active_user() then
    raise exception '권한이 없습니다.' using errcode = '42501';
  end if;
  return query
    select p.id, p.name
    from public.profiles p
    where p.role in ('admin', 'staff')
      and p.account_status = 'active'
      and p.is_active = true
    order by p.name;
end;
$$;

create or replace function public.get_staff_history_directory()
returns table (id uuid, name text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_active_user() then
    raise exception '권한이 없습니다.' using errcode = '42501';
  end if;
  return query
    select p.id, p.name
    from public.profiles p
    where p.role in ('admin', 'staff')
      and p.account_status in ('active', 'inactive')
    order by p.name;
end;
$$;

create or replace function public.find_staff_account(p_name text, p_phone text)
returns table (masked_email text, account_status text)
language sql
stable
security definer
set search_path = public, pg_temp
set statement_timeout = '3s'
as $$
  select
    case
      when position('@' in p.email) = 0 then null
      else
        left(split_part(p.email, '@', 1), least(3, length(split_part(p.email, '@', 1))))
        || '***@' || split_part(p.email, '@', 2)
    end as masked_email,
    p.account_status
  from public.profiles p
  where lower(regexp_replace(btrim(p.name), '\s+', '', 'g')) = lower(regexp_replace(btrim(coalesce(p_name, '')), '\s+', '', 'g'))
    and p.phone = regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g')
    and p.phone ~ '^010[0-9]{8}$'
    and p.email is not null
  limit 1;
$$;

revoke all on function public.get_active_staff_directory() from public;
revoke all on function public.get_staff_history_directory() from public;
revoke all on function public.find_staff_account(text, text) from public;
grant execute on function public.get_active_staff_directory() to authenticated;
grant execute on function public.get_staff_history_directory() to authenticated;
grant execute on function public.find_staff_account(text, text) to anon, authenticated;

commit;
