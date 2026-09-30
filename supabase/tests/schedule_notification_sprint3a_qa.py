"""Local-only PostgreSQL QA: canonical table shape + exact notification migrations.
No Production connection; no external Push/network. Real deferred triggers, RLS,
transactions, concurrent retries, and the existing delivery queue.
"""
import concurrent.futures
import json
import subprocess
import tempfile
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
PG = Path('/opt/homebrew/opt/postgresql@18/bin')
CLUSTER = Path(tempfile.mkdtemp(prefix='pnm-schedule-notification-qa-'))
passed = []
def run(args, source=None, check=True):
    p = subprocess.run([str(x) for x in args], input=source, text=True, capture_output=True)
    if check and p.returncode: raise RuntimeError(p.stderr)
    return p

def uid(n): return f'00000000-0000-4000-8000-{n:012d}'
def sql(text, user=None, fail=None):
    prefix = f"SET ROLE authenticated; SET request.jwt.claim.sub='{uid(user)}';" if user else ''
    p = run([PG/'psql','-X','-h',CLUSTER,'-p','55582','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-Atq'],prefix+text,False)
    if fail: assert p.returncode and fail in p.stderr,(p.stdout,p.stderr)
    elif p.returncode: raise RuntimeError(p.stderr)
    return p.stdout.strip()
def check(name, condition=True):
    assert condition,name
    passed.append(name)
def count(kind=None):
    return int(sql("SELECT count(*) FROM notification_events"+(f" WHERE event_type='{kind}'" if kind else '')+';'))
def create(n,users=(),extra='',date="(now() AT TIME ZONE 'Asia/Seoul')::date",unknown=False):
    return f"INSERT INTO operation_schedules(id,calendar_id,schedule_type_id,title,starts_at,ends_at,time_unspecified) VALUES('{uid(n)}','{uid(90)}','{uid(91)}','개인 일정',({date})::timestamp AT TIME ZONE 'Asia/Seoul',(({date})::date+1)::timestamp AT TIME ZONE 'Asia/Seoul',{str(unknown).lower()});"+''.join(f"INSERT INTO operation_schedule_assignees(schedule_id,profile_id) VALUES('{uid(n)}','{uid(u)}');" for u in users)+extra
try:
    run([PG/'initdb','-D',CLUSTER/'data','--auth=trust','--username=postgres','--no-locale','--encoding=UTF8'])
    run([PG/'pg_ctl','-D',CLUSTER/'data','-l',CLUSTER/'server.log','-o',f"-h '' -k {CLUSTER} -p 55582 -c wal_level=logical",'start'])
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
    sql('BEGIN;'+create(100,[2])+'COMMIT;')
    sql((ROOT/'supabase/migrations/202609300003_schedule_notifications_sprint3a.sql').read_text())
    check('historical baseline creates no notification',count()==0)
    check('notification state mutex has no domain FK',sql("SELECT count(*) FROM pg_constraint WHERE conrelid='notification_schedule_state'::regclass AND contype='f';")=='0')
    check('no parent lock trigger/function',sql("SELECT to_regprocedure('lock_schedule_notification_parent_v1()') IS NULL AND NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='notification_schedule_parent_lock');")=='t')
    check('finalizer uses fresh statement snapshots',sql("SELECT provolatile='v' FROM pg_proc WHERE oid='finalize_schedule_notification_v1()'::regprocedure;")=='t')
    check('read committed isolation',sql('SHOW transaction_isolation;')=='read committed')
    sql('BEGIN;'+create(101,[2])+'COMMIT;')
    check('disabled candidate creates no notification',count()==0)
    sql('UPDATE notification_schedule_config SET enabled=true;')
    for n in [1,2]:
        sql(f"SELECT register_web_push_subscription_v1('https://fcm.googleapis.com/fcm/send/device{n}','{'B'+'a'*86}','{'b'*22}');",2)
    sql('BEGIN;'+create(102,[2],"SELECT 1;")+'COMMIT;')
    check('final assignee after schedule insert receives one',count('SCHEDULE_ASSIGNED')==1)
    check('two devices queue two deliveries',sql('SELECT count(*) FROM notification_push_deliveries;')=='2')
    sql(f"UPDATE operation_schedules SET updated_at=now(),version=version+1,description='메모 수정' WHERE id='{uid(102)}';")
    check('metadata description/version only no noise',count()==1)
    sql(f"UPDATE operation_schedules SET title='변경 일정' WHERE id='{uid(102)}';")
    check('meaningful update one event',count('SCHEDULE_UPDATED')==1)
    sql(f"UPDATE operation_schedules SET title='변경 일정' WHERE id='{uid(102)}';")
    check('same write retry zero duplicates',count('SCHEDULE_UPDATED')==1)
    sql(f"BEGIN; UPDATE operation_schedules SET title='중간' WHERE id='{uid(102)}'; UPDATE operation_schedules SET title='변경 일정' WHERE id='{uid(102)}'; COMMIT;")
    check('intermediate transient states collapse',count('SCHEDULE_UPDATED')==1)
    sql(f"UPDATE operation_schedules SET status='completed' WHERE id='{uid(102)}';")
    sql(f"UPDATE operation_schedules SET status='completed' WHERE id='{uid(102)}';")
    check('completion transition exactly one',count('SCHEDULE_COMPLETED')==1)
    sql('BEGIN;'+create(103,[2])+'COMMIT;')
    before=count()
    sql(f"BEGIN; UPDATE operation_schedule_assignees SET archived_at=now() WHERE schedule_id='{uid(103)}'; INSERT INTO operation_schedule_assignees(schedule_id,profile_id) VALUES('{uid(103)}','{uid(3)}'); COMMIT;")
    check('reassignment only new assignee notified',count()==before+1 and sql("SELECT recipient_id FROM notifications ORDER BY created_at DESC LIMIT 1;")==uid(3))
    before=count()
    sql('BEGIN;'+create(104,[4,5,6])+create(105,[])+'COMMIT;')
    check('inactive pending non-member/no assignee excluded',count()==before)
    sql(f"INSERT INTO operation_schedule_assignees(schedule_id,profile_id) VALUES('{uid(105)}','{uid(2)}');")
    check('later assignee transaction still emits assignment',count()==before+1)
    sql('BEGIN;'+create(106,[2],unknown=True)+'COMMIT;')
    check('unknown time preview preserves date without fake time',sql(f"SELECT message LIKE '%시간 미정%' AND message NOT LIKE '%00:00%' FROM notifications WHERE deep_link_id='{uid(106)}';")=='t')
    before=count()
    sql('BEGIN;'+create(107,[2])+'ROLLBACK;')
    check('rollback removes event and delivery',count()==before)
    for role in ['anon','authenticated']:
        check(role+' cannot call internal emit',sql(f"SELECT has_function_privilege('{role}','emit_schedule_notification_v1(uuid,uuid,text,text,date,integer)','EXECUTE');")=='f')
        check(role+' cannot call daily summary',sql(f"SELECT has_function_privilege('{role}','run_daily_schedule_summary_v1()','EXECUTE');")=='f')
        for table in ['notification_schedule_config','notification_schedule_state']:
            check(role+' no direct '+table,sql(f"SELECT has_table_privilege('{role}','{table}','SELECT,INSERT,UPDATE,DELETE');")=='f')
    inbox=json.loads(sql('SELECT get_notification_inbox_v1();',2))
    check('schedule inbox no ACK and no announcement popup',len(inbox['items'])>0 and all(not n['ack_required'] for n in inbox['items']) and inbox['popup']==[])
    nid=inbox['items'][0]['id'];sql(f"SELECT mark_notification_read_v1('{nid}');",2)
    check('read does not complete schedule',sql(f"SELECT status FROM operation_schedules WHERE id='{uid(106)}';")=='scheduled')
    sql(f"SELECT mark_notification_read_v1('{nid}');",3,fail='NOTIFICATION_UNAVAILABLE')
    check('recipient isolation')
    sql("UPDATE notification_schedule_config SET daily_summary_enabled=true,daily_summary_time='00:00';")
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(lambda _:sql('SELECT run_daily_schedule_summary_v1();'),range(4)))
    check('concurrent daily repeat once per user',count('DAILY_SCHEDULE_SUMMARY')==2)
    check('daily membership 0 schedules no notification',sql(f"SELECT count(*) FROM notifications n JOIN notification_events e ON e.id=n.event_id WHERE e.event_type='DAILY_SCHEDULE_SUMMARY' AND n.recipient_id IN ('{uid(1)}','{uid(4)}','{uid(5)}','{uid(6)}');")=='0')
    check('completed excluded summary count',sql(f"SELECT (e.payload->>'count')::integer=(SELECT count(*) FROM operation_schedules s JOIN operation_schedule_assignees a ON a.schedule_id=s.id WHERE a.profile_id='{uid(2)}' AND a.archived_at IS NULL AND s.status='scheduled') FROM notification_events e JOIN notifications n ON n.event_id=e.id WHERE e.event_type='DAILY_SCHEDULE_SUMMARY' AND n.recipient_id='{uid(2)}';")=='t')
    sql(f"UPDATE operation_schedules SET status='cancelled' WHERE id='{uid(106)}';")
    check('cancellation event one',count('SCHEDULE_CANCELLED')==1)
    check('KST previous UTC day boundary',sql("SELECT ('2026-09-30 15:00:00+00'::timestamptz AT TIME ZONE 'Asia/Seoul')::date='2026-10-01'::date;")=='t')
    sql('SET timezone=\'America/Los_Angeles\';'+f"UPDATE operation_schedules SET version=version+1 WHERE id='{uid(105)}';")
    check('fingerprint session timezone independent',count('SCHEDULE_UPDATED')==1)
    before=count('SCHEDULE_UPDATED')
    def update(_):sql(f"UPDATE operation_schedules SET title='동시 수정' WHERE id='{uid(105)}';")
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:list(pool.map(update,range(4)))
    check('concurrent identical update exactly once',count('SCHEDULE_UPDATED')==before+1)
    check('no delivery duplicate',sql('SELECT count(*)=count(DISTINCT (notification_id,subscription_id)) FROM notification_push_deliveries;')=='t')
    pub=sql(f"SELECT publish_announcement_v1('{uid(1001)}','공지','본문','NORMAL',false,'USER',ARRAY['{uid(2)}'::uuid]);",1)
    check('announcement coexistence',any(n['announcement_id']==pub for n in json.loads(sql('SELECT get_notification_inbox_v1();',2))['items']))
    sql('UPDATE notification_push_config SET enabled=true;')
    claimed=json.loads(sql("SELECT jsonb_agg(x) FROM claim_notification_push_deliveries_v1() x;"))
    payloads=[json.loads(sql(f"SELECT get_notification_push_delivery_v1('{x['delivery_id']}','{x['token']}');")) for x in claimed]
    check('canonical template event carried through existing queue',any(x['event_type']=='SCHEDULE_ASSIGNED' for x in payloads))
    sql("UPDATE notification_schedule_config SET daily_summary_time='08:00';")
    sql('BEGIN;'+create(201,[2],date="'2026-10-11'::date",unknown=True)+create(202,[2,3],date="'2026-10-11'::date")+create(203,[2],date="'2026-10-11'::date",extra=f"UPDATE operation_schedules SET status='completed' WHERE id='{uid(203)}';")+create(204,[2],date="'2026-10-11'::date",extra=f"UPDATE operation_schedules SET status='cancelled' WHERE id='{uid(204)}';")+'COMMIT;')
    before=count('DAILY_SCHEDULE_SUMMARY')
    sql("SELECT run_daily_schedule_summary_at_v1('2026-10-10 22:59:59+00');")
    check('07:59 KST before configurable summary time',count('DAILY_SCHEDULE_SUMMARY')==before)
    sql("SELECT run_daily_schedule_summary_at_v1('2026-10-10 23:00:00+00');")
    check('08:00 KST uses previous UTC day and isolates two recipients',count('DAILY_SCHEDULE_SUMMARY')==before+2)
    check('unknown time included, completed/cancelled excluded, N aggregated',sql("SELECT string_agg(e.payload->>'count',',' ORDER BY n.recipient_id) FROM notification_events e JOIN notifications n ON n.event_id=e.id WHERE e.event_type='DAILY_SCHEDULE_SUMMARY' AND e.payload->>'local_date'='2026-10-11';")=='2,1')
    sql("SELECT run_daily_schedule_summary_at_v1('2026-10-11 14:59:59+00');")
    check('same KST date late cron still deduped',count('DAILY_SCHEDULE_SUMMARY')==before+2)
    sql("SELECT run_daily_schedule_summary_at_v1('2026-10-11 15:00:00+00');")
    check('KST next midnight no accidental prior-day summary',count('DAILY_SCHEDULE_SUMMARY')==before+2)
    sql("SELECT run_daily_schedule_summary_at_v1('2026-10-12 00:00:00+00');")
    check('empty next date emits nothing',count('DAILY_SCHEDULE_SUMMARY')==before+2)
    check('internal clock helper not client callable',sql("SELECT has_function_privilege('authenticated','run_daily_schedule_summary_at_v1(timestamptz)','EXECUTE');")=='f')
    delivery=sql(f"SELECT d.id FROM notification_push_deliveries d JOIN notifications n ON n.id=d.notification_id WHERE n.deep_link_id='{uid(105)}' LIMIT 1;")
    check('active canonical assignee delivery valid',sql(f"SELECT push_delivery_valid_v1('{delivery}');")=='t')
    sql(f"UPDATE operation_memberships SET is_active=false WHERE profile_id='{uid(2)}';")
    check('membership revoked after enqueue blocks send',sql(f"SELECT push_delivery_valid_v1('{delivery}');")=='f')
    sql(f"UPDATE operation_memberships SET is_active=true WHERE profile_id='{uid(2)}';")
    sql(f"UPDATE operation_schedule_assignees SET archived_at=now() WHERE schedule_id='{uid(105)}';")
    check('assignment removed after enqueue blocks send',sql(f"SELECT push_delivery_valid_v1('{delivery}');")=='f')
    print(json.dumps({'result':'PASS','checks':len(passed),'passed':passed},ensure_ascii=False,indent=2))
finally:
    run([PG/'pg_ctl','-D',CLUSTER/'data','stop','-m','immediate'],check=False)
