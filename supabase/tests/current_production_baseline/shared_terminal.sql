BEGIN;
DO $$ BEGIN IF current_database()<>'dog_current_baseline' OR inet_server_addr() IS NOT NULL THEN RAISE EXCEPTION 'LOCAL_ONLY'; END IF; END $$;

SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000900',true);
CREATE FUNCTION pg_temp.f(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
-- Included inside a local synthetic transaction, after pg_temp.f is defined.
CREATE FUNCTION pg_temp.check_true(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'ASSERTION: %',label; END IF; END $$;
CREATE FUNCTION pg_temp.remove_history(n integer) RETURNS void LANGUAGE plpgsql AS $$ DECLARE p jsonb; r jsonb; audit_before jsonb; BEGIN
 SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY id),'[]'::jsonb) INTO audit_before FROM entity_audit_events e;
 p:=public.preview_dog_profile_removal(pg_temp.f(n));
 IF p->>'proposedMode' IS DISTINCT FROM 'profile_remove' THEN
  RAISE NOTICE 'UNRESOLVED_AUDIT_EVIDENCE: %',(SELECT jsonb_agg(jsonb_build_object('entityType',e.entity_type,'entityId',e.entity_id,'action',e.action,'after',e.after_data,'before',e.before_data)) FROM public.entity_audit_events e WHERE 'entity_audit_events:'||e.id::text IN (SELECT trace_item.value->>'recordId' FROM jsonb_array_elements(p->'categories') c CROSS JOIN LATERAL jsonb_array_elements(c->'records') trace_item(value) WHERE trace_item.value->>'classification'='UNKNOWN'));
 END IF;
 PERFORM pg_temp.check_true(p->>'proposedMode'='profile_remove','history eligible dog '||n||' '||p::text);
 r:=public.remove_dog_profile(pg_temp.f(n),(p->>'version')::bigint,p->>'graphFingerprint','profile_remove',gen_random_uuid(),'Synthetic history preservation');
 PERFORM pg_temp.check_true((SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY id),'[]'::jsonb)=audit_before FROM entity_audit_events e),'audit original preserved '||n);
 PERFORM pg_temp.check_true(public.preview_dog_profile_removal(pg_temp.f(n))->'technicalReferenceCount'=p->'technicalReferenceCount','FK count preserved '||n);
 PERFORM pg_temp.check_true(public.get_historical_dog_identities(ARRAY[pg_temp.f(n)])->0->>'profileStatus'='removed','removed identity '||n);
END $$;

DO $$ DECLARE j jsonb; p jsonb; sid uuid; cid uuid; oid uuid; v integer; sv integer; day_before jsonb; ev record; bad jsonb; d date:=(now() AT TIME ZONE 'Asia/Seoul')::date; BEGIN
 j:=public.create_unassigned_shared_room_family_booking(pg_temp.f(800),'Synthetic',false,(SELECT jsonb_agg(jsonb_build_object('stableMemberKey','member-'||n,'dogId',pg_temp.f(n),'serviceType','hotel','assigneeIds',jsonb_build_array(pg_temp.f(900)),'sharedRoomGroupKey','synthetic-group','calendarId',pg_temp.f(20),'scheduleTypeId',pg_temp.f(30),'checkInDate',d-2,'checkInTime','09:00','checkOutDate',d+2,'checkOutTime','15:00','roomTypeId',pg_temp.f(40))) FROM generate_series(7,8) n),pg_temp.f(40),true,gen_random_uuid());
 cid:=(j->>'sharedRoomGroupId')::uuid;
 j:=public.create_shared_hotel_room_occupancy(cid,pg_temp.f(55),gen_random_uuid()); oid:=(j->>'id')::uuid;
 PERFORM pg_temp.check_true(NOT (public.preview_dog_profile_removal(pg_temp.f(7))->>'profileRemovalEligible')::boolean,'active Shared/family blocked');
 FOR sid IN SELECT (value->>'hotelStayId')::uuid FROM jsonb_array_elements(j->'members') LOOP
  v:=(public.get_shared_hotel_room_occupancy(oid)->>'version')::integer; SELECT version INTO sv FROM hotel_stays WHERE id=sid;
  PERFORM public.complete_shared_hotel_check_in(oid,sid,v,sv,(d-2+'10:00'::time) AT TIME ZONE 'Asia/Seoul',gen_random_uuid());
  v:=(public.get_shared_hotel_room_occupancy(oid)->>'version')::integer; SELECT version INTO sv FROM hotel_stays WHERE id=sid;
  PERFORM public.complete_shared_hotel_member_check_out(oid,sid,v,sv,statement_timestamp(),gen_random_uuid());
 END LOOP;
 -- Member checkout does not close the retained family booking in this RPC path.
 -- Keep the real current-family blocker; do not manufacture terminal parent state.
 PERFORM pg_temp.check_true(public.preview_dog_profile_removal(pg_temp.f(7))->'blockingReasonCodes' ? 'family_booking_ACTIVE_OPERATION','current family remains blocked after member checkout');

 RAISE NOTICE 'BASELINE_SHARED_REQUESTED_ALLOCATED_TWO_MEMBERS_COMPLETE_HISTORY_PASS';

 -- Explicit local synthetic terminal parent fixture; child terminal states came from real RPCs.
 PERFORM pg_temp.check_true(NOT EXISTS(SELECT 1 FROM family_booking_members WHERE family_booking_id=(SELECT family_booking_id FROM family_shared_room_groups WHERE id=cid) AND archived_at IS NULL AND status NOT IN ('completed','cancelled')),'all family children terminal');
 PERFORM pg_temp.check_true(EXISTS(SELECT 1 FROM hotel_physical_occupancies WHERE id=oid AND status IN ('completed','released')),'occupancy terminal');
 UPDATE family_bookings SET status='completed',updated_by=pg_temp.f(900) WHERE id=(SELECT family_booking_id FROM family_shared_room_groups WHERE id=cid);
 p:=preview_dog_profile_removal(pg_temp.f(7));
 PERFORM pg_temp.check_true((p->>'activeBlockerCount')::int=0,'terminal Shared no blockers '||p::text);
 day_before:=get_hotel_shared_room_history(d-2);
 PERFORM pg_temp.remove_history(7);
 PERFORM pg_temp.check_true(get_hotel_shared_room_history(d-2)=day_before,'Shared historical result preserved');
 FOR ev IN SELECT to_jsonb(a) body FROM entity_audit_events a WHERE entity_type IN ('family_booking_members','hotel_physical_occupancy_members') AND (after_data->>'dog_id'=pg_temp.f(7)::text) LOOP
  PERFORM pg_temp.check_true(dog_remaining_trace_resolved_v2a('entity_audit_events',ev.body,pg_temp.f(7)),'normal Shared child provenance');
  bad:=jsonb_set(ev.body,'{after_data,dog_id}',to_jsonb(pg_temp.f(8)));
  PERFORM pg_temp.check_true(NOT dog_remaining_trace_resolved_v2a('entity_audit_events',bad,pg_temp.f(7)),'wrong member dog rejected');
  bad:=jsonb_set(ev.body,'{entity_id}',to_jsonb(gen_random_uuid()));
  PERFORM pg_temp.check_true(NOT dog_remaining_trace_resolved_v2a('entity_audit_events',bad,pg_temp.f(7)),'missing member rejected');
  bad:=jsonb_set(ev.body,'{after_data}',jsonb_build_object('dog_id',pg_temp.f(7)));
  PERFORM pg_temp.check_true(NOT dog_remaining_trace_resolved_v2a('entity_audit_events',bad,pg_temp.f(7)),'incomplete member rejected');
 END LOOP;
 RAISE NOTICE 'SHARED_TERMINAL_REMOVAL_PASS';
END $$;
ROLLBACK;
