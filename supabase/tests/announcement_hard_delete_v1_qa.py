"""Candidate-only isolated Postgres tests. Never connects to Production.
Bounded auth/profiles/membership fixture + exact migration; real roles/RLS/functions.
No migration tracking tables or historical replay.
"""
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
    p = run([PG/'psql','-X','-h',CLUSTER,'-p','55579','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-Atq'], prefix+text, False)
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
    run([PG/'pg_ctl','-D',CLUSTER/'data','-l',CLUSTER/'server.log','-o',f"-h '' -k {CLUSTER} -p 55579 -c wal_level=logical",'start'])
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
    pubsig='public.publish_announcement_v1(uuid,text,text,text,boolean,text,uuid[],timestamptz)'
    before_signature=sql(f"SELECT pg_get_function_arguments('{pubsig}'::regprocedure)||'|'||pg_get_function_result('{pubsig}'::regprocedure)||'|'||proacl::text FROM pg_proc WHERE oid='{pubsig}'::regprocedure;")
    # Existing published and retracted announcements must also be deletable.
    old=publish(900)
    old_retracted=publish(901)
    sql(f"SELECT retract_announcement_v1('{old_retracted}');",1)
    candidate=(ROOT/'supabase/migrations/202609300001_announcement_hard_delete_v1.sql').read_text()
    sql(candidate)
    after_signature=sql(f"SELECT pg_get_function_arguments('{pubsig}'::regprocedure)||'|'||pg_get_function_result('{pubsig}'::regprocedure)||'|'||proacl::text FROM pg_proc WHERE oid='{pubsig}'::regprocedure;")
    check('publish signature/result/ACL preserved',before_signature==after_signature)
    check('only three private tombstone columns',sql("SELECT string_agg(column_name,',' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_name='announcement_deleted_requests';")=='author_id,request_id,deleted_at')
    check('tombstone RLS enabled',sql("SELECT relrowsecurity FROM pg_class WHERE oid='announcement_deleted_requests'::regclass;")=='t')
    for role in ['anon','authenticated']:
        for privilege in ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']:
            check(f'{role} no direct tombstone {privilege}',sql(f"SELECT has_table_privilege('{role}','announcement_deleted_requests','{privilege}');")=='f')
    check('anon cannot delete RPC',sql("SELECT has_function_privilege('anon','delete_announcement_v1(uuid)','EXECUTE');")=='f')
    check('authenticated still cannot delete announcements directly',sql("SELECT has_table_privilege('authenticated','announcements','DELETE');")=='f')
    check('revision has only cursor columns',sql("SELECT string_agg(column_name,',' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_name='notification_inbox_revisions';")=='recipient_id,revision,updated_at')
    check('revision published',sql("SELECT count(*) FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='notification_inbox_revisions';")=='1')
    for role in ['anon','authenticated']:
        for privilege in ['INSERT','UPDATE','DELETE','TRUNCATE']:
            check(f'{role} cannot write revision {privilege}',sql(f"SELECT has_table_privilege('{role}','notification_inbox_revisions','{privilege}');")=='f')
    check('anon cannot read revision',sql("SELECT has_table_privilege('anon','notification_inbox_revisions','SELECT');")=='f')
    def revisions(): return sql("SELECT coalesce(jsonb_agg(r ORDER BY recipient_id),'[]') FROM notification_inbox_revisions r;")
    def remove(a,user=1,fail=None): return sql(f"SELECT delete_announcement_v1('{a}');",user,fail)
    def counts(a):return sql(f"SELECT (SELECT count(*) FROM announcements WHERE id='{a}')||','||(SELECT count(*) FROM announcement_targets WHERE announcement_id='{a}')||','||(SELECT count(*) FROM notifications WHERE announcement_id='{a}')||','||(SELECT count(*) FROM notification_events WHERE source_kind='announcement' AND source_id='{a}');")
    for user in [2,4,5,999]:
        remove(old,user,fail='ANNOUNCEMENT_DELETE_FORBIDDEN')
    check('staff inactive pending missing profile rejected',counts(old)=='1,1,3,1')
    sql(f"INSERT INTO notification_capability_grants(profile_id,capability,granted_by) VALUES('{uid(3)}','ANNOUNCEMENT_PUBLISH','{uid(1)}');")
    remove(old,3,fail='ANNOUNCEMENT_DELETE_FORBIDDEN')
    check('other capable author rejected',counts(old)=='1,1,3,1')
    for user in [4,5]:
        sql(f"INSERT INTO notification_capability_grants(profile_id,capability,granted_by) VALUES('{uid(user)}','ANNOUNCEMENT_PUBLISH','{uid(1)}');")
        remove(old,user,fail='ANNOUNCEMENT_DELETE_FORBIDDEN')
    check('inactive/pending with explicit capability rejected')
    sql(f"SELECT delete_announcement_v1('{old}');",fail='ANNOUNCEMENT_DELETE_FORBIDDEN')
    check('no auth rejected')
    check('retry before deletion unchanged',publish(900)==old)
    sql(f"SELECT mark_notification_read_v1('{nid(old,2)}');",2)
    sql(f"SELECT acknowledge_notification_v1('{nid(old,3)}');",3)
    remove(old)
    check('first delete inserts three recipient revisions',sql('SELECT count(*) FROM notification_inbox_revisions WHERE revision=1;')=='3')
    check('publisher not recipient has no revision',sql(f"SELECT count(*) FROM notification_inbox_revisions WHERE recipient_id='{uid(1)}';")=='0')
    check('recipient reads own revision only',sql('SELECT count(*) FROM notification_inbox_revisions;',2)=='1')
    check('recipient cannot read other revision',sql(f"SELECT count(*) FROM notification_inbox_revisions WHERE recipient_id='{uid(3)}';",2)=='0')
    check('inactive and pending cannot read revisions',sql('SELECT count(*) FROM notification_inbox_revisions;',4)=='0' and sql('SELECT count(*) FROM notification_inbox_revisions;',5)=='0')
    check('published read ACK multi-recipient complete cleanup',counts(old)=='0,0,0,0')
    check('tombstone exactly one',sql(f"SELECT count(*) FROM announcement_deleted_requests WHERE author_id='{uid(1)}' AND request_id='{uid(900)}';")=='1')
    sql(f"SELECT publish_announcement_v1('{uid(900)}','업무 공지','공지 본문','IMPORTANT',true,'ALL');",1,fail='ANNOUNCEMENT_REQUEST_DELETED')
    check('blocker regression delayed identical request blocked',counts(old)=='0,0,0,0')
    check('no replacement announcement for old request',sql(f"SELECT count(*) FROM announcements WHERE author_id='{uid(1)}' AND request_id='{uid(900)}';")=='0')
    new=publish(902)
    check('same content new request works',counts(new)=='1,1,3,1')
    other=publish(900,user=3)
    check('barrier scoped to author plus request',counts(other)=='1,1,3,1')
    remove(old,fail='ANNOUNCEMENT_NOT_FOUND')
    check('repeated deletion safe',counts(new)=='1,1,3,1')
    remove(old_retracted)
    check('retracted delete increments existing three revisions',sql('SELECT count(*) FROM notification_inbox_revisions WHERE revision=2;')=='3')
    check('retracted tombstone exactly one',sql(f"SELECT count(*) FROM announcement_deleted_requests WHERE author_id='{uid(1)}' AND request_id='{uid(901)}';")=='1')
    check('existing retracted deletion supported',counts(old_retracted)=='0,0,0,0')
    # Fail after barrier, notification and target cleanup, before event deletion.
    victim=publish(903)
    sql("CREATE FUNCTION hd_qa_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'ARTIFICIAL_DELETE_FAILURE'; END $$; CREATE TRIGGER hd_qa_failure BEFORE DELETE ON notification_events FOR EACH ROW EXECUTE FUNCTION hd_qa_failure();")
    before_revisions=revisions()
    before_notifications=sql(f"SELECT jsonb_agg(n ORDER BY id) FROM notifications n WHERE announcement_id='{victim}';")
    remove(victim,fail='ARTIFICIAL_DELETE_FAILURE')
    check('notifications and revisions roll back',before_notifications==sql(f"SELECT jsonb_agg(n ORDER BY id) FROM notifications n WHERE announcement_id='{victim}';") and revisions()==before_revisions)
    check('artificial midway failure restores all domain rows',counts(victim)=='1,1,3,1')
    check('artificial failure also rolls back tombstone',sql(f"SELECT count(*) FROM announcement_deleted_requests WHERE request_id='{uid(903)}';")=='0')
    sql('DROP TRIGGER hd_qa_failure ON notification_events; DROP FUNCTION hd_qa_failure();')
    # Fail both before and after revision mutation, after all domain DELETE statements.
    for timing in ['BEFORE','AFTER']:
        before_revisions=revisions()
        sql(f"CREATE FUNCTION hd_revision_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'ARTIFICIAL_REVISION_FAILURE'; END $$; CREATE TRIGGER hd_revision_failure {timing} INSERT OR UPDATE ON notification_inbox_revisions FOR EACH ROW EXECUTE FUNCTION hd_revision_failure();")
        remove(victim,fail='ARTIFICIAL_REVISION_FAILURE')
        check(f'{timing} revision failure restores domain tombstone and revisions',counts(victim)=='1,1,3,1' and revisions()==before_revisions and sql(f"SELECT count(*) FROM announcement_deleted_requests WHERE request_id='{uid(903)}';")=='0')
        sql('DROP TRIGGER hd_revision_failure ON notification_inbox_revisions; DROP FUNCTION hd_revision_failure();')
    # Two different announcements overlap recipients; UPSERT must serialize, not lose increments.
    c1=publish(910,'USER','{'+uid(2)+'}')
    c2=publish(911,'USER','{'+uid(2)+'}')
    before_a=int(sql(f"SELECT revision FROM notification_inbox_revisions WHERE recipient_id='{uid(2)}';"))
    before_b=sql(f"SELECT revision FROM notification_inbox_revisions WHERE recipient_id='{uid(3)}';")
    import time
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        first=pool.submit(sql,f"SET application_name='revision-lock-qa'; BEGIN; SELECT delete_announcement_v1('{c1}'); SELECT pg_sleep(1.5); COMMIT;",1)
        for _ in range(100):
            if sql("SELECT count(*) FROM pg_stat_activity WHERE application_name='revision-lock-qa' AND wait_event='PgSleep';")=='1':break
            time.sleep(.02)
        else: raise AssertionError('revision lock not observed')
        second=pool.submit(sql,f"SET application_name='revision-wait-qa'; SELECT delete_announcement_v1('{c2}');",1)
        for _ in range(100):
            if sql("SELECT count(*) FROM pg_stat_activity WHERE application_name='revision-wait-qa' AND wait_event_type='Lock';")=='1':break
            time.sleep(.01)
        else: raise AssertionError('concurrent revision waiter not observed')
        first.result();second.result()
    check('concurrent two deletes increment A exactly twice',int(sql(f"SELECT revision FROM notification_inbox_revisions WHERE recipient_id='{uid(2)}';"))==before_a+2)
    check('unrelated B revision unchanged',sql(f"SELECT revision FROM notification_inbox_revisions WHERE recipient_id='{uid(3)}';")==before_b)
    check('concurrent deletes both complete',counts(c1)==counts(c2)=='0,0,0,0')
    # Hold the completed delete transaction open; delayed publish must wait on the same advisory key.
    import time
    concurrent_id=publish(904)
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        deletion=pool.submit(sql,f"SET application_name='hd-delete-qa'; BEGIN; SELECT delete_announcement_v1('{concurrent_id}'); SELECT pg_sleep(1.5); COMMIT;",1)
        for _ in range(100):
            if sql("SELECT count(*) FROM pg_stat_activity WHERE application_name='hd-delete-qa' AND wait_event='PgSleep';")=='1':break
            time.sleep(.02)
        else: raise AssertionError('delete transaction barrier not observed')
        retry=pool.submit(sql,f"SELECT publish_announcement_v1('{uid(904)}','업무 공지','공지 본문','IMPORTANT',true,'ALL');",1,'ANNOUNCEMENT_REQUEST_DELETED')
        deletion.result();retry.result()
    check('concurrent delete and delayed retry never resurrect',counts(concurrent_id)=='0,0,0,0')
    check('no orphan notifications',sql('SELECT count(*) FROM notifications n LEFT JOIN announcements a ON a.id=n.announcement_id LEFT JOIN notification_events e ON e.id=n.event_id WHERE a.id IS NULL OR e.id IS NULL;')=='0')
    check('no orphan announcement events',sql("SELECT count(*) FROM notification_events e LEFT JOIN announcements a ON a.id=e.source_id WHERE e.source_kind='announcement' AND a.id IS NULL;")=='0')
    check('unrelated publication preserved',counts(new)=='1,1,3,1')
    print(json.dumps({'result':'PASS','count':len(passed),'checks':passed,'environment':'isolated local PostgreSQL','production_mutation':0},ensure_ascii=False,indent=2))
finally:
    run([PG/'pg_ctl','-D',CLUSTER/'data','stop','-m','immediate'],check=False)
