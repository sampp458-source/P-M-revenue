-- Hotel flexible reservation extension: read-only postflight

begin read only;

select
  procedure_row.oid::regprocedure::text as legacy_function_identity,
  md5(pg_get_functiondef(procedure_row.oid)) as legacy_function_fingerprint,
  has_function_privilege(
    'authenticated', procedure_row.oid, 'EXECUTE'
  ) as authenticated_execute
from pg_proc procedure_row
join pg_namespace schema_row on schema_row.oid = procedure_row.pronamespace
where schema_row.nspname = 'public'
  and procedure_row.proname in (
    'create_hotel_reservation',
    'update_hotel_reservation',
    'complete_hotel_check_in',
    'complete_hotel_check_out',
    'get_hotel_operations_snapshot',
    'hotel_stay_json'
  )
order by procedure_row.oid::regprocedure::text;

select
  'hotel_stays' as entity,
  count(*) as row_count,
  md5(coalesce(string_agg(
    concat_ws('|', id, version, dog_id, request_id, archived_at),
    ',' order by id
  ), '')) as fingerprint
from public.hotel_stays
union all
select
  'hotel_capacity_reservations',
  count(*),
  md5(coalesce(string_agg(
    concat_ws('|', id, version, hotel_stay_id, room_type_id,
      reserved_from, reserved_until, archived_at),
    ',' order by id
  ), ''))
from public.hotel_capacity_reservations
union all
select
  'operation_schedules',
  count(*),
  md5(coalesce(string_agg(
    concat_ws('|', id, version, starts_at, ends_at,
      time_unspecified, archived_at),
    ',' order by id
  ), ''))
from public.operation_schedules;

with function_contract as (
  select
    procedure_row.proname,
    procedure_row.oid::regprocedure::text as identity,
    procedure_row.prosecdef as security_definer,
    has_function_privilege(
      'authenticated', procedure_row.oid, 'EXECUTE'
    ) as authenticated_execute,
    lower(regexp_replace(
      pg_get_functiondef(procedure_row.oid), '\s+', ' ', 'g'
    )) as normalized_definition
  from pg_proc procedure_row
  join pg_namespace schema_row on schema_row.oid = procedure_row.pronamespace
  where schema_row.nspname = 'public'
    and procedure_row.proname in (
      'assert_hotel_total_capacity_available',
      'create_flexible_hotel_reservation',
      'update_flexible_hotel_reservation',
      'finalize_and_complete_hotel_check_in',
      'finalize_and_complete_hotel_check_out',
      'get_hotel_operations_snapshot_v2'
    )
), checks as (
  select
    exists (
      select 1 from information_schema.columns column_row
      where column_row.table_schema = 'public'
        and column_row.table_name = 'hotel_capacity_reservations'
        and column_row.column_name = 'room_type_id'
        and column_row.is_nullable = 'YES'
    ) as room_type_nullable,
    exists (
      select 1
      from pg_constraint constraint_row
      join pg_class table_row on table_row.oid = constraint_row.conrelid
      join pg_namespace schema_row on schema_row.oid = table_row.relnamespace
      where schema_row.nspname = 'public'
        and table_row.relname = 'hotel_capacity_reservations'
        and constraint_row.conname =
          'hotel_capacity_reservations_room_type_state_check'
        and constraint_row.convalidated
    ) as room_type_state_constraint_ready,
    to_regclass(
      'public.hotel_capacity_reservations_unspecified_overlap_idx'
    ) is not null as unspecified_index_ready,
    exists (
      select 1 from pg_trigger trigger_row
      where trigger_row.tgrelid =
          'public.hotel_capacity_reservations'::regclass
        and trigger_row.tgname =
          'hotel_capacity_reservations_total_capacity_guard'
        and not trigger_row.tgisinternal
        and trigger_row.tgenabled <> 'D'
    ) as total_capacity_trigger_ready,
    coalesce((
      select lower(regexp_replace(
        pg_get_functiondef(procedure_row.oid), '\s+', ' ', 'g'
      )) like '%assert_hotel_total_capacity_available%'
      from pg_proc procedure_row
      join pg_namespace schema_row
        on schema_row.oid = procedure_row.pronamespace
      where schema_row.nspname = 'public'
        and procedure_row.proname = 'enforce_hotel_total_capacity'
    ), false) as total_capacity_trigger_definition_ready,
    exists (
      select 1 from pg_trigger trigger_row
      where trigger_row.tgrelid = 'public.hotel_room_allocations'::regclass
        and trigger_row.tgname = 'hotel_room_allocations_room_type_guard'
        and not trigger_row.tgisinternal
        and trigger_row.tgenabled <> 'D'
    ) as allocation_room_type_trigger_ready,
    not exists (
      select 1
      from (values
        ('operation_schedules_protect_metadata'),
        ('operation_schedules_updated_at'),
        ('operation_schedules_write_permission'),
        ('operation_schedules_audit')
      ) required_trigger(trigger_name)
      where not exists (
        select 1 from pg_trigger trigger_row
        where trigger_row.tgrelid = 'public.operation_schedules'::regclass
          and trigger_row.tgname = required_trigger.trigger_name
          and not trigger_row.tgisinternal
          and trigger_row.tgenabled <> 'D'
      )
    ) as schedule_write_triggers_ready,
    exists (
      select 1
      from pg_constraint constraint_row
      join pg_class table_row on table_row.oid = constraint_row.conrelid
      join pg_namespace schema_row on schema_row.oid = table_row.relnamespace
      where schema_row.nspname = 'public'
        and table_row.relname = 'hotel_capacity_reservations'
        and constraint_row.conname = 'hotel_capacity_reservations_source_check'
        and constraint_row.contype = 'c'
        and constraint_row.convalidated
        and lower(pg_get_constraintdef(constraint_row.oid)) like
          '%source_kind = ''stay''%hotel_stay_id is not null%daycare_schedule_id is null%'
        and lower(pg_get_constraintdef(constraint_row.oid)) like
          '%source_kind = ''daycare''%hotel_stay_id is null%daycare_schedule_id is not null%'
    ) as capacity_source_xor_constraint_ready,
    coalesce((
      select
        strpos(normalized.definition, 'hotel-capacity:') > 0
        and strpos(normalized.definition, 'hotel-room:') > 0
        and strpos(normalized.definition, 'assert_hotel_capacity_available') > 0
        and strpos(normalized.definition, 'hotel-capacity:')
          < strpos(normalized.definition, 'hotel-room:')
        and strpos(normalized.definition, 'hotel-room:')
          < strpos(normalized.definition, 'assert_hotel_capacity_available')
      from (
        select lower(regexp_replace(
          pg_get_functiondef(procedure_row.oid), '\s+', ' ', 'g'
        )) as definition
        from pg_proc procedure_row
        where procedure_row.oid = to_regprocedure(
          'public.update_hotel_reservation(uuid,integer,uuid,uuid,text,timestamp with time zone,timestamp with time zone,uuid,uuid,uuid,uuid[],text,uuid)'
        )
      ) normalized
    ), false) as legacy_update_type_before_room_ready,
    coalesce((
      select
        strpos(normalized.definition, 'assert_hotel_capacity_available') > 0
        and strpos(normalized.definition, 'hotel-room:') > 0
        and strpos(normalized.definition, 'assert_hotel_capacity_available')
          < strpos(normalized.definition, 'hotel-room:')
      from (
        select lower(regexp_replace(
          pg_get_functiondef(procedure_row.oid), '\s+', ' ', 'g'
        )) as definition
        from pg_proc procedure_row
        where procedure_row.oid = to_regprocedure(
          'public.complete_hotel_check_out(uuid,integer,timestamp with time zone,uuid)'
        )
      ) normalized
    ), false) as legacy_checkout_type_before_room_ready,
    coalesce((
      select
        strpos(normalized.definition, 'assert_hotel_capacity_available') > 0
        and strpos(normalized.definition, 'hotel-room:') > 0
        and strpos(normalized.definition, 'update public.hotel_capacity_reservations') > 0
        and strpos(normalized.definition, 'assert_hotel_room_allocation_available') > 0
        and strpos(normalized.definition, 'assert_hotel_capacity_available')
          < strpos(normalized.definition, 'hotel-room:')
        and strpos(normalized.definition, 'hotel-room:')
          < strpos(normalized.definition, 'update public.hotel_capacity_reservations')
        and strpos(normalized.definition, 'update public.hotel_capacity_reservations')
          < strpos(normalized.definition, 'assert_hotel_room_allocation_available')
      from (
        select lower(regexp_replace(
          pg_get_functiondef(procedure_row.oid), '\s+', ' ', 'g'
        )) as definition
        from pg_proc procedure_row
        where procedure_row.oid = to_regprocedure(
          'public.reverse_hotel_completion(uuid,integer,text,text,uuid)'
        )
      ) normalized
    ), false) as legacy_reverse_type_room_total_ready,
    coalesce((
      select md5(procedure_row.prosrc) =
        'dd4dd04865adfa2dc3ec83097e2b81a3'
      from pg_proc procedure_row
      where procedure_row.oid = to_regprocedure(
        'public.reverse_hotel_completion(uuid,integer,text,text,uuid)'
      )
    ), false) as legacy_reverse_lock_repair_version_ready,
    coalesce((
      select md5(procedure_row.prosrc) =
        '321e35c3ac5180215086adf5d0f7d5ac'
      from pg_proc procedure_row
      where procedure_row.oid = to_regprocedure(
        'public.update_hotel_reservation(uuid,integer,uuid,uuid,text,timestamp with time zone,timestamp with time zone,uuid,uuid,uuid,uuid[],text,uuid)'
      )
    ), false) as legacy_update_lock_repair_version_ready,
    (select count(*) from function_contract) = 6
      as extension_function_count_ready,
    not exists (
      select 1 from function_contract
      where not security_definer
        or (
          proname <> 'assert_hotel_total_capacity_available'
          and not authenticated_execute
        )
    ) as function_security_ready,
    not has_function_privilege(
      'authenticated',
      'public.assert_hotel_total_capacity_available(timestamptz,timestamptz,integer,uuid)',
      'EXECUTE'
    ) as helper_not_executable_by_authenticated,
    not exists (
      select 1 from public.hotel_capacity_reservations capacity
      where capacity.source_kind <> 'stay'
        and capacity.room_type_id is null
    ) as non_stay_room_type_contract_ready,
    not exists (
      select 1
      from public.hotel_capacity_reservations capacity
      join public.hotel_room_allocations allocation
        on allocation.capacity_reservation_id = capacity.id
      where capacity.archived_at is null
        and capacity.room_type_id is null
        and allocation.archived_at is null
    ) as unspecified_has_no_active_allocation,
    not exists (
      select 1 from public.hotel_stays stay
      where stay.archived_at is null
        and (
          select count(*)
          from public.hotel_capacity_reservations capacity
          where capacity.hotel_stay_id = stay.id
            and capacity.archived_at is null
        ) <> 1
    ) as active_stay_capacity_exactly_one,
    coalesce((
      select normalized_definition like '%room_type_id is null%'
        and normalized_definition like '%totalreservedpeak%'
        and normalized_definition like '%saferemaining%'
        and normalized_definition like '%individualtypeavailabilitywarning%'
        and normalized_definition like '%confirmedremaining%'
        and normalized_definition like '%conservativeremaining%'
        and normalized_definition like '%affectedbyunspecifiedcount%'
        and normalized_definition like '%totalreservationcount%'
      from function_contract
      where proname = 'get_hotel_operations_snapshot_v2'
    ), false) as snapshot_definition_ready,
    coalesce((
      select normalized_definition like
          '%p_check_in_date::timestamp at time zone ''asia/seoul''%'
        and normalized_definition like
          '%(p_check_out_date + 1)::timestamp at time zone ''asia/seoul''%'
        and normalized_definition like '%room_type_id, reserved_from, reserved_until%'
        and normalized_definition like '%p_check_out_date < p_check_in_date%'
        and normalized_definition like '%p_check_out_time <= p_check_in_time%'
        and normalized_definition like '%unit.is_active%'
        and normalized_definition like '%schedule_type.is_active%'
        and normalized_definition like '%to_jsonb(calendar)%archived_at%'
        and normalized_definition like '%to_jsonb(unit)%archived_at%'
        and normalized_definition like '%to_jsonb(schedule_type)%archived_at%'
        and normalized_definition like '%select room_type.code%'
        and normalized_definition not like '%p_title%'
        and normalized_definition like '%existing_stay.dog_id is distinct from p_dog_id%'
        and normalized_definition like '%customer_link.customer_id%'
        and normalized_definition like '%assignee.profile_id%'
        and normalized_definition like '%replay_check_in_schedule.time_unspecified%'
        and normalized_definition like '%replay_check_in_schedule.starts_at%'
        and normalized_definition like '%replay_check_in_schedule.description%'
        and normalized_definition like '%when coalesce(p_check_in_time_unspecified, false)%'
        and strpos(normalized_definition, 'assert_hotel_capacity_available') > 0
        and strpos(normalized_definition, 'assert_hotel_capacity_available')
          < strpos(normalized_definition, 'insert into public.hotel_capacity_reservations')
      from function_contract
      where proname = 'create_flexible_hotel_reservation'
    ), false) as flexible_create_definition_ready,
    coalesce((
      select normalized_definition like
          '%set room_type_id = p_room_type_id%'
        and normalized_definition like '%reserved_from = capacity_from%'
        and normalized_definition like '%reserved_until = capacity_until%'
        and normalized_definition like '%p_check_out_date < p_check_in_date%'
        and normalized_definition like '%p_check_out_time <= p_check_in_time%'
        and normalized_definition like '%unit.is_active%'
        and normalized_definition like '%schedule_type.is_active%'
        and normalized_definition like '%to_jsonb(calendar)%archived_at%'
        and normalized_definition like '%to_jsonb(unit)%archived_at%'
        and normalized_definition like '%to_jsonb(schedule_type)%archived_at%'
        and normalized_definition like '%select room_type.code%'
        and normalized_definition not like '%p_title%'
        and normalized_definition like '%when coalesce(p_check_in_time_unspecified, false)%'
        and strpos(normalized_definition, 'assert_hotel_capacity_available') > 0
        and strpos(normalized_definition, 'assert_hotel_capacity_available')
          < strpos(normalized_definition, 'update public.hotel_capacity_reservations')
      from function_contract
      where proname = 'update_flexible_hotel_reservation'
    ), false) as flexible_update_definition_ready,
    coalesce((
      select normalized_definition like '%for update%'
        and normalized_definition like '%assert_hotel_capacity_available%'
        and normalized_definition like '%assert_hotel_room_allocation_available%'
        and strpos(normalized_definition, 'assert_hotel_capacity_available')
          < strpos(normalized_definition, 'hotel-room:')
        and strpos(normalized_definition, 'hotel-room:')
          < strpos(normalized_definition, 'update public.hotel_capacity_reservations')
        and normalized_definition like '%update public.operation_schedules%'
        and normalized_definition like '%time_unspecified = false%'
        and normalized_definition like '%select room_type.code%'
        and normalized_definition like '%checked_in_at = p_completed_at%'
      from function_contract
      where proname = 'finalize_and_complete_hotel_check_in'
    ), false) as atomic_check_in_definition_ready,
    coalesce((
      select normalized_definition like '%reserved_until = p_completed_at%'
        and normalized_definition like '%allocated_until = p_completed_at%'
        and strpos(normalized_definition, 'assert_hotel_capacity_available')
          < strpos(normalized_definition, 'hotel-room:')
        and strpos(normalized_definition, 'hotel-room:')
          < strpos(normalized_definition, 'update public.hotel_capacity_reservations')
        and normalized_definition like '%update public.operation_schedules%'
        and normalized_definition like '%time_unspecified = false%'
        and normalized_definition like '%checked_out_at = p_completed_at%'
      from function_contract
      where proname = 'finalize_and_complete_hotel_check_out'
    ), false) as atomic_check_out_definition_ready,
    true as snapshot_runtime_contract_separated,
    to_regprocedure(
      'public.create_hotel_reservation(uuid,uuid,text,timestamp with time zone,timestamp with time zone,uuid,uuid,uuid,uuid[],text,uuid)'
    ) is not null
      and to_regprocedure(
        'public.update_hotel_reservation(uuid,integer,uuid,uuid,text,timestamp with time zone,timestamp with time zone,uuid,uuid,uuid,uuid[],text,uuid)'
      ) is not null
      and to_regprocedure(
        'public.complete_hotel_check_in(uuid,integer,timestamp with time zone,uuid)'
      ) is not null
      and to_regprocedure(
        'public.complete_hotel_check_out(uuid,integer,timestamp with time zone,uuid)'
      ) is not null
      and to_regprocedure(
        'public.get_hotel_operations_snapshot(date)'
      ) is not null
      as legacy_rpc_contract_preserved
)
select
  case
    when not room_type_nullable then 'FAILED_ROOM_TYPE_NOT_NULLABLE'
    when not room_type_state_constraint_ready
      then 'FAILED_ROOM_TYPE_STATE_CONSTRAINT'
    when not unspecified_index_ready then 'FAILED_UNSPECIFIED_INDEX'
    when not total_capacity_trigger_ready
      then 'FAILED_TOTAL_CAPACITY_TRIGGER'
    when not total_capacity_trigger_definition_ready
      then 'FAILED_TOTAL_CAPACITY_TRIGGER_DEFINITION'
    when not allocation_room_type_trigger_ready
      then 'FAILED_ALLOCATION_ROOM_TYPE_TRIGGER'
    when not schedule_write_triggers_ready
      then 'FAILED_SCHEDULE_WRITE_TRIGGER_CONTRACT'
    when not capacity_source_xor_constraint_ready
      then 'FAILED_CAPACITY_SOURCE_XOR_CONTRACT'
    when not legacy_update_type_before_room_ready
      or not legacy_checkout_type_before_room_ready
      then 'FAILED_EXISTING_GLOBAL_LOCK_ORDER_CONFLICT'
    when not legacy_reverse_type_room_total_ready
      then 'FAILED_REVERSE_COMPLETION_GLOBAL_LOCK_ORDER_CONFLICT'
    when not legacy_reverse_lock_repair_version_ready
      then 'FAILED_REVERSE_COMPLETION_LOCK_REPAIR_VERSION_MISMATCH'
    when not legacy_update_lock_repair_version_ready
      then 'FAILED_UPDATE_LOCK_REPAIR_VERSION_MISMATCH'
    when not extension_function_count_ready
      then 'FAILED_EXTENSION_FUNCTION_COUNT'
    when not function_security_ready
      or not helper_not_executable_by_authenticated
      then 'FAILED_FUNCTION_SECURITY_CONTRACT'
    when not non_stay_room_type_contract_ready
      then 'FAILED_NON_STAY_ROOM_TYPE_CONTRACT'
    when not unspecified_has_no_active_allocation
      then 'FAILED_UNSPECIFIED_ALLOCATION_CONTRACT'
    when not active_stay_capacity_exactly_one
      then 'FAILED_STAY_CAPACITY_CONTRACT'
    when not snapshot_definition_ready
      then 'FAILED_SNAPSHOT_V2_DDL_CONTRACT'
    when not flexible_create_definition_ready
      then 'FAILED_FLEXIBLE_CREATE_CONTRACT'
    when not flexible_update_definition_ready
      then 'FAILED_FLEXIBLE_UPDATE_CONTRACT'
    when not atomic_check_in_definition_ready
      then 'FAILED_ATOMIC_CHECK_IN_CONTRACT'
    when not atomic_check_out_definition_ready
      then 'FAILED_ATOMIC_CHECK_OUT_CONTRACT'
    when not legacy_rpc_contract_preserved
      then 'FAILED_LEGACY_RPC_CONTRACT'
    else 'HOTEL_FLEXIBLE_DDL_CONTRACT_READY'
  end as postflight_status,
  checks.*
from checks;

rollback;

-- End of Hotel flexible reservation DDL postflight.
