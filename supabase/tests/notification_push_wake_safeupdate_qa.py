"""Destructive LOCAL synthetic Production-schema clone QA; never accepts TCP.
Requires the incident clone's six 20000000-* synthetic profiles, one fake subscription,
fake vault/net schemas, and the exact Production predecessor. No external HTTP calls.
The safeupdate library is loaded in EVERY test session, including authenticated RPCs.
"""
import argparse
import json
from pathlib import Path
import subprocess
import uuid

ROOT = Path(__file__).resolve().parents[2]


def main():
    p = argparse.ArgumentParser(description=__doc__)
    for name in ['socket', 'port', 'database', 'psql', 'safeupdate', 'output']:
        p.add_argument('--'+name, required=True)
    a = p.parse_args()
    assert Path(a.socket).is_absolute() and Path(a.socket).is_dir()
    assert Path(a.safeupdate+'.dylib').exists() or Path(a.safeupdate+'.so').exists()
    cmd = [a.psql, '-X', '-Atq', '-h', a.socket, '-p', a.port, '-U', 'postgres', '-d', a.database,
           '-v', 'ON_ERROR_STOP=1', '--set=VERBOSITY=verbose']
    results = []

    def q(v):
        return "'"+str(v).replace("'", "''")+"'"

    def uid(n):
        return f'20000000-0000-4000-8000-{n:012d}'

    def sql(s, actor=None, error=None):
        pre = 'LOAD '+q(a.safeupdate)+"; SET search_path=public,extensions; SET statement_timeout='15s';"
        if actor:
            pre += f"SET ROLE authenticated; SET request.jwt.claim.sub='{uid(actor)}';"
        r = subprocess.run(cmd, input=pre+s, text=True, capture_output=True)
        if error:
            assert r.returncode and error in r.stderr, r.stderr
        else:
            assert r.returncode == 0, r.stderr
        return r.stdout.strip()

    def check(name, condition=True):
        assert condition, name
        results.append({'check': name, 'result': 'PASS'})
        Path(a.output).write_text(json.dumps(results, indent=2))

    def counts():
        return json.loads(sql('SELECT jsonb_build_array('+','.join('(SELECT count(*) FROM '+t+')' for t in
            ['announcements', 'announcement_targets', 'notification_events', 'notifications', 'notification_push_deliveries'])+');'))

    check('only six synthetic profiles', sql("SELECT count(*)=6 AND bool_and(id::text LIKE '20000000-0000-4000-8000-%') FROM profiles;") == 't')
    check('real safeupdate rejects unqualified UPDATE', bool(sql('UPDATE notification_push_config SET enabled=true;', error='21000') == ''))
    before = counts()
    request = str(uuid.uuid4())

    def publish(kind='ALL', recipients='{}', expiry='NULL', request_id=None):
        return "SELECT publish_announcement_v1("+q(request_id or uuid.uuid4())+",'QA wake','Synthetic only','NORMAL',true,"+q(kind)+','+q(recipients)+'::uuid[],'+expiry+');'

    sql(publish(request_id=request), 1, '21000')
    check('before fix 21000 fully rolls back', counts() == before)
    migration = (ROOT/'supabase/migrations/202610010001_notification_push_wake_safeupdate_fix.sql').read_text()
    # Guard tampering must abort without changing the function.
    original = sql("SELECT md5(pg_get_functiondef('wake_notification_push_v1()'::regprocedure));")
    sql("BEGIN; ALTER FUNCTION wake_notification_push_v1() SECURITY INVOKER;"+migration.replace('BEGIN;', '', 1), error='PUSH_WAKE_PREDECESSOR_MISMATCH')
    check('guard drift rolls back', sql("SELECT md5(pg_get_functiondef('wake_notification_push_v1()'::regprocedure));") == original)
    sql(migration)
    check('migration has no business backfill', counts() == before)

    def wake(mode):
        sql("UPDATE notification_push_config SET enabled=true WHERE singleton IS TRUE;")
        if mode == 'success':
            sql("CREATE OR REPLACE FUNCTION net.http_post(url text,body jsonb,headers jsonb,timeout_milliseconds integer) RETURNS bigint LANGUAGE sql AS $$ SELECT 1::bigint $$;")
        else:
            sql("CREATE OR REPLACE FUNCTION net.http_post(url text,body jsonb,headers jsonb,timeout_milliseconds integer) RETURNS bigint LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'LOCAL_FAKE_HTTP_FAILURE'; END $$;")

    for mode in ['success', 'failure']:
        wake(mode)
        for kind, recipients, expected in [('ALL', '{}', [1, 1, 1, 5, 1]), ('USER', '{'+uid(2)+'}', [1, 1, 1, 1, 1]), ('USER', '{'+uid(3)+'}', [1, 1, 1, 1, 0])]:
            before = counts()
            req = str(uuid.uuid4())
            sql(publish(kind, recipients, request_id=req), 1)
            check(mode+' '+kind+' '+recipients+' committed fanout', [y-x for x, y in zip(before, counts())] == expected)
            after = counts()
            sql(publish(kind, recipients, request_id=req), 1)
            check('idempotent publication no duplicates', counts() == after)
        sql('SELECT wake_notification_push_v1();')
        check('cron '+mode, sql('SELECT coalesce(last_wake_error,\'OK\') FROM notification_push_config WHERE singleton IS TRUE;') == ('OK' if mode == 'success' else 'WAKE_UNAVAILABLE'))
    before = counts()
    sql(publish(expiry="'2000-01-01Z'::timestamptz"), 1, 'INVALID_EXPIRY')
    check('genuine domain error rolls back', counts() == before)
    sql("UPDATE notification_push_config SET enabled=false WHERE singleton IS TRUE; SELECT wake_notification_push_v1();")
    before = counts()
    sql(publish('USER', '{'+uid(2)+'}'), 1)
    check('backend OFF retains queue and business commit', [y-x for x, y in zip(before, counts())] == [1, 1, 1, 1, 1])
    sql("UPDATE notification_push_config SET enabled=true WHERE singleton IS TRUE; DELETE FROM vault.decrypted_secrets WHERE name='notification_push_worker_url'; SELECT wake_notification_push_v1();")
    check('missing vault safe return', sql("SELECT last_wake_error FROM notification_push_config WHERE singleton IS TRUE;") == 'WAKE_UNAVAILABLE')
    sql("INSERT INTO vault.decrypted_secrets(name,decrypted_secret) VALUES('notification_push_worker_url','https://isolated.supabase.co/functions/v1/notification-push-dispatch');")

    # Canonical schedule command fixtures; source enabled locally only.
    sql(f"INSERT INTO operation_memberships(profile_id,role) VALUES('{uid(1)}','owner'),('{uid(2)}','staff') ON CONFLICT(profile_id) DO NOTHING; INSERT INTO business_units(id,code,name,sort_order) VALUES('{uid(11)}','training','QA training',11); INSERT INTO operation_calendars(id,name,scope_type,business_unit_id,color) VALUES('{uid(21)}','QA calendar','business_unit','{uid(11)}','#123456'); INSERT INTO operation_schedule_types(id,name,color) VALUES('{uid(30)}','QA type','#123456'); INSERT INTO operation_calendar_schedule_types(calendar_id,schedule_type_id) VALUES('{uid(21)}','{uid(30)}'); UPDATE notification_schedule_config SET enabled=true WHERE singleton IS TRUE;")
    for mode in ['success', 'failure']:
        wake(mode)
        args = f"'{uid(21)}','{uid(30)}','QA schedule','2026-10-10 10:00+09','2026-10-10 11:00+09',false,false,NULL,ARRAY['{uid(2)}'::uuid],'{{}}'::uuid[],'{{}}'::uuid[],"
        before = counts()
        s = json.loads(sql('SELECT create_operation_schedule('+args+q(uuid.uuid4())+');', 1))
        check('schedule ASSIGNED '+mode, [y-x for x, y in zip(before, counts())][2:] == [1, 1, 1])
        before = counts()
        s = json.loads(sql('SELECT update_operation_schedule('+q(s['id'])+','+str(s['version'])+','+args.replace('QA schedule', 'QA updated')+q(uuid.uuid4())+');', 1))
        check('schedule UPDATED '+mode, [y-x for x, y in zip(before, counts())][2:] == [1, 1, 1])
        before = counts()
        s = json.loads(sql('SELECT set_operation_schedule_status('+q(s['id'])+','+str(s['version'])+",'completed','QA',"+q(uuid.uuid4())+');', 1))
        check('schedule COMPLETED '+mode, [y-x for x, y in zip(before, counts())][2:] == [1, 1, 1] and s['status'] == 'completed')
    # ACK and hard delete under the patched wake path, not just frontend mocks.
    wake('success')
    announcement_id = sql(publish('USER', '{'+uid(2)+'}'), 1)
    notification_id = sql('SELECT id FROM notifications WHERE announcement_id='+q(announcement_id)+';')
    sql('SELECT acknowledge_notification_v1('+q(notification_id)+');', 2)
    check('ACK persists', sql('SELECT acknowledged_at IS NOT NULL FROM notifications WHERE id='+q(notification_id)+';') == 't')
    sql('SELECT delete_announcement_v1('+q(announcement_id)+');', 1)
    check('hard delete cascades notification and delivery', sql('SELECT NOT EXISTS(SELECT 1 FROM notifications WHERE id='+q(notification_id)+') AND NOT EXISTS(SELECT 1 FROM notification_push_deliveries WHERE notification_id='+q(notification_id)+');') == 't')
    check('no duplicate delivery', sql('SELECT count(*) FROM (SELECT notification_id,subscription_id FROM notification_push_deliveries GROUP BY 1,2 HAVING count(*)>1)x;') == '0')
    print('PASS', len(results), 'checks; safeupdate loaded in every session')


if __name__ == '__main__':
    main()
