-- Read-only postflight for legacy Hotel schedule conversion.
begin read only;

with target as (
  select procedure_row.*,
    lower(regexp_replace(pg_get_functiondef(procedure_row.oid), '[[:space:]]+', ' ', 'g')) as normalized_definition
  from pg_proc procedure_row
  join pg_namespace namespace_row on namespace_row.oid = procedure_row.pronamespace
  where namespace_row.nspname = 'public'
    and procedure_row.oid = to_regprocedure(
      'public.convert_legacy_hotel_schedules_to_reservation(uuid,uuid,uuid,uuid,uuid,uuid[],text,uuid)'
    )
), checks as (
  select
    exists(select 1 from target) as function_exists,
    coalesce((select prosecdef from target), false) as security_definer,
    coalesce((select proconfig @> array['search_path=public, pg_temp'] from target), false)
      as fixed_search_path,
    has_function_privilege(
      'authenticated',
      'public.convert_legacy_hotel_schedules_to_reservation(uuid,uuid,uuid,uuid,uuid,uuid[],text,uuid)',
      'EXECUTE'
    ) as authenticated_execute,
    not has_function_privilege(
      'anon',
      'public.convert_legacy_hotel_schedules_to_reservation(uuid,uuid,uuid,uuid,uuid,uuid[],text,uuid)',
      'EXECUTE'
    ) as anon_execute_revoked,
    coalesce((select normalized_definition like '%has_operation_role(array[''owner'', ''manager''])%' from target), false)
      as manager_guard_present,
    coalesce((select normalized_definition like '%hotel-request:%'
      and normalized_definition like '%stay.request_id = p_request_id%'
      and normalized_definition like '%stay.dog_id = p_dog_id%'
      and normalized_definition like '%from public.hotel_capacity_reservations capacity where capacity.hotel_stay_id = stay.id and capacity.archived_at is null ) = 1%'
      and normalized_definition like '%capacity.room_type_id = p_room_type_id%'
      and normalized_definition like '%capacity.reserved_from is not distinct from check_in.starts_at%'
      and normalized_definition like '%capacity.reserved_until is not distinct from check_out.starts_at%'
      and normalized_definition like '%from public.hotel_stay_schedule_events event where event.hotel_stay_id = stay.id and event.archived_at is null ) = 2%'
      and normalized_definition like '%event.event_kind = ''check_in''%'
      and normalized_definition like '%event.event_kind = ''check_out''%'
      and normalized_definition like '%동일 request_id의 입력 계약 불일치%'
      and normalized_definition like '%entity_audit_events%' from target), false)
      as request_idempotency_present,
    coalesce((select normalized_definition like '%count(distinct membership.profile_id)%'
      from target), false) as distinct_assignee_guard_present,
    coalesce((select normalized_definition like '%order by schedule.id for update%'
      from target), false) as stable_schedule_lock_present,
    coalesce((select normalized_definition like '%hotel_stay_schedule_events%'
      and normalized_definition like '%operation_schedule_id in (%'
      and normalized_definition like '%연결 이력이 있는 일정%' from target), false)
      as historical_link_guard_present,
    coalesce((select normalized_definition like '%assert_hotel_capacity_available(%'
      from target), false) as capacity_guard_present,
    coalesce((select normalized_definition like '%update_operation_schedule(%'
      and normalized_definition like '%호텔링%'
      and normalized_definition like '%· 입실%'
      and normalized_definition like '%· 퇴실%'
      and normalized_definition like '%check_in_schedule.starts_at, check_in_schedule.ends_at%'
      and normalized_definition like '%check_out_schedule.starts_at, check_out_schedule.ends_at%'
      and normalized_definition not like '%starts_at + interval ''1 hour''%'
      from target), false)
      as existing_schedule_normalization_present,
    coalesce((select normalized_definition like '%check_in_schedule.ends_at <= check_in_schedule.starts_at%'
      and normalized_definition like '%check_out_schedule.ends_at <= check_out_schedule.starts_at%'
      and normalized_definition like '%종료 시각은 각 시작 시각보다 늦어야 합니다%'
      from target), false) as existing_end_time_guard_present,
    coalesce((select normalized_definition like '%calendar.is_active%'
      and normalized_definition like '%unit.is_active%'
      and normalized_definition like '%unit.code = ''hotel''%'
      from target), false) as active_hotel_calendar_guard_present,
    coalesce((select normalized_definition not like '%insert into public.operation_schedules%'
      from target), false) as no_new_schedule_insert,
    coalesce((select normalized_definition like '%insert into public.hotel_stays%'
      and normalized_definition like '%insert into public.hotel_capacity_reservations%'
      and normalized_definition like '%insert into public.hotel_stay_schedule_events%'
      and normalized_definition like '%check_in%'
      and normalized_definition like '%check_out%' from target), false)
      as aggregate_insert_contract_present,
    coalesce((select normalized_definition like '%return public.hotel_stay_json(stay_id)%'
      from target), false) as stay_json_return_present
)
select *, case
  when not function_exists then 'FAILED_FUNCTION_MISSING'
  when not security_definer then 'FAILED_SECURITY_DEFINER'
  when not fixed_search_path then 'FAILED_SEARCH_PATH'
  when not authenticated_execute or not anon_execute_revoked then 'FAILED_EXECUTE_GRANTS'
  when not manager_guard_present then 'FAILED_MANAGER_GUARD'
  when not request_idempotency_present then 'FAILED_IDEMPOTENCY_CONTRACT'
  when not distinct_assignee_guard_present then 'FAILED_ASSIGNEE_DISTINCT_CONTRACT'
  when not stable_schedule_lock_present then 'FAILED_SCHEDULE_LOCK'
  when not historical_link_guard_present then 'FAILED_LINK_HISTORY_GUARD'
  when not capacity_guard_present then 'FAILED_CAPACITY_GUARD'
  when not existing_schedule_normalization_present then 'FAILED_SCHEDULE_NORMALIZATION'
  when not existing_end_time_guard_present then 'FAILED_EXISTING_END_TIME_GUARD'
  when not active_hotel_calendar_guard_present then 'FAILED_ACTIVE_HOTEL_CALENDAR_GUARD'
  when not no_new_schedule_insert then 'FAILED_DUPLICATE_SCHEDULE_GUARD'
  when not aggregate_insert_contract_present then 'FAILED_AGGREGATE_INSERT_CONTRACT'
  when not stay_json_return_present then 'FAILED_RETURN_CONTRACT'
  else 'LEGACY_HOTEL_CONVERSION_READY'
end as postflight_status
from checks;

select object_name, row_count
from (
  values
    ('operation_schedules', (select count(*)::bigint from public.operation_schedules)),
    ('hotel_stays', (select count(*)::bigint from public.hotel_stays)),
    ('hotel_capacity_reservations', (select count(*)::bigint from public.hotel_capacity_reservations)),
    ('hotel_stay_schedule_events', (select count(*)::bigint from public.hotel_stay_schedule_events))
) current_state(object_name, row_count)
order by object_name;

select
  procedure_row.oid::regprocedure::text as function_signature,
  md5(pg_get_functiondef(procedure_row.oid)) as function_fingerprint
from pg_proc procedure_row
where procedure_row.oid in (
  to_regprocedure('public.update_operation_schedule(uuid,integer,uuid,uuid,text,timestamp with time zone,timestamp with time zone,boolean,boolean,text,uuid[],uuid[],uuid[],uuid)'),
  to_regprocedure('public.assert_hotel_capacity_available(uuid,timestamp with time zone,timestamp with time zone,integer,uuid)'),
  to_regprocedure('public.hotel_stay_json(uuid)'),
  to_regprocedure('public.create_hotel_reservation(uuid,uuid,text,timestamp with time zone,timestamp with time zone,uuid,uuid,uuid,uuid[],text,uuid)')
)
order by function_signature;

-- Optional manual rollback-only conversion probe (do not run against production data
-- without replacing every value with disposable test records):
-- begin;
-- select public.convert_legacy_hotel_schedules_to_reservation(
--   '<check-in-schedule-id>'::uuid, '<check-out-schedule-id>'::uuid,
--   '<dog-id>'::uuid, '<customer-id>'::uuid, '<room-type-id>'::uuid,
--   array['<assignee-profile-id>'::uuid], 'rollback probe', gen_random_uuid()
-- );
-- rollback;

rollback;
