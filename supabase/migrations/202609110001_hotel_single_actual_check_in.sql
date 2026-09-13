-- 016: additive Single room eligibility and atomic actual check-in.
BEGIN;
CREATE TABLE public.hotel_single_check_in_receipts (
 request_id uuid PRIMARY KEY,
 actor_user_id uuid NOT NULL REFERENCES public.profiles(id),
 hotel_stay_id uuid NOT NULL REFERENCES public.hotel_stays(id),
 normalized_input jsonb NOT NULL,
 checked_in_at timestamptz NOT NULL,
 room_id uuid NOT NULL REFERENCES public.hotel_rooms(id),
 expected_stay_version integer NOT NULL CHECK (expected_stay_version > 0),
 expected_capacity_version integer NOT NULL CHECK (expected_capacity_version > 0),
 capacity_reservation_id uuid NOT NULL REFERENCES public.hotel_capacity_reservations(id),
 resulting_stay_version integer NOT NULL,
 resulting_allocation_id uuid NOT NULL REFERENCES public.hotel_room_allocations(id),
 resulting_allocation_version integer NOT NULL,
 response jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.hotel_single_check_in_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hotel_single_check_in_receipts FROM PUBLIC, anon, authenticated;

-- Pure read contract. No advisory locks here: safe in a READ ONLY transaction.
CREATE FUNCTION public.hotel_single_room_eligibility_internal(
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
REVOKE ALL ON FUNCTION public.hotel_single_room_eligibility_internal(uuid,text,timestamptz) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.get_hotel_single_room_eligibility(
 p_hotel_stay_id uuid,p_purpose text,p_effective_at timestamptz DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_active_operation_member() THEN
  RAISE EXCEPTION '호텔 운영 조회 권한이 없습니다.' USING errcode='42501'; END IF;
 RETURN public.hotel_single_room_eligibility_internal(p_hotel_stay_id,p_purpose,p_effective_at);
END $$;
REVOKE ALL ON FUNCTION public.get_hotel_single_room_eligibility(uuid,text,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_hotel_single_room_eligibility(uuid,text,timestamptz) TO authenticated;

CREATE FUNCTION public.check_in_unassigned_hotel_stay(
 p_hotel_stay_id uuid,p_expected_version integer,p_expected_capacity_version integer,
 p_room_id uuid,p_checked_in_at timestamptz,p_request_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor uuid:=auth.uid(); payload jsonb; receipt public.hotel_single_check_in_receipts%rowtype;
 s public.hotel_stays%rowtype; c public.hotel_capacity_reservations%rowtype;
 a public.hotel_room_allocations%rowtype; evidence jsonb; result jsonb; n integer;
BEGIN
 IF actor IS NULL OR NOT public.is_active_operation_member() THEN RAISE EXCEPTION '입실 완료 권한이 없습니다.' USING errcode='42501'; END IF;
 IF p_request_id IS NULL OR p_hotel_stay_id IS NULL OR p_room_id IS NULL OR p_checked_in_at IS NULL
  OR NOT isfinite(p_checked_in_at) OR p_expected_version IS NULL OR p_expected_capacity_version IS NULL
  OR p_expected_version<1 OR p_expected_capacity_version<1 THEN RAISE EXCEPTION '입실 입력이 필요합니다.' USING errcode='22023'; END IF;
 payload:=jsonb_build_object('command','single_actual_check_in_v1','stayId',p_hotel_stay_id,
  'roomId',p_room_id,'checkedInEpoch',extract(epoch FROM p_checked_in_at),
  'expectedStayVersion',p_expected_version,'expectedCapacityVersion',p_expected_capacity_version);
 PERFORM pg_advisory_xact_lock(hashtextextended('hotel-request:'||p_request_id::text,0));
 SELECT * INTO receipt FROM public.hotel_single_check_in_receipts WHERE request_id=p_request_id;
 IF FOUND THEN
  IF receipt.actor_user_id IS DISTINCT FROM actor OR receipt.normalized_input IS DISTINCT FROM payload
  THEN RAISE EXCEPTION '동일 request_id의 입력 계약 불일치' USING errcode='23505'; END IF;
  RETURN receipt.response;
 END IF;
 -- Never reuse another Hotel operation's request identity.
 IF EXISTS(SELECT 1 FROM public.entity_audit_events WHERE module_code='hotel_operations' AND request_id=p_request_id)
 THEN RAISE EXCEPTION '이미 사용된 호텔 요청 ID입니다.' USING errcode='23505'; END IF;
 SELECT * INTO s FROM public.hotel_stays WHERE id=p_hotel_stay_id FOR UPDATE;
 IF s.id IS NULL OR s.archived_at IS NOT NULL THEN RAISE EXCEPTION '활성 호텔 예약을 확인할 수 없습니다.' USING errcode='P0002'; END IF;
 SELECT count(*) INTO n FROM public.hotel_capacity_reservations WHERE hotel_stay_id=s.id AND archived_at IS NULL;
 IF n<>1 THEN RAISE EXCEPTION 'Capacity 연결을 확인해 주세요.' USING errcode='23514'; END IF;
 SELECT * INTO c FROM public.hotel_capacity_reservations WHERE hotel_stay_id=s.id AND archived_at IS NULL FOR UPDATE;
 IF s.version<>p_expected_version OR c.version<>p_expected_capacity_version THEN
  RAISE EXCEPTION '예약이 변경되었습니다. 다시 조회해 주세요.' USING errcode='40001'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('hotel-room:'||p_room_id::text,0));
 -- Separate statement after room-lock wait: observe committed competing assignments.
 evidence:=public.hotel_single_room_eligibility_internal(s.id,'actual_check_in',p_checked_in_at);
 IF evidence->>'reasonCode' IS NOT NULL THEN RAISE EXCEPTION '%',evidence->>'reasonCode' USING errcode='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(evidence->'rooms') r WHERE r->>'roomId'=p_room_id::text AND (r->>'eligible')::boolean)
 THEN RAISE EXCEPTION '선택한 호실은 입실 기간에 배정할 수 없습니다.' USING errcode='23P01'; END IF;
 PERFORM public.assert_hotel_room_allocation_available(p_room_id,c.id,p_checked_in_at,c.reserved_until,NULL);
 PERFORM set_config('app.operation_change_reason','미배정 예약 실제 입실 확정',true);
 PERFORM set_config('app.operation_request_id',p_request_id::text,true);
 INSERT INTO public.hotel_room_allocations(capacity_reservation_id,room_id,allocated_from,allocated_until,
  assignment_reason,request_id,created_by,updated_by)
 VALUES(c.id,p_room_id,p_checked_in_at,c.reserved_until,'미배정 예약 실제 입실 확정',p_request_id,actor,actor) RETURNING * INTO a;
 UPDATE public.hotel_stays SET checked_in_at=p_checked_in_at,checked_in_by=actor,updated_by=actor WHERE id=s.id RETURNING * INTO s;
 result:=public.hotel_stay_json(s.id);
 INSERT INTO public.hotel_single_check_in_receipts(request_id,actor_user_id,hotel_stay_id,normalized_input,
  checked_in_at,room_id,expected_stay_version,expected_capacity_version,capacity_reservation_id,
  resulting_stay_version,resulting_allocation_id,resulting_allocation_version,response)
 VALUES(p_request_id,actor,s.id,payload,p_checked_in_at,p_room_id,p_expected_version,p_expected_capacity_version,
  c.id,s.version,a.id,a.version,result);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.check_in_unassigned_hotel_stay(uuid,integer,integer,uuid,timestamptz,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.check_in_unassigned_hotel_stay(uuid,integer,integer,uuid,timestamptz,uuid) TO authenticated;
COMMIT;
