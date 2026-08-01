-- Operations 시간 미정 Migration 적용 후 검증

select
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'operation_schedules'
  and column_name = 'time_unspecified';

select
  constraint_info.constraint_schema,
  constraint_info.table_schema,
  constraint_info.table_name,
  constraint_info.constraint_name,
  check_info.check_clause
from information_schema.table_constraints constraint_info
join information_schema.check_constraints check_info
  on check_info.constraint_catalog = constraint_info.constraint_catalog
 and check_info.constraint_schema = constraint_info.constraint_schema
 and check_info.constraint_name = constraint_info.constraint_name
where constraint_info.table_schema = 'public'
  and constraint_info.table_name = 'operation_schedules'
  and constraint_info.constraint_name = 'operation_schedules_time_state_check';

select
  to_regprocedure(
    'public.create_operation_schedule(uuid,uuid,text,timestamp with time zone,timestamp with time zone,boolean,boolean,text,uuid[],uuid[],uuid[],uuid)'
  ) is not null as create_time_state_rpc_exists,
  to_regprocedure(
    'public.update_operation_schedule(uuid,integer,uuid,uuid,text,timestamp with time zone,timestamp with time zone,boolean,boolean,text,uuid[],uuid[],uuid[],uuid)'
  ) is not null as update_time_state_rpc_exists,
  coalesce(has_function_privilege(
    'authenticated',
    to_regprocedure(
      'public.create_operation_schedule(uuid,uuid,text,timestamp with time zone,timestamp with time zone,boolean,boolean,text,uuid[],uuid[],uuid[],uuid)'
    ),
    'EXECUTE'
  ), false) as authenticated_can_create,
  coalesce(has_function_privilege(
    'authenticated',
    to_regprocedure(
      'public.update_operation_schedule(uuid,integer,uuid,uuid,text,timestamp with time zone,timestamp with time zone,boolean,boolean,text,uuid[],uuid[],uuid[],uuid)'
    ),
    'EXECUTE'
  ), false) as authenticated_can_update,
  coalesce(pg_get_functiondef(
    to_regprocedure(
      'public.create_operation_schedule(uuid,uuid,text,timestamp with time zone,timestamp with time zone,boolean,boolean,text,uuid[],uuid[],uuid[],uuid)'
    )
  ), '') ilike '%normalized_starts_at%'
    as create_rpc_normalizes_time_range,
  coalesce(pg_get_functiondef(
    to_regprocedure(
      'public.update_operation_schedule(uuid,integer,uuid,uuid,text,timestamp with time zone,timestamp with time zone,boolean,boolean,text,uuid[],uuid[],uuid[],uuid)'
    )
  ), '') ilike '%normalized_starts_at%'
    as update_rpc_normalizes_time_range,
  coalesce(pg_get_functiondef(
    to_regprocedure('public.operation_schedule_json(uuid)')
  ), '') ilike '%timeUnspecified%' as json_returns_time_unspecified,
  coalesce(pg_get_functiondef(
    to_regprocedure('public.get_operation_schedules_for_day(date)')
  ), '') ilike '%schedule.time_unspecified asc%'
    as day_rpc_sorts_unspecified_last,
  coalesce(pg_get_functiondef(
    to_regprocedure('public.get_operation_schedules_for_day(date)')
  ), '') ilike '%when schedule.time_unspecified then null%'
    as unspecified_uses_registration_order;

with receipt as (
  select obj_description(constraint_row.oid, 'pg_constraint') as value
  from pg_constraint constraint_row
  where constraint_row.connamespace = 'public'::regnamespace
    and constraint_row.conrelid = 'public.operation_schedules'::regclass
    and constraint_row.conname = 'operation_schedules_time_state_check'
), baseline as (
  select
    substring(value from '"existing_schedule_count"\s*:\s*([0-9]+)')::bigint
      as expected_schedule_count,
    substring(value from '"existing_time_values_fingerprint"\s*:\s*"([0-9a-f]+)"')
      as expected_time_values_fingerprint
  from receipt
), actual as (
  select
    count(*) as actual_schedule_count,
    count(*) filter (where time_unspecified) as time_unspecified_count,
    count(*) filter (
      where time_unspecified
        and (
          all_day
          or starts_at is distinct from
            (((starts_at at time zone 'Asia/Seoul')::date)::timestamp
              at time zone 'Asia/Seoul')
          or ends_at is distinct from
            ((((starts_at at time zone 'Asia/Seoul')::date + 1)::timestamp)
              at time zone 'Asia/Seoul')
        )
    ) as invalid_time_state_count,
    md5(coalesce(string_agg(
      id::text || ':' ||
      to_char(starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || ':' ||
      to_char(ends_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
      '|' order by id
    ), '')) as actual_time_values_fingerprint
  from public.operation_schedules
)
select
  baseline.expected_schedule_count,
  actual.actual_schedule_count,
  baseline.expected_time_values_fingerprint,
  actual.actual_time_values_fingerprint,
  actual.time_unspecified_count,
  actual.invalid_time_state_count,
  baseline.expected_schedule_count = actual.actual_schedule_count
    as existing_schedule_count_preserved,
  baseline.expected_time_values_fingerprint = actual.actual_time_values_fingerprint
    as existing_time_values_preserved
from actual
left join baseline on true;

with column_state as (
  select
    is_nullable,
    column_default
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'operation_schedules'
    and column_name = 'time_unspecified'
), constraint_state as (
  select
    constraint_row.oid,
    obj_description(constraint_row.oid, 'pg_constraint') as receipt,
    pg_get_constraintdef(constraint_row.oid) as definition
  from pg_constraint constraint_row
  where constraint_row.connamespace = 'public'::regnamespace
    and constraint_row.conrelid = 'public.operation_schedules'::regclass
    and constraint_row.conname = 'operation_schedules_time_state_check'
), baseline as (
  select
    substring(receipt from '"existing_schedule_count"\s*:\s*([0-9]+)')::bigint
      as expected_schedule_count,
    substring(receipt from '"existing_time_values_fingerprint"\s*:\s*"([0-9a-f]+)"')
      as expected_time_values_fingerprint
  from constraint_state
), actual as (
  select
    count(*) as actual_schedule_count,
    count(*) filter (
      where time_unspecified
        and (
          all_day
          or starts_at is distinct from
            (((starts_at at time zone 'Asia/Seoul')::date)::timestamp
              at time zone 'Asia/Seoul')
          or ends_at is distinct from
            ((((starts_at at time zone 'Asia/Seoul')::date + 1)::timestamp)
              at time zone 'Asia/Seoul')
        )
    ) as invalid_time_state_count,
    md5(coalesce(string_agg(
      id::text || ':' ||
      to_char(starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || ':' ||
      to_char(ends_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
      '|' order by id
    ), '')) as actual_time_values_fingerprint
  from public.operation_schedules
), checks as (
  select
    exists (select 1 from column_state) as column_exists,
    coalesce((select is_nullable = 'NO' from column_state), false)
      as column_not_null,
    coalesce((select column_default ilike '%false%' from column_state), false)
      as column_default_false,
    exists (select 1 from constraint_state) as constraint_exists,
    coalesce((
      select definition ilike '%not%'
        and definition ilike '%all_day%'
        and definition ilike '%time_unspecified%'
      from constraint_state
    ), false) as constraint_definition_ready,
    to_regprocedure(
      'public.create_operation_schedule(uuid,uuid,text,timestamp with time zone,timestamp with time zone,boolean,boolean,text,uuid[],uuid[],uuid[],uuid)'
    ) is not null as create_rpc_exists,
    to_regprocedure(
      'public.update_operation_schedule(uuid,integer,uuid,uuid,text,timestamp with time zone,timestamp with time zone,boolean,boolean,text,uuid[],uuid[],uuid[],uuid)'
    ) is not null as update_rpc_exists,
    to_regprocedure(
      'public.create_operation_schedule(uuid,uuid,text,timestamp with time zone,timestamp with time zone,boolean,text,uuid[],uuid[],uuid[],uuid)'
    ) is not null as legacy_create_rpc_exists,
    to_regprocedure(
      'public.update_operation_schedule(uuid,integer,uuid,uuid,text,timestamp with time zone,timestamp with time zone,boolean,text,uuid[],uuid[],uuid[],uuid)'
    ) is not null as legacy_update_rpc_exists,
    coalesce(has_function_privilege(
      'authenticated',
      to_regprocedure(
        'public.create_operation_schedule(uuid,uuid,text,timestamp with time zone,timestamp with time zone,boolean,boolean,text,uuid[],uuid[],uuid[],uuid)'
      ),
      'EXECUTE'
    ), false) as create_rpc_executable,
    coalesce(has_function_privilege(
      'authenticated',
      to_regprocedure(
        'public.update_operation_schedule(uuid,integer,uuid,uuid,text,timestamp with time zone,timestamp with time zone,boolean,boolean,text,uuid[],uuid[],uuid[],uuid)'
      ),
      'EXECUTE'
    ), false) as update_rpc_executable,
    coalesce(has_function_privilege(
      'authenticated',
      to_regprocedure(
        'public.create_operation_schedule(uuid,uuid,text,timestamp with time zone,timestamp with time zone,boolean,text,uuid[],uuid[],uuid[],uuid)'
      ),
      'EXECUTE'
    ), false) as legacy_create_rpc_executable,
    coalesce(has_function_privilege(
      'authenticated',
      to_regprocedure(
        'public.update_operation_schedule(uuid,integer,uuid,uuid,text,timestamp with time zone,timestamp with time zone,boolean,text,uuid[],uuid[],uuid[],uuid)'
      ),
      'EXECUTE'
    ), false) as legacy_update_rpc_executable,
    coalesce(pg_get_functiondef(
      to_regprocedure(
        'public.create_operation_schedule(uuid,uuid,text,timestamp with time zone,timestamp with time zone,boolean,boolean,text,uuid[],uuid[],uuid[],uuid)'
      )
    ), '') ilike '%normalized_starts_at%'
      and coalesce(pg_get_functiondef(
        to_regprocedure(
          'public.create_operation_schedule(uuid,uuid,text,timestamp with time zone,timestamp with time zone,boolean,boolean,text,uuid[],uuid[],uuid[],uuid)'
        )
      ), '') ilike '%at time zone ''Asia/Seoul''%'
      as create_normalization_ready,
    coalesce(pg_get_functiondef(
      to_regprocedure(
        'public.update_operation_schedule(uuid,integer,uuid,uuid,text,timestamp with time zone,timestamp with time zone,boolean,boolean,text,uuid[],uuid[],uuid[],uuid)'
      )
    ), '') ilike '%normalized_starts_at%'
      and coalesce(pg_get_functiondef(
        to_regprocedure(
          'public.update_operation_schedule(uuid,integer,uuid,uuid,text,timestamp with time zone,timestamp with time zone,boolean,boolean,text,uuid[],uuid[],uuid[],uuid)'
        )
      ), '') ilike '%at time zone ''Asia/Seoul''%'
      as update_normalization_ready,
    coalesce(pg_get_functiondef(
      to_regprocedure('public.operation_schedule_json(uuid)')
    ), '') ilike '%timeUnspecified%' as json_ready,
    coalesce(pg_get_functiondef(
      to_regprocedure('public.get_operation_schedules_for_day(date)')
    ), '') ilike '%schedule.time_unspecified asc%'
      as day_sort_ready,
    (select invalid_time_state_count = 0 from actual)
      as no_invalid_time_state,
    coalesce((select expected_schedule_count is not null from baseline), false)
      as baseline_count_exists,
    coalesce((select expected_time_values_fingerprint is not null from baseline), false)
      as baseline_fingerprint_exists,
    coalesce(
      (select expected_schedule_count from baseline) =
        (select actual_schedule_count from actual),
      false
    )
      as schedule_count_preserved,
    coalesce(
      (select expected_time_values_fingerprint from baseline) =
        (select actual_time_values_fingerprint from actual),
      false
    )
      as time_values_preserved
)
select case
  when not column_exists then 'FAILED_MISSING_COLUMN'
  when not column_not_null then 'FAILED_COLUMN_NOT_NULL'
  when not column_default_false then 'FAILED_COLUMN_DEFAULT'
  when not constraint_exists then 'FAILED_MISSING_TIME_STATE_CONSTRAINT'
  when not constraint_definition_ready then 'FAILED_TIME_STATE_CONSTRAINT_DEFINITION'
  when not create_rpc_exists then 'FAILED_MISSING_CREATE_RPC'
  when not update_rpc_exists then 'FAILED_MISSING_UPDATE_RPC'
  when not legacy_create_rpc_exists then 'FAILED_LEGACY_CREATE_RPC_CHANGED'
  when not legacy_update_rpc_exists then 'FAILED_LEGACY_UPDATE_RPC_CHANGED'
  when not create_rpc_executable then 'FAILED_CREATE_RPC_EXECUTE'
  when not update_rpc_executable then 'FAILED_UPDATE_RPC_EXECUTE'
  when not legacy_create_rpc_executable then 'FAILED_LEGACY_CREATE_RPC_EXECUTE'
  when not legacy_update_rpc_executable then 'FAILED_LEGACY_UPDATE_RPC_EXECUTE'
  when not create_normalization_ready then 'FAILED_CREATE_TIME_NORMALIZATION'
  when not update_normalization_ready then 'FAILED_UPDATE_TIME_NORMALIZATION'
  when not json_ready then 'FAILED_JSON_TIME_STATE'
  when not day_sort_ready then 'FAILED_DAY_RPC_SORT'
  when not no_invalid_time_state then 'FAILED_INVALID_TIME_STATE_DATA'
  when not baseline_count_exists then 'FAILED_MISSING_BASELINE_COUNT'
  when not baseline_fingerprint_exists then 'FAILED_MISSING_BASELINE_FINGERPRINT'
  when not schedule_count_preserved then 'FAILED_EXISTING_SCHEDULE_COUNT_CHANGED'
  when not time_values_preserved then 'FAILED_EXISTING_TIME_VALUES_CHANGED'
  else 'READY'
end as postflight_status
from checks;
