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
p.add_argument('--evidence-dir', type=Path)
a = p.parse_args()
a.output.mkdir(parents=True, exist_ok=True)
(a.output/'sql.log').write_text('')
cluster = Path(tempfile.mkdtemp(prefix='hotel-carryover-qa-'))
report = {'baseline': 'bounded 016 synthetic fixture; auth/catalog boundary not Production-equivalent', 'cluster': str(cluster)}

def run(args, **kw):
    result = subprocess.run([str(x) for x in args], capture_output=True, text=True, **kw)
    if result.returncode:
        raise RuntimeError(result.stderr[-6000:])
    return result.stdout


def sql(source):
    result = subprocess.run([str(PG/'psql'), '-X', '-h', str(cluster), '-p', '55549', '-U', 'postgres', '-d', 'single_checkin_fixture_016', '-v', 'ON_ERROR_STOP=1'], input=source, capture_output=True, text=True)
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
    body = re.search(r'as\s+(\$[A-Za-z_]*\$)', source[match.start():], re.I)
    assert body, name
    body_start = match.start()+body.end()
    closing = re.search(re.escape(body[1])+r'\s*;', source[body_start:])
    assert closing, name
    end = body_start+closing.end()
    return source[match.start():end]

try:
    run([PG/'initdb', '-D', cluster/'data', '--auth=trust', '--username=postgres', '--no-locale', '--encoding=UTF8'])
    run([PG/'pg_ctl', '-D', cluster/'data', '-l', cluster/'server.log', '-o', f"-h '' -k {cluster} -p 55549", 'start'])
    run([PG/'createdb', '-h', cluster, '-p', '55549', '-U', 'postgres', 'single_checkin_fixture_016'])
    sql((ROOT/'supabase/verification/202609110001_hotel_single_actual_check_in_fixture_setup.sql').read_text())
    sql('''create table daycare_operation_states(operation_schedule_id uuid,lifecycle_status text);
      alter table hotel_room_types add sort_order integer default 0;
      create table family_bookings(id uuid,customer_id uuid,archived_at timestamptz);
    ''')
    sql('''create table hotel_operation_settings(id uuid, singleton_key text, version integer, default_check_in_time time, default_check_out_time time, timezone text, created_at timestamptz, archived_at timestamptz);''')
    for name in ['assert_hotel_total_capacity_available']:
        sql(function('202608040002_hotel_flexible_reservations.sql', name))
    sql(function('202609010001_hotel_unassigned_shared_room_backend_append.sql', 'assert_hotel_capacity_available'))
    for name in ['shared_hotel_payload_hash', 'claim_shared_hotel_request_internal', 'finish_shared_hotel_request_internal', 'shared_hotel_occupancy_json_internal', 'get_hotel_shared_room_occupancies', 'assert_shared_hotel_occupancy_internal', 'complete_shared_hotel_member_check_out', 'reverse_shared_hotel_member_completion']:
        sql(function('202608110001_multi_dog_shared_room.sql', name))
    sql((ROOT/'supabase/migrations/202609110001_hotel_single_actual_check_in.sql').read_text())
    sql((ROOT/'supabase/tests/hotel_physical_occupancy_v1_predecessor.sql').read_text())
    for name in ['hotel_shared_semantic_internal', 'hotel_shared_chain_internal']:
        sql(function('202609090001_shared_hotel_historical_provenance.sql', name))
    sql((ROOT/'supabase/migrations/202609250001_hotel_physical_occupancy_v1.sql').read_text())
    sql("""ALTER TABLE long_stay_contracts ADD status text, ADD archived_at timestamptz;
    ALTER TABLE long_stay_absence_events ADD event_type text, ADD long_stay_contract_id uuid,
      ADD paired_leave_event_id uuid, ADD inventory_mode text, ADD is_open boolean,
      ADD occurred_at timestamptz, ADD archived_at timestamptz,
      ADD returned_allocation_id uuid, ADD return_capacity_id uuid, ADD returned_room_id uuid,
      ADD inventory_transition_status text;
    ALTER TABLE entity_audit_events ALTER id SET DEFAULT gen_random_uuid(), ALTER created_at SET DEFAULT now();
    """)
    sql(function('202608020002_hotel_operations_workflows.sql','reassign_hotel_room_before_check_in'))
    sql(function('202608040004_hotel_reverse_completion_lock_order_repair.sql','reverse_hotel_completion'))
    # Replay the exact authorization-only replacement from the 202609080003
    # allowlist for the two reversal functions. Local auth is the existing fixture
    # role stub; function-body hashes below match the READ ONLY Production catalog.
    sql("CREATE FUNCTION can_operate_hotel() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT has_operation_role(ARRAY['owner','manager','staff']) $$;")
    for filename, name, fingerprint in [
        ('202608040004_hotel_reverse_completion_lock_order_repair.sql','reverse_hotel_completion','98ad764ce3b12bc5f87ba1dfba8169b2'),
        ('202608110001_multi_dog_shared_room.sql','reverse_shared_hotel_member_completion','e2517aeecb9bd485dbeaed34049ecd99')]:
        import re
        definition = function(filename,name)
        definition = re.sub(r"public\.has_operation_role\s*\(\s*array\s*\[\s*'owner'\s*,\s*'manager'\s*\]\s*\)", 'public.can_operate_hotel()', definition, flags=re.I)
        definition = re.sub(r'create (?:or replace )?function', 'CREATE OR REPLACE FUNCTION', definition, count=1, flags=re.I)
        sql(definition)
        sql(f"DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='{name}' AND md5(prosrc)='{fingerprint}') THEN RAISE EXCEPTION 'REVERSAL_PRODUCTION_BODY_MISMATCH'; END IF; END $$;")
    report['reversalProductionBodyMatch'] = '2/2 PASS; local auth stub is not a Production permission test'
    # Current public read path, not the 20260804 v2 substitute. The old v2
    # predecessor is absent from this bounded foundation, so extract exact current
    # function definitions instead of bypassing an historical migration guard.
    sql("ALTER TABLE dogs ADD customer_id uuid; CREATE TABLE customers(id uuid,name text);")
    sql(function('202609010002_hotel_unassigned_shared_room_read_contract.sql','get_unassigned_shared_hotel_room_groups'))
    sql(function('202609280001_hotel_selected_date_unassigned_v1.sql','hotel_selected_date_unassigned_internal'))
    sql(function('202609280001_hotel_selected_date_unassigned_v1.sql','get_hotel_operations_snapshot_v2'))
    sql("REVOKE ALL ON FUNCTION hotel_selected_date_unassigned_internal(date) FROM PUBLIC,anon,authenticated,service_role; REVOKE ALL ON FUNCTION get_hotel_operations_snapshot_v2(date), get_unassigned_shared_hotel_room_groups(date) FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION get_hotel_operations_snapshot_v2(date), get_unassigned_shared_hotel_room_groups(date) TO authenticated,service_role;")
    sql("DO $$ BEGIN IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='get_hotel_operations_snapshot_v2(date)'::regprocedure)<>'56b2afa3112502405d1fc7cdb4ccddfe' OR (SELECT md5(prosrc) FROM pg_proc WHERE oid='hotel_selected_date_unassigned_internal(date)'::regprocedure)<>'4726fbb8e6f41bffd5c5c9182a2774aa' OR (SELECT md5(prosrc) FROM pg_proc WHERE oid='get_unassigned_shared_hotel_room_groups(date)'::regprocedure)<>'760e1d7cca31bfa3f9803c15c210ea4c' THEN RAISE EXCEPTION 'CURRENT_V2_BODY_DRIFT'; END IF; END $$;")
    report['currentV2ProductionBodies'] = '3/3 exact MD5 match; definitions extracted, not historical full replay'
    # Retrieve machine-readable definitions without psql table decorations.
    old_base = function('202609250001_hotel_physical_occupancy_v1.sql','get_hotel_operations_snapshot')
    sql(old_base.replace('public.get_hotel_operations_snapshot(', 'public.qa_old_base_snapshot(', 1))
    old_v2 = function('202609280001_hotel_selected_date_unassigned_v1.sql','get_hotel_operations_snapshot_v2')
    sql(old_v2.replace('public.get_hotel_operations_snapshot_v2(', 'public.qa_old_snapshot_v2(', 1).replace('public.get_hotel_operations_snapshot(p_local_date)', 'public.qa_old_base_snapshot(p_local_date)'))

    metadata = "SELECT jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'return',pg_get_function_result(p.oid),'owner',p.proowner::regrole::text,'acl',p.proacl,'security',p.prosecdef,'config',p.proconfig,'volatility',p.provolatile) ORDER BY p.oid::regprocedure::text) FROM pg_proc p WHERE p.oid IN('hotel_current_physical_rooms_internal()'::regprocedure,'get_hotel_operations_snapshot(date)'::regprocedure,'get_hotel_operations_snapshot_v2(date)'::regprocedure,'hotel_selected_date_unassigned_internal(date)'::regprocedure,'get_unassigned_shared_hotel_room_groups(date)'::regprocedure);"
    # Deliberate local predecessor drift must fail before any candidate DDL.
    candidate = (ROOT/'supabase/migrations/202609280002_hotel_legacy_physical_carryover_v1.sql').read_text()
    guard = candidate[candidate.index('DO $$'):candidate.index('END $$;')+len('END $$;')]
    for signature in [
        'get_hotel_operations_snapshot_v2(date)',
        'hotel_selected_date_unassigned_internal(date)',
        'get_unassigned_shared_hotel_room_groups(date)',
        'reverse_hotel_completion(uuid,integer,text,text,uuid)',
        'reverse_shared_hotel_member_completion(uuid,uuid,integer,integer,text,uuid)']:
        sql("BEGIN; DO $drift$ DECLARE d text; b text; BEGIN SELECT pg_get_functiondef(oid),prosrc INTO d,b FROM pg_proc WHERE oid='"+signature+"'::regprocedure; EXECUTE replace(d,b,b||chr(10)||'-- local drift probe'); END $drift$; "
            + "DO $probe$ BEGIN BEGIN EXECUTE $guard$"+guard+"$guard$; RAISE EXCEPTION 'DRIFT_ACCEPTED'; EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'STOP_LEGACY_CARRYOVER_PREDECESSOR_MISMATCH' THEN RAISE; END IF; END; END $probe$; ROLLBACK;")
    report['newDependencyDriftGuards'] = '5/5 rejected; local transaction rollback'
    before_metadata = sql(metadata)
    sql((ROOT/'supabase/migrations/202609280002_hotel_legacy_physical_carryover_v1.sql').read_text())
    assert sql(metadata) == before_metadata, 'Existing signature/owner/ACL/security metadata changed'
    report['existingMetadataPreserved'] = 'PASS'
    sql("""DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_proc p WHERE p.proname IN('hotel_physical_cutover_row_internal','hotel_legacy_physical_anchors_internal','hotel_physical_allocation_successor_internal','hotel_legacy_current_physical_rooms_internal','guard_hotel_legacy_physical_reentry_internal') AND (has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE') OR has_function_privilege('service_role',p.oid,'EXECUTE'))) THEN RAISE EXCEPTION 'PRIVATE_HELPER_EXPOSED'; END IF; END $$;""")
    report['privateHelperSecurity'] = 'PASS'

    report['candidateApply'] = 'PASS'
    sql((ROOT/'supabase/tests/hotel_legacy_physical_carryover_v1_qa.sql').read_text())
    report['contracts'] = 'PASS'
    sql((ROOT/'supabase/tests/hotel_physical_occupancy_v1_qa.sql').read_text())
    report['nativeCommandsAndFutureCapacity'] = 'PASS'
    sql((ROOT/'supabase/tests/hotel_physical_occupancy_v1_shared_qa.sql').read_text())
    report['nativeSharedFirstLastAndDeluxe'] = 'PASS'
    shared = (ROOT/'supabase/tests/hotel_physical_occupancy_v1_shared_qa.sql').read_text()
    shared = shared.replace("now()-interval '3 hours'", "timestamptz '2026-09-23 14:20+09'")
    before_assert = "SELECT pg_temp.ok((SELECT count(distinct room_id)=1 AND count(*)=2"
    legacy_proof = """
    UPDATE family_shared_room_groups SET status='allocated' WHERE id=pg_temp.f(71);
    UPDATE hotel_physical_occupancy_members SET version=1,created_at='2026-09-23 14:21+09',joined_at='2026-09-23 14:20+09',family_booking_member_id=id;
    INSERT INTO entity_audit_events(module_code,entity_type,entity_id,action,after_data,created_at)
    SELECT 'hotel_operations','hotel_physical_occupancy_members',m.id,'created',to_jsonb(m),'2026-09-23 14:21+09' FROM hotel_physical_occupancy_members m;
    UPDATE entity_audit_events SET created_at='2026-09-23 14:21+09';
    """
    shared = shared.replace(before_assert, legacy_proof + before_assert)
    shared = shared.replace('ROLLBACK;', """
    SAVEPOINT before_shared_reverse;
    SELECT reverse_shared_hotel_member_completion(pg_temp.f(60),pg_temp.f(21),(SELECT version FROM hotel_physical_occupancies WHERE id=pg_temp.f(60)),(SELECT version FROM hotel_stays WHERE id=pg_temp.f(21)),'local legacy shared reverse',gen_random_uuid());
    SET CONSTRAINTS hotel_legacy_physical_reentry_guard IMMEDIATE;
    SELECT pg_temp.ok((SELECT count(*)=1 FROM hotel_current_physical_rooms_internal()),'legacy Shared reversal final membership resolves one room');
    ROLLBACK TO before_shared_reverse;
    INSERT INTO hotel_capacity_reservations(id,hotel_stay_id,source_kind,quantity,room_type_id,reserved_from,reserved_until,created_by,updated_by)
    VALUES(pg_temp.f(32),pg_temp.f(23),'stay',1,pg_temp.f(1),now(),now()+interval '1 day',pg_temp.f(900),pg_temp.f(900));
    INSERT INTO hotel_room_allocations(id,capacity_reservation_id,room_id,allocated_from,allocated_until,created_by,updated_by)
    VALUES(pg_temp.f(42),pg_temp.f(32),pg_temp.f(11),now(),now()+interval '1 day',pg_temp.f(900),pg_temp.f(900));
    UPDATE hotel_stays SET checked_in_at=now() WHERE id=pg_temp.f(23);
    DO $$ BEGIN
      PERFORM reverse_shared_hotel_member_completion(pg_temp.f(60),pg_temp.f(21),(SELECT version FROM hotel_physical_occupancies WHERE id=pg_temp.f(60)),(SELECT version FROM hotel_stays WHERE id=pg_temp.f(21)),'local Shared reverse conflict',gen_random_uuid());
      SET CONSTRAINTS hotel_legacy_physical_reentry_guard IMMEDIATE;
      RAISE EXCEPTION 'Shared reverse accepted physical collision';
    EXCEPTION WHEN exclusion_violation THEN RAISE NOTICE 'PASS legacy Shared reversal conflict 23P01'; END $$;
    SELECT pg_temp.ok((SELECT status='completed' FROM hotel_physical_occupancies WHERE id=pg_temp.f(60)),'failed Shared reversal preserves completed lifecycle');
    ROLLBACK;
    """)
    sql(shared)
    report['legacySharedFirstLastAndDeluxe'] = 'PASS'

    if a.evidence_dir:
        current = json.loads((a.evidence_dir/'production-current.json').read_text())
        proof = json.loads((a.evidence_dir/'production-proof.json').read_text())
        assert current['read_only'] == proof['read_only'] == 'on'
        def literal(value):
            return "'" + json.dumps(value).replace("'", "''") + "'::jsonb"
        replay = ["BEGIN; SET LOCAL session_replication_role=replica;"]
        for table, rows in [('hotel_stays',current.get('allStays',current['stays'])),('hotel_capacity_reservations',current['capacities']),('hotel_room_allocations',current['allocations']),('hotel_rooms',current['rooms']),('hotel_room_types',current.get('roomTypes',[])),('long_stay_contracts',current['contracts']),('long_stay_absence_events',proof['absences'])]:
            replay.append(f"INSERT INTO {table} SELECT * FROM jsonb_populate_recordset(NULL::{table},{literal(rows or [])});")
        if (a.evidence_dir/'production-shared.json').exists():
            shared_data = json.loads((a.evidence_dir/'production-shared.json').read_text())
            for table, key in [('family_shared_room_groups','groups'),('hotel_physical_occupancies','occupancies'),('hotel_physical_occupancy_members','members'),('family_booking_members','bookingMembers'),('family_bookings','bookings')]:
                replay.append(f"INSERT INTO {table} SELECT * FROM jsonb_populate_recordset(NULL::{table},{literal(shared_data[key] or [])});")
            replay.append(f"INSERT INTO dogs SELECT * FROM jsonb_populate_recordset(NULL::dogs,{literal([dict(d,name='fixture') for d in shared_data['dogs']])});")
            replay.append("INSERT INTO customers SELECT DISTINCT customer_id,'fixture' FROM dogs WHERE customer_id IS NOT NULL;")
        audits = [dict(e,module_code='hotel_operations') for e in proof['cutover_audits']]
        replay.append(f"INSERT INTO entity_audit_events SELECT * FROM jsonb_populate_recordset(NULL::entity_audit_events,{literal(audits)});")
        replay.append("SET LOCAL session_replication_role=origin;")
        replay.append("SELECT jsonb_agg(to_jsonb(p)) FROM hotel_current_physical_rooms_internal() p;")
        replay.append("SELECT jsonb_agg(to_jsonb(p)) FROM hotel_legacy_physical_anchors_internal() p;")
        replay.append("SELECT set_config('test.actor','00000000-0000-4000-8000-000000000900',true);")
        replay.append("CREATE TEMP TABLE integrated_snapshot AS SELECT get_hotel_operations_snapshot_v2('2026-09-28') payload;")
        replay.append("""DO $$ DECLARE b jsonb:=qa_old_snapshot_v2('2026-09-28'); n jsonb:=(SELECT payload FROM integrated_snapshot); k text; BEGIN
          FOREACH k IN ARRAY ARRAY['selectedDateUnassigned','confirmedRemainingByType','overallSafeRemaining','individualTypeAvailabilityWarning','roomTypeUnspecified','totalCapacity','unassignedRoomTypeCount','rooms','settings'] LOOP
            IF NOT n ? k OR n->k IS DISTINCT FROM b->k THEN RAISE EXCEPTION 'CURRENT_V2_FIELD_REGRESSION %',k; END IF;
          END LOOP;
          IF (SELECT jsonb_agg(t-'checkedInNow'-'allocatedNow'-'physicallyEmpty') FROM jsonb_array_elements(n->'roomTypes') t) IS DISTINCT FROM (SELECT jsonb_agg(t-'checkedInNow'-'allocatedNow'-'physicallyEmpty') FROM jsonb_array_elements(b->'roomTypes') t) THEN RAISE EXCEPTION 'CURRENT_V2_ROOM_TYPE_CAPACITY_CHANGED'; END IF;
          IF EXISTS(SELECT 1 FROM hotel_current_physical_rooms_internal() GROUP BY room_id HAVING count(DISTINCT capacity_id)>1) THEN RAISE EXCEPTION 'PHYSICAL_ROOM_DUPLICATE'; END IF;
          IF EXISTS(SELECT 1 FROM hotel_legacy_physical_anchors_internal() a WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(n->'stays') s WHERE s->>'id'=a.stay_id::text AND s->'currentPhysicalRoom'->>'state'='occupied')) THEN RAISE EXCEPTION 'ANCHOR_NOT_TRANSMITTED_BY_V2'; END IF;
          IF EXISTS(SELECT 1 FROM hotel_current_physical_rooms_internal() p JOIN jsonb_array_elements_text(n->'selectedDateUnassigned'->'singleStayIds') u(id) ON u.id=p.stay_id::text) THEN RAISE EXCEPTION 'PHYSICAL_STAY_IN_SELECTED_UNASSIGNED'; END IF;
          RAISE NOTICE 'PASS current Production v2 exact-body integration: physical + all selected-date fields';
        END $$;""")
        replay.append("SELECT jsonb_build_object('readPath','get_hotel_operations_snapshot_v2(date)','selectedDateUnassigned',payload->'selectedDateUnassigned','confirmedRemainingByType',payload->'confirmedRemainingByType','totalCapacity',payload->'totalCapacity','stays',(SELECT jsonb_agg(jsonb_build_object('id',s->>'id','physical',s->'currentPhysicalRoom')) FROM jsonb_array_elements(payload->'stays') s)) FROM integrated_snapshot;")
        replay.append("SELECT jsonb_agg(jsonb_build_object('stay',s.id,'source',CASE WHEN s.checked_in_at>=timestamptz '2026-09-25 00:00+09' THEN 'native_v1' WHEN EXISTS(SELECT 1 FROM hotel_legacy_physical_anchors_internal() a WHERE a.stay_id=s.id) THEN 'cutover_anchor' WHEN p.room_id IS NOT NULL THEN 'actual_return' ELSE 'stale_excluded' END,'room',r.name,'roomId',p.room_id)) FROM hotel_stays s LEFT JOIN hotel_current_physical_rooms_internal() p ON p.stay_id=s.id LEFT JOIN hotel_rooms r ON r.id=p.room_id WHERE s.archived_at IS NULL AND s.checked_in_at IS NOT NULL AND s.checked_out_at IS NULL;")
        replay.append("SELECT count(*) AS unresolved_active_in_snapshot FROM integrated_snapshot i CROSS JOIN LATERAL jsonb_array_elements(i.payload->'stays') x JOIN hotel_stays s ON s.id=(x->>'id')::uuid WHERE s.checked_in_at IS NOT NULL AND s.checked_out_at IS NULL AND s.archived_at IS NULL AND x->'currentPhysicalRoom'->>'state'='unresolved';")
        replay.append("EXPLAIN (ANALYZE,BUFFERS) SELECT get_hotel_operations_snapshot_v2('2026-09-28');")
        replay.append("EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM hotel_current_physical_rooms_internal();")
        replay.append("ROLLBACK;")
        (a.output/'production-equivalent-replay.sql').write_text('\n'.join(replay))
        replay_result = sql('\n'.join(replay))
        (a.output/'production-equivalent-result.txt').write_text(replay_result)
        report['productionEquivalentReplay'] = 'EXECUTED; see exact rows in production-equivalent-result.txt'

except Exception as error:
    report['error'] = str(error)
finally:
    if (cluster/'data/postmaster.pid').exists():
        run([PG/'pg_ctl', '-D', cluster/'data', 'stop', '-m', 'fast'])
    (a.output/'result.json').write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))
raise SystemExit(1 if report.get('error') else 0)
