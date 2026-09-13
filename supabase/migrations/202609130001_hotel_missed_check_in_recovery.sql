-- 016B: additive missed Single check-in recovery. Existing 016 and capacity/schedule remain unchanged.
BEGIN;
CREATE TABLE public.hotel_missed_check_in_receipts (
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
ALTER TABLE public.hotel_missed_check_in_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hotel_missed_check_in_receipts FROM PUBLIC, anon, authenticated;

-- Reuse 016 state/ownership/type validation, not its planned interval room verdict.
-- No existing function or contract is replaced.
CREATE FUNCTION public.hotel_missed_check_in_eligibility_internal(
 p_stay_id uuid, p_checked_in_at timestamptz
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE base jsonb; c public.hotel_capacity_reservations%rowtype; why text;
 planned_at timestamptz; n integer; rooms jsonb; observed timestamptz:=statement_timestamp();
BEGIN
 base:=public.hotel_single_room_eligibility_internal(p_stay_id,'preassign',NULL);
 why:=base->>'reasonCode';
 SELECT * INTO c FROM public.hotel_capacity_reservations WHERE id=(base->>'capacityId')::uuid;
 IF c.id IS NOT NULL AND (NOT isfinite(c.reserved_from) OR NOT isfinite(c.reserved_until)) THEN
  why:=coalesce(why,'CAPACITY_ENVELOPE_INVALID'); END IF;
 IF p_checked_in_at IS NULL OR NOT isfinite(p_checked_in_at) OR p_checked_in_at>observed
  OR p_checked_in_at<c.reserved_from OR p_checked_in_at>=c.reserved_until THEN
  why:=coalesce(why,'INVALID_EFFECTIVE_TIME'); END IF;
 IF c.reserved_until<=observed THEN why:=coalesce(why,'RECOVERY_WINDOW_CLOSED'); END IF;
 SELECT count(*),min(os.starts_at) INTO n,planned_at
 FROM public.hotel_stay_schedule_events e JOIN public.operation_schedules os ON os.id=e.operation_schedule_id
 WHERE e.hotel_stay_id=p_stay_id AND e.event_kind='check_in' AND e.archived_at IS NULL AND os.archived_at IS NULL;
 IF n<>1 OR planned_at IS NULL OR NOT isfinite(planned_at) THEN why:=coalesce(why,'SCHEDULE_RELATION_INVALID');
 ELSIF p_checked_in_at<planned_at THEN why:=coalesce(why,'BEFORE_PLANNED_CHECK_IN'); END IF;
 -- A reversed completion is not a missed first check-in, even when the retained stay is null.
 IF EXISTS(SELECT 1 FROM public.entity_audit_events e WHERE e.module_code='hotel_operations'
  AND e.entity_type='hotel_stays' AND e.entity_id=p_stay_id
  AND (e.before_data->>'checked_in_at' IS NOT NULL OR e.after_data->>'checked_in_at' IS NOT NULL
   OR e.before_data->>'checked_out_at' IS NOT NULL OR e.after_data->>'checked_out_at' IS NOT NULL))
  OR EXISTS(SELECT 1 FROM public.hotel_single_check_in_receipts WHERE hotel_stay_id=p_stay_id)
  OR EXISTS(SELECT 1 FROM public.hotel_missed_check_in_receipts WHERE hotel_stay_id=p_stay_id)
 THEN why:=coalesce(why,'PRIOR_COMPLETION_NOT_RECOVERABLE'); END IF;
 SELECT coalesce(jsonb_agg(x.room || jsonb_build_object('eligible',x.reason IS NULL,'reasonCode',x.reason,'recommended',false)
  ORDER BY x.ord),'[]'::jsonb) INTO rooms
 FROM (
  SELECT r.value AS room,r.ord,CASE WHEN why IS NOT NULL THEN why
   -- Keep non-conflict state/type rejection from 016. A planned-only conflict is re-evaluated.
   WHEN r.value->>'reasonCode' IS NOT NULL AND r.value->>'reasonCode'<>'ROOM_INTERVAL_CONFLICT'
    THEN r.value->>'reasonCode'
   WHEN EXISTS(SELECT 1 FROM public.hotel_room_allocations a
    WHERE a.room_id=(r.value->>'roomId')::uuid AND a.archived_at IS NULL
    AND a.allocated_from<c.reserved_until AND a.allocated_until>p_checked_in_at)
    THEN 'ROOM_INTERVAL_CONFLICT'
   ELSE NULL END AS reason
  FROM jsonb_array_elements(base->'rooms') WITH ORDINALITY r(value,ord)
 ) x;
 SELECT coalesce(jsonb_agg(r.value||jsonb_build_object('recommended',coalesce(r.ord=first_ok.ord,false)) ORDER BY r.ord),'[]'::jsonb)
 INTO rooms FROM jsonb_array_elements(rooms) WITH ORDINALITY r(value,ord)
 CROSS JOIN LATERAL (SELECT min(x.ord) ord FROM jsonb_array_elements(rooms) WITH ORDINALITY x(value,ord)
  WHERE (x.value->>'eligible')::boolean) first_ok;
 RETURN base||jsonb_build_object('purpose','historical_check_in_recovery','evaluatedFrom',p_checked_in_at,
  'evaluatedUntil',c.reserved_until,'observedAt',observed,'reasonCode',why,'rooms',rooms);
END $$;
REVOKE ALL ON FUNCTION public.hotel_missed_check_in_eligibility_internal(uuid,timestamptz) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.get_hotel_missed_check_in_eligibility(
 p_hotel_stay_id uuid,p_checked_in_at timestamptz
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_active_operation_member() THEN
  RAISE EXCEPTION '호텔 운영 조회 권한이 없습니다.' USING errcode='42501'; END IF;
 RETURN public.hotel_missed_check_in_eligibility_internal(p_hotel_stay_id,p_checked_in_at);
END $$;
REVOKE ALL ON FUNCTION public.get_hotel_missed_check_in_eligibility(uuid,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_hotel_missed_check_in_eligibility(uuid,timestamptz) TO authenticated;

CREATE FUNCTION public.recover_missed_hotel_check_in(
 p_hotel_stay_id uuid,p_expected_version integer,p_expected_capacity_version integer,
 p_room_id uuid,p_checked_in_at timestamptz,p_request_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor uuid:=auth.uid(); payload jsonb; receipt public.hotel_missed_check_in_receipts%rowtype;
 s public.hotel_stays%rowtype; c public.hotel_capacity_reservations%rowtype;
 a public.hotel_room_allocations%rowtype; evidence jsonb; result jsonb; n integer;
BEGIN
 IF actor IS NULL OR NOT public.is_active_operation_member() THEN RAISE EXCEPTION '입실 완료 권한이 없습니다.' USING errcode='42501'; END IF;
 IF p_request_id IS NULL OR p_hotel_stay_id IS NULL OR p_room_id IS NULL OR p_checked_in_at IS NULL
  OR NOT isfinite(p_checked_in_at) OR p_expected_version IS NULL OR p_expected_capacity_version IS NULL
  OR p_expected_version<1 OR p_expected_capacity_version<1 THEN RAISE EXCEPTION '입실 입력이 필요합니다.' USING errcode='22023'; END IF;
 payload:=jsonb_build_object('command','missed_historical_check_in_v1','stayId',p_hotel_stay_id,
  'roomId',p_room_id,'checkedInEpoch',extract(epoch FROM p_checked_in_at),
  'expectedStayVersion',p_expected_version,'expectedCapacityVersion',p_expected_capacity_version);
 PERFORM pg_advisory_xact_lock(hashtextextended('hotel-request:'||p_request_id::text,0));
 SELECT * INTO receipt FROM public.hotel_missed_check_in_receipts WHERE request_id=p_request_id;
 IF FOUND THEN
  IF receipt.actor_user_id IS DISTINCT FROM actor OR receipt.normalized_input IS DISTINCT FROM payload
  THEN RAISE EXCEPTION '동일 request_id의 입력 계약 불일치' USING errcode='23505'; END IF;
  RETURN receipt.response;
 END IF;
 -- Never reuse another Hotel operation's request identity.
 IF EXISTS(SELECT 1 FROM public.hotel_single_check_in_receipts WHERE request_id=p_request_id)
  OR EXISTS(SELECT 1 FROM public.entity_audit_events WHERE module_code='hotel_operations' AND request_id=p_request_id)
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
 -- Re-check real server time after lock waits. No recovery after the existing capacity ends.
 IF NOT isfinite(c.reserved_until) OR c.reserved_until<=clock_timestamp() THEN
  RAISE EXCEPTION 'RECOVERY_WINDOW_CLOSED' USING errcode='23514'; END IF;
 evidence:=public.hotel_missed_check_in_eligibility_internal(s.id,p_checked_in_at);
 IF evidence->>'reasonCode' IS NOT NULL THEN RAISE EXCEPTION '%',evidence->>'reasonCode' USING errcode='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(evidence->'rooms') r WHERE r->>'roomId'=p_room_id::text AND (r->>'eligible')::boolean)
 THEN RAISE EXCEPTION '선택한 호실은 입실 기간에 배정할 수 없습니다.' USING errcode='23P01'; END IF;
 PERFORM public.assert_hotel_room_allocation_available(p_room_id,c.id,p_checked_in_at,c.reserved_until,NULL);
 PERFORM set_config('app.operation_change_reason','누락된 실제 입실 기록 복구',true);
 PERFORM set_config('app.operation_request_id',p_request_id::text,true);
 INSERT INTO public.hotel_room_allocations(capacity_reservation_id,room_id,allocated_from,allocated_until,
  assignment_reason,request_id,created_by,updated_by)
 VALUES(c.id,p_room_id,p_checked_in_at,c.reserved_until,'누락된 실제 입실 기록 복구',p_request_id,actor,actor) RETURNING * INTO a;
 UPDATE public.hotel_stays SET checked_in_at=p_checked_in_at,checked_in_by=actor,updated_by=actor WHERE id=s.id RETURNING * INTO s;
 result:=public.hotel_stay_json(s.id);
 INSERT INTO public.hotel_missed_check_in_receipts(request_id,actor_user_id,hotel_stay_id,normalized_input,
  checked_in_at,room_id,expected_stay_version,expected_capacity_version,capacity_reservation_id,
  resulting_stay_version,resulting_allocation_id,resulting_allocation_version,response)
 VALUES(p_request_id,actor,s.id,payload,p_checked_in_at,p_room_id,p_expected_version,p_expected_capacity_version,
  c.id,s.version,a.id,a.version,result);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.recover_missed_hotel_check_in(uuid,integer,integer,uuid,timestamptz,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.recover_missed_hotel_check_in(uuid,integer,integer,uuid,timestamptz,uuid) TO authenticated;
COMMIT;
