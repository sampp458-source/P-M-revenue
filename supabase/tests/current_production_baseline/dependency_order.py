"""Isolated 170003 prerequisite gate QA. No remote connection support or Production data.
Usage: python3 dependency_order.py /path/catalog.json /path/output
"""
import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('manifest', type=Path)
parser.add_argument('output', type=Path)
args = parser.parse_args()
here = Path(__file__).resolve().parent
root = here.parents[2]
pg = Path('/opt/homebrew/opt/postgresql@18/bin')
args.output.mkdir(parents=True, exist_ok=True)
cluster = None
results = {}
stop_error = 'STOP_DOG_STRUCTURED_TRACE_PROVENANCE_CLOSURE_MISSING_170002_DEPENDENCY'
paths = [root / 'supabase/migrations' / name for name in (
    '202609170002_dog_schedule_audit_trace_resolution.sql',
    '202609170003_dog_structured_trace_provenance_closure.sql',
    '202609180001_dog_profile_removal.sql')]
results['migrationHashes'] = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}
closure = paths[1].read_text()
start = closure.index('-- Fail before any DDL:')
end = closure.index('-- Journal provenance')
without_guard = closure[:start] + closure[end:]
assert hashlib.sha256(without_guard.encode()).hexdigest() == '82b59056773d9d0209f76ff112365e9cdfdb880d693d4bc95afde278628777f2'
results['onlyGuardAdded'] = True
catalog_sql = (here / 'catalog.sql').read_text().split('SELECT n AS chunk_number')[0] + 'SELECT catalog::text FROM manifest;\nROLLBACK;'

def process(command, label, text=None):
    result = subprocess.run([str(x) for x in command], input=text, text=True, capture_output=True)
    (args.output / (label + '.log')).write_text(result.stdout + result.stderr)
    return result

def sql(database, text, label):
    return process([pg / 'psql', '-X', '-qAt', '-h', cluster, '-p', '55509', '-U', 'postgres',
                    '-d', database, '-v', 'ON_ERROR_STOP=1'], label, text)

def catalog(database, label):
    result = sql(database, catalog_sql, label)
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)

def apply(database, path, label):
    result = sql(database, path.read_text(), label)
    assert result.returncode == 0, result.stderr

def clone(name):
    result = sql('postgres', f'CREATE DATABASE {name} TEMPLATE dog_current_baseline;', 'clone_' + name)
    assert result.returncode == 0, result.stderr

try:
    result = process([sys.executable, here / 'build.py', args.manifest, '--output', args.output / 'baseline'], 'build')
    assert result.returncode == 0
    baseline = json.loads((args.output / 'baseline/build-result.json').read_text())
    assert not baseline['alignmentMismatchCategories']
    cluster = Path(baseline['cluster'])
    result = process([pg / 'pg_ctl', '-D', cluster / 'data', '-l', cluster / 'server.log',
                      '-o', f"-h '' -k {cluster} -p 55509", 'start'], 'start')
    assert result.returncode == 0
    # Seed only the named local synthetic baseline before lifecycle constraints are added.
    apply('dog_current_baseline', here / 'seed.sql', 'seed')
    cases = {
        'missing': '',
        'wrong_signature': 'CREATE FUNCTION public.dog_schedule_audit_resolved_v2a(text,uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$ SELECT true $$;',
        'wrong_return': 'CREATE FUNCTION public.dog_schedule_audit_resolved_v2a(jsonb,uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$ SELECT \'fake\'::text $$;',
        'wrong_security': 'CREATE FUNCTION public.dog_schedule_audit_resolved_v2a(jsonb,uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path=public,pg_temp AS $$ SELECT true $$;',
        'wrong_search_path': 'CREATE FUNCTION public.dog_schedule_audit_resolved_v2a(jsonb,uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT true $$;',
    }
    for name, setup in cases.items():
        database = 'guard_' + name
        clone(database)
        if setup:
            assert sql(database, setup, name + '_setup').returncode == 0
        before = catalog(database, name + '_before')
        result = sql(database, closure, name + '_apply')
        assert result.returncode != 0 and stop_error in result.stderr, result.stdout + result.stderr
        after = catalog(database, name + '_after')
        assert before == after, name + ': catalog mutated'
        results[name] = {'status': 'PASS', 'migrationRejected': True, 'catalogMutation': 0, 'previewPreserved': True}
    apply('dog_current_baseline', paths[0], '170002')
    clone('guard_old_closure')
    result = sql('guard_old_closure', without_guard, 'old_closure_apply')
    assert result.returncode == 0, result.stderr
    apply('dog_current_baseline', paths[1], '170003')
    old = catalog('guard_old_closure', 'old_closure_catalog')
    new = catalog('dog_current_baseline', 'new_closure_catalog')
    # Dependency catalog order can depend on fresh OIDs; compare every actual object category.
    for key in ('relations', 'constraints', 'indexes', 'functions', 'triggers', 'policies', 'types', 'extensions'):
        assert old[key] == new[key], 'guard interference: ' + key
    results['correct_order'] = {'status': 'PASS', 'guardNonInterference': True}
    apply('dog_current_baseline', paths[2], '180001')
    results['full_order'] = {'status': 'PASS'}
    for name in ('schedule_audit_provenance', 'journal_provenance', 'shared_terminal', 'request_provenance',
                 'sales_completed_removal', 'removal_matrix', 'domain_removal', 'domain_removal_independent',
                 'lifecycle_negative', 'rollback_permission', 'domain_smoke', 'domain_extended'):
        result = sql('dog_current_baseline', (here / (name + '.sql')).read_text(), name)
        results[name] = {'status': 'PASS' if result.returncode == 0 else 'FAIL'}
except Exception as failure:
    results['failure'] = str(failure)
finally:
    if cluster:
        result = process([pg / 'pg_ctl', '-D', cluster / 'data', 'stop', '-m', 'fast'], 'stop')
        results['stop'] = {'status': 'PASS' if result.returncode == 0 else 'FAIL'}
    results['pass'] = 'failure' not in results and all(v.get('status') == 'PASS' for v in results.values() if isinstance(v, dict) and 'status' in v)
    (args.output / 'result.json').write_text(json.dumps(results, indent=2))
    print(json.dumps(results, indent=2))
raise SystemExit(0 if results['pass'] else 2)
