"""Post-candidate regression on an isolated Production-schema clone.
Requires existing six synthetic 20000000-* profiles and canonical QA calendar/type.
Refuses TCP; safeupdate is loaded in every SQL session. No provider network calls.
"""
import argparse
import json
import subprocess
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
for key in ['socket', 'port', 'database', 'psql', 'safeupdate', 'output']:
    parser.add_argument('--'+key, required=True)
a = parser.parse_args()
assert Path(a.socket).is_absolute() and Path(a.socket).is_dir()
checks = []

def uid(n):
    return f'20000000-0000-4000-8000-{n:012d}'

def sql(s, actor=None):
    prefix = "LOAD '"+a.safeupdate.replace("'", "''")+"'; SET search_path=public,extensions; SET statement_timeout='15s';"
    if actor:
        prefix += f"SET ROLE authenticated; SET request.jwt.claim.sub='{uid(actor)}';"
    r = subprocess.run([a.psql, '-X', '-Atq', '-h', a.socket, '-p', a.port, '-U', 'postgres', '-d', a.database, '-v', 'ON_ERROR_STOP=1'], input=prefix+s, text=True, capture_output=True)
    assert r.returncode == 0, r.stderr
    return r.stdout.strip()

def check(name, condition):
    assert condition, name
    checks.append(name)
    print('PASS', name, flush=True)
    Path(a.output).write_text(json.dumps({'result':'PASS','checks':checks}, indent=2))

check('synthetic clone only', sql("SELECT count(*)=6 AND bool_and(id::text LIKE '20000000-%') FROM profiles;") == 't')
check('canonical domain RPC exists', sql("SELECT to_regprocedure('create_operation_schedule(uuid,uuid,text,timestamptz,timestamptz,boolean,boolean,text,uuid[],uuid[],uuid[],uuid)') IS NOT NULL;") == 't')
sql('UPDATE notification_schedule_config SET enabled=true,daily_summary_enabled=false WHERE singleton IS TRUE; UPDATE notification_push_config SET enabled=false WHERE singleton IS TRUE;')
created = []
for i in range(3):
    result = json.loads(sql(f"SELECT create_operation_schedule('{uid(21)}','{uid(30)}','Daily clone QA {i}','2040-11-10 10:00+09','2040-11-10 11:00+09',false,false,NULL,ARRAY['{uid(2)}'::uuid],'{{}}'::uuid[],'{{}}'::uuid[],gen_random_uuid());", 1))
    created.append(result['id'])
r = json.loads(sql(f"SELECT run_daily_schedule_summary_pilot_v1('{uid(2)}','2040-11-10 08:00+09');"))
check('canonical command schedules counted in owner-only pilot', r['summaries_created']==1 and r['snapshots_created']==1 and sql(f"SELECT schedule_count FROM notification_daily_summary_recipient_state WHERE summary_date='2040-11-10' AND recipient_id='{uid(2)}';")=='3')
check('exact notifications/deliveries in real schema', r['notifications_created']==1 and r['deliveries_created']==1)
check('repeated pilot returns zero actual creations', json.loads(sql(f"SELECT run_daily_schedule_summary_pilot_v1('{uid(2)}','2040-11-10 08:01+09');"))['notifications_created']==0)
nid = sql(f"SELECT id FROM notifications WHERE deep_link_type='SCHEDULE_DAY' AND schedule_local_date='2040-11-10' AND recipient_id='{uid(2)}';")
sql(f"SELECT mark_notification_read_v1('{nid}');",2)
check('actual read contract works, no ACK relation', sql(f"SELECT read_at IS NOT NULL AND acknowledged_at IS NULL AND announcement_id IS NULL FROM notifications WHERE id='{nid}';")=='t')
check('FULL remains OFF', sql('SELECT run_daily_schedule_summary_v1();')=='0')
# Hardened wake must also preserve normal Announcement publication and hard delete.
sql("UPDATE notification_push_config SET enabled=true WHERE singleton IS TRUE; CREATE OR REPLACE FUNCTION net.http_post(url text,body jsonb,headers jsonb,timeout_milliseconds integer) RETURNS bigint LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'LOCAL_WAKE_FAILURE'; END $$;")
aid = sql(f"SELECT publish_announcement_v1(gen_random_uuid(),'Local QA','Local only','NORMAL',false,'USER',ARRAY['{uid(2)}'::uuid],NULL);",1)
check('announcement commits despite wake failure', sql(f"SELECT count(*) FROM notifications WHERE announcement_id='{aid}';")=='1')
sql(f"SELECT delete_announcement_v1('{aid}');",1)
check('hard delete still removes only selected announcement', sql(f"SELECT NOT EXISTS(SELECT 1 FROM announcements WHERE id='{aid}') AND EXISTS(SELECT 1 FROM notifications WHERE id='{nid}');")=='t')
check('Daily remains OFF after tests', sql('SELECT NOT daily_summary_enabled FROM notification_schedule_config;')=='t')
print(json.dumps({'result':'PASS','checks':checks},indent=2))
