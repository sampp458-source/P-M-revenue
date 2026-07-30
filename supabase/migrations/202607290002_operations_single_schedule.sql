-- P&M OS Operations Sprint 3: single schedule RPC foundation
-- 운영 Supabase에는 자동 실행하지 않는다.
-- Finance 회계 객체와 공용 Customer/Dog Master 데이터는 변경하지 않는다.

begin;

do $$
begin
  if to_regclass('public.operation_memberships') is null
    or to_regclass('public.operation_calendars') is null
    or to_regclass('public.operation_schedule_types') is null
    or to_regclass('public.entity_audit_events') is null
    or to_regclass('public.operation_schedules') is null
    or to_regclass('public.operation_schedule_assignees') is null
    or to_regclass('public.operation_schedule_dogs') is null
    or to_regclass('public.operation_schedule_customers') is null then
    raise exception
      '202607290001_operations_schedule_foundation.sql을 먼저 적용해 주세요.'
      using errcode = 'P0001';
  end if;
end;
$$;

alter table public.operation_schedules
  add column if not exists updated_by uuid null
    references public.profiles(id) on delete restrict;

comment on column public.operation_schedules.description is
  '사용자 UI의 일정 메모. 기존 Foundation 컬럼을 재사용한다.';

comment on column public.operation_schedules.updated_by is
  '마지막 변경자. Migration 이전 일정은 null일 수 있으며 RPC 변경 시 기록한다.';

create or replace function public.operation_schedule_json(p_schedule_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', schedule.id,
    'calendarId', schedule.calendar_id,
    'calendarName', calendar.name,
    'calendarColor', calendar.color,
    'calendarScope', calendar.scope_type,
    'businessUnitCode', business_unit.code,
    'businessUnitName', business_unit.name,
    'scheduleTypeId', schedule.schedule_type_id,
    'scheduleTypeName', schedule_type.name,
    'scheduleTypeColor', schedule_type.color,
    'title', schedule.title,
    'memo', schedule.description,
    'startsAt', schedule.starts_at,
    'endsAt', schedule.ends_at,
    'allDay', schedule.all_day,
    'status', schedule.status,
    'version', schedule.version,
    'requestId', schedule.request_id,
    'createdBy', schedule.created_by,
    'createdByName', creator.name,
    'createdAt', schedule.created_at,
    'updatedBy', schedule.updated_by,
    'updatedByName', updater.name,
    'updatedAt', schedule.updated_at,
    'archivedAt', schedule.archived_at,
    'assignees', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', profile.id,
          'name', profile.name
        )
        order by profile.name nulls last, profile.id
      )
      from public.operation_schedule_assignees assignee
      join public.profiles profile on profile.id = assignee.profile_id
      where assignee.schedule_id = schedule.id
        and assignee.archived_at is null
    ), '[]'::jsonb),
    'dogs', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', dog.id,
          'name', dog.name,
          'customerId', dog.customer_id
        )
        order by dog.name, dog.id
      )
      from public.operation_schedule_dogs schedule_dog
      join public.dogs dog on dog.id = schedule_dog.dog_id
      where schedule_dog.schedule_id = schedule.id
        and schedule_dog.archived_at is null
    ), '[]'::jsonb),
    'customers', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', customer.id,
          'name', customer.name,
          'phone', customer.phone
        )
        order by customer.name nulls last, customer.id
      )
      from public.operation_schedule_customers schedule_customer
      join public.customers customer on customer.id = schedule_customer.customer_id
      where schedule_customer.schedule_id = schedule.id
        and schedule_customer.archived_at is null
    ), '[]'::jsonb)
  )
  from public.operation_schedules schedule
  join public.operation_calendars calendar on calendar.id = schedule.calendar_id
  join public.operation_schedule_types schedule_type
    on schedule_type.id = schedule.schedule_type_id
  left join public.business_units business_unit
    on business_unit.id = calendar.business_unit_id
  left join public.profiles creator on creator.id = schedule.created_by
  left join public.profiles updater on updater.id = schedule.updated_by
  where schedule.id = p_schedule_id;
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
    raise exception '일정 제목을 입력해 주세요.'
      using errcode = '22023';
  end if;

  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then
    raise exception '종료 시간은 시작 시간보다 늦어야 합니다.'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.operation_calendars calendar
    where calendar.id = p_calendar_id
      and calendar.is_active = true
  ) then
    raise exception '사용 가능한 캘린더를 확인할 수 없습니다.'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.operation_schedule_types schedule_type
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
    where customer.id is null
      or customer.is_active is distinct from true
  ) then
    raise exception '활성 보호자만 일정에 연결할 수 있습니다.'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from unnest(coalesce(p_dog_ids, '{}'::uuid[])) requested(id)
    left join public.dogs dog on dog.id = requested.id
    where dog.id is null
      or dog.is_active is distinct from true
  ) then
    raise exception '활성 반려견만 일정에 연결할 수 있습니다.'
      using errcode = '22023';
  end if;
end;
$$;

create or replace function public.sync_operation_schedule_links(
  p_schedule_id uuid,
  p_assignee_ids uuid[],
  p_customer_ids uuid[],
  p_dog_ids uuid[],
  p_changed_by uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.operation_schedule_assignees link
  set archived_at = now(),
      archived_by = p_changed_by,
      archive_reason = '일정 연결 변경'
  where link.schedule_id = p_schedule_id
    and link.archived_at is null
    and not (
      link.profile_id = any(coalesce(p_assignee_ids, '{}'::uuid[]))
    );

  insert into public.operation_schedule_assignees (
    schedule_id,
    profile_id,
    created_by
  )
  select
    p_schedule_id,
    requested.id,
    p_changed_by
  from (
    select distinct unnest(coalesce(p_assignee_ids, '{}'::uuid[])) as id
  ) requested
  where not exists (
    select 1
    from public.operation_schedule_assignees existing
    where existing.schedule_id = p_schedule_id
      and existing.profile_id = requested.id
      and existing.archived_at is null
  );

  update public.operation_schedule_customers link
  set archived_at = now(),
      archived_by = p_changed_by,
      archive_reason = '일정 연결 변경'
  where link.schedule_id = p_schedule_id
    and link.archived_at is null
    and not (
      link.customer_id = any(coalesce(p_customer_ids, '{}'::uuid[]))
    );

  insert into public.operation_schedule_customers (
    schedule_id,
    customer_id,
    created_by
  )
  select
    p_schedule_id,
    requested.id,
    p_changed_by
  from (
    select distinct unnest(coalesce(p_customer_ids, '{}'::uuid[])) as id
  ) requested
  where not exists (
    select 1
    from public.operation_schedule_customers existing
    where existing.schedule_id = p_schedule_id
      and existing.customer_id = requested.id
      and existing.archived_at is null
  );

  update public.operation_schedule_dogs link
  set archived_at = now(),
      archived_by = p_changed_by,
      archive_reason = '일정 연결 변경'
  where link.schedule_id = p_schedule_id
    and link.archived_at is null
    and not (
      link.dog_id = any(coalesce(p_dog_ids, '{}'::uuid[]))
    );

  insert into public.operation_schedule_dogs (
    schedule_id,
    dog_id,
    created_by
  )
  select
    p_schedule_id,
    requested.id,
    p_changed_by
  from (
    select distinct unnest(coalesce(p_dog_ids, '{}'::uuid[])) as id
  ) requested
  where not exists (
    select 1
    from public.operation_schedule_dogs existing
    where existing.schedule_id = p_schedule_id
      and existing.dog_id = requested.id
      and existing.archived_at is null
  );
end;
$$;

create or replace function public.get_operation_schedules_for_day(
  p_local_date date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  day_start timestamptz;
  day_end timestamptz;
  result jsonb;
begin
  if not public.is_active_operation_member() then
    raise exception 'Operations 일정 조회 권한이 없습니다.'
      using errcode = '42501';
  end if;

  if p_local_date is null then
    raise exception '조회 날짜가 필요합니다.'
      using errcode = '22023';
  end if;

  day_start := p_local_date::timestamp at time zone 'Asia/Seoul';
  day_end := (p_local_date + 1)::timestamp at time zone 'Asia/Seoul';

  select coalesce(
    jsonb_agg(
      public.operation_schedule_json(schedule.id)
      order by
        schedule.all_day desc,
        schedule.starts_at,
        schedule.created_at,
        schedule.id
    ),
    '[]'::jsonb
  )
  into result
  from public.operation_schedules schedule
  where schedule.archived_at is null
    and schedule.status <> 'cancelled'
    and schedule.starts_at < day_end
    and schedule.ends_at > day_start;

  return result;
end;
$$;

create or replace function public.create_operation_schedule(
  p_calendar_id uuid,
  p_schedule_type_id uuid,
  p_title text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_all_day boolean,
  p_memo text,
  p_assignee_ids uuid[],
  p_customer_ids uuid[],
  p_dog_ids uuid[],
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  schedule_id uuid;
begin
  if actor_id is null or not public.is_active_operation_member() then
    raise exception 'Operations 일정 등록 권한이 없습니다.'
      using errcode = '42501';
  end if;

  if p_request_id is null then
    raise exception '요청 ID가 필요합니다.'
      using errcode = '22023';
  end if;

  if coalesce(p_all_day, false)
    and (
      (p_starts_at at time zone 'Asia/Seoul')::time <> time '00:00'
      or (p_ends_at at time zone 'Asia/Seoul')::time <> time '00:00'
      or (p_ends_at at time zone 'Asia/Seoul')::date
        <> (p_starts_at at time zone 'Asia/Seoul')::date + 1
    )
  then
    raise exception '종일 일정은 한국 시간 기준 시작일 00:00부터 다음 날 00:00까지 저장해야 합니다.'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));

  select schedule.id
  into schedule_id
  from public.operation_schedules schedule
  where schedule.request_id = p_request_id;

  if schedule_id is not null then
    return public.operation_schedule_json(schedule_id);
  end if;

  perform public.assert_operation_schedule_input(
    p_calendar_id,
    p_schedule_type_id,
    p_title,
    p_starts_at,
    p_ends_at,
    p_assignee_ids,
    p_customer_ids,
    p_dog_ids
  );

  perform set_config('app.operation_change_reason', '단일 일정 등록', true);
  perform set_config('app.operation_request_id', p_request_id::text, true);

  insert into public.operation_schedules (
    calendar_id,
    schedule_type_id,
    title,
    description,
    starts_at,
    ends_at,
    all_day,
    status,
    request_id,
    created_by,
    updated_by
  )
  values (
    p_calendar_id,
    p_schedule_type_id,
    btrim(p_title),
    nullif(btrim(p_memo), ''),
    p_starts_at,
    p_ends_at,
    coalesce(p_all_day, false),
    'scheduled',
    p_request_id,
    actor_id,
    actor_id
  )
  returning id into schedule_id;

  perform public.sync_operation_schedule_links(
    schedule_id,
    p_assignee_ids,
    p_customer_ids,
    p_dog_ids,
    actor_id
  );

  return public.operation_schedule_json(schedule_id);
end;
$$;

create or replace function public.update_operation_schedule(
  p_schedule_id uuid,
  p_expected_version integer,
  p_calendar_id uuid,
  p_schedule_type_id uuid,
  p_title text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_all_day boolean,
  p_memo text,
  p_assignee_ids uuid[],
  p_customer_ids uuid[],
  p_dog_ids uuid[],
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  schedule_row public.operation_schedules%rowtype;
  request_entity_id uuid;
begin
  if actor_id is null or not public.is_active_operation_member() then
    raise exception 'Operations 일정 수정 권한이 없습니다.'
      using errcode = '42501';
  end if;

  if p_request_id is null or p_expected_version is null then
    raise exception '요청 ID와 기존 버전이 필요합니다.'
      using errcode = '22023';
  end if;

  if coalesce(p_all_day, false)
    and (
      (p_starts_at at time zone 'Asia/Seoul')::time <> time '00:00'
      or (p_ends_at at time zone 'Asia/Seoul')::time <> time '00:00'
      or (p_ends_at at time zone 'Asia/Seoul')::date
        <> (p_starts_at at time zone 'Asia/Seoul')::date + 1
    )
  then
    raise exception '종일 일정은 한국 시간 기준 시작일 00:00부터 다음 날 00:00까지 저장해야 합니다.'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));

  select audit.entity_id
  into request_entity_id
  from public.entity_audit_events audit
  where audit.module_code = 'operations'
    and audit.entity_type = 'operation_schedules'
    and audit.request_id = p_request_id
  order by audit.created_at
  limit 1;

  if request_entity_id is not null then
    if request_entity_id <> p_schedule_id then
      raise exception '이미 다른 일정에 사용된 요청 ID입니다.'
        using errcode = '23505';
    end if;
    return public.operation_schedule_json(p_schedule_id);
  end if;

  select *
  into schedule_row
  from public.operation_schedules
  where id = p_schedule_id
  for update;

  if not found or schedule_row.archived_at is not null then
    raise exception '수정할 일정을 확인할 수 없습니다.'
      using errcode = 'P0002';
  end if;

  if schedule_row.version <> p_expected_version then
    raise exception '다른 사용자가 먼저 일정을 수정했습니다. 새로고침 후 다시 시도해 주세요.'
      using errcode = '40001';
  end if;

  perform public.assert_operation_schedule_input(
    p_calendar_id,
    p_schedule_type_id,
    p_title,
    p_starts_at,
    p_ends_at,
    p_assignee_ids,
    p_customer_ids,
    p_dog_ids
  );

  perform set_config('app.operation_change_reason', '단일 일정 수정', true);
  perform set_config('app.operation_request_id', p_request_id::text, true);

  update public.operation_schedules
  set calendar_id = p_calendar_id,
      schedule_type_id = p_schedule_type_id,
      title = btrim(p_title),
      description = nullif(btrim(p_memo), ''),
      starts_at = p_starts_at,
      ends_at = p_ends_at,
      all_day = coalesce(p_all_day, false),
      updated_by = actor_id
  where id = p_schedule_id;

  perform public.sync_operation_schedule_links(
    p_schedule_id,
    p_assignee_ids,
    p_customer_ids,
    p_dog_ids,
    actor_id
  );

  return public.operation_schedule_json(p_schedule_id);
end;
$$;

create or replace function public.set_operation_schedule_status(
  p_schedule_id uuid,
  p_expected_version integer,
  p_status text,
  p_reason text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  schedule_row public.operation_schedules%rowtype;
  request_entity_id uuid;
begin
  if actor_id is null or not public.is_active_operation_member() then
    raise exception 'Operations 일정 상태 변경 권한이 없습니다.'
      using errcode = '42501';
  end if;

  if p_request_id is null or p_expected_version is null then
    raise exception '요청 ID와 기존 버전이 필요합니다.'
      using errcode = '22023';
  end if;

  if p_status not in ('scheduled', 'completed', 'cancelled') then
    raise exception '허용되지 않은 일정 상태입니다.'
      using errcode = '22023';
  end if;

  if p_status = 'cancelled' and nullif(btrim(p_reason), '') is null then
    raise exception '취소 사유를 입력해 주세요.'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));

  select audit.entity_id
  into request_entity_id
  from public.entity_audit_events audit
  where audit.module_code = 'operations'
    and audit.entity_type = 'operation_schedules'
    and audit.request_id = p_request_id
  order by audit.created_at
  limit 1;

  if request_entity_id is not null then
    if request_entity_id <> p_schedule_id then
      raise exception '이미 다른 일정에 사용된 요청 ID입니다.'
        using errcode = '23505';
    end if;
    return public.operation_schedule_json(p_schedule_id);
  end if;

  select *
  into schedule_row
  from public.operation_schedules
  where id = p_schedule_id
  for update;

  if not found or schedule_row.archived_at is not null then
    raise exception '변경할 일정을 확인할 수 없습니다.'
      using errcode = 'P0002';
  end if;

  if schedule_row.version <> p_expected_version then
    raise exception '다른 사용자가 먼저 일정을 수정했습니다. 새로고침 후 다시 시도해 주세요.'
      using errcode = '40001';
  end if;

  if schedule_row.status = p_status then
    return public.operation_schedule_json(p_schedule_id);
  end if;

  if schedule_row.status = 'scheduled'
    and p_status not in ('completed', 'cancelled') then
    raise exception '예정 일정은 완료 또는 취소로만 변경할 수 있습니다.'
      using errcode = '22023';
  elsif schedule_row.status = 'completed'
    and p_status <> 'cancelled' then
    raise exception '완료 일정은 취소로만 변경할 수 있습니다.'
      using errcode = '22023';
  elsif schedule_row.status = 'cancelled' then
    raise exception '취소된 일정의 상태는 다시 변경할 수 없습니다.'
      using errcode = '22023';
  end if;

  perform set_config(
    'app.operation_change_reason',
    coalesce(nullif(btrim(p_reason), ''), '일정 상태 변경'),
    true
  );
  perform set_config('app.operation_request_id', p_request_id::text, true);

  update public.operation_schedules
  set status = p_status,
      updated_by = actor_id
  where id = p_schedule_id;

  return public.operation_schedule_json(p_schedule_id);
end;
$$;

create or replace function public.archive_operation_schedule(
  p_schedule_id uuid,
  p_expected_version integer,
  p_reason text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  schedule_row public.operation_schedules%rowtype;
  request_entity_id uuid;
begin
  if actor_id is null or not public.is_active_operation_member() then
    raise exception 'Operations 일정 보관 권한이 없습니다.'
      using errcode = '42501';
  end if;

  if p_request_id is null
    or p_expected_version is null
    or nullif(btrim(p_reason), '') is null then
    raise exception '요청 ID, 기존 버전, 보관 사유가 필요합니다.'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));

  select audit.entity_id
  into request_entity_id
  from public.entity_audit_events audit
  where audit.module_code = 'operations'
    and audit.entity_type = 'operation_schedules'
    and audit.request_id = p_request_id
  order by audit.created_at
  limit 1;

  if request_entity_id is not null then
    if request_entity_id <> p_schedule_id then
      raise exception '이미 다른 일정에 사용된 요청 ID입니다.'
        using errcode = '23505';
    end if;
    return public.operation_schedule_json(p_schedule_id);
  end if;

  select *
  into schedule_row
  from public.operation_schedules
  where id = p_schedule_id
  for update;

  if not found then
    raise exception '보관할 일정을 확인할 수 없습니다.'
      using errcode = 'P0002';
  end if;

  if schedule_row.archived_at is not null then
    return public.operation_schedule_json(p_schedule_id);
  end if;

  if schedule_row.version <> p_expected_version then
    raise exception '다른 사용자가 먼저 일정을 수정했습니다. 새로고침 후 다시 시도해 주세요.'
      using errcode = '40001';
  end if;

  perform set_config('app.operation_change_reason', btrim(p_reason), true);
  perform set_config('app.operation_request_id', p_request_id::text, true);

  update public.operation_schedules
  set archived_at = now(),
      archived_by = actor_id,
      archive_reason = btrim(p_reason),
      updated_by = actor_id
  where id = p_schedule_id;

  return public.operation_schedule_json(p_schedule_id);
end;
$$;

revoke all on function public.operation_schedule_json(uuid)
  from public, anon;
revoke all on function public.assert_operation_schedule_input(
  uuid, uuid, text, timestamptz, timestamptz, uuid[], uuid[], uuid[]
) from public, anon;
revoke all on function public.sync_operation_schedule_links(
  uuid, uuid[], uuid[], uuid[], uuid
) from public, anon;
revoke all on function public.get_operation_schedules_for_day(date)
  from public, anon;
revoke all on function public.create_operation_schedule(
  uuid, uuid, text, timestamptz, timestamptz, boolean, text,
  uuid[], uuid[], uuid[], uuid
) from public, anon;
revoke all on function public.update_operation_schedule(
  uuid, integer, uuid, uuid, text, timestamptz, timestamptz, boolean, text,
  uuid[], uuid[], uuid[], uuid
) from public, anon;
revoke all on function public.set_operation_schedule_status(
  uuid, integer, text, text, uuid
) from public, anon;
revoke all on function public.archive_operation_schedule(
  uuid, integer, text, uuid
) from public, anon;

grant execute on function public.get_operation_schedules_for_day(date)
  to authenticated;
grant execute on function public.create_operation_schedule(
  uuid, uuid, text, timestamptz, timestamptz, boolean, text,
  uuid[], uuid[], uuid[], uuid
) to authenticated;
grant execute on function public.update_operation_schedule(
  uuid, integer, uuid, uuid, text, timestamptz, timestamptz, boolean, text,
  uuid[], uuid[], uuid[], uuid
) to authenticated;
grant execute on function public.set_operation_schedule_status(
  uuid, integer, text, text, uuid
) to authenticated;
grant execute on function public.archive_operation_schedule(
  uuid, integer, text, uuid
) to authenticated;

commit;
