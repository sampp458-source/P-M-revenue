"""Local Unix socket only; use a catalog-aligned isolated baseline build report.
Never accepts a Production URL/DSN. Production catalog contains no business data.
"""
import argparse
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PG = Path('/opt/homebrew/opt/postgresql@18/bin')
p = argparse.ArgumentParser()
p.add_argument('--baseline', type=Path, required=True)
p.add_argument('--output', type=Path, required=True)
a = p.parse_args()
baseline = json.loads(a.baseline.read_text())
assert baseline['status'] == 'CATALOG_MATCH_ENVIRONMENT_REVIEW_REQUIRED'
assert baseline['alignmentMismatchCategories'] == []
cluster = Path(baseline['cluster'])
assert cluster.name.startswith('dog-current-baseline-') and (cluster/'data/PG_VERSION').exists()
a.output.mkdir(parents=True, exist_ok=True)
report = {'environmentDifferences': baseline['environmentDifferences'], 'matrix': []}

def command(args):
    r = subprocess.run([str(x) for x in args], text=True, capture_output=True)
    if r.returncode:
        raise RuntimeError(r.stderr)
    return r.stdout

def sql(source, variables=()):
    args = [PG/'psql', '-X', '-h', cluster, '-p', '55509', '-U', 'postgres', '-d', 'dog_current_baseline', '-v', 'ON_ERROR_STOP=1', '-At']
    for key, value in variables:
        args.extend(['-v', f'{key}={value}'])
    r = subprocess.run([str(x) for x in args], input=source, text=True, capture_output=True)
    with (a.output/'rpc-matrix.log').open('a') as log:
        log.write(r.stdout+r.stderr)
    if r.returncode:
        raise RuntimeError(r.stderr)
    return r.stdout

try:
    command([PG/'pg_ctl', '-D', cluster/'data', '-l', cluster/'server.log', '-o', f"-h '' -k {cluster} -p 55509", 'start'])
    sql((ROOT/'supabase/migrations/202609250001_hotel_physical_occupancy_v1.sql').read_text())
    # The historical seed's inactive-dog insertion predates the current Dog
    # lifecycle guard and is irrelevant here. Keep every active fixture intact.
    seed = (ROOT/'supabase/tests/current_production_baseline/seed.sql').read_text()
    sql(seed.split('-- Pre-V2-B inactive fixture;')[0] + '\nCOMMIT;')
    sql("""INSERT INTO auth.users(id,email,raw_user_meta_data)
    SELECT ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'member'||n||'@example.invalid',jsonb_build_object('name','Synthetic','phone','01000000'||n) FROM generate_series(901,908)n;
    UPDATE profiles SET account_status='active',is_active=true WHERE id::text LIKE '00000000-0000-4000-8000-00000000090%';
    UPDATE operation_memberships SET role=CASE WHEN profile_id::text LIKE '%901' THEN 'manager' ELSE 'staff' END WHERE profile_id<>'00000000-0000-4000-8000-000000000900';
    INSERT INTO hotel_rooms(id,room_type_id,name,sort_order,created_by,updated_by) VALUES('00000000-0000-4000-8000-000000000061','00000000-0000-4000-8000-000000000041','Synthetic Standard',1,'00000000-0000-4000-8000-000000000900','00000000-0000-4000-8000-000000000900');
    """)
    matrix = (ROOT/'supabase/tests/hotel_cross_staff_permission_v1_matrix.sql').read_text()
    uid = lambda n: f'00000000-0000-4000-8000-{n:012d}'
    try:
        sql(matrix, [('creator',uid(900)),('actor',uid(903))])
        raise AssertionError('Predecessor unexpectedly allowed unrelated staff')
    except RuntimeError as error:
        assert '호텔 예약 생성자 또는 담당자만 수정할 수 있습니다.' in str(error)
        report['beforeCrossStaffDenied'] = 'PASS'
    metadata = "SELECT oid::regprocedure::text,pg_get_function_result(oid),proowner,proacl,prosecdef,proconfig FROM pg_proc WHERE oid IN ('public.can_manage_operation_schedule(uuid)'::regprocedure,'public.cancel_shared_hotel_room_family_booking(uuid,integer,text,uuid)'::regprocedure) ORDER BY 1;"
    protected_catalog = """SELECT p.oid::regprocedure::text,md5(pg_get_functiondef(p.oid)),p.proowner,p.proacl
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.prokind='f' AND p.oid NOT IN ('public.can_manage_operation_schedule(uuid)'::regprocedure,'public.cancel_shared_hotel_room_family_booking(uuid,integer,text,uuid)'::regprocedure) ORDER BY 1;
      SELECT tgrelid::regclass,tgname,tgenabled,pg_get_triggerdef(oid) FROM pg_trigger WHERE NOT tgisinternal ORDER BY 1,2;
      SELECT schemaname,tablename,policyname,roles,cmd,qual,with_check FROM pg_policies WHERE schemaname='public' ORDER BY 1,2,3;"""
    before = sql(metadata)
    protected_before = sql(protected_catalog)
    sql((ROOT/'supabase/migrations/202609260001_hotel_cross_staff_operations_permission_v1.sql').read_text())
    assert sql(metadata) == before
    assert sql(protected_catalog) == protected_before
    report['publicMetadataPreservation'] = 'PASS'
    report['otherFunctionBodiesTriggersAndRlsPreserved'] = 'PASS'
    for creator, actor in [(900,900),(900,903),(901,903),(902,902),(902,903),(902,901),(902,900)]:
        sql(matrix,[('creator',uid(creator)),('actor',uid(actor))])
        report['matrix'].append({'creator':creator,'actor':actor,'result':'PASS'})
    sql((ROOT/'supabase/tests/hotel_cross_staff_permission_v1_negative.sql').read_text())
    report['negativeAndCalendar'] = 'PASS'
except Exception as error:
    report['error'] = str(error)
finally:
    if (cluster/'data/postmaster.pid').exists():
        command([PG/'pg_ctl','-D',cluster/'data','stop','-m','fast'])
    (a.output/'result.json').write_text(json.dumps(report,indent=2))
    print(json.dumps(report,indent=2))
raise SystemExit(1 if report.get('error') else 0)
