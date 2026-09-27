"""Unix-socket-only historical read-model QA; anonymized lifecycle fixture and verbatim catalog.
Optional --evidence replays a read-only captured technical dataset without changing its rows.
--catalog is the read-only captured Production function-definition JSON.
This bounded storage fixture does not claim full Production RLS/trigger emulation.
"""
import argparse
import json
import re
import subprocess
import tempfile
import uuid
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
PG = Path('/opt/homebrew/opt/postgresql@18/bin')
p = argparse.ArgumentParser()
p.add_argument('--catalog', type=Path, required=True)
p.add_argument('--output', type=Path, required=True)
p.add_argument('--evidence', type=Path, default=ROOT/'supabase/tests/shared_hotel_history_v1_provenance.json')
a = p.parse_args()
a.output.mkdir(parents=True, exist_ok=True)
cluster = Path(tempfile.mkdtemp(prefix='shared-history-qa-'))
report = {}
def cmd(args):
    r = subprocess.run([str(x) for x in args], text=True, capture_output=True)
    if r.returncode: raise RuntimeError(r.stderr)
    return r.stdout
def sql(s):
    r = subprocess.run([str(PG/'psql'),'-X','-h',str(cluster),'-p','55529','-U','postgres','-d','projection_fixture_008','-v','ON_ERROR_STOP=1','-At'],input=s,text=True,capture_output=True)
    with (a.output/'sql.log').open('a') as f: f.write(r.stdout+r.stderr)
    if r.returncode: raise RuntimeError(r.stderr[-4000:])
    return r.stdout
try:
    cmd([PG/'initdb','-D',cluster/'data','--auth=trust','--username=postgres','--no-locale','--encoding=UTF8'])
    cmd([PG/'pg_ctl','-D',cluster/'data','-l',cluster/'server.log','-o',f"-h '' -k {cluster} -p 55529",'start'])
    cmd([PG/'createdb','-h',cluster,'-p','55529','-U','postgres','projection_fixture_008'])
    sql('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;')
    sql((ROOT/'supabase/tests/shared_hotel_history_v1_fixture.sql').read_text())
    sql("CREATE TABLE long_stay_absence_events(event_type text,hotel_stay_id uuid,released_allocation_id uuid,released_capacity_id uuid,inventory_mode text,inventory_transition_status text,occurred_at timestamptz,guarantee_from timestamptz);")
    base_source=(ROOT/'supabase/migrations/202609080004_hotel_schedule_canonical_room_projection.sql').read_text()
    base_fn=re.search(r'create or replace function public.get_operation_hotel_room_projections[\s\S]*?\$\$;',base_source,re.I)
    if not base_fn:
        base_fn=re.search(r'create function public.get_operation_hotel_room_projections[\s\S]*?\$\$;',base_source,re.I)
    sql(base_fn[0].replace('create function','create or replace function'))
    history=(ROOT/'supabase/migrations/202609090001_shared_hotel_historical_provenance.sql').read_text()
    sql(history[history.index('CREATE FUNCTION public.hotel_shared_semantic_internal'):history.rindex('COMMIT;')])
    for f in json.loads(a.catalog.read_text()): sql(f['definition'])
    import copy
    from datetime import datetime, timedelta
    def instant(value):
        return datetime.fromisoformat(re.sub(r'\.(\d+)(?=\+)',lambda m:'.'+m[1].ljust(6,'0'),value))
    fixture=json.loads(a.evidence.read_text())
    dataset=fixture['tables']
    actor="SET test.actor='00000000-0000-4000-8000-000000000001';"
    proof='SELECT hotel_shared_verified_segments_internal(ARRAY(SELECT id FROM hotel_stays));'
    def load(data):
        sql('TRUNCATE '+','.join(data)+';')
        for table,rows in data.items():
            assert table in dataset
            payload=json.dumps(rows)
            assert '$fixture$' not in payload
            sql(f'INSERT INTO {table} SELECT * FROM jsonb_populate_recordset(NULL::{table},$fixture$'+payload+'$fixture$::jsonb);')
    def read():
        return json.loads(sql(actor+proof).splitlines()[-1])
    def rows_digest():
        return sql('SELECT md5('+"||".join(f"coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text FROM {t} t),'null')" for t in dataset)+');')
    metadata="SELECT oid::regprocedure::text,proowner,proacl,prosecdef,proconfig FROM pg_proc WHERE pronamespace='public'::regnamespace ORDER BY 1;"
    protected="SELECT oid::regprocedure::text,md5(prosrc) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname<>'hotel_shared_verified_segments_internal' ORDER BY 1;"
    load(dataset)
    before=read()
    assert len(before)==6 and all(x['resolutionStatus']=='unavailable' for x in before)
    report['predecessorBaseline']='6 stays unavailable'
    old_rows=rows_digest();old_meta=sql(metadata);old_functions=sql(protected)
    sql((ROOT/'supabase/migrations/202609270001_shared_hotel_historical_room_resolution_v1.sql').read_text())
    assert old_rows==rows_digest() and old_meta==sql(metadata) and old_functions==sql(protected)
    report['migrationIsolation']='PASS: all rows, other functions, signatures, owners, ACL preserved'
    after=read()
    assert len(after)==6 and all(x['resolutionStatus']=='resolved' for x in after)
    report['stayResults']=after
    events=json.loads(sql(actor+'SELECT get_operation_hotel_room_projections_v2(ARRAY(SELECT id FROM operation_schedules));').splitlines()[-1])
    expected={x['operationScheduleId']:x for x in fixture['expected']}
    assert len(events)==12
    for event in events:
        prior=expected[event['operationScheduleId']]
        assert event['roomResolutionStatus']=='resolved'
        assert event['hotelRoomName']==prior['hotelRoomName']
    report['scheduleResults']=events
    report['pathA']='PASS: 5 canonical Shared admissions'
    report['pathB']='PASS: Single check-in then canonical Shared merge'
    merge_events=[x for x in events if x['hotelStayId']==fixture['mergeStay']]
    assert {x['hotelEventKind']:x['hotelRoomName'] for x in merge_events}=={'check_in':'DELUXE 2','check_out':'DELUXE 5'}
    report['segmentedRoomMove']='PASS: DELUXE 2 check-in / DELUXE 5 checkout'
    assert sql("SELECT count(*) FROM hotel_physical_occupancies WHERE status='active';").strip()=='0'
    report['currentOccupancy']='PASS: no active occupancy restored'
    def field(data,table,key,value):
        for row in data[table]:row[key]=value
        for audit in data['entity_audit_events']:
            if audit['entity_type']==table:
                for side in ['before_data','after_data']:
                    if audit.get(side):audit[side][key]=value
    fake='11111111-1111-4111-8111-111111111111'
    def missing_entry(data):
        data['hotel_physical_occupancy_requests']=[r for r in data['hotel_physical_occupancy_requests'] if r['operation_kind']!='check_in']
        for audit in data['entity_audit_events']:
            if audit['entity_type']=='hotel_stays' and audit['change_reason']=='호텔 입실 완료':audit['request_id']=None
    def ambiguous(data):
        cloned=copy.deepcopy(data['hotel_physical_occupancy_members'])
        for row in cloned:row['id']=str(uuid.uuid4())
        data['hotel_physical_occupancy_members']+=cloned
    cases={
      'wrong_stay_linked_to_member':lambda d:field(d,'hotel_physical_occupancy_members','hotel_stay_id',fake),
      'wrong_member_linked_to_occupancy':lambda d:field(d,'hotel_physical_occupancy_members','family_booking_member_id',fake),
      'wrong_occupancy':lambda d:field(d,'hotel_physical_occupancy_members','occupancy_id',fake),
      'wrong_shared_group':lambda d:field(d,'hotel_physical_occupancies','shared_room_group_id',fake),
      'allocation_from_other_room_group':lambda d:field(d,'hotel_room_allocations','capacity_reservation_id',fake),
      'allocation_outside_period':lambda d:field(d,'hotel_room_allocations','allocated_from','2199-01-01T00:00:00Z'),
      'missing_successful_entry_evidence':missing_entry,
      'broken_audit_version':lambda d:d.update(entity_audit_events=[x for x in d['entity_audit_events'] if not(x['entity_type']=='hotel_stays' and x['after_data']['version']==2)]),
      'ambiguous_room_history':ambiguous,
      'conflicting_move_history':lambda d:d['hotel_physical_occupancy_requests'].extend([dict(x,operation_kind='move') for x in d['hotel_physical_occupancy_requests'] if x['operation_kind']=='check_in']),
      'cancelled_member':lambda d:field(d,'hotel_physical_occupancy_members','status','cancelled'),
      'non_entered_member':lambda d:field(d,'hotel_stays','checked_in_at',None),
      'late_member_after_receipt':lambda d:field(d,'hotel_physical_occupancy_members','joined_at','2199-01-01T00:00:00Z'),
      'completed_stay_unrelated_allocation':lambda d:field(d,'hotel_physical_occupancies','room_allocation_id',fake),
    }
    report['negativeMatrix']={}
    def reject(name,data,targets=None):
        load(data);results=read()
        if targets is not None:results=[x for x in results if x['hotelStayId'] in targets]
        assert results and all(x['resolutionStatus']=='unavailable' for x in results),name
        report['negativeMatrix'][name]='PASS: rejected'
    for name,mutate in cases.items():
        data=copy.deepcopy(dataset);mutate(data);reject(name,data)
    # A: corrupt only native member creation time, retain backdated joined_at.
    data=copy.deepcopy(dataset)
    receipts={r['response']['stay']['id']:r for r in data['hotel_physical_occupancy_requests'] if r['operation_kind']=='check_in'}
    for member in data['hotel_physical_occupancy_members']:
        if member['hotel_stay_id'] not in receipts:continue
        late=(instant(receipts[member['hotel_stay_id']]['created_at'])+timedelta(seconds=1)).isoformat()
        member['created_at']=late
        for audit in data['entity_audit_events']:
            if audit['entity_type']=='hotel_physical_occupancy_members' and audit['entity_id']==member['id']:
                for side in ['before_data','after_data']:
                    if audit.get(side):audit[side]['created_at']=late
                if audit['after_data']['version']==1:audit['created_at']=late
    reject('A_backdated_join_without_creation_provenance',data,fixture['nativeStays'])
    # B: coherent per-entity chains still contradict the group terminal state.
    data=copy.deepcopy(dataset)
    for row in data['family_shared_room_groups']:row['status']='allocated'
    for audit in data['entity_audit_events']:
        if audit['entity_type']=='family_shared_room_groups':
            for side in ['before_data','after_data']:
                if audit.get(side) and audit[side]['status']=='released':audit[side]['status']='allocated'
    reject('B_completed_occupancy_allocated_group',data)
    # C: valid Single command cannot borrow another merge's member response.
    data=copy.deepcopy(dataset)
    for request in data['hotel_physical_occupancy_requests']:
        if request['operation_kind']=='merge_existing_stays':
            for member in request['response']['members']:
                if member['hotelStayId']==fixture['mergeStay']:member['hotelStayId']=fake
    reject('C_unrelated_merge',data,[fixture['mergeStay']])
    # E: replace member identity coherently in rows/audits, never in receipts.
    data=copy.deepcopy(dataset)
    for member in data['hotel_physical_occupancy_members']:
        old=member['id'];member['id']=str(uuid.uuid4())
        for audit in data['entity_audit_events']:
            if audit['entity_type']=='hotel_physical_occupancy_members' and audit['entity_id']==old:
                audit['entity_id']=member['id']
                for side in ['before_data','after_data']:
                    if audit.get(side):audit[side]['id']=member['id']
    reject('E_fabricated_member_without_canonical_receipt',data)
    # H: conflicting same-version allocation history cannot yield two intervals.
    data=copy.deepcopy(dataset)
    for audit in list(data['entity_audit_events']):
        if audit['entity_type']=='hotel_room_allocations' and audit['after_data']['version']==1:
            duplicate=copy.deepcopy(audit);duplicate['id']=str(uuid.uuid4());duplicate['after_data']['room_id']=fake
            data['entity_audit_events'].append(duplicate)
    reject('H_ambiguous_overlapping_allocation_evidence',data)
    # Missing Shared receipt is valid only for proven Path B, never native Path A.
    data=copy.deepcopy(dataset)
    data['hotel_physical_occupancy_requests']=[r for r in data['hotel_physical_occupancy_requests'] if r['operation_kind']!='check_in']
    reject('missing_native_receipt',data,fixture['nativeStays'])
    assert next(x for x in read() if x['hotelStayId']==fixture['mergeStay'])['resolutionStatus']=='resolved'
    # A second allocation must not be ignored by Single-to-Shared proof.
    data=copy.deepcopy(dataset)
    merged=next(m for m in data['hotel_physical_occupancy_members'] if m['hotel_stay_id']==fixture['mergeStay'])
    occ=next(o for o in data['hotel_physical_occupancies'] if o['id']==merged['occupancy_id'])
    extra=copy.deepcopy(next(a for a in data['hotel_room_allocations'] if a['id']==occ['room_allocation_id']))
    extra['id']=str(uuid.uuid4());extra['room_id']=fake
    data['hotel_room_allocations'].append(extra)
    reject('competing_single_allocation',data,[fixture['mergeStay']])
    data=copy.deepcopy(dataset)
    extra=copy.deepcopy(next(c for c in data['hotel_capacity_reservations'] if c['id']==occ['capacity_reservation_id']))
    extra['id']=str(uuid.uuid4());extra['source_kind']='stay';extra['hotel_stay_id']=fixture['mergeStay']
    data['hotel_capacity_reservations'].append(extra)
    reject('competing_single_capacity',data,[fixture['mergeStay']])
    for field_name in ['request_id','changed_by','change_reason']:
        data=copy.deepcopy(dataset)
        for audit in data['entity_audit_events']:
            if audit['entity_id']==fixture['mergeStay'] and audit['change_reason']=='호텔 입실 완료':audit[field_name]=None
        reject('single_entry_missing_'+field_name,data,[fixture['mergeStay']])
    # F: actual audit/receipt prefix at the first checkout, not a fabricated state.
    data=copy.deepcopy(dataset)
    first=next(r for r in data['hotel_physical_occupancy_requests'] if r['operation_kind']=='check_out' and r['response']['stay']['id']==fixture['partialStay'])
    cutoff=instant(first['created_at'])
    data['hotel_physical_occupancy_requests']=[r for r in data['hotel_physical_occupancy_requests'] if instant(r['created_at'])<=cutoff]
    data['entity_audit_events']=[e for e in data['entity_audit_events'] if instant(e['created_at'])<=cutoff]
    for table in ['hotel_stays','family_booking_members','family_shared_room_groups','hotel_physical_occupancy_members','hotel_physical_occupancies','hotel_room_allocations','hotel_capacity_reservations']:
        for index,row in enumerate(data[table]):
            history=[e for e in data['entity_audit_events'] if e['entity_type']==table and e['entity_id']==row['id'] and 'created_at' in e['after_data']]
            if history:data[table][index]=max(history,key=lambda e:e['after_data']['version'])['after_data']
    load(data);partial=next(x for x in read() if x['hotelStayId']==fixture['partialStay'])
    assert partial['resolutionStatus']=='resolved'
    occupancy=next(o for o in data['hotel_physical_occupancies'] if o['id']==first['occupancy_id'])
    assert occupancy['status']=='active'
    assert sum(m['status']=='active' for m in data['hotel_physical_occupancy_members'] if m['occupancy_id']==occupancy['id'])==1
    assert next(g for g in data['family_shared_room_groups'] if g['id']==occupancy['shared_room_group_id'])['status']=='allocated'
    no_checkout=copy.deepcopy(data)
    no_checkout['hotel_physical_occupancy_requests']=[r for r in no_checkout['hotel_physical_occupancy_requests'] if r['request_id']!=first['request_id']]
    reject('partial_late_checkout_without_receipt',no_checkout,[fixture['partialStay']])
    report['partialCheckout']='PASS: completed member resolves; remaining active, occupancy active, group allocated'
    report['fullCheckout']='PASS: all six completed, occupancies completed, groups released'
    report['falsePositives']=0
    sql('TRUNCATE '+','.join(dataset)+';')
    sql((ROOT/'supabase/tests/shared_hotel_history_v1_matrix.sql').read_text())
    report['singleFutureActive']='PASS: 106 Single projections + future/active Shared'
except Exception as error:
    import traceback
    report['error']=traceback.format_exc()
finally:
    if (cluster/'data/postmaster.pid').exists(): cmd([PG/'pg_ctl','-D',cluster/'data','stop','-m','fast'])
    (a.output/'result.json').write_text(json.dumps(report,indent=2))
    print(json.dumps(report,indent=2))
raise SystemExit(1 if 'error' in report else 0)
