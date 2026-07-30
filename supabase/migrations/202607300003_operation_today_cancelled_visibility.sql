-- Today에서 취소 일정을 감사 가능한 낮은 강조 상태로 표시한다.
-- 운영 Supabase에는 자동 적용하지 않는다.

begin;

do $$
begin
  if to_regclass('public.operation_schedules') is null
    or to_regprocedure('public.operation_schedule_json(uuid)') is null
    or to_regprocedure('public.is_active_operation_member()') is null
    or to_regprocedure('public.get_operation_schedules_for_day(date)') is null
  then
    raise exception 'Single Schedule Foundation을 먼저 적용해 주세요.';
  end if;
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
    and schedule.starts_at < day_end
    and schedule.ends_at > day_start;

  return result;
end;
$$;

commit;
