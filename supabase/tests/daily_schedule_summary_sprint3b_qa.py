"""Isolated PostgreSQL Sprint 3B QA. Unix socket only, no Production connection.
Exact notification migrations, canonical-shaped synthetic schedules, real safeupdate.
Network/Vault are local doubles. Never sends Push or starts cron.
"""
import argparse
import concurrent.futures
import json
import subprocess
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--safeupdate', required=True, help='Local compiled safeupdate library without suffix')
parser.add_argument('--output', required=True)
args = parser.parse_args()
assert Path(args.safeupdate+'.so').exists() or Path(args.safeupdate+'.dylib').exists()
PG = Path('/opt/homebrew/opt/postgresql@18/bin')
CLUSTER = Path(tempfile.mkdtemp(prefix='pnm-daily-summary-qa-'))
passed = []
def run(argv, source=None, check=True):
    p = subprocess.run([str(x) for x in argv], input=source, text=True, capture_output=True)
    if check and p.returncode: raise RuntimeError(p.stderr)
    return p

def uid(n): return f'00000000-0000-4000-8000-{n:012d}'
def sql(text, user=None, fail=None):
    prefix = "LOAD '"+args.safeupdate.replace("'","''")+"'; SET statement_timeout='20s'; SET lock_timeout='15s';"
    if user: prefix += f"SET ROLE authenticated; SET request.jwt.claim.sub='{uid(user)}';"
    p = run([PG/'psql','-X','-h',CLUSTER,'-p','55593','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','--set=VERBOSITY=verbose','-Atq'],prefix+text,False)
    if fail: assert p.returncode and fail in p.stderr,(p.stdout,p.stderr)
    elif p.returncode: raise RuntimeError(p.stderr)
    return p.stdout.strip()
def check(name, condition=True):
    assert condition,name
    passed.append(name)
    print('PASS',name,flush=True)
    Path(args.output).write_text(json.dumps({'checks':passed,'count':len(passed)},indent=2))
def create(n,users=(),date='2026-11-10',start='10:00',end='11:00',end_date=None,unknown=False,status='scheduled'):
    return f"INSERT INTO operation_schedules(id,calendar_id,schedule_type_id,title,starts_at,ends_at,time_unspecified,status) VALUES('{uid(n)}','{uid(90)}','{uid(91)}','QA schedule','{date} {start}+09','{end_date or date} {end}+09',{str(unknown).lower()},'{status}');"+''.join(f"INSERT INTO operation_schedule_assignees(schedule_id,profile_id) VALUES('{uid(n)}','{uid(u)}');" for u in users)
def daily(day,scope='FULL',recipient=None):
    return json.loads(sql("SELECT run_daily_schedule_summary_internal_v2('"+day+" 08:00+09','"+scope+"',"+("'"+uid(recipient)+"'" if recipient else 'NULL')+",gen_random_uuid());"))
def aggregate(day):
    return json.loads(sql(f"SELECT jsonb_object_agg(right(recipient_id::text,2),schedule_count) FROM notification_daily_summary_recipient_state WHERE summary_date='{day}';"))
try:
    run([PG/'initdb','-D',CLUSTER/'data','--auth=trust','--username=postgres','--no-locale','--encoding=UTF8'])
    run([PG/'pg_ctl','-D',CLUSTER/'data','-l',CLUSTER/'server.log','-o',f"-h '' -k {CLUSTER} -p 55593 -c wal_level=logical",'start'])
    sql("""CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
GRANT USAGE ON SCHEMA auth TO authenticated; GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
CREATE TABLE profiles(id uuid PRIMARY KEY,name text,is_active boolean,account_status text,role text);
CREATE TABLE operation_memberships(profile_id uuid PRIMARY KEY REFERENCES profiles(id),role text,is_active boolean);
CREATE PUBLICATION supabase_realtime;
CREATE TABLE operation_schedule_types(id uuid PRIMARY KEY,name text);
CREATE TABLE operation_schedules(id uuid PRIMARY KEY,calendar_id uuid NOT NULL,schedule_type_id uuid NOT NULL,title text NOT NULL,starts_at timestamptz NOT NULL,ends_at timestamptz NOT NULL,all_day boolean NOT NULL DEFAULT false,time_unspecified boolean NOT NULL DEFAULT false,status text NOT NULL DEFAULT 'scheduled',archived_at timestamptz,updated_at timestamptz DEFAULT now(),version integer DEFAULT 1,description text);
CREATE TABLE operation_schedule_assignees(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),schedule_id uuid REFERENCES operation_schedules(id),profile_id uuid REFERENCES profiles(id),archived_at timestamptz);
CREATE UNIQUE INDEX active_assignment ON operation_schedule_assignees(schedule_id,profile_id) WHERE archived_at IS NULL;
""")
    for n in range(1,7):
        sql(f"INSERT INTO profiles VALUES('{uid(n)}','직원 {n}',{str(n!=4).lower()},'{ 'pending' if n==5 else 'active'}','staff'); INSERT INTO operation_memberships VALUES('{uid(n)}','{'owner' if n==1 else 'staff'}',{str(n!=6).lower()});")
    sql(f"INSERT INTO operation_schedule_types VALUES('{uid(91)}','행동교정');")
    for name in ['202609290001_notification_announcement_sprint1.sql','202609300001_announcement_hard_delete_v1.sql','202609300002_notification_web_push_sprint2.sql']:
        sql((ROOT/'supabase/migrations'/name).read_text())
    # Replay Production default ACL before creating Sprint 3A functions.
    sql('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon,authenticated,service_role; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated,service_role;')
    sql((ROOT/'supabase/migrations/202609300003_schedule_notifications_sprint3a.sql').read_text())
    sql((ROOT/'supabase/migrations/202609300004_schedule_notification_internal_acl_fix.sql').read_text())
    sql((ROOT/'supabase/migrations/202610010001_notification_push_wake_safeupdate_fix.sql').read_text())
    sql("CREATE SCHEMA vault; CREATE TABLE vault.decrypted_secrets(name text,decrypted_secret text); CREATE SCHEMA net; CREATE FUNCTION net.http_post(url text,body jsonb,headers jsonb,timeout_milliseconds integer) RETURNS bigint LANGUAGE sql AS $$ SELECT 1::bigint $$;")
    sql("INSERT INTO vault.decrypted_secrets VALUES('notification_push_worker_url','https://isolated.supabase.co/functions/v1/notification-push-dispatch'),('notification_push_worker_secret',repeat('x',40));")
    # Make profile 6 Finance-only (no Operations membership).
    sql(f"DELETE FROM operation_memberships WHERE profile_id='{uid(6)}';")
    for u in [1,2,3]:
        sql(f"INSERT INTO push_subscriptions(profile_id,endpoint,p256dh,auth) VALUES('{uid(u)}','https://example.invalid/qa-{u}','dummy','dummy');")
    migration=(ROOT/'supabase/migrations/202610020001_daily_schedule_summary_sprint3b.sql').read_text()
    original=sql("SELECT md5(prosrc) FROM pg_proc WHERE oid='run_daily_schedule_summary_at_v1(timestamptz)'::regprocedure;")
    sql("BEGIN; ALTER FUNCTION run_daily_schedule_summary_at_v1(timestamptz) SECURITY INVOKER;"+migration.replace('BEGIN;','',1),fail='DAILY_PREDECESSOR_MISMATCH')
    check('predecessor drift rolls back',sql("SELECT md5(prosrc) FROM pg_proc WHERE oid='run_daily_schedule_summary_at_v1(timestamptz)'::regprocedure;")==original)
    # Production catalog has this pre-existing service grant (old default ACL).
    sql("GRANT EXECUTE ON FUNCTION push_delivery_valid_v1(uuid) TO service_role;")
    sql(migration)
    check('migration preserves OFF flags and creates no business data',sql('SELECT NOT enabled AND NOT daily_summary_enabled FROM notification_schedule_config;')=='t' and sql('SELECT count(*) FROM notifications;')=='0')
    sql('UPDATE notification_push_config SET enabled=true;',fail='21000')
    check('real safeupdate active in every session')
    for role in ['anon','authenticated','service_role']:
        check(role+' cannot access tables or internal/pilot',sql(f"SELECT NOT has_table_privilege('{role}','notification_daily_summary_runs','SELECT,INSERT,UPDATE,DELETE') AND NOT has_table_privilege('{role}','notification_daily_summary_recipient_state','SELECT,INSERT,UPDATE,DELETE') AND NOT has_function_privilege('{role}','run_daily_schedule_summary_pilot_v1(uuid,timestamptz,uuid)','EXECUTE') AND NOT has_function_privilege('{role}','run_daily_schedule_summary_internal_v2(timestamptz,text,uuid,uuid)','EXECUTE');")=='t')
    check('only service operational wrapper executable',sql("SELECT has_function_privilege('service_role','run_daily_schedule_summary_v2()','EXECUTE') AND NOT has_function_privilege('authenticated','run_daily_schedule_summary_v2()','EXECUTE') AND NOT has_function_privilege('anon','run_daily_schedule_summary_v2()','EXECUTE');")=='t')
    check('owner RLS search path explicit',sql("SELECT bool_and(relowner='postgres'::regrole AND relrowsecurity) FROM pg_class WHERE oid IN ('notification_daily_summary_runs'::regclass,'notification_daily_summary_recipient_state'::regclass);")=='t')
    check('FULL disabled no-op',daily('2026-11-10')['result']=='DISABLED')
    sql('UPDATE notification_schedule_config SET enabled=true WHERE singleton IS TRUE;')
    check('FULL still disabled by Daily flag',daily('2026-11-10')['result']=='DISABLED')
    sql('BEGIN;'+create(101,[2])+create(102,[2])+create(103,[2],unknown=True)+'COMMIT;')
    r=daily('2026-11-10','PILOT',2)
    check('pilot OFF allowed, 3 schedules -> 1 summary exact stats',r['eligible_recipients']==1 and r['snapshots_created']==1 and r['summaries_created']==1 and r['notifications_created']==1 and r['deliveries_created']==1 and aggregate('2026-11-10')=={'02':3})
    check('pilot does not enable Daily',sql('SELECT daily_summary_enabled FROM notification_schedule_config;')=='f')
    check('pilot repeat reports zero creations',daily('2026-11-10','PILOT',2)['summaries_created']==0)
    sql('UPDATE notification_schedule_config SET daily_summary_enabled=true WHERE singleton IS TRUE;')
    r=daily('2026-11-10')
    check('pilot -> full no duplicate and zero users recorded',r['eligible_recipients']==3 and r['snapshots_created']==2 and r['idempotent_snapshot_skips']==1 and r['zero_schedule_recipients']==2 and r['summaries_created']==0)
    sql('BEGIN;'+create(104,[3])+'COMMIT;')
    r=daily('2026-11-10')
    check('zero then new schedule remains frozen; FULL rerun all no-op',r['result']=='ALREADY_COMPLETED' and r['snapshots_created']==0 and aggregate('2026-11-10')['03']==0)
    check('full prevents new pilot after success',daily('2026-11-10','PILOT',3)['result']=='ALREADY_COMPLETED')
    # Zero pilot is equally permanent before a later FULL run.
    check('zero pilot creates state only',daily('2026-11-11','PILOT',2)['summaries_created']==0)
    sql('BEGIN;'+create(105,[2,3],date='2026-11-11')+'COMMIT;')
    r=daily('2026-11-11')
    check('zero PILOT -> FULL freezes pilot, includes other assignee',r['summaries_created']==1 and aggregate('2026-11-11')=={'01':0,'02':0,'03':1})
    # Full date overlap selection with unknown, multi-day, half-open boundary.
    sql('BEGIN;'+create(110,[2,3],date='2026-11-12',unknown=True)+create(111,[2],date='2026-11-11',start='23:00',end_date='2026-11-12',end='01:00')+create(112,[2],date='2026-11-11',end_date='2026-11-14')+create(113,[2],date='2026-11-11',end_date='2026-11-12',end='00:00')+create(114,[2],date='2026-11-12',status='completed')+create(115,[2],date='2026-11-12',status='cancelled')+create(116,[2],date='2026-11-12')+create(117,[2],date='2026-11-12')+create(118,[4,5,6],date='2026-11-12')+create(119,[],date='2026-11-12')+f"UPDATE operation_schedules SET archived_at=now() WHERE id='{uid(116)}'; UPDATE operation_schedule_assignees SET archived_at=now() WHERE schedule_id='{uid(117)}'; COMMIT;")
    r=daily('2026-11-12')
    check('unknown/overnight/multi-day/multi-assignee included; terminal/archived/inactive/pending/Finance excluded',aggregate('2026-11-12')=={'01':0,'02':3,'03':1})
    check('Daily message contains no invented midnight or schedule title',sql("SELECT bool_and(n.message NOT LIKE '%00:00%' AND n.message NOT LIKE '%QA schedule%') FROM notifications n JOIN notification_events e ON e.id=n.event_id WHERE e.event_type='DAILY_SCHEDULE_SUMMARY';")=='t')
    check('KST before08 no-op',sql("SELECT run_daily_schedule_summary_at_v1('2026-11-19 22:59:59+00');")=='0')
    check('KST at08 correct date',sql("SELECT run_daily_schedule_summary_at_v1('2026-11-19 23:00:00+00'); SELECT count(*) FROM notification_daily_summary_runs WHERE summary_date='2026-11-20';").endswith('1'))
    check('KST next midnight no early run',sql("SELECT run_daily_schedule_summary_at_v1('2026-11-20 15:00:00+00');")=='0')
    for scope,recipient,date in [('FULL',None,'2026-11-21'),('PILOT',2,'2026-11-22')]:
        sql('BEGIN;'+create(200 if scope=='FULL' else 201,[2],date=date)+'COMMIT;')
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results=list(pool.map(lambda _:daily(date,scope,recipient),range(2)))
        check(scope+' concurrent2 exactly one snapshot/event',sum(x['summaries_created'] for x in results)==1 and sum(x['snapshots_created'] for x in results)==(3 if scope=='FULL' else 1))
    # Force the single statement to pause after domain selection, using an isolated
    # AFTER INSERT state trigger. Update domain in a second transaction while paused.
    sql('BEGIN;'+create(210,[2,3],date='2026-11-23')+'COMMIT;')
    sql("CREATE FUNCTION qa_snapshot_gate() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(99881); RETURN NEW; END $$; CREATE TRIGGER qa_snapshot_gate AFTER INSERT ON notification_daily_summary_recipient_state FOR EACH ROW EXECUTE FUNCTION qa_snapshot_gate();")
    blocker=subprocess.Popen([str(PG/'psql'),'-X','-Atq','-h',str(CLUSTER),'-p','55593','-U','postgres'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    blocker.stdin.write("BEGIN; SELECT pg_advisory_xact_lock(99881); SELECT 'READY';\n");blocker.stdin.flush()
    while blocker.stdout.readline().strip()!='READY': pass
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        fut=pool.submit(daily,'2026-11-23')
        for _ in range(100):
            if sql("SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND NOT granted AND objid=99881;")=='1': break
            time.sleep(.05)
        else: raise AssertionError('snapshot runner did not reach gate')
        sql(f"UPDATE operation_schedules SET status='completed',title='concurrent change' WHERE id='{uid(210)}';")
        blocker.stdin.write('COMMIT;\n\\q\n');blocker.stdin.flush();blocker.wait(timeout=5)
        fut.result()
    sql('DROP TRIGGER qa_snapshot_gate ON notification_daily_summary_recipient_state; DROP FUNCTION qa_snapshot_gate();')
    check('concurrent completion/update yields one MVCC snapshot for both recipients',aggregate('2026-11-23')=={'01':0,'02':1,'03':1})
    check('post-snapshot completion really committed',sql(f"SELECT status FROM operation_schedules WHERE id='{uid(210)}';")=='completed')
    # Wake failure, including failure of the diagnostic UPDATE, cannot abort summary.
    sql("UPDATE notification_push_config SET enabled=true WHERE singleton IS TRUE; CREATE OR REPLACE FUNCTION net.http_post(url text,body jsonb,headers jsonb,timeout_milliseconds integer) RETURNS bigint LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'QA_WAKE_FAILURE'; END $$;")
    sql('BEGIN;'+create(220,[2],date='2026-11-24')+'COMMIT;')
    check('wake failure retains summary commit',daily('2026-11-24')['summaries_created']==1 and sql('SELECT last_wake_error FROM notification_push_config;')=='WAKE_UNAVAILABLE')
    sql("CREATE FUNCTION qa_diagnostic_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'QA_DIAGNOSTIC_FAILURE'; END $$; CREATE TRIGGER qa_diagnostic_fail BEFORE UPDATE ON notification_push_config FOR EACH ROW EXECUTE FUNCTION qa_diagnostic_fail();")
    sql('BEGIN;'+create(221,[2],date='2026-11-25')+'COMMIT;')
    check('wake AND diagnostic failure retains summary and delivery commit',daily('2026-11-25')['deliveries_created']==1)
    sql('DROP TRIGGER qa_diagnostic_fail ON notification_push_config; DROP FUNCTION qa_diagnostic_fail(); UPDATE notification_push_config SET enabled=false WHERE singleton IS TRUE;')
    sql('BEGIN;'+create(222,[2],date='2026-11-26')+'COMMIT;')
    r=daily('2026-11-26')
    check('Push backend OFF retains notification and queued delivery',r['notifications_created']==1 and r['deliveries_created']==1)
    # Past Daily cannot be claimed, even if attempts exhausted; read history remains.
    day=sql("SELECT (now() AT TIME ZONE 'Asia/Seoul')::date-1;")
    sql('BEGIN;'+create(230,[2],date=day)+'COMMIT;')
    daily(day,'PILOT',2)
    nid=sql(f"SELECT id FROM notifications WHERE deep_link_type='SCHEDULE_DAY' AND schedule_local_date='{day}' AND recipient_id='{uid(2)}';")
    sql(f"SELECT mark_notification_read_v1('{nid}');",2)
    sql(f"UPDATE notification_push_deliveries SET attempt_count=6,status='FAILED' WHERE notification_id='{nid}'; SELECT claim_notification_push_deliveries_v1();")
    check('expired Daily terminal even with exhausted attempts/backend OFF',sql(f"SELECT status||':'||last_error FROM notification_push_deliveries WHERE notification_id='{nid}';")=='CANCELLED:DAILY_DATE_EXPIRED')
    check('old app notification/read survives and ACK absent',sql(f"SELECT read_at IS NOT NULL AND announcement_id IS NULL AND acknowledged_at IS NULL FROM notifications WHERE id='{nid}';")=='t')
    sql('BEGIN;'+create(270,[1,3],date=day)+'COMMIT;')
    daily(day)
    sql(f"UPDATE notification_push_deliveries d SET status='PROCESSING',lease_until=now()-interval '1 second',claim_token=gen_random_uuid() FROM notifications n WHERE n.id=d.notification_id AND n.schedule_local_date='{day}' AND n.deep_link_type='SCHEDULE_DAY' AND n.recipient_id='{uid(3)}'; SELECT claim_notification_push_deliveries_v1();")
    check('past PENDING and expired PROCESSING become terminal',sql(f"SELECT count(*) FROM notification_push_deliveries d JOIN notifications n ON n.id=d.notification_id WHERE n.schedule_local_date='{day}' AND n.deep_link_type='SCHEDULE_DAY' AND d.status='CANCELLED' AND d.last_error='DAILY_DATE_EXPIRED';")=='3')
    sql(f"UPDATE notification_push_deliveries SET status='PROCESSING',lease_until=now()+interval '120 seconds',claim_token=gen_random_uuid() WHERE notification_id='{nid}'; UPDATE notification_push_config SET enabled=true WHERE singleton IS TRUE;")
    check('already claimed past Daily payload cannot reach provider',sql(f"SELECT get_notification_push_delivery_v1(id,claim_token) IS NULL FROM notification_push_deliveries WHERE notification_id='{nid}';")=='t')
    sql(f"UPDATE notification_push_deliveries SET lease_until=now()-interval '1 second' WHERE notification_id='{nid}'; SELECT claim_notification_push_deliveries_v1();")
    check('abandoned past Daily lease is cleaned',sql(f"SELECT status FROM notification_push_deliveries WHERE notification_id='{nid}';")=='CANCELLED')
    # Genuine event failure must roll back run history and snapshots, then retry.
    sql('BEGIN;'+create(231,[2],date='2026-11-28')+'COMMIT;')
    sql("CREATE FUNCTION qa_event_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='DAILY_SCHEDULE_SUMMARY' THEN RAISE EXCEPTION 'QA_EVENT_FAILURE'; END IF; RETURN NEW; END $$; CREATE TRIGGER qa_event_fail BEFORE INSERT ON notification_events FOR EACH ROW EXECUTE FUNCTION qa_event_fail();")
    sql("SELECT run_daily_schedule_summary_at_v1('2026-11-28 08:00+09');",fail='QA_EVENT_FAILURE')
    check('failed snapshot transaction leaves no run/state',sql("SELECT NOT EXISTS(SELECT 1 FROM notification_daily_summary_runs WHERE summary_date='2026-11-28') AND NOT EXISTS(SELECT 1 FROM notification_daily_summary_recipient_state WHERE summary_date='2026-11-28');")=='t')
    sql('DROP TRIGGER qa_event_fail ON notification_events; DROP FUNCTION qa_event_fail();')
    check('retry after rollback creates first successful snapshot',daily('2026-11-28')['summaries_created']==1)
    # Simultaneous PILOT/FULL contenders share the same day mutex and state key.
    sql('BEGIN;'+create(232,[2,3],date='2026-11-29')+'COMMIT;')
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        a=pool.submit(daily,'2026-11-29','PILOT',2)
        b=pool.submit(daily,'2026-11-29')
        results=[a.result(),b.result()]
    check('concurrent PILOT/FULL exactly one per recipient',sum(r['summaries_created'] for r in results)==2 and aggregate('2026-11-29')=={'01':0,'02':1,'03':1})
    # Direct calls (not just has_function_privilege) exercise the real ACL gate.
    for role in ['anon','authenticated','service_role']:
        sql(f"SET ROLE {role}; SELECT run_daily_schedule_summary_pilot_v1('{uid(2)}');",fail='42501')
    check('direct pilot execution denied to all API roles')
    check('operational service wrapper returns structured statistics',json.loads(sql('SET ROLE service_role; SELECT run_daily_schedule_summary_v2();'))['scope']=='FULL')
    # Ordinary realtime classification is untouched by Daily.
    sql('BEGIN;'+create(240,[2],date='2026-11-27')+'COMMIT;')
    def kinds(): return json.loads(sql(f"SELECT jsonb_object_agg(event_type,n) FROM (SELECT event_type,count(*) n FROM notification_events WHERE source_id='{uid(240)}' GROUP BY event_type) x;"))
    check('ASSIGNED once',kinds()=={'SCHEDULE_ASSIGNED':1})
    sql(f"UPDATE operation_schedules SET title='changed' WHERE id='{uid(240)}';")
    check('title UPDATED once',kinds().get('SCHEDULE_UPDATED')==1)
    sql(f"UPDATE operation_schedules SET description='note only' WHERE id='{uid(240)}';")
    check('description-only UPDATED zero additional',kinds().get('SCHEDULE_UPDATED')==1)
    sql(f"INSERT INTO operation_schedule_assignees(schedule_id,profile_id) VALUES('{uid(240)}','{uid(3)}');")
    check('assignee-only assigns new user, no UPDATED',kinds().get('SCHEDULE_ASSIGNED')==2 and kinds().get('SCHEDULE_UPDATED')==1)
    sql(f"UPDATE operation_schedules SET status='completed' WHERE id='{uid(240)}'; UPDATE operation_schedules SET status='cancelled' WHERE id='{uid(240)}';")
    check('COMPLETED/CANCELLED classification retained for both assignees',kinds().get('SCHEDULE_COMPLETED')==2 and kinds().get('SCHEDULE_CANCELLED')==2)
    check('no event or state logical duplicates',sql("SELECT NOT EXISTS(SELECT 1 FROM notification_events GROUP BY dedupe_key HAVING count(*)>1) AND NOT EXISTS(SELECT 1 FROM notification_daily_summary_recipient_state GROUP BY summary_date,recipient_id HAVING count(*)>1);")=='t')
    print(json.dumps({'result':'PASS','count':len(passed),'checks':passed},indent=2))
finally:
    run([PG/'pg_ctl','-D',CLUSTER/'data','-m','immediate','stop'],check=False)
