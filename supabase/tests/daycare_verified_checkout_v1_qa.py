"""Socket-only QA of the exact new migrations against an explicitly supplied captured schema.
The schema/seed must be local, anonymized fixtures. No remote DSN or credentials are accepted.
This tests the new command, not a claim of full current Production RLS/catalog alignment.
"""
import argparse
import concurrent.futures
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import uuid

ROOT = Path(__file__).resolve().parents[2]
PG = Path('/opt/homebrew/opt/postgresql@18/bin')
p = argparse.ArgumentParser()
p.add_argument('--schema-fixture', type=Path, required=True)
p.add_argument('--seed-file', type=Path, required=True)
p.add_argument('--output', type=Path, required=True)
a = p.parse_args()
a.output.mkdir(parents=True, exist_ok=True)
cluster = Path(tempfile.mkdtemp(prefix='pnm-verified-checkout-'))
port = '55601'
checks = []
actor = '00000000-0000-4000-8000-000000000900'
auth = f"select set_config('request.jwt.claim.sub','{actor}',false);"
report = {'boundary': 'Explicit historical captured full-schema fixture and synthetic seed; exact candidate SQL. Not a full current Production clone.', 'checks': checks,
          'schemaSHA256': hashlib.sha256(a.schema_fixture.read_bytes()).hexdigest(), 'seedSHA256': hashlib.sha256(a.seed_file.read_bytes()).hexdigest()}

def run(args, **kw):
    r = subprocess.run([str(x) for x in args], text=True, capture_output=True, **kw)
    if r.returncode:
        raise RuntimeError(r.stderr[-6000:])
    return r.stdout

def sql(source):
    r = subprocess.run([str(PG/'psql'), '-X', '-Atq', '-v', 'ON_ERROR_STOP=1', '-h', str(cluster), '-p', port, '-U', 'postgres', '-d', 'daycare_department_final_qa'], input=source, text=True, capture_output=True)
    with (a.output/'sql.log').open('a') as log:
        log.write(r.stdout+r.stderr)
    if r.returncode:
        raise RuntimeError(r.stderr[-6000:])
    return r.stdout.strip()

def check(name, value):
    if not value:
        raise AssertionError(name)
    checks.append(name)
    print('PASS', name, flush=True)

def rejected(name, source, message):
    try:
        sql(source)
    except RuntimeError as error:
        check(name, message in str(error))
        return
    raise AssertionError(name+' unexpectedly accepted')

def obj(source):
    return json.loads(sql(source).splitlines()[-1])

def create(n, day, room=None, checkin=True):
    room = room or n
    value = obj(auth+f"select create_daycare_reservation('00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000030','00000000-0000-4000-8000-000000000800','00000000-0000-4000-8000-{n:012d}','{day}','09:00','18:00','00000000-0000-4000-8000-000000000040','00000000-0000-4000-8000-{50+room:012d}',array['{actor}'::uuid],null,gen_random_uuid());")
    if checkin:
        value = obj(auth+f"select complete_daycare_check_in('{value['operationScheduleId']}',{value['version']},'{day} 09:00+09',gen_random_uuid());")
    return value

def command(value, at, rid=None, confirmed='true', version=None):
    rid = rid or str(uuid.uuid4())
    return f"select complete_verified_daycare_check_out_v1('{value['operationScheduleId']}',{value['version'] if version is None else version},{'null' if at is None else repr(at)},'{rid}',{confirmed});"

def digest():
    return sql("select md5(jsonb_build_object('state',(select jsonb_agg(to_jsonb(t) order by operation_schedule_id) from daycare_operation_states t),'schedule',(select jsonb_agg(to_jsonb(t) order by id) from operation_schedules t),'capacity',(select jsonb_agg(to_jsonb(t) order by id) from hotel_capacity_reservations t),'allocation',(select jsonb_agg(to_jsonb(t) order by id) from hotel_room_allocations t),'audit',(select jsonb_agg(to_jsonb(t) order by id) from entity_audit_events t))::text);")

try:
    run([PG/'initdb', '-D', cluster/'data', '--auth=trust', '--username=postgres', '--no-locale', '--encoding=UTF8'])
    run([PG/'pg_ctl', '-D', cluster/'data', '-l', cluster/'server.log', '-o', f"-h '' -k {cluster} -p {port}", 'start'])
    run([PG/'createdb', '-h', cluster, '-p', port, '-U', 'postgres', 'daycare_department_final_qa'])
    sql('create role anon; create role authenticated; create role service_role bypassrls; create role supabase_admin; create role supabase_auth_admin; create role authenticator;')
    sql(a.schema_fixture.read_text())
    sql("insert into business_units(id,code,name,sort_order) values('70000000-0000-4000-8000-000000000101','hotel','Synthetic Hotel',1);")
    sql(a.seed_file.read_text())
    sql("create table public.qa_function_baseline as select oid,prosrc,proacl from pg_proc where pronamespace='public'::regnamespace;")
    for file in ['202610200001_overdue_daycare_operations_v1.sql','202610200002_daycare_verified_checkout_v1.sql']:
        sql((ROOT/'supabase/migrations'/file).read_text())
    check('all preexisting RPC bodies and ACLs unchanged',sql("select not exists(select 1 from qa_function_baseline b join pg_proc p on p.oid=b.oid where p.prosrc is distinct from b.prosrc or p.proacl is distinct from b.proacl);")=='t')
    day = sql("select ((statement_timestamp() at time zone 'Asia/Seoul')::date-3)::text;")
    following = sql("select ((statement_timestamp() at time zone 'Asia/Seoul')::date-2)::text;")
    today = sql("select (statement_timestamp() at time zone 'Asia/Seoul')::date::text;")
    first = create(1,day)
    second = create(2,day)
    third = create(3,day)
    check('new read returns only minimal operational fields', all(set(x)=={'operationScheduleId','version','startsAt','checkedInAt','checkedOutAt','dog','roomAllocation'} and set(x['dog'])=={'name'} and (x['roomAllocation'] is None or set(x['roomAllocation'])=={'roomId','roomName'}) for x in obj(auth+'select get_overdue_daycare_operations_v1();')))
    sql("update customers set phone='010-1234-9999',name='PRIVATE CUSTOMER' where id='00000000-0000-4000-8000-000000000800';")
    raw=sql(auth+'select get_overdue_daycare_operations_v1();')
    check('read contains no contact, customer or memo data', '010-1234-9999' not in raw and 'PRIVATE CUSTOMER' not in raw and 'customer' not in raw and 'memo' not in raw)
    for signature in ['get_overdue_daycare_operations_v1()','complete_verified_daycare_check_out_v1(uuid,integer,timestamptz,uuid,boolean)']:
        for role in ['anon','service_role']:
            check(role+' execute denied: '+signature,sql(f"select not has_function_privilege('{role}','{signature}','execute');")=='t')
        check('authenticated execute allowed: '+signature,sql(f"select has_function_privilege('authenticated','{signature}','execute');")=='t')
        check('PUBLIC execute absent: '+signature,sql(f"select not exists(select 1 from pg_proc p, lateral aclexplode(p.proacl) a where p.oid='{signature}'::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE');")=='t')
        check('SECURITY DEFINER fixed search_path postgres owner: '+signature,sql(f"select prosecdef and proowner='postgres'::regrole and proconfig=array['search_path=public, pg_temp'] from pg_proc where oid='{signature}'::regprocedure;")=='t')
    rejected('anon SQL role cannot execute command','set role anon;'+command(first,following+' 17:00+09'),'permission denied')
    rejected('anon SQL role cannot execute read','set role anon; select get_overdue_daycare_operations_v1();','permission denied')
    rejected('service SQL role cannot execute command','set role service_role;'+auth+command(first,following+' 17:00+09'),'permission denied')
    check('authenticated SQL role can read with valid claims',len(obj('set role authenticated;'+auth+'select get_overdue_daycare_operations_v1();'))==3)
    rejected('anonymous command blocked',command(first,following+' 17:00+09'),'권한')
    rejected('anonymous read blocked','select get_overdue_daycare_operations_v1();','권한')
    sql(f"update operation_memberships set is_active=false where profile_id='{actor}';")
    rejected('inactive Operations command blocked',auth+command(first,following+' 17:00+09'),'권한')
    rejected('inactive Operations read blocked',auth+'select get_overdue_daycare_operations_v1();','권한')
    sql(f"update operation_memberships set is_active=true where profile_id='{actor}';")
    other='00000000-0000-4000-8000-000000000901'
    sql(f"insert into auth.users(id,email) values('{other}','reader@example.invalid'); insert into profiles(id,name,role,is_active,account_status) values('{other}','Synthetic Reader','staff',true,'active'); update operation_memberships set role='staff',is_active=true where profile_id='{other}';")
    other_auth=f"select set_config('request.jwt.claim.sub','{other}',false);"
    check('active Operations reader keeps existing all-Operations read scope',len(obj(other_auth+'select get_overdue_daycare_operations_v1();'))==3)
    rejected('unassigned non-owner cannot write another schedule',other_auth+command(first,following+' 17:00+09'),'해당 일정')
    rejected('unknown actual checkout rejected',auth+command(first,None),'확인한 실제 퇴실')
    rejected('unverified actual checkout rejected',auth+command(first,following+' 17:00+09',confirmed='false'),'확인한 실제 퇴실')
    rejected('infinite actual checkout rejected',auth+command(first,'infinity'),'미래')
    rejected('future actual checkout rejected',auth+command(first,'2099-10-20 17:00+09'),'미래')
    rejected('before actual entry rejected',auth+command(first,day+' 08:59+09'),'실제 입실보다')
    rejected('equal actual entry rejected',auth+command(first,day+' 09:00+09'),'실제 입실보다')
    rejected('stale version rejected',auth+command(first,following+' 17:00+09',version=1),'먼저')
    before=digest()
    # Late failure after state/schedule/capacity writes must roll everything back, including audits.
    sql("create function public.qa_fail_allocation() returns trigger language plpgsql as $$begin if current_setting('test.fail_allocation',true)='on' then raise exception 'QA_ATOMIC_FAILURE'; end if; return new; end$$; create trigger qa_late_failure before update on hotel_room_allocations for each row execute function qa_fail_allocation();")
    rejected('late failure rolls back entire command',auth+"set test.fail_allocation='on';"+command(first,following+' 17:00+09'),'QA_ATOMIC_FAILURE')
    check('late-failure digest identical including audit and receipts',digest()==before)
    rid=str(uuid.uuid4())
    audit_ids=sql("select coalesce(jsonb_agg(id order by id),'[]') from entity_audit_events;")
    audit_count=int(sql('select count(*) from entity_audit_events;'))
    physical_before=int(sql('select count(distinct room_id) from hotel_current_physical_rooms_internal();'))
    result=obj('set role authenticated;'+auth+command(first,following+' 17:00+09',rid))
    check('cross-date actual timestamp preserved',sql(f"select checked_out_at=timestamptz '{following} 17:00+09' from daycare_operation_states where operation_schedule_id='{first['operationScheduleId']}';")=='t')
    report['newAuditRowsForCrossDate']=int(sql('select count(*) from entity_audit_events;'))-audit_count
    check('cross-date appends four audits without editing old records',report['newAuditRowsForCrossDate']==4)
    check('recorded timestamp and actor are current, not backdated',sql(f"select checked_out_by='{actor}' and updated_by='{actor}' and updated_at>=statement_timestamp()-interval '1 minute' and updated_at>checked_out_at from daycare_operation_states where operation_schedule_id='{first['operationScheduleId']}';")=='t')
    check('canonical schedule/state versions synchronized',sql(f"select d.schedule_version=s.version and s.status='completed' and d.lifecycle_status='completed' and d.version={first['version']+1} from daycare_operation_states d join operation_schedules s on s.id=d.operation_schedule_id where s.id='{first['operationScheduleId']}';")=='t')
    check('same capacity and allocation identities extended exactly to actual checkout',sql(f"select c.reserved_until=timestamptz '{following} 17:00+09' and a.allocated_until=c.reserved_until and c.quantity=1 and c.id='{first['capacityReservation']['id']}' and a.id='{first['roomAllocation']['id']}' from hotel_capacity_reservations c join hotel_room_allocations a on a.capacity_reservation_id=c.id where c.id='{first['capacityReservation']['id']}';")=='t')
    check('checkout releases exactly one physical room',int(sql('select count(distinct room_id) from hotel_current_physical_rooms_internal();'))==physical_before-1)
    check('all prior audits retained',sql(f"select (select count(*) from entity_audit_events where id in(select value::uuid from jsonb_array_elements_text('{audit_ids}'::jsonb)))=jsonb_array_length('{audit_ids}'::jsonb);")=='t')
    check('new audit attributes actor, request, reason, actual and recorded timestamps',sql(f"select count(*)=1 from entity_audit_events where entity_type='daycare_operation_states' and entity_id='{first['operationScheduleId']}' and request_id='{rid}' and changed_by='{actor}' and change_reason like '%실제 퇴실%' and after_data->>'checked_out_at' is not null and created_at>timestamptz '{following} 17:00+09';")=='t')
    after=digest()
    check('same request ID replay is successful and write-free',obj(auth+command(first,following+' 17:00+09',rid))==result and digest()==after)
    rejected('changed payload on same request ID rejected',auth+command(first,following+' 16:00+09',rid),'동일 요청 ID')
    rejected('new request cannot check out completed record again',auth+command(first,following+' 17:00+09',version=result['version']),'입실 중인')
    check('completed record disappears from overdue list',first['operationScheduleId'] not in [x['operationScheduleId'] for x in obj(auth+'select get_overdue_daycare_operations_v1();')])
    # Old same-day command is unchanged, separately verified on another record.
    obj(auth+f"select complete_daycare_check_out('{second['operationScheduleId']}',{second['version']},'{day} 17:00+09',gen_random_uuid());")
    check('existing same-day checkout still succeeds',sql(f"select lifecycle_status='completed' from daycare_operation_states where operation_schedule_id='{second['operationScheduleId']}';")=='t')
    # A different planned booking begins after old planned end, but before proposed actual exit.
    blocker=create(9,following,room=3,checkin=False)
    rejected('later allocation in actual extension blocks recovery',auth+command(third,following+' 17:00+09'),'배정 이력')
    check('conflict leaves original hold and version unchanged',sql(f"select lifecycle_status='checked_in' and version={third['version']} and checked_out_at is null from daycare_operation_states where operation_schedule_id='{third['operationScheduleId']}';")=='t')
    obj(auth+command(third,following+' 09:00+09'))
    check('half-open allocation boundary permits exact next-booking start',sql(f"select checked_out_at=timestamptz '{following} 09:00+09' from daycare_operation_states where operation_schedule_id='{third['operationScheduleId']}';")=='t')
    old_day=sql("select ((statement_timestamp() at time zone 'Asia/Seoul')::date-5)::text;")
    create(9,old_day,room=7,checkin=False)
    seventh=create(7,day)
    obj(auth+command(seventh,following+' 17:00+09'))
    check('past-only planned allocation does not block later actual checkout',sql(f"select lifecycle_status='completed' from daycare_operation_states where operation_schedule_id='{seventh['operationScheduleId']}';")=='t')
    # Import a synthetic inconsistent actual-history record (no triggers disabled): planned slot stays disjoint.
    fourth=create(4,day)
    tomorrow=sql("select ((statement_timestamp() at time zone 'Asia/Seoul')::date+1)::text;")
    later=create(8,tomorrow,room=4,checkin=False)
    sql(auth+f"update daycare_operation_states set lifecycle_status='completed',checked_in_at=timestamptz '{following} 10:00+09',checked_in_by='{actor}',checked_out_at=timestamptz '{following} 11:00+09',checked_out_by='{actor}',updated_by='{actor}' where operation_schedule_id='{later['operationScheduleId']}';")
    # Shift only the synthetic plan to begin after the entry we are testing; the command must use actual evidence.
    # Plan starts today, actual source says earlier: fail closed instead of treating missing historical room coverage as empty.
    rejected('ambiguous actual entry earlier than its allocation fails closed',auth+command(fourth,today+' 08:00+09'),'점유 이력')
    fifth=create(5,day)
    fixed_version=fifth['version']
    def concurrent_call(_):
        try:
            return obj(auth+command(fifth,following+' 17:00+09',version=fixed_version))
        except RuntimeError as e:
            return str(e)
    with concurrent.futures.ThreadPoolExecutor(2) as pool:
        values=list(pool.map(concurrent_call,[1,2]))
    check('concurrent different requests: one commit, one stale rejection',sum(isinstance(v,dict) for v in values)==1 and any('먼저' in v for v in values if isinstance(v,str)))
    sixth=create(6,day)
    replay_id=str(uuid.uuid4())
    def replay_call(_):return obj(auth+command(sixth,following+' 17:00+09',replay_id))
    with concurrent.futures.ThreadPoolExecutor(2) as pool:
        values=list(pool.map(replay_call,[1,2]))
    check('concurrent same request replays one completion',values[0]==values[1] and values[0]['version']==sixth['version']+1)
    report['passed']=len(checks)
except Exception as error:
    report['error']=str(error)
finally:
    subprocess.run([str(PG/'pg_ctl'),'-D',str(cluster/'data'),'-m','immediate','stop'],capture_output=True)
    (a.output/'result.json').write_text(json.dumps(report,indent=2))
    print(json.dumps(report,indent=2))
raise SystemExit(1 if report.get('error') else 0)
