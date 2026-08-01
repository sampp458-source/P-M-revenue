-- A. 기능 롤백
-- 신규 RPC와 표시/정렬 함수만 되돌린다.
-- time_unspecified 컬럼, constraint, 데이터는 보존한다.

begin;

do $$
begin
  if to_regclass('public.operation_schedules') is null
    or to_regprocedure(
      'public.create_operation_schedule(uuid,uuid,text,timestamp with time zone,timestamp with time zone,boolean,text,uuid[],uuid[],uuid[],uuid)'
    ) is null
    or to_regprocedure(
      'public.update_operation_schedule(uuid,integer,uuid,uuid,text,timestamp with time zone,timestamp with time zone,boolean,text,uuid[],uuid[],uuid[],uuid)'
    ) is null
  then
    raise exception '기존 Single Schedule 함수가 없어 기능 롤백을 중단합니다.';
  end if;
end;
$$;

drop function if exists public.create_operation_schedule(
  uuid, uuid, text, timestamptz, timestamptz, boolean, boolean, text,
  uuid[], uuid[], uuid[], uuid
);
drop function if exists public.update_operation_schedule(
  uuid, integer, uuid, uuid, text, timestamptz, timestamptz, boolean,
  boolean, text, uuid[], uuid[], uuid[], uuid
);

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
      order by schedule.all_day desc, schedule.starts_at,
        schedule.created_at, schedule.id
    ),
    '[]'::jsonb
  ) into result
  from public.operation_schedules schedule
  where schedule.archived_at is null
    and schedule.starts_at < day_end
    and schedule.ends_at > day_start;
  return result;
end;
$$;

commit;
