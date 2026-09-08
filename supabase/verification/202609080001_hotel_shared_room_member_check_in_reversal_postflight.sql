-- Production postflight for Shared Room member check-in reversal. Read-only.
begin transaction read only;

with function_source as (
  select regexp_replace(
    lower(pg_get_functiondef(
      'public.reverse_shared_hotel_member_check_in(uuid,uuid,integer,integer,text,uuid)'::regprocedure
    )),
    '[[:space:]]+',
    ' ',
    'g'
  ) as source
), function_contract as (
  select
    to_regprocedure('public.reverse_shared_hotel_member_check_in(uuid,uuid,integer,integer,text,uuid)') is not null as signature_ok,
    coalesce((select prosecdef and proconfig @> array['search_path=public, pg_temp']
      from pg_proc
      where oid = 'public.reverse_shared_hotel_member_check_in(uuid,uuid,integer,integer,text,uuid)'::regprocedure), false)
      as security_ok,
    has_function_privilege('authenticated', 'public.reverse_shared_hotel_member_check_in(uuid,uuid,integer,integer,text,uuid)', 'EXECUTE')
      and has_function_privilege('service_role', 'public.reverse_shared_hotel_member_check_in(uuid,uuid,integer,integer,text,uuid)', 'EXECUTE')
      and not has_function_privilege('anon', 'public.reverse_shared_hotel_member_check_in(uuid,uuid,integer,integer,text,uuid)', 'EXECUTE')
      and not exists (
        select 1 from aclexplode(coalesce(
          (select proacl from pg_proc where oid = 'public.reverse_shared_hotel_member_check_in(uuid,uuid,integer,integer,text,uuid)'::regprocedure),
          acldefault('f', (select proowner from pg_proc where oid = 'public.reverse_shared_hotel_member_check_in(uuid,uuid,integer,integer,text,uuid)'::regprocedure))
        )) acl where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
      ) as acl_ok,
    source like '%has_operation_role(%'
      and source like '%''owner''%'
      and source like '%''manager''%'
      and source like '%claim_shared_hotel_request_internal%'
      and source like '%''reverse_check_in''%'
      and source like '%finish_shared_hotel_request_internal%'
      and source like '%occupancy.status <> ''active''%'
      and source like '%shared_group.status <> ''allocated''%'
      and source like '%stay.checked_in_at is null%'
      and source like '%stay.checked_out_at is not null%'
      and source like '%physical_member.status <> ''active''%'
      and source like '%family_member.status <> ''checked_in''%'
      and source like '%set checked_in_at = null%'
      and source like '%set status = ''confirmed''%'
      and source like '%source_kind <> ''shared_occupancy''%'
      and source like '%capacity.quantity <> 1%'
      and source like '%upper(btrim(room_type.code)) = ''deluxe''%'
      and source not like '%delete from public.%'
      as semantic_contract_ok
  from function_source
), request_contract as (
  select coalesce(array_agg(kind_match[1] order by kind_match[1]) = array[
    'cancel_booking','check_in','check_out','create','join','merge_existing_stays',
    'move','reverse_check_in','reverse_completion','unassign'
  ]::text[], false) as exact_new_operation_kinds_ok
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
        and dog.customer_id is distinct from family.customer_id) as cross_customer_member_count,
    (select count(*) from public.hotel_physical_occupancies) as physical_occupancy_count,
    (select count(*) from public.hotel_physical_occupancy_members) as physical_member_count
), result as (
  select * from function_contract cross join request_contract cross join data_contract
)
select
  case when signature_ok and security_ok and acl_ok and semantic_contract_ok
    and exact_new_operation_kinds_ok and invalid_active_occupancy_count = 0
    and invalid_active_member_count = 0 and invalid_capacity_allocation_count = 0
    and cross_customer_member_count = 0
  then 'HOTEL_SHARED_ROOM_MEMBER_CHECKIN_REVERSAL_POSTFLIGHT_PASS'
  else 'HOTEL_SHARED_ROOM_MEMBER_CHECKIN_REVERSAL_POSTFLIGHT_FAIL' end verdict,
  case when signature_ok then 'PASS' else 'FAIL' end rpc_signature,
  case when security_ok then 'PASS' else 'FAIL' end security_definer_search_path,
  case when acl_ok then 'PASS' else 'FAIL' end acl,
  case when semantic_contract_ok then 'PASS' else 'FAIL' end semantic_contract,
  case when exact_new_operation_kinds_ok then 'PASS' else 'FAIL' end request_operation_kinds,
  invalid_active_occupancy_count,
  invalid_active_member_count,
  invalid_capacity_allocation_count,
  cross_customer_member_count,
  physical_occupancy_count,
  physical_member_count,
  'INFORMATIONAL_ONLY'::text as business_counts
from result;

rollback;
