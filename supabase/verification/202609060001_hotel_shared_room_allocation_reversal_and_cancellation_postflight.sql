-- Production postflight. Read-only; business counts are informational only.
begin transaction read only;

with function_contract as (
  select
    to_regprocedure('public.unassign_shared_hotel_room_before_check_in(uuid,integer,text,uuid)') is not null
      and to_regprocedure('public.cancel_shared_hotel_room_family_booking(uuid,integer,text,uuid)') is not null
      as signatures_ok,
    coalesce((select prosecdef and proconfig @> array['search_path=public, pg_temp']
      from pg_proc where oid = 'public.unassign_shared_hotel_room_before_check_in(uuid,integer,text,uuid)'::regprocedure), false)
      and coalesce((select prosecdef and proconfig @> array['search_path=public, pg_temp']
      from pg_proc where oid = 'public.cancel_shared_hotel_room_family_booking(uuid,integer,text,uuid)'::regprocedure), false)
      as security_ok,
    has_function_privilege('authenticated', 'public.unassign_shared_hotel_room_before_check_in(uuid,integer,text,uuid)', 'EXECUTE')
      and has_function_privilege('service_role', 'public.unassign_shared_hotel_room_before_check_in(uuid,integer,text,uuid)', 'EXECUTE')
      and not has_function_privilege('anon', 'public.unassign_shared_hotel_room_before_check_in(uuid,integer,text,uuid)', 'EXECUTE')
      and not exists (
        select 1
        from aclexplode(coalesce(
          (select proacl from pg_proc where oid = 'public.unassign_shared_hotel_room_before_check_in(uuid,integer,text,uuid)'::regprocedure),
          acldefault('f', (select proowner from pg_proc where oid = 'public.unassign_shared_hotel_room_before_check_in(uuid,integer,text,uuid)'::regprocedure))
        )) acl
        where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
      )
      and has_function_privilege('authenticated', 'public.cancel_shared_hotel_room_family_booking(uuid,integer,text,uuid)', 'EXECUTE')
      and has_function_privilege('service_role', 'public.cancel_shared_hotel_room_family_booking(uuid,integer,text,uuid)', 'EXECUTE')
      and not has_function_privilege('anon', 'public.cancel_shared_hotel_room_family_booking(uuid,integer,text,uuid)', 'EXECUTE')
      and not exists (
        select 1
        from aclexplode(coalesce(
          (select proacl from pg_proc where oid = 'public.cancel_shared_hotel_room_family_booking(uuid,integer,text,uuid)'::regprocedure),
          acldefault('f', (select proowner from pg_proc where oid = 'public.cancel_shared_hotel_room_family_booking(uuid,integer,text,uuid)'::regprocedure))
        )) acl
        where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
      )
      as acl_ok,
    lower(pg_get_functiondef('public.unassign_shared_hotel_room_before_check_in(uuid,integer,text,uuid)'::regprocedure))
      like '%claim_shared_hotel_request_internal%''unassign''%finish_shared_hotel_request_internal%'
      and lower(pg_get_functiondef('public.cancel_shared_hotel_room_family_booking(uuid,integer,text,uuid)'::regprocedure))
      like '%claim_shared_hotel_request_internal%''cancel_booking''%finish_shared_hotel_request_internal%'
      as idempotency_ok
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
), schema_contract as (
  select
    not exists (select 1 from pg_constraint where conrelid = 'public.hotel_physical_occupancies'::regclass
      and conname = 'hotel_physical_occupancies_shared_room_group_id_key') as old_unique_removed,
    exists (
      select 1
      from pg_index index_meta
      join pg_class index_relation on index_relation.oid = index_meta.indexrelid
      join pg_class table_relation on table_relation.oid = index_meta.indrelid
      join pg_namespace table_namespace on table_namespace.oid = table_relation.relnamespace
      where table_namespace.nspname = 'public'
        and table_relation.relname = 'hotel_physical_occupancies'
        and index_relation.relname = 'hotel_physical_occupancies_active_shared_room_group_uidx'
        and index_meta.indisunique
        and index_meta.indisvalid
        and index_meta.indisready
        and pg_get_indexdef(index_meta.indexrelid) like '%(shared_room_group_id)%'
        and regexp_replace(
          lower(pg_get_expr(index_meta.indpred, index_meta.indrelid)),
          '[[:space:]()]',
          '',
          'g'
        ) = 'archived_atisnull'
    )
      as active_only_unique_ok,
    exists (select 1 from information_schema.columns where table_schema = 'public'
      and table_name = 'hotel_physical_occupancies' and column_name = 'shared_room_group_id'
      and is_nullable = 'NO' and udt_name = 'uuid') as column_preserved,
    exists (select 1 from pg_constraint where conrelid = 'public.hotel_physical_occupancies'::regclass
      and contype = 'f' and pg_get_constraintdef(oid) =
        'FOREIGN KEY (shared_room_group_id) REFERENCES family_shared_room_groups(id) ON DELETE RESTRICT')
      as fk_preserved,
    (select count(*) = 1 from pg_constraint where conrelid = 'public.hotel_physical_occupancy_requests'::regclass
      and conname = 'hotel_physical_occupancy_requests_operation_kind_check')
      and coalesce((
        select array_agg(kind_match[1] order by kind_match[1]) = array[
          'cancel_booking','check_in','check_out','create','join','merge_existing_stays','move','reverse_completion','unassign'
        ]::text[]
        from regexp_matches(
          pg_get_constraintdef((select oid from pg_constraint
            where conrelid = 'public.hotel_physical_occupancy_requests'::regclass
              and conname = 'hotel_physical_occupancy_requests_operation_kind_check')),
          '''([^'']+)''',
          'g'
        ) kind_match
      ), false) as operation_kinds_ok
), data_checks as (
  select
    (select count(*) from (select shared_room_group_id from public.hotel_physical_occupancies
      where archived_at is null group by shared_room_group_id having count(*) > 1) duplicate_group)
      as duplicate_active_occupancy_count,
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
    (select count(*) from public.hotel_physical_occupancies occupancy
      left join public.hotel_capacity_reservations capacity on capacity.id = occupancy.capacity_reservation_id
      left join public.hotel_room_allocations allocation on allocation.id = occupancy.room_allocation_id
      left join public.hotel_room_types room_type on room_type.id = occupancy.room_type_id
      where occupancy.archived_at is null and (
        capacity.id is null or capacity.archived_at is not null or capacity.quantity <> 1
        or capacity.source_kind <> 'shared_occupancy' or capacity.physical_occupancy_id is distinct from occupancy.id
        or allocation.id is null or allocation.archived_at is not null
        or allocation.capacity_reservation_id is distinct from capacity.id
        or allocation.room_id is distinct from occupancy.room_id
        or upper(btrim(room_type.code)) <> 'DELUXE')) as invalid_occupancy_relation_count,
    (select count(*) from public.family_shared_room_groups room_group
      where room_group.archived_at is null and room_group.status = 'allocated'
        and not exists (select 1 from public.hotel_physical_occupancies occupancy
          where occupancy.shared_room_group_id = room_group.id
            and occupancy.archived_at is null
            and occupancy.status = 'active'))
      as allocated_group_without_current_occupancy_count,
    (select count(*) from public.family_shared_room_groups room_group
      left join public.hotel_capacity_reservations capacity
        on capacity.shared_room_group_id = room_group.id and capacity.archived_at is null
      where room_group.archived_at is null and room_group.status = 'requested'
        and (capacity.id is null or capacity.source_kind <> 'shared_group'
          or capacity.quantity <> 1 or capacity.physical_occupancy_id is not null
          or exists (select 1 from public.hotel_room_allocations allocation
            where allocation.capacity_reservation_id = capacity.id and allocation.archived_at is null)))
      as invalid_requested_contract_count,
    (select count(*) from public.hotel_physical_occupancy_members member
      left join public.hotel_physical_occupancies occupancy on occupancy.id = member.occupancy_id
      left join public.family_booking_members family_member on family_member.id = member.family_booking_member_id
      where member.archived_at is null and (occupancy.id is null or occupancy.archived_at is not null
        or family_member.id is null or family_member.archived_at is not null
        or family_member.hotel_stay_id is distinct from member.hotel_stay_id
        or family_member.dog_id is distinct from member.dog_id)) as invalid_member_count,
    (select count(*) from public.family_booking_members member
      join public.family_bookings booking on booking.id = member.family_booking_id
      join public.dogs dog on dog.id = member.dog_id
      where member.archived_at is null and member.shared_room_group_id is not null
        and dog.customer_id is distinct from booking.customer_id) as cross_customer_member_count,
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
  select * from function_contract cross join schema_contract cross join data_checks
)
select
  case when signatures_ok and security_ok and acl_ok and idempotency_ok and baseline_rpc_signatures_ok
    and old_unique_removed and active_only_unique_ok and column_preserved and fk_preserved and operation_kinds_ok
    and duplicate_active_occupancy_count = 0 and invalid_occupancy_group_lifecycle_count = 0
    and invalid_occupancy_relation_count = 0
    and allocated_group_without_current_occupancy_count = 0
    and invalid_requested_contract_count = 0 and invalid_member_count = 0
    and cross_customer_member_count = 0
    and duplicate_active_shared_capacity_count = 0 and orphan_active_occupancy_count = 0
  then 'HOTEL_SHARED_ROOM_REVERSAL_CANCELLATION_POSTFLIGHT_PASS'
  else 'HOTEL_SHARED_ROOM_REVERSAL_CANCELLATION_POSTFLIGHT_FAIL' end verdict,
  case when old_unique_removed and active_only_unique_ok then 'PASS' else 'FAIL' end active_only_unique,
  case when column_preserved and fk_preserved then 'PASS' else 'FAIL' end historical_relation,
  case when signatures_ok then 'PASS' else 'FAIL' end rpc_signatures,
  case when baseline_rpc_signatures_ok then 'PASS' else 'FAIL' end baseline_rpc_signatures,
  case when security_ok then 'PASS' else 'FAIL' end security_definer_search_path,
  case when acl_ok then 'PASS' else 'FAIL' end acl,
  case when idempotency_ok then 'PASS' else 'FAIL' end idempotency,
  case when operation_kinds_ok then 'PASS' else 'FAIL' end exact_new_request_operation_kinds,
  duplicate_active_occupancy_count,
  invalid_occupancy_group_lifecycle_count,
  invalid_occupancy_relation_count,
  allocated_group_without_current_occupancy_count,
  invalid_requested_contract_count,
  invalid_member_count,
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
