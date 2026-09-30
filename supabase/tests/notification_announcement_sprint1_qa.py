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
    p = run([PG/'psql','-X','-h',CLUSTER,'-p','55549','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-Atq'], prefix+text, False)
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
    run([PG/'pg_ctl','-D',CLUSTER/'data','-l',CLUSTER/'server.log','-o',f"-h '' -k {CLUSTER} -p 55549 -c wal_level=logical",'start'])
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
    before=sql("SELECT jsonb_agg(p ORDER BY id) FROM profiles p;")
    # Fail-closed bootstrap 0 and 2 owners, whole migration rolls back.
    sql("UPDATE operation_memberships SET role='staff';")
    sql(MIGRATION.read_text(),fail='STOP_NOTIFICATION_BOOTSTRAP')
    check('zero owner rejects atomically',sql("SELECT to_regclass('announcements') IS NULL;")=='t')
    sql("UPDATE operation_memberships SET role='owner';")
    sql(MIGRATION.read_text(),fail='STOP_NOTIFICATION_BOOTSTRAP')
    check('two owners reject atomically',sql("SELECT to_regclass('notifications') IS NULL;")=='t')
    sql(f"UPDATE operation_memberships SET role='staff' WHERE profile_id='{uid(2)}';")
    sql('DROP PUBLICATION supabase_realtime;')
    sql(MIGRATION.read_text(),fail='STOP_REALTIME_PUBLICATION_MISSING')
    check('missing publication rolls back all candidate DDL',sql("SELECT to_regclass('announcements') IS NULL;")=='t')
    sql('CREATE PUBLICATION supabase_realtime;')
    sql(MIGRATION.read_text())
    check('exact migration / existing profiles unchanged',sql("SELECT jsonb_agg(p ORDER BY id) FROM profiles p;")==before)
    check('owner bootstrap two explicit grants',sql('SELECT count(*) FROM notification_capability_grants;')=='2')
    check('only notifications publication',sql("SELECT string_agg(tablename,',') FROM pg_publication_tables WHERE pubname='supabase_realtime';")=='notifications')
    sql("UPDATE operation_memberships SET role='staff';")
    check('authority remains explicit after owner role change',sql("SELECT notification_has_capability_v1('ANNOUNCEMENT_PUBLISH');",1)=='t')
    a=publish(100)
    check('ALL excludes author, inactive and pending',sql(f"SELECT array_agg(recipient_id ORDER BY recipient_id)::text FROM notifications WHERE announcement_id='{a}';")=='{'+','.join(uid(n) for n in [2,3,6])+'}')
    check('retry same result',publish(100)==a)
    check('retry one announcement/event, N notifications',sql(f"SELECT (SELECT count(*) FROM announcements WHERE id='{a}')||','||(SELECT count(*) FROM notification_events WHERE source_id='{a}')||','||(SELECT count(*) FROM notifications WHERE announcement_id='{a}');")=='1,1,3')
    sql(f"SELECT publish_announcement_v1('{uid(100)}','다른 제목','본문','NORMAL',false,'ALL');",1,fail='REQUEST_ID_PAYLOAD_MISMATCH')
    check('request payload mismatch rejected')
    b=publish(101,'USER','{'+uid(1)+','+uid(2)+','+uid(2)+'}',False)
    check('USER explicit self and dedup recipients',sql(f"SELECT count(*) FROM notifications WHERE announcement_id='{b}';")=='2')
    for n in [4,5,999]:
        sql(f"SELECT publish_announcement_v1('{uid(200+n)}','제목','본문','NORMAL',false,'USER',ARRAY['{uid(n)}'::uuid]);",1,fail='INACTIVE_OR_UNKNOWN_TARGET')
    check('inactive pending unknown target rejected atomically',sql('SELECT count(*) FROM announcements;')=='2')
    for user in [2,4,5,999]:
        sql(f"SELECT publish_announcement_v1('{uid(300+user)}','제목','본문','NORMAL',false,'ALL');",user,fail='FORBIDDEN')
    check('no capability / inactive / pending / missing profile publish denied')
    n=nid(a)
    check('RLS only own rows',sql(f"SELECT count(*) FROM notifications WHERE recipient_id<>'{uid(2)}';",2)=='0')
    sql('SELECT request_payload FROM announcements;',2,fail='permission denied')
    check('retry payload cannot leak audience IDs')
    check('no target leak',sql('SELECT count(*) FROM announcement_targets;',2)=='0')
    sql('SELECT * FROM notification_events;',2,fail='permission denied')
    for query in ["UPDATE notifications SET title='x';",'DELETE FROM notifications;',"INSERT INTO notification_capability_grants(profile_id,capability,granted_by) VALUES('"+uid(2)+"','ANNOUNCEMENT_PUBLISH','"+uid(2)+"');"]:
        sql(query,2,fail='permission denied')
    check('no event select / direct mutations / privilege escalation')
    for command in ['mark_notification_read_v1','acknowledge_notification_v1']:
        sql(f"SELECT {command}('{n}');",3,fail='UNAVAILABLE')
    sql(f"SELECT mark_notification_popup_presented_v1(ARRAY['{n}'::uuid]);",3,fail='INVALID_POPUP_RECEIPTS')
    sql(f"SELECT get_announcement_receipts_v1('{a}');",2,fail='FORBIDDEN')
    check('cross-recipient read ACK popup and receipts denied')
    sql(f"SELECT mark_notification_popup_presented_v1(ARRAY['{n}'::uuid]);",2)
    check('popup presentation is not read or ACK',sql(f"SELECT read_at IS NULL AND acknowledged_at IS NULL AND popup_presented_at IS NOT NULL FROM notifications WHERE id='{n}';")=='t')
    sql(f"SELECT mark_notification_read_v1('{n}');",2)
    check('read is not ACK',sql(f"SELECT read_at IS NOT NULL AND acknowledged_at IS NULL FROM notifications WHERE id='{n}';")=='t')
    check('unread and unack separate',inbox()['unread_count']==1 and inbox()['unacknowledged_count']==1)
    sql(f"SELECT acknowledge_notification_v1('{n}');",2)
    stamp=sql(f"SELECT read_at||','||acknowledged_at FROM notifications WHERE id='{n}';")
    sql(f"SELECT acknowledge_notification_v1('{n}'); SELECT mark_notification_read_v1('{n}');",2)
    check('read ACK idempotent timestamps',sql(f"SELECT read_at||','||acknowledged_at FROM notifications WHERE id='{n}';")==stamp)
    sql(f"SELECT acknowledge_notification_v1('{nid(b)}');",2,fail='ACK_UNAVAILABLE')
    check('normal non ACK announcement rejects ACK')
    receipt=json.loads(sql(f"SELECT get_announcement_receipts_v1('{a}');",1))
    check('receipt stats retain fixed audience',len(receipt)==3 and sum(bool(r['acknowledged_at']) for r in receipt)==1)
    sql(f"INSERT INTO profiles VALUES('{uid(7)}','새 직원',true,'active','staff');")
    check('new employee not retroactive recipient',inbox(7)['items']==[])
    sql(f"UPDATE profiles SET is_active=false WHERE id='{uid(3)}';")
    sql('SELECT get_notification_inbox_v1();',3,fail='FORBIDDEN')
    check('inactive loses access; frozen recipient preserved',len(json.loads(sql(f"SELECT get_announcement_receipts_v1('{a}');",1)))==3)
    sql(f"SELECT retract_announcement_v1('{a}');",1)
    check('retract removes inbox popup/unread',all(x['announcement_id']!=a for x in inbox()['items']+inbox()['popup']))
    check('retract preserves audit',sql(f"SELECT read_at||','||acknowledged_at FROM notifications WHERE id='{n}';")==stamp)
    sql(f"SELECT acknowledge_notification_v1('{n}');",2,fail='ACK_UNAVAILABLE')
    sql(f"SELECT retract_announcement_v1('{a}');",1)
    check('retract idempotent / revoked ACK denied')
    sql(f"SELECT publish_announcement_v1('{uid(500)}','제목','본문','NORMAL',false,'ALL','{{}}',now()-interval '1 second');",1,fail='INVALID_EXPIRY')
    c=publish(501,extra=",now()+interval '1 day'")
    sql(f"UPDATE announcements SET published_at=now()-interval '2 days',expires_at=now()-interval '1 day' WHERE id='{c}'; UPDATE notifications SET expires_at=now()-interval '1 day' WHERE announcement_id='{c}';")
    check('expired excluded from inbox and popup',all(x['announcement_id']!=c for x in inbox()['items']+inbox()['popup']))
    sql(f"SELECT mark_notification_read_v1('{nid(c)}');",2,fail='UNAVAILABLE')
    check('expired command denied')
    sql(f"INSERT INTO notifications(event_id,recipient_id,announcement_id,category,title,message,deep_link_type,deep_link_id) SELECT event_id,recipient_id,announcement_id,category,title,message,deep_link_type,deep_link_id FROM notifications WHERE id='{nid(b)}';",fail='duplicate key')
    sql('INSERT INTO notification_events(event_type,source_kind,source_id,dedupe_key,state,processed_at) SELECT event_type,source_kind,source_id,dedupe_key,state,processed_at FROM notification_events LIMIT 1;',fail='duplicate key')
    check('event and receipt uniqueness enforced')
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        ids=list(pool.map(lambda _:publish(600),range(4)))
    check('concurrent publish same request exactly once',len(set(ids))==1 and sql(f"SELECT count(*) FROM notification_events WHERE source_id='{ids[0]}';")=='1')
    counts=sql("SELECT (SELECT count(*) FROM announcements)||','||(SELECT count(*) FROM notification_events)||','||(SELECT count(*) FROM notifications);")
    sql("CREATE FUNCTION qa_fail_fanout() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'QA_FANOUT_FAILURE'; END $$; CREATE TRIGGER qa_fanout BEFORE INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION qa_fail_fanout();")
    sql(f"SELECT publish_announcement_v1('{uid(601)}','제목','본문','NORMAL',false,'ALL');",1,fail='QA_FANOUT_FAILURE')
    check('fanout failure rolls back announcement event targets and receipts',sql("SELECT (SELECT count(*) FROM announcements)||','||(SELECT count(*) FROM notification_events)||','||(SELECT count(*) FROM notifications);")==counts)
    sql('DROP TRIGGER qa_fanout ON notifications; DROP FUNCTION qa_fail_fanout();')
    check('PUBLIC/anon function access removed',sql("SELECT has_function_privilege('anon','publish_announcement_v1(uuid,text,text,text,boolean,text,uuid[],timestamptz)','EXECUTE');")=='f')
    check('unavailable detail null, never foreign body',sql(f"SELECT get_notification_detail_v1('{nid(b,1)}') IS NULL;",2)=='t')
    sql(f"UPDATE notification_capability_grants SET active=false,revoked_at=now() WHERE profile_id='{uid(1)}' AND capability='ANNOUNCEMENT_RECEIPTS_VIEW';")
    check('publish capability alone cannot expose receipt counts',all(row['stats'] is None for row in json.loads(sql('SELECT get_sent_announcements_v1();',1))))
    sql(f"SELECT get_announcement_receipts_v1('{b}');",1,fail='FORBIDDEN')
    check('author without receipt capability denied')
    sql(f"UPDATE profiles SET is_active=false WHERE id='{uid(1)}';")
    sql(f"SELECT retract_announcement_v1('{b}');",1,fail='FORBIDDEN')
    check('inactive publisher loses authority despite capability')
    check('all 5 new tables RLS enabled',sql("SELECT count(*) FROM pg_class WHERE relname IN ('announcements','announcement_targets','notifications','notification_events','notification_capability_grants') AND relrowsecurity;")=='5')
    print(json.dumps({'result':'PASS','count':len(passed),'checks':passed,'cluster':'isolated local PostgreSQL','production_mutation':0},ensure_ascii=False,indent=2))
finally:
    run([PG/'pg_ctl','-D',CLUSTER/'data','stop','-m','immediate'],check=False)
