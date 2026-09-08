-- Production preflight for Shared Room member check-in reversal. Read-only.
begin transaction read only;

with catalog as (
  select
    to_regprocedure('public.reverse_hotel_completion(uuid,integer,text,text,uuid)') is not null
      and to_regprocedure('public.complete_shared_hotel_check_in(uuid,uuid,integer,integer,timestamp with time zone,uuid)') is not null
      and to_regprocedure('public.unassign_shared_hotel_room_before_check_in(uuid,integer,text,uuid)') is not null
      and to_regprocedure('public.claim_shared_hotel_request_internal(uuid,text,jsonb,uuid)') is not null
      and to_regprocedure('public.finish_shared_hotel_request_internal(uuid,uuid,jsonb)') is not null
      and to_regprocedure('public.shared_hotel_occupancy_json_internal(uuid)') is not null
      and to_regprocedure('public.hotel_stay_json(uuid)') is not null as required_contracts_ok,
    to_regprocedure('public.reverse_shared_hotel_member_check_in(uuid,uuid,integer,integer,text,uuid)') is null
      as append_rpc_absent
), request_contract as (
  select coalesce(array_agg(kind_match[1] order by kind_match[1]) = array[
    'cancel_booking','check_in','check_out','create','join','merge_existing_stays',
    'move','reverse_completion','unassign'
  ]::text[], false) as exact_old_operation_kinds_ok
  from pg_constraint constraint_row
  left join lateral regexp_matches(
    pg_get_constraintdef(constraint_row.oid), '''([^'']+)''', 'g'
  ) kind_match on true
  where constraint_row.conrelid = 'public.hotel_physical_occupancy_requests'::regclass
    and constraint_row.conname = 'hotel_physical_occupancy_requests_operation_kind_check'
), data_contract as (
  select
    (select count(*) from public.hotel_physical_occupancies occupancy
      join public.family_shared_room_groups room_group on room_group.id = occupancy.shared_room_group_id
      join public.family_bookings family on family.id = occupancy.family_booking_id
      where occupancy.archived_at is null and occupancy.status = 'active'
        and (room_group.archived_at is not null or room_group.status <> 'allocated'
          or room_group.family_booking_id is distinct from family.id
          or family.archived_at is not null or family.status <> 'active'
          or family.customer_id is distinct from occupancy.customer_id)) as invalid_active_occupancy_count,
    (select count(*) from public.hotel_physical_occupancy_members physical_member
      join public.hotel_physical_occupancies occupancy on occupancy.id = physical_member.occupancy_id
      join public.family_booking_members family_member on family_member.id = physical_member.family_booking_member_id
      join public.hotel_stays stay on stay.id = physical_member.hotel_stay_id
      where physical_member.archived_at is null and physical_member.status = 'active'
        and (occupancy.archived_at is not null or occupancy.status <> 'active'
          or family_member.archived_at is not null
          or family_member.hotel_stay_id is distinct from stay.id
          or family_member.dog_id is distinct from stay.dog_id
          or physical_member.dog_id is distinct from stay.dog_id)) as invalid_active_member_count,
    (select count(*) from public.hotel_physical_occupancies occupancy
      join public.hotel_capacity_reservations capacity on capacity.id = occupancy.capacity_reservation_id
      join public.hotel_room_allocations allocation on allocation.id = occupancy.room_allocation_id
      join public.hotel_rooms room on room.id = occupancy.room_id
      join public.hotel_room_types room_type on room_type.id = room.room_type_id
      where occupancy.archived_at is null and occupancy.status = 'active'
        and (capacity.archived_at is not null or capacity.source_kind <> 'shared_occupancy'
          or capacity.physical_occupancy_id is distinct from occupancy.id or capacity.quantity <> 1
          or allocation.archived_at is not null
          or allocation.capacity_reservation_id is distinct from capacity.id
          or allocation.room_id is distinct from occupancy.room_id
          or upper(btrim(room_type.code)) <> 'DELUXE')) as invalid_capacity_allocation_count,
    (select count(*) from public.family_booking_members family_member
      join public.family_bookings family on family.id = family_member.family_booking_id
      join public.dogs dog on dog.id = family_member.dog_id
      where family_member.archived_at is null and family_member.shared_room_group_id is not null
        and dog.customer_id is distinct from family.customer_id) as cross_customer_member_count
), result as (
  select * from catalog cross join request_contract cross join data_contract
)
select
  case when required_contracts_ok and append_rpc_absent and exact_old_operation_kinds_ok
    and invalid_active_occupancy_count = 0 and invalid_active_member_count = 0
    and invalid_capacity_allocation_count = 0 and cross_customer_member_count = 0
  then 'HOTEL_SHARED_ROOM_MEMBER_CHECKIN_REVERSAL_PREFLIGHT_PASS'
  else 'HOTEL_SHARED_ROOM_MEMBER_CHECKIN_REVERSAL_PREFLIGHT_FAIL' end verdict,
  case when required_contracts_ok then 'PASS' else 'FAIL' end required_contracts,
  case when append_rpc_absent then 'PASS' else 'FAIL' end append_rpc_absent,
  case when exact_old_operation_kinds_ok then 'PASS' else 'FAIL' end request_operation_kinds,
  invalid_active_occupancy_count,
  invalid_active_member_count,
  invalid_capacity_allocation_count,
  cross_customer_member_count,
  'INFORMATIONAL_ONLY'::text as business_counts
from result;

rollback;
