-- Operations 일정 사용성 확장 제한적 Rollback
-- 일정 데이터가 존재하면 기존 일정 검증 함수 복원이 필요하므로 중단한다.

begin;

do $$
declare
  schedule_count bigint;
begin
  select count(*) into schedule_count from public.operation_schedules;
  if schedule_count > 0 then
    raise exception
      'operation_schedules에 %건이 존재하여 Rollback을 중단합니다.',
      schedule_count;
  end if;
end;
$$;

drop function if exists public.set_operation_member_schedule_color(
  uuid, text, timestamptz, uuid
);
drop function if exists public.get_active_operation_assignees();

drop function if exists public.assert_operation_schedule_input(
  uuid, uuid, text, timestamptz, timestamptz, uuid[], uuid[], uuid[]
);
drop table if exists public.operation_calendar_schedule_types;

alter table public.operation_memberships
  drop constraint if exists operation_memberships_schedule_color_check;
alter table public.operation_memberships
  drop column if exists schedule_color;

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
    select 1 from public.operation_calendars calendar
    where calendar.id = p_calendar_id and calendar.is_active = true
  ) then
    raise exception '사용 가능한 캘린더를 확인할 수 없습니다.'
      using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.operation_schedule_types schedule_type
    where schedule_type.id = p_schedule_type_id
      and schedule_type.is_active = true
  ) then
    raise exception '사용 가능한 일정 유형을 확인할 수 없습니다.'
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

commit;
