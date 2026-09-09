BEGIN;
SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY;

-- No fixture, impersonation, session-claim change, or business write.
-- Existing authenticated context is required by the deployed RPC.
-- SQL Editor with auth.uid() NULL reports authorization precondition not met and skips RPC.
-- Expected migration SHA-256:
-- 72957025e671738979d95c1ac7edad400b19ad2bbb47395ea00396e341a5460c
WITH
rpc_catalog AS MATERIALIZED (
  SELECT p.*, pg_get_function_identity_arguments(p.oid) AS identity_arguments
  FROM pg_proc p WHERE p.oid=to_regprocedure('public.get_operation_hotel_room_projections(uuid[])')
),
contract AS MATERIALIZED (
  SELECT
    count(*)=1 AND coalesce(bool_and(prorettype='jsonb'::regtype
      AND NOT proretset AND prokind='f'
      AND identity_arguments='p_operation_schedule_ids uuid[]'),false) AS shape_ok,
    coalesce(bool_and(prosecdef AND provolatile='s'
      AND proconfig @> array['search_path=public, pg_temp']),false) AS execution_contract_ok,
    coalesce(bool_and(md5(prosrc)='ccb382e220c77ab3cb86a695735980dd'),false) AS full_body_ok,
    coalesce(bool_and(md5(split_part(split_part(prosrc,
      E'  -- BEGIN CANONICAL PROJECTION CORE\n',2),
      '  -- END CANONICAL PROJECTION CORE',1))='0328c64a5c26c2481817e91385f548a2'),false) AS core_ok,
    coalesce(bool_and(has_function_privilege('authenticated',oid,'EXECUTE')
      AND has_function_privilege('service_role',oid,'EXECUTE')
      AND NOT has_function_privilege('anon',oid,'EXECUTE')
      AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(proacl,acldefault('f',proowner))) a
        WHERE a.grantee=0 AND a.privilege_type='EXECUTE')),false) AS acl_ok,
    coalesce((SELECT h.prosecdef AND h.provolatile='s'
      AND h.proconfig @> array['search_path=public, pg_temp']
      AND md5(h.prosrc)='763b6864c59b9445a4e58dca500217f7' FROM pg_proc h
      WHERE h.oid=to_regprocedure('public.is_active_operation_member()')),false) AS member_guard_ok
  FROM rpc_catalog
),
actor AS MATERIALIZED (
  SELECT auth.uid() AS actor_id,
    EXISTS (SELECT 1 FROM public.operation_memberships m
      JOIN public.profiles p ON p.id=m.profile_id
      WHERE m.profile_id=auth.uid() AND m.is_active
        AND p.is_active AND p.account_status='active') AS active_actor
),
required_functions(signature,result_type,argument_names,security_definer) AS (
  VALUES
    ('public.protect_hotel_entity_metadata()','trigger',array[]::text[],false),
    ('public.is_active_operation_member()','boolean',array[]::text[],true),
    ('public.assign_hotel_room(uuid,integer,uuid,text,uuid)','jsonb',array['p_hotel_stay_id','p_expected_version','p_room_id','p_reason','p_request_id']::text[],true),
    ('public.reassign_hotel_room_before_check_in(uuid,integer,uuid,text,uuid)','jsonb',array['p_hotel_stay_id','p_expected_version','p_new_room_id','p_reason','p_request_id']::text[],true),
    ('public.move_hotel_room_same_type(uuid,integer,uuid,timestamptz,text,uuid)','jsonb',array['p_hotel_stay_id','p_expected_version','p_new_room_id','p_move_at','p_reason','p_request_id']::text[],true),
    ('public.complete_hotel_check_in(uuid,integer,timestamptz,uuid)','jsonb',array['p_hotel_stay_id','p_expected_version','p_completed_at','p_request_id']::text[],true),
    ('public.complete_hotel_check_out(uuid,integer,timestamptz,uuid)','jsonb',array['p_hotel_stay_id','p_expected_version','p_completed_at','p_request_id']::text[],true),
    ('public.reverse_hotel_completion(uuid,integer,text,text,uuid)','jsonb',array['p_hotel_stay_id','p_expected_version','p_completion_kind','p_reason','p_request_id']::text[],true),
    ('public.get_hotel_operations_snapshot_v2(date)','jsonb',array['p_local_date']::text[],true),
    ('public.unassign_hotel_room_before_check_in(uuid,integer,text,uuid)','jsonb',array['p_hotel_stay_id','p_expected_version','p_reason','p_request_id']::text[],true),
    ('public.change_room_type_before_check_in(uuid,integer,uuid,text,uuid)','jsonb',array['p_hotel_stay_id','p_expected_version','p_new_room_id','p_reason','p_request_id']::text[],true),
    ('public.change_room_type_after_check_in(uuid,integer,uuid,timestamptz,text,uuid)','jsonb',array['p_hotel_stay_id','p_expected_version','p_new_room_id','p_effective_at','p_reason','p_request_id']::text[],true),
    ('public.complete_long_stay_absence(uuid,integer,timestamptz,text,text,uuid)','jsonb',array['p_contract_id','p_expected_contract_version','p_returned_at','p_memo','p_reason','p_request_id']::text[],true),
    ('public.reverse_long_stay_completion(uuid,integer,integer,text,uuid)','jsonb',array['p_contract_id','p_expected_contract_version','p_expected_stay_version','p_reason','p_request_id']::text[],true),
    ('public.create_shared_hotel_room_occupancy(uuid,uuid,uuid)','jsonb',array['p_shared_room_group_id','p_room_id','p_request_id']::text[],true),
    ('public.reverse_shared_hotel_member_completion(uuid,uuid,integer,integer,text,uuid)','jsonb',array['p_occupancy_id','p_hotel_stay_id','p_expected_occupancy_version','p_expected_stay_version','p_reason','p_request_id']::text[],true),
    ('public.confirm_long_stay_month_v2(uuid,integer,date,date,uuid,uuid,time,boolean,uuid,uuid,uuid[],text,uuid)','jsonb',array['p_contract_id','p_expected_contract_version','p_service_month','p_physical_start_date','p_calendar_id','p_schedule_type_id','p_check_in_time','p_check_in_time_unspecified','p_room_type_id','p_room_id','p_assignee_ids','p_reason','p_request_id']::text[],true),
    ('public.start_long_stay_absence_v3(uuid,integer,timestamptz,date,time,boolean,text,text,text,uuid)','jsonb',array['p_contract_id','p_expected_contract_version','p_left_at','p_expected_return_date','p_expected_return_time','p_expected_return_time_unspecified','p_inventory_mode','p_memo','p_reason','p_request_id']::text[],true),
    ('public.release_long_stay_room_during_absence(uuid,integer,text,uuid)','jsonb',array['p_contract_id','p_expected_contract_version','p_reason','p_request_id']::text[],true),
    ('public.unassign_shared_hotel_room_before_check_in(uuid,integer,text,uuid)','jsonb',array['p_occupancy_id','p_expected_version','p_reason','p_request_id']::text[],true),
    ('public.reverse_shared_hotel_member_check_in(uuid,uuid,integer,integer,text,uuid)','jsonb',array['p_occupancy_id','p_hotel_stay_id','p_expected_occupancy_version','p_expected_stay_version','p_reason','p_request_id']::text[],true),
    ('public.reverse_check_in_and_unassign_hotel_room(uuid,integer,text,uuid)','jsonb',array['p_hotel_stay_id','p_expected_version','p_reason','p_request_id']::text[],true),
    ('public.reverse_check_in_and_unassign_shared_hotel_room(uuid,integer,text,uuid)','jsonb',array['p_occupancy_id','p_expected_version','p_reason','p_request_id']::text[],true),
    ('public.can_operate_hotel()','boolean',array[]::text[],true)
),
legacy_contract AS (
  SELECT r.signature,coalesce(p.prorettype=to_regtype(r.result_type)
      AND p.prosecdef=r.security_definer AND p.prokind='f' AND NOT p.proretset
      AND coalesce(p.proargnames,array[]::text[])=r.argument_names
      AND p.proconfig @> array['search_path=public, pg_temp'],false) AS ok,
    pg_get_function_arguments(p.oid) AS actual_arguments,
    pg_get_function_result(p.oid) AS actual_result
  FROM required_functions r LEFT JOIN pg_proc p ON p.oid=to_regprocedure(r.signature)
),
requested_schedule_ids AS MATERIALIZED (
  SELECT DISTINCT operation_schedule_id FROM public.hotel_stay_schedule_events
  WHERE archived_at IS NULL AND event_kind IN ('check_in','check_out')
),
request AS MATERIALIZED (
  SELECT coalesce(array_agg(operation_schedule_id ORDER BY operation_schedule_id),array[]::uuid[]) AS ids,
    count(*) AS n FROM requested_schedule_ids
),
-- One RPC invocation for the entire selected batch, never a per-stay call.
rpc_once AS MATERIALIZED (
  SELECT r.n, a.actor_id,
    (c.shape_ok AND c.execution_contract_ok AND c.full_body_ok AND c.core_ok AND c.acl_ok AND c.member_guard_ok
      AND a.active_actor AND r.n>0) AS executed,
    CASE WHEN c.shape_ok AND c.execution_contract_ok AND c.full_body_ok AND c.core_ok AND c.acl_ok AND c.member_guard_ok
      AND a.active_actor AND r.n>0
      THEN public.get_operation_hotel_room_projections(r.ids)
      ELSE NULL::jsonb END AS payload
  FROM request r CROSS JOIN contract c CROSS JOIN actor a
),
actual_rows AS MATERIALIZED (
  SELECT item FROM rpc_once r CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(r.payload)='array' THEN r.payload ELSE '[]'::jsonb END
  ) item
),
  -- BEGIN CANONICAL PROJECTION CORE
  schedule_context as (
    select
      schedule.id as operation_schedule_id,
      schedule.starts_at,
      event.hotel_stay_id,
      event.event_kind,
      stay.checked_in_at,
      stay.checked_out_at,
      case event.event_kind
        when 'check_in' then stay.checked_in_at is not null
        when 'check_out' then stay.checked_out_at is not null
      end as completed_event,
      count(*) over (partition by schedule.id) as event_link_count,
      case event.event_kind
        when 'check_in' then coalesce(stay.checked_in_at, schedule.starts_at)
        when 'check_out' then coalesce(stay.checked_out_at, schedule.starts_at)
      end as event_at
    from requested_schedule_ids requested
    join public.operation_schedules schedule
      on schedule.id = requested.operation_schedule_id
    join public.hotel_stay_schedule_events event
      on event.operation_schedule_id = schedule.id
     and event.archived_at is null
     and event.event_kind in ('check_in', 'check_out')
    join public.hotel_stays stay on stay.id = event.hotel_stay_id
  ),
  candidate_summary as (
    select
      context.*,
      family.shared_group_count,
      family.shared_group_id,
      family.shared_group_status,
      family.shared_group_room_type_name,
      shared.current_candidate_count,
      shared.current_room_name,
      shared.current_room_type_name,
      single.candidate_count as single_candidate_count,
      single.raw_candidate_count,
      single.invalid_provenance_count as single_invalid_provenance_count,
      single.room_name as single_room_name,
      single.room_type_name as single_room_type_name,
      capacity.candidate_count as capacity_candidate_count,
      capacity.room_type_name as capacity_room_type_name
    from schedule_context context
    left join lateral (
      select
        greatest(count(distinct room_group.id),
          count(distinct member.shared_room_group_id))::integer as shared_group_count,
        case when count(distinct room_group.id) = 1
          then (array_agg(distinct room_group.id))[1]
        end as shared_group_id,
        case when count(distinct room_group.id) = 1
          then (array_agg(distinct room_group.status))[1]
        end as shared_group_status,
        case when count(distinct room_group.id) = 1
          then (array_agg(distinct room_type.name))[1]
        end as shared_group_room_type_name
      from public.family_booking_members member
      left join public.family_shared_room_groups room_group
        on room_group.id = member.shared_room_group_id
      left join public.hotel_room_types room_type
        on room_type.id = room_group.room_type_id
      where member.hotel_stay_id = context.hotel_stay_id
        and member.service_type = 'hotel'
        and member.shared_room_group_id is not null
    ) family on true
    left join lateral (
      select
        count(distinct occupancy.id)::integer as current_candidate_count,
        case when count(distinct occupancy.id) = 1
          then (array_agg(distinct room.name))[1]
        end as current_room_name,
        case when count(distinct occupancy.id) = 1
          then (array_agg(distinct room_type.name))[1]
        end as current_room_type_name
      from public.family_booking_members family_member
      join public.hotel_physical_occupancy_members physical_member
        on physical_member.family_booking_member_id = family_member.id
       and physical_member.hotel_stay_id = context.hotel_stay_id
       and physical_member.archived_at is null
       and physical_member.status = 'active'
      join public.hotel_physical_occupancies occupancy
        on occupancy.id = physical_member.occupancy_id
       and occupancy.shared_room_group_id = family.shared_group_id
       and occupancy.archived_at is null
       and occupancy.status = 'active'
      join public.hotel_room_allocations allocation
        on allocation.id = occupancy.room_allocation_id
       and allocation.archived_at is null
       and allocation.room_id = occupancy.room_id
      join public.hotel_rooms room
        on room.id = occupancy.room_id
       and room.room_type_id = occupancy.room_type_id
      join public.hotel_room_types room_type
        on room_type.id = occupancy.room_type_id
      where family_member.hotel_stay_id = context.hotel_stay_id
        and family_member.shared_room_group_id = family.shared_group_id
        and family_member.archived_at is null
        -- Shared room_id is mutable in place: no historical current-room fallback.
        and context.checked_out_at is null
        and allocation.updated_at <= context.event_at
        and (allocation.version = 1
          or (not context.completed_event and context.event_at >= statement_timestamp()))
        and (
          (context.event_kind = 'check_in'
            and allocation.allocated_from <= context.event_at
            and allocation.allocated_until > context.event_at)
          or (context.event_kind = 'check_out'
            and allocation.allocated_from < context.event_at
            and allocation.allocated_until >= context.event_at)
        )
    ) shared on true
    left join lateral (
      select
        count(*)::integer as raw_candidate_count,
        count(*) filter (where allocation_candidate.retained)::integer as candidate_count,
        count(*) filter (where allocation_candidate.retained
          and not allocation_candidate.provenance_ok)::integer
          as invalid_provenance_count,
        case when count(*) filter (where allocation_candidate.retained) = 1
          and bool_and(allocation_candidate.provenance_ok) filter (where allocation_candidate.retained)
          then (array_agg(allocation_candidate.room_name) filter (where allocation_candidate.retained))[1]
        end as room_name,
        case when count(*) filter (where allocation_candidate.retained) = 1
          and bool_and(allocation_candidate.provenance_ok) filter (where allocation_candidate.retained)
          then (array_agg(allocation_candidate.room_type_name) filter (where allocation_candidate.retained))[1]
        end as room_type_name
      from (
        select
          allocation.id,
          allocation.archived_at is null as retained,
          room.name as room_name,
          room_type.name as room_type_name,
          coalesce(room.id is not null and room_type.id is not null
          and (
            (context.event_kind = 'check_in'
              and capacity.reserved_from <= context.event_at
              and capacity.reserved_until > context.event_at)
            or (context.event_kind = 'check_out'
              and capacity.reserved_from < context.event_at
              and capacity.reserved_until >= context.event_at)
          ) and case
            when capacity.archive_reason is distinct from
              'long_stay_outing_inventory_segment_closed' then capacity.archived_at is null
            else capacity.archived_at is not null
              and isfinite(allocation.allocated_until) and exists (
              select 1
              from public.long_stay_absence_events leave_event
              where leave_event.event_type = 'leave'
                and leave_event.hotel_stay_id = context.hotel_stay_id
                and leave_event.released_allocation_id = allocation.id
                and leave_event.released_capacity_id = capacity.id
                and leave_event.inventory_mode = 'release_room'
                and leave_event.inventory_transition_status in ('room_released', 'room_returned')
                and allocation.allocated_until = capacity.reserved_until
                and allocation.allocated_until >= leave_event.occurred_at
                and allocation.allocated_until <= leave_event.guarantee_from
            )
          end, false) as provenance_ok
        from public.hotel_capacity_reservations capacity
        join public.hotel_room_allocations allocation
          on allocation.capacity_reservation_id = capacity.id
        left join public.hotel_rooms room on room.id = allocation.room_id
        left join public.hotel_room_types room_type on room_type.id = room.room_type_id
        where coalesce(family.shared_group_count, 0) = 0
          and capacity.source_kind = 'stay'
          and capacity.hotel_stay_id = context.hotel_stay_id
          and (
            (context.event_kind = 'check_in'
              and allocation.allocated_from <= context.event_at
              and allocation.allocated_until > context.event_at)
            or
            (context.event_kind = 'check_out'
              and allocation.allocated_from < context.event_at
              and allocation.allocated_until >= context.event_at)
          )
      ) allocation_candidate
    ) single on true
    left join lateral (
      select
        count(*)::integer as candidate_count,
        case when count(*) = 1 then (array_agg(room_type.name))[1] end
          as room_type_name
      from public.hotel_capacity_reservations stay_capacity
      join public.hotel_room_types room_type
        on room_type.id = stay_capacity.room_type_id
      where coalesce(family.shared_group_count, 0) = 0
        and stay_capacity.source_kind = 'stay'
        and stay_capacity.hotel_stay_id = context.hotel_stay_id
        and stay_capacity.archived_at is null
        and (
          (context.event_kind = 'check_in'
            and stay_capacity.reserved_from <= context.event_at
            and stay_capacity.reserved_until > context.event_at)
          or
          (context.event_kind = 'check_out'
            and stay_capacity.reserved_from < context.event_at
            and stay_capacity.reserved_until >= context.event_at)
        )
    ) capacity on true
  ),
  resolved as (
    select
      candidate_summary.*,
      case
        when event_link_count <> 1 then 'unavailable'
        when shared_group_count > 1 then 'unavailable'
        when shared_group_count = 1 and current_candidate_count > 1 then 'unavailable'
        when shared_group_count = 1 and current_candidate_count = 1 then 'resolved'
        when shared_group_count = 1 and shared_group_status = 'requested'
          and not completed_event and checked_out_at is null then 'unassigned'
        when shared_group_count = 1 then 'unavailable'
        when single_candidate_count > 1 then 'unavailable'
        when single_candidate_count = 1 and single_invalid_provenance_count > 0
          then 'unavailable'
        when single_candidate_count = 1 then 'resolved'
        when completed_event then 'unavailable'
        when capacity_candidate_count > 1 then 'unavailable'
        when capacity_candidate_count = 1 then 'unassigned'
        when raw_candidate_count > 0 then 'unavailable'
        else 'unknown'
      end as room_resolution_status
    from candidate_summary
  )
  -- END CANONICAL PROJECTION CORE
,
expected AS MATERIALIZED (
  SELECT r.*,jsonb_build_object(
    'operationScheduleId',r.operation_schedule_id,
    'hotelStayId',r.hotel_stay_id,'hotelEventKind',r.event_kind,
    'hotelRoomTypeName',CASE WHEN r.room_resolution_status='unavailable' THEN NULL
      ELSE coalesce(r.current_room_type_name,r.shared_group_room_type_name,
        r.single_room_type_name,r.capacity_room_type_name) END,
    'hotelRoomName',CASE WHEN r.room_resolution_status='resolved'
      THEN coalesce(r.current_room_name,r.single_room_name) ELSE NULL END,
    'hotelSharedRoom',r.shared_group_count>0,
    'roomResolutionStatus',r.room_resolution_status) AS expected_json
  FROM resolved r
),
compared AS MATERIALIZED (
  SELECT e.*,a.actual_count,a.actual_json,
    a.actual_count=1 AND a.actual_json=e.expected_json AS matches_contract
  FROM expected e LEFT JOIN LATERAL (
    SELECT count(*) AS actual_count,
      CASE WHEN count(*)=1 THEN (array_agg(item))[1] END AS actual_json
    FROM actual_rows WHERE item->>'operationScheduleId'=e.operation_schedule_id::text
  ) a ON true
),
features AS MATERIALIZED (
  SELECT c.*,f.archived_candidates,f.type_mismatch_candidates,f.type_change_audit,
    f.direct_release,f.delayed_release,f.returned_release,f.case5_retained_allocation,
    EXISTS (SELECT 1 FROM public.long_stay_absence_events e
      WHERE e.hotel_stay_id=c.hotel_stay_id)
      OR EXISTS (SELECT 1 FROM public.long_stay_contracts contract
        WHERE contract.current_hotel_stay_id=c.hotel_stay_id) AS long_stay_observed,
    EXISTS (SELECT 1 FROM public.hotel_capacity_reservations cap
      JOIN public.hotel_room_allocations a ON a.capacity_reservation_id=cap.id
      JOIN public.hotel_rooms room ON room.id=a.room_id
      WHERE cap.hotel_stay_id=c.hotel_stay_id AND cap.source_kind='stay'
        AND a.archived_at IS NULL AND a.allocated_from>c.event_at
        AND room.name IS DISTINCT FROM c.single_room_name) AS different_later_segment
  FROM compared c LEFT JOIN LATERAL (
    SELECT count(*) FILTER (WHERE a.archived_at IS NOT NULL) AS archived_candidates,
      count(*) FILTER (WHERE room.room_type_id IS DISTINCT FROM cap.room_type_id) AS type_mismatch_candidates,
      coalesce(bool_or(EXISTS (SELECT 1 FROM public.entity_audit_events audit
        WHERE audit.entity_type='hotel_capacity_reservations' AND audit.entity_id=cap.id
          AND audit.before_data ? 'room_type_id' AND audit.after_data ? 'room_type_id'
          AND audit.before_data->>'room_type_id' IS DISTINCT FROM audit.after_data->>'room_type_id')),false) AS type_change_audit,
      coalesce(bool_or(ls.direct_release),false) AS direct_release,
      coalesce(bool_or(ls.delayed_release),false) AS delayed_release,
      coalesce(bool_or(ls.returned_release),false) AS returned_release,
      coalesce(bool_or(a.id='7980835d-cde9-4446-9dc4-fe964ae45dea'::uuid
        AND a.archived_at IS NULL AND cap.archived_at IS NULL),false) AS case5_retained_allocation
    FROM public.hotel_capacity_reservations cap
    JOIN public.hotel_room_allocations a ON a.capacity_reservation_id=cap.id
    LEFT JOIN public.hotel_rooms room ON room.id=a.room_id
    LEFT JOIN LATERAL (
      SELECT bool_or(e.occurred_at=a.allocated_until) AS direct_release,
        bool_or(e.occurred_at<a.allocated_until) AS delayed_release,
        bool_or(e.inventory_transition_status='room_returned') AS returned_release
      FROM public.long_stay_absence_events e
      WHERE e.hotel_stay_id=c.hotel_stay_id AND e.event_type='leave'
        AND e.released_allocation_id=a.id AND e.released_capacity_id=cap.id
        AND e.inventory_mode='release_room'
        AND e.inventory_transition_status IN ('room_released','room_returned')
        AND cap.archived_at IS NOT NULL
        AND cap.archive_reason='long_stay_outing_inventory_segment_closed'
        AND a.archived_at IS NULL AND isfinite(a.allocated_until)
        AND a.allocated_until=cap.reserved_until
        AND e.occurred_at<=a.allocated_until AND a.allocated_until<=e.guarantee_from
    ) ls ON true
    WHERE cap.source_kind='stay' AND cap.hotel_stay_id=c.hotel_stay_id
      AND ((c.event_kind='check_in' AND a.allocated_from<=c.event_at AND a.allocated_until>c.event_at)
        OR (c.event_kind='check_out' AND a.allocated_from<c.event_at AND a.allocated_until>=c.event_at))
  ) f ON true
),
coverage AS (
  SELECT f.*,category.check_name FROM features f CROSS JOIN LATERAL (VALUES
    ('SINGLE_CURRENT',f.shared_group_count=0 AND NOT f.completed_event AND f.checked_out_at IS NULL),
    ('SINGLE_HISTORICAL',f.shared_group_count=0 AND f.completed_event),
    ('SHARED_CURRENT',f.shared_group_count=1 AND f.checked_out_at IS NULL AND f.current_candidate_count=1),
    ('SHARED_HISTORICAL',f.shared_group_count>0 AND f.completed_event),
    ('SHARED_HISTORICAL_UNPROVEN',f.shared_group_count>0 AND f.completed_event AND f.room_resolution_status='unavailable'),
    ('LONG_STAY',f.long_stay_observed),
    ('LONG_STAY_DIRECT_RELEASE',f.direct_release),
    ('LONG_STAY_DELAYED_INVENTORY_CLOSE',f.delayed_release),
    ('LONG_STAY_RETURNED_RELEASE',f.returned_release),
    ('ARCHIVED_ALLOCATION_LIFECYCLE',f.shared_group_count=0 AND f.archived_candidates>0),
    ('ROOM_TYPE_CHANGE_AUDIT',f.type_change_audit),
    ('HISTORICAL_CAPACITY_TYPE_MISMATCH',f.shared_group_count=0 AND f.completed_event AND f.type_mismatch_candidates>0),
    ('HISTORICAL_VS_LATER_ROOM',f.shared_group_count=0 AND f.completed_event AND f.different_later_segment),
    ('AMBIGUOUS_HISTORICAL',f.shared_group_count=0 AND f.completed_event AND f.single_candidate_count>1),
    ('UNPROVABLE_HISTORICAL',f.completed_event AND f.room_resolution_status='unavailable'),
    ('RETAINED_PLUS_ARCHIVED_REGRESSION_SHAPE',f.shared_group_count=0 AND f.single_candidate_count=1 AND f.archived_candidates>0)
  ) category(check_name,observed) WHERE category.observed
),
category_names(check_name) AS (VALUES
  ('SINGLE_CURRENT'),('SINGLE_HISTORICAL'),('SHARED_CURRENT'),('SHARED_HISTORICAL'),
  ('SHARED_HISTORICAL_UNPROVEN'),('LONG_STAY'),('LONG_STAY_DIRECT_RELEASE'),
  ('LONG_STAY_DELAYED_INVENTORY_CLOSE'),('LONG_STAY_RETURNED_RELEASE'),
  ('ARCHIVED_ALLOCATION_LIFECYCLE'),('ROOM_TYPE_CHANGE_AUDIT'),
  ('HISTORICAL_CAPACITY_TYPE_MISMATCH'),('HISTORICAL_VS_LATER_ROOM'),
  ('AMBIGUOUS_HISTORICAL'),('UNPROVABLE_HISTORICAL'),('RETAINED_PLUS_ARCHIVED_REGRESSION_SHAPE')
),
shared_findings AS (
  SELECT 'DUPLICATE_UNARCHIVED_OCCUPANCY' AS kind,count(*) AS n FROM (
    SELECT shared_room_group_id FROM public.hotel_physical_occupancies
    WHERE archived_at IS NULL GROUP BY shared_room_group_id HAVING count(*)>1
  ) duplicates
  UNION ALL
  SELECT 'DUPLICATE_UNARCHIVED_MEMBER',count(*) FROM (
    SELECT hotel_stay_id FROM public.hotel_physical_occupancy_members
    WHERE archived_at IS NULL GROUP BY hotel_stay_id HAVING count(*)>1
  ) duplicates
  UNION ALL
  SELECT 'CURRENT_MALFORMED_MEMBER_RELATION',count(*)
  FROM public.hotel_physical_occupancy_members m
  LEFT JOIN public.hotel_physical_occupancies o ON o.id=m.occupancy_id
  WHERE m.archived_at IS NULL AND m.status='active'
    AND (o.id IS NULL OR o.archived_at IS NOT NULL OR o.status<>'active' OR NOT EXISTS (
      SELECT 1 FROM public.family_booking_members fm
      JOIN public.hotel_stays s ON s.id=fm.hotel_stay_id
      JOIN public.dogs d ON d.id=fm.dog_id
      WHERE fm.id=m.family_booking_member_id AND fm.archived_at IS NULL
        AND fm.service_type='hotel' AND fm.family_booking_id=o.family_booking_id
        AND fm.shared_room_group_id=o.shared_room_group_id
        AND fm.hotel_stay_id=m.hotel_stay_id AND fm.dog_id=m.dog_id
        AND s.dog_id=m.dog_id AND s.archived_at IS NULL AND d.customer_id=o.customer_id
    ))
  UNION ALL
  SELECT 'CURRENT_MALFORMED_ALLOCATION_RELATION',count(*)
  FROM public.hotel_physical_occupancies o
  WHERE o.archived_at IS NULL AND o.status='active' AND NOT EXISTS (
    SELECT 1 FROM public.hotel_capacity_reservations c
    JOIN public.hotel_room_allocations a ON a.id=o.room_allocation_id
      AND a.capacity_reservation_id=c.id
    JOIN public.hotel_rooms r ON r.id=o.room_id
    WHERE c.id=o.capacity_reservation_id AND c.physical_occupancy_id=o.id
      AND c.source_kind='shared_occupancy' AND c.archived_at IS NULL
      AND a.archived_at IS NULL AND c.quantity=1
      AND c.room_type_id=o.room_type_id AND a.room_id=o.room_id
      AND r.room_type_id=o.room_type_id
      AND c.reserved_from=o.occupied_from AND c.reserved_until=o.occupied_until
      AND a.allocated_from=o.occupied_from AND a.allocated_until=o.occupied_until
  )
  UNION ALL
  SELECT 'CURRENT_OCCUPANCY_WITHOUT_ACTIVE_MEMBER',count(*)
  FROM public.hotel_physical_occupancies o
  WHERE o.archived_at IS NULL AND o.status='active' AND NOT EXISTS (
    SELECT 1 FROM public.hotel_physical_occupancy_members m
    WHERE m.occupancy_id=o.id AND m.archived_at IS NULL AND m.status='active'
  )
),
checks AS (
  SELECT '01_RPC_SHAPE'::text AS check_name,CASE WHEN shape_ok THEN 'PASS' ELSE 'FAIL' END AS status,
    jsonb_build_object('shape_ok',shape_ok) AS detail FROM contract
  UNION ALL
  SELECT '02_SECURITY_DEFINER_SEARCH_PATH_ACL',CASE WHEN execution_contract_ok AND acl_ok AND member_guard_ok THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object('execution_contract_ok',execution_contract_ok,'acl_ok',acl_ok,'active_member_guard_body_ok',member_guard_ok) FROM contract
  UNION ALL
  SELECT '03_APPLIED_BODY_AND_CORE',CASE WHEN full_body_ok AND core_ok THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object('body_md5_match',full_body_ok,'core_md5_match',core_ok,
      'approved_migration_sha','72957025e671738979d95c1ac7edad400b19ad2bbb47395ea00396e341a5460c') FROM contract
  UNION ALL
  SELECT '04_AUTHORIZATION_CONTEXT',CASE WHEN active_actor THEN 'PASS' ELSE 'AUTHORIZATION_PRECONDITION_NOT_MET' END,
    jsonb_build_object('auth_uid',actor_id,'active_actor',active_actor,
      'reason',CASE WHEN NOT active_actor THEN 'AUTHENTICATED_ACTIVE_MEMBER_CONTEXT_REQUIRED; RPC_NOT_EXECUTED' END,
      'claims_modified',false) FROM actor
  UNION ALL
  SELECT '05_LEGACY_HOTEL_RPC_CATALOG',CASE WHEN bool_and(ok) THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object('contracts',jsonb_agg(to_jsonb(l)),
      'scope','signature/argument names/result/definer/search_path; no legacy RPC invoked; not a before-after body snapshot')
    FROM legacy_contract l
  UNION ALL
  SELECT '05_SNAPSHOT_V2_SOURCE_BODY',CASE WHEN coalesce((SELECT
      p.provolatile='s' AND p.prosecdef AND p.prorettype='jsonb'::regtype
      AND md5(p.prosrc)='7dac53943e2f74f207de1cd36d5023fb'
      FROM pg_proc p WHERE p.oid=to_regprocedure('public.get_hotel_operations_snapshot_v2(date)')),false)
      THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object('source_baseline','202608070003 and 202608070004 source fingerprint',
      'expected_body_md5','7dac53943e2f74f207de1cd36d5023fb','snapshot_rpc_invoked',false)
  UNION ALL
  SELECT '06_BATCH_RUNTIME',CASE WHEN NOT a.active_actor THEN 'NOT_EXECUTED_AUTHORIZATION_PRECONDITION'
      WHEN r.n=0 THEN 'NOT_OBSERVED_IN_PRODUCTION'
      WHEN NOT r.executed THEN 'NOT_EXECUTED_CATALOG_PRECONDITION'
      WHEN jsonb_typeof(r.payload) IS DISTINCT FROM 'array' THEN 'FAIL'
      WHEN (SELECT count(*) FROM actual_rows)<>r.n
        OR (SELECT count(*) FROM compared)<>r.n
        OR EXISTS (SELECT 1 FROM compared WHERE NOT matches_contract) THEN 'FAIL' ELSE 'PASS' END,
    jsonb_build_object('selected_schedule_count',r.n,'executed',r.executed,
      'returned_rows',(SELECT count(*) FROM actual_rows),
      'mismatch_rows',(SELECT count(*) FROM compared WHERE NOT matches_contract),
      'comparison','approved core evaluated on the same transaction snapshot')
    FROM rpc_once r CROSS JOIN actor a
  UNION ALL
  SELECT '07_BATCH_NO_PER_STAY_RPC',CASE WHEN executed THEN 'PASS' ELSE 'INFORMATIONAL_ONLY' END,
    jsonb_build_object('rpc_calls',CASE WHEN executed THEN 1 ELSE 0 END,'batch_size',n,
      'scope','this SQL performs one materialized projection RPC; application network N+1 was verified locally, not measured here') FROM rpc_once
  UNION ALL
  SELECT '08_SCHEDULE_EVENT_RELATION',CASE WHEN count(*)=0 THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object('malformed_links',count(*))
    FROM public.hotel_stay_schedule_events e
    LEFT JOIN public.operation_schedules s ON s.id=e.operation_schedule_id
    LEFT JOIN public.hotel_stays h ON h.id=e.hotel_stay_id
    WHERE e.archived_at IS NULL AND (s.id IS NULL OR h.id IS NULL
      OR e.event_kind NOT IN ('check_in','check_out')
      OR EXISTS (SELECT 1 FROM public.hotel_stay_schedule_events other
        WHERE other.archived_at IS NULL AND other.operation_schedule_id=e.operation_schedule_id AND other.id<>e.id))
  UNION ALL
  SELECT '08_SINGLE_REFERENTIAL_RELATION',CASE WHEN count(*)=0 THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object('missing_references',count(*),'capacity_room_type_not_compared',true)
    FROM public.hotel_room_allocations a
    LEFT JOIN public.hotel_capacity_reservations c ON c.id=a.capacity_reservation_id
    LEFT JOIN public.hotel_rooms r ON r.id=a.room_id
    LEFT JOIN public.hotel_room_types t ON t.id=r.room_type_id
    LEFT JOIN public.hotel_stays s ON s.id=c.hotel_stay_id
    WHERE c.id IS NULL OR r.id IS NULL OR t.id IS NULL
      OR (c.source_kind='stay' AND s.id IS NULL)
  UNION ALL
  SELECT '09_CURRENT_RELATION_'||kind,CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object('count',n,'repair_authorized',false,'corruption_not_automatically_inferred',true) FROM shared_findings
  UNION ALL
  SELECT '10_COVERAGE_'||n.check_name,
    CASE WHEN count(c.operation_schedule_id)=0 THEN 'NOT_OBSERVED_IN_PRODUCTION'
      WHEN NOT (SELECT executed FROM rpc_once) THEN 'INFORMATIONAL_ONLY'
      WHEN bool_and(c.matches_contract) THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object('observed_schedules',count(c.operation_schedule_id),
      'rpc_executed',(SELECT executed FROM rpc_once),
      'cases',coalesce(jsonb_agg(jsonb_build_object('stay_id',c.hotel_stay_id,
        'event_kind',c.event_kind,'event_at',c.event_at,'schedule_id',c.operation_schedule_id,
        'expected',c.expected_json,'actual',c.actual_json)) FILTER (WHERE c.operation_schedule_id IS NOT NULL),'[]'::jsonb))
    FROM category_names n LEFT JOIN coverage c ON c.check_name=n.check_name GROUP BY n.check_name
  UNION ALL
  SELECT '11_CASE_5_FIXED_IDENTITY',CASE WHEN count(*)=0 THEN 'NOT_OBSERVED_IN_PRODUCTION'
    WHEN NOT (SELECT executed FROM rpc_once) THEN 'INFORMATIONAL_ONLY'
    WHEN bool_and(matches_contract AND case5_retained_allocation
      AND actual_json->>'roomResolutionStatus'='resolved'
      AND actual_json->>'hotelRoomName'='STANDARD 4') THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object('identity','84b2fb9f-ef81-4177-9e38-9782b3f263df / check_in / 2026-08-06 06:00:00+00',
      'known_retained_allocation','7980835d-cde9-4446-9dc4-fe964ae45dea',
      'observed_schedule_count',count(*),'cases',coalesce(jsonb_agg(jsonb_build_object(
        'schedule_id',operation_schedule_id,'expected',expected_json,'actual',actual_json,
        'retained_candidate_count',single_candidate_count,'archived_candidate_count',archived_candidates,
        'known_retained_allocation_present',case5_retained_allocation)),'[]'::jsonb))
    FROM features WHERE hotel_stay_id='84b2fb9f-ef81-4177-9e38-9782b3f263df'::uuid
      AND event_kind='check_in' AND event_at=timestamptz '2026-08-06 06:00:00+00'
  UNION ALL
  SELECT '12_ORIGINAL_13_IDENTITY_COHORT','NOT_OBSERVED_IN_PRODUCTION',jsonb_build_object(
    'reason','Original 13 canonical identity snapshot was not supplied; exact membership cannot be verified from aggregate counts.',
    'current_shape_coverage','RETAINED_PLUS_ARCHIVED_REGRESSION_SHAPE',
    'same_approved_resolver_predicate_used',true,'old_13_reidentified_by_row_number',false,
    'old_provenance_classifier_reexecuted',false)
  UNION ALL
  SELECT '13_MALFORMED_RELATION_FAIL_CLOSED_RUNTIME',CASE WHEN EXISTS (SELECT 1 FROM shared_findings WHERE n>0) THEN 'INFORMATIONAL_ONLY' ELSE 'NOT_OBSERVED_IN_PRODUCTION' END,jsonb_build_object(
    'reason',CASE WHEN EXISTS (SELECT 1 FROM shared_findings WHERE n>0)
      THEN 'Malformed current relations found; FAIL findings require separate identity-specific review. No fabricated test row.'
      ELSE 'No malformed current Shared relation observed; rejection behavior is not exercised by absent data.' END,
    'guard_code_fingerprint_checked',true)
  UNION ALL
  SELECT '14_NO_MUTATION','INFORMATIONAL_ONLY',jsonb_build_object(
    'transaction_read_only',current_setting('transaction_read_only'),
    'fixtures_created',false,'business_mutation',0,'claims_modified',false,
    'mutation_rpc_calls',0,'schema_mutation_statements',0,'migration_reexecuted',false)
),
result AS (
  SELECT '00_OVERALL' AS check_name,
    CASE WHEN EXISTS (SELECT 1 FROM checks WHERE status='FAIL') THEN 'FAIL'
      WHEN NOT (SELECT active_actor FROM actor) THEN 'RUNTIME_VALIDATION_NOT_EXECUTED_AUTHORIZATION_PRECONDITION'
      WHEN NOT (SELECT executed FROM rpc_once) THEN 'NOT_OBSERVED_IN_PRODUCTION' ELSE 'PASS' END AS status,
    jsonb_build_object('failed_checks',(SELECT count(*) FROM checks WHERE status='FAIL'),
      'not_observed_checks',(SELECT count(*) FROM checks WHERE status='NOT_OBSERVED_IN_PRODUCTION'),
      'pass_scope','Observed samples only; missing sample types and original 13 identities remain unverified.',
      'not_observed_is_failure',false,'repair_authorized',false) AS detail
  UNION ALL SELECT * FROM checks
)
SELECT check_name,status,detail FROM result ORDER BY check_name;

ROLLBACK;
