-- P&M OS Operations 담당자별 일정 색상
-- 운영 Supabase에는 자동 적용하지 않는다.

begin;

do $$
begin
  if to_regclass('public.operation_memberships') is null
    or to_regclass('public.profiles') is null
    or to_regclass('public.entity_audit_events') is null
    or to_regprocedure('public.is_active_operation_member()') is null
    or to_regprocedure('public.record_operation_audit_event()') is null then
    raise exception 'Operations Foundation과 운영 권한 관리를 먼저 적용해 주세요.';
  end if;

  if not exists (
    select 1
    from pg_trigger trigger_info
    where trigger_info.tgrelid = 'public.operation_memberships'::regclass
      and trigger_info.tgname = 'operation_memberships_audit'
      and not trigger_info.tgisinternal
  ) then
    raise exception 'operation_memberships 감사 Trigger를 확인할 수 없습니다.';
  end if;
end;
$$;

alter table public.operation_memberships
  add column if not exists schedule_color text null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint constraint_info
    where constraint_info.conrelid =
      'public.operation_memberships'::regclass
      and constraint_info.conname =
        'operation_memberships_schedule_color_check'
  ) then
    alter table public.operation_memberships
      add constraint operation_memberships_schedule_color_check
      check (
        schedule_color is null
        or schedule_color ~ '^#[0-9A-Fa-f]{6}$'
      );
  end if;
end;
$$;

create or replace function public.get_active_operation_assignees()
returns table (
  profile_id uuid,
  profile_name text,
  operation_role text,
  schedule_color text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    membership.profile_id,
    profile.name,
    membership.role,
    membership.schedule_color
  from public.operation_memberships membership
  join public.profiles profile
    on profile.id = membership.profile_id
  where public.is_active_operation_member()
    and membership.is_active = true
    and profile.is_active = true
    and profile.account_status = 'active'
  order by profile.name nulls last, membership.profile_id;
$$;

create or replace function public.set_operation_member_schedule_color(
  p_target_profile_id uuid,
  p_schedule_color text,
  p_expected_updated_at timestamptz,
  p_request_id uuid
)
returns table (
  profile_id uuid,
  schedule_color text,
  membership_updated_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_membership public.operation_memberships%rowtype;
  existing_event public.entity_audit_events%rowtype;
  normalized_color text := upper(nullif(btrim(p_schedule_color), ''));
begin
  if p_target_profile_id is null or p_request_id is null then
    raise exception '대상 사용자와 요청 ID가 필요합니다.'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.profiles caller
    where caller.id = auth.uid()
      and caller.role = 'admin'
      and caller.is_active = true
      and caller.account_status = 'active'
  ) then
    raise exception '대표 관리자만 캘린더 색상을 변경할 수 있습니다.'
      using errcode = '42501';
  end if;

  if normalized_color is not null
    and normalized_color !~ '^#[0-9A-F]{6}$' then
    raise exception '일정 색상은 #RRGGBB 형식이어야 합니다.'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_request_id::text, 0)
  );

  select audit.*
  into existing_event
  from public.entity_audit_events audit
  where audit.module_code = 'operations'
    and audit.entity_type = 'operation_memberships'
    and audit.request_id = p_request_id;

  if found then
    if existing_event.entity_id <> p_target_profile_id
      or upper(nullif(existing_event.after_data ->> 'schedule_color', ''))
        is distinct from normalized_color
    then
      raise exception '동일한 요청 ID가 다른 일정 색상 변경에 사용되었습니다.'
        using errcode = '22023';
    end if;

    return query
    select
      membership.profile_id,
      membership.schedule_color,
      membership.updated_at
    from public.operation_memberships membership
    where membership.profile_id = p_target_profile_id;
    return;
  end if;

  select membership.*
  into target_membership
  from public.operation_memberships membership
  where membership.profile_id = p_target_profile_id
  for update;

  if not found then
    raise exception 'Operations Membership을 확인할 수 없습니다.'
      using errcode = 'P0002';
  end if;

  if p_expected_updated_at is null
    or target_membership.updated_at is distinct from p_expected_updated_at
  then
    raise exception '다른 사용자가 Operations 정보를 먼저 변경했습니다. 새로고침 후 다시 시도해 주세요.'
      using errcode = '40001';
  end if;

  perform set_config(
    'app.operation_change_reason',
    '직원 관리에서 담당자 일정 색상 변경',
    true
  );
  perform set_config('app.operation_request_id', p_request_id::text, true);

  update public.operation_memberships membership
  set schedule_color = normalized_color,
      updated_at = now()
  where membership.profile_id = p_target_profile_id;

  return query
  select
    membership.profile_id,
    membership.schedule_color,
    membership.updated_at
  from public.operation_memberships membership
  where membership.profile_id = p_target_profile_id;
end;
$$;

revoke all on function public.get_active_operation_assignees()
  from public, anon;
grant execute on function public.get_active_operation_assignees()
  to authenticated;

revoke all on function public.set_operation_member_schedule_color(
  uuid, text, timestamptz, uuid
) from public, anon;
grant execute on function public.set_operation_member_schedule_color(
  uuid, text, timestamptz, uuid
) to authenticated;

commit;
