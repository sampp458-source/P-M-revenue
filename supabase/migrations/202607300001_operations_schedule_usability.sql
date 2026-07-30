-- P&M OS Operations 일정 분류·담당자 색상 확장
-- 운영 Supabase에는 자동 적용하지 않는다.

begin;

do $$
begin
  if to_regclass('public.operation_memberships') is null
    or to_regclass('public.operation_calendars') is null
    or to_regclass('public.operation_schedule_types') is null
    or to_regclass('public.operation_schedules') is null
    or to_regclass('public.entity_audit_events') is null then
    raise exception 'Operations Foundation과 Single Schedule을 먼저 적용해 주세요.';
  end if;
end;
$$;

alter table public.operation_memberships
  add column if not exists schedule_color text null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.operation_memberships'::regclass
      and conname = 'operation_memberships_schedule_color_check'
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

create table if not exists public.operation_calendar_schedule_types (
  id uuid primary key default gen_random_uuid(),
  calendar_id uuid not null
    references public.operation_calendars(id) on delete restrict,
  schedule_type_id uuid not null
    references public.operation_schedule_types(id) on delete restrict,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_by uuid null references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz null,
  archived_by uuid null references public.profiles(id) on delete restrict,
  archive_reason text null,
  constraint operation_calendar_schedule_types_archive_check check (
    (archived_at is null and archived_by is null and archive_reason is null)
    or (
      archived_at is not null
      and archived_by is not null
      and nullif(btrim(archive_reason), '') is not null
    )
  )
);

create unique index if not exists operation_calendar_schedule_types_active_uidx
  on public.operation_calendar_schedule_types (
    calendar_id,
    schedule_type_id
  )
  where archived_at is null;

create index if not exists operation_calendar_schedule_types_lookup_idx
  on public.operation_calendar_schedule_types (
    calendar_id,
    is_active,
    sort_order,
    schedule_type_id
  )
  where archived_at is null;

drop trigger if exists operation_calendar_schedule_types_updated_at
  on public.operation_calendar_schedule_types;
create trigger operation_calendar_schedule_types_updated_at
  before update on public.operation_calendar_schedule_types
  for each row execute function public.set_updated_at();

drop trigger if exists operation_calendar_schedule_types_audit
  on public.operation_calendar_schedule_types;
create trigger operation_calendar_schedule_types_audit
  after insert or update on public.operation_calendar_schedule_types
  for each row execute function public.record_operation_audit_event();

insert into public.operation_calendar_schedule_types (
  calendar_id,
  schedule_type_id,
  is_active,
  sort_order,
  created_by
)
select
  schedule.calendar_id,
  schedule.schedule_type_id,
  true,
  schedule_type.sort_order,
  null
from public.operation_schedules schedule
join public.operation_schedule_types schedule_type
  on schedule_type.id = schedule.schedule_type_id
group by schedule.calendar_id, schedule.schedule_type_id,
  schedule_type.sort_order
on conflict do nothing;

insert into public.operation_calendar_schedule_types (
  calendar_id,
  schedule_type_id,
  is_active,
  sort_order,
  created_by
)
select
  calendar.id,
  schedule_type.id,
  true,
  schedule_type.sort_order,
  null
from public.operation_calendars calendar
left join public.business_units unit on unit.id = calendar.business_unit_id
join public.operation_schedule_types schedule_type
  on (
    (schedule_type.name = '상담' and unit.code in ('daycare', 'training'))
    or (schedule_type.name = '수업' and unit.code in ('daycare', 'training'))
    or (schedule_type.name = '입실·퇴실' and unit.code = 'hotel')
    or (
      schedule_type.name in ('회의', '내부 업무', '휴무')
      and calendar.scope_type = 'common'
    )
    or (
      schedule_type.name = '개인 일정'
      and calendar.scope_type = 'personal'
    )
    or (
      schedule_type.name = '기타'
      and (
        unit.code in ('daycare', 'training', 'hotel')
        or calendar.scope_type in ('common', 'personal')
      )
    )
  )
where calendar.is_active = true
  and schedule_type.is_active = true
on conflict do nothing;

alter table public.operation_calendar_schedule_types
  enable row level security;

drop policy if exists operation_calendar_schedule_types_select_members
  on public.operation_calendar_schedule_types;
create policy operation_calendar_schedule_types_select_members
  on public.operation_calendar_schedule_types
  for select to authenticated
  using (public.is_active_operation_member());

revoke all on table public.operation_calendar_schedule_types
  from anon, authenticated;
grant select on table public.operation_calendar_schedule_types
  to authenticated;

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
  join public.profiles profile on profile.id = membership.profile_id
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
  target public.operation_memberships%rowtype;
  existing_event public.entity_audit_events%rowtype;
  normalized_color text := upper(nullif(btrim(p_schedule_color), ''));
begin
  if not public.has_operation_role(array['owner']) then
    raise exception 'Operations 최고 관리자만 일정 색상을 변경할 수 있습니다.'
      using errcode = '42501';
  end if;

  if p_target_profile_id is null or p_request_id is null then
    raise exception '대상 사용자와 요청 ID가 필요합니다.'
      using errcode = '22023';
  end if;

  if normalized_color is not null
    and normalized_color !~ '^#[0-9A-F]{6}$' then
    raise exception '일정 색상은 #RRGGBB 형식이어야 합니다.'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));

  select * into existing_event
  from public.entity_audit_events audit
  where audit.module_code = 'operations'
    and audit.entity_type = 'operation_memberships'
    and audit.request_id = p_request_id;

  if found then
    return query
    select membership.profile_id, membership.schedule_color,
      membership.updated_at
    from public.operation_memberships membership
    where membership.profile_id = p_target_profile_id;
    return;
  end if;

  select * into target
  from public.operation_memberships membership
  where membership.profile_id = p_target_profile_id
  for update;

  if not found then
    raise exception 'Operations Membership을 확인할 수 없습니다.'
      using errcode = 'P0002';
  end if;

  if target.updated_at is distinct from p_expected_updated_at then
    raise exception '다른 사용자가 먼저 Operations 정보를 변경했습니다.'
      using errcode = '40001';
  end if;

  perform set_config('app.operation_change_reason', '담당자 일정 색상 변경', true);
  perform set_config('app.operation_request_id', p_request_id::text, true);

  update public.operation_memberships membership
  set schedule_color = normalized_color
  where membership.profile_id = p_target_profile_id;

  return query
  select membership.profile_id, membership.schedule_color,
    membership.updated_at
  from public.operation_memberships membership
  where membership.profile_id = p_target_profile_id;
end;
$$;

create or replace function public.assert_operation_schedule_input(
  p_calendar_id uuid,
  p_schedule_type_id uuid,
  p_title text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_assignee_ids uuid[],
  p_customer_ids uuid[],
  p_dog_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_active_operation_member() then
    raise exception 'Operations 일정 권한이 없습니다.'
      using errcode = '42501';
  end if;
  if nullif(btrim(p_title), '') is null then
    raise exception '일정 제목을 입력해 주세요.' using errcode = '22023';
  end if;
  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then
    raise exception '종료 시간은 시작 시간보다 늦어야 합니다.'
      using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.operation_calendar_schedule_types mapping
    join public.operation_calendars calendar on calendar.id = mapping.calendar_id
    join public.operation_schedule_types schedule_type
      on schedule_type.id = mapping.schedule_type_id
    where mapping.calendar_id = p_calendar_id
      and mapping.schedule_type_id = p_schedule_type_id
      and mapping.is_active = true
      and mapping.archived_at is null
      and calendar.is_active = true
      and schedule_type.is_active = true
  ) then
    raise exception '선택한 캘린더에서 사용할 수 없는 일정 유형입니다.'
      using errcode = '22023';
  end if;
  if cardinality(coalesce(p_assignee_ids, '{}'::uuid[])) = 0 then
    raise exception '담당자를 한 명 이상 선택해 주세요.'
      using errcode = '22023';
  end if;
  if exists (
    select 1
    from unnest(coalesce(p_assignee_ids, '{}'::uuid[])) requested(id)
    left join public.profiles profile on profile.id = requested.id
    left join public.operation_memberships membership
      on membership.profile_id = requested.id
    where profile.id is null
      or profile.is_active is distinct from true
      or profile.account_status is distinct from 'active'
      or membership.profile_id is null
      or membership.is_active is distinct from true
  ) then
    raise exception '활성 Operations 구성원만 담당자로 연결할 수 있습니다.'
      using errcode = '22023';
  end if;
  if exists (
    select 1
    from unnest(coalesce(p_customer_ids, '{}'::uuid[])) requested(id)
    left join public.customers customer on customer.id = requested.id
    where customer.id is null or customer.is_active is distinct from true
  ) then
    raise exception '활성 보호자만 일정에 연결할 수 있습니다.'
      using errcode = '22023';
  end if;
  if exists (
    select 1
    from unnest(coalesce(p_dog_ids, '{}'::uuid[])) requested(id)
    left join public.dogs dog on dog.id = requested.id
    where dog.id is null or dog.is_active is distinct from true
  ) then
    raise exception '활성 반려견만 일정에 연결할 수 있습니다.'
      using errcode = '22023';
  end if;
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
