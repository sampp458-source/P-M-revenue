-- Operations 일정의 '시간 미정' 상태를 명시적으로 저장한다.
-- 운영 Supabase에는 자동 적용하지 않는다.

begin;

do $$
begin
  if to_regclass('public.operation_schedules') is null
    or to_regprocedure('public.operation_schedule_json(uuid)') is null
    or to_regprocedure('public.get_operation_schedules_for_day(date)') is null
    or to_regprocedure('public.is_active_operation_member()') is null
    or to_regprocedure(
      'public.assert_operation_schedule_input(uuid,uuid,text,timestamp with time zone,timestamp with time zone,uuid[],uuid[],uuid[])'
    ) is null
    or to_regprocedure(
      'public.sync_operation_schedule_links(uuid,uuid[],uuid[],uuid[],uuid)'
    ) is null
    or to_regprocedure(
      'public.create_operation_schedule(uuid,uuid,text,timestamp with time zone,timestamp with time zone,boolean,text,uuid[],uuid[],uuid[],uuid)'
    ) is null
    or to_regprocedure(
      'public.update_operation_schedule(uuid,integer,uuid,uuid,text,timestamp with time zone,timestamp with time zone,boolean,text,uuid[],uuid[],uuid[],uuid)'
    ) is null
  then
    raise exception 'Operations Single Schedule 기반을 먼저 적용해 주세요.';
  end if;
end;
$$;

create temporary table operation_schedule_time_migration_baseline (
  existing_schedule_count bigint not null,
  existing_time_values_fingerprint text not null
) on commit drop;

insert into operation_schedule_time_migration_baseline (
  existing_schedule_count,
  existing_time_values_fingerprint
)
select
  count(*),
  md5(coalesce(string_agg(
    id::text || ':' ||
    to_char(starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || ':' ||
    to_char(ends_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
    '|' order by id
  ), ''))
from public.operation_schedules;

alter table public.operation_schedules
  add column if not exists time_unspecified boolean not null default false;

comment on column public.operation_schedules.time_unspecified is
  '날짜는 확정되었지만 시작·종료 시간이 아직 정해지지 않은 일정. starts_at/ends_at은 날짜 범위 조회용 기술적 범위를 유지한다.';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.operation_schedules'::regclass
      and conname = 'operation_schedules_time_state_check'
  ) then
    alter table public.operation_schedules
      add constraint operation_schedules_time_state_check
      check (not (all_day and time_unspecified));
  end if;
end;
$$;

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
    'timeUnspecified', schedule.time_unspecified,
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
        jsonb_build_object('id', profile.id, 'name', profile.name)
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
    raise exception '조회 날짜가 필요합니다.' using errcode = '22023';
  end if;

  day_start := p_local_date::timestamp at time zone 'Asia/Seoul';
  day_end := (p_local_date + 1)::timestamp at time zone 'Asia/Seoul';

  select coalesce(
    jsonb_agg(
      public.operation_schedule_json(schedule.id)
      order by
        schedule.all_day desc,
        schedule.time_unspecified asc,
        case
          when schedule.time_unspecified then null
          else schedule.starts_at
        end nulls last,
        schedule.created_at,
        schedule.id
    ),
    '[]'::jsonb
  )
  into result
  from public.operation_schedules schedule
  where schedule.archived_at is null
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
  p_time_unspecified boolean,
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
  normalized_starts_at timestamptz;
  normalized_ends_at timestamptz;
begin
  if actor_id is null or not public.is_active_operation_member() then
    raise exception 'Operations 일정 등록 권한이 없습니다.'
      using errcode = '42501';
  end if;
  if p_request_id is null then
    raise exception '요청 ID가 필요합니다.' using errcode = '22023';
  end if;
  if coalesce(p_all_day, false) and coalesce(p_time_unspecified, false) then
    raise exception '종일 일정과 시간 미정은 동시에 선택할 수 없습니다.'
      using errcode = '22023';
  end if;
  if coalesce(p_time_unspecified, false) then
    normalized_starts_at :=
      ((p_starts_at at time zone 'Asia/Seoul')::date)::timestamp
        at time zone 'Asia/Seoul';
    normalized_ends_at :=
      (((p_starts_at at time zone 'Asia/Seoul')::date + 1)::timestamp)
        at time zone 'Asia/Seoul';
  else
    normalized_starts_at := p_starts_at;
    normalized_ends_at := p_ends_at;
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
  select schedule.id into schedule_id
  from public.operation_schedules schedule
  where schedule.request_id = p_request_id;
  if schedule_id is not null then
    return public.operation_schedule_json(schedule_id);
  end if;

  perform public.assert_operation_schedule_input(
    p_calendar_id, p_schedule_type_id, p_title,
    normalized_starts_at, normalized_ends_at,
    p_assignee_ids, p_customer_ids, p_dog_ids
  );
  perform set_config('app.operation_change_reason', '단일 일정 등록', true);
  perform set_config('app.operation_request_id', p_request_id::text, true);

  insert into public.operation_schedules (
    calendar_id, schedule_type_id, title, description, starts_at, ends_at,
    all_day, time_unspecified, status, request_id, created_by, updated_by
  ) values (
    p_calendar_id, p_schedule_type_id, btrim(p_title),
    nullif(btrim(p_memo), ''), normalized_starts_at, normalized_ends_at,
    coalesce(p_all_day, false), coalesce(p_time_unspecified, false),
    'scheduled', p_request_id, actor_id, actor_id
  ) returning id into schedule_id;

  perform public.sync_operation_schedule_links(
    schedule_id, p_assignee_ids, p_customer_ids, p_dog_ids, actor_id
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
  p_time_unspecified boolean,
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
  normalized_starts_at timestamptz;
  normalized_ends_at timestamptz;
begin
  if actor_id is null or not public.is_active_operation_member() then
    raise exception 'Operations 일정 수정 권한이 없습니다.'
      using errcode = '42501';
  end if;
  if p_request_id is null or p_expected_version is null then
    raise exception '요청 ID와 기존 버전이 필요합니다.'
      using errcode = '22023';
  end if;
  if coalesce(p_all_day, false) and coalesce(p_time_unspecified, false) then
    raise exception '종일 일정과 시간 미정은 동시에 선택할 수 없습니다.'
      using errcode = '22023';
  end if;
  if coalesce(p_time_unspecified, false) then
    normalized_starts_at :=
      ((p_starts_at at time zone 'Asia/Seoul')::date)::timestamp
        at time zone 'Asia/Seoul';
    normalized_ends_at :=
      (((p_starts_at at time zone 'Asia/Seoul')::date + 1)::timestamp)
        at time zone 'Asia/Seoul';
  else
    normalized_starts_at := p_starts_at;
    normalized_ends_at := p_ends_at;
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
  select audit.entity_id into request_entity_id
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

  select * into schedule_row
  from public.operation_schedules schedule
  where schedule.id = p_schedule_id
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
    p_calendar_id, p_schedule_type_id, p_title,
    normalized_starts_at, normalized_ends_at,
    p_assignee_ids, p_customer_ids, p_dog_ids
  );
  perform set_config('app.operation_change_reason', '단일 일정 수정', true);
  perform set_config('app.operation_request_id', p_request_id::text, true);

  update public.operation_schedules schedule
  set calendar_id = p_calendar_id,
      schedule_type_id = p_schedule_type_id,
      title = btrim(p_title),
      description = nullif(btrim(p_memo), ''),
      starts_at = normalized_starts_at,
      ends_at = normalized_ends_at,
      all_day = coalesce(p_all_day, false),
      time_unspecified = coalesce(p_time_unspecified, false),
      updated_by = actor_id
  where schedule.id = p_schedule_id;

  perform public.sync_operation_schedule_links(
    p_schedule_id, p_assignee_ids, p_customer_ids, p_dog_ids, actor_id
  );
  return public.operation_schedule_json(p_schedule_id);
end;
$$;

revoke all on function public.create_operation_schedule(
  uuid, uuid, text, timestamptz, timestamptz, boolean, boolean, text,
  uuid[], uuid[], uuid[], uuid
) from public, anon;
grant execute on function public.create_operation_schedule(
  uuid, uuid, text, timestamptz, timestamptz, boolean, boolean, text,
  uuid[], uuid[], uuid[], uuid
) to authenticated;

revoke all on function public.update_operation_schedule(
  uuid, integer, uuid, uuid, text, timestamptz, timestamptz, boolean,
  boolean, text, uuid[], uuid[], uuid[], uuid
) from public, anon;
grant execute on function public.update_operation_schedule(
  uuid, integer, uuid, uuid, text, timestamptz, timestamptz, boolean,
  boolean, text, uuid[], uuid[], uuid[], uuid
) to authenticated;

do $$
declare
  baseline_count bigint;
  baseline_fingerprint text;
  actual_count bigint;
  actual_fingerprint text;
  migration_receipt text;
begin
  select
    existing_schedule_count,
    existing_time_values_fingerprint
  into baseline_count, baseline_fingerprint
  from operation_schedule_time_migration_baseline;

  select
    count(*),
    md5(coalesce(string_agg(
      id::text || ':' ||
      to_char(starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || ':' ||
      to_char(ends_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
      '|' order by id
    ), ''))
  into actual_count, actual_fingerprint
  from public.operation_schedules;

  if actual_count is distinct from baseline_count then
    raise exception 'Migration이 기존 일정 수를 변경했습니다. 적용을 중단합니다.';
  end if;
  if actual_fingerprint is distinct from baseline_fingerprint then
    raise exception 'Migration이 기존 starts_at/ends_at 값을 변경했습니다. 적용을 중단합니다.';
  end if;

  migration_receipt := jsonb_build_object(
    'migration', '202608010001_operation_schedule_time_unspecified',
    'existing_schedule_count', baseline_count,
    'existing_time_values_fingerprint', baseline_fingerprint
  )::text;
  execute format(
    'comment on constraint operation_schedules_time_state_check on public.operation_schedules is %L',
    migration_receipt
  );
end;
$$;

commit;
