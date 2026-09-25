-- Cutover: actual Hotel check-in >= 2026-09-25 00:00:00 Asia/Seoul.
-- Pre-cutover records are not inherited as physical holds; no data backfill.
-- Planned intervals are unchanged. Actual use is guarded separately.
-- Append-only; no business-row rewrite, stored overdue state or public RPC signature change.
BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.get_hotel_operations_snapshot_v2(date)') IS NULL
    OR to_regprocedure('public.complete_hotel_check_out(uuid,integer,timestamptz,uuid)') IS NULL
    OR to_regprocedure('public.hotel_single_room_eligibility_internal(uuid,text,timestamptz)') IS NULL
    OR to_regprocedure('public.complete_shared_hotel_member_check_out(uuid,uuid,integer,integer,timestamptz,uuid)') IS NULL
    OR to_regclass('public.daycare_operation_states') IS NULL
    OR to_regclass('public.long_stay_absence_events') IS NULL THEN
    RAISE EXCEPTION 'STOP_PHYSICAL_OCCUPANCY_MISSING_PREDECESSOR';
  END IF;
END $$;


-- Exact predecessor bodies: fail closed on an unexpected installed contract.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM (VALUES
    ('public.get_hotel_operations_snapshot(date)','655417d618ef44206fe8274e026b7ae9'),
    ('public.complete_hotel_check_out(uuid,integer,timestamptz,uuid)','7744baa7276dcb70676ec593e8ddc0e6'),
    ('public.get_hotel_operations_snapshot_v2(date)','7dac53943e2f74f207de1cd36d5023fb'),
    ('public.get_hotel_shared_room_occupancies(date)','7a52aee4d105736f18a48176df0a701b'),
    ('public.complete_shared_hotel_member_check_out(uuid,uuid,integer,integer,timestamptz,uuid)','c4da96cc8def147edd5a52a8844b9508'),
    ('public.hotel_single_room_eligibility_internal(uuid,text,timestamptz)','8e1ec0b36c21013a40cd60b58d61569b')
    ) expected(signature,body_md5)
    LEFT JOIN pg_proc p ON p.oid=to_regprocedure(expected.signature)
    WHERE p.oid IS NULL OR md5(p.prosrc)<>expected.body_md5
  ) THEN RAISE EXCEPTION 'STOP_PHYSICAL_OCCUPANCY_UNEXPECTED_PREDECESSOR'; END IF;
END $$;

CREATE FUNCTION public.hotel_current_physical_rooms_internal()
RETURNS TABLE(room_id uuid, capacity_id uuid, stay_id uuid, occupancy_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  -- Active capacity segment excludes Long Stay release-room absence history.
  SELECT a.room_id,c.id,s.id,NULL::uuid
  FROM public.hotel_stays s
  JOIN public.hotel_capacity_reservations c ON c.hotel_stay_id=s.id AND c.archived_at IS NULL
  CROSS JOIN LATERAL (
    SELECT x.room_id FROM public.hotel_room_allocations x
    WHERE x.capacity_reservation_id=c.id AND x.archived_at IS NULL
      AND x.allocated_from<=statement_timestamp()
    ORDER BY x.allocated_from DESC,x.id DESC LIMIT 1
  ) a
  WHERE s.archived_at IS NULL AND s.checked_in_at>=timestamptz '2026-09-25 00:00:00+09' AND s.checked_in_at<=statement_timestamp() AND s.checked_out_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM public.hotel_physical_occupancy_members m
      WHERE m.hotel_stay_id=s.id AND m.archived_at IS NULL AND m.status='active')
  UNION ALL
  SELECT o.room_id,o.capacity_reservation_id,s.id,o.id
  FROM public.hotel_physical_occupancies o
  JOIN public.hotel_physical_occupancy_members m ON m.occupancy_id=o.id AND m.archived_at IS NULL AND m.status='active'
  JOIN public.hotel_stays s ON s.id=m.hotel_stay_id
  WHERE o.archived_at IS NULL AND o.status='active'
    AND s.archived_at IS NULL AND s.checked_in_at>=timestamptz '2026-09-25 00:00:00+09' AND s.checked_in_at<=statement_timestamp() AND s.checked_out_at IS NULL
  UNION ALL
  SELECT a.room_id,c.id,NULL::uuid,NULL::uuid
  FROM public.daycare_operation_states d
  JOIN public.hotel_capacity_reservations c ON c.daycare_schedule_id=d.operation_schedule_id AND c.archived_at IS NULL
  CROSS JOIN LATERAL (SELECT x.room_id FROM public.hotel_room_allocations x
    WHERE x.capacity_reservation_id=c.id AND x.archived_at IS NULL AND x.allocated_from<=statement_timestamp()
    ORDER BY x.allocated_from DESC,x.id DESC LIMIT 1) a
  WHERE d.lifecycle_status='checked_in'
$$;
REVOKE ALL ON FUNCTION public.hotel_current_physical_rooms_internal() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.assert_hotel_physical_room_available_internal(p_room_id uuid,p_capacity_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  -- Same lock as existing allocation commands; fresh read after lock acquisition.
  PERFORM pg_advisory_xact_lock(hashtextextended('hotel-room:'||p_room_id::text,0));
  IF EXISTS (SELECT 1 FROM public.hotel_current_physical_rooms_internal() p
    WHERE p.room_id=p_room_id AND p.capacity_id IS DISTINCT FROM p_capacity_id) THEN
    RAISE EXCEPTION '실제 퇴실이 완료되지 않은 호실입니다.' USING errcode='23P01';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.assert_hotel_physical_room_available_internal(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

-- Covers every allocation writer, including Shared and Long Stay return. Future
-- planning is allowed; shortened/closed historical segments are not new room use.
CREATE FUNCTION public.guard_hotel_physical_allocation_internal()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  -- Closing a historical segment does not acquire a room again.
  IF TG_OP='UPDATE' AND NEW.room_id=OLD.room_id
    AND NEW.capacity_reservation_id=OLD.capacity_reservation_id
    AND NEW.allocated_from=OLD.allocated_from
    AND NEW.allocated_until<=OLD.allocated_until AND OLD.archived_at IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.archived_at IS NULL AND NEW.allocated_from<=statement_timestamp()
    AND (NEW.allocated_until>statement_timestamp()
      OR EXISTS (SELECT 1 FROM public.hotel_capacity_reservations c JOIN public.hotel_stays s ON s.id=c.hotel_stay_id
        WHERE c.id=NEW.capacity_reservation_id AND s.archived_at IS NULL AND s.checked_in_at>=timestamptz '2026-09-25 00:00:00+09' AND s.checked_out_at IS NULL)
      OR EXISTS (SELECT 1 FROM public.hotel_current_physical_rooms_internal() p WHERE p.capacity_id=NEW.capacity_reservation_id)) THEN
    PERFORM public.assert_hotel_physical_room_available_internal(NEW.room_id,NEW.capacity_reservation_id);
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_hotel_physical_allocation_internal() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER hotel_physical_allocation_guard
BEFORE INSERT OR UPDATE ON public.hotel_room_allocations
FOR EACH ROW EXECUTE FUNCTION public.guard_hotel_physical_allocation_internal();

-- Preassigned rooms must be rechecked on actual entry/reversal, even if the UI is stale.
CREATE FUNCTION public.guard_hotel_physical_check_in_internal()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE a record;
BEGIN
  IF NEW.archived_at IS NULL AND NEW.checked_in_at>=timestamptz '2026-09-25 00:00:00+09' AND NEW.checked_out_at IS NULL THEN
    SELECT p.room_id,p.capacity_reservation_id INTO a
    FROM public.hotel_physical_occupancy_members m
    JOIN public.hotel_physical_occupancies p ON p.id=m.occupancy_id
    WHERE m.hotel_stay_id=NEW.id AND m.archived_at IS NULL AND m.status='active'
      AND p.archived_at IS NULL AND p.status='active';
    IF NOT FOUND THEN
      SELECT x.room_id,c.id AS capacity_reservation_id INTO a
      FROM public.hotel_capacity_reservations c JOIN public.hotel_room_allocations x ON x.capacity_reservation_id=c.id
      WHERE c.hotel_stay_id=NEW.id AND c.archived_at IS NULL AND x.archived_at IS NULL
        AND x.allocated_from<=statement_timestamp()
      ORDER BY x.allocated_from DESC,x.id DESC LIMIT 1;
    END IF;
    IF a.room_id IS NOT NULL THEN
      PERFORM public.assert_hotel_physical_room_available_internal(a.room_id,a.capacity_reservation_id);
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_hotel_physical_check_in_internal() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER hotel_physical_check_in_guard
BEFORE INSERT OR UPDATE OF checked_in_at,checked_out_at ON public.hotel_stays
FOR EACH ROW EXECUTE FUNCTION public.guard_hotel_physical_check_in_internal();

-- Daycare can hold a preallocation too; actual entry cannot bypass Hotel occupancy.
CREATE FUNCTION public.guard_daycare_hotel_physical_check_in_internal()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE a record;
BEGIN
  IF NEW.lifecycle_status='checked_in' THEN
    FOR a IN SELECT x.room_id,c.id FROM public.hotel_capacity_reservations c
      JOIN public.hotel_room_allocations x ON x.capacity_reservation_id=c.id
      WHERE c.daycare_schedule_id=NEW.operation_schedule_id AND c.archived_at IS NULL AND x.archived_at IS NULL
    LOOP
      PERFORM public.assert_hotel_physical_room_available_internal(a.room_id,a.id);
    END LOOP;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_daycare_hotel_physical_check_in_internal() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER daycare_hotel_physical_check_in_guard
BEFORE INSERT OR UPDATE OF lifecycle_status ON public.daycare_operation_states
FOR EACH ROW EXECUTE FUNCTION public.guard_daycare_hotel_physical_check_in_internal();

-- Based on captured Production body 655417d618ef44206fe8274e026b7ae9; rooms/settings preserved.
CREATE OR REPLACE FUNCTION public.get_hotel_operations_snapshot(p_local_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  day_start timestamptz;
  day_end timestamptz;
  selected_instant timestamptz;
  result jsonb;
begin
  if not public.is_active_operation_member() then
    raise exception '호텔 운영 조회 권한이 없습니다.' using errcode = '42501';
  end if;
  if p_local_date is null then
    raise exception '조회 날짜가 필요합니다.' using errcode = '22023';
  end if;

  day_start := p_local_date::timestamp at time zone 'Asia/Seoul';
  day_end := (p_local_date + 1)::timestamp at time zone 'Asia/Seoul';
  selected_instant := case when p_local_date = (now() at time zone 'Asia/Seoul')::date
    then now() else day_start + interval '12 hours' end;

  select jsonb_build_object(
    'date', p_local_date,
    'roomTypes', coalesce(jsonb_agg(jsonb_build_object(
      'id', room_type.id,
      'code', room_type.code,
      'name', room_type.name,
      'activeRooms', (select count(*) from public.hotel_rooms room
        where room.room_type_id = room_type.id and room.is_active and room.archived_at is null),
      'reservedPeak', coalesce((
        with points as (
          select greatest(capacity.reserved_from, day_start) point_at, capacity.quantity::integer delta
          from public.hotel_capacity_reservations capacity
          where capacity.room_type_id = room_type.id and capacity.archived_at is null
            and capacity.reserved_from < day_end and capacity.reserved_until > day_start
          union all
          select least(capacity.reserved_until, day_end), -capacity.quantity::integer
          from public.hotel_capacity_reservations capacity
          where capacity.room_type_id = room_type.id and capacity.archived_at is null
            and capacity.reserved_from < day_end and capacity.reserved_until > day_start
        ), deltas as (select point_at, sum(delta) delta from points group by point_at),
        running as (select sum(delta) over (order by point_at) occupancy from deltas)
        select max(occupancy) from running
      ), 0),
      'checkedInNow', (select count(*) from public.hotel_capacity_reservations capacity
        join public.hotel_stays stay on stay.id = capacity.hotel_stay_id
        where capacity.room_type_id = room_type.id and capacity.archived_at is null
          and stay.archived_at is null and stay.checked_in_at is not null
          and stay.checked_out_at is null and capacity.reserved_from <= selected_instant
          and capacity.reserved_until > selected_instant),
      'allocatedNow', (select count(distinct allocation.room_id)
        from public.hotel_room_allocations allocation
        join public.hotel_capacity_reservations capacity on capacity.id = allocation.capacity_reservation_id
        where capacity.room_type_id = room_type.id and capacity.archived_at is null
          and allocation.archived_at is null and allocation.allocated_from <= selected_instant
          and allocation.allocated_until > selected_instant),
      'reservedNow', (select coalesce(sum(capacity.quantity), 0)
        from public.hotel_capacity_reservations capacity
        where capacity.room_type_id = room_type.id and capacity.archived_at is null
          and capacity.reserved_from <= selected_instant
          and capacity.reserved_until > selected_instant),
      'unassignedNow', greatest(0,
        (select coalesce(sum(capacity.quantity), 0)
          from public.hotel_capacity_reservations capacity
          where capacity.room_type_id = room_type.id and capacity.archived_at is null
            and capacity.reserved_from <= selected_instant
            and capacity.reserved_until > selected_instant)
        - (select count(distinct allocation.capacity_reservation_id)
          from public.hotel_room_allocations allocation
          join public.hotel_capacity_reservations capacity on capacity.id = allocation.capacity_reservation_id
          where capacity.room_type_id = room_type.id and capacity.archived_at is null
            and allocation.archived_at is null and allocation.allocated_from <= selected_instant
            and allocation.allocated_until > selected_instant)
      ),
      'physicallyEmpty', greatest(0,
        (select count(*) from public.hotel_rooms room
          where room.room_type_id = room_type.id and room.is_active and room.archived_at is null)
        - (select count(distinct allocation.room_id)
          from public.hotel_room_allocations allocation
          join public.hotel_capacity_reservations capacity on capacity.id = allocation.capacity_reservation_id
          where capacity.room_type_id = room_type.id and capacity.archived_at is null
            and allocation.archived_at is null and allocation.allocated_from <= selected_instant
            and allocation.allocated_until > selected_instant)
      )
    ) order by room_type.sort_order, room_type.code), '[]'::jsonb),
    'rooms', coalesce((select jsonb_agg(jsonb_build_object(
      'id', room.id,
      'name', room.name,
      'roomTypeId', room_type_row.id,
      'roomTypeCode', room_type_row.code,
      'roomTypeName', room_type_row.name,
      'isActive', room.is_active,
      'sortOrder', room.sort_order
    ) order by room_type_row.sort_order, room.sort_order, room.name)
      from public.hotel_rooms room
      join public.hotel_room_types room_type_row on room_type_row.id = room.room_type_id
      where room.archived_at is null
        and room_type_row.archived_at is null), '[]'::jsonb),
    'settings', (select jsonb_build_object(
      'id', settings.id,
      'version', settings.version,
      'defaultCheckInTime', settings.default_check_in_time::text,
      'defaultCheckOutTime', settings.default_check_out_time::text,
      'timezone', settings.timezone
    )
      from public.hotel_operation_settings settings
      where settings.singleton_key = 'default'
        and settings.archived_at is null
      order by settings.created_at, settings.id
      limit 1),
    'stays', coalesce((select jsonb_agg(public.hotel_stay_json(stay.id)
      order by capacity.reserved_from, stay.created_at)
      from public.hotel_stays stay
      join public.hotel_capacity_reservations capacity on capacity.hotel_stay_id = stay.id
      where stay.archived_at is null and capacity.archived_at is null
        and ((capacity.reserved_from < day_end and capacity.reserved_until > day_start)
          or (p_local_date=(statement_timestamp() at time zone 'Asia/Seoul')::date
            and stay.checked_in_at<=statement_timestamp() and stay.checked_out_at is null
            and (stay.checked_in_at>=timestamptz '2026-09-25 00:00:00+09' or exists (select 1 from public.hotel_stay_schedule_events ev
              join public.operation_schedules os on os.id=ev.operation_schedule_id
              where ev.hotel_stay_id=stay.id and ev.event_kind='check_out'
                and ev.archived_at is null and os.archived_at is null
                and os.starts_at>=timestamptz '2026-09-25 00:00:00+09' and os.starts_at<day_end))))), '[]'::jsonb),
    'unassignedFuture', coalesce((select jsonb_agg(public.hotel_stay_json(stay.id)
      order by capacity.reserved_from, stay.created_at)
      from public.hotel_stays stay
      join public.hotel_capacity_reservations capacity on capacity.hotel_stay_id = stay.id
      where stay.archived_at is null and capacity.archived_at is null
        and capacity.reserved_until > day_start
        and not exists (select 1 from public.hotel_room_allocations allocation
          where allocation.capacity_reservation_id = capacity.id
            and allocation.archived_at is null)), '[]'::jsonb)
  ) into result
  from public.hotel_room_types room_type
  where room_type.is_active and room_type.archived_at is null;

  if p_local_date=(statement_timestamp() at time zone 'Asia/Seoul')::date then
    result := jsonb_set(result,'{roomTypes}',coalesce((
      select jsonb_agg(item || jsonb_build_object(
        'checkedInNow',n.occupied,'allocatedNow',n.occupied,
        'physicallyEmpty',greatest(0,(item->>'activeRooms')::integer-n.occupied)) order by ordinal)
      from jsonb_array_elements(result->'roomTypes') with ordinality as items(item,ordinal)
      cross join lateral (select count(distinct p.room_id)::integer occupied
        from public.hotel_current_physical_rooms_internal() p
        join public.hotel_rooms room on room.id=p.room_id
        where room.room_type_id=(item->>'id')::uuid) n
    ),'[]'::jsonb));
    result := result || jsonb_build_object('physicalOccupiedRooms',
      (select count(distinct room_id) from public.hotel_current_physical_rooms_internal()));
  end if;
  return result;
end;
$function$
;

create or replace function public.get_hotel_shared_room_occupancies(p_date date)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  if not public.is_active_operation_member() then
    raise exception '공유 객실 조회 권한이 없습니다.' using errcode='42501';
  end if;
  return coalesce((select jsonb_agg(public.shared_hotel_occupancy_json_internal(o.id) order by r.sort_order,r.name,o.id)
    from public.hotel_physical_occupancies o join public.hotel_rooms r on r.id=o.room_id
    where o.archived_at is null and o.status='active'
      and o.occupied_from < ((p_date+1)::timestamp at time zone 'Asia/Seoul')
      and (o.occupied_until > (p_date::timestamp at time zone 'Asia/Seoul')
        or (p_date=(statement_timestamp() at time zone 'Asia/Seoul')::date
          and (exists (select 1 from public.hotel_current_physical_rooms_internal() p where p.occupancy_id=o.id)
            or exists (select 1 from public.hotel_physical_occupancy_members m
              join public.hotel_stays stay on stay.id=m.hotel_stay_id
              join public.hotel_stay_schedule_events ev on ev.hotel_stay_id=stay.id and ev.event_kind='check_out' and ev.archived_at is null
              join public.operation_schedules os on os.id=ev.operation_schedule_id and os.archived_at is null
              where m.occupancy_id=o.id and m.archived_at is null and m.status='active'
                and stay.archived_at is null and stay.checked_in_at is not null and stay.checked_out_at is null
                and os.starts_at>=timestamptz '2026-09-25 00:00:00+09' and os.starts_at<((p_date+1)::timestamp at time zone 'Asia/Seoul')))))),'[]'::jsonb);
end;
$$;


-- Late Shared checkout validates allocation against the extended capacity,
-- not the obsolete planned upper bound. Any collision rolls back all changes.
create or replace function public.complete_shared_hotel_member_check_out(
  p_occupancy_id uuid,p_hotel_stay_id uuid,p_expected_occupancy_version integer,
  p_expected_stay_version integer,p_completed_at timestamptz,p_request_id uuid
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  actor_id uuid:=auth.uid(); replay jsonb; payload jsonb; o public.hotel_physical_occupancies%rowtype;
  s public.hotel_stays%rowtype; m public.hotel_physical_occupancy_members%rowtype;
  remaining integer; result jsonb;
begin
  payload:=jsonb_build_object('completedAt',p_completed_at,'expectedOccupancyVersion',p_expected_occupancy_version,'expectedStayVersion',p_expected_stay_version,'hotelStayId',p_hotel_stay_id,'occupancyId',p_occupancy_id);
  replay:=public.claim_shared_hotel_request_internal(p_request_id,'check_out',payload,p_occupancy_id); if replay is not null then return replay; end if;
  select * into o from public.hotel_physical_occupancies where id=p_occupancy_id for update;
  select * into s from public.hotel_stays where id=p_hotel_stay_id for update;
  select * into m from public.hotel_physical_occupancy_members where occupancy_id=p_occupancy_id and hotel_stay_id=p_hotel_stay_id and archived_at is null for update;
  if o.id is null or o.status<>'active' or s.id is null or m.id is null or m.status<>'active' then raise exception '퇴실할 공유 객실 member를 확인할 수 없습니다.' using errcode='P0002'; end if;
  if o.version<>p_expected_occupancy_version or s.version<>p_expected_stay_version then raise exception '다른 사용자가 먼저 처리했습니다.' using errcode='PT409'; end if;
  if s.checked_in_at is null or p_completed_at is null or p_completed_at<=s.checked_in_at or p_completed_at<=o.occupied_from then raise exception '입실 이후의 유효한 퇴실 시각이 필요합니다.' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('hotel-capacity:all',0));
  perform pg_advisory_xact_lock(hashtextextended('hotel-capacity:'||o.room_type_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('hotel-room:'||o.room_id::text,0));
  perform set_config('app.operation_change_reason','다견 공유 객실 member 퇴실',true);
  perform set_config('app.operation_request_id',p_request_id::text,true);
  update public.hotel_stays set checked_out_at=p_completed_at,checked_out_by=actor_id,
    checkout_previous_reserved_until=o.occupied_until,checkout_previous_allocation_id=o.room_allocation_id,
    checkout_previous_allocation_until=o.occupied_until,updated_by=actor_id where id=s.id;
  perform set_config('app.operation_request_id','',true);
  update public.hotel_physical_occupancy_members set status='completed',left_at=p_completed_at,updated_by=actor_id where id=m.id;
  update public.family_booking_members set status='completed',updated_by=actor_id
    where hotel_stay_id=s.id and family_booking_id=o.family_booking_id and archived_at is null;
  select count(*) into remaining from public.hotel_physical_occupancy_members x where x.occupancy_id=o.id and x.archived_at is null and x.status='active';
  if remaining=0 then
    if p_completed_at>o.occupied_until then
      perform public.assert_hotel_total_capacity_available(o.occupied_from,p_completed_at,1,o.capacity_reservation_id);
      perform public.assert_hotel_capacity_available(o.room_type_id,o.occupied_from,p_completed_at,1,o.capacity_reservation_id);
    end if;
    update public.hotel_capacity_reservations set reserved_until=p_completed_at,updated_by=actor_id where id=o.capacity_reservation_id;
    if p_completed_at>o.occupied_until then
      perform public.assert_hotel_room_allocation_available(o.room_id,o.capacity_reservation_id,o.occupied_from,p_completed_at,o.room_allocation_id);
    end if;
    update public.hotel_room_allocations set allocated_until=p_completed_at,updated_by=actor_id where id=o.room_allocation_id;
    update public.hotel_physical_occupancies set restore_occupied_until=o.occupied_until,occupied_until=p_completed_at,status='completed',completed_at=p_completed_at,updated_by=actor_id where id=o.id;
    update public.family_shared_room_groups set status='released',updated_by=actor_id where id=o.shared_room_group_id;
  else
    update public.hotel_physical_occupancies set updated_by=actor_id where id=o.id;
  end if;
  result:=jsonb_build_object('occupancy',public.shared_hotel_occupancy_json_internal(o.id),'stay',public.hotel_stay_json(s.id),'remainingActiveMembers',remaining);
  return public.finish_shared_hotel_request_internal(p_request_id,o.id,result);
end;
$$;


-- Read eligibility agrees with the authoritative write guard for immediate use.
CREATE OR REPLACE FUNCTION public.hotel_single_room_eligibility_internal(
 p_stay_id uuid, p_purpose text, p_effective_at timestamptz
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s public.hotel_stays%rowtype; c public.hotel_capacity_reservations%rowtype;
 n integer; lo timestamptz; why text; room_rows jsonb; checkin_at timestamptz;
BEGIN
 IF p_purpose IS NULL OR p_purpose NOT IN ('preassign','actual_check_in') THEN
  RAISE EXCEPTION 'INVALID_PURPOSE' USING errcode='22023'; END IF;
 SELECT * INTO s FROM public.hotel_stays WHERE id=p_stay_id;
 IF s.id IS NULL OR s.archived_at IS NOT NULL THEN why:='STAY_UNAVAILABLE'; END IF;
 SELECT count(*) INTO n FROM public.hotel_capacity_reservations WHERE hotel_stay_id=p_stay_id AND archived_at IS NULL;
 IF n<>1 THEN why:=coalesce(why,'CAPACITY_RELATION_INVALID'); ELSE
  SELECT * INTO c FROM public.hotel_capacity_reservations WHERE hotel_stay_id=p_stay_id AND archived_at IS NULL;
 END IF;
 IF EXISTS(SELECT 1 FROM public.hotel_physical_occupancy_members WHERE hotel_stay_id=p_stay_id)
  OR EXISTS(SELECT 1 FROM public.family_booking_members WHERE hotel_stay_id=p_stay_id AND shared_room_group_id IS NOT NULL)
  OR EXISTS(SELECT 1 FROM public.long_stay_contracts WHERE current_hotel_stay_id=p_stay_id)
  OR EXISTS(SELECT 1 FROM public.long_stay_monthly_occupancies WHERE hotel_stay_id=p_stay_id)
  OR EXISTS(SELECT 1 FROM public.long_stay_absence_events WHERE hotel_stay_id=p_stay_id)
 THEN why:=coalesce(why,'DEDICATED_LIFECYCLE_REQUIRED'); END IF;
 IF c.id IS NOT NULL AND (c.source_kind IS DISTINCT FROM 'stay' OR c.quantity IS DISTINCT FROM 1
  OR c.physical_occupancy_id IS NOT NULL OR c.shared_room_group_id IS NOT NULL OR c.room_type_id IS NULL) THEN why:=coalesce(why,'CAPACITY_RELATION_INVALID'); END IF;
 IF s.checked_in_at IS NOT NULL OR s.checked_out_at IS NOT NULL THEN why:=coalesce(why,'STAY_ALREADY_COMPLETED'); END IF;
 IF EXISTS(SELECT 1 FROM public.hotel_room_allocations WHERE capacity_reservation_id=c.id AND archived_at IS NULL)
 THEN why:=coalesce(why,'ALREADY_ALLOCATED'); END IF;
 IF c.room_type_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.hotel_room_types WHERE id=c.room_type_id AND is_active AND archived_at IS NULL) THEN why:=coalesce(why,'ROOM_TYPE_UNAVAILABLE'); END IF;
 lo:=CASE WHEN p_purpose='preassign' THEN c.reserved_from ELSE p_effective_at END;
 IF lo IS NULL OR NOT isfinite(lo) OR lo<c.reserved_from OR lo>=c.reserved_until
 THEN why:=coalesce(why,'INVALID_EFFECTIVE_TIME'); END IF;
 IF p_purpose='actual_check_in' THEN
  SELECT count(*),min(os.starts_at) INTO n,checkin_at
   FROM public.hotel_stay_schedule_events e JOIN public.operation_schedules os ON os.id=e.operation_schedule_id
   WHERE e.hotel_stay_id=p_stay_id AND e.event_kind='check_in' AND e.archived_at IS NULL AND os.archived_at IS NULL;
  IF n<>1 THEN why:=coalesce(why,'SCHEDULE_RELATION_INVALID');
  ELSIF (lo AT TIME ZONE 'Asia/Seoul')::date<>(checkin_at AT TIME ZONE 'Asia/Seoul')::date
   OR lo>statement_timestamp() THEN why:=coalesce(why,'INVALID_EFFECTIVE_TIME'); END IF;
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('roomId',r.id,'roomName',r.name,'roomTypeId',r.room_type_id,
  'eligible',q.reason IS NULL,'reasonCode',q.reason,'recommended',false) ORDER BY r.sort_order,r.name,r.id),'[]')
 INTO room_rows FROM public.hotel_rooms r CROSS JOIN LATERAL (
  SELECT CASE WHEN why IS NOT NULL THEN why
   WHEN r.room_type_id IS DISTINCT FROM c.room_type_id THEN 'ROOM_TYPE_MISMATCH'
   WHEN lo<=statement_timestamp() AND EXISTS(SELECT 1 FROM public.hotel_current_physical_rooms_internal() p
    WHERE p.room_id=r.id AND p.capacity_id IS DISTINCT FROM c.id) THEN 'ROOM_INTERVAL_CONFLICT'
   WHEN EXISTS(SELECT 1 FROM public.hotel_room_allocations a WHERE a.room_id=r.id AND a.archived_at IS NULL
    AND a.allocated_from<c.reserved_until AND a.allocated_until>lo) THEN 'ROOM_INTERVAL_CONFLICT'
   ELSE NULL END AS reason
 ) q WHERE r.is_active AND r.archived_at IS NULL;
 SELECT coalesce(jsonb_agg(x.value || jsonb_build_object('recommended',coalesce(x.ord=first_ok.ord,false)) ORDER BY x.ord),'[]')
 INTO room_rows FROM jsonb_array_elements(room_rows) WITH ORDINALITY x(value,ord)
 CROSS JOIN LATERAL (SELECT min(y.ord) AS ord FROM jsonb_array_elements(room_rows) WITH ORDINALITY y(value,ord)
  WHERE (y.value->>'eligible')::boolean) first_ok;
 RETURN jsonb_build_object('stayId',s.id,'stayVersion',s.version,'capacityId',c.id,'capacityVersion',c.version,
  'purpose',p_purpose,'evaluatedFrom',lo,'evaluatedUntil',c.reserved_until,'observedAt',statement_timestamp(),
  'reasonCode',why,'rooms',room_rows);
END $$;
COMMIT;
