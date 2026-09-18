-- Synthetic-only contract tests. Corrupt snapshots are never written to Production.
BEGIN;
DO $$ BEGIN IF current_database()<>'dog_current_baseline' OR inet_server_addr() IS NOT NULL THEN RAISE EXCEPTION 'LOCAL_ONLY'; END IF; END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000900',true);
CREATE FUNCTION pg_temp.f(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
CREATE FUNCTION pg_temp.ok(b boolean,label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF b IS DISTINCT FROM true THEN RAISE EXCEPTION 'ASSERTION: %',label; END IF; END $$;
DO $$ DECLARE j jsonb; p jsonb; a jsonb; before_link jsonb; after_link jsonb; sid uuid; lid uuid; other uuid; v integer; BEGIN
 j:=public.create_operation_schedule(pg_temp.f(22),pg_temp.f(30),'Synthetic provenance',now()-interval '3 days',now()-interval '3 days'+interval '1 hour',false,false,'Synthetic',ARRAY[pg_temp.f(900)],ARRAY[pg_temp.f(800)],ARRAY[pg_temp.f(1),pg_temp.f(2)],gen_random_uuid());
 sid:=(j->>'id')::uuid;
 PERFORM public.set_operation_schedule_status(sid,(j->>'version')::integer,'completed','Synthetic',gen_random_uuid());
 SELECT id,to_jsonb(l) INTO lid,before_link FROM operation_schedule_dogs l WHERE schedule_id=sid AND dog_id=pg_temp.f(1);
 SELECT to_jsonb(e) INTO a FROM entity_audit_events e WHERE entity_type='operation_schedule_dogs' AND entity_id=lid AND action='created';
 PERFORM pg_temp.ok(public.dog_schedule_audit_resolved_v2a(a,pg_temp.f(1)),'created link audit');
 PERFORM pg_temp.ok(NOT public.dog_schedule_audit_resolved_v2a(a,pg_temp.f(2)),'multiple dogs independent');
 p:=public.preview_dog_profile_removal(pg_temp.f(1));
 PERFORM pg_temp.ok((p->>'profileRemovalEligible')::boolean,'completed general schedule eligible');
 PERFORM pg_temp.ok((p->'categories' @> '[{"category":"schedules","userVisibleCount":1}]') AND (p->>'structuredIdentityTraceCount')::int>0,'business count unchanged technical trace retained');
 PERFORM pg_temp.ok(NOT public.dog_schedule_audit_resolved_v2a(jsonb_set(a,'{after_data,schedule_id}',to_jsonb(pg_temp.f(777))),pg_temp.f(1)),'wrong schedule fail closed');
 PERFORM pg_temp.ok(NOT public.dog_schedule_audit_resolved_v2a(jsonb_set(a,'{after_data,dog_id}',to_jsonb(pg_temp.f(2))),pg_temp.f(1)),'wrong dog fail closed');
 PERFORM pg_temp.ok(NOT public.dog_schedule_audit_resolved_v2a(a-'entity_id',pg_temp.f(1)),'missing entity fail closed');
 PERFORM pg_temp.ok(NOT public.dog_schedule_audit_resolved_v2a(jsonb_set(a,'{entity_id}','"malformed"'),pg_temp.f(1)),'malformed entity fail closed without cast error');
 PERFORM pg_temp.ok(NOT public.dog_schedule_audit_resolved_v2a(jsonb_set(jsonb_set(a,'{entity_id}',to_jsonb(pg_temp.f(778))),'{after_data,id}',to_jsonb(pg_temp.f(778))),pg_temp.f(1)),'missing link complete snapshot fail closed');
 PERFORM pg_temp.ok(NOT public.dog_schedule_audit_resolved_v2a(jsonb_set(a,'{after_data}',(a->'after_data')-'schedule_id'),pg_temp.f(1)),'incomplete snapshot fail closed');
 PERFORM pg_temp.ok(NOT public.dog_schedule_audit_resolved_v2a(a||jsonb_build_object('after_data',(a->'after_data')||jsonb_build_object('unrelated',jsonb_build_object('dog_id',pg_temp.f(3)))),pg_temp.f(3)),'nested dog is not proven relation');
 -- Real trigger creates an exact before/after reassignment audit. Separate link 2 stays intact.
 UPDATE operation_schedule_dogs SET dog_id=pg_temp.f(3) WHERE id=lid;
 SELECT to_jsonb(l) INTO after_link FROM operation_schedule_dogs l WHERE id=lid;
 PERFORM pg_temp.ok(public.dog_schedule_audit_resolved_v2a(a,pg_temp.f(1)),'prior created A resolved via exact reassignment');
 SELECT to_jsonb(e) INTO a FROM entity_audit_events e WHERE entity_type='operation_schedule_dogs' AND entity_id=lid AND action='updated' ORDER BY created_at DESC LIMIT 1;
 PERFORM pg_temp.ok(public.dog_schedule_audit_resolved_v2a(a,pg_temp.f(1)) AND public.dog_schedule_audit_resolved_v2a(a,pg_temp.f(3)),'A to B both identities proven');
 PERFORM pg_temp.ok(NOT public.dog_schedule_audit_resolved_v2a(jsonb_set(a,'{before_data,schedule_id}',to_jsonb(pg_temp.f(779))),pg_temp.f(1)),'conflicting snapshots fail closed');
 -- Archive a distinct normal link so its original audit and archive audit resolve.
 SELECT id INTO other FROM operation_schedule_dogs WHERE schedule_id=sid AND dog_id=pg_temp.f(2);
 UPDATE operation_schedule_dogs SET archived_at=now(),archived_by=pg_temp.f(900),archive_reason='Synthetic archive' WHERE id=other;
 SELECT to_jsonb(e) INTO a FROM entity_audit_events e WHERE entity_type='operation_schedule_dogs' AND entity_id=other AND action='archived';
 PERFORM pg_temp.ok(public.dog_schedule_audit_resolved_v2a(a,pg_temp.f(2)),'archive snapshot resolved');
 PERFORM pg_temp.ok((public.preview_dog_profile_removal(pg_temp.f(2))->>'profileRemovalEligible')::boolean,'archived historical reference eligible');
 UPDATE operation_schedule_dogs SET archived_at=NULL,archived_by=NULL,archive_reason=NULL WHERE id=other;
 SELECT to_jsonb(e) INTO a FROM entity_audit_events e WHERE entity_type='operation_schedule_dogs' AND entity_id=other AND action='restored';
 PERFORM pg_temp.ok(public.dog_schedule_audit_resolved_v2a(a,pg_temp.f(2)),'restore snapshot resolved');
 RAISE NOTICE 'SCHEDULE_AUDIT_PROVENANCE_MATRIX_PASS';
END $$;
DO $$ BEGIN
 PERFORM pg_temp.ok(NOT has_function_privilege('authenticated','public.dog_schedule_audit_resolved_v2a(jsonb,uuid)','EXECUTE'),'helper ACL auth');
 PERFORM pg_temp.ok(NOT has_function_privilege('anon','public.dog_schedule_audit_resolved_v2a(jsonb,uuid)','EXECUTE'),'helper ACL anon');
 PERFORM pg_temp.ok(NOT has_function_privilege('service_role','public.dog_schedule_audit_resolved_v2a(jsonb,uuid)','EXECUTE'),'helper ACL service');
END $$;
WITH samples AS MATERIALIZED (
 SELECT to_jsonb(a) audit,to_jsonb(l) link,s.status,dc.operation_schedule_id IS NOT NULL daycare,
   a.before_data prior,a.after_data later,d.id dog_id
 FROM public.entity_audit_events a
 JOIN public.operation_schedule_dogs l ON l.id=a.entity_id
 JOIN public.operation_schedules s ON s.id=l.schedule_id
 LEFT JOIN public.daycare_operation_states dc ON dc.operation_schedule_id=s.id
 JOIN public.dogs d ON d.id::text IN (a.before_data->>'dog_id',a.after_data->>'dog_id')
 WHERE a.entity_type='operation_schedule_dogs'
 ORDER BY a.created_at DESC,a.id,d.id LIMIT 500
), evaluated AS (
 SELECT *, coalesce(
 audit->>'module_code'='operations' AND audit->>'action' IN ('created','updated','archived','restored')
 AND jsonb_typeof(later)='object'
 AND (CASE WHEN audit->>'action'='created' THEN prior IS NULL OR prior='null'::jsonb ELSE jsonb_typeof(prior)='object' END)
 AND NOT EXISTS(SELECT 1 FROM (VALUES(prior),(later)) snap(v) WHERE v IS NOT NULL AND v<>'null'::jsonb AND NOT coalesce(
   jsonb_typeof(v)='object' AND v ?& ARRAY['id','schedule_id','dog_id','archived_at','archive_reason']
   AND v->>'id'=link->>'id' AND v->>'schedule_id'=link->>'schedule_id'
   AND EXISTS(SELECT 1 FROM public.dogs d WHERE d.id::text=v->>'dog_id')
   AND jsonb_typeof(v->'archived_at') IN ('null','string') AND jsonb_typeof(v->'archive_reason') IN ('null','string'),false))
 AND (prior->>'dog_id'=dog_id::text OR later->>'dog_id'=dog_id::text)
 AND CASE audit->>'action'
   WHEN 'archived' THEN prior->'archived_at'='null'::jsonb AND later->'archived_at'<>'null'::jsonb
   WHEN 'restored' THEN prior->'archived_at'<>'null'::jsonb AND later->'archived_at'='null'::jsonb
   WHEN 'updated' THEN (prior->'archived_at'='null'::jsonb) IS NOT DISTINCT FROM (later->'archived_at'='null'::jsonb)
   ELSE true END
 AND (later->>'dog_id'=link->>'dog_id' OR EXISTS(SELECT 1 FROM public.entity_audit_events a
   WHERE a.module_code='operations' AND a.entity_type='operation_schedule_dogs' AND a.entity_id::text=link->>'id' AND a.action='updated'
    AND a.before_data=later AND a.after_data=link
    AND (a.before_data->'archived_at'='null'::jsonb)=(a.after_data->'archived_at'='null'::jsonb))),false) resolved
 FROM samples
)
SELECT pg_temp.ok(bool_and(resolved=public.dog_schedule_audit_resolved_v2a(audit,dog_id)),'production CTE/helper parity') FROM evaluated;
ROLLBACK;
