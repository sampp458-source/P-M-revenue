-- P&M OS Operations membership role management
-- Finance profiles.role과 회계 객체는 변경하지 않는다.

begin;

create unique index if not exists entity_audit_events_operation_membership_request_uidx
  on public.entity_audit_events (request_id)
  where module_code = 'operations'
    and entity_type = 'operation_memberships'
    and request_id is not null;

create or replace function public.sync_operation_membership_from_profile()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_membership public.operation_memberships%rowtype;
  active_owner_count integer;
begin
  if new.is_active = true and new.account_status = 'active' then
    insert into public.operation_memberships (profile_id, role, is_active)
    values (new.id, 'staff', true)
    on conflict (profile_id) do update
      set is_active = true,
          updated_at = now();
  else
    select *
    into target_membership
    from public.operation_memberships
    where profile_id = new.id
    for update;

    if found
      and target_membership.role = 'owner'
      and target_membership.is_active = true
    then
      perform pg_advisory_xact_lock(
        hashtextextended('operation-active-owner-protection', 0)
      );

      select count(*)
      into active_owner_count
      from public.operation_memberships membership
      join public.profiles profile on profile.id = membership.profile_id
      where membership.role = 'owner'
        and membership.is_active = true
        and profile.is_active = true
        and profile.account_status = 'active';

      if active_owner_count = 0 then
        raise exception '마지막 활성 Operations 최고 관리자는 비활성화할 수 없습니다.'
          using errcode = 'P0001';
      end if;
    end if;

    update public.operation_memberships
    set is_active = false,
        updated_at = now()
    where profile_id = new.id
      and is_active = true;
  end if;

  return new;
end;
$$;

create or replace function public.get_operation_membership_directory()
returns table (
  profile_id uuid,
  operation_role text,
  membership_is_active boolean,
  membership_updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.has_operation_role(array['manager', 'owner']) then
    raise exception 'Operations 구성원 권한을 조회할 수 없습니다.'
      using errcode = '42501';
  end if;

  return query
  select
    membership.profile_id,
    membership.role,
    membership.is_active,
    membership.updated_at
  from public.operation_memberships membership;
end;
$$;

create or replace function public.set_operation_member_role(
  p_target_profile_id uuid,
  p_new_role text,
  p_expected_updated_at timestamptz,
  p_request_id uuid
)
returns table (
  profile_id uuid,
  operation_role text,
  membership_is_active boolean,
  membership_updated_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_profile public.profiles%rowtype;
  target_membership public.operation_memberships%rowtype;
  existing_event public.entity_audit_events%rowtype;
  active_owner_count integer;
begin
  if p_target_profile_id is null or p_request_id is null then
    raise exception '대상 사용자와 요청 ID가 필요합니다.'
      using errcode = '22023';
  end if;

  if p_new_role is null or p_new_role not in ('owner', 'manager', 'staff') then
    raise exception '유효하지 않은 Operations 역할입니다.'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));

  if not public.has_operation_role(array['owner']) then
    raise exception 'Operations 최고 관리자만 역할을 변경할 수 있습니다.'
      using errcode = '42501';
  end if;

  select *
  into existing_event
  from public.entity_audit_events audit
  where audit.module_code = 'operations'
    and audit.entity_type = 'operation_memberships'
    and audit.request_id = p_request_id;

  if found then
    if existing_event.entity_id <> p_target_profile_id
      or existing_event.after_data ->> 'role' is distinct from p_new_role
    then
      raise exception '동일한 요청 ID가 다른 역할 변경에 사용되었습니다.'
        using errcode = '22023';
    end if;

    return query
    select
      membership.profile_id,
      membership.role,
      membership.is_active,
      membership.updated_at
    from public.operation_memberships membership
    where membership.profile_id = p_target_profile_id;
    return;
  end if;

  select *
  into target_profile
  from public.profiles
  where id = p_target_profile_id;

  if not found then
    raise exception '대상 직원을 확인할 수 없습니다.'
      using errcode = 'P0002';
  end if;

  select *
  into target_membership
  from public.operation_memberships
  where profile_id = p_target_profile_id
  for update;

  if not found then
    perform set_config(
      'app.operation_change_reason',
      '직원 관리에서 Operations 역할 생성',
      true
    );
    perform set_config('app.operation_request_id', p_request_id::text, true);

    insert into public.operation_memberships (
      profile_id,
      role,
      is_active
    )
    values (
      p_target_profile_id,
      p_new_role,
      target_profile.is_active = true
        and target_profile.account_status = 'active'
    )
    returning * into target_membership;

    return query
    select
      membership.profile_id,
      membership.role,
      membership.is_active,
      membership.updated_at
    from public.operation_memberships membership
    where membership.profile_id = p_target_profile_id;
    return;
  elsif p_expected_updated_at is null
    or target_membership.updated_at is distinct from p_expected_updated_at
  then
    raise exception '다른 사용자가 Operations 권한을 먼저 변경했습니다. 새로고침 후 다시 시도해 주세요.'
      using errcode = '40001';
  end if;

  if target_membership.role = 'owner' and p_new_role <> 'owner'
    and target_membership.is_active = true
    and target_profile.is_active = true
    and target_profile.account_status = 'active'
  then
    perform pg_advisory_xact_lock(
      hashtextextended('operation-active-owner-protection', 0)
    );

    select count(*)
    into active_owner_count
    from public.operation_memberships membership
    join public.profiles profile on profile.id = membership.profile_id
    where membership.role = 'owner'
      and membership.is_active = true
      and profile.is_active = true
      and profile.account_status = 'active';

    if active_owner_count <= 1 then
      raise exception '마지막 활성 Operations 최고 관리자의 권한은 변경할 수 없습니다.'
        using errcode = 'P0001';
    end if;
  end if;

  perform set_config(
    'app.operation_change_reason',
    '직원 관리에서 Operations 역할 변경',
    true
  );
  perform set_config('app.operation_request_id', p_request_id::text, true);

  update public.operation_memberships
  set role = p_new_role,
      updated_at = now()
  where operation_memberships.profile_id = p_target_profile_id;

  return query
  select
    membership.profile_id,
    membership.role,
    membership.is_active,
    membership.updated_at
  from public.operation_memberships membership
  where membership.profile_id = p_target_profile_id;
end;
$$;

revoke all on function public.get_operation_membership_directory() from public;
revoke all on function public.set_operation_member_role(uuid, text, timestamptz, uuid) from public;

grant execute on function public.get_operation_membership_directory()
  to authenticated;
grant execute on function public.set_operation_member_role(uuid, text, timestamptz, uuid)
  to authenticated;

commit;
