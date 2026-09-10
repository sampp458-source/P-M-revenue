-- 008 Shared historical reads. Append only; no business rows or existing contracts change.
BEGIN;
DO $$ BEGIN
 IF md5(btrim((SELECT prosrc FROM pg_proc WHERE oid=to_regprocedure('public.protect_hotel_entity_metadata()')), E' \t\r\n')) IS DISTINCT FROM '008f64ef1fefddcd5ff932260e0f654c'
 OR md5(btrim((SELECT prosrc FROM pg_proc WHERE oid=to_regprocedure('public.record_hotel_operation_audit_event()')), E' \t\r\n')) IS DISTINCT FROM '9b3d4c9cc4156e571065eecada32699f' THEN
 RAISE EXCEPTION 'STOP_008_HELPER_BASELINE_MISMATCH'; END IF;
 IF md5(btrim((SELECT prosrc FROM pg_proc WHERE oid=to_regprocedure('public.get_operation_hotel_room_projections(uuid[])')), E' \t\r\n')) IS DISTINCT FROM '27cd8bbdd8231acab0fa631727652c0d' THEN RAISE EXCEPTION 'STOP_008_BASE_RESOLVER_MISMATCH'; END IF;
END $$;

-- Explicit schema-backed semantic allowlist. Missing nullable keys normalize to null.
CREATE FUNCTION public.hotel_shared_semantic_internal(p_entity text,p_row jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE spec jsonb := '{"family_booking_members":{"id":{"type":"uuid","required":true},"family_booking_id":{"type":"uuid","required":true},"dog_id":{"type":"uuid","required":true},"hotel_stay_id":{"type":"uuid","required":false},"shared_room_group_id":{"type":"uuid","required":false},"service_type":{"type":"text","required":true},"status":{"type":"text","required":true},"archived_at":{"type":"timestamp with time zone","required":false}},"family_shared_room_groups":{"id":{"type":"uuid","required":true},"family_booking_id":{"type":"uuid","required":true},"room_type_id":{"type":"uuid","required":true},"status":{"type":"text","required":true},"normalized_starts_at":{"type":"timestamp with time zone","required":true},"normalized_ends_at":{"type":"timestamp with time zone","required":true},"archived_at":{"type":"timestamp with time zone","required":false}},"hotel_capacity_reservations":{"id":{"type":"uuid","required":true},"source_kind":{"type":"text","required":true},"hotel_stay_id":{"type":"uuid","required":false},"physical_occupancy_id":{"type":"uuid","required":false},"shared_room_group_id":{"type":"uuid","required":false},"daycare_schedule_id":{"type":"uuid","required":false},"room_type_id":{"type":"uuid","required":false},"reserved_from":{"type":"timestamp with time zone","required":true},"reserved_until":{"type":"timestamp with time zone","required":true},"quantity":{"type":"smallint","required":true},"archived_at":{"type":"timestamp with time zone","required":false}},"hotel_physical_occupancies":{"id":{"type":"uuid","required":true},"family_booking_id":{"type":"uuid","required":true},"shared_room_group_id":{"type":"uuid","required":true},"room_id":{"type":"uuid","required":true},"room_type_id":{"type":"uuid","required":true},"capacity_reservation_id":{"type":"uuid","required":false},"room_allocation_id":{"type":"uuid","required":false},"occupied_from":{"type":"timestamp with time zone","required":true},"occupied_until":{"type":"timestamp with time zone","required":true},"restore_occupied_until":{"type":"timestamp with time zone","required":false},"status":{"type":"text","required":true},"completed_at":{"type":"timestamp with time zone","required":false},"archived_at":{"type":"timestamp with time zone","required":false}},"hotel_physical_occupancy_members":{"id":{"type":"uuid","required":true},"occupancy_id":{"type":"uuid","required":true},"family_booking_member_id":{"type":"uuid","required":true},"hotel_stay_id":{"type":"uuid","required":true},"dog_id":{"type":"uuid","required":true},"status":{"type":"text","required":true},"joined_at":{"type":"timestamp with time zone","required":true},"left_at":{"type":"timestamp with time zone","required":false},"archived_at":{"type":"timestamp with time zone","required":false}},"hotel_room_allocations":{"id":{"type":"uuid","required":true},"capacity_reservation_id":{"type":"uuid","required":true},"room_id":{"type":"uuid","required":true},"allocated_from":{"type":"timestamp with time zone","required":true},"allocated_until":{"type":"timestamp with time zone","required":true},"archived_at":{"type":"timestamp with time zone","required":false}},"hotel_stays":{"id":{"type":"uuid","required":true},"dog_id":{"type":"uuid","required":true},"checked_in_at":{"type":"timestamp with time zone","required":false},"checked_out_at":{"type":"timestamp with time zone","required":false},"checkout_previous_reserved_until":{"type":"timestamp with time zone","required":false},"checkout_previous_allocation_id":{"type":"uuid","required":false},"checkout_previous_allocation_until":{"type":"timestamp with time zone","required":false},"archived_at":{"type":"timestamp with time zone","required":false}}}'::jsonb; f record; v jsonb; normalized jsonb := '{}'::jsonb;
BEGIN
 IF jsonb_typeof(p_row) IS DISTINCT FROM 'object' OR NOT spec ? p_entity THEN RETURN NULL; END IF;
 FOR f IN SELECT key,value FROM jsonb_each(spec->p_entity) LOOP
  v := coalesce(p_row->f.key,'null'::jsonb);
  IF v='null'::jsonb THEN
   IF (f.value->>'required')::boolean THEN RETURN NULL; END IF;
  ELSE
   IF f.value->>'type' IN ('integer','smallint') THEN
    IF jsonb_typeof(v)<>'number' OR (v#>>'{}') !~ '^[0-9]+$' THEN RETURN NULL; END IF;
    v:=to_jsonb((v#>>'{}')::integer);
   ELSE
    IF jsonb_typeof(v)<>'string' THEN RETURN NULL; END IF;
    CASE f.value->>'type'
     WHEN 'uuid' THEN v:=to_jsonb((v#>>'{}')::uuid);
     WHEN 'timestamp with time zone' THEN
       IF NOT isfinite((v#>>'{}')::timestamptz) THEN RETURN NULL; END IF;
       v:=to_jsonb(extract(epoch FROM (v#>>'{}')::timestamptz));
     WHEN 'text' THEN NULL;
     ELSE RETURN NULL;
    END CASE;
   END IF;
  END IF;
  normalized:=normalized||jsonb_build_object(f.key,v);
 END LOOP;
 RETURN normalized;
EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow OR invalid_datetime_format OR numeric_value_out_of_range THEN RETURN NULL;
END $$;

-- Pure evidence check: no business queries or mutation helpers.
CREATE FUNCTION public.hotel_shared_chain_internal(p_entity text,p_current jsonb,p_audits jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE a jsonb; prior jsonb; semantic jsonb; n integer:=0; changes jsonb:='[]';
BEGIN
 IF jsonb_typeof(p_current->'version') IS DISTINCT FROM 'number' OR coalesce(p_current->>'version','') !~ '^[1-9][0-9]*$' THEN RETURN NULL; END IF;
 FOR a IN SELECT value FROM jsonb_array_elements(p_audits)
 WHERE value->>'entity_type'=p_entity AND value->>'entity_id'=p_current->>'id'
 AND value->'after_data' ? 'created_at'
 ORDER BY CASE WHEN coalesce(value->'after_data'->>'version','') ~ '^[0-9]+$' THEN (value->'after_data'->>'version')::numeric END NULLS FIRST LOOP
  n:=n+1;
  IF jsonb_typeof(a->'after_data'->'version') IS DISTINCT FROM 'number' OR a->'after_data'->>'version' IS DISTINCT FROM n::text THEN RETURN NULL; END IF;
  semantic:=public.hotel_shared_semantic_internal(p_entity,a->'after_data');
  IF semantic IS NULL OR semantic->>'id' IS DISTINCT FROM p_current->>'id' THEN RETURN NULL; END IF;
  IF n=1 THEN
   IF a->>'action'<>'created' OR nullif(a->'before_data','null'::jsonb) IS NOT NULL THEN RETURN NULL; END IF;
  ELSE
   IF a->'before_data'->>'version' IS DISTINCT FROM (n-1)::text
    OR public.hotel_shared_semantic_internal(p_entity,a->'before_data') IS DISTINCT FROM prior THEN RETURN NULL; END IF;
  END IF;
  changes:=changes||jsonb_build_array(jsonb_build_object('before',prior,'after',semantic,'version',n,'at',a->>'created_at','requestId',a->'request_id'));
  prior:=semantic;
 END LOOP;
 IF n=0 OR n::text<>p_current->>'version' OR prior IS DISTINCT FROM public.hotel_shared_semantic_internal(p_entity,p_current) THEN RETURN NULL; END IF;
 RETURN changes;
END $$;

CREATE FUNCTION public.hotel_shared_verified_segments_internal(p_hotel_stay_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE ctx record; e record; chain jsonb; chains jsonb; audits jsonb; requests jsonb;
 o jsonb; m jsonb; f jsonb; g jsonb; c jsonb; a jsonb; s jsonb; x jsonb; y jsonb; req jsonb;
 result jsonb:='[]'; segments jsonb; moves jsonb; previous_move timestamptz; edge timestamptz;
 lo timestamptz; hi timestamptz; room_id uuid; next_room uuid; room_row jsonb; room_catalog jsonb;
 valid boolean; reason text; count_match integer; n integer; identity jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_active_operation_member() THEN RAISE EXCEPTION 'Hotel history authorization required' USING errcode='42501'; END IF;
 SELECT coalesce(jsonb_object_agg(r.id::text,jsonb_build_object('id',r.id,'name',r.name,'room_type_id',r.room_type_id,'type_name',t.name)),'{}'::jsonb) INTO room_catalog FROM public.hotel_rooms r JOIN public.hotel_room_types t ON t.id=r.room_type_id;
 FOR ctx IN
 WITH requested AS (SELECT DISTINCT unnest(p_hotel_stay_ids) id),
 candidates AS (
 SELECT row_s.id, to_jsonb(row_s) stay, to_jsonb(row_f) family, to_jsonb(row_g) grp,
 to_jsonb(row_m) member,to_jsonb(row_o) occupancy,to_jsonb(row_c) capacity,to_jsonb(row_a) allocation
 FROM requested r JOIN public.hotel_stays row_s ON row_s.id=r.id
 LEFT JOIN public.family_booking_members row_f ON row_f.hotel_stay_id=row_s.id AND row_f.shared_room_group_id IS NOT NULL
 LEFT JOIN public.family_shared_room_groups row_g ON row_g.id=row_f.shared_room_group_id
 LEFT JOIN public.hotel_physical_occupancy_members row_m ON row_m.hotel_stay_id=row_s.id
 LEFT JOIN public.hotel_physical_occupancies row_o ON row_o.id=row_m.occupancy_id
 LEFT JOIN public.hotel_capacity_reservations row_c ON row_c.id=row_o.capacity_reservation_id
 LEFT JOIN public.hotel_room_allocations row_a ON row_a.id=row_o.room_allocation_id
 ), relevant AS (
 SELECT DISTINCT v.kind,v.data->>'id' id FROM candidates z CROSS JOIN LATERAL (VALUES
 ('hotel_stays',z.stay),('family_booking_members',z.family),('family_shared_room_groups',z.grp),
 ('hotel_physical_occupancy_members',z.member),('hotel_physical_occupancies',z.occupancy),
 ('hotel_capacity_reservations',z.capacity),('hotel_room_allocations',z.allocation)) v(kind,data)
 ), evidence AS MATERIALIZED (
 SELECT coalesce(jsonb_agg(to_jsonb(h)),'[]'::jsonb) value FROM public.entity_audit_events h
 JOIN relevant r ON h.entity_type=r.kind AND h.entity_id::text=r.id
 WHERE h.module_code IN ('hotel_operations','family_booking')
 ), receipts AS MATERIALIZED (
 SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) value FROM public.hotel_physical_occupancy_requests r
 WHERE r.occupancy_id::text IN (SELECT occupancy->>'id' FROM candidates)
 )
 SELECT z.*,count(*) OVER(PARTITION BY z.id) candidate_count,evidence.value audit_rows,receipts.value request_rows
 FROM candidates z CROSS JOIN evidence CROSS JOIN receipts
 LOOP
 s:=ctx.stay;f:=ctx.family;g:=ctx.grp;m:=ctx.member;o:=ctx.occupancy;c:=ctx.capacity;a:=ctx.allocation;
 -- Emit a single unavailable member for duplicate identities, never choose a candidate.
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(result) r WHERE r->>'hotelStayId'=ctx.id::text) THEN CONTINUE; END IF;
 identity:=jsonb_build_object('hotelStayId',ctx.id,'dogId',s->'dog_id','familyBookingMemberId',f->'id',
 'sharedRoomGroupId',g->'id','physicalOccupancyMemberId',m->'id','physicalOccupancyId',o->'id','provenanceContractVersion',1);
 BEGIN
 valid:=ctx.candidate_count=1 AND f IS NOT NULL AND m IS NOT NULL AND o IS NOT NULL AND c IS NOT NULL AND a IS NOT NULL AND g IS NOT NULL;
 reason:='IDENTITY_OR_CHAIN_UNPROVEN'; chains:='{}'; audits:=ctx.audit_rows;requests:=ctx.request_rows;segments:='[]';moves:='[]';
 IF valid THEN
 FOR e IN SELECT * FROM (VALUES ('hotel_stays',s),('family_booking_members',f),('family_shared_room_groups',g),
 ('hotel_physical_occupancy_members',m),('hotel_physical_occupancies',o),('hotel_capacity_reservations',c),('hotel_room_allocations',a)) t(kind,data) LOOP
 chain:=public.hotel_shared_chain_internal(e.kind,e.data,audits);
 IF chain IS NULL OR e.data->>'archived_at' IS NOT NULL THEN valid:=false;EXIT;END IF;
 chains:=chains||jsonb_build_object(e.kind,chain);
 END LOOP;
 END IF;
 IF valid THEN
 valid:=m->>'family_booking_member_id'=f->>'id' AND m->>'dog_id'=s->>'dog_id'
 AND f->>'dog_id'=s->>'dog_id' AND f->>'service_type'='hotel'
 AND f->>'family_booking_id'=o->>'family_booking_id' AND g->>'family_booking_id'=o->>'family_booking_id'
 AND g->>'id'=o->>'shared_room_group_id' AND c->>'physical_occupancy_id'=o->>'id'
 AND c->>'source_kind'='shared_occupancy' AND c->>'quantity'='1'
 AND a->>'capacity_reservation_id'=c->>'id' AND a->>'room_id'=o->>'room_id'
 AND g->>'room_type_id'=o->>'room_type_id' AND c->>'room_type_id'=o->>'room_type_id'
 AND (c->>'reserved_from')::timestamptz=(o->>'occupied_from')::timestamptz
 AND (c->>'reserved_until')::timestamptz=(o->>'occupied_until')::timestamptz
 AND (a->>'allocated_from')::timestamptz=(o->>'occupied_from')::timestamptz
 AND (a->>'allocated_until')::timestamptz=(o->>'occupied_until')::timestamptz
 AND s->>'checked_in_at' IS NOT NULL;
 END IF;
 IF valid THEN
 -- An unsupported reset/reversal, archive, ownership replacement or type change fails closed.
 FOR e IN SELECT key kind,value changes FROM jsonb_each(chains) LOOP
 FOR x IN SELECT value FROM jsonb_array_elements(e.changes) LOOP
 IF x->'after'->>'archived_at' IS NOT NULL THEN valid:=false; END IF;
 -- Shared ownership must remain true at every retained semantic version, not only the tail.
 IF e.kind='hotel_capacity_reservations' AND x->'after'->>'source_kind'='shared_occupancy' AND
 (x->'after'->>'physical_occupancy_id' IS DISTINCT FROM o->>'id'
 OR x->'after'->>'hotel_stay_id' IS NOT NULL OR x->'after'->>'daycare_schedule_id' IS NOT NULL
 OR (x->'after'->>'shared_room_group_id' IS NOT NULL AND x->'after'->>'shared_room_group_id' IS DISTINCT FROM g->>'id')) THEN valid:=false;END IF;
 IF e.kind='family_booking_members' AND x->'after'->>'shared_room_group_id' IS NOT NULL AND x->'after'->>'shared_room_group_id' IS DISTINCT FROM g->>'id' THEN valid:=false;END IF;
 IF x->'before'='null'::jsonb THEN CONTINUE;END IF;
 FOR y IN SELECT to_jsonb(k) FROM jsonb_object_keys(x->'after') k
 WHERE x->'before'->k IS DISTINCT FROM x->'after'->k LOOP
 IF NOT ((e.kind='hotel_stays' AND y#>>'{}'=ANY(ARRAY['checked_in_at','checked_out_at','checkout_previous_reserved_until','checkout_previous_allocation_id','checkout_previous_allocation_until']))
 OR (e.kind='family_booking_members' AND y#>>'{}'=ANY(ARRAY['shared_room_group_id','status']))
 OR (e.kind='family_shared_room_groups' AND y#>>'{}'='status')
 OR (e.kind='hotel_physical_occupancy_members' AND y#>>'{}'=ANY(ARRAY['status','left_at']))
 OR (e.kind='hotel_physical_occupancies' AND y#>>'{}'=ANY(ARRAY['room_id','capacity_reservation_id','room_allocation_id','status','occupied_until','restore_occupied_until','completed_at']))
 OR (e.kind='hotel_room_allocations' AND y#>>'{}'=ANY(ARRAY['room_id','allocated_until']))
 OR (e.kind='hotel_capacity_reservations' AND y#>>'{}'=ANY(ARRAY['source_kind','hotel_stay_id','shared_room_group_id','physical_occupancy_id','reserved_until']))) THEN valid:=false; END IF;
 END LOOP;
 IF e.kind IN ('family_booking_members','family_shared_room_groups','hotel_physical_occupancy_members','hotel_physical_occupancies') AND x->'before'->'status' IS DISTINCT FROM x->'after'->'status' THEN
 IF NOT ((e.kind='family_booking_members' AND (x->'before'->>'status',x->'after'->>'status') IN (('confirmed','checked_in'),('checked_in','completed')))
 OR (e.kind='family_shared_room_groups' AND (x->'before'->>'status',x->'after'->>'status') IN (('requested','allocated'),('allocated','released')))
 OR (e.kind IN ('hotel_physical_occupancy_members','hotel_physical_occupancies') AND x->'before'->>'status'='active' AND x->'after'->>'status'='completed')) THEN valid:=false; END IF;
 END IF;
 IF e.kind='hotel_capacity_reservations' AND x->'before'->'source_kind' IS DISTINCT FROM x->'after'->'source_kind' AND NOT (x->'before'->>'source_kind' IN ('stay','shared_group') AND x->'after'->>'source_kind'='shared_occupancy') THEN valid:=false;END IF;
 IF e.kind='hotel_physical_occupancies' AND (x->'before'->>'capacity_reservation_id' IS NOT NULL AND x->'before'->'capacity_reservation_id' IS DISTINCT FROM x->'after'->'capacity_reservation_id'
 OR x->'before'->>'room_allocation_id' IS NOT NULL AND x->'before'->'room_allocation_id' IS DISTINCT FROM x->'after'->'room_allocation_id') THEN valid:=false;END IF;
 IF e.kind='hotel_stays' AND ((x->'before'->>'checked_in_at' IS NOT NULL AND x->'after'->'checked_in_at' IS DISTINCT FROM x->'before'->'checked_in_at')
 OR (x->'before'->>'checked_out_at' IS NOT NULL AND x->'after'->'checked_out_at' IS DISTINCT FROM x->'before'->'checked_out_at')) THEN valid:=false;END IF;
 END LOOP;
 END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(requests) r WHERE r->>'occupancy_id'=o->>'id' AND r->>'operation_kind' NOT IN ('create','merge_existing_stays','check_in','check_out','move')) THEN valid:=false;END IF;
 END IF;
 IF valid THEN
 -- Creation/merge receipt independently binds the initial allocation and room.
 room_id:=(chains->'hotel_physical_occupancies'->0->'after'->>'room_id')::uuid;
 SELECT count(*) INTO count_match FROM jsonb_array_elements(requests) r
 WHERE r->>'occupancy_id'=o->>'id' AND r->>'operation_kind' IN ('create','merge_existing_stays')
 AND r->>'completed_at' IS NOT NULL AND r->'response'->>'id'=o->>'id'
 AND r->'response'->>'roomId'=room_id::text AND r->'response'->>'roomAllocationId'=a->>'id'
 AND r->'response'->>'capacityReservationId'=c->>'id';
 valid:=count_match=1 AND (chains->'hotel_room_allocations'->0->'after'->>'room_id')::uuid=room_id;
 lo:=(s->>'checked_in_at')::timestamptz;
 hi:=coalesce((s->>'checked_out_at')::timestamptz,statement_timestamp());
 valid:=valid AND lo<hi AND (m->>'joined_at')::timestamptz<=lo
 AND (o->>'occupied_from')::timestamptz<=lo AND (o->>'occupied_until')::timestamptz>=hi
 AND ((s->>'checked_out_at' IS NULL AND m->>'status'='active' AND o->>'status'='active') OR
 (m->>'status'='completed' AND (m->>'left_at')::timestamptz=hi AND f->>'status'='completed'));
 -- Each completed lifecycle action must have a matching successful stay receipt.
 FOR e IN SELECT * FROM (VALUES ('check_in','checkedInAt','checked_in_at'),('check_out','checkedOutAt','checked_out_at')) v(op,response_key,stay_key) LOOP
 IF s->>e.stay_key IS NOT NULL THEN
 SELECT count(*) INTO count_match FROM jsonb_array_elements(requests) r
 WHERE r->>'occupancy_id'=o->>'id' AND r->>'operation_kind'=e.op AND r->>'completed_at' IS NOT NULL
 AND r->'response'->'stay'->>'id'=s->>'id'
 AND (r->'response'->'stay'->>e.response_key)::timestamptz=(s->>e.stay_key)::timestamptz;
 IF count_match<>1 THEN valid:=false;END IF;
 END IF;END LOOP;
 END IF;
 IF valid THEN
 previous_move:='-infinity';n:=0;
 FOR x IN SELECT value FROM jsonb_array_elements(chains->'hotel_physical_occupancies')
 WHERE value->'before'->>'room_id' IS NOT NULL AND value->'before'->'room_id' IS DISTINCT FROM value->'after'->'room_id' LOOP
 n:=n+1;next_room:=(x->'after'->>'room_id')::uuid;
 SELECT count(*),jsonb_agg(r)->0 INTO count_match,req FROM jsonb_array_elements(requests) r
 WHERE r->>'occupancy_id'=o->>'id' AND r->>'operation_kind'='move' AND r->>'completed_at' IS NOT NULL
 AND r->'response'->>'id'=o->>'id' AND r->'response'->>'version'=x->>'version'
 AND r->'response'->>'roomId'=next_room::text AND r->'response'->>'roomAllocationId'=a->>'id';
 IF count_match<>1 OR (x->>'requestId' IS NOT NULL AND x->>'requestId' IS DISTINCT FROM req->>'request_id') THEN valid:=false;EXIT;END IF;
 edge:=(req->>'created_at')::timestamptz;
 SELECT count(*) INTO count_match FROM jsonb_array_elements(chains->'hotel_room_allocations') q
 WHERE q->'before'->'room_id'=x->'before'->'room_id' AND q->'after'->'room_id'=x->'after'->'room_id'
 AND (q->>'at')::timestamptz=edge
 AND (q->>'requestId' IS NULL OR q->>'requestId'=req->>'request_id');
 IF count_match<>1 OR (x->>'at')::timestamptz<>edge OR edge<=previous_move
 OR (x->'before'->>'room_id')::uuid<>room_id THEN valid:=false;EXIT;END IF;
 -- Matching request version/response is primary; transaction timestamp also bounds the move.
 moves:=moves||jsonb_build_array(jsonb_build_object('roomId',room_id,'from',previous_move,'until',edge));
 room_id:=next_room;previous_move:=edge;
 END LOOP;
 IF n<>(SELECT count(*) FROM jsonb_array_elements(requests) r WHERE r->>'occupancy_id'=o->>'id' AND r->>'operation_kind'='move')
 OR n<>(SELECT count(*) FROM jsonb_array_elements(chains->'hotel_room_allocations') q WHERE q->'before'->>'room_id' IS NOT NULL AND q->'before'->'room_id' IS DISTINCT FROM q->'after'->'room_id') THEN valid:=false;END IF;
 moves:=moves||jsonb_build_array(jsonb_build_object('roomId',room_id,'from',previous_move,'until','infinity'));
 IF valid THEN
 FOR x IN SELECT value FROM jsonb_array_elements(moves) LOOP
 edge:=least(hi,(x->>'until')::timestamptz);previous_move:=greatest(lo,(x->>'from')::timestamptz);
 IF edge<=previous_move THEN CONTINUE;END IF;
 room_row:=room_catalog->(x->>'roomId');
 IF room_row IS NULL OR room_row->>'room_type_id'<>o->>'room_type_id' THEN valid:=false;EXIT;END IF;
 segments:=segments||jsonb_build_array(jsonb_build_object('roomId',room_row->'id','roomName',room_row->'name','roomTypeId',room_row->'room_type_id','roomTypeName',room_row->'type_name','allocationId',a->'id','capacityId',c->'id','usedFrom',previous_move,'usedUntil',edge));
 END LOOP;END IF;
 END IF;
 result:=result||jsonb_build_array(identity||jsonb_build_object('resolutionStatus',CASE WHEN valid AND jsonb_array_length(segments)>0 THEN 'resolved' ELSE 'unavailable' END,
 'reasonCode',CASE WHEN valid AND jsonb_array_length(segments)>0 THEN 'VERIFIED_SHARED_LIFECYCLE' ELSE reason END,'segments',CASE WHEN valid THEN segments ELSE '[]'::jsonb END));
 EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow OR invalid_datetime_format OR numeric_value_out_of_range THEN
 result:=result||jsonb_build_array(identity||jsonb_build_object('resolutionStatus','unavailable','reasonCode','MALFORMED_PROVENANCE','segments','[]'::jsonb));
 END;
 END LOOP;
 RETURN result;
END $$;

CREATE FUNCTION public.get_completed_shared_hotel_stays(p_local_date date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_active_operation_member() THEN RAISE EXCEPTION 'Hotel history authorization required' USING errcode='42501';END IF;
 IF p_local_date IS NULL THEN RAISE EXCEPTION 'Date required' USING errcode='22023';END IF;
 WITH completed AS MATERIALIZED (
 SELECT s.id,s.checked_out_at,d.name dog_name FROM public.hotel_stays s JOIN public.dogs d ON d.id=s.dog_id
 WHERE s.checked_out_at>=p_local_date::timestamp AT TIME ZONE 'Asia/Seoul'
 AND s.checked_out_at<(p_local_date+1)::timestamp AT TIME ZONE 'Asia/Seoul'
 AND EXISTS(SELECT 1 FROM public.family_booking_members f WHERE f.hotel_stay_id=s.id AND f.shared_room_group_id IS NOT NULL)
 ), events AS (
 SELECT e.hotel_stay_id,jsonb_agg(jsonb_build_object('eventKind',e.event_kind,'schedule',jsonb_build_object('id',e.operation_schedule_id))) value
 FROM public.hotel_stay_schedule_events e JOIN completed s ON s.id=e.hotel_stay_id
 WHERE e.archived_at IS NULL GROUP BY e.hotel_stay_id
 )
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',s.id,'dogName',s.dog_name,'checkedOutAt',s.checked_out_at,
 'scheduleEvents',coalesce(e.value,'[]'::jsonb)) ORDER BY s.checked_out_at,s.id),'[]'::jsonb)
 INTO result FROM completed s LEFT JOIN events e ON e.hotel_stay_id=s.id;
 RETURN result;
END $$;

CREATE FUNCTION public.get_operation_hotel_room_projections_v2(p_operation_schedule_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE base jsonb; proof jsonb; ids uuid[]; result jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_active_operation_member() THEN RAISE EXCEPTION 'Hotel history authorization required' USING errcode='42501';END IF;
 base:=public.get_operation_hotel_room_projections(p_operation_schedule_ids);
 SELECT array_agg(DISTINCT s.id) INTO ids FROM jsonb_array_elements(base) b
 JOIN public.hotel_stays s ON s.id::text=b->>'hotelStayId'
 WHERE b->>'hotelSharedRoom'='true' AND b->>'roomResolutionStatus'='unavailable' AND s.checked_out_at IS NOT NULL;
 proof:=public.hotel_shared_verified_segments_internal(coalesce(ids,'{}'::uuid[]));
 WITH event_links AS MATERIALIZED (
 SELECT e.operation_schedule_id,count(*) n FROM public.hotel_stay_schedule_events e
 WHERE e.operation_schedule_id=ANY(p_operation_schedule_ids) AND e.archived_at IS NULL GROUP BY e.operation_schedule_id
 )
 SELECT coalesce(jsonb_agg(CASE WHEN b->>'roomResolutionStatus'='unavailable' AND b->>'hotelSharedRoom'='true' AND s.checked_out_at IS NOT NULL AND p->>'resolutionStatus'='resolved' AND matched.n=1 AND links.n=1 THEN
 b||jsonb_build_object('hotelRoomName',matched.segment->'roomName','hotelRoomTypeName',matched.segment->'roomTypeName','roomResolutionStatus','resolved') ELSE b END ORDER BY b->>'operationScheduleId'),'[]'::jsonb)
 INTO result FROM jsonb_array_elements(base) b
 LEFT JOIN public.hotel_stays s ON s.id::text=b->>'hotelStayId'
 LEFT JOIN LATERAL (SELECT value p FROM jsonb_array_elements(proof) WHERE value->>'hotelStayId'=b->>'hotelStayId') pp ON true
 LEFT JOIN event_links links ON links.operation_schedule_id::text=b->>'operationScheduleId'
 CROSS JOIN LATERAL (SELECT count(*) n,jsonb_agg(z)->0 segment FROM jsonb_array_elements(coalesce(p->'segments','[]'::jsonb)) z
 WHERE (b->>'hotelEventKind'='check_in' AND (z->>'usedFrom')::timestamptz<=s.checked_in_at AND (z->>'usedUntil')::timestamptz>s.checked_in_at)
 OR (b->>'hotelEventKind'='check_out' AND (z->>'usedFrom')::timestamptz<s.checked_out_at AND (z->>'usedUntil')::timestamptz>=s.checked_out_at)) matched;
 RETURN result;
END $$;

CREATE FUNCTION public.get_hotel_shared_room_history(p_local_date date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE ids uuid[];proof jsonb; ds timestamptz; de timestamptz; result jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_active_operation_member() THEN RAISE EXCEPTION 'Hotel history authorization required' USING errcode='42501';END IF;
 IF p_local_date IS NULL THEN RAISE EXCEPTION 'Date required' USING errcode='22023';END IF;
 ds:=p_local_date::timestamp AT TIME ZONE 'Asia/Seoul';de:=(p_local_date+1)::timestamp AT TIME ZONE 'Asia/Seoul';
 SELECT array_agg(DISTINCT s.id) INTO ids FROM public.hotel_stays s
 WHERE s.checked_in_at<de AND coalesce(s.checked_out_at,statement_timestamp())>ds
 AND EXISTS(SELECT 1 FROM public.family_booking_members f WHERE f.hotel_stay_id=s.id AND f.shared_room_group_id IS NOT NULL);
 proof:=public.hotel_shared_verified_segments_internal(coalesce(ids,'{}'::uuid[]));
 SELECT jsonb_build_object('coverageStatus','SHARED_ONLY','segments',coalesce((
 SELECT jsonb_agg(z||jsonb_build_object('hotelStayId',p->'hotelStayId','dogName',d.name,
 'displayFrom',greatest(ds,(z->>'usedFrom')::timestamptz),'displayUntil',least(de,(z->>'usedUntil')::timestamptz)) ORDER BY z->>'roomId',p->>'hotelStayId',z->>'usedFrom')
 FROM jsonb_array_elements(proof) p CROSS JOIN LATERAL jsonb_array_elements(p->'segments') z
 JOIN public.dogs d ON d.id::text=p->>'dogId'
 WHERE p->>'resolutionStatus'='resolved' AND (z->>'usedFrom')::timestamptz<de AND (z->>'usedUntil')::timestamptz>ds),'[]'::jsonb),
 'unavailableMembers',coalesce((SELECT jsonb_agg(jsonb_build_object('hotelStayId',p->'hotelStayId','dogName',d.name,'reasonCode',p->'reasonCode'))
 FROM jsonb_array_elements(proof) p JOIN public.dogs d ON d.id::text=p->>'dogId' WHERE p->>'resolutionStatus'<>'resolved'),'[]'::jsonb)) INTO result;
 RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.hotel_shared_semantic_internal(text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.hotel_shared_chain_internal(text,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.hotel_shared_verified_segments_internal(uuid[]) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.get_completed_shared_hotel_stays(date) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.get_operation_hotel_room_projections_v2(uuid[]) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.get_hotel_shared_room_history(date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_completed_shared_hotel_stays(date) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_operation_hotel_room_projections_v2(uuid[]) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_hotel_shared_room_history(date) TO authenticated,service_role;
COMMIT;
