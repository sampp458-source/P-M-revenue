-- Production READ ONLY shape check; installs nothing and returns aggregate counts only.
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout='15s';
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
SELECT current_setting('transaction_read_only') read_only,
 CASE WHEN daycare THEN 'daycare' ELSE 'general_or_hotel_schedule' END domain,
 count(*) audited_identities,count(*) FILTER(WHERE resolved) resolved,
 count(*) FILTER(WHERE NOT resolved) fail_closed,
 count(*) FILTER(WHERE status='completed' AND resolved) completed_resolved,
 count(*) FILTER(WHERE link->'archived_at'<>'null'::jsonb AND resolved) archived_resolved,
 count(DISTINCT (link->>'schedule_id',dog_id)) unchanged_business_identity_count,
 0 mutation_count
FROM evaluated GROUP BY daycare ORDER BY daycare;
ROLLBACK;
