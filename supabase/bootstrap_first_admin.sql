-- Supabase SQL Editor에서 migration 실행 후 한 번 실행합니다.
-- 아래 이메일을 Authentication에 수동 생성한 실제 관리자 이메일로 교체하세요.

do $$
declare
  target_email text := 'REPLACE_WITH_ADMIN_EMAIL@example.com';
  target_user_id uuid;
begin
  if target_email = 'REPLACE_WITH_ADMIN_EMAIL@example.com' then
    raise exception 'target_email을 실제 관리자 이메일로 교체하세요.';
  end if;

  select id
  into target_user_id
  from auth.users
  where lower(email) = lower(target_email)
  limit 1;

  if target_user_id is null then
    raise exception 'Authentication에서 해당 이메일 사용자를 찾을 수 없습니다: %', target_email;
  end if;

  insert into public.profiles (id, name, role, is_active)
  select
    target_user_id,
    coalesce(
      nullif(raw_user_meta_data ->> 'name', ''),
      split_part(coalesce(email, '관리자'), '@', 1)
    ),
    'admin',
    true
  from auth.users
  where id = target_user_id
  on conflict (id) do update
  set
    role = 'admin',
    is_active = true,
    updated_at = now();

  raise notice '최초 관리자 설정 완료: %', target_email;
end;
$$;
