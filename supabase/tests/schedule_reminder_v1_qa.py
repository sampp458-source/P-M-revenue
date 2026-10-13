"""Disposable Unix-socket QA. No remote URL/provider or Production data.
Uses real notification migrations and captured live Push function definitions.
Non-Schedule Task/Payment validity helpers are boundary stubs in this bounded model.
Hotel canonical linkage tables preserve the columns used by eligibility; hotel
booking RPC/Capacity are not claimed as fully cloned by this harness.
"""
import ast, concurrent.futures, json, os, subprocess, tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
PG=Path('/opt/homebrew/opt/postgresql@18/bin')
OUT=ROOT/'outputs/schedule-reminder-candidate'
CLUSTER=Path(tempfile.mkdtemp(prefix='pnm-reminder-qa-'))
PORT='55593'
checks=[]
def run(args,text=None,check=True):
 p=subprocess.run([str(x)for x in args],input=text,text=True,capture_output=True)
 if check and p.returncode:raise AssertionError(p.stderr)
 return p
def sql(s,role=None,fail=False):
 pre="SET statement_timeout='10s'; SET lock_timeout='3s';"
 if role:pre+=f'SET ROLE {role};'
 p=run([PG/'psql','-X','-h',CLUSTER,'-p',PORT,'-U','postgres','-d','postgres','-Atq','-v','ON_ERROR_STOP=1'],pre+s,False)
 if fail:assert p.returncode,p.stdout;return p.stderr
 assert not p.returncode,p.stderr
 return p.stdout.strip()
def uid(i):return f'90000000-0000-4000-8000-{i:012d}'
def check(name,value=True):
 assert value,name
 checks.append(name); print('PASS',name,flush=True)
def n():return int(sql("SELECT count(*) FROM notification_events WHERE event_type='SCHEDULE_REMINDER';"))
def make(i,users=(1,),kind='STANDARD',late=False,unknown=False,all_day=False,start=None):
 cal={'STANDARD':'a6e1dcea-478a-4d67-a4b4-1ce92a9c009e','HOTEL':'04684630-3eca-4650-ad24-c4defb6c5c7d','DAYCARE':'04684630-3eca-4650-ad24-c4defb6c5c7d'}[kind]
 typ={'STANDARD':'4855ec9d-b5d7-4171-86b9-52f8aef07b0e','HOTEL':'5adeacd6-8807-4521-b29a-f997f6b7af04','DAYCARE':'5cadf20b-021a-4948-a5dd-471677f51d21'}[kind]
 st=start or "statement_timestamp()+interval '14 minutes'"
 sql(f"BEGIN; INSERT INTO operation_schedules(id,calendar_id,schedule_type_id,title,starts_at,ends_at,all_day,time_unspecified,created_by) VALUES('{uid(i)}','{cal}','{typ}','Synthetic',{st},({st})+interval '1 hour',{str(all_day).lower()},{str(unknown).lower()},'{uid(1)}');"+''.join(f"INSERT INTO operation_schedule_assignees(schedule_id,profile_id,created_at) VALUES('{uid(i)}','{uid(u)}',statement_timestamp()-interval '{0 if late else 30} minutes');"for u in users)+"COMMIT;")
 if kind=='HOTEL':sql(f"INSERT INTO hotel_stays(id) VALUES('{uid(i+10000)}'); INSERT INTO hotel_stay_schedule_events(operation_schedule_id,hotel_stay_id,event_kind) VALUES('{uid(i)}','{uid(i+10000)}','check_in');")
 if kind=='DAYCARE':sql(f"INSERT INTO daycare_operation_states(operation_schedule_id,lifecycle_status) VALUES('{uid(i)}','scheduled');")
 # Fixture-only provenance: domain change happened before the due window.
 if not late:sql(f"UPDATE notification_schedule_reminder_timing SET observed_at=statement_timestamp()-interval '30 minutes' WHERE schedule_id='{uid(i)}'; UPDATE notification_schedule_reminder_assignments SET observed_at=statement_timestamp()-interval '30 minutes' WHERE assignment_id IN (SELECT id FROM operation_schedule_assignees WHERE schedule_id='{uid(i)}');")
def emit():return int(sql('SELECT run_schedule_reminders_v1();'))
def ledger(i):return sql(f"SELECT notification_id FROM notification_schedule_reminders WHERE schedule_id='{uid(i)}' ORDER BY recipient_id LIMIT 1;")
def pending(i):return sql(f"SELECT id FROM notification_push_deliveries WHERE notification_id='{ledger(i)}';")
try:
 run([PG/'initdb','-D',CLUSTER/'data','--auth=trust','--username=postgres','--no-locale','--encoding=UTF8'])
 run([PG/'pg_ctl','-D',CLUSTER/'data','-l',CLUSTER/'server.log','-o',f"-h '' -k {CLUSTER} -p {PORT} -c wal_level=logical",'start'])
 tree=ast.parse((ROOT/'supabase/tests/schedule_notification_sprint3a_qa.py').read_text())
 setup=next(x.args[0].value for x in ast.walk(tree) if isinstance(x,ast.Call) and isinstance(x.func,ast.Name) and x.func.id=='sql' and x.args and isinstance(x.args[0],ast.Constant) and isinstance(x.args[0].value,str) and x.args[0].value.startswith('CREATE ROLE anon;'))
 sql(setup)
 sql("""ALTER TABLE operation_schedules ADD COLUMN created_by uuid;
 ALTER TABLE operation_schedule_assignees ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
 CREATE TABLE operation_calendars(id uuid PRIMARY KEY,name text,is_active boolean DEFAULT true);
 ALTER TABLE operation_schedule_types ADD COLUMN is_active boolean DEFAULT true;
 CREATE TABLE operation_calendar_schedule_types(calendar_id uuid,schedule_type_id uuid,is_active boolean DEFAULT true,archived_at timestamptz);
 CREATE TABLE hotel_stays(id uuid PRIMARY KEY,archived_at timestamptz,checked_in_at timestamptz,checked_out_at timestamptz);
 CREATE TABLE hotel_stay_schedule_events(operation_schedule_id uuid,hotel_stay_id uuid,event_kind text,archived_at timestamptz);
 CREATE TABLE daycare_operation_states(operation_schedule_id uuid PRIMARY KEY,lifecycle_status text,checked_in_at timestamptz);
 CREATE FUNCTION task_push_valid_v1(uuid,uuid,text,text) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
 CREATE FUNCTION payment_push_valid_v1(text,uuid,uuid,text) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
 """)
 for u in [1,2,3]:sql(f"INSERT INTO profiles VALUES('{uid(u)}','Synthetic {u}',true,'active','{'admin' if u==1 else 'staff'}'); INSERT INTO operation_memberships VALUES('{uid(u)}','{'owner' if u==1 else 'staff'}',true);")
 catalog=json.loads((OUT/'catalog.json').read_text())
 for m in catalog['mappings']:
  sql(f"INSERT INTO operation_calendars(id,name) VALUES('{m['calendar_id']}','Synthetic') ON CONFLICT DO NOTHING; INSERT INTO operation_schedule_types(id,name) VALUES('{m['type_id']}','{m['type']}') ON CONFLICT DO NOTHING; INSERT INTO operation_calendar_schedule_types VALUES('{m['calendar_id']}','{m['type_id']}');")
 for filename in ['202609290001_notification_announcement_sprint1.sql','202609300001_announcement_hard_delete_v1.sql','202609300002_notification_web_push_sprint2.sql','202609300003_schedule_notifications_sprint3a.sql','202610010001_notification_push_wake_safeupdate_fix.sql']:
  sql((ROOT/'supabase/migrations'/filename).read_text())
 # Exact Daily V2 table/function source in the bounded fixture (not a claim
 # that the historical predecessor migration was applied to a full clone).
 daily_source=(ROOT/'supabase/migrations/202610020001_daily_schedule_summary_sprint3b.sql').read_text()
 sql(daily_source[daily_source.index('CREATE TABLE public.notification_daily_summary_runs'):daily_source.index('-- All selection')])
 ds=daily_source.index('CREATE FUNCTION public.run_daily_schedule_summary_internal_v2')
 de=daily_source.index('END $$;',ds)+len('END $$;')
 sql(daily_source[ds:de])
 for f in json.loads((OUT/'functions.json').read_text())['functions']:
  if f['name'] in ['push_delivery_valid_v1','get_notification_push_delivery_v1']:sql(f['definition'])
 c=json.loads((OUT/'claim-body.json').read_text())
 import base64
 sql('CREATE OR REPLACE FUNCTION claim_notification_push_deliveries_v1(p_limit integer DEFAULT 10) RETURNS TABLE(delivery_id uuid,token uuid) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $c$'+base64.b64decode(c['body64']).decode()+'$c$;')
 sql("GRANT EXECUTE ON FUNCTION push_delivery_valid_v1(uuid) TO service_role;")
 sql("CREATE TABLE notification_task_config(singleton boolean PRIMARY KEY DEFAULT true,task_request_enabled boolean,reminder_enabled boolean); INSERT INTO notification_task_config VALUES(true,true,false); CREATE FUNCTION is_active_operation_member() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT EXISTS(SELECT 1 FROM operation_memberships WHERE profile_id=auth.uid() AND is_active) $$; CREATE FUNCTION payment_can_view_v1(text,uuid,uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;")
 for f in json.loads((OUT/'read-contracts.json').read_text()):
  definition=base64.b64decode(f['definition64']).decode()
  sql(definition.rstrip()+';')
  sig={'get_notification_inbox_v1':'get_notification_inbox_v1(integer,boolean)','get_notification_detail_v1':'get_notification_detail_v1(uuid)','mark_notification_read_v1':'mark_notification_read_v1(uuid)','mark_all_notifications_read_v1':'mark_all_notifications_read_v1()'}[f['name']]
  sql(f"REVOKE ALL ON FUNCTION {sig} FROM PUBLIC,anon,authenticated,service_role; GRANT EXECUTE ON FUNCTION {sig} TO authenticated;"+(f"GRANT EXECUTE ON FUNCTION {sig} TO service_role;" if 'service_role=X/postgres' in f['acl'] else ''))
 # BEFORE candidate apply, these exact live hashes match the guarded predecessor.
 sql((ROOT/'supabase/migrations/202610130001_schedule_reminder_v1.sql').read_text())
 check('feature default OFF and Task is not enabled by migration',sql('SELECT NOT enabled AND enabled_at IS NULL FROM notification_schedule_reminder_config;')=='t')
 check('OFF generates nothing',emit()==0)
 for u in [1,2]:sql(f"INSERT INTO push_subscriptions(profile_id,endpoint,p256dh,auth) VALUES('{uid(u)}','https://fcm.googleapis.com/synthetic-{u}','SYNTHETIC','SYNTHETIC');")
 sql("UPDATE notification_schedule_config SET enabled=true WHERE singleton; DELETE FROM notification_schedule_reminder_config WHERE singleton; INSERT INTO notification_schedule_reminder_config(singleton,enabled,enabled_at) VALUES(true,true,statement_timestamp()-interval '1 hour');")
 make(100,(1,2));check('multiple assignees including creator receive reminders',emit()==2)
 check('same Cron replay no duplicate',emit()==0 and n()==2)
 check('KST date derives from actual starts_at',sql("SELECT bool_and(schedule_local_date=(r.starts_at AT TIME ZONE 'Asia/Seoul')::date) FROM notification_schedule_reminders r JOIN notifications n ON n.id=r.notification_id;")=='t')
 check('live delivery valid before sending',sql(f"SELECT push_delivery_valid_v1('{pending(100)}');")=='t')
 before=n();make(101,late=True);make(102,unknown=True);make(103,all_day=True);make(104,users=());make(105,start="statement_timestamp()-interval '1 minute'")
 check('late assignment unknown all-day no-assignee past excluded',emit()==0 and n()==before)
 make(106,kind='HOTEL',unknown=True,start="'2099-10-14 00:00:00+09'::timestamptz");make(107,kind='HOTEL',unknown=True,start="'2099-10-14 00:00:00+09'::timestamptz")
 sql(f"UPDATE hotel_stay_schedule_events SET event_kind='check_out' WHERE operation_schedule_id='{uid(107)}';")
 check('hotel unknown check-in and checkout do not treat midnight as known',sql("SELECT run_schedule_reminders_at_v1('2099-10-13 23:45:00+09');")=='0')
 make(108,kind='HOTEL');make(109,kind='DAYCARE');check('canonical known hotel check-in and daycare start',emit()==2)
 check('expired data stays out of inbox contract',sql("SELECT bool_and(expires_at=r.starts_at) FROM notifications n JOIN notification_schedule_reminders r ON r.notification_id=n.id;")=='t')
 did=pending(100);sql(f"UPDATE operation_schedules SET status='completed' WHERE id='{uid(100)}';")
 check('completion invalidates ledger and hides notification without mutating history',sql(f"SELECT NOT push_delivery_valid_v1('{did}');")=='t' and sql(f"SELECT NOT schedule_reminder_visible_v1('{ledger(100)}') AND revoked_at IS NULL FROM notifications WHERE id='{ledger(100)}';")=='t')
 did=pending(108);sql(f"UPDATE operation_schedules SET status='cancelled' WHERE id='{uid(108)}';")
 check('cancelled reminder cannot send',sql(f"SELECT NOT push_delivery_valid_v1('{did}');")=='t')
 did=pending(109);sql(f"UPDATE operation_schedule_assignees SET archived_at=now() WHERE schedule_id='{uid(109)}';")
 check('assignee removal prevents send',sql(f"SELECT NOT push_delivery_valid_v1('{did}');")=='t')
 make(110);check('time change fixture initially emits',emit()==1);old=ledger(110);did=pending(110)
 sql(f"UPDATE operation_schedules SET starts_at=starts_at+interval '1 day',ends_at=ends_at+interval '1 day' WHERE id='{uid(110)}';")
 check('date change invalidates old time before send',sql(f"SELECT NOT push_delivery_valid_v1('{did}');")=='t')
 sql(f"UPDATE operation_schedules SET starts_at=(SELECT starts_at FROM notification_schedule_reminders WHERE notification_id='{old}'),ends_at=(SELECT starts_at+interval '1 hour' FROM notification_schedule_reminders WHERE notification_id='{old}') WHERE id='{uid(110)}';")
 check('time moved back cannot emit same occurrence again',emit()==0)
 make(111,users=(3,));check('no subscription user still gets center notification',sql(f"SELECT run_schedule_reminders_v1();").endswith('1') and sql(f"SELECT count(*) FROM notification_push_deliveries WHERE notification_id='{ledger(111)}';")=='0')
 sql('SELECT run_schedule_reminders_v1();','authenticated',True);check('authenticated cannot call generator')
 sql('SELECT run_schedule_reminders_at_v1(now());','service_role',True);check('service_role cannot choose fake time')
 sql('SELECT * FROM notification_schedule_reminders;','authenticated',True);check('ledger RLS/ACL private')
 make(112,start="statement_timestamp()+interval '9 minutes'");make(113,start="statement_timestamp()+interval '10 minutes 30 seconds'")
 check('maximum five-minute catch-up excludes older due',emit()==1)
 make(114);before=n()
 with concurrent.futures.ThreadPoolExecutor(2)as e:results=list(e.map(lambda _:emit(),range(2)))
 check('parallel Cron unique emission',sum(results)==1 and n()==before+1)
 make(115);sql(f"UPDATE operation_schedule_assignees SET archived_at=now() WHERE schedule_id='{uid(115)}'; INSERT INTO operation_schedule_assignees(schedule_id,profile_id) VALUES('{uid(115)}','{uid(1)}');")
 check('new assignment timestamp after due only keeps ASSIGNED',emit()==0)
 make(116);sql(f"UPDATE operation_schedules SET starts_at=starts_at+interval '1 minute',ends_at=ends_at+interval '1 minute' WHERE id='{uid(116)}';")
 check('time changed after reminder due does not backfill',emit()==0)
 make(117);before=n();sql('BEGIN; SELECT run_schedule_reminders_v1(); ROLLBACK;')
 check('creation rollback leaves no partial event or ledger',n()==before)
 check('subsequent successful replay emits once',emit()==1)
 # Exact inclusive due, KST date boundary and independent Daily V2 generation.
 make(120,start="statement_timestamp()+interval '16 minutes'")
 start=sql(f"SELECT starts_at FROM operation_schedules WHERE id='{uid(120)}';")
 before=n()
 check('one microsecond before due generates zero',sql(f"SELECT run_schedule_reminders_at_v1('{start}'::timestamptz-interval '15 minutes 0.000001 seconds');")=='0')
 check('exact 15-minute due generates one',sql(f"SELECT run_schedule_reminders_at_v1('{start}'::timestamptz-interval '15 minutes');")=='1' and n()==before+1)
 make(121,start="'2099-10-14 00:05:00+09'::timestamptz")
 check('KST midnight reminder crosses prior local day correctly',sql("SELECT run_schedule_reminders_at_v1('2099-10-13 23:50:00+09');")=='1' and sql(f"SELECT schedule_local_date='2099-10-14'::date FROM notifications WHERE id='{ledger(121)}';")=='t')
 sql('UPDATE notification_schedule_config SET daily_summary_enabled=true WHERE singleton;')
 daily=sql("SELECT run_daily_schedule_summary_internal_v2(statement_timestamp(),'FULL',NULL,gen_random_uuid());")
 daily_n=int(sql("SELECT count(*) FROM notification_events WHERE event_type='DAILY_SCHEDULE_SUMMARY';"))
 emit()
 check('real Daily V2 remains independent and idempotent',int(sql("SELECT count(*) FROM notification_events WHERE event_type='DAILY_SCHEDULE_SUMMARY';"))==daily_n and 'COMPLETED' in daily)
 # Schedule lock held by an in-flight canonical update: Cron skips, never emits stale candidate.
 make(122)
 import time
 with concurrent.futures.ThreadPoolExecutor(2) as e:
  writing=e.submit(sql,f"BEGIN; UPDATE operation_schedules SET status='completed' WHERE id='{uid(122)}'; SELECT pg_sleep(0.4); COMMIT;")
  time.sleep(0.1);emitted=emit();writing.result()
 check('generation versus completion lock race does not emit',sql(f"SELECT count(*) FROM notification_schedule_reminders WHERE schedule_id='{uid(122)}';")=='0')
 make(123,kind='HOTEL');sql(f"UPDATE hotel_stay_schedule_events SET event_kind='check_out' WHERE operation_schedule_id='{uid(123)}';")
 check('known canonical hotel checkout emits',emit()==1)
 make(124);sql(f"UPDATE profiles SET is_active=false WHERE id='{uid(1)}';")
 check('inactive recipient excluded',emit()==0)
 sql(f"UPDATE profiles SET is_active=true WHERE id='{uid(1)}';")
 sql(f"UPDATE operation_schedules SET status='completed' WHERE id='{uid(124)}';")
 make(125,users=())
 sql(f"BEGIN; INSERT INTO operation_schedule_assignees(schedule_id,profile_id,created_at) VALUES('{uid(125)}','{uid(1)}',now()-interval '1 hour'); COMMIT;")
 check('old transaction timestamp cannot disguise late assignment',emit()==0 and sql(f"SELECT am.observed_at>=s.starts_at-interval '15 minutes' FROM notification_schedule_reminder_assignments am JOIN operation_schedule_assignees a ON a.id=am.assignment_id JOIN operation_schedules s ON s.id=a.schedule_id WHERE s.id='{uid(125)}';")=='t')
 make(126);sql(f"DELETE FROM notification_schedule_reminder_assignments WHERE assignment_id IN(SELECT id FROM operation_schedule_assignees WHERE schedule_id='{uid(126)}');")
 check('missing assignment observation fails closed',emit()==0)
 make(130)
 sql("CREATE TABLE qa_local_guard(tag text); INSERT INTO qa_local_guard VALUES('PNM_REMINDER_DISPOSABLE_LOCAL_QA');")
 env=dict(os.environ,PNM_REMINDER_QA_SOCKET=str(CLUSTER))
 integration=subprocess.run(['pnpm','dlx','deno','test','--allow-env','--allow-read','--allow-run=/opt/homebrew/opt/postgresql@18/bin/psql','--allow-net=127.0.0.1','--config','supabase/functions/notification-push-dispatch/deno.json','supabase/functions/notification-push-dispatch/reminder_integration_test.ts'],cwd=ROOT,env=env,text=True,capture_output=True)
 OUT.joinpath('db-worker-integration.log').write_text(integration.stdout+integration.stderr)
 check('real Worker local SQL retry pipeline',integration.returncode==0)
 # Keep the already SENT integration evidence intact when the schedule later changes.
 sent_before=sql(f"SELECT row_to_json(d)::text FROM notification_push_deliveries d WHERE notification_id='{ledger(130)}';")
 sql(f"UPDATE operation_schedules SET status='completed' WHERE id='{uid(130)}';")
 check('existing SENT delivery is unchanged by completion',sql(f"SELECT row_to_json(d)::text FROM notification_push_deliveries d WHERE notification_id='{ledger(130)}';")==sent_before)
 make(131);emit();did=pending(131)
 sql(f"UPDATE notifications SET expires_at=now()-interval '1 second' WHERE id='{ledger(131)}'; UPDATE notification_push_deliveries SET status='FAILED',attempt_count=6,available_at=now()+interval '1 day' WHERE id='{did}'; SELECT * FROM claim_notification_push_deliveries_v1(10);")
 check('expired exhausted reminder becomes CANCELLED without provider',sql(f"SELECT status='CANCELLED' AND last_error='REMINDER_EXPIRED' FROM notification_push_deliveries WHERE id='{did}';")=='t')
 sql('UPDATE notification_schedule_reminder_config SET enabled=false WHERE singleton; UPDATE notification_schedule_reminder_config SET enabled=true WHERE singleton;')
 check('OFF to ON stamps a new epoch and forbids old due backfill',emit()==0 and sql("SELECT enabled_at>statement_timestamp()-interval '1 minute' FROM notification_schedule_reminder_config;")=='t')
 make(142,kind='HOTEL',start="'2099-10-15 00:00:00+09'::timestamptz")
 check('explicitly known canonical midnight is allowed by flag, not guessed',sql("SELECT run_schedule_reminders_at_v1('2099-10-14 23:45:00+09');")=='1')
 make(143,kind='HOTEL',unknown=True)
 sql(f"UPDATE operation_schedules SET time_unspecified=false WHERE id='{uid(143)}';")
 check('late confirmation of unchanged placeholder time only keeps UPDATED',emit()==0)
 # A second synthetic already-enabled epoch, solely to exercise bounded batches.
 sql("DELETE FROM notification_schedule_reminder_config WHERE singleton; INSERT INTO notification_schedule_reminder_config(singleton,enabled,enabled_at) VALUES(true,true,statement_timestamp()-interval '1 hour');")
 make(140);sql(f"UPDATE operation_schedules SET calendar_id='9dcd96f5-da7f-4011-8c71-e860ac9fe28f',schedule_type_id='10d3c4be-ebdc-46b2-a8e2-feddf5a0428e' WHERE id='{uid(140)}';")
 check('personal type outside exact allowlist never reminds',emit()==0)
 sql("BEGIN; INSERT INTO operation_schedules(id,calendar_id,schedule_type_id,title,starts_at,ends_at,created_by) SELECT ('90000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'a6e1dcea-478a-4d67-a4b4-1ce92a9c009e','4855ec9d-b5d7-4171-86b9-52f8aef07b0e','Synthetic batch',now()+interval '14 minutes',now()+interval '1 hour','90000000-0000-4000-8000-000000000001' FROM generate_series(2000,2500)i; INSERT INTO operation_schedule_assignees(schedule_id,profile_id,created_at) SELECT id,'90000000-0000-4000-8000-000000000001',now()-interval '30 minutes' FROM operation_schedules WHERE title='Synthetic batch'; COMMIT;")
 sql("UPDATE notification_schedule_reminder_timing SET observed_at=now()-interval '30 minutes' WHERE schedule_id IN(SELECT id FROM operation_schedules WHERE title='Synthetic batch'); UPDATE notification_schedule_reminder_assignments SET observed_at=now()-interval '30 minutes' WHERE assignment_id IN(SELECT a.id FROM operation_schedule_assignees a JOIN operation_schedules s ON s.id=a.schedule_id WHERE s.title='Synthetic batch');")
 digest_sql="SELECT md5(coalesce(string_agg(row_to_json(n)::text,'' ORDER BY n.id),'')) FROM notifications n JOIN notification_events e ON e.id=n.event_id WHERE e.event_type<>'SCHEDULE_REMINDER';"
 legacy=sql(digest_sql)
 check('501 due schedules drain in bounded 500 + 1 batches without starvation',emit()==500 and emit()==1 and emit()==0)
 check('generator preserves all preexisting non-reminder notification records',sql(digest_sql)==legacy)
 # A paused notification reader exercises contention with a domain writer.
 # The candidate never updates historical notification rows from that writer.
 make(145);emit();notice=ledger(145)
 sql(f"CREATE FUNCTION qa_pause_read() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id='{notice}' AND NEW.read_at IS DISTINCT FROM OLD.read_at THEN PERFORM pg_sleep(0.4); END IF; RETURN NEW; END $$; CREATE TRIGGER qa_pause_read BEFORE UPDATE ON notifications FOR EACH ROW EXECUTE FUNCTION qa_pause_read();")
 with concurrent.futures.ThreadPoolExecutor(2) as pool:
  reader=pool.submit(sql,f"SET ROLE authenticated; SET request.jwt.claim.sub='{uid(1)}'; SELECT mark_notification_read_v1('{notice}');")
  import time
  time.sleep(0.1)
  writer=pool.submit(sql,f"UPDATE operation_schedules SET status='completed' WHERE id='{uid(145)}';")
  reader.result();writer.result()
 check('read versus completion preserves lock order; no deadlock',sql(f"SELECT NOT schedule_reminder_visible_v1('{notice}');")=='t')
 before=sql(f"SELECT count(*) FROM notifications WHERE recipient_id='{uid(2)}' AND read_at IS NULL;")
 sql(f"SET ROLE authenticated; SET request.jwt.claim.sub='{uid(1)}'; SELECT mark_all_notifications_read_v1();")
 check('bulk read leaves other recipient data unchanged',sql(f"SELECT count(*) FROM notifications WHERE recipient_id='{uid(2)}' AND read_at IS NULL;")==before)
 check('invalid reminder is excluded from inbox and unread count',notice not in sql(f"SET ROLE authenticated; SET request.jwt.claim.sub='{uid(1)}'; SELECT get_notification_inbox_v1(0,true);") )
 check('Task source/reminder flags unchanged',sql('SELECT task_request_enabled AND NOT reminder_enabled FROM notification_task_config;')=='t')
 # Adversarial multi-schedule / bulk-read ordering. The old row-revocation
 # design can wait on rows in the opposite order; the candidate does not.
 make(146);make(147);emit();n1=ledger(146);n2=ledger(147)
 with concurrent.futures.ThreadPoolExecutor(2) as pool:
  reader=pool.submit(sql,f"BEGIN; SELECT id FROM notifications WHERE id='{n2}' FOR UPDATE; SELECT pg_sleep(0.3); SET ROLE authenticated; SET request.jwt.claim.sub='{uid(1)}'; SELECT mark_all_notifications_read_v1(); COMMIT;")
  time.sleep(0.1)
  writer=pool.submit(sql,f"UPDATE operation_schedules SET status='completed' WHERE id IN('{uid(146)}','{uid(147)}');")
  reader.result();writer.result()
 check('multi-schedule completion versus bulk read no lock inversion',sql(f"SELECT bool_and(NOT schedule_reminder_visible_v1(notification_id)) FROM notification_schedule_reminders WHERE schedule_id IN('{uid(146)}','{uid(147)}');")=='t')
 check('bounded queue uses unique notification subscription'      ,sql('SELECT count(*) FROM (SELECT notification_id,subscription_id FROM notification_push_deliveries GROUP BY 1,2 HAVING count(*)>1)x;')=='0')
 # Boundary checks: metadata must not introduce new domain deletion restrictions.
 make(800, start="statement_timestamp()+interval '30 minutes'")
 aid=sql(f"SELECT id FROM operation_schedule_assignees WHERE schedule_id='{uid(800)}';")
 old=sql(f"SELECT observed_at FROM notification_schedule_reminder_assignments WHERE assignment_id='{aid}';")
 sql(f"UPDATE operation_schedule_assignees SET archived_at=statement_timestamp() WHERE id='{aid}';")
 sql(f"UPDATE operation_schedules SET starts_at=statement_timestamp()+interval '14 minutes', ends_at=statement_timestamp()+interval '1 hour' WHERE id='{uid(800)}';")
 sql(f"UPDATE notification_schedule_reminder_timing SET observed_at=statement_timestamp()-interval '30 minutes' WHERE schedule_id='{uid(800)}';")
 sql(f"UPDATE operation_schedule_assignees SET archived_at=NULL WHERE id='{aid}';")
 check('same assignment ID reactivation resets observation after due',sql(f"SELECT observed_at>starts_at-interval '15 minutes' FROM notification_schedule_reminder_assignments a JOIN operation_schedule_assignees x ON x.id=a.assignment_id JOIN operation_schedules s ON s.id=x.schedule_id WHERE a.assignment_id='{aid}';")=='t')
 emit();check('late same-ID reactivation emits no reminder',ledger(800)=='')
 make(801);emit();notice=ledger(801)
 sql(f"DELETE FROM operation_schedule_assignees WHERE schedule_id='{uid(801)}'; DELETE FROM operation_schedules WHERE id='{uid(801)}';")
 check('domain hard deletion preserves reminder ledger and notification',sql(f"SELECT count(*) FROM notifications WHERE id='{notice}';")=='1' and ledger(801)==notice)
 check('deleted domain reminder fails closed',sql(f"SELECT NOT schedule_reminder_visible_v1('{notice}');")=='t')
 check('disposable observations removed on domain deletion',sql(f"SELECT count(*) FROM notification_schedule_reminder_timing WHERE schedule_id='{uid(801)}';")=='0')
 sql('UPDATE notification_schedule_reminder_config SET enabled=false;')
 make(802)
 sql(f"UPDATE operation_schedules SET title='OFF edited' WHERE id='{uid(802)}'; UPDATE operation_schedule_assignees SET archived_at=now() WHERE schedule_id='{uid(802)}'; DELETE FROM operation_schedule_assignees WHERE schedule_id='{uid(802)}'; DELETE FROM operation_schedules WHERE id='{uid(802)}';")
 check('OFF create edit archive remove hard delete succeeds',emit()==0)
 sql(f"BEGIN; INSERT INTO operation_schedules(id,calendar_id,schedule_type_id,title,starts_at,ends_at,created_by) VALUES('{uid(803)}','a6e1dcea-478a-4d67-a4b4-1ce92a9c009e','4855ec9d-b5d7-4171-86b9-52f8aef07b0e','Transient',now()+interval '1 hour',now()+interval '2 hours','{uid(1)}'); INSERT INTO operation_schedule_assignees(schedule_id,profile_id) VALUES('{uid(803)}','{uid(1)}'); DELETE FROM operation_schedule_assignees WHERE schedule_id='{uid(803)}'; DELETE FROM operation_schedules WHERE id='{uid(803)}'; COMMIT;")
 check('OFF create then delete same transaction deferred triggers safe',sql(f"SELECT count(*) FROM notification_schedule_reminder_timing WHERE schedule_id='{uid(803)}';")=='0')
 OUT.joinpath('db-result.json').write_text(json.dumps({'checks':checks,'passed':len(checks),'scope':'bounded canonical columns + real notification migrations/live Push functions; no full hotel/Task/Payment clone'},indent=2))
finally:
 run([PG/'pg_ctl','-D',CLUSTER/'data','stop','-m','fast'],check=False)
