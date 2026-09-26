-- Hotel authority follows canonical stay/event linkage, never calendar color,
-- a client flag, or a caller-controlled session setting. No data rewrite.
begin;

do $$
declare
  expected record;
begin
  for expected in select * from (values
    ('public.cancel_shared_hotel_room_family_booking(uuid,integer,text,uuid)', '06e70306e5ad2385ddacc24a3d8e6ae9'),
    ('public.guard_requested_shared_room_member_mutation()', '1fc3f20b20f6527efa275f4421b4f6d8'),
    ('public.can_manage_operation_schedule(uuid)', '63a85e98726ce6dc65a72adc9f797351'),
    ('public.is_active_operation_member()', '5a1d145fdebf110d71cbe8031285b7ed'),
    ('public.has_operation_role(text[])', '78ba8d9da51c804cc61ecc3a458d80e4'),
    ('public.enforce_operation_schedule_write_permission()', 'b846c23875846110dd6123b5fb1e4cb9'),
    ('public.sync_hotel_lifecycle_schedule_status_internal()', '0bb06b5007bf849f15961657899bcdf7')
  ) as guards(signature, definition_md5) loop
    if to_regprocedure(expected.signature) is null or
      md5(pg_get_functiondef(to_regprocedure(expected.signature))) is distinct from expected.definition_md5 then
      raise exception 'STOP_HOTEL_PERMISSION_PREDECESSOR_MISMATCH: %', expected.signature;
    end if;
  end loop;
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.operation_schedules'::regclass
      and tgname = 'operation_schedules_write_permission'
      and tgfoid = 'public.enforce_operation_schedule_write_permission()'::regprocedure
      and tgenabled = 'O' and not tgisinternal
  ) or not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.hotel_stays'::regclass
      and tgname = 'hotel_stays_calendar_lifecycle_sync'
      and tgfoid = 'public.sync_hotel_lifecycle_schedule_status_internal()'::regprocedure
      and tgenabled = 'O' and not tgisinternal
  ) then
    raise exception 'STOP_HOTEL_PERMISSION_TRIGGER_MISMATCH';
  end if;
end;
$$;

-- CREATE OR REPLACE preserves the existing signature, owner and execute ACL.
-- The enclosing active-member check also governs the Hotel exception.
create or replace function public.can_manage_operation_schedule(p_schedule_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
    and public.is_active_operation_member()
    and (
      public.has_operation_role(array['manager', 'owner'])
      or exists (
        select 1 from public.operation_schedules schedule
        where schedule.id = p_schedule_id and schedule.created_by = auth.uid()
      )
      or exists (
        select 1 from public.operation_schedule_assignees assignee
        where assignee.schedule_id = p_schedule_id
          and assignee.profile_id = auth.uid() and assignee.archived_at is null
      )
      or exists (
        select 1
        from public.hotel_stay_schedule_events event
        join public.hotel_stays stay on stay.id = event.hotel_stay_id
        join public.operation_schedules schedule on schedule.id = event.operation_schedule_id
        join public.operation_calendars calendar on calendar.id = schedule.calendar_id
        join public.business_units unit on unit.id = calendar.business_unit_id
        where event.operation_schedule_id = p_schedule_id
          and event.event_kind in ('check_in', 'check_out')
          and event.archived_at is null and stay.archived_at is null
          and schedule.archived_at is null and unit.code = 'hotel'
      )
    );
$$;

-- Keep the existing whole-group RPC; only its atomic write order changes.
CREATE OR REPLACE FUNCTION public.cancel_shared_hotel_room_family_booking(p_shared_room_group_id uuid, p_expected_version integer, p_reason text, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  actor_id uuid := auth.uid();
  normalized_reason text := nullif(btrim(p_reason), '');
  payload jsonb;
  replay jsonb;
  shared_group public.family_shared_room_groups%rowtype;
  family public.family_bookings%rowtype;
  capacity public.hotel_capacity_reservations%rowtype;
  schedule public.operation_schedules%rowtype;
  member_count integer;
  capacity_count integer;
  result jsonb;
begin
  if actor_id is null or not public.is_active_operation_member() then
    raise exception '함께 투숙 예약 취소 권한이 없습니다.' using errcode = '42501';
  end if;
  if p_shared_room_group_id is null or p_expected_version is null
    or normalized_reason is null or p_request_id is null then
    raise exception 'Shared Room Group, 기존 버전, 취소 사유, 요청 ID가 필요합니다.' using errcode = '22023';
  end if;
  payload := jsonb_build_object(
    'sharedRoomGroupId', p_shared_room_group_id,
    'expectedVersion', p_expected_version,
    'reason', normalized_reason
  );
  replay := public.claim_shared_hotel_request_internal(
    p_request_id, 'cancel_booking', payload, null
  );
  if replay is not null then return replay; end if;

  select * into shared_group from public.family_shared_room_groups target
  where target.id = p_shared_room_group_id for update;
  if not found or shared_group.archived_at is not null or shared_group.status <> 'requested' then
    raise exception '미배정 상태의 Shared Room Group만 취소할 수 있습니다.' using errcode = 'PT409';
  end if;
  if shared_group.version <> p_expected_version then
    raise exception '다른 사용자가 먼저 함께 투숙 예약을 수정했습니다.' using errcode = 'PT409';
  end if;
  select * into family from public.family_bookings target
  where target.id = shared_group.family_booking_id and target.archived_at is null
  for update;
  if not found then raise exception 'Family Booking을 확인할 수 없습니다.' using errcode = 'P0002'; end if;

  perform 1
  from public.family_booking_members member
  join public.hotel_stays stay on stay.id = member.hotel_stay_id
  where member.shared_room_group_id = shared_group.id and member.archived_at is null
  order by stay.id for update of member, stay;
  select count(*)::integer into member_count
  from public.family_booking_members member
  where member.shared_room_group_id = shared_group.id
    and member.family_booking_id = family.id and member.service_type = 'hotel'
    and member.archived_at is null;
  if member_count <> shared_group.requested_capacity or member_count < 2
    or exists (
      select 1 from public.family_booking_members member
      join public.hotel_stays stay on stay.id = member.hotel_stay_id
      join public.dogs dog on dog.id = member.dog_id
      where member.shared_room_group_id = shared_group.id and member.archived_at is null
        and (stay.archived_at is not null or stay.checked_in_at is not null
          or stay.checked_out_at is not null or dog.customer_id <> family.customer_id)
    ) then
    raise exception '입실 전 정상 상태의 Shared Room만 취소할 수 있습니다.' using errcode = 'PT409';
  end if;
  if exists (
    select 1 from public.hotel_physical_occupancies occupancy
    where occupancy.shared_room_group_id = shared_group.id and occupancy.archived_at is null
  ) or exists (
    select 1 from public.hotel_physical_occupancy_members physical_member
    join public.hotel_physical_occupancies occupancy on occupancy.id = physical_member.occupancy_id
    where occupancy.shared_room_group_id = shared_group.id and physical_member.archived_at is null
  ) then
    raise exception '객실 배정 상태에서는 함께 투숙 예약을 바로 취소할 수 없습니다.' using errcode = 'PT409';
  end if;

  select count(*)::integer into capacity_count
  from public.hotel_capacity_reservations target
  where target.shared_room_group_id = shared_group.id
    and target.source_kind = 'shared_group' and target.archived_at is null;
  select * into capacity from public.hotel_capacity_reservations target
  where target.shared_room_group_id = shared_group.id
    and target.source_kind = 'shared_group' and target.archived_at is null
  for update;
  if capacity_count <> 1 or capacity.quantity <> 1
    or capacity.physical_occupancy_id is not null
    or capacity.room_type_id <> shared_group.room_type_id
    or capacity.reserved_from <> shared_group.normalized_starts_at
    or capacity.reserved_until <> shared_group.normalized_ends_at
    or exists (
      select 1 from public.hotel_room_allocations allocation
      where allocation.capacity_reservation_id = capacity.id and allocation.archived_at is null
    ) or not exists (
      select 1 from public.hotel_room_types room_type
      where room_type.id = capacity.room_type_id and room_type.archived_at is null
        and room_type.is_active and upper(btrim(room_type.code)) = 'DELUXE'
    ) then
    raise exception '미배정 Shared Room Capacity 계약이 올바르지 않습니다.' using errcode = '23514';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('hotel-capacity:all', 0));
  perform pg_advisory_xact_lock(hashtextextended('hotel-capacity:' || capacity.room_type_id::text, 0));
  -- All group/state/capacity checks and locks above remain mandatory.
  -- Mark this validated whole-group cancellation before member mutations.
  -- The requested-member guard remains active for every individual command;
  -- any later error rolls back this status change and all cancellation work.
  perform set_config('app.operation_change_reason', normalized_reason, true);
  perform set_config('app.operation_request_id', p_request_id::text, true);
  update public.family_shared_room_groups target
  set status = 'cancelled', updated_by = actor_id
  where target.id = shared_group.id;
  for schedule in
    select operation_schedule.*
    from public.hotel_stay_schedule_events event
    join public.operation_schedules operation_schedule on operation_schedule.id = event.operation_schedule_id
    join public.family_booking_members member on member.hotel_stay_id = event.hotel_stay_id
    where member.shared_room_group_id = shared_group.id
      and member.archived_at is null and event.archived_at is null
    order by operation_schedule.id
  loop
    if not public.can_manage_operation_schedule(schedule.id) then
      raise exception '호텔 예약 생성자 또는 담당자만 취소할 수 있습니다.' using errcode = '42501';
    end if;
    if schedule.status <> 'cancelled' then
      perform public.set_operation_schedule_status(
        schedule.id, schedule.version, 'cancelled', normalized_reason, gen_random_uuid()
      );
    end if;
  end loop;

  perform set_config('app.operation_change_reason', normalized_reason, true);
  perform set_config('app.operation_request_id', p_request_id::text, true);
  update public.hotel_capacity_reservations target
  set archived_at = now(), archived_by = actor_id, archive_reason = normalized_reason,
      updated_by = actor_id
  where target.id = capacity.id;
  update public.hotel_stays target
  set archived_at = now(), archived_by = actor_id, archive_reason = normalized_reason,
      updated_by = actor_id
  where target.id in (
    select member.hotel_stay_id from public.family_booking_members member
    where member.shared_room_group_id = shared_group.id and member.archived_at is null
  );
  update public.family_booking_members target
  set status = 'cancelled', updated_by = actor_id
  where target.shared_room_group_id = shared_group.id and target.archived_at is null;
  update public.family_bookings target
  set status = public.family_booking_derived_status(target.id), updated_by = actor_id
  where target.id = family.id;

  select jsonb_build_object(
    'sharedRoomGroupId', target.id,
    'familyBookingId', family.id,
    'sharedRoomGroupStatus', target.status,
    'familyBookingStatus', public.family_booking_derived_status(family.id),
    'version', target.version
  ) into result
  from public.family_shared_room_groups target where target.id = shared_group.id;
  return public.finish_shared_hotel_request_internal(p_request_id, null, result);
end;
$function$;

commit;
