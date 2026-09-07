-- Production-safe read-only postflight. No RPC is invoked.
begin transaction read only;

with source as (
  select
    lower(pg_get_functiondef(
      'public.create_unassigned_shared_room_family_booking(uuid,text,boolean,jsonb,uuid,boolean,uuid)'::regprocedure
    )) facade,
    lower(pg_get_functiondef(
      'public.create_shared_hotel_room_occupancy(uuid,uuid,uuid)'::regprocedure
    )) occupancy,
    lower(pg_get_functiondef(
      'public.assert_hotel_capacity_available(uuid,timestamp with time zone,timestamp with time zone,integer,uuid)'::regprocedure
    )) capacity_check,
    lower(pg_get_functiondef(
      'public.guard_requested_shared_room_member_mutation()'::regprocedure
    )) edit_guard
), checks as (
  select
    exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'hotel_capacity_reservations'
        and column_name = 'shared_room_group_id'
        and data_type = 'uuid' and is_nullable = 'YES'
    ) as owner_column_ok,
    exists (
      select 1 from pg_constraint
      where conrelid = 'public.hotel_capacity_reservations'::regclass
        and contype = 'f'
        and pg_get_constraintdef(oid) ilike '%shared_room_group_id%family_shared_room_groups%'
    ) as owner_fk_ok,
    exists (
      select 1 from pg_constraint
      where conrelid = 'public.hotel_capacity_reservations'::regclass
        and conname = 'hotel_capacity_reservations_source_kind_check'
        and lower(pg_get_constraintdef(oid)) like '%shared_group%'
        and lower(pg_get_constraintdef(oid)) like '%shared_occupancy%'
    ) as source_kind_ok,
    exists (
      select 1 from pg_indexes
      where schemaname = 'public'
        and indexname = 'hotel_capacity_reservations_shared_group_uidx'
        and lower(indexdef) like '%unique%'
        and lower(indexdef) like '%archived_at is null%'
    ) as unique_active_ok,
    (
      select count(*) = 3
      from pg_trigger
      where not tgisinternal and tgdeferrable and tginitdeferred
        and tgname in (
          'family_shared_room_groups_requested_capacity_invariant',
          'family_booking_members_requested_capacity_invariant',
          'hotel_capacity_requested_shared_group_invariant'
        )
    ) as deferred_invariants_ok,
    source.facade like '%is_active_operation_member()%'
      and source.facade like '%member_count < 2%'
      and source.facade like '%p_shared_room_intent is distinct from true%'
      and source.facade like '%shared_group%'
      and source.facade like '%quantity%1%'
      and source.facade like '%occupancy_count <> 0%'
      and source.facade not like '%p_room_id%'
      and source.facade not like '%create_family_booking(%'
      as facade_contract_ok,
    source.occupancy like '%requested_capacity_count = 1%'
      and source.occupancy like '%requested_capacity_count = 0%'
      and source.occupancy like '%source_kind = ''shared_occupancy''%'
      and source.occupancy like '%shared_room_group_id = null%'
      and source.occupancy like '%insert into public.hotel_physical_occupancies%'
      and source.occupancy like '%insert into public.hotel_physical_occupancy_members%'
      and source.occupancy like '%insert into public.hotel_room_allocations%'
      as transition_contract_ok,
    position('hotel-capacity:all' in source.capacity_check) > 0
      and position(
        '''hotel-capacity:'' || p_room_type_id'
        in regexp_replace(source.capacity_check, '\s+', ' ', 'g')
      ) > position('hotel-capacity:all' in source.capacity_check)
      as lock_order_ok,
    source.edit_guard like '%status = ''requested''%'
      and source.edit_guard like '%pt409%'
      and exists (
        select 1 from pg_trigger
        where not tgisinternal
          and tgname = 'hotel_stays_requested_shared_room_guard'
      )
      and exists (
        select 1 from pg_trigger
        where not tgisinternal
          and tgname = 'operation_schedules_requested_shared_room_guard'
      ) as edit_guard_ok,
    exists (
      select 1 from pg_proc
      where oid =
        'public.create_unassigned_shared_room_family_booking(uuid,text,boolean,jsonb,uuid,boolean,uuid)'::regprocedure
        and prosecdef
        and array_to_string(proconfig, ',') like '%search_path=public, pg_temp%'
    ) as facade_security_ok,
    has_function_privilege('authenticated',
      'public.create_unassigned_shared_room_family_booking(uuid,text,boolean,jsonb,uuid,boolean,uuid)', 'EXECUTE')
      and has_function_privilege('service_role',
      'public.create_unassigned_shared_room_family_booking(uuid,text,boolean,jsonb,uuid,boolean,uuid)', 'EXECUTE')
      and not has_function_privilege('anon',
      'public.create_unassigned_shared_room_family_booking(uuid,text,boolean,jsonb,uuid,boolean,uuid)', 'EXECUTE')
      and not exists (
        select 1
        from pg_proc procedure,
          lateral aclexplode(coalesce(
            procedure.proacl,
            acldefault('f', procedure.proowner)
          )) privilege
        where procedure.oid =
          'public.create_unassigned_shared_room_family_booking(uuid,text,boolean,jsonb,uuid,boolean,uuid)'::regprocedure
          and privilege.grantee = 0
          and privilege.privilege_type = 'EXECUTE'
      )
      as acl_ok,
    not exists (
      select 1
      from public.family_shared_room_groups shared_group
      where shared_group.archived_at is null
        and shared_group.status = 'requested'
        and (
          (select count(*) from public.hotel_capacity_reservations capacity
           where capacity.shared_room_group_id = shared_group.id
             and capacity.source_kind = 'shared_group'
             and capacity.quantity = 1 and capacity.archived_at is null) <> 1
          or exists (
            select 1 from public.hotel_capacity_reservations capacity
            where capacity.archived_at is null and exists (
              select 1 from public.family_booking_members member
              where member.shared_room_group_id = shared_group.id
                and member.hotel_stay_id = capacity.hotel_stay_id
                and member.archived_at is null
            )
          )
          or exists (
            select 1 from public.hotel_physical_occupancies occupancy
            where occupancy.shared_room_group_id = shared_group.id
              and occupancy.archived_at is null
          )
        )
    ) as data_invariant_ok,
    to_regprocedure('public.create_family_booking(uuid,text,boolean,jsonb,uuid)') is not null
      and to_regprocedure('public.create_flexible_hotel_reservation(uuid,uuid,date,time without time zone,boolean,date,time without time zone,boolean,uuid,uuid,uuid,uuid[],text,uuid)') is not null
      and to_regprocedure('public.create_shared_room_family_booking(uuid,text,boolean,jsonb,uuid,uuid,boolean,uuid)') is not null
      and to_regprocedure('public.merge_existing_hotel_stays_into_shared_room(uuid[],integer[],boolean,uuid)') is not null
      and to_regprocedure('public.create_shared_hotel_room_occupancy(uuid,uuid,uuid)') is not null
      and to_regprocedure('public.assign_hotel_room(uuid,integer,uuid,text,uuid)') is not null
      and to_regprocedure('public.join_shared_hotel_room_occupancy(uuid,uuid,integer,uuid)') is not null
      and to_regprocedure('public.complete_shared_hotel_check_in(uuid,uuid,integer,integer,timestamp with time zone,uuid)') is not null
      and to_regprocedure('public.complete_shared_hotel_member_check_out(uuid,uuid,integer,integer,timestamp with time zone,uuid)') is not null
      and to_regprocedure('public.reverse_shared_hotel_member_completion(uuid,uuid,integer,integer,text,uuid)') is not null
      and to_regprocedure('public.move_shared_hotel_room_occupancy(uuid,uuid,integer,text,uuid)') is not null
      as legacy_signatures_ok
  from source
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
      where archived_at is null and source_kind in ('shared_group','shared_occupancy')
        and quantity <> 1)::bigint as invalid_quantity_count,
    (select count(*)
      from public.hotel_capacity_reservations capacity
      left join public.family_shared_room_groups shared_group
        on shared_group.id = capacity.shared_room_group_id
       and shared_group.archived_at is null
      left join public.hotel_physical_occupancies occupancy
        on occupancy.id = capacity.physical_occupancy_id
       and occupancy.archived_at is null
      where capacity.archived_at is null
        and (
          capacity.source_kind = 'shared_group' and shared_group.id is null
          or capacity.source_kind = 'shared_occupancy' and occupancy.id is null
        ))::bigint as orphan_capacity_count,
    (select count(*) from (
      select coalesce(shared_room_group_id, physical_occupancy_id) owner_id
      from public.hotel_capacity_reservations
      where archived_at is null
        and source_kind in ('shared_group','shared_occupancy')
      group by coalesce(shared_room_group_id, physical_occupancy_id)
      having count(*) > 1
    ) duplicate)::bigint as duplicate_active_capacity_count,
    (select count(*)
      from public.hotel_capacity_reservations capacity
      join public.hotel_room_types room_type
        on room_type.id = capacity.room_type_id
      where capacity.archived_at is null
        and capacity.source_kind in ('shared_group','shared_occupancy')
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
  select checks.*, data_counts.*,
    owner_column_ok and owner_fk_ok and source_kind_ok
    and unique_active_ok and deferred_invariants_ok
    and facade_contract_ok and transition_contract_ok and lock_order_ok
    and edit_guard_ok and facade_security_ok and acl_ok and data_invariant_ok
    and legacy_signatures_ok
    and invalid_quantity_count = 0
    and orphan_capacity_count = 0
    and duplicate_active_capacity_count = 0
    and non_deluxe_shared_count = 0
    and cross_customer_member_count = 0
    and invalid_allocation_count = 0 as all_ok
  from checks cross join data_counts
)
select
  case when all_ok then
    'HOTEL_UNASSIGNED_SHARED_ROOM_BACKEND_APPEND_POSTFLIGHT_PASS'
  else 'HOTEL_UNASSIGNED_SHARED_ROOM_BACKEND_APPEND_POSTFLIGHT_FAIL' end verdict,
  case when owner_column_ok then 'PASS' else 'FAIL' end owner_column,
  case when owner_fk_ok then 'PASS' else 'FAIL' end owner_fk,
  case when source_kind_ok then 'PASS' else 'FAIL' end source_kind,
  case when unique_active_ok then 'PASS' else 'FAIL' end unique_active_capacity,
  case when deferred_invariants_ok then 'PASS' else 'FAIL' end deferred_invariants,
  case when facade_contract_ok then 'PASS' else 'FAIL' end facade_contract,
  case when transition_contract_ok then 'PASS' else 'FAIL' end transition_contract,
  case when lock_order_ok then 'PASS' else 'FAIL' end lock_order,
  case when edit_guard_ok then 'PASS' else 'FAIL' end edit_guard,
  case when facade_security_ok then 'PASS' else 'FAIL' end security_definer_search_path,
  case when acl_ok then 'PASS' else 'FAIL' end acl,
  case when data_invariant_ok then 'PASS' else 'FAIL' end data_invariant,
  case when legacy_signatures_ok then 'PASS' else 'FAIL' end legacy_signatures,
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
  'COMPARE_WITH_PREFLIGHT'::text baseline_count_contract
from result;

rollback;
