-- Production preflight. Read-only; no schema or business-row mutation.
begin transaction read only;

with catalog as (
  select
    to_regclass('public.family_bookings') is not null
      and to_regclass('public.family_booking_members') is not null
      and to_regclass('public.family_shared_room_groups') is not null
      and to_regclass('public.hotel_stays') is not null
      and to_regclass('public.hotel_stay_schedule_events') is not null
      and to_regclass('public.hotel_capacity_reservations') is not null
      and to_regclass('public.hotel_physical_occupancies') is not null
      and to_regclass('public.hotel_physical_occupancy_members') is not null
      and to_regclass('public.hotel_physical_occupancy_requests') is not null
      and to_regclass('public.hotel_room_allocations') is not null as required_tables_ok,
    to_regprocedure('public.claim_shared_hotel_request_internal(uuid,text,jsonb,uuid)') is not null
      and to_regprocedure('public.finish_shared_hotel_request_internal(uuid,uuid,jsonb)') is not null
      and to_regprocedure('public.family_booking_derived_status(uuid)') is not null
      and to_regprocedure('public.set_operation_schedule_status(uuid,integer,text,text,uuid)') is not null
      as required_helpers_ok,
    to_regprocedure('public.unassign_shared_hotel_room_before_check_in(uuid,integer,text,uuid)') is null
      and to_regprocedure('public.cancel_shared_hotel_room_family_booking(uuid,integer,text,uuid)') is null
      and to_regclass('public.hotel_physical_occupancies_active_shared_room_group_uidx') is null
      as append_objects_absent
    ,to_regprocedure('public.create_flexible_hotel_reservation(uuid,uuid,date,time without time zone,boolean,date,time without time zone,boolean,uuid,uuid,uuid,uuid[],text,uuid)') is not null
      and to_regprocedure('public.create_family_booking(uuid,text,boolean,jsonb,uuid)') is not null
      and to_regprocedure('public.create_shared_room_family_booking(uuid,text,boolean,jsonb,uuid,uuid,boolean,uuid)') is not null
      and to_regprocedure('public.create_unassigned_shared_room_family_booking(uuid,text,boolean,jsonb,uuid,boolean,uuid)') is not null
      and to_regprocedure('public.create_shared_hotel_room_occupancy(uuid,uuid,uuid)') is not null
      and to_regprocedure('public.move_shared_hotel_room_occupancy(uuid,uuid,integer,text,uuid)') is not null
      and to_regprocedure('public.join_shared_hotel_room_occupancy(uuid,uuid,integer,uuid)') is not null
      and to_regprocedure('public.complete_shared_hotel_check_in(uuid,uuid,integer,integer,timestamp with time zone,uuid)') is not null
      and to_regprocedure('public.complete_shared_hotel_member_check_out(uuid,uuid,integer,integer,timestamp with time zone,uuid)') is not null
      and to_regprocedure('public.reverse_shared_hotel_member_completion(uuid,uuid,integer,integer,text,uuid)') is not null
      as baseline_rpc_signatures_ok
), column_contract as (
  select count(*) = 1 as shared_group_column_ok
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'hotel_physical_occupancies'
    and column_name = 'shared_room_group_id'
    and is_nullable = 'NO'
    and udt_name = 'uuid'
), constraint_contract as (
  select
    count(*) filter (
      where constraint_row.conname = 'hotel_physical_occupancies_shared_room_group_id_key'
        and pg_get_constraintdef(constraint_row.oid) = 'UNIQUE (shared_room_group_id)'
    ) = 1 as current_unique_ok,
    count(*) filter (
      where constraint_row.contype = 'f'
        and pg_get_constraintdef(constraint_row.oid) =
          'FOREIGN KEY (shared_room_group_id) REFERENCES family_shared_room_groups(id) ON DELETE RESTRICT'
    ) = 1 as shared_group_fk_ok
  from pg_constraint constraint_row
  where constraint_row.conrelid = 'public.hotel_physical_occupancies'::regclass
), request_contract as (
  select
    count(distinct constraint_row.oid) = 1 as request_constraint_name_ok,
    coalesce(array_agg(kind_match[1] order by kind_match[1]) = array[
      'check_in','check_out','create','join','merge_existing_stays','move','reverse_completion'
    ]::text[], false) as exact_old_operation_kinds_ok
  from pg_constraint constraint_row
  left join lateral regexp_matches(
    pg_get_constraintdef(constraint_row.oid),
    '''([^'']+)''',
    'g'
  ) kind_match on true
  where constraint_row.conrelid = 'public.hotel_physical_occupancy_requests'::regclass
    and constraint_row.conname = 'hotel_physical_occupancy_requests_operation_kind_check'
), data_checks as (
  select
    (select count(*) from (
      select occupancy.shared_room_group_id
      from public.hotel_physical_occupancies occupancy
      where occupancy.archived_at is null
      group by occupancy.shared_room_group_id having count(*) > 1
    ) duplicate_group) as duplicate_active_occupancy_count,
    (select count(*) from public.hotel_physical_occupancies occupancy
      left join public.family_shared_room_groups room_group on room_group.id = occupancy.shared_room_group_id
      where occupancy.archived_at is null
        and (
          room_group.id is null
          or room_group.archived_at is not null
          or (occupancy.status, room_group.status) not in (
            ('active', 'allocated'),
            ('completed', 'released')
          )
        ))
      as invalid_occupancy_group_lifecycle_count,
    (select count(*) from public.family_shared_room_groups room_group
      where room_group.archived_at is null and room_group.status = 'allocated'
        and not exists (select 1 from public.hotel_physical_occupancies occupancy
          where occupancy.shared_room_group_id = room_group.id
            and occupancy.archived_at is null
            and occupancy.status = 'active'))
      as allocated_group_without_current_occupancy_count,
    (select count(*) from public.hotel_physical_occupancy_members member
      left join public.hotel_physical_occupancies occupancy on occupancy.id = member.occupancy_id
      left join public.family_booking_members family_member on family_member.id = member.family_booking_member_id
      where member.archived_at is null and (
        occupancy.id is null or occupancy.archived_at is not null
        or family_member.id is null or family_member.archived_at is not null
        or family_member.hotel_stay_id is distinct from member.hotel_stay_id
        or family_member.dog_id is distinct from member.dog_id))
      as invalid_physical_member_count,
    (select count(*) from public.hotel_physical_occupancies occupancy
      left join public.hotel_capacity_reservations capacity on capacity.id = occupancy.capacity_reservation_id
      left join public.hotel_room_allocations allocation on allocation.id = occupancy.room_allocation_id
      left join public.hotel_room_types room_type on room_type.id = occupancy.room_type_id
      where occupancy.archived_at is null and (
        capacity.id is null or capacity.archived_at is not null or capacity.quantity <> 1
        or capacity.source_kind <> 'shared_occupancy'
        or capacity.physical_occupancy_id is distinct from occupancy.id
        or allocation.id is null or allocation.archived_at is not null
        or allocation.capacity_reservation_id is distinct from capacity.id
        or allocation.room_id is distinct from occupancy.room_id
        or upper(btrim(room_type.code)) <> 'DELUXE'))
      as invalid_active_relation_count,
    (select count(*) from public.family_booking_members member
      join public.family_bookings booking on booking.id = member.family_booking_id
      join public.dogs dog on dog.id = member.dog_id
      where member.archived_at is null and member.shared_room_group_id is not null
        and dog.customer_id is distinct from booking.customer_id)
      as cross_customer_member_count,
    (select count(*) from (
      select capacity.source_kind,
        case when capacity.source_kind = 'shared_group'
          then capacity.shared_room_group_id else capacity.physical_occupancy_id end owner_id
      from public.hotel_capacity_reservations capacity
      where capacity.archived_at is null
        and capacity.source_kind in ('shared_group', 'shared_occupancy')
      group by capacity.source_kind,
        case when capacity.source_kind = 'shared_group'
          then capacity.shared_room_group_id else capacity.physical_occupancy_id end
      having count(*) > 1
    ) duplicate_capacity) as duplicate_active_shared_capacity_count,
    (select count(*) from public.hotel_physical_occupancies occupancy
      left join public.family_bookings booking on booking.id = occupancy.family_booking_id
      left join public.family_shared_room_groups room_group
        on room_group.id = occupancy.shared_room_group_id
      where occupancy.archived_at is null and (
        booking.id is null or booking.archived_at is not null
        or room_group.id is null
        or room_group.family_booking_id is distinct from occupancy.family_booking_id
        or booking.customer_id is distinct from occupancy.customer_id
      )) as orphan_active_occupancy_count,
    (select count(*) from public.hotel_physical_occupancies) as historical_occupancy_count,
    (select count(*) from public.hotel_physical_occupancies where archived_at is not null) as archived_occupancy_count,
    (select count(*) from public.family_shared_room_groups where archived_at is null and status = 'requested') as requested_group_count,
    (select count(*) from public.family_shared_room_groups where archived_at is null and status = 'allocated') as allocated_group_count
), result as (
  select * from catalog cross join column_contract cross join constraint_contract cross join request_contract cross join data_checks
)
select
  case when required_tables_ok and required_helpers_ok and append_objects_absent and baseline_rpc_signatures_ok
    and shared_group_column_ok and current_unique_ok and shared_group_fk_ok
    and request_constraint_name_ok and exact_old_operation_kinds_ok
    and duplicate_active_occupancy_count = 0
    and invalid_occupancy_group_lifecycle_count = 0
    and allocated_group_without_current_occupancy_count = 0
    and invalid_physical_member_count = 0
    and invalid_active_relation_count = 0
    and cross_customer_member_count = 0
    and duplicate_active_shared_capacity_count = 0
    and orphan_active_occupancy_count = 0
  then 'HOTEL_SHARED_ROOM_REVERSAL_CANCELLATION_PREFLIGHT_PASS'
  else 'HOTEL_SHARED_ROOM_REVERSAL_CANCELLATION_PREFLIGHT_FAIL' end verdict,
  case when required_tables_ok then 'PASS' else 'FAIL' end required_tables,
  case when required_helpers_ok then 'PASS' else 'FAIL' end required_helpers,
  case when append_objects_absent then 'PASS' else 'FAIL' end append_objects_absent,
  case when baseline_rpc_signatures_ok then 'PASS' else 'FAIL' end baseline_rpc_signatures,
  case when current_unique_ok then 'PASS' else 'FAIL' end exact_current_unique,
  case when request_constraint_name_ok and exact_old_operation_kinds_ok then 'PASS' else 'FAIL' end exact_old_request_operation_kinds,
  case when shared_group_column_ok and shared_group_fk_ok then 'PASS' else 'FAIL' end shared_group_column_fk,
  duplicate_active_occupancy_count,
  invalid_occupancy_group_lifecycle_count,
  allocated_group_without_current_occupancy_count,
  invalid_physical_member_count,
  invalid_active_relation_count,
  cross_customer_member_count,
  duplicate_active_shared_capacity_count,
  orphan_active_occupancy_count,
  historical_occupancy_count,
  archived_occupancy_count,
  requested_group_count,
  allocated_group_count,
  'INFORMATIONAL_ONLY'::text as business_counts
from result;

rollback;
