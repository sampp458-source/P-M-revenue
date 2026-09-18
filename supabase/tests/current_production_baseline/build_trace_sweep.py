"""Render READ ONLY CTE equivalent of candidate classifier; never connects to Production."""
from pathlib import Path
import re
here=Path(__file__).resolve().parent
root=here.parents[2]
s=(root/'supabase/migrations/202609170003_dog_structured_trace_provenance_closure.sql').read_text()
helpers={}
for name in ['dog_journal_audit_resolved_v2a','dog_remaining_trace_resolved_v2a']:
 helpers[name]=s.split('CREATE FUNCTION public.'+name,1)[1].split('AS $$',1)[1].split('$$;',1)[0]
q=s.split('\n WITH\n',1)[1].split('\n categories AS (',1)[0].rstrip().rstrip(',')
# Inline approved schedule predicate, preserving retained link join and full snapshot hop.
schedule=(here/'production_schedule_audit_recheck.sql').read_text()
pred=schedule.split('SELECT *, coalesce(',1)[1].split(' resolved\n FROM samples',1)[0]
schedule_expr="""(WITH sample AS (SELECT outer_trace.body audit, to_jsonb(l) link,
 outer_trace.body->'before_data' prior,outer_trace.body->'after_data' later,target.id dog_id
 FROM public.operation_schedule_dogs l JOIN public.operation_schedules s ON s.id=l.schedule_id
 WHERE l.id::text=outer_trace.body->>'entity_id') SELECT coalesce((SELECT coalesce("""+pred+" FROM sample),false))"
# pred ends in ',false)' for the original coalesce; balance generated opening.
start=q.index(' unresolved_traces AS (')
q=q[:start]+q[start:].replace('traces t','traces outer_trace').replace('t.*','outer_trace.*').replace('t.source','outer_trace.source').replace('t.key','outer_trace.key').replace('t.body','outer_trace.body')
q=q.replace('public.dog_schedule_audit_resolved_v2a(outer_trace.body,p_dog_id)',schedule_expr)
for name,body in helpers.items():
 args='outer_trace.body,p_dog_id' if 'journal' in name else 'outer_trace.source,outer_trace.body,p_dog_id'
 body=body.replace('p_body','outer_trace.body').replace('p_source','outer_trace.source').replace('p_dog_id','target.id')
 q=q.replace('public.'+name+'('+args+')','('+body+')')
q=q.replace('p_dog_id','target.id')
q+='''\n SELECT t.source,coalesce(t.body->>'entity_type','-') entity_type,
 count(*) total_target_dog_traces,
 count(*) FILTER(WHERE u.key IS NULL) resolved,
 count(*) FILTER(WHERE u.key IS NOT NULL) unresolved
 FROM traces t LEFT JOIN unresolved_traces u ON u.source=t.source AND u.key IS NOT DISTINCT FROM t.key
 GROUP BY t.source,t.body->>'entity_type' '''
# Scan JSON identity trees once, with the installed key/context recursion unchanged.
# This is a diagnostic execution plan change, not a Production classifier change.
import json,sys
manifest=json.loads(Path(sys.argv[1]).read_text())
sources={r['name']:[c['name'] for c in r['columns'] if c['type'] in ('json','jsonb')] for r in manifest['relations'] if r['kind'] in ('r','p') and (re.search('audit|request|receipt|history',r['name']) or r['name'] in ('family_bookings','daycare_operation_states'))}
sources={k:v for k,v in sources.items() if v}
unions=[]
for name,cols in sources.items():
 extra=" WHERE t.entity_type NOT IN ('dogs','dog')" if name=='entity_audit_events' else ''
 unions.append("SELECT '%s'::text source,coalesce(to_jsonb(t)->>'id',to_jsonb(t)->>'request_id',to_jsonb(t)->>'operation_schedule_id') key,to_jsonb(t) body,jsonb_build_array(%s) payload FROM public.%s t%s"%(name,','.join('t.'+c for c in cols),name,extra))
global_cte="all_source AS MATERIALIZED ("+' UNION ALL '.join(unions)+"""),
 candidate_ids AS MATERIALIZED (
 SELECT DISTINCT a.source,a.key,(m.parts)[1] dog_text FROM all_source a
 CROSS JOIN LATERAL regexp_matches(a.payload::text,'([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})','g') m(parts)
 ), discovered AS MATERIALIZED (
 SELECT c.source,c.key,d.id dog_id FROM candidate_ids c JOIN public.dogs d ON d.id::text=c.dog_text
 JOIN all_source a ON a.source=c.source AND a.key IS NOT DISTINCT FROM c.key
 WHERE public.dog_identity_in_payload_v2a(a.payload,d.id)
 ), """
a=q.index(' records(category,key,technical,classification,dates,evidence) AS (')
b=q.index(' -- Known non-FK',a)
q=q[:a]+''' records(key) AS (
 SELECT id::text FROM public.sales WHERE dog_id=target.id
 UNION SELECT schedule_id::text FROM links
 UNION SELECT id::text FROM stays
 UNION SELECT occupancy_id::text FROM shared
 UNION SELECT 'group:'||shared_room_group_id::text FROM members WHERE shared_room_group_id IS NOT NULL
 UNION SELECT id::text FROM contracts
 UNION SELECT id::text FROM entries
 UNION SELECT family_booking_id::text FROM members
 ),
'''+q[b:]
q=re.sub(r'public.dog_identity_in_payload_v2a\([^,]+,target.id\)','false',q)
q=q.replace('SELECT * FROM public.dog_structured_traces_v2a(target.id)',
 'SELECT a.source,a.key,a.body FROM all_source a JOIN discovered d ON d.source=a.source AND d.key IS NOT DISTINCT FROM a.key WHERE d.dog_id=target.id')
out='''-- Generated from final candidate READ classifier. Aggregate only, no correction installed.
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout='20s';
SET LOCAL jit=off;
WITH RECURSIVE '''+global_cte+'''targets AS MATERIALIZED (SELECT id FROM public.dogs ORDER BY id LIMIT 250),
evaluated AS MATERIALIZED (SELECT r.* FROM targets target CROSS JOIN LATERAL (WITH
'''+q+''') r)
SELECT current_setting('transaction_read_only') read_only,
 (SELECT count(*) FROM public.dogs) dog_population,(SELECT count(*) FROM targets) dogs_evaluated,
 source,entity_type,sum(total_target_dog_traces) total_target_dog_traces,
 sum(resolved) resolved,sum(unresolved) unresolved,
 CASE WHEN sum(unresolved)=0 THEN 'NONE' ELSE 'REQUIRES_EXACT_PROVENANCE_REVIEW' END unresolved_review,
 0 mutation_count
FROM evaluated GROUP BY source,entity_type ORDER BY source,entity_type;
ROLLBACK;
'''
assert 'public.dog_journal_audit_resolved' not in out and 'public.dog_remaining_trace_resolved' not in out and 'public.dog_schedule_audit_resolved' not in out

def global_plan(s):
 prefix=s.split('targets AS MATERIALIZED',1)[0]
 # Use globally keyed sets rather than invoking the full preview graph once per dog.
 keys=''' keys(dog_id,key) AS MATERIALIZED (
  SELECT dog_id,id::text FROM public.sales
  UNION SELECT dog_id,schedule_id::text FROM public.operation_schedule_dogs
  UNION SELECT dog_id,id::text FROM public.hotel_stays
  UNION SELECT dog_id,occupancy_id::text FROM public.hotel_physical_occupancy_members
  UNION SELECT dog_id,id::text FROM public.long_stay_contracts
  UNION SELECT dog_id,id::text FROM public.journal_entries
  UNION SELECT best_friend_dog_id,id::text FROM public.journal_entries WHERE best_friend_dog_id IS NOT NULL
  UNION SELECT dog_id,journal_entry_id::text FROM public.journal_entry_best_friend_targets WHERE dog_id IS NOT NULL
  UNION SELECT dog_id,family_booking_id::text FROM public.family_booking_members
  ), direct_parent AS MATERIALIZED (
  SELECT a.source,a.key,s.dog_id FROM all_source a JOIN public.hotel_stays s ON a.body->>'hotel_stay_id'=s.id::text
  UNION SELECT a.source,a.key,m.dog_id FROM all_source a JOIN public.hotel_physical_occupancy_members m ON a.body->>'occupancy_id'=m.occupancy_id::text
  UNION SELECT a.source,a.key,c.dog_id FROM all_source a JOIN public.long_stay_contracts c ON a.body->>'long_stay_contract_id'=c.id::text
  UNION SELECT a.source,a.key,s.dog_id FROM all_source a JOIN public.hotel_stays s ON a.body->>'entity_id'=s.id::text WHERE a.source='entity_audit_events'
  UNION SELECT a.source,a.key,l.dog_id FROM all_source a JOIN public.operation_schedule_dogs l ON a.body->>'entity_id'=l.schedule_id::text WHERE a.source='entity_audit_events'
  ), trace_rows AS MATERIALIZED (
  SELECT a.source,a.key,a.body,d.dog_id FROM all_source a JOIN (SELECT * FROM discovered UNION SELECT * FROM direct_parent) d ON d.source=a.source AND d.key IS NOT DISTINCT FROM a.key
  ), evaluated AS MATERIALIZED (
  SELECT outer_trace.source,outer_trace.body->>'entity_type' entity_type, coalesce((
 '''
 pred=s.split('SELECT outer_trace.* FROM traces outer_trace WHERE NOT (',1)[1].split(' ) IS TRUE\n )',1)[0]
 pred=pred.replace('target.id','outer_trace.dog_id')
 sales_clause=s.split(" WHERE t.source='sale_history'",1)[1].split(' ),\n unresolved_traces AS (',1)[0]
 sales_clause=("outer_trace.source='sale_history'"+sales_clause).replace('t.body','outer_trace.body').replace('s.id','sale.id').replace('s.dog_id','sale.dog_id').replace('to_jsonb(s)','to_jsonb(sale)').replace('target.id','outer_trace.dog_id')
 pred=pred.replace('EXISTS(SELECT 1 FROM resolved_sales_history r WHERE r.source=outer_trace.source AND r.key=outer_trace.key)',
  "EXISTS(SELECT 1 FROM public.sales sale WHERE sale.id::text=outer_trace.body->>'sale_id' AND "+sales_clause+")")

 for a,b in {
  'SELECT key FROM records':'SELECT k.key FROM keys k WHERE k.dog_id=outer_trace.dog_id',
  'SELECT family_booking_id::text FROM members':'SELECT family_booking_id::text FROM public.family_booking_members WHERE dog_id=outer_trace.dog_id',
  'SELECT schedule_id::text FROM links':'SELECT schedule_id::text FROM public.operation_schedule_dogs WHERE dog_id=outer_trace.dog_id',
  'SELECT id::text FROM stays':'SELECT id::text FROM public.hotel_stays WHERE dog_id=outer_trace.dog_id',
  'SELECT occupancy_id::text FROM shared':'SELECT occupancy_id::text FROM public.hotel_physical_occupancy_members WHERE dog_id=outer_trace.dog_id',
  'SELECT id::text FROM contracts':'SELECT id::text FROM public.long_stay_contracts WHERE dog_id=outer_trace.dog_id'
 }.items():pred=pred.replace(a,b)
 out=prefix+keys+pred+'''),false) resolved FROM trace_rows outer_trace
  ) SELECT current_setting('transaction_read_only') read_only,(SELECT count(*) FROM public.dogs) dogs_evaluated,
  source,coalesce(entity_type,'-') entity_type,count(*) total_target_dog_traces,
  count(*) FILTER(WHERE resolved) resolved,count(*) FILTER(WHERE NOT resolved) unresolved,
  CASE WHEN count(*) FILTER(WHERE NOT resolved)=0 THEN 'NONE' ELSE 'REQUIRES_REVIEW' END unresolved_review,0 mutation_count
  FROM evaluated GROUP BY source,entity_type ORDER BY source,entity_type;
 ROLLBACK;
 '''
 return out

(here/'production_structured_trace_sweep.sql').write_text(global_plan(out))
# Bounded catalog snapshot batches. Each run reports exact offset/population.
query=(here/'production_structured_trace_sweep.sql').read_text()
query=query.replace('all_source AS MATERIALIZED','raw_source AS MATERIALIZED',1).replace(' candidate_ids AS MATERIALIZED ('," all_source AS MATERIALIZED (SELECT * FROM raw_source ORDER BY source,key LIMIT 500 OFFSET 0),\n candidate_ids AS MATERIALIZED (",1)
query=query.replace("SELECT outer_trace.source,outer_trace.body->>'entity_type' entity_type,", "SELECT outer_trace.source,outer_trace.body,outer_trace.dog_id,outer_trace.body->>'entity_type' entity_type,")
query=query[:query.index(" ) SELECT current_setting('transaction_read_only')")]+''' ), counts AS (
 SELECT source,coalesce(entity_type,'-') entity_type,count(*) total,
 count(*) FILTER(WHERE resolved) resolved,count(*) FILTER(WHERE NOT resolved) unresolved
 FROM evaluated GROUP BY source,entity_type
 ), reasons AS (
 SELECT source,entity_type,body->>'action' action,body->>'change_reason' reason,
 CASE entity_type WHEN 'journal_entries' THEN EXISTS(SELECT 1 FROM public.journal_entries e WHERE e.id::text=body->>'entity_id')
 WHEN 'journal_days' THEN EXISTS(SELECT 1 FROM public.journal_entries e WHERE e.journal_day_id::text=body->>'entity_id' AND e.dog_id=evaluated.dog_id)
 WHEN 'hotel_stays' THEN EXISTS(SELECT 1 FROM public.hotel_stays h WHERE h.id::text=body->>'entity_id' AND h.dog_id=evaluated.dog_id)
 ELSE EXISTS(SELECT 1 FROM public.sales s WHERE s.id::text=body->>'sale_id') END retained_target_relation,
 count(*) n FROM evaluated WHERE NOT resolved GROUP BY source,entity_type,body,dog_id
 ), grouped_reasons AS (
 SELECT source,entity_type,action,reason,retained_target_relation,sum(n) n FROM reasons GROUP BY source,entity_type,action,reason,retained_target_relation
 ) SELECT jsonb_build_object('readOnly',current_setting('transaction_read_only'),'dogs',(SELECT count(*) FROM public.dogs),
 'population',(SELECT count(*) FROM raw_source),'batchCount',(SELECT count(*) FROM all_source),'offset',0,
 'rows',(SELECT jsonb_agg(to_jsonb(c) ORDER BY source,entity_type) FROM counts c),
 'unresolvedReasons',(SELECT jsonb_agg(to_jsonb(r)) FROM grouped_reasons r),'mutation',0) result;
ROLLBACK;
'''
(here/'production_structured_trace_sweep.sql').write_text(query)
