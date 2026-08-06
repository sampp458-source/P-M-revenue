-- Hotel Room Board extension: atomic unassignment and cross-room-type moves.
-- Append-only: existing Hotel, Operations, and Finance functions are unchanged.

begin;

do $$
begin
  if to_regclass('public.hotel_stays') is null
    or to_regclass('public.hotel_capacity_reservations') is null
    or to_regclass('public.hotel_room_allocations') is null
    or to_regclass('public.hotel_rooms') is null
    or to_regclass('public.hotel_room_types') is null
    or to_regclass('public.hotel_stay_schedule_events') is null
    or to_regclass('public.operation_schedules') is null
    or to_regclass('public.entity_audit_events') is null then
    raise exception 'STOP_HOTEL_ROOM_BOARD_REQUIRED_TABLES_MISSING';
  end if;

  if to_regprocedure('public.is_active_operation_member()') is null
    or to_regprocedure('public.has_operation_role(text[])') is null
    or to_regprocedure(
      'public.assert_hotel_capacity_available(uuid,timestamp with time zone,timestamp with time zone,integer,uuid)'
    ) is null
    or to_regprocedure(
      'public.assert_hotel_room_allocation_available(uuid,uuid,timestamp with time zone,timestamp with time zone,uuid)'
    ) is null
    or to_regprocedure('public.hotel_stay_json(uuid)') is null then
    raise exception 'STOP_HOTEL_ROOM_BOARD_REQUIRED_FUNCTIONS_MISSING';
  end if;

  if to_regprocedure(
      'public.unassign_hotel_room_before_check_in(uuid,integer,text,uuid)'
    ) is not null
    or to_regprocedure(
      'public.change_room_type_before_check_in(uuid,integer,uuid,text,uuid)'
    ) is not null
    or to_regprocedure(
      'public.change_room_type_after_check_in(uuid,integer,uuid,timestamp with time zone,text,uuid)'
    ) is not null then
    raise exception 'STOP_HOTEL_ROOM_BOARD_EXTENSION_ALREADY_EXISTS';
  end if;
end;
$$;

create function public.unassign_hotel_room_before_check_in(
  p_hotel_stay_id uuid,
  p_expected_version integer,
  p_reason text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  normalized_reason text := nullif(btrim(p_reason), '');
  root_reason text;
  stay_row public.hotel_stays%rowtype;
  capacity_row public.hotel_capacity_reservations%rowtype;
  allocation_row public.hotel_room_allocations%rowtype;
  room_row public.hotel_rooms%rowtype;
  capacity_count integer;
  allocation_count integer;
  root_audit_count integer;
  replay_audit public.entity_audit_events%rowtype;
begin
  if actor_id is null or not public.is_active_operation_member() then
    raise exception '호실 배정 해제 권한이 없습니다.' using errcode = '42501';
  end if;
  if p_hotel_stay_id is null or p_expected_version is null
    or p_request_id is null or normalized_reason is null then
    raise exception '호텔 예약, 기존 버전, 해제 사유, 요청 ID가 필요합니다.'
      using errcode = '22023';
  end if;

  root_reason := format('호실 배정 해제 · %s', normalized_reason);
  perform pg_advisory_xact_lock(
    hashtextextended('hotel-request:' || p_request_id::text, 0)
  );

  select audit.* into replay_audit
  from public.entity_audit_events audit
  where audit.request_id = p_request_id
  order by audit.created_at, audit.id
  limit 1;
  if found then
    if replay_audit.module_code <> 'hotel_operations'
      or replay_audit.entity_type <> 'hotel_stays'
      or replay_audit.entity_id <> p_hotel_stay_id
      or replay_audit.change_reason is distinct from root_reason
      or 1 <> (
        select count(*)
        from public.hotel_capacity_reservations capacity
        where capacity.hotel_stay_id = p_hotel_stay_id
          and capacity.archived_at is null
          and capacity.room_type_id is not null
      )
      or exists (
        select 1
        from public.hotel_room_allocations allocation
        join public.hotel_capacity_reservations capacity
          on capacity.id = allocation.capacity_reservation_id
        where capacity.hotel_stay_id = p_hotel_stay_id
          and capacity.archived_at is null
          and allocation.archived_at is null
      ) then
      raise exception '동일 request_id의 입력 계약 불일치'
        using errcode = '23505';
    end if;
    return public.hotel_stay_json(p_hotel_stay_id);
  end if;

  select stay.* into stay_row
  from public.hotel_stays stay
  where stay.id = p_hotel_stay_id
  for update;
  if not found or stay_row.archived_at is not null then
    raise exception '활성 호텔 예약을 확인할 수 없습니다.' using errcode = 'P0002';
  end if;
  if stay_row.version <> p_expected_version then
    raise exception '다른 사용자가 먼저 호텔 예약을 수정했습니다.' using errcode = '40001';
  end if;
  if stay_row.checked_in_at is not null then
    raise exception '입실 완료 후에는 호실 배정을 해제할 수 없습니다.' using errcode = '22023';
  end if;
  if stay_row.checked_out_at is not null then
    raise exception '퇴실 완료된 예약의 호실 배정은 해제할 수 없습니다.' using errcode = '22023';
  end if;

  select count(*)::integer into capacity_count
  from public.hotel_capacity_reservations capacity
  where capacity.hotel_stay_id = p_hotel_stay_id
    and capacity.archived_at is null;
  if capacity_count <> 1 then
    raise exception '활성 Capacity가 정확히 한 건이어야 합니다.' using errcode = '22023';
  end if;
  select capacity.* into capacity_row
  from public.hotel_capacity_reservations capacity
  where capacity.hotel_stay_id = p_hotel_stay_id
    and capacity.archived_at is null
  for update;
  if capacity_row.room_type_id is null then
    raise exception '객실 유형이 확정된 예약만 호실 배정을 해제할 수 있습니다.'
      using errcode = '22023';
  end if;

  select count(*)::integer into allocation_count
  from public.hotel_room_allocations allocation
  where allocation.capacity_reservation_id = capacity_row.id
    and allocation.archived_at is null;
  if allocation_count <> 1 then
    raise exception '입실 전 활성 호실 배정이 정확히 한 건이어야 합니다.'
      using errcode = '22023';
  end if;
  select allocation.* into allocation_row
  from public.hotel_room_allocations allocation
  where allocation.capacity_reservation_id = capacity_row.id
    and allocation.archived_at is null
  for update;
  select room.* into room_row
  from public.hotel_rooms room
  where room.id = allocation_row.room_id;
  if not found then
    raise exception '기존 배정 호실을 확인할 수 없습니다.' using errcode = 'P0002';
  end if;

  -- Existing advisory key contract: Room Type -> Room.
  perform pg_advisory_xact_lock(
    hashtextextended('hotel-capacity:' || capacity_row.room_type_id::text, 0)
  );
  perform pg_advisory_xact_lock(
    hashtextextended('hotel-room:' || allocation_row.room_id::text, 0)
  );

  perform set_config(
    'app.operation_change_reason',
    format('호실 배정 해제 · %s · %s', room_row.name, normalized_reason),
    true
  );
  perform set_config('app.operation_request_id', '', true);
  update public.hotel_room_allocations allocation
  set archived_at = clock_timestamp(),
      archived_by = actor_id,
      archive_reason = normalized_reason,
      updated_by = actor_id
  where allocation.id = allocation_row.id;

  perform set_config('app.operation_change_reason', root_reason, true);
  perform set_config('app.operation_request_id', p_request_id::text, true);
  update public.hotel_stays stay
  set updated_by = actor_id
  where stay.id = p_hotel_stay_id;

  select count(*)::integer into root_audit_count
  from public.entity_audit_events audit
  where audit.module_code = 'hotel_operations'
    and audit.entity_type = 'hotel_stays'
    and audit.entity_id = p_hotel_stay_id
    and audit.request_id = p_request_id;
  if root_audit_count <> 1 then
    raise exception 'Hotel Stay Root Audit이 정확히 한 건 기록되어야 합니다.'
      using errcode = 'P0001';
  end if;
  return public.hotel_stay_json(p_hotel_stay_id);
end;
$$;

create function public.change_room_type_before_check_in(
  p_hotel_stay_id uuid,
  p_expected_version integer,
  p_new_room_id uuid,
  p_reason text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  normalized_reason text := nullif(btrim(p_reason), '');
  root_reason text;
  stay_row public.hotel_stays%rowtype;
  capacity_row public.hotel_capacity_reservations%rowtype;
  allocation_row public.hotel_room_allocations%rowtype;
  old_room public.hotel_rooms%rowtype;
  new_room public.hotel_rooms%rowtype;
  old_room_type public.hotel_room_types%rowtype;
  new_room_type public.hotel_room_types%rowtype;
  capacity_count integer;
  allocation_count integer;
  schedule_count integer;
  root_audit_count integer;
  lock_id uuid;
  replay_audit public.entity_audit_events%rowtype;
begin
  if actor_id is null
    or not public.has_operation_role(array['owner', 'manager']) then
    raise exception 'Operations Owner/Manager만 객실 유형을 변경할 수 있습니다.'
      using errcode = '42501';
  end if;
  if p_hotel_stay_id is null or p_expected_version is null
    or p_new_room_id is null or p_request_id is null
    or normalized_reason is null then
    raise exception '호텔 예약, 기존 버전, 새 호실, 변경 사유, 요청 ID가 필요합니다.'
      using errcode = '22023';
  end if;

  select room.* into new_room
  from public.hotel_rooms room
  where room.id = p_new_room_id
    and room.is_active and room.archived_at is null;
  if not found then
    raise exception '활성 대상 호실을 확인할 수 없습니다.' using errcode = 'P0002';
  end if;
  select room_type.* into new_room_type
  from public.hotel_room_types room_type
  where room_type.id = new_room.room_type_id
    and room_type.is_active and room_type.archived_at is null;
  if not found then
    raise exception '활성 대상 객실 유형을 확인할 수 없습니다.' using errcode = 'P0002';
  end if;

  root_reason := format(
    '입실 전 객실 유형 변경 · room=%s · type=%s · %s',
    p_new_room_id, new_room_type.id, normalized_reason
  );
  perform pg_advisory_xact_lock(
    hashtextextended('hotel-request:' || p_request_id::text, 0)
  );
  select audit.* into replay_audit
  from public.entity_audit_events audit
  where audit.request_id = p_request_id
  order by audit.created_at, audit.id
  limit 1;
  if found then
    if replay_audit.module_code <> 'hotel_operations'
      or replay_audit.entity_type <> 'hotel_stays'
      or replay_audit.entity_id <> p_hotel_stay_id
      or replay_audit.change_reason is distinct from root_reason
      or 1 <> (
        select count(*)
        from public.hotel_capacity_reservations capacity
        join public.hotel_room_allocations allocation
          on allocation.capacity_reservation_id = capacity.id
         and allocation.archived_at is null
        where capacity.hotel_stay_id = p_hotel_stay_id
          and capacity.archived_at is null
          and capacity.room_type_id = new_room.room_type_id
          and allocation.room_id = p_new_room_id
      ) then
      raise exception '동일 request_id의 입력 계약 불일치'
        using errcode = '23505';
    end if;
    return public.hotel_stay_json(p_hotel_stay_id);
  end if;

  select stay.* into stay_row
  from public.hotel_stays stay
  where stay.id = p_hotel_stay_id
  for update;
  if not found or stay_row.archived_at is not null then
    raise exception '활성 호텔 예약을 확인할 수 없습니다.' using errcode = 'P0002';
  end if;
  if stay_row.version <> p_expected_version then
    raise exception '다른 사용자가 먼저 호텔 예약을 수정했습니다.' using errcode = '40001';
  end if;
  if stay_row.checked_in_at is not null or stay_row.checked_out_at is not null then
    raise exception '입실 전 예약만 이 기능으로 객실 유형을 변경할 수 있습니다.'
      using errcode = '22023';
  end if;

  select count(*)::integer into capacity_count
  from public.hotel_capacity_reservations capacity
  where capacity.hotel_stay_id = p_hotel_stay_id
    and capacity.archived_at is null;
  if capacity_count <> 1 then
    raise exception '활성 Capacity가 정확히 한 건이어야 합니다.' using errcode = '22023';
  end if;
  select capacity.* into capacity_row
  from public.hotel_capacity_reservations capacity
  where capacity.hotel_stay_id = p_hotel_stay_id
    and capacity.archived_at is null
  for update;
  if capacity_row.room_type_id is null then
    raise exception '기존 객실 유형이 확정된 예약만 변경할 수 있습니다.'
      using errcode = '22023';
  end if;
  if capacity_row.room_type_id = new_room.room_type_id then
    raise exception '같은 객실 유형은 기존 호실 재배정 기능을 사용해 주세요.'
      using errcode = '22023';
  end if;

  select count(*)::integer into allocation_count
  from public.hotel_room_allocations allocation
  where allocation.capacity_reservation_id = capacity_row.id
    and allocation.archived_at is null;
  if allocation_count <> 1 then
    raise exception '입실 전 활성 호실 배정이 정확히 한 건이어야 합니다.'
      using errcode = '22023';
  end if;
  select allocation.* into allocation_row
  from public.hotel_room_allocations allocation
  where allocation.capacity_reservation_id = capacity_row.id
    and allocation.archived_at is null
  for update;
  select room.* into old_room from public.hotel_rooms room
  where room.id = allocation_row.room_id;
  select room_type.* into old_room_type
  from public.hotel_room_types room_type
  where room_type.id = capacity_row.room_type_id;
  if old_room.id is null or old_room_type.id is null then
    raise exception '기존 호실 또는 객실 유형을 확인할 수 없습니다.' using errcode = 'P0002';
  end if;

  perform schedule.id
  from public.hotel_stay_schedule_events event
  join public.operation_schedules schedule
    on schedule.id = event.operation_schedule_id
  where event.hotel_stay_id = p_hotel_stay_id
    and event.archived_at is null
    and event.event_kind in ('check_in', 'check_out')
    and schedule.archived_at is null
  order by schedule.id
  for update of schedule;
  get diagnostics schedule_count = row_count;
  if schedule_count <> 2 then
    raise exception '활성 입실·퇴실 Schedule이 정확히 두 건이어야 합니다.'
      using errcode = 'P0002';
  end if;
  -- Existing advisory keys, deterministic UUID order: Types -> Rooms -> Total.
  for lock_id in
    select distinct candidate.id
    from (values (old_room_type.id), (new_room_type.id)) candidate(id)
    order by candidate.id
  loop
    perform pg_advisory_xact_lock(
      hashtextextended('hotel-capacity:' || lock_id::text, 0)
    );
  end loop;
  for lock_id in
    select distinct candidate.id
    from (values (old_room.id), (new_room.id)) candidate(id)
    order by candidate.id
  loop
    perform pg_advisory_xact_lock(
      hashtextextended('hotel-room:' || lock_id::text, 0)
    );
  end loop;

  perform public.assert_hotel_capacity_available(
    new_room_type.id, capacity_row.reserved_from, capacity_row.reserved_until,
    capacity_row.quantity, capacity_row.id
  );
  if exists (
    select 1 from public.hotel_room_allocations other_allocation
    where other_allocation.room_id = new_room.id
      and other_allocation.archived_at is null
      and other_allocation.id <> allocation_row.id
      and other_allocation.allocated_from < capacity_row.reserved_until
      and other_allocation.allocated_until > capacity_row.reserved_from
  ) then
    raise exception '선택한 기간에 이미 사용 중인 호실입니다.' using errcode = '23P01';
  end if;

  perform set_config(
    'app.operation_change_reason',
    format(
      '입실 전 객실 유형 변경 · %s → %s · %s · %s',
      old_room_type.code, new_room_type.code, new_room.name, normalized_reason
    ),
    true
  );
  perform set_config('app.operation_request_id', '', true);
  update public.hotel_room_allocations allocation
  set archived_at = clock_timestamp(), archived_by = actor_id,
      archive_reason = normalized_reason, updated_by = actor_id
  where allocation.id = allocation_row.id;
  update public.hotel_capacity_reservations capacity
  set room_type_id = new_room_type.id, updated_by = actor_id
  where capacity.id = capacity_row.id;
  perform public.assert_hotel_room_allocation_available(
    new_room.id, capacity_row.id, capacity_row.reserved_from,
    capacity_row.reserved_until, null
  );
  insert into public.hotel_room_allocations (
    capacity_reservation_id, room_id, allocated_from, allocated_until,
    assignment_reason, request_id, created_by, updated_by
  ) values (
    capacity_row.id, new_room.id, capacity_row.reserved_from,
    capacity_row.reserved_until, normalized_reason, null, actor_id, actor_id
  );

  -- Calendar/Today display titles resolve event_kind and the current Capacity
  -- room type at read time. Keep the underlying Schedule title/version/audit
  -- unchanged when only the physical room type changes.

  perform set_config('app.operation_change_reason', root_reason, true);
  perform set_config('app.operation_request_id', p_request_id::text, true);
  update public.hotel_stays stay set updated_by = actor_id
  where stay.id = p_hotel_stay_id;

  select count(*)::integer into root_audit_count
  from public.entity_audit_events audit
  where audit.module_code = 'hotel_operations'
    and audit.entity_type = 'hotel_stays'
    and audit.entity_id = p_hotel_stay_id
    and audit.request_id = p_request_id;
  if root_audit_count <> 1 then
    raise exception 'Hotel Stay Root Audit이 정확히 한 건 기록되어야 합니다.'
      using errcode = 'P0001';
  end if;
  return public.hotel_stay_json(p_hotel_stay_id);
end;
$$;

create function public.change_room_type_after_check_in(
  p_hotel_stay_id uuid,
  p_expected_version integer,
  p_new_room_id uuid,
  p_effective_at timestamptz,
  p_reason text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  normalized_reason text := nullif(btrim(p_reason), '');
  root_reason text;
  stay_row public.hotel_stays%rowtype;
  capacity_row public.hotel_capacity_reservations%rowtype;
  allocation_row public.hotel_room_allocations%rowtype;
  old_room public.hotel_rooms%rowtype;
  new_room public.hotel_rooms%rowtype;
  old_room_type public.hotel_room_types%rowtype;
  new_room_type public.hotel_room_types%rowtype;
  capacity_count integer;
  current_allocation_count integer;
  schedule_count integer;
  root_audit_count integer;
  lock_id uuid;
  replay_audit public.entity_audit_events%rowtype;
begin
  if actor_id is null
    or not public.has_operation_role(array['owner', 'manager']) then
    raise exception 'Operations Owner/Manager만 입실 후 객실 유형을 변경할 수 있습니다.'
      using errcode = '42501';
  end if;
  if p_hotel_stay_id is null or p_expected_version is null
    or p_new_room_id is null or p_effective_at is null
    or p_request_id is null or normalized_reason is null then
    raise exception '호텔 예약, 기존 버전, 새 호실, 이동 시각, 사유, 요청 ID가 필요합니다.'
      using errcode = '22023';
  end if;
  if p_effective_at > clock_timestamp() then
    raise exception 'Room Board 즉시 이동 시각은 미래일 수 없습니다.' using errcode = '22023';
  end if;

  select room.* into new_room
  from public.hotel_rooms room
  where room.id = p_new_room_id
    and room.is_active and room.archived_at is null;
  if not found then
    raise exception '활성 대상 호실을 확인할 수 없습니다.' using errcode = 'P0002';
  end if;
  select room_type.* into new_room_type
  from public.hotel_room_types room_type
  where room_type.id = new_room.room_type_id
    and room_type.is_active and room_type.archived_at is null;
  if not found then
    raise exception '활성 대상 객실 유형을 확인할 수 없습니다.' using errcode = 'P0002';
  end if;

  root_reason := format(
    '입실 후 객실 유형 이동 · room=%s · type=%s · effective_at=%s · %s',
    p_new_room_id, new_room_type.id, p_effective_at, normalized_reason
  );
  perform pg_advisory_xact_lock(
    hashtextextended('hotel-request:' || p_request_id::text, 0)
  );
  select audit.* into replay_audit
  from public.entity_audit_events audit
  where audit.request_id = p_request_id
  order by audit.created_at, audit.id
  limit 1;
  if found then
    if replay_audit.module_code <> 'hotel_operations'
      or replay_audit.entity_type <> 'hotel_stays'
      or replay_audit.entity_id <> p_hotel_stay_id
      or replay_audit.change_reason is distinct from root_reason
      or 1 <> (
        select count(*)
        from public.hotel_capacity_reservations capacity
        join public.hotel_room_allocations allocation
          on allocation.capacity_reservation_id = capacity.id
         and allocation.archived_at is null
        where capacity.hotel_stay_id = p_hotel_stay_id
          and capacity.archived_at is null
          and capacity.room_type_id = new_room.room_type_id
          and allocation.room_id = p_new_room_id
          and allocation.allocated_from = p_effective_at
      ) then
      raise exception '동일 request_id의 입력 계약 불일치'
        using errcode = '23505';
    end if;
    return public.hotel_stay_json(p_hotel_stay_id);
  end if;

  select stay.* into stay_row
  from public.hotel_stays stay
  where stay.id = p_hotel_stay_id
  for update;
  if not found or stay_row.archived_at is not null then
    raise exception '활성 호텔 예약을 확인할 수 없습니다.' using errcode = 'P0002';
  end if;
  if stay_row.version <> p_expected_version then
    raise exception '다른 사용자가 먼저 호텔 예약을 수정했습니다.' using errcode = '40001';
  end if;
  if stay_row.checked_in_at is null or stay_row.checked_out_at is not null then
    raise exception '입실 완료 후 퇴실 전 예약만 객실 유형을 이동할 수 있습니다.'
      using errcode = '22023';
  end if;
  if p_effective_at <= stay_row.checked_in_at then
    raise exception '이동 시각은 입실 완료 시각보다 늦어야 합니다.' using errcode = '22023';
  end if;

  select count(*)::integer into capacity_count
  from public.hotel_capacity_reservations capacity
  where capacity.hotel_stay_id = p_hotel_stay_id
    and capacity.archived_at is null;
  if capacity_count <> 1 then
    raise exception '활성 Capacity가 정확히 한 건이어야 합니다.' using errcode = '22023';
  end if;
  select capacity.* into capacity_row
  from public.hotel_capacity_reservations capacity
  where capacity.hotel_stay_id = p_hotel_stay_id
    and capacity.archived_at is null
  for update;
  if capacity_row.room_type_id is null then
    raise exception '객실 유형이 확정된 예약만 이동할 수 있습니다.' using errcode = '22023';
  end if;
  if capacity_row.room_type_id = new_room.room_type_id then
    raise exception '같은 객실 유형은 기존 객실 이동 기능을 사용해 주세요.'
      using errcode = '22023';
  end if;
  if p_effective_at <= capacity_row.reserved_from
    or p_effective_at >= capacity_row.reserved_until then
    raise exception '이동 시각은 Capacity 예약 구간 안이어야 합니다.' using errcode = '22023';
  end if;

  select count(*)::integer into current_allocation_count
  from public.hotel_room_allocations allocation
  where allocation.capacity_reservation_id = capacity_row.id
    and allocation.archived_at is null
    and allocation.allocated_from < p_effective_at
    and allocation.allocated_until > p_effective_at;
  if current_allocation_count <> 1 then
    raise exception '이동 시각의 활성 호실 Allocation이 정확히 한 건이어야 합니다.'
      using errcode = '22023';
  end if;
  select allocation.* into allocation_row
  from public.hotel_room_allocations allocation
  where allocation.capacity_reservation_id = capacity_row.id
    and allocation.archived_at is null
    and allocation.allocated_from < p_effective_at
    and allocation.allocated_until > p_effective_at
  for update;
  select room.* into old_room from public.hotel_rooms room
  where room.id = allocation_row.room_id;
  select room_type.* into old_room_type
  from public.hotel_room_types room_type
  where room_type.id = capacity_row.room_type_id;
  if old_room.id is null or old_room_type.id is null then
    raise exception '기존 호실 또는 객실 유형을 확인할 수 없습니다.' using errcode = 'P0002';
  end if;

  perform schedule.id
  from public.hotel_stay_schedule_events event
  join public.operation_schedules schedule
    on schedule.id = event.operation_schedule_id
  where event.hotel_stay_id = p_hotel_stay_id
    and event.archived_at is null
    and event.event_kind in ('check_in', 'check_out')
    and schedule.archived_at is null
  order by schedule.id
  for update of schedule;
  get diagnostics schedule_count = row_count;
  if schedule_count <> 2 then
    raise exception '활성 입실·퇴실 Schedule이 정확히 두 건이어야 합니다.'
      using errcode = 'P0002';
  end if;
  -- Existing advisory keys, deterministic UUID order: Types -> Rooms -> Total.
  for lock_id in
    select distinct candidate.id
    from (values (old_room_type.id), (new_room_type.id)) candidate(id)
    order by candidate.id
  loop
    perform pg_advisory_xact_lock(
      hashtextextended('hotel-capacity:' || lock_id::text, 0)
    );
  end loop;
  for lock_id in
    select distinct candidate.id
    from (values (old_room.id), (new_room.id)) candidate(id)
    order by candidate.id
  loop
    perform pg_advisory_xact_lock(
      hashtextextended('hotel-room:' || lock_id::text, 0)
    );
  end loop;

  -- Current single-Capacity contract reclassifies the Stay for its full interval.
  perform public.assert_hotel_capacity_available(
    new_room_type.id, capacity_row.reserved_from, capacity_row.reserved_until,
    capacity_row.quantity, capacity_row.id
  );
  if exists (
    select 1 from public.hotel_room_allocations other_allocation
    where other_allocation.room_id = new_room.id
      and other_allocation.archived_at is null
      and other_allocation.id <> allocation_row.id
      and other_allocation.allocated_from < capacity_row.reserved_until
      and other_allocation.allocated_until > p_effective_at
  ) then
    raise exception '선택한 기간에 이미 사용 중인 호실입니다.' using errcode = '23P01';
  end if;

  perform set_config(
    'app.operation_change_reason',
    format(
      '입실 후 객실 유형 이동 · %s → %s · %s · %s',
      old_room_type.code, new_room_type.code, new_room.name, normalized_reason
    ),
    true
  );
  perform set_config('app.operation_request_id', '', true);
  update public.hotel_room_allocations allocation
  set allocated_until = p_effective_at,
      assignment_reason = normalized_reason,
      updated_by = actor_id
  where allocation.id = allocation_row.id;
  update public.hotel_capacity_reservations capacity
  set room_type_id = new_room_type.id, updated_by = actor_id
  where capacity.id = capacity_row.id;
  perform public.assert_hotel_room_allocation_available(
    new_room.id, capacity_row.id, p_effective_at,
    capacity_row.reserved_until, null
  );
  insert into public.hotel_room_allocations (
    capacity_reservation_id, room_id, allocated_from, allocated_until,
    assignment_reason, request_id, created_by, updated_by
  ) values (
    capacity_row.id, new_room.id, p_effective_at,
    capacity_row.reserved_until, normalized_reason, null, actor_id, actor_id
  );

  -- Room Board phases and Calendar titles are UI resolvers over event_kind,
  -- selected KST date and the current Capacity room type. No Schedule mutation.

  perform set_config('app.operation_change_reason', root_reason, true);
  perform set_config('app.operation_request_id', p_request_id::text, true);
  update public.hotel_stays stay set updated_by = actor_id
  where stay.id = p_hotel_stay_id;

  select count(*)::integer into root_audit_count
  from public.entity_audit_events audit
  where audit.module_code = 'hotel_operations'
    and audit.entity_type = 'hotel_stays'
    and audit.entity_id = p_hotel_stay_id
    and audit.request_id = p_request_id;
  if root_audit_count <> 1 then
    raise exception 'Hotel Stay Root Audit이 정확히 한 건 기록되어야 합니다.'
      using errcode = 'P0001';
  end if;
  return public.hotel_stay_json(p_hotel_stay_id);
end;
$$;

revoke all on function public.unassign_hotel_room_before_check_in(
  uuid, integer, text, uuid
) from public, anon;
grant execute on function public.unassign_hotel_room_before_check_in(
  uuid, integer, text, uuid
) to authenticated;

revoke all on function public.change_room_type_before_check_in(
  uuid, integer, uuid, text, uuid
) from public, anon;
grant execute on function public.change_room_type_before_check_in(
  uuid, integer, uuid, text, uuid
) to authenticated;

revoke all on function public.change_room_type_after_check_in(
  uuid, integer, uuid, timestamptz, text, uuid
) from public, anon;
grant execute on function public.change_room_type_after_check_in(
  uuid, integer, uuid, timestamptz, text, uuid
) to authenticated;

commit;
