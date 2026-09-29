"""Isolated PostgreSQL read-projection tests, never a Production connection.
Bounded tables are not a full lifecycle/RLS emulator. Executes the real Shared
read function, original snapshot_v2, and candidate migration verbatim.
"""
import json
import re
import subprocess
import tempfile
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
PG = Path('/opt/homebrew/opt/postgresql@18/bin')
cluster = Path(tempfile.mkdtemp(prefix='unassigned-classification-qa-'))
passed = []
def run(args, source=None):
    p = subprocess.run([str(a) for a in args], input=source, text=True, capture_output=True)
    if p.returncode: raise RuntimeError(p.stderr)
    return p.stdout.strip()
def sql(source):
    return run([PG/'psql','-X','-h',cluster,'-p','55540','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-Atq'], source)
def function(path, name):
    return re.search(r'create(?: or replace)? function public\.'+name+r'\([\s\S]*?as (\$\w*\$)[\s\S]*?\1;', (ROOT/path).read_text(), re.I)[0]
def uid(n): return f'00000000-0000-4000-8000-{n:012d}'
def q(s): return 'NULL' if s is None else "'"+str(s).replace("'","''")+"'"
def cap(n, start='2026-09-29 18:00+09', end='2026-10-02 19:00+09', stay=None, archived=False):
    stay = n if stay is None else stay
    sql(f"INSERT INTO hotel_stays(id,dog_id,archived_at,checked_out_at) VALUES('{uid(stay)}',NULL,NULL,NULL) ON CONFLICT DO NOTHING; INSERT INTO hotel_capacity_reservations(id,hotel_stay_id,shared_room_group_id,source_kind,room_type_id,reserved_from,reserved_until,quantity,archived_at) VALUES('{uid(n+100)}','{uid(stay)}',NULL,'stay','{uid(1)}',{q(start)},{q(end)},1,{'now()' if archived else 'NULL'});")
def alloc(n,start,end,archived=False):
    sql(f"INSERT INTO hotel_room_allocations(capacity_reservation_id,room_id,allocated_from,allocated_until,archived_at) VALUES('{uid(n+100)}','{uid(500)}',{q(start)},{q(end)},{'now()' if archived else 'NULL'});")
def read(date='2026-09-29'):
    return json.loads(sql(f"BEGIN READ ONLY; SELECT hotel_selected_date_unassigned_internal({q(date)}); ROLLBACK;"))
def check(name,count,date='2026-09-29'):
    result=read(date); assert result['count']==count,(name,result)
    assert len(result['items'])==count
    passed.append(name); return result
DATA=['hotel_stays','hotel_capacity_reservations','hotel_room_allocations','family_shared_room_groups','family_bookings','family_booking_members','dogs','customers','hotel_physical_occupancies']
def clear(): sql('TRUNCATE '+','.join(DATA)+';')
def shared():
    sql(f"""INSERT INTO customers VALUES('{uid(700)}','fixture');
    INSERT INTO family_bookings VALUES('{uid(701)}','{uid(700)}',NULL);
    INSERT INTO family_shared_room_groups VALUES('{uid(702)}','{uid(701)}','{uid(1)}','requested',2,'2026-09-29 18:00+09','2026-10-02 19:00+09',1,NULL);
    INSERT INTO hotel_capacity_reservations(id,hotel_stay_id,shared_room_group_id,source_kind,room_type_id,reserved_from,reserved_until,quantity,archived_at) VALUES('{uid(703)}',NULL,'{uid(702)}','shared_group','{uid(1)}','2026-09-29 18:00+09','2026-10-02 19:00+09',1,NULL);
    """)
    for n in (710,711):
        sql(f"INSERT INTO dogs VALUES('{uid(n)}','{uid(700)}','fixture'); INSERT INTO hotel_stays(id,dog_id,archived_at,checked_out_at) VALUES('{uid(n)}','{uid(n)}',NULL,NULL); INSERT INTO family_booking_members VALUES('{uid(n)}','{uid(702)}','{uid(701)}','{uid(n)}','{uid(n)}','hotel','{n}',NULL);")
try:
    run([PG/'initdb','-D',cluster/'data','--auth=trust','--username=postgres','--no-locale','--encoding=UTF8'])
    run([PG/'pg_ctl','-D',cluster/'data','-l',cluster/'server.log','-o',f"-h '' -k {cluster} -p 55540",'start'])
    sql("""CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE FUNCTION is_active_operation_member() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT coalesce(current_setting('test.allowed',true),'yes')='yes' $$;
    CREATE TABLE hotel_stays(id uuid PRIMARY KEY,dog_id uuid,archived_at timestamptz,checked_out_at timestamptz);
    CREATE TABLE hotel_capacity_reservations(id uuid PRIMARY KEY,hotel_stay_id uuid,shared_room_group_id uuid,source_kind text,room_type_id uuid,reserved_from timestamptz,reserved_until timestamptz,quantity int,archived_at timestamptz);
    CREATE TABLE hotel_room_allocations(capacity_reservation_id uuid,room_id uuid,allocated_from timestamptz,allocated_until timestamptz,archived_at timestamptz);
    CREATE TABLE hotel_rooms(id uuid,room_type_id uuid,is_active boolean,archived_at timestamptz);
    CREATE TABLE hotel_room_types(id uuid,code text,is_active boolean,archived_at timestamptz);
    CREATE TABLE family_shared_room_groups(id uuid,family_booking_id uuid,room_type_id uuid,status text,requested_capacity int,normalized_starts_at timestamptz,normalized_ends_at timestamptz,version int,archived_at timestamptz);
    CREATE TABLE family_bookings(id uuid,customer_id uuid,archived_at timestamptz);
    CREATE TABLE family_booking_members(id uuid,shared_room_group_id uuid,family_booking_id uuid,hotel_stay_id uuid,dog_id uuid,service_type text,stable_member_key text,archived_at timestamptz);
    CREATE TABLE dogs(id uuid,customer_id uuid,name text);
    CREATE TABLE customers(id uuid,name text);
    CREATE TABLE hotel_physical_occupancies(shared_room_group_id uuid,archived_at timestamptz);
    CREATE FUNCTION get_hotel_operations_snapshot(date) RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT jsonb_build_object('date',$1,'rooms','[]'::jsonb,'settings',jsonb_build_object('preserved',true),'roomTypes',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'code',code,'activeRooms',6,'reservedPeak',0)) FROM hotel_room_types),'[]'::jsonb)) $$;
    """)
    sql(f"INSERT INTO hotel_room_types VALUES('{uid(1)}','DELUXE',true,NULL),('{uid(2)}','STANDARD',true,NULL); INSERT INTO hotel_rooms SELECT ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,CASE WHEN n<=6 THEN '{uid(1)}'::uuid ELSE '{uid(2)}'::uuid END,true,NULL FROM generate_series(1,11) n;")
    sql(function('supabase/migrations/202609010002_hotel_unassigned_shared_room_read_contract.sql','get_unassigned_shared_hotel_room_groups'))
    old=function('supabase/migrations/202608040002_hotel_flexible_reservations.sql','get_hotel_operations_snapshot_v2')
    sql(old); sql('GRANT EXECUTE ON FUNCTION get_hotel_operations_snapshot_v2(date) TO authenticated;')
    cap(10)
    before=json.loads(sql("SELECT get_hotel_operations_snapshot_v2('2026-09-29');"))
    meta="SELECT proowner,proacl,prorettype,proargtypes,prosecdef,proconfig FROM pg_proc WHERE oid='get_hotel_operations_snapshot_v2(date)'::regprocedure;"
    oldmeta=sql(meta)
    digest="SELECT md5("+"||".join(f"coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text FROM {t} t),'null')" for t in DATA)+");"
    olddata=sql(digest)
    sql((ROOT/'supabase/migrations/202609280001_hotel_selected_date_unassigned_v1.sql').read_text())
    assert sql(meta)==oldmeta and sql(digest)==olddata
    after=json.loads(sql("BEGIN READ ONLY; SELECT get_hotel_operations_snapshot_v2('2026-09-29'); ROLLBACK;")); after.pop('selectedDateUnassigned'); assert before==after
    passed.append('additive snapshot / signatures / ACL / all prior fields / data preserved')
    check('A known 18:00 start',1)
    clear(); cap(10,start='2026-10-09 00:00+09',end='2026-10-12 00:00+09'); check('B future excluded',0)
    clear(); cap(10,start='2026-09-28 18:00+09'); check('C previous-day continuing',1)
    clear(); cap(10,start='2026-09-29 00:00+09'); check('D unknown arrival canonical day boundary',1)
    clear(); cap(10,start='2026-09-27 16:00+09',end='2026-10-01 00:00+09'); check('E unknown departure date included',1,'2026-09-30');check('E next midnight excluded',0,'2026-10-01')
    clear(); cap(10,start='2026-09-28 18:00+09',end='2026-09-29 00:00+09');cap(11,start='2026-09-30 00:00+09');check('F both midnight half-open exclusions',0)
    clear();cap(10,start='2026-09-28 18:00+09',end='2026-09-29 18:00+09');cap(11);check('F same-time turnover two booking identities, not peak',2)
    clear();shared();result=check('G Shared two members one booking',1);assert result['singleStayIds']==[] and result['sharedGroupIds']==[uid(702)]
    sql("UPDATE family_shared_room_groups SET status='allocated'; INSERT INTO hotel_physical_occupancies SELECT id,NULL FROM family_shared_room_groups;");check('H allocated Shared excluded via existing read contract',0)
    clear();cap(10,start='2026-08-01 00:00+09',end='infinity');alloc(10,'2026-08-01 00:00+09','infinity');check('I Long Stay keep_room',0)
    clear();cap(10,start='2026-08-01 00:00+09',end='2026-09-28 18:00+09',archived=True);alloc(10,'2026-08-01 00:00+09','2026-09-28 18:00+09');cap(11,start='2026-09-30 00:00+09',end='infinity',stay=10);check('J release_room gap',0);check('J future return capacity without allocation',1,'2026-09-30')
    clear();cap(10,end='2026-09-29 19:00+09');cap(11,start='2026-09-29 20:00+09',stay=10);result=check('K defensive repeated capacity segments one stay',1);assert len(result['items'][0]['capacitySegments'])==2
    clear();cap(10,archived=True);cap(11);sql(f"UPDATE hotel_stays SET archived_at=now() WHERE id='{uid(11)}';");cap(12);sql(f"UPDATE hotel_stays SET checked_out_at=now() WHERE id='{uid(12)}';");check('L cancelled archived capacity/stay and completed lifecycle',0)
    clear();cap(10,start='2026-09-27 00:00+09');alloc(10,'2026-09-27 00:00+09','2026-09-28 00:00+09');check('M prior allocation is not selected-day assignment',1)
    alloc(10,'2026-09-29 18:00+09','2026-10-02 19:00+09');check('M partial-day actual entry is assigned',0)
    clear();cap(10);alloc(10,'2026-09-29 18:00+09','2026-10-02 19:00+09',True);check('M archived allocation ignored',1)
    clear();cap(10,start='2026-09-27 00:00+09');alloc(10,'2026-09-27 00:00+09','2026-09-29 12:00+09');alloc(10,'2026-09-29 12:00+09','2026-10-02 19:00+09');check('M same-day move segments stay assigned',0)
    clear();cap(10);cap(11,start='2026-10-09 00:00+09',end='2026-10-12 00:00+09');cap(12,start='2026-10-11 00:00+09',end='2026-10-18 00:00+09');cap(13,start='2026-10-11 00:00+09',end='2026-10-18 00:00+09');result=check('2026-09-29 Production-equivalent Mary only',1);assert result['singleStayIds']==[uid(10)] and not result['sharedGroupIds']
    sql(f"UPDATE hotel_capacity_reservations SET room_type_id=NULL WHERE hotel_stay_id='{uid(10)}';");check('unknown type remains unassigned, never allocated to a type',1)
    clear();cap(10);cap(11);sql(f"UPDATE hotel_stays SET dog_id='{uid(900)}';");check('same dog different canonical stays remain two',2)
    clear();cap(10,start='2026-09-27 00:00+09');alloc(10,'2026-09-30 00:00+09','2026-10-02 19:00+09');check('future allocation does not assign prior selected date',1)
    for query in ["SET test.allowed='no'; SELECT hotel_selected_date_unassigned_internal('2026-09-29');",'SELECT hotel_selected_date_unassigned_internal(NULL);','SET ROLE authenticated; SELECT hotel_selected_date_unassigned_internal(\'2026-09-29\');']:
        try: sql(query)
        except RuntimeError: passed.append('negative access/date rejected')
        else: raise AssertionError('negative accepted')
    # Enrich the bounded fixture with the real classifier's evidence dependencies.
    sql("""
    ALTER TABLE hotel_stays ADD COLUMN checked_in_at timestamptz;
    ALTER TABLE hotel_capacity_reservations ADD COLUMN daycare_schedule_id uuid;
    ALTER TABLE hotel_room_allocations ADD COLUMN id uuid DEFAULT gen_random_uuid();
    ALTER TABLE hotel_physical_occupancies ADD COLUMN id uuid, ADD COLUMN room_id uuid,
      ADD COLUMN capacity_reservation_id uuid, ADD COLUMN status text;
    CREATE TABLE hotel_physical_occupancy_members(occupancy_id uuid,hotel_stay_id uuid,archived_at timestamptz,status text);
    CREATE TABLE daycare_operation_states(operation_schedule_id uuid,lifecycle_status text);
    CREATE TABLE hotel_stay_schedule_events(hotel_stay_id uuid,operation_schedule_id uuid,event_kind text,archived_at timestamptz);
    CREATE TABLE operation_schedules(id uuid,starts_at timestamptz,status text,archived_at timestamptz,time_unspecified boolean DEFAULT false);
    CREATE TABLE long_stay_contracts(id uuid,current_hotel_stay_id uuid,status text,archived_at timestamptz);
    CREATE TABLE long_stay_absence_events(id uuid,long_stay_contract_id uuid,hotel_stay_id uuid,event_type text,is_open boolean,
      inventory_mode text,occurred_at timestamptz,archived_at timestamptz,return_capacity_id uuid,
      inventory_transition_status text,expected_return_date date,guarantee_from timestamptz,paired_leave_event_id uuid,released_capacity_id uuid,released_allocation_id uuid);
    -- Legacy provenance is tested by its own suite; no historical rows in this fixture.
    CREATE FUNCTION hotel_legacy_current_physical_rooms_internal()
      RETURNS TABLE(room_id uuid,capacity_id uuid,stay_id uuid,occupancy_id uuid)
      LANGUAGE sql STABLE AS $$ SELECT NULL::uuid,NULL::uuid,NULL::uuid,NULL::uuid WHERE false $$;
    """)
    DATA += ['hotel_physical_occupancy_members','daycare_operation_states','hotel_stay_schedule_events',
      'operation_schedules','long_stay_contracts','long_stay_absence_events']
    sql(function('supabase/migrations/202609280002_hotel_legacy_physical_carryover_v1.sql','hotel_current_physical_rooms_internal'))
    def arrival(n,at='2026-09-29 18:00+09',unknown=False):
        sql(f"INSERT INTO operation_schedules VALUES('{uid(n+2000)}',{q(at)},'scheduled',NULL,{str(unknown).lower()}); INSERT INTO hotel_stay_schedule_events VALUES('{uid(n)}','{uid(n+2000)}','check_in',NULL);")
    clear();cap(10);arrival(10)
    before=read()
    helpermeta="SELECT proowner,proacl,prorettype,proargtypes,prosecdef,proconfig FROM pg_proc WHERE oid='hotel_selected_date_unassigned_internal(date)'::regprocedure;"
    beforemeta=sql(helpermeta);beforedata=sql(digest)
    candidate=(ROOT/'supabase/migrations/202609280003_hotel_unassigned_classification_v1.sql').read_text()
    sql(function('supabase/migrations/202609280001_hotel_selected_date_unassigned_v1.sql','hotel_selected_date_unassigned_internal').replace('public.hotel_selected_date_unassigned_internal(', 'public.test_original_unassigned_membership(',1))
    # The public wrapper is a guarded dependency, not replaced by this migration.
    wrapper=function('supabase/migrations/202609280001_hotel_selected_date_unassigned_v1.sql','get_hotel_operations_snapshot_v2')
    assert sql("SELECT md5(prosrc) FROM pg_proc WHERE oid='get_hotel_operations_snapshot_v2(date)'::regprocedure;")=='56b2afa3112502405d1fc7cdb4ccddfe'
    sql(wrapper.replace("declare", "declare -- dependency drift",1))
    try: sql(candidate)
    except RuntimeError as error: assert 'STOP_UNASSIGNED_CLASSIFICATION_PREDECESSOR_MISMATCH' in str(error)
    else: raise AssertionError('wrapper drift accepted')
    assert beforemeta==sql(helpermeta) and beforedata==sql(digest) and before==read()
    passed.append('snapshot_v2 dependency drift aborts before helper replacement')
    sql(wrapper)
    sql(candidate)
    wrapped=json.loads(sql("BEGIN READ ONLY; SELECT get_hotel_operations_snapshot_v2('2026-09-29'); ROLLBACK;"))
    assert wrapped['selectedDateUnassigned']==read()
    assert wrapped['selectedDateUnassigned']['items'][0]['classification']=='ARRIVAL'
    assert wrapped['selectedDateUnassigned']['classificationSummary']['ARRIVAL']==1
    assert sql(meta)==oldmeta
    passed.append('current snapshot_v2 passes additive classification fields and summary with signature/ACL preserved')
    assert beforemeta==sql(helpermeta) and beforedata==sql(digest)
    result=read()
    for key in ('count','date','singleStayIds','sharedGroupIds'): assert before[key]==result[key]
    for a,b in zip(before['items'],result['items']):
        for key in a: assert a[key]==b[key]
    passed.append('candidate verbatim; existing helper owner/ACL/signature/data/membership preserved')
    def classify(name,expected,date='2026-09-29'):
        result=read(date)
        baseline=json.loads(sql(f"SELECT test_original_unassigned_membership({q(date)});"))
        for key in ('date','count','singleStayIds','sharedGroupIds'): assert baseline[key]==result[key],(name,key)
        for old,new in zip(baseline['items'],result['items']):
            for key in old: assert old[key]==new[key],(name,key)
        assert sum(result['classificationSummary'].values())==result['count'],result
        assert sorted(i['classification'] for i in result['items'])==sorted(expected),(name,result)
        passed.append(name);return result
    classify('A canonical initial arrival',['ARRIVAL'])
    clear();cap(10,start='2026-09-30 18:00+09');arrival(10,'2026-09-30 18:00+09');classify('B next-day membership excluded',[])
    # Historical fixture remains actually overdue regardless of the run date.
    actual_past=sql("SELECT least(statement_timestamp()-interval '2 days','2026-09-28 18:00+09'::timestamptz);")
    clear();cap(10,start=actual_past);arrival(10,actual_past);classify('C canonical previous-day late arrival',['LATE_ARRIVAL'])
    sql(f"UPDATE hotel_stays SET checked_in_at=statement_timestamp()-interval '1 hour';")
    classify('D checked in unresolved is not arrival',['CHECKED_IN_UNRESOLVED'])
    def returning(return_date='2026-09-29',mode='release_room'):
        clear();cap(10,start='2026-09-29 00:00+09');arrival(10,'2026-08-01 18:00+09')
        sql(f"UPDATE hotel_stays SET checked_in_at=statement_timestamp()-interval '2 days'; INSERT INTO long_stay_contracts VALUES('{uid(900)}','{uid(10)}','active',NULL); INSERT INTO long_stay_absence_events VALUES('{uid(901)}','{uid(900)}','{uid(10)}','leave',true,{q(mode)},statement_timestamp()-interval '1 day',NULL,'{uid(110)}','room_released',{q(return_date)},{q(return_date+' 00:00+09')},NULL,'{uid(111)}','{uid(902)}');")
        cap(11,start='2026-08-01 00:00+09',end='2026-09-28 00:00+09',stay=10,archived=True)
        sql(f"UPDATE long_stay_absence_events SET occurred_at='2026-09-27 00:00+09'; INSERT INTO hotel_room_allocations(capacity_reservation_id,room_id,allocated_from,allocated_until,archived_at,id) VALUES('{uid(111)}','{uid(500)}','2026-08-01 00:00+09','2026-09-28 00:00+09',NULL,'{uid(902)}');")
    returning();classify('E release_room canonical selected return',['LONG_STAY_RETURN'])
    returning();sql('UPDATE long_stay_absence_events SET released_allocation_id=NULL;');classify('return without release history fails closed',['OTHER'])
    returning('2026-09-30');classify('F capacity overlap but different return date',['OTHER'])
    returning(mode='keep_room');classify('keep_room never return; missing current room is safety',['CHECKED_IN_UNRESOLVED'])
    returning();sql('UPDATE long_stay_absence_events SET return_capacity_id=NULL;');classify('unlinked return capacity fails closed',['OTHER'])
    clear();shared();arrival(710);arrival(711);result=classify('G Shared all precheck-in one unit',['ARRIVAL']);assert result['count']==1
    sql(f"UPDATE hotel_stays SET checked_in_at=statement_timestamp()-interval '1 hour' WHERE id='{uid(710)}';")
    classify('H Shared partially checked in missing room',['CHECKED_IN_UNRESOLVED'])
    clear();cap(10);cap(11);arrival(10);arrival(11);sql(f"UPDATE hotel_stays SET dog_id='{uid(900)}';");classify('I same dog two canonical units',['ARRIVAL','ARRIVAL'])
    clear();cap(10);classify('J missing arrival proof is OTHER',['OTHER'])
    arrival(10);sql('INSERT INTO hotel_stay_schedule_events SELECT * FROM hotel_stay_schedule_events;');classify('J ambiguous arrival proof is OTHER',['OTHER'])
    clear();cap(10);arrival(10);sql("UPDATE operation_schedules SET status='cancelled';");classify('cancelled schedule never arrival',['OTHER'])
    clear();shared();arrival(710);arrival(711,'2026-09-30 18:00+09');classify('Shared mixed initial arrival days OTHER',['OTHER'])
    clear();shared();arrival(710);arrival(711);sql(f"UPDATE hotel_stays SET checked_out_at=now() WHERE id='{uid(710)}';");classify('Shared contradictory terminal member OTHER',['OTHER'])
    clear();cap(10);arrival(10,'2026-09-28 15:00+00',True);result=classify('KST boundary unknown time preserves date',['ARRIVAL']);assert result['items'][0]['arrivalTimeUnspecified']
    # Mixed membership invariant: baseline fields never change with classification.
    cap(11,start=actual_past);arrival(11,actual_past);cap(12);cap(13);arrival(13)
    sql(f"UPDATE hotel_stays SET checked_in_at=now() WHERE id='{uid(13)}';")
    classify('K classification sum equals broad canonical count',['ARRIVAL','LATE_ARRIVAL','OTHER','CHECKED_IN_UNRESOLVED'])
    # Relative clock fixtures: these tests must remain valid after September 2026.
    times=json.loads(sql("SELECT jsonb_build_object('today',(statement_timestamp() AT TIME ZONE 'Asia/Seoul')::date,'tomorrow',(statement_timestamp() AT TIME ZONE 'Asia/Seoul')::date+1,'selected',(statement_timestamp() AT TIME ZONE 'Asia/Seoul')::date+2,'end',(statement_timestamp() AT TIME ZONE 'Asia/Seoul')::date+10,'past',statement_timestamp()-interval '2 days','future',((statement_timestamp() AT TIME ZONE 'Asia/Seoul')::date+1)::timestamp AT TIME ZONE 'Asia/Seoul','unknownToday',((statement_timestamp() AT TIME ZONE 'Asia/Seoul')::date)::timestamp AT TIME ZONE 'Asia/Seoul','unknownPast',((statement_timestamp() AT TIME ZONE 'Asia/Seoul')::date-1)::timestamp AT TIME ZONE 'Asia/Seoul');"))
    def relative_single(at,unknown=False):
        clear();cap(10,start=at,end=times['end']+' 00:00+09');arrival(10,at,unknown)
    relative_single(times['future']);classify('TIME A future initial arrival / later selected date is planned',['PLANNED_STAY_UNASSIGNED'],times['selected'])
    classify('TIME E arrival date wins even before future initial arrival',['ARRIVAL'],times['tomorrow'])
    relative_single(times['past']);classify('TIME B actually passed known timestamp is late',['LATE_ARRIVAL'],times['selected'])
    relative_single(times['unknownToday'],True);classify('TIME C unknown today never fake-midnight late',['PLANNED_STAY_UNASSIGNED'],times['selected'])
    relative_single(times['unknownPast'],True);classify('TIME D unknown previous KST date is late',['LATE_ARRIVAL'],times['selected'])
    def relative_shared(at,unknown=False):
        clear();shared();arrival(710,at,unknown);arrival(711,at,unknown)
        sql(f"UPDATE family_shared_room_groups SET normalized_starts_at={q(at)},normalized_ends_at={q(times['end']+' 00:00+09')}; UPDATE hotel_capacity_reservations SET reserved_from={q(at)},reserved_until={q(times['end']+' 00:00+09')};")
    relative_shared(times['future']);result=classify('TIME F Shared future prior-date plan group once',['PLANNED_STAY_UNASSIGNED'],times['selected']);assert result['count']==1
    relative_shared(times['past']);result=classify('TIME G Shared actually overdue group once',['LATE_ARRIVAL'],times['selected']);assert result['count']==1
    relative_shared(times['unknownToday'],True);classify('Shared unknown today remains planned',['PLANNED_STAY_UNASSIGNED'],times['selected'])
    relative_shared(times['unknownPast'],True);classify('Shared unknown prior KST day is actually late',['LATE_ARRIVAL'],times['selected'])
    relative_shared(times['future']);sql(f"UPDATE hotel_stays SET checked_in_at=statement_timestamp()-interval '1 hour' WHERE id='{uid(710)}';")
    classify('Shared partial actual entry retains safety priority over planned',['CHECKED_IN_UNRESOLVED'],times['selected'])
    relative_single(times['past']);classify('Arrival selected-date priority retained even when actual timestamp passed',['ARRIVAL'],sql(f"SELECT ({q(times['past'])}::timestamptz AT TIME ZONE 'Asia/Seoul')::date;"))
    returning();classify('TIME H return priority remains ahead of late/planned',['LONG_STAY_RETURN'])
    relative_single(times['future']);cap(11,start=times['past'],end=times['end']+' 00:00+09');arrival(11,times['past'])
    result=classify('TIME I planned and late preserve broad membership and six-summary invariant',['PLANNED_STAY_UNASSIGNED','LATE_ARRIVAL'],times['selected'])
    assert len(result['classificationSummary'])==6 and result['count']==2
    for query in ["SET test.allowed='no'; SELECT hotel_selected_date_unassigned_internal('2026-09-29');", "SET ROLE authenticated; SELECT hotel_selected_date_unassigned_internal('2026-09-29');"]:
        try: sql(query)
        except RuntimeError: passed.append('classifier negative access preserved')
        else: raise AssertionError('unauthorized classifier accepted')
    # Exact guard mismatch fails transactionally and does not rewrite the function.
    installed=sql("SELECT md5(prosrc) FROM pg_proc WHERE oid='hotel_selected_date_unassigned_internal(date)'::regprocedure;")
    try: sql(candidate)
    except RuntimeError as error: assert 'STOP_UNASSIGNED_CLASSIFICATION_PREDECESSOR_MISMATCH' in str(error)
    else: raise AssertionError('reapply unexpectedly accepted')
    assert installed==sql("SELECT md5(prosrc) FROM pg_proc WHERE oid='hotel_selected_date_unassigned_internal(date)'::regprocedure;")
    passed.append('predecessor mismatch transaction preserved')
    print(json.dumps({'status':'PASS','tests':len(passed),'cases':passed,'scope':'isolated read-model fixture; no Production writes; no full lifecycle emulator'},ensure_ascii=False,indent=2))
finally:
    if (cluster/'data/postmaster.pid').exists():run([PG/'pg_ctl','-D',cluster/'data','stop','-m','fast'])
