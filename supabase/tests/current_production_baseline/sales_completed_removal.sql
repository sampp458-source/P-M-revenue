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

DO $$ DECLARE sid uuid; d date:=current_date; BEGIN
 sid:=public.create_sale_with_payments(jsonb_build_object('sale_date',d,'business_unit_id',pg_temp.f(10),'dog_id',pg_temp.f(5),'customer_id',pg_temp.f(800),'product_id',pg_temp.f(60),'original_amount',100,'quantity',1,'unit_price',100,'paid_amount',50,'customer_type','new','outstanding_amount',50,'business_unit_name','Synthetic Hotel','product_name','Synthetic Product'),jsonb_build_array(jsonb_build_object('payment_method','cash','amount',25),jsonb_build_object('payment_method','card','amount',25)));
 PERFORM public.add_sale_payment(sid,50,'cash',d,'Synthetic payment',gen_random_uuid());
 PERFORM public.record_sale_refund(sid,d,10,'Synthetic refund');
 RAISE NOTICE 'BASELINE_SALES_CREATE_PAYMENT_REFUND_PASS';
 PERFORM pg_temp.remove_history(5);
 PERFORM pg_temp.check_true(EXISTS(SELECT 1 FROM sales WHERE id=sid AND dog_id=pg_temp.f(5)),'sales FK retained');
END $$;
ROLLBACK;
