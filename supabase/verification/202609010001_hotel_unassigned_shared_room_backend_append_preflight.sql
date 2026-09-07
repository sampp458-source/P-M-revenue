-- Production Dashboard preflight. Catalog and aggregate inspection only.
begin transaction read only;

with function_source as (
  select
    lower(pg_get_functiondef(
      'public.assert_hotel_capacity_available(uuid,timestamp with time zone,timestamp with time zone,integer,uuid)'::regprocedure
    )) capacity_assertion,
    lower(pg_get_functiondef(
      'public.assert_hotel_total_capacity_available(timestamp with time zone,timestamp with time zone,integer,uuid)'::regprocedure
    )) total_capacity_assertion,
    lower(pg_get_functiondef(
      'public.create_shared_hotel_room_occupancy(uuid,uuid,uuid)'::regprocedure
    )) occupancy_rpc
), catalog_checks as (
  select
    to_regclass('public.hotel_capacity_reservations') is not null
      and to_regclass('public.family_bookings') is not null
      and to_regclass('public.family_booking_members') is not null
      and to_regclass('public.family_shared_room_groups') is not null
      and to_regclass('public.hotel_physical_occupancies') is not null
      and to_regclass('public.hotel_physical_occupancy_members') is not null
      and to_regclass('public.hotel_physical_occupancy_requests') is not null
      and to_regclass('public.hotel_room_allocations') is not null
      as baseline_tables_ok,
    exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'hotel_capacity_reservations'
        and column_name = 'source_kind' and data_type = 'text'
        and is_nullable = 'NO'
    ) and exists (
      select 1 from pg_constraint
      where conrelid = 'public.hotel_capacity_reservations'::regclass
        and conname = 'hotel_capacity_reservations_source_kind_check'
        and lower(pg_get_constraintdef(oid)) like '%stay%'
        and lower(pg_get_constraintdef(oid)) like '%daycare%'
        and lower(pg_get_constraintdef(oid)) like '%shared_occupancy%'
        and lower(pg_get_constraintdef(oid)) not like '%shared_group%'
    ) as source_kind_baseline_ok,
    exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'hotel_capacity_reservations'
        and column_name = 'room_type_id' and data_type = 'uuid'
    ) and exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'hotel_capacity_reservations'
        and column_name = 'quantity' and data_type = 'smallint'
        and is_nullable = 'NO'
    ) and exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'hotel_capacity_reservations'
        and column_name = 'archived_at'
        and data_type = 'timestamp with time zone'
    ) as capacity_columns_ok,
    not exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'hotel_capacity_reservations'
        and column_name = 'shared_room_group_id'
    ) and to_regprocedure(
      'public.create_unassigned_shared_room_family_booking(uuid,text,boolean,jsonb,uuid,boolean,uuid)'
    ) is null and to_regprocedure(
      'public.create_unassigned_shared_hotel_stay_internal(uuid,uuid,date,time without time zone,boolean,date,time without time zone,boolean,uuid,uuid,uuid,uuid[],text,uuid,uuid,uuid,uuid)'
    ) is null and not exists (
      select 1 from pg_indexes
      where schemaname = 'public'
        and indexname in (
          'hotel_capacity_reservations_shared_group_uidx',
          'hotel_capacity_reservations_shared_group_lookup_idx'
        )
    ) as append_objects_absent,
    to_regprocedure('public.create_flexible_hotel_reservation(uuid,uuid,date,time without time zone,boolean,date,time without time zone,boolean,uuid,uuid,uuid,uuid[],text,uuid)') is not null
      and to_regprocedure('public.create_family_booking(uuid,text,boolean,jsonb,uuid)') is not null
      and to_regprocedure('public.create_shared_room_family_booking(uuid,text,boolean,jsonb,uuid,uuid,boolean,uuid)') is not null
      and to_regprocedure('public.create_shared_hotel_room_occupancy(uuid,uuid,uuid)') is not null
      and to_regprocedure('public.merge_existing_hotel_stays_into_shared_room(uuid[],integer[],boolean,uuid)') is not null
      and to_regprocedure('public.assign_hotel_room(uuid,integer,uuid,text,uuid)') is not null
      and to_regprocedure('public.join_shared_hotel_room_occupancy(uuid,uuid,integer,uuid)') is not null
      and to_regprocedure('public.complete_shared_hotel_check_in(uuid,uuid,integer,integer,timestamp with time zone,uuid)') is not null
      and to_regprocedure('public.complete_shared_hotel_member_check_out(uuid,uuid,integer,integer,timestamp with time zone,uuid)') is not null
      and to_regprocedure('public.reverse_shared_hotel_member_completion(uuid,uuid,integer,integer,text,uuid)') is not null
      and to_regprocedure('public.move_shared_hotel_room_occupancy(uuid,uuid,integer,text,uuid)') is not null
      as rpc_signatures_ok,
    to_regprocedure('public.cancel_hotel_reservation(uuid,integer,text,uuid)') is not null
      and to_regprocedure('public.update_hotel_reservation(uuid,integer,uuid,uuid,text,timestamp with time zone,timestamp with time zone,uuid,uuid,uuid,uuid[],text,uuid)') is not null
      as edit_cancel_paths_ok,
    exists (
      select 1 from pg_proc
      where oid = 'public.create_shared_hotel_room_occupancy(uuid,uuid,uuid)'::regprocedure
        and prosecdef
        and array_to_string(proconfig, ',') like '%search_path=public, pg_temp%'
    ) as occupancy_security_ok,
    has_function_privilege('authenticated',
      'public.create_shared_hotel_room_occupancy(uuid,uuid,uuid)', 'EXECUTE')
      and has_function_privilege('service_role',
      'public.create_shared_hotel_room_occupancy(uuid,uuid,uuid)', 'EXECUTE')
      and not has_function_privilege('anon',
      'public.create_shared_hotel_room_occupancy(uuid,uuid,uuid)', 'EXECUTE')
      and not exists (
        select 1
        from pg_proc procedure,
          lateral aclexplode(coalesce(
            procedure.proacl, acldefault('f', procedure.proowner)
          )) privilege
        where procedure.oid =
          'public.create_shared_hotel_room_occupancy(uuid,uuid,uuid)'::regprocedure
          and privilege.grantee = 0
          and privilege.privilege_type = 'EXECUTE'
      ) as occupancy_acl_ok,
    (
      select count(*) = 7
      from pg_class table_row
      where table_row.oid in (
        'public.family_bookings'::regclass,
        'public.family_booking_members'::regclass,
        'public.family_shared_room_groups'::regclass,
        'public.hotel_physical_occupancies'::regclass,
        'public.hotel_physical_occupancy_members'::regclass,
        'public.hotel_physical_occupancy_requests'::regclass,
        'public.hotel_capacity_reservations'::regclass
      ) and table_row.relrowsecurity
    ) as rls_ok,
    position('hotel-capacity:' in function_source.capacity_assertion) > 0
      and position('hotel-capacity:all' in function_source.total_capacity_assertion) > 0
      and function_source.occupancy_rpc like '%for update%'
      and function_source.occupancy_rpc like '%assert_hotel_room_allocation_available%'
      and function_source.occupancy_rpc like '%claim_shared_hotel_request_internal%'
      as function_baseline_ok
  from function_source
), data_counts as (
  select
    (select count(*) from public.family_shared_room_groups
      where archived_at is null and status = 'requested')::bigint
      as requested_shared_group_count,
    (select count(*) from public.family_shared_room_groups
      where archived_at is null and status = 'allocated')::bigint
      as allocated_shared_group_count,
    (select count(*) from public.hotel_physical_occupancies
      where archived_at is null)::bigint as physical_occupancy_count,
    (select count(*) from public.hotel_physical_occupancy_members
      where archived_at is null)::bigint as physical_member_count,
    (select count(*) from public.hotel_capacity_reservations
      where archived_at is null and source_kind = 'shared_occupancy')::bigint
      as shared_capacity_count,
    (select count(*) from public.hotel_capacity_reservations
      where archived_at is null and source_kind = 'shared_occupancy'
        and quantity <> 1)::bigint as invalid_quantity_count,
    (select count(*)
      from public.hotel_capacity_reservations capacity
      left join public.hotel_physical_occupancies occupancy
        on occupancy.id = capacity.physical_occupancy_id
       and occupancy.archived_at is null
      where capacity.archived_at is null
        and capacity.source_kind = 'shared_occupancy'
        and occupancy.id is null)::bigint as orphan_capacity_count,
    (select count(*) from (
      select physical_occupancy_id
      from public.hotel_capacity_reservations
      where archived_at is null and source_kind = 'shared_occupancy'
      group by physical_occupancy_id having count(*) > 1
    ) duplicate)::bigint as duplicate_active_capacity_count,
    (select count(*)
      from public.hotel_capacity_reservations capacity
      join public.hotel_room_types room_type
        on room_type.id = capacity.room_type_id
      where capacity.archived_at is null
        and capacity.source_kind = 'shared_occupancy'
        and upper(btrim(room_type.code)) <> 'DELUXE')::bigint
      as non_deluxe_shared_count,
    (select count(*)
      from public.hotel_physical_occupancy_members occupancy_member
      join public.hotel_physical_occupancies occupancy
        on occupancy.id = occupancy_member.occupancy_id
      join public.family_booking_members booking_member
        on booking_member.id = occupancy_member.family_booking_member_id
      join public.family_bookings booking
        on booking.id = booking_member.family_booking_id
      where occupancy_member.archived_at is null
        and occupancy.archived_at is null
        and booking.customer_id <> occupancy.customer_id)::bigint
      as cross_customer_member_count,
    (select count(*)
      from public.hotel_physical_occupancies occupancy
      left join public.hotel_room_allocations allocation
        on allocation.id = occupancy.room_allocation_id
       and allocation.archived_at is null
      left join public.hotel_capacity_reservations capacity
        on capacity.id = occupancy.capacity_reservation_id
       and capacity.archived_at is null
      where occupancy.archived_at is null
        and (
          occupancy.room_id is null
          or allocation.id is null
          or allocation.room_id <> occupancy.room_id
          or capacity.id is null
          or capacity.source_kind <> 'shared_occupancy'
          or capacity.quantity <> 1
        ))::bigint as invalid_allocation_count
), result as (
  select catalog_checks.*, data_counts.*,
    catalog_checks.baseline_tables_ok
      and catalog_checks.source_kind_baseline_ok
      and catalog_checks.capacity_columns_ok
      and catalog_checks.append_objects_absent
      and catalog_checks.rpc_signatures_ok
      and catalog_checks.edit_cancel_paths_ok
      and catalog_checks.occupancy_security_ok
      and catalog_checks.occupancy_acl_ok
      and catalog_checks.rls_ok
      and catalog_checks.function_baseline_ok
      and data_counts.requested_shared_group_count = 0
      and data_counts.invalid_quantity_count = 0
      and data_counts.orphan_capacity_count = 0
      and data_counts.duplicate_active_capacity_count = 0
      and data_counts.non_deluxe_shared_count = 0
      and data_counts.cross_customer_member_count = 0
      and data_counts.invalid_allocation_count = 0 as all_ok
  from catalog_checks cross join data_counts
)
select
  case when all_ok then
    'HOTEL_UNASSIGNED_SHARED_ROOM_BACKEND_APPEND_PREFLIGHT_PASS'
  else 'HOTEL_UNASSIGNED_SHARED_ROOM_BACKEND_APPEND_PREFLIGHT_FAIL' end verdict,
  case when baseline_tables_ok then 'PASS' else 'FAIL' end baseline_tables,
  case when source_kind_baseline_ok then 'PASS' else 'FAIL' end source_kind_baseline,
  case when capacity_columns_ok then 'PASS' else 'FAIL' end capacity_columns,
  case when append_objects_absent then 'PASS' else 'FAIL' end append_objects_absent,
  case when rpc_signatures_ok then 'PASS' else 'FAIL' end rpc_signatures,
  case when edit_cancel_paths_ok then 'PASS' else 'FAIL' end edit_cancel_paths,
  case when occupancy_security_ok then 'PASS' else 'FAIL' end security_definer_search_path,
  case when occupancy_acl_ok then 'PASS' else 'FAIL' end acl,
  case when rls_ok then 'PASS' else 'FAIL' end rls,
  case when function_baseline_ok then 'PASS' else 'FAIL' end function_baseline,
  requested_shared_group_count,
  allocated_shared_group_count,
  physical_occupancy_count,
  physical_member_count,
  shared_capacity_count,
  invalid_quantity_count,
  orphan_capacity_count,
  duplicate_active_capacity_count,
  non_deluxe_shared_count,
  cross_customer_member_count,
  invalid_allocation_count,
  case when requested_shared_group_count = 0
    and invalid_quantity_count = 0
    and orphan_capacity_count = 0
    and duplicate_active_capacity_count = 0
    and non_deluxe_shared_count = 0
    and cross_customer_member_count = 0
    and invalid_allocation_count = 0
    then 'NO' else 'REVIEW_REQUIRED' end backfill_required,
  'd0f933a6f5c4be52d82700c136997c2f28991b0a9c909ae52462bca34c5a292b'::text migration_sha256
from result;

rollback;
