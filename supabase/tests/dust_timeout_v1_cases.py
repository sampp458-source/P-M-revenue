# Runs inside the real local socket DB harness with official allocation/correction contracts.
import time
perf={'productionAuditCount':17181,'auditRows':20000,'samples':3}
# Unrelated synthetic audit evidence, comparable in width to a complete hotel snapshot.
sql(f"""insert into entity_audit_events(module_code,entity_type,entity_id,action,before_data,after_data,changed_by,change_reason)
select 'hotel_operations','hotel_stays',gen_random_uuid(),'updated',before_data,after_data,'{actor}','Synthetic performance fixture'
from entity_audit_events e cross join generate_series(1,20000) where e.id='{root['id']}'; analyze entity_audit_events;""")
check('performance audit population exceeds Production',int(sql('select count(*) from entity_audit_events;'))>=20000)
sql('set statement_timeout=0;')
old_helper=sql("select pg_get_functiondef('hotel_transfer_boundary_correction_proven_v1(jsonb,jsonb,jsonb)'::regprocedure);")
# Store the exact semantic query argument expression used by the historical reader.
payload=f"""jsonb_build_object('stay',(select to_jsonb(x) from hotel_stays x where id='{stay}'),'kind','single',
'capacities',(select jsonb_agg(to_jsonb(x)) from hotel_capacity_reservations x where id='{capacity}'),
'allocations',(select jsonb_agg(to_jsonb(x)) from hotel_room_allocations x where capacity_reservation_id='{capacity}'),
'audits',(select jsonb_agg(to_jsonb(x)) from entity_audit_events x where entity_id in('{stay}','{capacity}','{allocation}','{a2['id']}')),
'rooms',(select jsonb_agg(jsonb_build_object('roomId',id,'roomTypeId',room_type_id)) from hotel_rooms where id in('{room1}','{room5}')),
'absences','[]'::jsonb,'receipts','[]'::jsonb,'plannedRequests','[]'::jsonb,'asOf',statement_timestamp(),'windowUntil',timestamptz '2026-11-08 00:00+09')"""
helper_call=f"select hotel_transfer_boundary_correction_proven_v1({payload},(select to_jsonb(x) from hotel_room_allocations x where id='{a2['id']}'),(select to_jsonb(x) from entity_audit_events x where id='{eb['id']}'))"
def explain(query,prefix=''):
 out=sql(f"begin; set local request.jwt.claim.sub='{actor}'; set local statement_timeout='60s';"+prefix+'explain(analyze,buffers,format json) '+query+';rollback;')
 return json.loads(out[out.index('[\n'):])
def measure(label):
 rows=[]
 for _ in range(3):
  rpc=explain(corr().rstrip(';'));hp=explain(helper_call,prefix=corr())
  rows.append({'rpcMs':rpc[0]['Execution Time'],'helperMs':hp[0]['Execution Time']})
 perf[label]=rows
 # Prove the search plan, using identical full-row comparison with/without PK predicate.
 audit=sql(f"select to_jsonb(x)::text from entity_audit_events x where id='{root['id']}';").replace("'","''")
 for key,condition in [('scan',f"to_jsonb(y)='{audit}'::jsonb"),('pk',f"y.id='{root['id']}' and to_jsonb(y)='{audit}'::jsonb")]:
  plan=explain('select 1 from entity_audit_events y where '+condition)
  (a.output/f'{label}-{key}-plan.json').write_text(json.dumps(plan,indent=2))
measure('before')
# A real PostgreSQL timeout AFTER writes must undo allocations, audit and receipt.
retry_id=str(uuid.uuid4());snap=digest()
sql("create function qa_dust_timeout() returns trigger language plpgsql as $$begin perform pg_sleep(0.2);return new;end$$;create trigger zzzz_dust_timeout after insert on hotel_transfer_boundary_correction_receipts_v1 for each row execute function qa_dust_timeout();")
rejected('first attempt real statement timeout',auth+"set statement_timeout='80ms';"+corr(retry_id),'statement timeout')
check('timeout leaves all allocation audit receipt data unchanged',digest()==snap)
sql('drop trigger zzzz_dust_timeout on hotel_transfer_boundary_correction_receipts_v1;drop function qa_dust_timeout();')
new_sql=(HOT/'supabase/migrations/202611110001_dust_correction_timeout_v1.sql').read_text()
# The existing fixture command pins synthetic IDs; guard against its exact body too.
command_hash=sql("select md5(prosrc) from pg_proc where oid='correct_dust_transfer_20261107_v1(uuid,boolean)'::regprocedure;")
new_sql=new_sql.replace('fc2a4d4d1eea2c304609ba0aa88d9d18',command_hash)
for key,value in fixture['target'].items():
 if key not in ['STAY_VERSION','CAP_VERSION','OLD_VERSION','NEW_VERSION']:
  new_sql=new_sql.replace("'"+str(value)+"'","'"+str(m[key])+"'")
for key,expr in [('STAY_VERSION','s.version'),('CAP_VERSION','c.version'),('OLD_VERSION','old_a.version'),('NEW_VERSION','new_a.version')]:
 new_sql=new_sql.replace(expr+'<>'+str(fixture['target'][key]),expr+'<>'+str(m[key]))
(a.output/'synthetic-hotfix.sql').write_text(new_sql)
snap=digest();sql(new_sql);check('hotfix install zero business mutations',digest()==snap)
check('official correction command unchanged',command_hash==sql("select md5(prosrc) from pg_proc where oid='correct_dust_transfer_20261107_v1(uuid,boolean)'::regprocedure;"))
def state(rid):return obj(auth+"set role authenticated;select get_dust_correction_request_state_v1('"+rid+"');")
check('timeout outcome verified not applied',state(retry_id)['state']=='not_applied')
check('stable server snapshot for same request',state(retry_id)==state(retry_id))
rejected('anonymous result inquiry denied',f"select get_dust_correction_request_state_v1('{retry_id}');",'권한')
sql(f"update profiles set role='staff' where id='{actor}';")
rejected('staff result inquiry denied',auth+f"set role authenticated;select get_dust_correction_request_state_v1('{retry_id}');",'권한')
sql(f"update profiles set role='admin' where id='{actor}';")
# Lock held by a genuinely concurrent DB connection: checker must not confuse progress with rollback.
def hold_lock():
 return sql(f"begin;select pg_advisory_xact_lock(hashtextextended('hotel-request:{retry_id}',0));select pg_sleep(1.5);rollback;")
with concurrent.futures.ThreadPoolExecutor(1) as pool:
 future=pool.submit(hold_lock);time.sleep(.25)
 check('same request in progress blocks retry',state(retry_id)['state']=='in_progress');future.result()
def hold_row():return sql(f"begin;select 1 from hotel_stays where id='{stay}' for update;select pg_sleep(1.5);rollback;")
with concurrent.futures.ThreadPoolExecutor(1) as pool:
 future=pool.submit(hold_row);time.sleep(.25)
 check('different request row lock blocks retry',state(retry_id)['state']=='in_progress');future.result()
bad=obj(auth+f"begin;update hotel_room_allocations set assignment_reason='Synthetic changed snapshot' where id='{allocation}';select get_dust_correction_request_state_v1('{retry_id}');rollback;")
check('changed version result unknown no retry',bad['state']=='unknown')
measure('after')
check('RPC comfortably below 8 second limit',max(x['rpcMs'] for x in perf['after'])<2000)
check('proof helper comfortably below 8 second limit',max(x['helperMs'] for x in perf['after'])<1000)
# Safe retry SAME original UUID and original input, successful but rolled back for remaining harness.
snap=digest();retry_result=obj(auth+"begin;set local statement_timeout='8s';set local role authenticated;"+corr(retry_id)+'rollback;')
check('same request after timeout successfully retries',retry_result['operation']=='dust_transfer_20261107_v1')
check('retry rehearsal rollback complete',digest()==snap)
check('receipt table still private',sql("select not has_table_privilege('authenticated','hotel_transfer_boundary_correction_receipts_v1','select,insert,update,delete');")=='t')
(a.output/'performance.json').write_text(json.dumps(perf,indent=2))
# Compare original/optimized helper decisions on good and adversarial payloads after
# transaction-local correction; full canonical equality remains mandatory.
new_helper=sql("select pg_get_functiondef('hotel_transfer_boundary_correction_proven_v1(jsonb,jsonb,jsonb)'::regprocedure);")
for label,expr in [('valid',payload),('missing audits',f"jsonb_set({payload},'{{audits}}','[]'::jsonb)"),('other stay',f"jsonb_set({payload},'{{stay,id}}',to_jsonb(gen_random_uuid()))")]:
 q=f"select hotel_history_individual_010({expr})"
 # random UUID mutation has same rejection but reason/segment output compared.
 optimized=obj(auth+'begin;'+corr()+q+';rollback;')
 original_result=obj(auth+'begin;'+corr()+old_helper+';'+q+';rollback;')
 check('original and optimized decision identical '+label,optimized==original_result)
