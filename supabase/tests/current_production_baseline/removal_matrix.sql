BEGIN;
DO $$ BEGIN IF current_database()<>'dog_current_baseline' OR inet_server_addr() IS NOT NULL THEN RAISE EXCEPTION 'LOCAL_ONLY'; END IF; END $$;
SET LOCAL ROLE authenticated;
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

DO $$ DECLARE j jsonb; p jsonb; sid uuid; v integer; cv integer; a jsonb; b jsonb; d date:=(now() AT TIME ZONE 'Asia/Seoul')::date; BEGIN
 p:=public.preview_dog_profile_removal(pg_temp.f(9));
 PERFORM public.remove_dog_profile(pg_temp.f(9),(p->>'version')::bigint,p->>'graphFingerprint','hard_delete',gen_random_uuid(),'Synthetic unused');
 PERFORM pg_temp.check_true(NOT EXISTS(SELECT 1 FROM dogs WHERE id=pg_temp.f(9)),'unused hard delete');
 j:=public.create_operation_schedule(pg_temp.f(22),pg_temp.f(30),'Synthetic complete',now()-interval '3 days',now()-interval '3 days'+interval '1 hour',false,false,'Synthetic',ARRAY[pg_temp.f(900)],ARRAY[pg_temp.f(800)],ARRAY[pg_temp.f(1)],gen_random_uuid());
 sid:=(j->>'id')::uuid;
 PERFORM public.set_operation_schedule_status(sid,(j->>'version')::integer,'completed','Synthetic',gen_random_uuid());
 PERFORM pg_temp.remove_history(1);
 PERFORM pg_temp.check_true(EXISTS(SELECT 1 FROM operation_schedule_dogs WHERE schedule_id=sid AND dog_id=pg_temp.f(1)),'schedule FK retained');
 j:=public.create_flexible_hotel_reservation(pg_temp.f(20),pg_temp.f(30),d-2,'00:00',false,d+2,'15:00',false,pg_temp.f(40),pg_temp.f(2),pg_temp.f(800),ARRAY[pg_temp.f(900)],'Synthetic history',gen_random_uuid());
 sid:=(j->>'id')::uuid;
 SELECT version INTO cv FROM hotel_capacity_reservations WHERE hotel_stay_id=sid AND archived_at IS NULL;
 PERFORM public.recover_missed_hotel_check_in(sid,(j->>'version')::integer,cv,pg_temp.f(51),(d-2+'09:00'::time) AT TIME ZONE 'Asia/Seoul',gen_random_uuid());
 SELECT version INTO v FROM hotel_stays WHERE id=sid;
 PERFORM public.complete_hotel_check_out(sid,v,statement_timestamp(),gen_random_uuid());
 a:=public.get_hotel_historical_room_board(d-2);
 PERFORM pg_temp.remove_history(2);
 b:=public.get_hotel_historical_room_board(d-2);
 PERFORM pg_temp.check_true(a=b,'historical hotel exact JSON preserved');
 PERFORM pg_temp.check_true(EXISTS(SELECT 1 FROM hotel_stays WHERE id=sid AND dog_id=pg_temp.f(2)),'hotel FK retained');
 j:=public.create_operation_schedule(pg_temp.f(22),pg_temp.f(30),'Synthetic archive',now()-interval '3 days',now()-interval '3 days'+interval '1 hour',false,false,'Synthetic',ARRAY[pg_temp.f(900)],ARRAY[pg_temp.f(800)],ARRAY[pg_temp.f(8)],gen_random_uuid());
 sid:=(j->>'id')::uuid;
 j:=public.update_operation_schedule(sid,(j->>'version')::integer,pg_temp.f(22),pg_temp.f(30),'Synthetic replacement',now()-interval '3 days',now()-interval '3 days'+interval '1 hour',false,false,'Synthetic',ARRAY[pg_temp.f(900)],ARRAY[pg_temp.f(800)],ARRAY[pg_temp.f(7)],gen_random_uuid());
 PERFORM public.set_operation_schedule_status(sid,(j->>'version')::integer,'completed','Synthetic',gen_random_uuid());
 PERFORM pg_temp.remove_history(8);
 PERFORM pg_temp.check_true(EXISTS(SELECT 1 FROM operation_schedule_dogs WHERE dog_id=pg_temp.f(8) AND archived_at IS NOT NULL),'archived FK retained');
 j:=public.create_operation_schedule(pg_temp.f(22),pg_temp.f(30),'Synthetic future',now()+interval '3 days',now()+interval '3 days 1 hour',false,false,'Synthetic',ARRAY[pg_temp.f(900)],ARRAY[pg_temp.f(800)],ARRAY[pg_temp.f(3)],gen_random_uuid());
 PERFORM pg_temp.check_true(NOT (public.preview_dog_profile_removal(pg_temp.f(3))->>'profileRemovalEligible')::boolean,'future schedule blocked');
 j:=public.create_flexible_hotel_reservation(pg_temp.f(20),pg_temp.f(30),d,'00:00',false,d+2,'15:00',false,pg_temp.f(40),pg_temp.f(4),pg_temp.f(800),ARRAY[pg_temp.f(900)],'Synthetic active',gen_random_uuid());
 PERFORM pg_temp.check_true(NOT (public.preview_dog_profile_removal(pg_temp.f(4))->>'profileRemovalEligible')::boolean,'active hotel blocked');
 j:=public.create_long_stay_contract(pg_temp.f(800),pg_temp.f(5),d,d+10,pg_temp.f(40),pg_temp.f(54),1000,1,'Synthetic',gen_random_uuid());
 PERFORM pg_temp.check_true(NOT (public.preview_dog_profile_removal(pg_temp.f(5))->>'profileRemovalEligible')::boolean,'current long stay blocked');
 PERFORM public.register_journal_roster(d,ARRAY[pg_temp.f(6)],gen_random_uuid());
 PERFORM pg_temp.check_true(NOT (public.preview_dog_profile_removal(pg_temp.f(6))->>'profileRemovalEligible')::boolean,'journal draft blocked');
 RAISE NOTICE 'REMOVAL_UNUSED_SCHEDULE_HOTEL_AND_ACTIVE_NEGATIVES_PASS';
END $$;
RESET ROLE;
INSERT INTO entity_audit_events(module_code,entity_type,entity_id,action,after_data,changed_by)
VALUES('operations','synthetic_unknown',gen_random_uuid(),'created',jsonb_build_object('dog_id',pg_temp.f(7)),pg_temp.f(900));
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_true(public.preview_dog_profile_removal(pg_temp.f(7))->'blockingReasonCodes' ? 'UNRESOLVED_STRUCTURED_IDENTITY','unknown trace remains fail closed');
ROLLBACK;
