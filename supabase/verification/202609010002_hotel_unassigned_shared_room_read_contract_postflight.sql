-- Production-safe read-only postflight. The read RPC is inspected, not invoked.
begin transaction read only;

with function_contract as (
  select
    lower(pg_get_functiondef(
      'public.get_unassigned_shared_hotel_room_groups(date)'::regprocedure
    )) source
), catalog_checks as (
  select
    exists (
      select 1 from pg_proc
      where oid = 'public.get_unassigned_shared_hotel_room_groups(date)'::regprocedure
        and prorettype = 'jsonb'::regtype
        and provolatile = 's'
        and prosecdef
        and array_to_string(proconfig, ',') like '%search_path=public, pg_temp%'
    ) as read_rpc_shape_ok,
    function_contract.source like '%is_active_operation_member()%'
      and function_contract.source like '%errcode = ''42501''%'
      and function_contract.source like '%status = ''requested''%'
      and function_contract.source like '%archived_at is null%'
      and function_contract.source like '%normalized_starts_at < selected_end%'
      and function_contract.source like '%normalized_ends_at > selected_start%'
      and function_contract.source like '%source_kind = ''shared_group''%'
      and function_contract.source like '%capacity.quantity = 1%'
      and function_contract.source like '%upper(btrim(room_type.code)) = ''deluxe''%'
      and function_contract.source like '%not exists (%hotel_physical_occupancies%'
      as read_filter_contract_ok,
    function_contract.source like '%jsonb_agg(group_projection.value order by%'
      and function_contract.source like '%jsonb_agg(%order by member.stable_member_key, member.id%'
      and function_contract.source like '%''sharedroomgroupid''%'
      and function_contract.source like '%''familybookingid''%'
      and function_contract.source like '%''customername''%'
      and function_contract.source like '%''dogmembers''%'
      and function_contract.source like '%''capacityreservationid''%'
      as projection_contract_ok,
    has_function_privilege('authenticated',
      'public.get_unassigned_shared_hotel_room_groups(date)', 'EXECUTE')
      and has_function_privilege('service_role',
      'public.get_unassigned_shared_hotel_room_groups(date)', 'EXECUTE')
      and not has_function_privilege('anon',
      'public.get_unassigned_shared_hotel_room_groups(date)', 'EXECUTE')
      and not exists (
        select 1
        from pg_proc procedure,
          lateral aclexplode(coalesce(
            procedure.proacl, acldefault('f', procedure.proowner)
          )) privilege
        where procedure.oid =
          'public.get_unassigned_shared_hotel_room_groups(date)'::regprocedure
          and privilege.grantee = 0
          and privilege.privilege_type = 'EXECUTE'
      ) as read_rpc_acl_ok,
    not has_table_privilege('authenticated', 'public.family_bookings', 'SELECT')
      and not has_table_privilege('authenticated', 'public.family_booking_members', 'SELECT')
      and not has_table_privilege('authenticated', 'public.family_shared_room_groups', 'SELECT')
      as direct_select_still_revoked_ok,
    to_regprocedure('public.get_family_booking(uuid)') is not null
      and to_regprocedure('public.get_customer_family_bookings(uuid)') is not null
      and to_regprocedure('public.get_hotel_shared_room_occupancies(date)') is not null
      and to_regprocedure('public.get_shared_hotel_room_occupancy(uuid)') is not null
      and to_regprocedure('public.create_unassigned_shared_room_family_booking(uuid,text,boolean,jsonb,uuid,boolean,uuid)') is not null
      and to_regprocedure('public.create_shared_hotel_room_occupancy(uuid,uuid,uuid)') is not null
      as existing_rpc_signatures_ok
  from function_contract
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
      from public.hotel_capacity_reservations capacity
      where capacity.archived_at is null
        and capacity.source_kind = 'shared_group'
        and (
          capacity.shared_room_group_id is null
          or capacity.physical_occupancy_id is not null
          or capacity.hotel_stay_id is not null
          or capacity.daycare_schedule_id is not null
          or capacity.quantity <> 1
        ))::bigint as invalid_requested_capacity_source_count,
    (select count(*)
      from public.hotel_capacity_reservations capacity
      where capacity.archived_at is null
        and capacity.source_kind = 'shared_occupancy'
        and (
          capacity.physical_occupancy_id is null
          or capacity.shared_room_group_id is not null
          or capacity.hotel_stay_id is not null
          or capacity.daycare_schedule_id is not null
          or capacity.quantity <> 1
        ))::bigint as invalid_allocated_capacity_source_count,
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
    (select count(*) from (
      select capacity.physical_occupancy_id
      from public.hotel_capacity_reservations capacity
      where capacity.archived_at is null
        and capacity.source_kind = 'shared_occupancy'
      group by capacity.physical_occupancy_id
      having count(*) > 1
    ) duplicate)::bigint as duplicate_active_allocated_capacity_count,
    (select count(*)
      from public.hotel_capacity_reservations capacity
      left join public.hotel_physical_occupancies occupancy
        on occupancy.id = capacity.physical_occupancy_id
       and occupancy.archived_at is null
      where capacity.archived_at is null
        and capacity.source_kind = 'shared_occupancy'
        and (
          occupancy.id is null
          or occupancy.capacity_reservation_id is distinct from capacity.id
        ))::bigint as orphan_allocated_capacity_count,
    (select count(*)
      from public.hotel_capacity_reservations capacity
      left join public.hotel_room_types room_type
        on room_type.id = capacity.room_type_id
       and room_type.is_active
       and room_type.archived_at is null
      left join public.hotel_physical_occupancies occupancy
        on occupancy.id = capacity.physical_occupancy_id
       and occupancy.archived_at is null
      where capacity.archived_at is null
        and capacity.source_kind in ('shared_group', 'shared_occupancy')
        and (
          capacity.quantity <> 1
          or room_type.id is null
          or upper(btrim(room_type.code)) <> 'DELUXE'
          or (capacity.source_kind = 'shared_occupancy' and (
            occupancy.id is null
            or occupancy.room_type_id is distinct from capacity.room_type_id
          ))
        ))::bigint as non_deluxe_shared_count,
    (select count(*)
      from public.family_booking_members member
      join public.family_shared_room_groups shared_group
        on shared_group.id = member.shared_room_group_id
       and shared_group.archived_at is null
       and shared_group.status in ('requested', 'allocated')
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
        ))::bigint as invalid_requested_shared_group_count,
    (select count(*)
      from public.hotel_physical_occupancies occupancy
      where occupancy.archived_at is null
        and (
          select count(*)
          from public.hotel_capacity_reservations capacity
          where capacity.id = occupancy.capacity_reservation_id
            and capacity.physical_occupancy_id = occupancy.id
            and capacity.source_kind = 'shared_occupancy'
            and capacity.quantity = 1
            and capacity.archived_at is null
        ) <> 1)::bigint as invalid_physical_capacity_relation_count,
    (select count(*)
      from public.hotel_physical_occupancies occupancy
      where occupancy.archived_at is null
        and (
          select count(*)
          from public.hotel_room_allocations allocation
          where allocation.id = occupancy.room_allocation_id
            and allocation.capacity_reservation_id =
              occupancy.capacity_reservation_id
            and allocation.room_id = occupancy.room_id
            and allocation.archived_at is null
        ) <> 1)::bigint as invalid_physical_allocation_relation_count,
    (select count(*)
      from public.hotel_physical_occupancies occupancy
      left join public.family_shared_room_groups shared_group
        on shared_group.id = occupancy.shared_room_group_id
       and shared_group.archived_at is null
      where occupancy.archived_at is null
        and (
          shared_group.id is null
          or shared_group.family_booking_id is distinct from
            occupancy.family_booking_id
          or (occupancy.status = 'active'
            and shared_group.status <> 'allocated')
          or (occupancy.status in ('completed', 'released')
            and shared_group.status <> 'released')
        ))::bigint as invalid_allocated_group_status_count,
    (select count(*)
      from public.hotel_physical_occupancy_members occupancy_member
      left join public.hotel_physical_occupancies occupancy
        on occupancy.id = occupancy_member.occupancy_id
       and occupancy.archived_at is null
      left join public.family_booking_members booking_member
        on booking_member.id = occupancy_member.family_booking_member_id
       and booking_member.archived_at is null
      where occupancy_member.archived_at is null
        and (
          occupancy.id is null
          or booking_member.id is null
          or booking_member.family_booking_id is distinct from
            occupancy.family_booking_id
          or booking_member.shared_room_group_id is distinct from
            occupancy.shared_room_group_id
          or booking_member.hotel_stay_id is distinct from
            occupancy_member.hotel_stay_id
          or booking_member.dog_id is distinct from
            occupancy_member.dog_id
        ))::bigint as invalid_physical_member_relation_count
), result as (
  select catalog_checks.*, data_counts.*,
    read_rpc_shape_ok and read_filter_contract_ok
      and projection_contract_ok and read_rpc_acl_ok
      and direct_select_still_revoked_ok and existing_rpc_signatures_ok
      and invalid_requested_capacity_source_count = 0
      and invalid_allocated_capacity_source_count = 0
      and invalid_quantity_count = 0
      and orphan_booking_count = 0
      and orphan_capacity_count = 0
      and duplicate_active_capacity_count = 0
      and duplicate_active_allocated_capacity_count = 0
      and orphan_allocated_capacity_count = 0
      and non_deluxe_shared_count = 0
      and cross_customer_member_count = 0
      and invalid_allocation_count = 0
      and invalid_requested_shared_group_count = 0
      and invalid_physical_capacity_relation_count = 0
      and invalid_physical_allocation_relation_count = 0
      and invalid_allocated_group_status_count = 0
      and invalid_physical_member_relation_count = 0 as all_ok
  from catalog_checks cross join data_counts
)
select
  case when all_ok then
    'HOTEL_UNASSIGNED_SHARED_ROOM_READ_CONTRACT_POSTFLIGHT_PASS'
  else 'HOTEL_UNASSIGNED_SHARED_ROOM_READ_CONTRACT_POSTFLIGHT_FAIL' end verdict,
  case when read_rpc_shape_ok then 'PASS' else 'FAIL' end read_rpc_shape,
  case when read_filter_contract_ok then 'PASS' else 'FAIL' end read_filter_contract,
  case when projection_contract_ok then 'PASS' else 'FAIL' end projection_contract,
  case when read_rpc_acl_ok then 'PASS' else 'FAIL' end read_rpc_acl,
  case when direct_select_still_revoked_ok then 'PASS' else 'FAIL' end direct_table_select_revoked,
  case when existing_rpc_signatures_ok then 'PASS' else 'FAIL' end existing_rpc_signatures,
  requested_shared_group_count,
  allocated_shared_group_count,
  physical_occupancy_count,
  physical_member_count,
  requested_shared_capacity_count,
  allocated_shared_capacity_count,
  case when invalid_requested_capacity_source_count = 0
    then 'PASS' else 'FAIL' end requested_capacity_source_ownership,
  case when invalid_allocated_capacity_source_count = 0
    then 'PASS' else 'FAIL' end allocated_capacity_source_ownership,
  invalid_quantity_count,
  orphan_booking_count,
  orphan_capacity_count,
  duplicate_active_capacity_count,
  duplicate_active_allocated_capacity_count,
  orphan_allocated_capacity_count,
  non_deluxe_shared_count,
  cross_customer_member_count,
  invalid_allocation_count,
  invalid_requested_shared_group_count,
  invalid_physical_capacity_relation_count,
  invalid_physical_allocation_relation_count,
  invalid_allocated_group_status_count,
  invalid_physical_member_relation_count,
  'INFORMATIONAL_ONLY'::text as business_count_baseline,
  case when invalid_requested_capacity_source_count = 0
    and invalid_allocated_capacity_source_count = 0
    and invalid_quantity_count = 0
    and orphan_booking_count = 0
    and orphan_capacity_count = 0
    and duplicate_active_capacity_count = 0
    and duplicate_active_allocated_capacity_count = 0
    and orphan_allocated_capacity_count = 0
    and non_deluxe_shared_count = 0
    and cross_customer_member_count = 0
    and invalid_allocation_count = 0
    and invalid_requested_shared_group_count = 0
    and invalid_physical_capacity_relation_count = 0
    and invalid_physical_allocation_relation_count = 0
    and invalid_allocated_group_status_count = 0
    and invalid_physical_member_relation_count = 0
    then 'PASS' else 'FAIL' end structural_invariant_contract
from result;

rollback;
