-- Production preflight for atomic check-in reversal and room unassignment. Read-only.
begin transaction read only;

with catalog as (
  select
    to_regprocedure('public.reverse_hotel_completion(uuid,integer,text,text,uuid)') is not null
      and to_regprocedure('public.unassign_hotel_room_before_check_in(uuid,integer,text,uuid)') is not null
      and to_regprocedure('public.reverse_shared_hotel_member_check_in(uuid,uuid,integer,integer,text,uuid)') is not null
      and to_regprocedure('public.unassign_shared_hotel_room_before_check_in(uuid,integer,text,uuid)') is not null
      and to_regprocedure('public.hotel_stay_json(uuid)') is not null
      and to_regclass('public.hotel_stays') is not null
      and to_regclass('public.hotel_room_allocations') is not null
      and to_regclass('public.hotel_capacity_reservations') is not null
      and to_regclass('public.hotel_physical_occupancies') is not null
      and to_regclass('public.hotel_physical_occupancy_members') is not null
      and to_regclass('public.hotel_physical_occupancy_requests') is not null
      and to_regclass('public.family_booking_members') is not null as required_contracts_ok,
    to_regclass('public.hotel_atomic_reverse_unassign_requests') is null
      and to_regprocedure('public.hotel_atomic_child_request_id_internal(uuid,text)') is null
      and to_regprocedure('public.reverse_check_in_and_unassign_hotel_room(uuid,integer,text,uuid)') is null
      and to_regprocedure('public.reverse_check_in_and_unassign_shared_hotel_room(uuid,integer,text,uuid)') is null
      as append_objects_absent
), operation_kinds as (
  select coalesce(array_agg(kind_match[1] order by kind_match[1]) = array[
    'cancel_booking','check_in','check_out','create','join','merge_existing_stays',
    'move','reverse_check_in','reverse_completion','unassign'
  ]::text[], false) as exact_operation_kinds_ok
  from pg_constraint constraint_row
  left join lateral regexp_matches(
    pg_get_constraintdef(constraint_row.oid), '''([^'']+)''', 'g'
  ) kind_match on true
  where constraint_row.conrelid = 'public.hotel_physical_occupancy_requests'::regclass
    and constraint_row.conname = 'hotel_physical_occupancy_requests_operation_kind_check'
), data_contract as (
  select
    (select count(*) from public.hotel_room_allocations allocation
      join public.hotel_capacity_reservations capacity on capacity.id = allocation.capacity_reservation_id
      where capacity.source_kind = 'stay'
        and capacity.hotel_stay_id is not null
        and allocation.archived_at is null
        and (
          allocation.room_id is null
          or (
            allocation.allocated_from <= transaction_timestamp()
            and allocation.allocated_until > transaction_timestamp()
            and (
              capacity.archived_at is not null
              or capacity.quantity <> 1
              or capacity.reserved_from > transaction_timestamp()
              or capacity.reserved_until <= transaction_timestamp()
            )
          )
          or (
            capacity.archived_at is not null
            and not exists (
              select 1
              from public.long_stay_absence_events leave_event
              join public.hotel_capacity_reservations return_capacity
                on return_capacity.id = leave_event.return_capacity_id
              join public.hotel_rooms released_room
                on released_room.id = allocation.room_id
              where leave_event.event_type = 'leave'
                and leave_event.inventory_mode = 'release_room'
                and leave_event.inventory_transition_status in ('room_released', 'room_returned')
                and leave_event.hotel_stay_id = capacity.hotel_stay_id
                and leave_event.released_allocation_id = allocation.id
                and leave_event.released_capacity_id = capacity.id
                and leave_event.occurred_at <= allocation.allocated_until
                and allocation.allocated_until <= leave_event.guarantee_from
                and allocation.allocated_until = capacity.reserved_until
                and allocation.allocated_until <> 'infinity'::timestamptz
                and capacity.quantity = 1
                and capacity.archive_reason = 'long_stay_outing_inventory_segment_closed'
                and released_room.room_type_id = capacity.room_type_id
                and return_capacity.source_kind = 'stay'
                and return_capacity.hotel_stay_id = capacity.hotel_stay_id
                and return_capacity.room_type_id = capacity.room_type_id
                and return_capacity.quantity = 1
            )
          )
        )) as invalid_active_single_allocation_count,
    (select count(*) from public.hotel_physical_occupancies occupancy
      join public.family_shared_room_groups room_group on room_group.id = occupancy.shared_room_group_id
      join public.hotel_capacity_reservations capacity on capacity.id = occupancy.capacity_reservation_id
      join public.hotel_room_allocations allocation on allocation.id = occupancy.room_allocation_id
      join public.hotel_rooms room on room.id = occupancy.room_id
      join public.hotel_room_types room_type on room_type.id = room.room_type_id
      where occupancy.archived_at is null and occupancy.status = 'active'
        and (room_group.archived_at is not null or room_group.status <> 'allocated'
          or capacity.archived_at is not null or capacity.source_kind <> 'shared_occupancy'
          or capacity.physical_occupancy_id is distinct from occupancy.id or capacity.quantity <> 1
          or allocation.archived_at is not null
          or allocation.capacity_reservation_id is distinct from capacity.id
          or allocation.room_id is distinct from occupancy.room_id
          or upper(btrim(room_type.code)) <> 'DELUXE')) as invalid_shared_allocation_count,
    (select count(*) from public.hotel_physical_occupancy_members physical_member
      join public.hotel_physical_occupancies occupancy on occupancy.id = physical_member.occupancy_id
      join public.family_booking_members family_member on family_member.id = physical_member.family_booking_member_id
      join public.hotel_stays stay on stay.id = physical_member.hotel_stay_id
      join public.dogs dog on dog.id = stay.dog_id
      where physical_member.archived_at is null and physical_member.status = 'active'
        and (occupancy.archived_at is not null or occupancy.status <> 'active'
          or family_member.archived_at is not null
          or family_member.shared_room_group_id is distinct from occupancy.shared_room_group_id
          or family_member.hotel_stay_id is distinct from stay.id
          or family_member.dog_id is distinct from stay.dog_id
          or physical_member.dog_id is distinct from stay.dog_id
          or dog.customer_id is distinct from occupancy.customer_id)) as invalid_shared_member_count
), result as (
  select * from catalog cross join operation_kinds cross join data_contract
)
select
  case when required_contracts_ok and append_objects_absent and exact_operation_kinds_ok
    and invalid_active_single_allocation_count = 0
    and invalid_shared_allocation_count = 0
    and invalid_shared_member_count = 0
  then 'HOTEL_ATOMIC_REVERSE_UNASSIGN_PREFLIGHT_PASS'
  else 'HOTEL_ATOMIC_REVERSE_UNASSIGN_PREFLIGHT_FAIL' end verdict,
  case when required_contracts_ok then 'PASS' else 'FAIL' end required_contracts,
  case when append_objects_absent then 'PASS' else 'FAIL' end append_objects_absent,
  case when exact_operation_kinds_ok then 'PASS' else 'FAIL' end operation_kinds_unchanged,
  invalid_active_single_allocation_count,
  invalid_shared_allocation_count,
  invalid_shared_member_count,
  'INFORMATIONAL_ONLY'::text as business_counts
from result;

rollback;
