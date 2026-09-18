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

DO $$ DECLARE j jsonb; sid uuid; cid uuid; oid uuid; v integer; sv integer; d date:=(now() AT TIME ZONE 'Asia/Seoul')::date; BEGIN
 j:=public.create_daycare_reservation(pg_temp.f(21),pg_temp.f(30),pg_temp.f(800),pg_temp.f(4),d-2,'09:00','18:00',pg_temp.f(40),pg_temp.f(53),ARRAY[pg_temp.f(900)],'Synthetic',gen_random_uuid());
 SELECT operation_schedule_id,version INTO sid,v FROM daycare_operation_states WHERE canonical_payload->>'dogId'=pg_temp.f(4)::text;
 PERFORM public.complete_daycare_check_in(sid,v,(d-2+'09:00'::time) AT TIME ZONE 'Asia/Seoul',gen_random_uuid());
 SELECT version INTO v FROM daycare_operation_states WHERE operation_schedule_id=sid;
 PERFORM public.complete_daycare_check_out(sid,v,(d-2+'17:00'::time) AT TIME ZONE 'Asia/Seoul',gen_random_uuid());
 PERFORM pg_temp.remove_history(4);
 RAISE NOTICE 'DAYCARE_HISTORY_REMOVAL_PASS';
 sid:=public.create_sale_with_payments(jsonb_build_object('sale_date',d,'business_unit_id',pg_temp.f(10),'dog_id',pg_temp.f(5),'customer_id',pg_temp.f(800),'product_id',pg_temp.f(60),'original_amount',100,'quantity',1,'unit_price',100,'paid_amount',50,'customer_type','new','outstanding_amount',50,'business_unit_name','Synthetic Hotel','product_name','Synthetic Product'),jsonb_build_array(jsonb_build_object('payment_method','cash','amount',25),jsonb_build_object('payment_method','card','amount',25)));
 PERFORM pg_temp.check_true(public.preview_dog_profile_removal(pg_temp.f(5))->'warnings' ? 'OUTSTANDING_SALES','outstanding warning');
 PERFORM pg_temp.remove_history(5);
 PERFORM public.add_sale_payment(sid,50,'cash',d,'Synthetic payment',gen_random_uuid());
 PERFORM public.record_sale_refund(sid,d,10,'Synthetic refund');
 RAISE NOTICE 'BASELINE_SALES_CREATE_PAYMENT_REFUND_PASS';
 j:=public.create_long_stay_contract(pg_temp.f(800),pg_temp.f(6),d-2,d+10,pg_temp.f(40),pg_temp.f(54),1000,1,'Synthetic',gen_random_uuid());
 cid:=(j->>'id')::uuid; v:=(j->>'version')::integer;
 PERFORM public.confirm_long_stay_month_v2(cid,v,date_trunc('month',d)::date,d-2,pg_temp.f(20),pg_temp.f(30),'09:00',false,pg_temp.f(40),pg_temp.f(54),ARRAY[pg_temp.f(900)],'Synthetic confirm',gen_random_uuid());
 j:=public.get_long_stay_contract(cid); v:=(j->>'version')::integer; sid:=(j->>'hotelStayId')::uuid;
 SELECT version INTO sv FROM hotel_stays WHERE id=sid;
 PERFORM public.complete_long_stay_check_in(cid,v,sv,(d-2+'09:00'::time) AT TIME ZONE 'Asia/Seoul','Synthetic arrival',gen_random_uuid());
 j:=public.get_long_stay_contract(cid); v:=(j->>'version')::integer;
 PERFORM public.start_long_stay_absence_v3(cid,v,(d-1+'09:00'::time) AT TIME ZONE 'Asia/Seoul',d-1,'15:00',false,'keep_room','Synthetic','Synthetic outing',gen_random_uuid());
 j:=public.get_long_stay_contract(cid); v:=(j->>'version')::integer;
 PERFORM public.complete_long_stay_absence_v2(cid,v,(d-1+'15:00'::time) AT TIME ZONE 'Asia/Seoul',NULL,'Synthetic','Synthetic return',gen_random_uuid());
 j:=public.get_long_stay_contract(cid); v:=(j->>'version')::integer; sid:=(j->>'hotelStayId')::uuid; SELECT version INTO sv FROM hotel_stays WHERE id=sid;
 PERFORM public.complete_long_stay_check_out(cid,v,sv,statement_timestamp(),'Synthetic checkout',gen_random_uuid());
 PERFORM pg_temp.remove_history(6);
 PERFORM pg_temp.check_true(public.get_long_stay_contract(cid)->>'dogName'='Synthetic Dog 6','long stay historical identity');
 RAISE NOTICE 'LONG_STAY_HISTORY_REMOVAL_PASS';
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
 PERFORM pg_temp.check_true(public.get_hotel_shared_room_history(d-2)::text LIKE '%Synthetic Dog 7%','Shared historical identity');
 RAISE NOTICE 'BASELINE_SHARED_REQUESTED_ALLOCATED_TWO_MEMBERS_COMPLETE_HISTORY_PASS';
 PERFORM public.register_journal_roster(d,ARRAY[pg_temp.f(1),pg_temp.f(9)],gen_random_uuid());
 SELECT id,version INTO sid,v FROM journal_entries WHERE dog_id=pg_temp.f(9);
 PERFORM public.update_journal_entry_draft_v2(sid,v,ARRAY['active'],true,false,NULL,ARRAY['daycare_food'],'loves_teacher','loves_friends',jsonb_build_array(jsonb_build_object('type','DOG','dogId',pg_temp.f(1))),NULL,NULL,NULL,NULL,'Synthetic happy day',gen_random_uuid());
 SELECT version INTO v FROM journal_entries WHERE id=sid; PERFORM public.complete_journal_entry(sid,v,gen_random_uuid());
 PERFORM pg_temp.remove_history(9);
 PERFORM pg_temp.check_true(public.get_journal_entry(sid)::text LIKE '%Synthetic Dog 9%','journal identity');
 RAISE NOTICE 'JOURNAL_HISTORY_REMOVAL_PASS';
END $$;
ROLLBACK;
