-- Minimal lock-order repair for reverse_hotel_completion().
-- Business logic is unchanged; the room advisory lock is acquired before
-- a Capacity UPDATE can acquire the total-capacity advisory lock.

begin;

do $$
declare
  target_oid regprocedure := to_regprocedure(
    'public.reverse_hotel_completion(uuid,integer,text,text,uuid)'
  );
  target_body_fingerprint text;
begin
  if target_oid is null then
    raise exception 'STOP_REVERSE_HOTEL_COMPLETION_MISSING';
  end if;

  select md5(procedure_row.prosrc)
  into target_body_fingerprint
  from pg_proc procedure_row
  where procedure_row.oid = target_oid;

  if target_body_fingerprint <> 'a694cfa7ab7ed47afdc2fcae44a2f87d' then
    raise exception 'STOP_REVERSE_HOTEL_COMPLETION_UNEXPECTED_VERSION'
      using detail = format(
        'expected_body_fingerprint=%s; actual_body_fingerprint=%s',
        'a694cfa7ab7ed47afdc2fcae44a2f87d',
        target_body_fingerprint
      );
  end if;

  if coalesce((
    select md5(procedure_row.prosrc) =
      '321e35c3ac5180215086adf5d0f7d5ac'
    from pg_proc procedure_row
    where procedure_row.oid = to_regprocedure(
      'public.update_hotel_reservation(uuid,integer,uuid,uuid,text,timestamp with time zone,timestamp with time zone,uuid,uuid,uuid,uuid[],text,uuid)'
    )
  ), false) is not true then
    raise exception 'STOP_UPDATE_LOCK_ORDER_REPAIR_REQUIRED';
  end if;

  if to_regprocedure(
      'public.create_flexible_hotel_reservation(uuid,uuid,date,time without time zone,boolean,date,time without time zone,boolean,uuid,uuid,uuid,uuid[],text,uuid)'
    ) is not null
    or to_regprocedure('public.get_hotel_operations_snapshot_v2(date)') is not null
    or to_regprocedure(
      'public.assert_hotel_total_capacity_available(timestamp with time zone,timestamp with time zone,integer,uuid)'
    ) is not null
    or exists (
      select 1 from pg_trigger trigger_row
      where trigger_row.tgname in (
        'hotel_capacity_reservations_total_capacity_guard',
        'hotel_room_allocations_room_type_guard'
      )
        and not trigger_row.tgisinternal
    )
  then
    raise exception 'STOP_FLEXIBLE_MIGRATION_ALREADY_APPLIED';
  end if;
end;
$$;

CREATE OR REPLACE FUNCTION public.reverse_hotel_completion(p_hotel_stay_id uuid, p_expected_version integer, p_completion_kind text, p_reason text, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  actor_id uuid := auth.uid();
  stay_row public.hotel_stays%rowtype;
  capacity_row public.hotel_capacity_reservations%rowtype;
  final_allocation public.hotel_room_allocations%rowtype;
begin
  if actor_id is null
    or not public.has_operation_role(
      array['owner', 'manager']
    ) then
    raise exception 'Operations Owner/Manager만 완료 상태를 되돌릴 수 있습니다.'
      using errcode = '42501';
  end if;

  if p_request_id is null
    or p_expected_version is null
    or p_completion_kind not in (
      'check_in',
      'check_out'
    )
    or nullif(btrim(p_reason), '') is null then
    raise exception '완료 종류, 요청 ID, 기존 버전, 되돌리기 사유가 필요합니다.'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'hotel-request:' || p_request_id::text,
      0
    )
  );

  if public.is_replayed_hotel_stay_request(
    p_hotel_stay_id,
    p_request_id
  ) then
    return public.hotel_stay_json(p_hotel_stay_id);
  end if;

  select *
  into stay_row
  from public.hotel_stays stay
  where stay.id = p_hotel_stay_id
  for update;

  if not found
    or stay_row.archived_at is not null then
    raise exception '활성 호텔 예약을 확인할 수 없습니다.'
      using errcode = 'P0002';
  end if;

  if stay_row.version <> p_expected_version then
    raise exception '다른 사용자가 먼저 처리했습니다.'
      using errcode = '40001';
  end if;

  if p_completion_kind = 'check_in'
    and stay_row.checked_out_at is not null then
    raise exception '퇴실 완료를 먼저 되돌려야 합니다.'
      using errcode = '22023';
  end if;

  perform set_config(
    'app.operation_change_reason',
    btrim(p_reason),
    true
  );

  perform set_config(
    'app.operation_request_id',
    p_request_id::text,
    true
  );

  if p_completion_kind = 'check_in' then
    update public.hotel_stays
    set
      checked_in_at = null,
      checked_in_by = null,
      updated_by = actor_id
    where id = p_hotel_stay_id;

  else
    if stay_row.checked_out_at is null
      or stay_row.checkout_previous_reserved_until is null
      or stay_row.checkout_previous_allocation_id is null
      or stay_row.checkout_previous_allocation_until is null then
      raise exception '되돌릴 퇴실 완료 기록을 확인할 수 없습니다.'
        using errcode = 'P0002';
    end if;

    select *
    into capacity_row
    from public.hotel_capacity_reservations capacity
    where capacity.hotel_stay_id = p_hotel_stay_id
      and capacity.archived_at is null
    for update;

    select *
    into final_allocation
    from public.hotel_room_allocations allocation
    where allocation.id =
      stay_row.checkout_previous_allocation_id
      and allocation.capacity_reservation_id =
        capacity_row.id
      and allocation.archived_at is null
    for update;

    if not found then
      raise exception '복원할 최종 호실 배정 기록을 확인할 수 없습니다.'
        using errcode = 'P0002';
    end if;

    if stay_row.checkout_previous_allocation_until
      <= final_allocation.allocated_from then
      raise exception '저장된 이전 호실 종료 시각이 유효하지 않습니다.'
        using errcode = '22023';
    end if;

    if stay_row.checkout_previous_reserved_until
      > capacity_row.reserved_until then
      perform public.assert_hotel_capacity_available(
        capacity_row.room_type_id,
        capacity_row.reserved_from,
        stay_row.checkout_previous_reserved_until,
        capacity_row.quantity,
        capacity_row.id
      );
    end if;

    -- Global advisory lock order: Room Type -> Room -> Total Capacity.
    -- The existing room assertion below reuses this transaction-level lock.
    perform pg_advisory_xact_lock(
      hashtextextended(
        'hotel-room:' || final_allocation.room_id::text,
        0
      )
    );

    update public.hotel_capacity_reservations capacity
    set
      reserved_until =
        stay_row.checkout_previous_reserved_until,
      updated_by = actor_id
    where capacity.id = capacity_row.id;

    perform public.assert_hotel_room_allocation_available(
      final_allocation.room_id,
      capacity_row.id,
      final_allocation.allocated_from,
      stay_row.checkout_previous_allocation_until,
      final_allocation.id
    );

    update public.hotel_room_allocations allocation
    set
      allocated_until =
        stay_row.checkout_previous_allocation_until,
      updated_by = actor_id
    where allocation.id = final_allocation.id;

    update public.hotel_stays
    set
      checked_out_at = null,
      checked_out_by = null,
      checkout_previous_reserved_until = null,
      checkout_previous_allocation_id = null,
      checkout_previous_allocation_until = null,
      updated_by = actor_id
    where id = p_hotel_stay_id;
  end if;

  return public.hotel_stay_json(p_hotel_stay_id);
end;
$function$;

commit;
