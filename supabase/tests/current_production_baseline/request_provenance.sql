BEGIN;
DO $$ BEGIN IF current_database()<>'dog_current_baseline' OR inet_server_addr() IS NOT NULL THEN RAISE EXCEPTION 'LOCAL_ONLY'; END IF; END $$;
SET LOCAL timezone='UTC';
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000900',true);
CREATE FUNCTION pg_temp.f(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
CREATE FUNCTION pg_temp.ok(b boolean,label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF b IS DISTINCT FROM true THEN RAISE EXCEPTION 'ASSERTION: %',label; END IF; END $$;
DO $$ DECLARE sid uuid; rid uuid:=gen_random_uuid(); at_time timestamptz; j jsonb; body jsonb; old_sale jsonb; new_sale jsonb; history_id uuid; cv integer; v integer; d date:=(now() AT TIME ZONE 'Asia/Seoul')::date; BEGIN
 sid:=create_sale_with_payments(jsonb_build_object('sale_date',d,'business_unit_id',pg_temp.f(10),'dog_id',pg_temp.f(5),'customer_id',pg_temp.f(800),'product_id',pg_temp.f(60),'original_amount',100,'quantity',1,'unit_price',100,'paid_amount',100,'customer_type','new','outstanding_amount',0,'business_unit_name','Synthetic Hotel','product_name','Synthetic Product'),'[{"payment_method":"cash","amount":50},{"payment_method":"card","amount":50}]'::jsonb);
 SELECT updated_at INTO at_time FROM sales WHERE id=sid;
 PERFORM edit_sale_with_initial_payments(sid,at_time,'{}'::jsonb,(SELECT jsonb_agg(jsonb_build_object('payment_id',id,'payment_method',payment_method,'amount',amount)) FROM sale_payments WHERE sale_id=sid),'Synthetic exact receipt',rid);
 SELECT to_jsonb(r) INTO body FROM sale_initial_payment_edit_requests r WHERE request_id=rid;
 PERFORM pg_temp.ok(dog_remaining_trace_resolved_v2a('sale_initial_payment_edit_requests',body,pg_temp.f(5)),'real sales edit receipt');
 PERFORM pg_temp.ok(NOT dog_remaining_trace_resolved_v2a('sale_initial_payment_edit_requests',body,pg_temp.f(6)),'wrong receipt dog');
 PERFORM pg_temp.ok(NOT dog_remaining_trace_resolved_v2a('sale_initial_payment_edit_requests',jsonb_set(body,'{result,saleId}',to_jsonb(gen_random_uuid())),pg_temp.f(5)),'wrong receipt result');

 -- A complete, one-hop synthetic reassignment proves the older creation trace.
 -- Isolated full-row snapshot fixture (no payment side effects between snapshots).
 INSERT INTO sales SELECT (jsonb_populate_record(NULL::public.sales,to_jsonb(s)||jsonb_build_object('id',gen_random_uuid(),'dog_id',pg_temp.f(7)))).* FROM sales s WHERE id=sid RETURNING id INTO sid;

 SELECT to_jsonb(s) INTO old_sale FROM sales s WHERE id=sid;
 UPDATE sales SET dog_id=pg_temp.f(6) WHERE id=sid;
 SELECT to_jsonb(s) INTO new_sale FROM sales s WHERE id=sid;
 SELECT id INTO STRICT history_id FROM sale_history WHERE sale_id=sid AND action='updated';
 PERFORM pg_temp.ok(NOT(preview_dog_profile_removal(pg_temp.f(7))->'blockingReasonCodes' ? 'UNRESOLVED_STRUCTURED_IDENTITY'),'old creation resolved through exact full snapshot hop');
 UPDATE sale_history SET previous_data=previous_data||jsonb_build_object('memo','mismatch') WHERE id=history_id;
 PERFORM pg_temp.ok(preview_dog_profile_removal(pg_temp.f(7))->'blockingReasonCodes' ? 'UNRESOLVED_STRUCTURED_IDENTITY','broken full snapshot hop fail closed');
 UPDATE sale_history SET previous_data=old_sale WHERE id=history_id;
 UPDATE sales SET memo='later unmatched state' WHERE id=sid;
 PERFORM pg_temp.ok(preview_dog_profile_removal(pg_temp.f(7))->'blockingReasonCodes' ? 'UNRESOLVED_STRUCTURED_IDENTITY','retained end mismatch fail closed');
 j:=create_flexible_hotel_reservation(pg_temp.f(20),pg_temp.f(30),d,'00:00',false,d+2,'15:00',false,pg_temp.f(40),pg_temp.f(2),pg_temp.f(800),ARRAY[pg_temp.f(900)],'Synthetic reversal',gen_random_uuid());sid:=(j->>'id')::uuid;
 SELECT version INTO cv FROM hotel_capacity_reservations WHERE hotel_stay_id=sid AND archived_at IS NULL;
 PERFORM check_in_unassigned_hotel_stay(sid,(j->>'version')::int,cv,pg_temp.f(51),statement_timestamp()-interval '1 minute',gen_random_uuid());
 SELECT version INTO v FROM hotel_stays WHERE id=sid;rid:=gen_random_uuid();
 PERFORM reverse_check_in_and_unassign_hotel_room(sid,v,'Synthetic reversal',rid);
 SELECT to_jsonb(r) INTO body FROM hotel_atomic_reverse_unassign_requests r WHERE request_id=rid;
 PERFORM pg_temp.ok(dog_remaining_trace_resolved_v2a('hotel_atomic_reverse_unassign_requests',body,pg_temp.f(2)),'real atomic reverse receipt');
 PERFORM pg_temp.ok(NOT dog_remaining_trace_resolved_v2a('hotel_atomic_reverse_unassign_requests',body,pg_temp.f(3)),'wrong reverse dog');
 PERFORM pg_temp.ok(NOT dog_remaining_trace_resolved_v2a('hotel_atomic_reverse_unassign_requests',jsonb_set(body,'{completed_at}','null'),pg_temp.f(2)),'incomplete reverse receipt');
 RAISE NOTICE 'REAL_SALES_AND_ATOMIC_REVERSE_REQUEST_PROVENANCE_PASS';
END $$;
ROLLBACK;
