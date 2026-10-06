"""Task V1 contract QA on a disposable Production-schema clone, Unix socket only.
No network, no Production credentials, no cron, no provider sends.
Caller installs exact candidate into a schema-only clone before invoking this suite.
"""
import argparse, concurrent.futures, json, subprocess, uuid, os
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--socket',required=True);p.add_argument('--port',required=True);p.add_argument('--database',required=True);p.add_argument('--output',required=True);p.add_argument('--psql',default=os.environ.get('PSQL','psql'));p.add_argument('--safeupdate-library');a=p.parse_args()
assert a.socket.startswith('/tmp/') and Path(a.socket).is_dir() and a.database.startswith('taskqa')
pg=a.psql;checks=[]
def uid(n):return f'30000000-0000-4000-8000-{n:012d}'
def key():return str(uuid.uuid4())
def sql(s,user=None,fail=None):
 prefix=("LOAD '"+a.safeupdate_library.replace("'", "''")+"';" if a.safeupdate_library else "")+"SET statement_timeout='10s'; SET lock_timeout='7s';"
 if user:prefix+=f"SET ROLE authenticated;SET request.jwt.claim.sub='{uid(user)}';"
 r=subprocess.run([pg,'-X','-h',a.socket,'-p',a.port,'-U','postgres','-d',a.database,'-Atq','-v','ON_ERROR_STOP=1'],input=prefix+s,text=True,capture_output=True)
 if fail:assert r.returncode and fail in r.stderr,(fail,r.stderr)
 elif r.returncode:raise AssertionError(r.stderr)
 return r.stdout.strip()
def check(name,condition=True):
 assert condition,name;checks.append(name);print('PASS',name,flush=True);Path(a.output).write_text(json.dumps({'checks':checks,'count':len(checks)},indent=2))
def grant(target,enabled=True,version=0,user=1,request=None,cap='TASK_REQUEST_CREATE',fail=None):
 return sql(f"SELECT set_notification_capability_v1('{uid(target)}','{cap}',{str(enabled).lower()},{version},'{request or key()}');",user,fail)
def create(users=(2,),user=1,request=None,fail=None):
 return sql(f"SELECT create_task_request_v1('{request or key()}','QA Task','Synthetic test only',now()+interval '1 day',ARRAY[{','.join(repr(uid(u))+'::uuid' for u in users)}]);",user,fail)
def action(name,task,user=2,request=None,note=None,fail=None):
 args=f"'{task}','{request or key()}'"+((','+repr(note)) if note is not None else '')
 return sql(f'SELECT {name}_task_request_v1({args});',user,fail)
if a.safeupdate_library:check('safeupdate enabled for every QA connection',sql('SHOW safeupdate.enabled;')=='on')
check('schema-only clone with zero real profiles',sql('SELECT count(*) FROM profiles;')=='0')
for i in range(1,8):
 sql(f"INSERT INTO auth.users(id) VALUES('{uid(i)}');INSERT INTO profiles(id,name,role,is_active,account_status) VALUES('{uid(i)}','QA person {i}','{'admin' if i in [1,4] else 'staff'}',{str(i!=5).lower()},'{'pending' if i==6 else 'active'}');")
sql(f"UPDATE operation_memberships SET role='owner' WHERE profile_id='{uid(1)}';UPDATE operation_memberships SET role='manager' WHERE profile_id='{uid(3)}';DELETE FROM operation_memberships WHERE profile_id='{uid(4)}';")
sql('INSERT INTO notification_push_config(singleton,enabled) VALUES(true,false);INSERT INTO notification_schedule_config(singleton,enabled,daily_summary_enabled) VALUES(true,false,false);')
check('feature default OFF',json.loads(sql('SELECT get_task_request_access_v1();',1))['enabled'] is False)
create(fail='TASK_DISABLED');check('feature OFF create blocked and runner no-op',sql('SELECT run_task_request_reminders_v1();')=='0')
for role in ['anon','authenticated','service_role']:
 check(role+' no direct domain mutation/read',sql(f"SELECT bool_and(NOT has_table_privilege('{role}',c.oid,'SELECT,INSERT,UPDATE,DELETE')) FROM pg_class c WHERE relname IN('task_requests','task_request_targets','task_request_audit_events','notification_task_config');")=='t')
 check(role+' internal helper not executable',sql(f"SELECT NOT has_function_privilege('{role}','task_action_v1(uuid,uuid,text,text)','EXECUTE') AND NOT has_function_privilege('{role}','run_task_request_reminders_v1()','EXECUTE');")=='t')
for user in [2,3,4,5,6]:grant(2,user=user,fail='CAPABILITY_OWNER_REQUIRED')
check('staff manager Finance-admin inactive pending cannot toggle')
directory=json.loads(sql('SELECT get_notification_capability_directory_v1();',1));check('limited owner directory no sensitive profile columns',all(set(v)=={'id','name','active','operation_role','operation_active','capabilities'} for v in directory))
rkey=key();grant(1,request=rkey);grant(1,request=rkey);check('grant retry one audit',sql(f"SELECT count(*) FROM entity_audit_events WHERE request_id='{rkey}';")=='1')
grant(1,False,request=rkey,fail='REQUEST_ID_PAYLOAD_MISMATCH');grant(1,version=0,fail='CAPABILITY_VERSION_CONFLICT');grant(2,cap='ARBITRARY',fail='INVALID_CAPABILITY_INPUT');check('whitelist payload and version guard')
sql('UPDATE notification_task_config SET task_request_enabled=true WHERE singleton;')
create(user=2,fail='TASK_CREATE_FORBIDDEN');create(users=(4,),fail='INVALID_TASK_RECIPIENT');create(users=(5,),fail='INVALID_TASK_RECIPIENT');create(users=(6,),fail='INVALID_TASK_RECIPIENT');check('capability and active Operations required')
# Explicit stable due for request-id retry checks.
k=key();query=f"SELECT create_task_request_v1('{k}','QA Task','Synthetic', '2099-10-05 16:00+09',ARRAY['{uid(2)}'::uuid,'{uid(3)}'::uuid,'{uid(2)}'::uuid]);"
t=sql(query,1);check('create same payload returns same id',sql(query,1)==t);sql(query.replace('Synthetic','Other'),1,'REQUEST_ID_PAYLOAD_MISMATCH')
check('multi target normalized and no subscription creates no delivery',sql(f"SELECT (SELECT count(*) FROM task_request_targets WHERE task_request_id='{t}')||','||(SELECT count(*) FROM notifications WHERE deep_link_id='{t}')||','||(SELECT count(*) FROM notification_push_deliveries); ")=='2,2,0')
notice=sql(f"SELECT id FROM notifications WHERE deep_link_id='{t}' AND recipient_id='{uid(2)}';")
sql(f"SELECT mark_notification_read_v1('{notice}');",2);check('read does not ACK',sql(f"SELECT acknowledged_at IS NULL FROM task_request_targets WHERE task_request_id='{t}' AND recipient_id='{uid(2)}';")=='t')
action('complete',t,note='',fail='TASK_ACK_REQUIRED');check('complete requires explicit ACK')
action('acknowledge',t,user=7,fail='TASK_FORBIDDEN');sql(f"SELECT get_task_request_detail_v1('{t}');",7,'TASK_NOT_FOUND');check('unrelated target read/action rejected')
k=key();action('acknowledge',t,request=k);before=sql(f"SELECT acknowledged_at FROM task_request_targets WHERE task_request_id='{t}' AND recipient_id='{uid(2)}';");action('acknowledge',t,request=k);check('ACK retry timestamp and audit stable',before==sql(f"SELECT acknowledged_at FROM task_request_targets WHERE task_request_id='{t}' AND recipient_id='{uid(2)}';") and sql(f"SELECT count(*) FROM task_request_audit_events WHERE request_id='{k}';")=='1')
k=key();action('complete',t,request=k,note='done');action('complete',t,request=k,note='done');action('complete',t,request=k,note='changed',fail='REQUEST_ID_PAYLOAD_MISMATCH');check('completion immutable retry and payload rejection')
check('partial completion no requester event',sql(f"SELECT count(*) FROM notification_events WHERE source_id='{t}' AND event_type='TASK_REQUEST_COMPLETED';")=='0')
action('acknowledge',t,user=3);action('complete',t,user=3,note='');check('last completion one requester notification',sql(f"SELECT count(*) FROM notification_events WHERE source_id='{t}' AND event_type='TASK_REQUEST_COMPLETED';")=='1')
action('cancel',t,user=1,note='cancel',fail='TASK_ALREADY_COMPLETE');check('all complete cannot cancel')
k=key();grant(1,False,version=1,request=k);grant(1,False,version=1,request=k);create(fail='TASK_CREATE_FORBIDDEN');check('revoke preserves own sent history',len(json.loads(sql('SELECT get_sent_task_requests_v1();',1)))==1)
grant(1,True,version=2)
t2=create();action('cancel',t2,user=1,note='no longer needed');check('cancel retains history stops reminders',sql(f"SELECT cancelled_at IS NOT NULL AND next_reminder_at IS NULL FROM task_requests WHERE id='{t2}';")=='t');action('acknowledge',t2,fail='TASK_CANCELLED')
grant(2);t3=create(user=2,users=(3,));action('cancel',t3,user=1,note='owner override');check('owner override requester-independent')
# Local-only canonical request timestamps adjusted by fixture owner, never exposed as production RPC.
t4=create(users=(1,2,3));sql(f"UPDATE task_requests SET due_at=now()-interval '1 minute',next_reminder_at=now()-interval '1 minute' WHERE id='{t4}';")
check('reminder OFF computes overdue but emits nothing',sql('SELECT run_task_request_reminders_v1();')=='0')
sql('UPDATE notification_task_config SET reminder_enabled=true WHERE singleton;')
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:r=list(pool.map(lambda _:sql('SELECT run_task_request_reminders_v1();'),range(2)))
check('concurrent cron emits request once',sum(map(int,r))==1)
check('requester also target receives one aggregate',sql(f"SELECT count(*) FROM notifications n JOIN notification_events e ON e.id=n.event_id WHERE e.source_id='{t4}' AND e.event_type='TASK_REQUEST_OVERDUE';")=='3')
check('repeat runner no duplicates',sql('SELECT run_task_request_reminders_v1();')=='0')
check('cadence +1/+2/+4 and quiet boundary',sql("SELECT task_next_reminder_v1('2040-10-05 10:00+09',1,1)='2040-10-05 11:00+09' AND task_next_reminder_v1('2040-10-05 11:00+09',2,2)='2040-10-05 13:00+09' AND task_next_reminder_v1('2040-10-05 13:00+09',3,3)='2040-10-05 17:00+09' AND task_next_reminder_v1('2040-10-05 21:30+09',1,1)='2040-10-06 08:00+09' AND task_next_reminder_v1('2040-10-05 10:00+09',4,4)='2040-10-06 08:00+09';")=='t')
for u in [1,2,3]:action('acknowledge',t4,user=u);action('complete',t4,user=u,note='')
check('completion clears every reminder',sql(f"SELECT next_reminder_at IS NULL AND NOT EXISTS(SELECT 1 FROM task_request_targets WHERE task_request_id='{t4}' AND next_reminder_at IS NOT NULL) FROM task_requests WHERE id='{t4}';")=='t')
check('late completion retained',sql(f"SELECT bool_and(t.completed_at>r.due_at) FROM task_request_targets t JOIN task_requests r ON r.id=t.task_request_id WHERE r.id='{t4}';")=='t')
# Provider eligibility is canonical and cancel events are allowed despite cancellation.
check('stale assigned and overdue suppressed',sql(f"SELECT NOT task_push_valid_v1('{t4}','{uid(2)}','TASK_REQUEST_ASSIGNED','target') AND NOT task_push_valid_v1('{t4}','{uid(2)}','TASK_REQUEST_OVERDUE','target') AND task_push_valid_v1('{t4}','{uid(1)}','TASK_REQUEST_COMPLETED','requester') AND task_push_valid_v1('{t2}','{uid(2)}','TASK_REQUEST_CANCELLED','target');")=='t')
# Competing complete/cancel: exactly one serialization order, no deadlock/partial state.
for i in range(6):
 t5=create();action('acknowledge',t5)
 def compete(action_name):
  try:action(action_name,t5,user=2 if action_name=='complete' else 1,note='race');return 'ok'
  except AssertionError as e:
   assert 'TASK_CANCELLED' in str(e) or 'TASK_ALREADY_COMPLETE' in str(e),str(e);return 'domain'
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:list(pool.map(compete,['complete','cancel']))
check('complete versus cancel six races no deadlock')
check('audit excludes body/note text',sql("SELECT NOT EXISTS(SELECT 1 FROM task_request_audit_events WHERE metadata::text LIKE '%Synthetic%' OR metadata::text LIKE '%done%');")=='t')
check('no duplicate event or deliveries',sql("SELECT NOT EXISTS(SELECT 1 FROM notification_events GROUP BY dedupe_key HAVING count(*)>1) AND NOT EXISTS(SELECT 1 FROM notification_push_deliveries GROUP BY notification_id,subscription_id HAVING count(*)>1);")=='t')
print('TOTAL',len(checks))
# Deterministic internal clock is postgres-only, never a caller-controlled public RPC.
check('internal clock inaccessible to client',sql("SELECT NOT has_function_privilege('authenticated','task_run_reminders_at_v1(timestamptz)','EXECUTE');")=='t')
k=key();action('complete',t,request=k,note='ignored');action('complete',t,request=k,note='ignored');action('complete',t,request=k,note='changed',fail='REQUEST_ID_PAYLOAD_MISMATCH');check('successful no-op receipt prevents request-id payload reuse')
night=create(users=(1,2,3));sql(f"UPDATE task_requests SET due_at='2040-10-05 23:01+09',next_reminder_at='2040-10-05 23:01+09' WHERE id='{night}';")
sql("SELECT task_run_reminders_at_v1('2040-10-05 23:05+09');")
check('first overdue at night emits one deduplicated cohort',sql(f"SELECT reminder_count=1 AND next_reminder_at='2040-10-06 08:00+09' FROM task_requests WHERE id='{night}';")=='t')
sql("SELECT task_run_reminders_at_v1('2040-10-06 02:00+09');")
check('night repeated reminder suppressed',sql(f"SELECT reminder_count=1 FROM task_requests WHERE id='{night}';")=='t')
for stamp in ['08:00','10:00','14:00','18:00','21:59']:
 sql(f"SELECT task_run_reminders_at_v1('2040-10-06 {stamp}+09');")
check('day cap four and next day continuation scheduled',sql(f"SELECT reminder_count_today=4 AND next_reminder_at='2040-10-07 08:00+09' FROM task_requests WHERE id='{night}';")=='t')
sql("SELECT task_run_reminders_at_v1('2040-10-07 08:00+09');")
check('next day resumes without catchup burst',sql(f"SELECT reminder_count=6 AND reminder_count_today=1 FROM task_requests WHERE id='{night}';")=='t')
action('cancel',night,user=1,note='stop');prior=sql(f"SELECT count(*) FROM notification_events WHERE source_id='{night}';");sql("SELECT task_run_reminders_at_v1('2040-10-08 08:00+09');")
check('cancel prevents later reminder events',prior==sql(f"SELECT count(*) FROM notification_events WHERE source_id='{night}';"))
for mode in ['complete','cancel']:
 for _ in range(5):
  race=create();action('acknowledge',race);sql(f"UPDATE task_requests SET due_at=now()-interval '1 minute',next_reminder_at=now()-interval '1 minute' WHERE id='{race}';")
  def command(_):return action(mode,race,user=2 if mode=='complete' else 1,note='race')
  with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
   futures=[pool.submit(command,0),pool.submit(sql,'SELECT run_task_request_reminders_v1();')]
   for f in futures:f.result()
  prior=sql(f"SELECT count(*) FROM notification_events WHERE source_id='{race}' AND event_type='TASK_REQUEST_OVERDUE';")
  sql('SELECT run_task_request_reminders_v1();')
  assert prior==sql(f"SELECT count(*) FROM notification_events WHERE source_id='{race}' AND event_type='TASK_REQUEST_OVERDUE';")
 check(mode+' versus cron five races; terminal state forbids later reminder')
race=create();action('acknowledge',race);k=key()
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:list(pool.map(lambda _:action('complete',race,request=k,note='same'),range(2)))
check('complete versus complete exactly one audit',sql(f"SELECT count(*) FROM task_request_audit_events WHERE request_id='{k}';")=='1')
# Each iteration gets the current version; the capability lock linearizes revoke/create.
for _ in range(5):
 ver=int(sql(f"SELECT version FROM notification_capability_grants WHERE profile_id='{uid(2)}' AND capability='TASK_REQUEST_CREATE';"))
 def try_create():
  try:return create(user=2,users=(3,))
  except AssertionError as e:assert 'TASK_CREATE_FORBIDDEN' in str(e);return None
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
  f=pool.submit(try_create);g=pool.submit(grant,2,False,ver);f.result();g.result()
 create(user=2,fail='TASK_CREATE_FORBIDDEN');grant(2,True,ver+1)
check('revoke versus create five races; post-revoke new create denied')
check('task source tables not in realtime publication',sql("SELECT count(*) FROM pg_publication_tables WHERE tablename LIKE 'task_%';")=='0')
print('TOTAL',len(checks))

# Synthetic subscriptions exercise the installed enqueue/claim/finish path; no HTTP call.
sql("UPDATE notification_push_config SET enabled=true WHERE singleton;")
for label in ['a','b']:
 sql(f"SELECT register_web_push_subscription_v1('https://fcm.googleapis.com/fcm/send/local-task-{label}','B"+'A'*86+"','"+'B'*22+"');",2)
pushed=create();check('multi subscription fans out one delivery per binding',sql(f"SELECT count(*) FROM notification_push_deliveries d JOIN notifications n ON n.id=d.notification_id WHERE n.deep_link_id='{pushed}';")=='2')
claims=json.loads(sql("SELECT coalesce(jsonb_agg(x),'[]') FROM claim_notification_push_deliveries_v1(100) x;"))
check('claim exactly two synthetic task deliveries',len(claims)==2)
for index,c in enumerate(claims):
 delivery=c['delivery_id'];token=c['token'];record=json.loads(sql(f"SELECT get_notification_push_delivery_v1('{delivery}','{token}');"))
 assert record['category']=='TASK_REQUEST' and record['event_type']=='TASK_REQUEST_ASSIGNED'
 sql(f"SELECT finish_notification_push_delivery_v1('{delivery}','{token}','{'SENT' if index==0 else 'GONE'}',NULL);")
check('GONE auto revokes only matching subscription; other binding SENT',sql(f"SELECT count(*) FILTER(WHERE revoked_at IS NULL)||','||count(*) FILTER(WHERE revoked_at IS NOT NULL) FROM push_subscriptions WHERE profile_id='{uid(2)}';")=='1,1')
check('provider result exactly one SENT one GONE no repeat claim',sql(f"SELECT count(*) FILTER(WHERE d.status='SENT')||','||count(*) FILTER(WHERE d.status='GONE') FROM notification_push_deliveries d JOIN notifications n ON n.id=d.notification_id WHERE n.deep_link_id='{pushed}';")=='1,1' and sql("SELECT count(*) FROM claim_notification_push_deliveries_v1(100);")=='0')
print('TOTAL',len(checks))

sql('UPDATE notification_task_config SET task_request_enabled=false,reminder_enabled=false WHERE singleton;')
check('feature OFF suppresses existing Task inbox and reminder',not any(n['category']=='TASK_REQUEST' for n in json.loads(sql('SELECT get_notification_inbox_v1();',2))['items']) and sql('SELECT run_task_request_reminders_v1();')=='0')
print('TOTAL',len(checks))
