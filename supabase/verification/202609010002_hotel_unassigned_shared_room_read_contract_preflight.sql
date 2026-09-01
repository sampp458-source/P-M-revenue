-- Production Dashboard preflight. Catalog and aggregate inspection only.
begin transaction read only;

with catalog_checks as (
  select
    to_regclass('public.family_bookings') is not null
      and to_regclass('public.family_booking_members') is not null
      and to_regclass('public.family_shared_room_groups') is not null
      and to_regclass('public.dogs') is not null
      and to_regclass('public.hotel_stays') is not null
      and to_regclass('public.hotel_room_types') is not null
      and to_regclass('public.hotel_capacity_reservations') is not null
      and to_regclass('public.hotel_physical_occupancies') is not null
      and to_regclass('public.hotel_physical_occupancy_members') is not null
      as required_tables_ok,
    exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'hotel_capacity_reservations'
        and column_name = 'shared_room_group_id'
        and data_type = 'uuid'
    ) and exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'family_shared_room_groups'
        and column_name = 'normalized_starts_at'
        and data_type = 'timestamp with time zone'
    ) and exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'family_shared_room_groups'
        and column_name = 'normalized_ends_at'
        and data_type = 'timestamp with time zone'
    ) as required_columns_ok,
    to_regprocedure('public.is_active_operation_member()') is not null
      as active_member_auth_ok,
    to_regprocedure('public.get_unassigned_shared_hotel_room_groups(date)') is null
      as read_rpc_absent,
    to_regprocedure('public.get_family_booking(uuid)') is not null
      and to_regprocedure('public.get_customer_family_bookings(uuid)') is not null
      and to_regprocedure('public.get_hotel_shared_room_occupancies(date)') is not null
      and to_regprocedure('public.get_shared_hotel_room_occupancy(uuid)') is not null
      and to_regprocedure('public.create_unassigned_shared_room_family_booking(uuid,text,boolean,jsonb,uuid,boolean,uuid)') is not null
      and to_regprocedure('public.create_shared_hotel_room_occupancy(uuid,uuid,uuid)') is not null
      as baseline_rpc_signatures_ok,
    not has_table_privilege('authenticated', 'public.family_bookings', 'SELECT')
      and not has_table_privilege('authenticated', 'public.family_booking_members', 'SELECT')
      and not has_table_privilege('authenticated', 'public.family_shared_room_groups', 'SELECT')
      as direct_select_revoked_ok,
    (
      select count(*) = 3
      from pg_class relation
      where relation.oid in (
        'public.family_bookings'::regclass,
        'public.family_booking_members'::regclass,
        'public.family_shared_room_groups'::regclass
      ) and relation.relrowsecurity
    ) as family_rls_ok
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
      where archived_at is null and source_kind = 'shared_group')::bigint
      as requested_shared_capacity_count,
    (select count(*) from public.hotel_capacity_reservations
      where archived_at is null and source_kind = 'shared_occupancy')::bigint
      as allocated_shared_capacity_count,
    (select count(*)
      from public.family_shared_room_groups shared_group
      where shared_group.archived_at is null
        and shared_group.status = 'requested'
        and shared_group.requested_capacity < 2)::bigint
      as invalid_quantity_count,
    (select count(*)
      from public.family_shared_room_groups shared_group
      left join public.family_bookings booking
        on booking.id = shared_group.family_booking_id
       and booking.archived_at is null
      where shared_group.archived_at is null
        and shared_group.status = 'requested'
        and booking.id is null)::bigint
      as orphan_booking_count,
    (select count(*)
      from public.hotel_capacity_reservations capacity
      left join public.family_shared_room_groups shared_group
        on shared_group.id = capacity.shared_room_group_id
       and shared_group.archived_at is null
       and shared_group.status = 'requested'
      where capacity.archived_at is null
        and capacity.source_kind = 'shared_group'
        and shared_group.id is null)::bigint
      as orphan_capacity_count,
    (select count(*) from (
      select capacity.shared_room_group_id
      from public.hotel_capacity_reservations capacity
      where capacity.archived_at is null
        and capacity.source_kind = 'shared_group'
      group by capacity.shared_room_group_id
      having count(*) > 1
    ) duplicate)::bigint as duplicate_active_capacity_count,
    (select count(*)
      from public.hotel_capacity_reservations capacity
      left join public.hotel_room_types room_type
        on room_type.id = capacity.room_type_id
       and room_type.is_active
       and room_type.archived_at is null
      where capacity.archived_at is null
        and capacity.source_kind = 'shared_group'
        and (
          capacity.quantity <> 1
          or room_type.id is null
          or upper(btrim(room_type.code)) <> 'DELUXE'
        ))::bigint as non_deluxe_shared_count,
    (select count(*)
      from public.family_booking_members member
      join public.family_shared_room_groups shared_group
        on shared_group.id = member.shared_room_group_id
       and shared_group.archived_at is null
       and shared_group.status = 'requested'
      join public.family_bookings booking
        on booking.id = member.family_booking_id
       and booking.id = shared_group.family_booking_id
       and booking.archived_at is null
      left join public.dogs dog on dog.id = member.dog_id
      left join public.hotel_stays stay
        on stay.id = member.hotel_stay_id
       and stay.archived_at is null
      where member.archived_at is null
        and member.service_type = 'hotel'
        and (
          dog.id is null
          or dog.customer_id is distinct from booking.customer_id
          or stay.id is null
          or stay.dog_id is distinct from member.dog_id
        ))::bigint as cross_customer_member_count,
    (select count(*)
      from public.family_shared_room_groups shared_group
      where shared_group.archived_at is null
        and shared_group.status = 'requested'
        and exists (
          select 1
          from public.hotel_physical_occupancies occupancy
          where occupancy.shared_room_group_id = shared_group.id
            and occupancy.archived_at is null
        ))::bigint as invalid_allocation_count,
    (select count(*)
      from public.family_shared_room_groups shared_group
      left join public.family_bookings booking
        on booking.id = shared_group.family_booking_id
       and booking.archived_at is null
      where shared_group.archived_at is null
        and shared_group.status = 'requested'
        and (
          booking.id is null
          or (select count(*) from public.family_booking_members member
              where member.shared_room_group_id = shared_group.id
                and member.family_booking_id = shared_group.family_booking_id
                and member.service_type = 'hotel'
                and member.archived_at is null) <> shared_group.requested_capacity
          or (select count(*) from public.hotel_capacity_reservations capacity
              join public.hotel_room_types room_type
                on room_type.id = capacity.room_type_id
              where capacity.shared_room_group_id = shared_group.id
                and capacity.source_kind = 'shared_group'
                and capacity.quantity = 1
                and capacity.archived_at is null
                and upper(btrim(room_type.code)) = 'DELUXE') <> 1
          or exists (
            select 1 from public.hotel_physical_occupancies occupancy
            where occupancy.shared_room_group_id = shared_group.id
              and occupancy.archived_at is null
          )
        ))::bigint as invalid_requested_shared_group_count
), result as (
  select catalog_checks.*, data_counts.*,
    required_tables_ok and required_columns_ok and active_member_auth_ok
      and read_rpc_absent and baseline_rpc_signatures_ok
      and direct_select_revoked_ok and family_rls_ok
      and invalid_quantity_count = 0
      and orphan_booking_count = 0
      and orphan_capacity_count = 0
      and duplicate_active_capacity_count = 0
      and non_deluxe_shared_count = 0
      and cross_customer_member_count = 0
      and invalid_allocation_count = 0
      and invalid_requested_shared_group_count = 0 as all_ok
  from catalog_checks cross join data_counts
)
select
  case when all_ok then
    'HOTEL_UNASSIGNED_SHARED_ROOM_READ_CONTRACT_PREFLIGHT_PASS'
  else 'HOTEL_UNASSIGNED_SHARED_ROOM_READ_CONTRACT_PREFLIGHT_FAIL' end verdict,
  case when required_tables_ok then 'PASS' else 'FAIL' end required_tables,
  case when required_columns_ok then 'PASS' else 'FAIL' end required_columns,
  case when active_member_auth_ok then 'PASS' else 'FAIL' end active_member_auth,
  case when read_rpc_absent then 'PASS' else 'FAIL' end read_rpc_name_collision,
  case when baseline_rpc_signatures_ok then 'PASS' else 'FAIL' end baseline_rpc_signatures,
  case when direct_select_revoked_ok then 'PASS' else 'FAIL' end direct_table_select_revoked,
  case when family_rls_ok then 'PASS' else 'FAIL' end family_rls,
  requested_shared_group_count,
  allocated_shared_group_count,
  physical_occupancy_count,
  physical_member_count,
  requested_shared_capacity_count,
  allocated_shared_capacity_count,
  invalid_quantity_count,
  orphan_booking_count,
  orphan_capacity_count,
  duplicate_active_capacity_count,
  non_deluxe_shared_count,
  cross_customer_member_count,
  invalid_allocation_count,
  invalid_requested_shared_group_count,
  case when invalid_quantity_count = 0
    and orphan_booking_count = 0
    and orphan_capacity_count = 0
    and duplicate_active_capacity_count = 0
    and non_deluxe_shared_count = 0
    and cross_customer_member_count = 0
    and invalid_allocation_count = 0
    and invalid_requested_shared_group_count = 0
    then 'NO' else 'REVIEW_REQUIRED' end backfill_required,
  '6758466d221eb4fb5aad2320fb239966c6de3813ddf64439fdda94fe10e125b7'::text migration_sha256
from result;

rollback;
