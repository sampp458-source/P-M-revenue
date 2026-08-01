-- B. 완전 롤백
-- 반드시 기능 롤백(A)을 먼저 실행한다.
-- 시간 미정 일정이 한 건이라도 있으면 컬럼 제거를 중단한다.

begin;

do $$
declare
  unspecified_count bigint;
begin
  if to_regclass('public.operation_schedules') is null then
    raise exception 'public.operation_schedules 테이블이 없습니다.';
  end if;

  if to_regprocedure(
    'public.create_operation_schedule(uuid,uuid,text,timestamp with time zone,timestamp with time zone,boolean,boolean,text,uuid[],uuid[],uuid[],uuid)'
  ) is not null
    or to_regprocedure(
      'public.update_operation_schedule(uuid,integer,uuid,uuid,text,timestamp with time zone,timestamp with time zone,boolean,boolean,text,uuid[],uuid[],uuid[],uuid)'
    ) is not null
    or coalesce(pg_get_functiondef(
      to_regprocedure('public.operation_schedule_json(uuid)')
    ), '') ilike '%timeUnspecified%'
    or coalesce(pg_get_functiondef(
      to_regprocedure('public.get_operation_schedules_for_day(date)')
    ), '') ilike '%time_unspecified%'
  then
    raise exception '기능 롤백(A)을 먼저 실행해 주세요.';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'operation_schedules'
      and column_name = 'time_unspecified'
  ) then
    return;
  end if;

  execute 'select count(*) from public.operation_schedules where time_unspecified = true'
    into unspecified_count;
  if unspecified_count > 0 then
    raise exception '시간 미정 일정이 %건 존재하여 완전 롤백을 중단합니다.',
      unspecified_count;
  end if;
end;
$$;

alter table public.operation_schedules
  drop constraint if exists operation_schedules_time_state_check;
alter table public.operation_schedules
  drop column if exists time_unspecified;

commit;
