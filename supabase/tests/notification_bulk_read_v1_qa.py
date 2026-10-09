"""Local-only clone QA, including a two-connection statement-snapshot race."""
import json, subprocess, time, uuid
PG='/opt/homebrew/opt/postgresql@18/bin/'
DB='notification_bulk_read_qa_'+uuid.uuid4().hex[:8]
base=[PG+'psql','-X','-h','/tmp','-p','5432','-U','postgres','-d',DB,'-Atq','-v','ON_ERROR_STOP=1']
# Fail rather than accidentally targeting an external database or reusing prior evidence.
subprocess.run([PG+'createdb','-h','/tmp','-p','5432','-U','postgres','-T','paymentqa_history',DB],check=True)
def sql(s):
 r=subprocess.run(base,input=s,text=True,capture_output=True);assert r.returncode==0,r.stderr;return r.stdout.strip()
actor=str(uuid.uuid4());other=str(uuid.uuid4());inactive=str(uuid.uuid4())
sql(f"UPDATE notification_push_config SET enabled=false; INSERT INTO auth.users(id) VALUES('{actor}'),('{other}'),('{inactive}'); INSERT INTO profiles(id,name,role,is_active,account_status) VALUES('{actor}','Bulk self','admin',true,'active'),('{other}','Other','staff',true,'active'),('{inactive}','Inactive','staff',false,'active');")
def insert(recipient=actor,extra='',created='now()',category='SCHEDULE'):
 event=str(uuid.uuid4());nid=str(uuid.uuid4())
 columns=',revoked_at' if extra=='revoked' else ',expires_at' if extra=='expired' else ''
 values=',now()' if extra=='revoked' else ",now()-interval '1 second'" if extra=='expired' else ''
 return nid,f"INSERT INTO notification_events(id,event_type,source_kind,source_id,dedupe_key,state) VALUES('{event}','QA','QA','{nid}','{event}','pending'); INSERT INTO notifications(id,event_id,recipient_id,category,title,message,deep_link_type,deep_link_id,created_at{columns}) VALUES('{nid}','{event}','{recipient}','{category}','Fixture','body','SCHEDULE_DAY','{nid}',{created}{values});"
ids=[];statement=''
for _ in range(120):
 nid,s=insert();ids.append(nid);statement+=s
for recipient,extra in [(other,''),(other,''),(actor,'revoked'),(actor,'expired')]:
 _,s=insert(recipient,extra);statement+=s
sql(statement)
announcement=str(uuid.uuid4())
sql(f"INSERT INTO announcements(id,title,body,priority,ack_required,author_id,request_id,request_payload) VALUES('{announcement}','ACK fixture','body','NORMAL',true,'{actor}','{uuid.uuid4()}','{{}}'); UPDATE notifications SET announcement_id='{announcement}',category='ANNOUNCEMENT',deep_link_type='ANNOUNCEMENT',deep_link_id='{announcement}' WHERE id='{ids[0]}';")
# Feature-disabled task and inaccessible payment references are outside inbox scope.
excluded=[]
for category in ['TASK_REQUEST','PAYMENT_CONFIRMATION_REQUEST','PAYMENT_REQUEST']:
 nid,s=insert(category=category);sql(s);excluded.append(nid)
sql('UPDATE notification_task_config SET task_request_enabled=false;')
protected=['task_requests','task_request_targets','payment_confirmation_requests','payment_requests','notification_push_deliveries','sales','sale_payments','sale_refunds','monthly_closings']
def hashes():return {t:sql(f"SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'[]')) FROM public.{t} t;")for t in protected}
sql(f"UPDATE notifications SET read_at=now(),acknowledged_at=now() WHERE recipient_id='{other}' AND id=(SELECT id FROM notifications WHERE recipient_id='{other}' ORDER BY id LIMIT 1);")
ack_before=sql(f"SELECT jsonb_agg(jsonb_build_array(id,acknowledged_at) ORDER BY id)::text FROM notifications WHERE recipient_id IN('{actor}','{other}');")
other_before=sql(f"SELECT jsonb_agg(to_jsonb(n) ORDER BY id)::text FROM notifications n WHERE recipient_id='{other}';")
before=hashes()
def call():return f"BEGIN;SET LOCAL ROLE authenticated;SET LOCAL request.jwt.claim.sub='{actor}';SELECT mark_all_notifications_read_v1();COMMIT;"
checks=[]
def check(name,ok):assert ok,name;checks.append(name)
check('120 unread count',sql(f"BEGIN;SET LOCAL ROLE authenticated;SET LOCAL request.jwt.claim.sub='{actor}';SELECT get_notification_inbox_v1(0,true)->>'unread_count';ROLLBACK;")=='120')
check('page 3 contains 20',sql(f"BEGIN;SET LOCAL ROLE authenticated;SET LOCAL request.jwt.claim.sub='{actor}';SELECT jsonb_array_length(get_notification_inbox_v1(100,true)->'items');ROLLBACK;")=='20')
check('all 120 marked in one call',sql(call())=='120')
check('repeat idempotent',sql(call())=='0')
check('other user/expired/revoked unchanged',sql(f"SELECT count(*) FROM notifications WHERE recipient_id IN('{actor}','{other}') AND (recipient_id='{other}' OR revoked_at IS NOT NULL OR expires_at<=now()) AND read_at IS NULL;")=='3')
check('disabled/inaccessible category rows unchanged',sql("SELECT count(*) FROM notifications WHERE id IN("+','.join("'"+i+"'"for i in excluded)+") AND read_at IS NULL;")=='3')
check('populated ACK timestamps unchanged',ack_before==sql(f"SELECT jsonb_agg(jsonb_build_array(id,acknowledged_at) ORDER BY id)::text FROM notifications WHERE recipient_id IN('{actor}','{other}');"))
check('all other-user notification fields unchanged',other_before==sql(f"SELECT jsonb_agg(to_jsonb(n) ORDER BY id)::text FROM notifications n WHERE recipient_id='{other}';"))
check('ACK untouched',sql(f"SELECT count(*) FROM notifications WHERE recipient_id='{actor}' AND acknowledged_at IS NOT NULL;")=='0')
check('business/financial/push rows byte-equivalent',before==hashes())
check('anon denied',subprocess.run(base,input='SET ROLE anon;SELECT mark_all_notifications_read_v1();',text=True,capture_output=True).returncode!=0)
for user in [None,inactive]:
 r=subprocess.run(base,input='SET ROLE authenticated;'+(f"SET request.jwt.claim.sub='{user}';"if user else '')+'SELECT mark_all_notifications_read_v1();',text=True,capture_output=True)
 check('missing/inactive auth denied '+str(user is None),r.returncode!=0 and 'NOTIFICATION_FORBIDDEN'in r.stderr)
check('only authenticated ACL',sql("SELECT has_function_privilege('authenticated','public.mark_all_notifications_read_v1()','EXECUTE') AND NOT has_function_privilege('anon','public.mark_all_notifications_read_v1()','EXECUTE') AND NOT has_function_privilege('service_role','public.mark_all_notifications_read_v1()','EXECUTE');")=='t')
# Pause an UPDATE after its statement snapshot exists, then commit a new backdated row.
old,s=insert();sql(s)
sql("CREATE FUNCTION public.qa_bulk_pause() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN PERFORM pg_advisory_xact_lock(887744);RETURN NEW;END$$;CREATE TRIGGER qa_bulk_pause BEFORE UPDATE OF read_at ON notifications FOR EACH ROW EXECUTE FUNCTION public.qa_bulk_pause();")
holder=subprocess.Popen(base,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
holder.stdin.write("SELECT pg_advisory_lock(887744);\n\\echo LOCKED\n");holder.stdin.flush()
while holder.stdout.readline().strip()!='LOCKED':pass
worker=subprocess.Popen(base,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
worker.stdin.write(call());worker.stdin.close()
try:
 for _ in range(100):
  if sql("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event='advisory';")=='1':break
  time.sleep(.05)
 else:raise AssertionError('bulk statement did not reach pause')
 new,s=insert(created="now()-interval '1 day'");sql(s)
 holder.terminate();holder.wait(timeout=5)
 output=worker.stdout.read().strip();error=worker.stderr.read();worker.wait(timeout=5)
 check('concurrent statement changed only pre-snapshot row',worker.returncode==0 and output=='1')
 check('new backdated notification stays unread',sql(f"SELECT read_at IS NULL FROM notifications WHERE id='{new}';")=='t')
finally:
 if holder.poll() is None:holder.terminate()
 if worker.poll() is None:worker.terminate()
sql('DROP TRIGGER qa_bulk_pause ON notifications;DROP FUNCTION public.qa_bulk_pause();')
check('no Push caused by read UPDATE',before['notification_push_deliveries']==hashes()['notification_push_deliveries'])
print(json.dumps({'local_database':DB,'passed':len(checks),'checks':checks},indent=2))
