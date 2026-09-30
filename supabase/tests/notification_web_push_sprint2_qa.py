"""Candidate-only isolated Postgres tests. Never connects to Production.
Bounded auth/profiles/membership fixture + exact migration; real roles/RLS/functions.
No migration tracking tables or historical replay.
"""
import os
import concurrent.futures
import json
import subprocess
import tempfile
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
PG = Path('/opt/homebrew/opt/postgresql@18/bin')
CLUSTER = Path(tempfile.mkdtemp(prefix='pnm-notification-qa-'))
MIGRATION = ROOT/'supabase/migrations/202609290001_notification_announcement_sprint1.sql'
passed = []
def run(args, source=None, check=True):
    p = subprocess.run([str(x) for x in args], input=source, text=True, capture_output=True)
    if check and p.returncode: raise RuntimeError(p.stderr)
    return p

def sql(text, user=None, fail=None):
    prefix = f"SET ROLE authenticated; SET request.jwt.claim.sub='{uid(user)}';" if user else ''
    p = run([PG/'psql','-X','-h',CLUSTER,'-p','55581','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-Atq'], prefix+text, False)
    if fail:
        assert p.returncode and fail in p.stderr, (text, p.stdout, p.stderr)
    elif p.returncode: raise RuntimeError(p.stderr)
    return p.stdout.strip()

def uid(n): return f'00000000-0000-4000-8000-{n:012d}'
def check(name, condition=True):
    assert condition, name
    passed.append(name)
def publish(request, kind='ALL', users='{}', ack=True, extra='', user=1):
    return sql(f"SELECT publish_announcement_v1('{uid(request)}','업무 공지','공지 본문','IMPORTANT',{str(ack).lower()},'{kind}','{users}'::uuid[]{extra});", user)
def inbox(user=2): return json.loads(sql('SELECT get_notification_inbox_v1();', user))
def nid(announcement,user=2): return sql(f"SELECT id FROM notifications WHERE announcement_id='{announcement}' AND recipient_id='{uid(user)}';")
try:
    run([PG/'initdb','-D',CLUSTER/'data','--auth=trust','--username=postgres','--no-locale','--encoding=UTF8'])
    run([PG/'pg_ctl','-D',CLUSTER/'data','-l',CLUSTER/'server.log','-o',f"-h '' -k {CLUSTER} -p 55581 -c wal_level=logical",'start'])
    sql("""CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO authenticated; GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
    CREATE TABLE profiles(id uuid PRIMARY KEY,name text,is_active boolean,account_status text,role text);
    CREATE TABLE operation_memberships(profile_id uuid PRIMARY KEY REFERENCES profiles(id),role text,is_active boolean);
    CREATE PUBLICATION supabase_realtime;
    """)
    for n in range(1,7):
        sql(f"INSERT INTO profiles VALUES('{uid(n)}','테스트 직원 {n}',{str(n!=4).lower()},'{ 'pending' if n==5 else 'active'}','{'admin' if n==1 else 'staff'}');")
    sql(f"INSERT INTO operation_memberships VALUES('{uid(1)}','owner',true),('{uid(2)}','staff',true);")
    baseline=MIGRATION.read_text()
    sql(baseline)
    sql((ROOT/'supabase/migrations/202609300001_announcement_hard_delete_v1.sql').read_text())
    before=sql("SELECT md5(string_agg(pg_get_functiondef(oid),'' ORDER BY oid)) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('publish_announcement_v1','delete_announcement_v1','retract_announcement_v1');")
    sql((ROOT/'supabase/migrations/202609300002_notification_web_push_sprint2.sql').read_text())
    check('existing public commands unchanged',before==sql("SELECT md5(string_agg(pg_get_functiondef(oid),'' ORDER BY oid)) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('publish_announcement_v1','delete_announcement_v1','retract_announcement_v1');"))
    def register(n,user=2,key='B'+'a'*86,fail=None):
        return sql(f"SELECT register_web_push_subscription_v1('https://fcm.googleapis.com/fcm/send/device{n}','{key}','{'b'*22}');",user,fail)
    def disable(n,user=2,fail=None):return sql(f"SELECT disable_web_push_subscription_v1('https://fcm.googleapis.com/fcm/send/device{n}');",user,fail)
    for user in [4,5,999]: register(1,user,fail='PUSH_FORBIDDEN')
    check('inactive pending missing accounts denied')
    for role in ['anon','authenticated']:
        for table in ['push_subscriptions','notification_push_deliveries','notification_push_config']:
            for privilege in ['SELECT','INSERT','UPDATE','DELETE']:
                check(f'{role} no direct {table} {privilege}',sql(f"SELECT has_table_privilege('{role}','{table}','{privilege}');")=='f')
    check('client cannot claim',sql("SELECT has_function_privilege('authenticated','claim_notification_push_deliveries_v1(integer)','EXECUTE');")=='f')
    check('no client profile parameter', 'profile' not in sql("SELECT pg_get_function_arguments('register_web_push_subscription_v1(text,text,text,timestamptz)'::regprocedure);"))
    one=register(1);two=register(2)
    check('multi-device idempotent',one!=two and register(1)==one and sql('SELECT count(*) FROM push_subscriptions;')=='2')
    register(1,3,key='B'+'c'*86,fail='PUSH_BINDING_CONFLICT')
    disable(1,3,fail='PUSH_SUBSCRIPTION_NOT_OWNED')
    check('other device disable / wrong keys rebind denied')
    for endpoint in ['http://localhost/x','https://evil.test/x','https://fcm.googleapis.com.evil.test/x']:
        sql(f"SELECT register_web_push_subscription_v1('{endpoint}','{'B'+'a'*86}','{'b'*22}');",2,fail='PUSH_INVALID_SUBSCRIPTION')
    check('SSRF endpoints rejected')
    a=publish(1001)
    check('fanout only subscribed recipient two devices',sql('SELECT count(*) FROM notification_push_deliveries;')=='2')
    check('disabled worker claims nothing',sql('SELECT count(*) FROM claim_notification_push_deliveries_v1();')=='0')
    check('unique notification/device',sql('SELECT count(*) FROM (SELECT notification_id,subscription_id FROM notification_push_deliveries GROUP BY 1,2) x;')=='2')
    register(1,3)
    check('rebind cancels prior identity queue',sql(f"SELECT status FROM notification_push_deliveries WHERE subscription_id='{one}';")=='CANCELLED')
    check('rebind recipient owns endpoint',sql(f"SELECT profile_id FROM push_subscriptions WHERE id='{one}';")==uid(3))
    sql('UPDATE notification_push_config SET enabled=true;')
    b=publish(1002)
    check('wake failure cannot roll back publication',sql("SELECT last_wake_error FROM notification_push_config;")=='WAKE_UNAVAILABLE')
    def claims():return json.loads(sql("SELECT coalesce(jsonb_agg(x),'[]') FROM claim_notification_push_deliveries_v1(10) x;"))
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
        batches=list(pool.map(lambda _:claims(),range(5)))
    allclaims=[x for batch in batches for x in batch]
    check('concurrent workers claim each row once',len(allclaims)==3 and len({x['delivery_id'] for x in allclaims})==3)
    def get(c):return sql(f"SELECT get_notification_push_delivery_v1('{c['delivery_id']}','{c['token']}');")
    def finish(c,result):return sql(f"SELECT finish_notification_push_delivery_v1('{c['delivery_id']}','{c['token']}','{result}',120);")
    check('canonical worker data available',bool(get(allclaims[0])))
    check('success persisted',finish(allclaims[0],'SENT')=='t' and finish(allclaims[0],'SENT')=='f')
    c=allclaims[1];finish(c,'RETRY')
    check('retry delay prevents immediate claim',claims()==[])
    sql(f"UPDATE notification_push_deliveries SET available_at=now()-interval '1 second' WHERE id='{c['delivery_id']}';")
    new=claims()[0];check('retry fresh token',new['token']!=c['token']);finish(new,'GONE')
    check('gone revokes endpoint',sql(f"SELECT s.revoked_at IS NOT NULL FROM push_subscriptions s JOIN notification_push_deliveries d ON s.id=d.subscription_id WHERE d.id='{new['delivery_id']}';")=='t')
    c=allclaims[2]
    sql(f"UPDATE notification_push_deliveries SET lease_until=now()-interval '1 second' WHERE id='{c['delivery_id']}';")
    retry=claims();check('expired lease retry / stale completion denied',len(retry)<=1 and finish(c,'SENT')=='f')
    for x in retry:finish(x,'SENT')
    register(1,2);register(2,2)
    a=publish(1003);claimed=claims();sql(f"SELECT retract_announcement_v1('{a}');",1)
    check('retracted claimed payload null',all(get(c)=='' for c in claimed))
    for c in claimed:finish(c,'CANCELLED')
    a=publish(1004);claimed=claims();sql(f"UPDATE notifications SET expires_at=now()-interval '1 second' WHERE announcement_id='{a}';")
    check('expired claimed payload null',all(get(c)=='' for c in claimed))
    for c in claimed:finish(c,'CANCELLED')
    a=publish(1005);claimed=claims();sql(f"SELECT delete_announcement_v1('{a}');",1)
    check('hard delete cascades delivery / in-flight no-op',all(get(c)=='' and finish(c,'SENT')=='f' for c in claimed))
    before=sql('SELECT count(*) FROM notification_push_deliveries;')
    sql(f"BEGIN; SELECT publish_announcement_v1('{uid(1006)}','test','body','NORMAL',false,'ALL'); ROLLBACK;",1)
    check('publication rollback also rolls back fanout',before==sql('SELECT count(*) FROM notification_push_deliveries;'))
    disable(1);disable(2);before=sql('SELECT count(*) FROM notification_push_deliveries;');publish(1007)
    check('revoked subscriptions / no subscription recipient enqueue zero',before==sql('SELECT count(*) FROM notification_push_deliveries;'))
    deno=os.environ.get('PNM_DENO','deno')
    os.environ['PNM_PUSH_QA_SOCKET']=str(CLUSTER)
    os.environ['PNM_PUSH_QA_PSQL']=str(PG/'psql')
    integration=run([deno,'run','--config',ROOT/'supabase/functions/notification-push-dispatch/deno.json','--allow-env','--allow-read','--allow-run='+str(PG/'psql'),'--allow-net=127.0.0.1',ROOT/'supabase/functions/notification-push-dispatch/integration_test.ts'])
    check('actual Announcement + concurrent Deno encrypted HTTP E2E', 'PASS:' in integration.stdout)
    print(json.dumps({'result':'PASS','checks':len(passed),'passed':passed},ensure_ascii=False,indent=2))
finally:
    run([PG/'pg_ctl','-D',CLUSTER/'data','stop','-m','immediate'],check=False)
