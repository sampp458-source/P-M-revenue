-- Read-only preflight: Operations 시간 미정 Migration 적용 가능 여부
-- 영구 객체나 데이터를 변경하지 않는다.

with requirements as (
  select * from (values
    ('operation_schedules', to_regclass('public.operation_schedules') is not null),
    ('operation_schedule_json', to_regprocedure('public.operation_schedule_json(uuid)') is not null),
    ('get_operation_schedules_for_day', to_regprocedure('public.get_operation_schedules_for_day(date)') is not null),
    ('create_operation_schedule', to_regprocedure('public.create_operation_schedule(uuid,uuid,text,timestamp with time zone,timestamp with time zone,boolean,text,uuid[],uuid[],uuid[],uuid)') is not null),
    ('update_operation_schedule', to_regprocedure('public.update_operation_schedule(uuid,integer,uuid,uuid,text,timestamp with time zone,timestamp with time zone,boolean,text,uuid[],uuid[],uuid[],uuid)') is not null),
    ('is_active_operation_member', to_regprocedure('public.is_active_operation_member()') is not null),
    ('assert_operation_schedule_input', to_regprocedure('public.assert_operation_schedule_input(uuid,uuid,text,timestamp with time zone,timestamp with time zone,uuid[],uuid[],uuid[])') is not null),
    ('sync_operation_schedule_links', to_regprocedure('public.sync_operation_schedule_links(uuid,uuid[],uuid[],uuid[],uuid)') is not null)
  ) required(object_name, ready)
)
select object_name, ready
from requirements
order by object_name;

with required_columns(column_name) as (
  values
    ('starts_at'),
    ('ends_at'),
    ('all_day'),
    ('version'),
    ('archived_at')
)
select
  required_columns.column_name,
  column_info.data_type,
  column_info.udt_name,
  column_info.is_nullable,
  column_info.column_default,
  column_info.column_name is not null as column_exists
from required_columns
left join information_schema.columns column_info
  on column_info.table_schema = 'public'
 and column_info.table_name = 'operation_schedules'
 and column_info.column_name = required_columns.column_name
order by required_columns.column_name;

with rpc_targets(object_name, signature, function_oid) as (
  values
    (
      'create_operation_schedule',
      'public.create_operation_schedule(uuid,uuid,text,timestamp with time zone,timestamp with time zone,boolean,text,uuid[],uuid[],uuid[],uuid)',
      to_regprocedure('public.create_operation_schedule(uuid,uuid,text,timestamp with time zone,timestamp with time zone,boolean,text,uuid[],uuid[],uuid[],uuid)')
    ),
    (
      'update_operation_schedule',
      'public.update_operation_schedule(uuid,integer,uuid,uuid,text,timestamp with time zone,timestamp with time zone,boolean,text,uuid[],uuid[],uuid[],uuid)',
      to_regprocedure('public.update_operation_schedule(uuid,integer,uuid,uuid,text,timestamp with time zone,timestamp with time zone,boolean,text,uuid[],uuid[],uuid[],uuid)')
    ),
    (
      'operation_schedule_json',
      'public.operation_schedule_json(uuid)',
      to_regprocedure('public.operation_schedule_json(uuid)')
    ),
    (
      'get_operation_schedules_for_day',
      'public.get_operation_schedules_for_day(date)',
      to_regprocedure('public.get_operation_schedules_for_day(date)')
    )
)
select
  object_name,
  signature,
  function_oid is not null as function_exists,
  case
    when function_oid is null then null
    else pg_get_functiondef(function_oid)
  end as function_definition,
  case
    when function_oid is null then null
    else has_function_privilege('authenticated', function_oid, 'EXECUTE')
  end as authenticated_can_execute
from rpc_targets
order by object_name;

select
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'operation_schedules'
      and column_name = 'time_unspecified'
  ) as time_unspecified_already_exists,
  to_regprocedure(
    'public.create_operation_schedule(uuid,uuid,text,timestamp with time zone,timestamp with time zone,boolean,boolean,text,uuid[],uuid[],uuid[],uuid)'
  ) is not null as create_time_state_rpc_already_exists,
  to_regprocedure(
    'public.update_operation_schedule(uuid,integer,uuid,uuid,text,timestamp with time zone,timestamp with time zone,boolean,boolean,text,uuid[],uuid[],uuid[],uuid)'
  ) is not null as update_time_state_rpc_already_exists;

do $$
declare
  existing_schedule_count bigint;
  active_schedule_count bigint;
  existing_time_values_fingerprint text;
begin
  if to_regclass('public.operation_schedules') is null then
    raise notice 'operation_schedules 없음: count/fingerprint 조회를 건너뜁니다.';
    return;
  end if;

  execute $query$
    select
      count(*),
      count(*) filter (where archived_at is null),
      md5(coalesce(string_agg(
        id::text || ':' ||
        to_char(starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || ':' ||
        to_char(ends_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
        '|' order by id
      ), ''))
    from public.operation_schedules
  $query$
  into existing_schedule_count, active_schedule_count,
    existing_time_values_fingerprint;

  raise notice 'existing_schedule_count=%, active_schedule_count=%, existing_time_values_fingerprint=%',
    existing_schedule_count,
    active_schedule_count,
    existing_time_values_fingerprint;
end;
$$;

select
  case
    when to_regclass('public.operation_schedules') is null
      then 'STOP_MISSING_FOUNDATION'
    when to_regprocedure('public.operation_schedule_json(uuid)') is null
      then 'STOP_MISSING_JSON_FUNCTION'
    when to_regprocedure('public.get_operation_schedules_for_day(date)') is null
      then 'STOP_MISSING_DAY_RPC'
    when to_regprocedure('public.create_operation_schedule(uuid,uuid,text,timestamp with time zone,timestamp with time zone,boolean,text,uuid[],uuid[],uuid[],uuid)') is null
      then 'STOP_MISSING_CREATE_RPC'
    when to_regprocedure('public.update_operation_schedule(uuid,integer,uuid,uuid,text,timestamp with time zone,timestamp with time zone,boolean,text,uuid[],uuid[],uuid[],uuid)') is null
      then 'STOP_MISSING_UPDATE_RPC'
    when to_regprocedure('public.is_active_operation_member()') is null
      then 'STOP_MISSING_MEMBERSHIP_FUNCTION'
    when to_regprocedure('public.assert_operation_schedule_input(uuid,uuid,text,timestamp with time zone,timestamp with time zone,uuid[],uuid[],uuid[])') is null
      then 'STOP_MISSING_INPUT_ASSERTION_FUNCTION'
    when to_regprocedure('public.sync_operation_schedule_links(uuid,uuid[],uuid[],uuid[],uuid)') is null
      then 'STOP_MISSING_LINK_SYNC_FUNCTION'
    when not exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'operation_schedules'
        and column_name = 'starts_at'
        and is_nullable = 'NO'
    ) then 'STOP_INVALID_STARTS_AT_COLUMN'
    when not exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'operation_schedules'
        and column_name = 'ends_at'
        and is_nullable = 'NO'
    ) then 'STOP_INVALID_ENDS_AT_COLUMN'
    when not exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'operation_schedules'
        and column_name = 'all_day'
    ) then 'STOP_MISSING_ALL_DAY_COLUMN'
    when not exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'operation_schedules'
        and column_name = 'version'
    ) then 'STOP_MISSING_VERSION_COLUMN'
    when not exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'operation_schedules'
        and column_name = 'archived_at'
    ) then 'STOP_MISSING_ARCHIVED_AT_COLUMN'
    else 'READY'
  end as preflight_status;
