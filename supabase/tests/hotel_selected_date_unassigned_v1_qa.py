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
cluster = Path(tempfile.mkdtemp(prefix='selected-date-qa-'))
passed = []
def run(args, source=None):
    p = subprocess.run([str(a) for a in args], input=source, text=True, capture_output=True)
    if p.returncode: raise RuntimeError(p.stderr)
    return p.stdout.strip()
def sql(source):
    return run([PG/'psql','-X','-h',cluster,'-p','55539','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-Atq'], source)
def function(path, name):
    return re.search(r'create(?: or replace)? function public\.'+name+r'\([\s\S]*?as (\$\w*\$)[\s\S]*?\1;', (ROOT/path).read_text(), re.I)[0]
def uid(n): return f'00000000-0000-4000-8000-{n:012d}'
def q(s): return 'NULL' if s is None else "'"+str(s).replace("'","''")+"'"
def cap(n, start='2026-09-29 18:00+09', end='2026-10-02 19:00+09', stay=None, archived=False):
    stay = n if stay is None else stay
    sql(f"INSERT INTO hotel_stays VALUES('{uid(stay)}',NULL,NULL,NULL) ON CONFLICT DO NOTHING; INSERT INTO hotel_capacity_reservations VALUES('{uid(n+100)}','{uid(stay)}',NULL,'stay','{uid(1)}',{q(start)},{q(end)},1,{'now()' if archived else 'NULL'});")
def alloc(n,start,end,archived=False):
    sql(f"INSERT INTO hotel_room_allocations VALUES('{uid(n+100)}','{uid(500)}',{q(start)},{q(end)},{'now()' if archived else 'NULL'});")
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
    INSERT INTO hotel_capacity_reservations VALUES('{uid(703)}',NULL,'{uid(702)}','shared_group','{uid(1)}','2026-09-29 18:00+09','2026-10-02 19:00+09',1,NULL);
    """)
    for n in (710,711):
        sql(f"INSERT INTO dogs VALUES('{uid(n)}','{uid(700)}','fixture'); INSERT INTO hotel_stays VALUES('{uid(n)}','{uid(n)}',NULL,NULL); INSERT INTO family_booking_members VALUES('{uid(n)}','{uid(702)}','{uid(701)}','{uid(n)}','{uid(n)}','hotel','{n}',NULL);")
try:
    run([PG/'initdb','-D',cluster/'data','--auth=trust','--username=postgres','--no-locale','--encoding=UTF8'])
    run([PG/'pg_ctl','-D',cluster/'data','-l',cluster/'server.log','-o',f"-h '' -k {cluster} -p 55539",'start'])
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
    print(json.dumps({'status':'PASS','tests':len(passed),'cases':passed,'scope':'isolated read-model fixture; no Production writes; no full lifecycle emulator'},ensure_ascii=False,indent=2))
finally:
    if (cluster/'data/postmaster.pid').exists():run([PG/'pg_ctl','-D',cluster/'data','stop','-m','fast'])
