"""Local-only ACL regression on a pre-Sprint-3A Production-schema clone.
Requires synthetic QA profiles and schedules, never accepts a TCP connection.
Replays postgres/public default privileges before exact 0003 and ACL-only 0004.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
TARGETS = [('schedule_notification_fingerprint_v1(public.operation_schedules)', '2258090c8865964a91e81d7d74fbb57c', False), ('schedule_notification_recipient_v1(uuid)', 'd9557fb448ee44436cf92be3157ff178', True), ('emit_schedule_notification_v1(uuid,uuid,text,text,date,integer)', '856c596505f9fc38110e1b2e47e30c08', True), ('finalize_schedule_notification_v1()', '9824cef3a326e7ed4735e2c4f8ba1feb', True), ('run_daily_schedule_summary_at_v1(timestamp with time zone)', '0e2d249aa51b35203721fde124fff0a9', True)]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--socket', required=True)
    parser.add_argument('--port', required=True)
    parser.add_argument('--database', default='rehearsal')
    parser.add_argument('--psql', default='psql')
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    assert Path(args.socket).is_absolute() and Path(args.socket).is_dir()
    connection = [args.psql, '-X', '-Atq', '-h', args.socket, '-p', args.port,
                  '-U', 'postgres', '-d', args.database, '-v', 'ON_ERROR_STOP=1',
                  '--set=VERBOSITY=verbose']
    results = []

    def sql(text, error=None):
        result = subprocess.run(connection, input='SET search_path=public,extensions;'+text,
                                text=True, capture_output=True)
        if error:
            assert result.returncode and error in result.stderr, result.stderr
        else:
            assert result.returncode == 0, result.stderr
        return result.stdout.strip()

    def check(name, value=True):
        assert value, name
        results.append({'check': name, 'result': 'PASS'})

    def catalog():
        return json.loads(sql("SELECT jsonb_agg(jsonb_build_object('oid',p.oid,'body',md5(prosrc),'owner',proowner,'security',prosecdef,'config',proconfig,'acl',proacl::text) ORDER BY p.oid) FROM pg_proc p WHERE pronamespace='public'::regnamespace;"))

    def privileges(signature):
        return sql("SELECT array_agg(has_function_privilege(r,'public."+signature+"','EXECUTE') ORDER BY r) FROM unnest(ARRAY['anon','authenticated','service_role']) r;")

    check('synthetic clone only', sql("SELECT count(*) FROM profiles WHERE id::text NOT LIKE '10000000-0000-4000-8000-%';") == '0')
    check('fixture exists', int(sql('SELECT count(*) FROM operation_schedules;')) > 0)
    check('pre-0003 clone', sql("SELECT to_regprocedure('public.finalize_schedule_notification_v1()') IS NULL;") == 't')
    original = ROOT/'supabase/migrations/202609300003_schedule_notifications_sprint3a.sql'
    check('0003 immutable SHA', hashlib.sha256(original.read_bytes()).hexdigest() == 'e263a07ea65c6653a57bcbb0c80680d3d13a33e0c191c65cfb08aebff945356f')
    # Production has no postgres global override. Built-in PUBLIC function EXECUTE
    # combines with these schema-specific grants until 0003 explicitly revokes it.
    sql('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon,authenticated,service_role;'
        'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated,service_role;'
        'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon,authenticated,service_role;')
    sql(original.read_text())
    for signature, _, _ in TARGETS:
        check('default ACL reproduced: '+signature, privileges(signature) == '{f,f,t}')
    patch = (ROOT/'supabase/migrations/202609300004_schedule_notification_internal_acl_fix.sql').read_text()
    body = patch[patch.index('BEGIN;')+6:patch.rindex('COMMIT;')]
    before = catalog()
    # Each mismatch occurs before any REVOKE. Failed transaction cannot partially apply.
    signature = TARGETS[0][0]
    drifts = {
        'missing': 'ALTER FUNCTION public.'+signature+' RENAME TO qa_fingerprint_missing;',
        'body': "CREATE OR REPLACE FUNCTION public."+signature.replace('(public.operation_schedules)', '(s public.operation_schedules)')+" RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS 'SELECT NULL::jsonb';",
        'owner': 'ALTER FUNCTION public.'+signature+' OWNER TO service_role;',
        'security': 'ALTER FUNCTION public.'+signature+' SECURITY DEFINER;',
        'search_path': 'ALTER FUNCTION public.'+signature+' SET search_path=public;',
        'ACL': 'GRANT EXECUTE ON FUNCTION public.'+signature+' TO authenticated;',
    }
    for name, mutation in drifts.items():
        sql('BEGIN;'+mutation+body+'ROLLBACK;', 'SCHEDULE_INTERNAL_ACL_PREDECESSOR_')
        check('guard atomic rejection: '+name, catalog() == before)
    sql(patch)
    after = catalog()
    changed = [a['oid'] for a,b in zip(before,after) if a != b]
    check('exactly five ACL changes', len(changed) == 5)
    check('all bodies owners security and config identical', [{k:v for k,v in a.items() if k!='acl'} for a in before] == [{k:v for k,v in a.items() if k!='acl'} for a in after])
    calls = ['schedule_notification_fingerprint_v1(NULL::public.operation_schedules)',
             "schedule_notification_recipient_v1('10000000-0000-4000-8000-000000000002')",
             "emit_schedule_notification_v1(NULL,NULL,'QA','QA',NULL,NULL)",
             'finalize_schedule_notification_v1()', 'run_daily_schedule_summary_at_v1(now())']
    for (signature, _, _), call in zip(TARGETS, calls):
        check('final client privileges denied: '+signature, privileges(signature) == '{f,f,f}')
        check('owner executes: '+signature, sql("SELECT has_function_privilege('postgres','public."+signature+"','EXECUTE');") == 't')
        for role in ['anon','authenticated','service_role']:
            sql('SET ROLE '+role+'; SELECT public.'+call+';', '42501')
            check(role+' direct denied: '+signature)
    check('public service entry preserved', sql("SET ROLE service_role; SELECT run_daily_schedule_summary_v1();") == '0')
    # Probe a downstream state write: it observes the effective identity inherited
    # from the unmodified SECURITY DEFINER finalizer, not a rewritten test double.
    sql("CREATE TABLE qa_effective_role(observed_role text, session_role text);"
        "CREATE FUNCTION qa_observe_role() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN INSERT INTO qa_effective_role VALUES(current_user,session_user); RETURN NEW; END $$;"
        "CREATE TRIGGER qa_observe AFTER INSERT OR UPDATE ON notification_schedule_state FOR EACH ROW EXECUTE FUNCTION qa_observe_role();")
    for enabled in [False, True]:
        sql('UPDATE notification_schedule_config SET enabled='+str(enabled).lower()+';')
        before_events = int(sql("SELECT count(*) FROM notification_events WHERE source_kind='schedule';"))
        # Representative service-role server write; triggers fire automatically and
        # enter owner context even though the initiating role cannot invoke them.
        sql("SET ROLE service_role; UPDATE operation_schedules SET title=title||' ACL replay' WHERE id=(SELECT id FROM operation_schedules ORDER BY id LIMIT 1);")
        check('service-role automatic trigger, enabled='+str(enabled), sql("SELECT count(*) FROM qa_effective_role WHERE observed_role<>'postgres';") == '0' and int(sql('SELECT count(*) FROM qa_effective_role;')) > 0)
        delta = int(sql("SELECT count(*) FROM notification_events WHERE source_kind='schedule';"))-before_events
        check('OFF/ON emission '+str(enabled), delta > 0 if enabled else delta == 0)
    sql("UPDATE notification_schedule_config SET daily_summary_enabled=true,daily_summary_time='00:00';")
    check('service public daily wrapper enters revoked internal helper', int(sql('SET ROLE service_role; SELECT run_daily_schedule_summary_v1();')) >= 0)
    sql('UPDATE notification_schedule_config SET daily_summary_enabled=false;')
    sql('INSERT INTO notification_push_config(singleton,enabled) VALUES(true,false) ON CONFLICT(singleton) DO NOTHING;')
    # Synthetic subscription never leaves the isolated database: no provider send.
    sql("SET ROLE authenticated; SET request.jwt.claim.sub='10000000-0000-4000-8000-000000000002';"
        "SELECT register_web_push_subscription_v1('https://fcm.googleapis.com/fcm/send/acl-local-qa','"+'B'+'a'*86+"','"+'b'*22+"');")
    sql('UPDATE notification_push_config SET enabled=true;')
    sql("SET ROLE service_role; UPDATE operation_schedules SET title=title||' push ACL replay' WHERE id=(SELECT id FROM operation_schedules ORDER BY id LIMIT 1);")
    claims = json.loads(sql('SET ROLE service_role; SELECT jsonb_agg(x) FROM claim_notification_push_deliveries_v1() x;'))
    check('service worker claims real synthetic schedule delivery', len(claims) > 0)
    for claim in claims:
        payload = json.loads(sql("SET ROLE service_role; SELECT get_notification_push_delivery_v1('"+claim['delivery_id']+"','"+claim['token']+"');"))
        check('service worker get -> validity -> revoked recipient helper', payload['event_type'].startswith('SCHEDULE_'))
    sql('UPDATE notification_push_config SET enabled=false;')
    check('nested owner recipient', sql("SELECT schedule_notification_recipient_v1('10000000-0000-4000-8000-000000000002');") == 't')
    sql('DROP TRIGGER qa_observe ON notification_schedule_state; DROP FUNCTION qa_observe_role(); DROP TABLE qa_effective_role; UPDATE notification_schedule_config SET enabled=false;')
    Path(args.output).write_text(json.dumps({'result':'PASS','checks':results}, indent=2)+'\n')
    print('ACL QA PASS:', len(results), 'checks')


if __name__ == '__main__':
    main()
