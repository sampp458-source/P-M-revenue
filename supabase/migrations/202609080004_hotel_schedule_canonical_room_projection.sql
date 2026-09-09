-- Canonical Hotel room projection for Operations Today and Calendar.
-- Candidate migration, not yet applied. No business rows or RLS policies change.
-- Single room_id belongs to the retained allocation segment; capacity type is mutable.
-- Archive is revocation/retirement metadata, never an occupancy interval endpoint.
-- Audit/reason/request_id are diagnostic evidence, not a temporal room lookup source.

begin;

do $$
begin
  if to_regclass('public.operation_memberships') is null
    or to_regclass('public.operation_schedules') is null
    or to_regclass('public.hotel_stay_schedule_events') is null
    or to_regclass('public.hotel_stays') is null
    or to_regclass('public.hotel_capacity_reservations') is null
    or to_regclass('public.hotel_room_allocations') is null
    or to_regclass('public.hotel_rooms') is null
    or to_regclass('public.hotel_room_types') is null
    or to_regclass('public.family_booking_members') is null
    or to_regclass('public.family_shared_room_groups') is null
    or to_regclass('public.hotel_physical_occupancies') is null
    or to_regclass('public.hotel_physical_occupancy_members') is null
    or to_regclass('public.long_stay_absence_events') is null
    or to_regprocedure('public.is_active_operation_member()') is null then
    raise exception 'STOP_HOTEL_SCHEDULE_ROOM_PROJECTION_DEPENDENCY_MISSING';
  end if;
  if to_regprocedure('public.get_operation_hotel_room_projections(uuid[])') is not null then
    raise exception 'STOP_HOTEL_SCHEDULE_ROOM_PROJECTION_ALREADY_APPLIED';
  end if;
end;
$$;

create function public.get_operation_hotel_room_projections(
  p_operation_schedule_ids uuid[]
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  result jsonb;
begin
  if auth.uid() is null or not public.is_active_operation_member() then
    raise exception 'Operations 일정 조회 권한이 없습니다.' using errcode = '42501';
  end if;

  if coalesce(cardinality(p_operation_schedule_ids), 0) = 0 then
    return '[]'::jsonb;
  end if;

  with requested_schedule_ids as (
    select distinct requested.operation_schedule_id
    from unnest(p_operation_schedule_ids) requested(operation_schedule_id)
    where requested.operation_schedule_id is not null
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
  select coalesce(jsonb_agg(jsonb_build_object(
    'operationScheduleId', resolved.operation_schedule_id,
    'hotelStayId', resolved.hotel_stay_id,
    'hotelEventKind', resolved.event_kind,
    'hotelRoomTypeName', case
      when resolved.room_resolution_status = 'unavailable' then null
      else coalesce(
        resolved.current_room_type_name,
        resolved.shared_group_room_type_name,
        resolved.single_room_type_name,
        resolved.capacity_room_type_name
      )
    end,
    'hotelRoomName', case
      when resolved.room_resolution_status = 'resolved'
        then coalesce(resolved.current_room_name, resolved.single_room_name)
      else null
    end,
    'hotelSharedRoom', resolved.shared_group_count > 0,
    'roomResolutionStatus', resolved.room_resolution_status
  ) order by resolved.operation_schedule_id), '[]'::jsonb)
  into result
  from resolved;

  return result;
end;
$$;

comment on function public.get_operation_hotel_room_projections(uuid[])
is 'Batch-resolves uniquely provable current Shared and temporal Single Hotel room presentation; ambiguous or unprovable relations fail closed without mutating business data.';

revoke all on function public.get_operation_hotel_room_projections(uuid[])
  from public, anon;
grant execute on function public.get_operation_hotel_room_projections(uuid[])
  to authenticated, service_role;

commit;
