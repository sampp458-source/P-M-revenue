"""Strict local baseline replay. Never rewrites/waives existing migration assertions.
Usage: python3 dog_profile_v2b_full_chain_probe.py PG_BIN [LEGACY_MIGRATIONS_DIR]
The optional legacy directory supplies missing historical files, never Production data.
An unresolved baseline intentionally returns exit 2 before any V2-B integration claim.
"""
from pathlib import Path
import hashlib
import json
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
PG = Path(sys.argv[1])
LEGACY = Path(sys.argv[2]) if len(sys.argv) > 2 else None
TEMP = Path(tempfile.mkdtemp(prefix='v2b-full-chain-'))
report = {'status': 'BLOCKED', 'applied': [], 'supplemental_sources': [], 'v2b_applied': False}

def run(args, **kw):
    return subprocess.run([str(x) for x in args], text=True, capture_output=True, **kw)

def sql(body, db='dog_v2b_full'):
    r = run([PG/'psql', '-h', TEMP, '-p', '55499', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-At'], input=body)
    if r.returncode:
        raise RuntimeError(r.stderr)
    return r.stdout

def apply(path, supplemental=False):
    report['at_file'] = path.name
    if not path.exists():
        raise RuntimeError('MISSING_BASELINE_FILE: '+str(path))
    body = path.read_bytes()
    if supplemental:
        report['supplemental_sources'].append({'path': str(path), 'sha256': hashlib.sha256(body).hexdigest()})
    sql(body.decode())
    report['applied'].append(path.name)

def existing(name):
    p = ROOT/'supabase/migrations'/name
    return p if p.exists() or LEGACY is None else LEGACY/name

try:
    r = run([PG/'initdb', '-D', TEMP/'data', '--auth=trust', '--username=postgres', '--no-locale'])
    if r.returncode: raise RuntimeError(r.stderr)
    r = run([PG/'pg_ctl', '-D', TEMP/'data', '-l', TEMP/'server.log', '-o', f"-k {TEMP} -p 55499 -h ''", 'start'])
    if r.returncode: raise RuntimeError(r.stderr)
    sql('CREATE DATABASE dog_v2b_full;', 'postgres')
    sql("""CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_user_meta_data jsonb DEFAULT '{}',created_at timestamptz DEFAULT now());
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    GRANT USAGE ON SCHEMA public,auth TO authenticated,anon,service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO authenticated,service_role;""")
    repairs = ['202608040003_hotel_update_lock_order_repair.sql', '202608040004_hotel_reverse_completion_lock_order_repair.sql']
    for p in sorted((ROOT/'supabase/migrations').glob('*.sql')):
        if p.name.startswith('202609180001'): break
        if p.name in repairs: continue
        if p.name == '202608020002_hotel_operations_workflows.sql':
            sql("""INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES('00000000-0000-4000-8000-000000000900','local@example.invalid',jsonb_build_object('phone','01000000000','name','Local QA'));
            UPDATE profiles SET role='admin',account_status='active' WHERE id='00000000-0000-4000-8000-000000000900';
            UPDATE operation_memberships SET role='owner',is_active=true WHERE profile_id='00000000-0000-4000-8000-000000000900';""")
            apply(existing('202608020001_hotel_operations_foundation.sql'), True)
        if p.name == '202608040002_hotel_flexible_reservations.sql':
            # Flexible explicitly requires the earlier repair despite filename order.
            for name in ['202608020003_operations_hotel_contract_gap_repair.sql', '202608020004_hotel_snapshot_frontend_contract.sql'] + repairs:
                q = existing(name)
                apply(q, q.parent != ROOT/'supabase/migrations')
        apply(p)
        if p.name == '202607120001_initial_schema.sql':
            sql("INSERT INTO business_units(code,name,sort_order) VALUES('hotel','호텔',1),('daycare','유치원',2),('training','교육',3);")
    report['status'] = 'BASELINE_REPLAY_PASS_DOMAIN_QA_STILL_REQUIRED'
except Exception as failure:
    report['error'] = str(failure)
finally:
    if (TEMP/'data/postmaster.pid').exists():
        run([PG/'pg_ctl', '-D', TEMP/'data', 'stop', '-m', 'fast'])
    (TEMP/'result.json').write_text(json.dumps(report, indent=2))
    print(json.dumps({**report, 'evidence': str(TEMP/'result.json')}, indent=2))
sys.exit(2 if report['status'] == 'BLOCKED' else 0)
