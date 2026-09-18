"""Isolated catalog-fixture QA; no remote DSN or Production writes.
Usage: python3 this.py CAPTURE.json --output /tmp/repair-qa [--pg-bin PATH]
Uses the existing current Production baseline builder, with synthetic rows only.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser()
parser.add_argument('manifest', type=Path)
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--pg-bin', type=Path, default=Path('/opt/homebrew/opt/postgresql@18/bin'))
a = parser.parse_args()
a.output.mkdir(parents=True, exist_ok=True)
subprocess.run(['python3', str(ROOT/'supabase/tests/current_production_baseline/build.py'), str(a.manifest),
                '--output', str(a.output/'baseline'), '--pg-bin', str(a.pg_bin)], check=True, capture_output=True)
report = json.loads((a.output/'baseline/build-result.json').read_text())
assert not report['alignmentMismatchCategories']
cluster = Path(report['cluster'])
repair_path = ROOT/'supabase/migrations/202609180002_dog_profile_v2b_utf8_audit_repair.sql'
repair = repair_path.read_text(encoding='utf-8')
original = (ROOT/'supabase/migrations/202609180001_dog_profile_removal.sql').read_text(encoding='utf-8')
exact = original[original.index('CREATE FUNCTION public.audit_dog_edit_v2b()'):original.index('CREATE TRIGGER dogs_master_audit_v2b')].strip().replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION', 1)
assert exact in repair
bad = exact.replace('Dog Master 정보 수정', 'Dog Master �뺣낫 �섏젙')
results = {}

def sql(text, db='dog_current_baseline', expected_error=None):
    result = subprocess.run([str(a.pg_bin/'psql'), '-X', '-qAt', '-h', str(cluster), '-p', '55509',
                             '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1'],
                            input=text, text=True, encoding='utf-8', capture_output=True)
    if expected_error:
        assert result.returncode and expected_error in result.stderr, (result.stdout, result.stderr)
    else:
        assert result.returncode == 0, result.stderr
    return result.stdout.strip()

capture = (ROOT/'supabase/tests/current_production_baseline/catalog.sql').read_text().split('SELECT n AS chunk_number')[0]
def catalog(db):
    return json.loads(sql(capture+'SELECT catalog FROM manifest; ROLLBACK;', db))

def data(db):
    names = [t['name'] for t in catalog(db)['relations']]
    statements = ["SELECT '"+t+"' t, coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text),'[]') j FROM public.\""+t+'" x' for t in names]
    return sql('SELECT jsonb_object_agg(t,j) FROM ('+' UNION ALL '.join(statements)+') x;', db)

def clone(name):
    sql('CREATE DATABASE '+name+' TEMPLATE dog_current_baseline;', 'postgres')
    return name

try:
    subprocess.run([str(a.pg_bin/'pg_ctl'), '-D', str(cluster/'data'), '-l', str(cluster/'server.log'),
                    '-o', f"-h '' -k {cluster} -p 55509", 'start'], check=True, capture_output=True)
    # The generic baseline builder may inherit SQL_ASCII from --no-locale.
    # Restore its exact empty catalog into a UTF8 database for encoding-sensitive QA.
    sql('ALTER DATABASE dog_current_baseline RENAME TO ascii_baseline;', 'postgres')
    sql("CREATE DATABASE dog_current_baseline TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C';", 'postgres')
    dump = subprocess.run([str(a.pg_bin/'pg_dump'), '-h', str(cluster), '-p', '55509', '-U', 'postgres',
                           '-d', 'ascii_baseline', '--encoding=UTF8'], check=True, capture_output=True, text=True)
    sql(dump.stdout)
    assert sql('SHOW server_encoding;') == 'UTF8'
    sql((ROOT/'supabase/tests/current_production_baseline/seed.sql').read_text())
    for prefix in ['202609170002', '202609170003', '202609180001']:
        sql(next((ROOT/'supabase/migrations').glob(prefix+'*')).read_text())
    approved = catalog('dog_current_baseline')
    db = clone('repair_a')
    sql(bad, db)
    before = data(db)
    before_catalog = catalog(db)
    sql(repair, db)
    after = catalog(db)
    for key in ['relations', 'constraints', 'indexes', 'triggers', 'policies', 'types']:
        assert before_catalog[key] == after[key], key
    assert after['functions'] == approved['functions']
    assert data(db) == before
    results['A_corrupted_repair_exact_all_objects_and_rows'] = 'PASS'
    xmin = sql("SELECT xmin FROM pg_proc WHERE oid='public.audit_dog_edit_v2b()'::regprocedure;", db)
    sql(repair, db)
    assert sql("SELECT xmin FROM pg_proc WHERE oid='public.audit_dog_edit_v2b()'::regprocedure;", db) == xmin
    assert catalog(db) == after and data(db) == before
    results['B_already_repaired_true_no_op'] = 'PASS'
    negatives = {
        'C_third_body': (exact.replace('Dog Master 정보 수정', 'Unexpected body'), 'UNEXPECTED_BODY'),
        'D_security': ('ALTER FUNCTION public.audit_dog_edit_v2b() SECURITY INVOKER;', 'METADATA'),
        'D_search_path': ('ALTER FUNCTION public.audit_dog_edit_v2b() SET search_path=public;', 'METADATA'),
        'D_signature': ('ALTER FUNCTION public.audit_dog_edit_v2b() RENAME TO wrong_audit;', 'SIGNATURE'),
        'D_return': ('ALTER FUNCTION public.audit_dog_edit_v2b() RENAME TO wrong_audit; CREATE FUNCTION public.audit_dog_edit_v2b() RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$;', 'METADATA'),
        'D_acl': ('GRANT EXECUTE ON FUNCTION public.audit_dog_edit_v2b() TO authenticated;', 'METADATA'),
        'D_owner': ('ALTER FUNCTION public.audit_dog_edit_v2b() OWNER TO authenticated;', 'METADATA'),
        'D_dependency': ('ALTER TABLE dogs RENAME COLUMN version TO wrong_version;', 'DEPENDENCY'),
    }
    for label, (setup, error) in negatives.items():
        neg = clone('repair_'+label.lower())
        sql(setup, neg)
        state, rows = catalog(neg), data(neg)
        sql(repair, neg, 'STOP_V2B_AUDIT_REPAIR_'+error)
        assert catalog(neg) == state and data(neg) == rows
        results[label+'_fails_without_mutation'] = 'PASS'
    # Deliberately corrupt the delivery of the repair itself: post assertion must roll back.
    neg = clone('repair_delivery')
    sql(bad, neg)
    state = catalog(neg)
    sql(repair.replace('Dog Master 정보 수정', 'Dog Master �뺣낫 �섏젙'), neg, 'POST_ASSERTION')
    assert catalog(neg) == state
    results['delivery_corruption_rolls_back'] = 'PASS'
    sql("""BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000900',true);
UPDATE dogs SET memo='Synthetic UTF8 repair QA' WHERE id='00000000-0000-4000-8000-000000000001';
DO $$ DECLARE p jsonb; j jsonb; BEGIN
 IF NOT EXISTS(SELECT 1 FROM entity_audit_events WHERE entity_type='dog'
   AND entity_id='00000000-0000-4000-8000-000000000001' AND change_reason='Dog Master 정보 수정') THEN
  RAISE EXCEPTION 'AUDIT_SENTINEL_FAILED'; END IF;
 j:=create_operation_schedule('00000000-0000-4000-8000-000000000022','00000000-0000-4000-8000-000000000030',
  'Synthetic completed history',now()-interval '3 days',now()-interval '3 days'+interval '1 hour',false,false,'Synthetic',
  ARRAY['00000000-0000-4000-8000-000000000900']::uuid[],ARRAY['00000000-0000-4000-8000-000000000800']::uuid[],
  ARRAY['00000000-0000-4000-8000-000000000001']::uuid[],gen_random_uuid());
 PERFORM set_operation_schedule_status((j->>'id')::uuid,(j->>'version')::integer,'completed','Synthetic',gen_random_uuid());
 p:=preview_dog_profile_removal('00000000-0000-4000-8000-000000000001');
 PERFORM remove_dog_profile('00000000-0000-4000-8000-000000000001',(p->>'version')::bigint,
   p->>'graphFingerprint','profile_remove',gen_random_uuid(),'Synthetic QA');
 BEGIN
  UPDATE dogs SET memo='must reject' WHERE id='00000000-0000-4000-8000-000000000001';
  RAISE EXCEPTION 'EDIT_WAS_NOT_BLOCKED';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'INVALID_PROFILE_STATE' THEN RAISE; END IF; END;
END $$;
ROLLBACK;""", db)
    assert data(db) == before
    results['E_exact_Korean_general_edit_audit'] = 'PASS'
    results['F_removed_edit_guard_preserved'] = 'PASS'
    # Existing full-domain removal matrix, on this repaired synthetic baseline, rolls back.
    sql(bad)
    sql(repair)
    sql((ROOT/'supabase/tests/current_production_baseline/removal_matrix.sql').read_text())
    results['existing_removal_matrix'] = 'PASS'
    result = {'status': 'PASS', 'cases': results, 'repairSha256': hashlib.sha256(repair_path.read_bytes()).hexdigest(),
              'approvedBodyMd5': '01674a5ddc93c5467543d0f13e35aa92',
              'baselineEnvironment': report['environmentDifferences'], 'productionMutation': 0}
    (a.output/'result.json').write_text(json.dumps(result, indent=2)+'\n')
    print(json.dumps(result, indent=2))
finally:
    subprocess.run([str(a.pg_bin/'pg_ctl'), '-D', str(cluster/'data'), 'stop', '-m', 'fast'], capture_output=True)
