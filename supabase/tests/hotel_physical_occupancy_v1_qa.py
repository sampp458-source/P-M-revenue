"""Unix-socket-only bounded Hotel fixture, never a Production DSN.
Uses existing 016 synthetic schema plus verbatim repository function definitions.
This is NOT a full current-Production catalog/ACL/RLS alignment claim.
"""
import argparse
import json
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
PG = Path('/opt/homebrew/opt/postgresql@18/bin')
p = argparse.ArgumentParser()
p.add_argument('--output', type=Path, required=True)
a = p.parse_args()
a.output.mkdir(parents=True, exist_ok=True)
cluster = Path(tempfile.mkdtemp(prefix='hotel-physical-qa-'))
report = {'baseline': 'bounded 016 synthetic fixture; auth/catalog boundary not Production-equivalent', 'cluster': str(cluster)}

def run(args, **kw):
    result = subprocess.run([str(x) for x in args], capture_output=True, text=True, **kw)
    if result.returncode:
        raise RuntimeError(result.stderr[-6000:])
    return result.stdout


def sql(source):
    result = subprocess.run([str(PG/'psql'), '-X', '-h', str(cluster), '-p', '55519', '-U', 'postgres', '-d', 'single_checkin_fixture_016', '-v', 'ON_ERROR_STOP=1'], input=source, capture_output=True, text=True)
    with (a.output/'sql.log').open('a') as log:
        log.write(result.stdout + result.stderr)
    if result.returncode:
        raise RuntimeError(result.stderr[-6000:])
    return result.stdout


def function(file, name):
    source = (ROOT/'supabase/migrations'/file).read_text()
    import re
    match = re.search(r'create (?:or replace )?function public\.'+name+r'\(', source, re.I)
    assert match, name
    end = source.index('$$;', source.index('as $$', match.start()))+3
    return source[match.start():end]

try:
    run([PG/'initdb', '-D', cluster/'data', '--auth=trust', '--username=postgres', '--no-locale', '--encoding=UTF8'])
    run([PG/'pg_ctl', '-D', cluster/'data', '-l', cluster/'server.log', '-o', f"-h '' -k {cluster} -p 55519", 'start'])
    run([PG/'createdb', '-h', cluster, '-p', '55519', '-U', 'postgres', 'single_checkin_fixture_016'])
    sql((ROOT/'supabase/verification/202609110001_hotel_single_actual_check_in_fixture_setup.sql').read_text())
    sql('''create table daycare_operation_states(operation_schedule_id uuid,lifecycle_status text);
      alter table hotel_room_types add sort_order integer default 0;
      create table family_bookings(id uuid,customer_id uuid,archived_at timestamptz);
    ''')
    sql('''create table hotel_operation_settings(id uuid, singleton_key text, version integer, default_check_in_time time, default_check_out_time time, timezone text, created_at timestamptz, archived_at timestamptz);''')
    for name in ['get_hotel_operations_snapshot_v2', 'assert_hotel_total_capacity_available']:
        sql(function('202608040002_hotel_flexible_reservations.sql', name))
    sql(function('202609010001_hotel_unassigned_shared_room_backend_append.sql', 'assert_hotel_capacity_available'))
    for name in ['shared_hotel_payload_hash', 'claim_shared_hotel_request_internal', 'finish_shared_hotel_request_internal', 'shared_hotel_occupancy_json_internal', 'get_hotel_shared_room_occupancies', 'assert_shared_hotel_occupancy_internal', 'complete_shared_hotel_member_check_out']:
        sql(function('202608110001_multi_dog_shared_room.sql', name))
    sql((ROOT/'supabase/migrations/202609110001_hotel_single_actual_check_in.sql').read_text())
    sql((ROOT/'supabase/tests/hotel_physical_occupancy_v1_predecessor.sql').read_text())
    metadata_query = """SELECT jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'return',pg_get_function_result(p.oid),'security',p.prosecdef,'config',p.proconfig,'owner',p.proowner::regrole::text,'acl',p.proacl) ORDER BY p.oid::regprocedure::text) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN('get_hotel_operations_snapshot','get_hotel_operations_snapshot_v2','get_hotel_shared_room_occupancies','complete_hotel_check_out','complete_shared_hotel_member_check_out','hotel_single_room_eligibility_internal');"""
    before_metadata = sql(metadata_query)
    sql((ROOT/'supabase/migrations/202609250001_hotel_physical_occupancy_v1.sql').read_text())
    assert sql(metadata_query) == before_metadata, 'signature/security/search_path/owner/ACL changed'
    report['existingRpcMetadataPreserved'] = 'PASS'
    report['migrationApply'] = 'PASS'
    sql((ROOT/'supabase/tests/hotel_physical_occupancy_v1_qa.sql').read_text())
    report['core'] = 'PASS'
    sql((ROOT/'supabase/tests/hotel_physical_occupancy_v1_shared_qa.sql').read_text())
    report['shared'] = 'PASS'
    sql((ROOT/'supabase/tests/hotel_physical_occupancy_v1_cutover_qa.sql').read_text())
    report['cutoverAndLegacySingle'] = 'PASS'
    shared_case = (ROOT/'supabase/tests/hotel_physical_occupancy_v1_shared_qa.sql').read_text()
    legacy_case = shared_case.replace("now()-interval '3 hours'", "timestamptz '2026-09-21 13:00+09'").replace("now()-interval '1 hour'", "timestamptz '2026-09-25 20:00+09'")
    legacy_case = legacy_case.replace("SET checked_in_at=timestamptz '2026-09-21 13:00+09'", "SET checked_in_at=timestamptz '2026-09-21 15:44+09'")
    legacy_case = legacy_case.replace("count(distinct room_id)=1 AND count(*)=2", "count(*)=0").replace("count(*)=1 FROM hotel_current_physical_rooms_internal()", "count(*)=0 FROM hotel_current_physical_rooms_internal()")
    legacy_case = legacy_case.replace("'J Shared two dogs one room'", "'A legacy Shared does not inherit a physical hold'").replace("'J real member checkout retains room'", "'legacy first member leaves occupancy active without new physical hold'")
    # Reproduce current Production's last-member late-checkout failure locally, then restore only candidate function.
    import re
    predecessor = (ROOT/'supabase/tests/hotel_physical_occupancy_v1_predecessor.sql').read_text()
    old_shared = re.search(r'CREATE OR REPLACE FUNCTION public.complete_shared_hotel_member_check_out[\s\S]*?\$function\$\s*;', predecessor).group(0)
    sql(old_shared)
    try:
        sql(legacy_case)
        raise AssertionError('Production predecessor unexpectedly accepted late last-member checkout')
    except RuntimeError as failure:
        assert '호실 배정 기간은 Capacity 예약 기간 안이어야 합니다.' in str(failure), str(failure)
    report['productionSharedFailureReproduced'] = 'PASS: capacity-bound 22023; transaction rolled back'
    sql(function('202609250001_hotel_physical_occupancy_v1.sql','complete_shared_hotel_member_check_out'))
    sql(legacy_case)
    report['todayLegacySharedShape'] = 'PASS: both normal member checkout RPCs succeed; last releases group'
    from hotel_physical_occupancy_v1_concurrency import verify
    report['concurrency'] = verify(PG, cluster, ROOT)
except Exception as error:
    report['error'] = str(error)
finally:
    if (cluster/'data/postmaster.pid').exists():
        run([PG/'pg_ctl', '-D', cluster/'data', 'stop', '-m', 'fast'])
    (a.output/'result.json').write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))
raise SystemExit(1 if report.get('error') else 0)
