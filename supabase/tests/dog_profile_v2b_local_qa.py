"""Isolated Unix-socket PostgreSQL only. Never accepts a URL/Production connection.
Usage: python3 .../dog_profile_v2b_local_qa.py /path/to/pg/bin
Creates a disposable cluster outside the repository and always stops it.
"""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[2]
PG = Path(sys.argv[1])
TEMP = Path(tempfile.mkdtemp(prefix='dog-v2b-local-'))
DB = 'dog_v2a_fixture'

def command(args, **kwargs):
    return subprocess.run([str(a) for a in args], check=True, text=True, capture_output=True, **kwargs)

def sql(text, db=None, fail=False):
    args = [PG/'psql', '-h', TEMP, '-p', '55498', '-d', db or DB, '-v', 'ON_ERROR_STOP=1', '-At']
    result = subprocess.run([str(a) for a in args], input=text, text=True, capture_output=True)
    if not fail and result.returncode:
        raise RuntimeError(result.stderr)
    return result

def file(path):
    result = sql((ROOT/path).read_text())
    (TEMP/Path(path).name).write_text(result.stdout)

try:
    command([PG/'initdb', '-D', TEMP/'data', '--auth=trust', '--no-locale'])
    command([PG/'pg_ctl','-D',TEMP/'data','-l',TEMP/'server.log','-o',f"-k {TEMP} -p 55498 -h ''",'start'])
    sql('CREATE DATABASE dog_v2a_fixture;', 'postgres')
    file('supabase/tests/dog_profile_v2a_fixture.sql')
    file('supabase/migrations/202609170001_dog_historical_identity_preview.sql')
    sql('ALTER DATABASE dog_v2a_fixture RENAME TO dog_v2b_fixture;', 'postgres')
    DB = 'dog_v2b_fixture'
    # Inactive unused fixture is created before lifecycle protection, never through a bypass.
    sql("INSERT INTO dogs VALUES(fixture_id(21),'Inactive unused',fixture_id(800),false,NULL,NULL);")
    file('supabase/tests/dog_profile_v2b_fixture_extensions.sql')
    file('supabase/migrations/202609170002_dog_schedule_audit_trace_resolution.sql')
    file('supabase/migrations/202609170003_dog_structured_trace_provenance_closure.sql')
    file('supabase/migrations/202609180001_dog_profile_removal.sql')
    file('supabase/tests/dog_profile_v2b_write.sql')
    file('supabase/tests/dog_profile_v2b_rollback.sql')
    # The original sales assertions run unchanged except local DB name and explicit columns
    # needed by the appended schema. No classifier assertion is relaxed.
    sales=(ROOT/'supabase/tests/dog_profile_v2a_sales.sql').read_text().replace("current_database()='dog_v2a_fixture'", "current_database()='dog_v2b_fixture'").replace('INSERT INTO dogs SELECT','INSERT INTO dogs(id,name,customer_id,is_active,breed,sex) SELECT')
    sql(sales)
    auth="SET LOCAL request.jwt.claim.sub='00000000-0000-4000-8000-000000000900'; SET LOCAL ROLE authenticated;"
    remove="SELECT remove_dog_profile(fixture_id(2),1,preview_dog_profile_removal(fixture_id(2))->>'graphFingerprint','profile_remove',fixture_id(2002));"
    # Committed two-session matrix. Each case gets a fresh database clone.
    sql("INSERT INTO dogs(id,name,customer_id,is_active) SELECT fixture_id(n),'Matrix '||n,fixture_id(800),true FROM generate_series(31,33) n;")
    file('supabase/tests/dog_profile_v2b_guard_integration.sql')
    base_db=DB
    results={}
    def remove_dog(n, request=3001):
        return auth+f"SELECT remove_dog_profile(fixture_id({n}),1,preview_dog_profile_removal(fixture_id({n}))->>'graphFingerprint','hard_delete',fixture_id({request}));"
    def relation(domain,n):
        if domain=='schedule': return f"INSERT INTO operation_schedule_dogs VALUES(fixture_id(3031),fixture_id({n}),fixture_id(102),NULL);"
        if domain=='hotel': return f"INSERT INTO hotel_stays VALUES(fixture_id(3031),fixture_id({n}),NULL,NULL,NULL);"
        if domain=='sales': return f"INSERT INTO sales VALUES(fixture_id(3031),fixture_id({n}),'normal',0,'2026-09-18');"
        if domain=='journal': return f"INSERT INTO journal_entries VALUES(fixture_id(3031),fixture_id({n}),NULL,fixture_id(700),'in_progress');"
    cases=[]
    for index,domain in enumerate(['schedule','hotel','sales','journal']):
        cases.extend([(chr(65+index*2),remove_dog(31),relation(domain,31),True),
                      (chr(66+index*2),remove_dog(31),relation(domain,32),False),
                      ('reverse_'+domain,relation(domain,31),remove_dog(31),True)])
    cases.extend([('I',remove_dog(31),remove_dog(31,3002),True),
                  ('J',remove_dog(31),remove_dog(32,3002),False),
                  ('K',remove_dog(31),"INSERT INTO family_bookings VALUES(fixture_id(3031),'pending',NULL,jsonb_build_object('dogIds',jsonb_build_array(fixture_id(32),fixture_id(31))));",True),
                  ('L',remove_dog(31),"INSERT INTO family_bookings VALUES(fixture_id(3031),'pending',NULL,jsonb_build_object('dogIds',jsonb_build_array(fixture_id(33),fixture_id(32))));",False)])
    for name,first,second,blocked in cases:
        DB='matrix_'+name.lower()
        sql(f'CREATE DATABASE {DB} TEMPLATE {base_db};','postgres')
        args=[str(PG/'psql'),'-h',str(TEMP),'-p','55498','-d',DB,'-v','ON_ERROR_STOP=1','-At']
        with subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True) as holder:
            holder.stdin.write("BEGIN; SET LOCAL statement_timeout='5s';"+first+"\n\\echo LOCK_READY\n");holder.stdin.flush()
            while True:
                line=holder.stdout.readline()
                if 'LOCK_READY' in line: break
                if not line: raise RuntimeError((name,holder.stderr.read()))
            result=sql("BEGIN; SET LOCAL statement_timeout='3s';"+second+'COMMIT;',fail=True)
            if blocked: assert result.returncode and 'DOG_BUSY' in result.stderr,(name,result.stdout,result.stderr)
            else: assert result.returncode==0,(name,result.stdout,result.stderr)
            assert 'deadlock detected' not in result.stderr
            holder.stdin.write('COMMIT;\n\\q\n');holder.stdin.flush();holder.wait(timeout=10)
            assert holder.returncode==0,(name,holder.stderr.read())
        if first.startswith(auth):
            assert sql('SELECT count(*) FROM dogs WHERE id=fixture_id(31);').stdout.strip()=='0'
        else:
            assert sql('SELECT count(*) FROM dogs WHERE id=fixture_id(31);').stdout.strip()=='1'
        results[name]='SAFE_REJECT' if blocked else 'BOTH_COMMITTED'
        sql(f'DROP DATABASE {DB};','postgres')
    DB=base_db
    # Same request waits for receipt commit, then replays after physical deletion.
    sql(f'CREATE DATABASE matrix_replay TEMPLATE {base_db};','postgres');DB='matrix_replay'
    args=[str(PG/'psql'),'-h',str(TEMP),'-p','55498','-d',DB,'-v','ON_ERROR_STOP=1','-At']
    fingerprint=sql(auth.replace('SET LOCAL','SET')+"SELECT preview_dog_profile_removal(fixture_id(31))->>'graphFingerprint';").stdout.strip().splitlines()[-1]
    replay=auth+f"SELECT remove_dog_profile(fixture_id(31),1,'{fingerprint}','hard_delete',fixture_id(3001));"
    with subprocess.Popen(args,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True) as holder:
        holder.stdin.write('BEGIN;'+replay+'\n\\echo LOCK_READY\n');holder.stdin.flush()
        while 'LOCK_READY' not in holder.stdout.readline():
            if holder.poll() is not None: raise RuntimeError(holder.stderr.read())
        contender=subprocess.Popen(args,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        contender.stdin.write("BEGIN; SET LOCAL statement_timeout='5s';"+replay+'COMMIT;\n\\q\n');contender.stdin.flush()
        time.sleep(.15)
        assert contender.poll() is None,'replay did not wait for request owner'
        holder.stdin.write('COMMIT;\n\\q\n');holder.stdin.flush();holder.wait(timeout=10)
        out,err=contender.communicate(timeout=10);assert contender.returncode==0,err
        assert sql('SELECT count(*) FROM dog_profile_removal_receipts;').stdout.strip()=='1'
    results['I_same_request']='REPLAY_AFTER_COMMIT'
    sql('DROP DATABASE matrix_replay;','postgres');DB=base_db
    (TEMP/'concurrency-matrix.json').write_text(json.dumps(results,indent=2))
    sql("BEGIN;"+auth+"SELECT remove_dog_profile(fixture_id(21),1,preview_dog_profile_removal(fixture_id(21))->>'graphFingerprint','hard_delete',fixture_id(2021)); ROLLBACK;")
    # Bounded local scaling probe: identical one-dog payload with 23 vs 1,023 master rows.
    benchmark="DO $$ BEGIN FOR i IN 1..100 LOOP PERFORM dog_relation_identities_v2b('sales'::regclass,jsonb_build_object('dog_id',fixture_id(31))); END LOOP; END $$;"
    start=time.perf_counter();sql(benchmark);small_ms=(time.perf_counter()-start)*1000
    sql("INSERT INTO dogs(id,name,customer_id,is_active) SELECT fixture_id(n),'Scale fixture',fixture_id(800),true FROM generate_series(10000,10999) n; ANALYZE dogs;")
    start=time.perf_counter();sql(benchmark);large_ms=(time.perf_counter()-start)*1000
    plan=sql("EXPLAIN (ANALYZE,BUFFERS) SELECT profile_status FROM dogs WHERE id=fixture_id(31) FOR KEY SHARE NOWAIT;").stdout
    assert 'Index Scan' in plan,plan
    (TEMP/'dog-pk-plan.txt').write_text(plan)
    perf={'probe_100_calls_before_ms':round(small_ms,2),'probe_100_calls_plus_1000_dogs_ms':round(large_ms,2),'dog_lookup':'INDEX_SCAN','includes_psql_startup':True}
    (TEMP/'performance.json').write_text(json.dumps(perf,indent=2))
    print(json.dumps({'sql_isolation':'PASS','sales_provenance_regression':'PASS','permission':'PASS','rollback':'PASS','concurrency_matrix':results,'inactive_unused':'PASS','synthetic_domain_guard':'PASS','performance':perf,'logs':str(TEMP)}))
finally:
    if (TEMP/'data'/'postmaster.pid').exists():
        command([PG/'pg_ctl','-D',TEMP/'data','stop','-m','fast'])
