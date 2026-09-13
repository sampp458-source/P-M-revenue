"""Local synthetic PostgreSQL only. Requires 016 fixture template + 016B migration.
Uses a proven lock-wait barrier, not a guessed scheduling delay.
"""
import os
import pathlib
import subprocess
import time

base = ['psql', '-X', '-h', '/tmp/016-validation', '-p', '55486', '-U', 'qa016',
        '-d', 'missed_checkin_fixture_016b', '-v', 'ON_ERROR_STOP=1', '-At']
uid = lambda n: f'20000000-0000-4000-8000-{n:012d}'
def query(sql):
    return subprocess.check_output(base + ['-c', sql], text=True).strip()
assert query("select current_database()='missed_checkin_fixture_016b' and inet_server_addr() is null") == 't'
source = pathlib.Path(__file__).with_name('202609130001_hotel_missed_check_in_recovery_runtime_qa.sql').read_text()
seed = source[:source.index('SAVEPOINT scenario;')] + 'COMMIT;'
cleanup = '''TRUNCATE public.hotel_missed_check_in_receipts, public.hotel_single_check_in_receipts,
 public.hotel_room_allocations,public.hotel_capacity_reservations,public.hotel_stays,public.profiles,
 public.hotel_stay_schedule_events,public.operation_schedules,public.hotel_rooms,public.hotel_room_types,
 public.entity_audit_events;'''
actual = "(((statement_timestamp() AT TIME ZONE 'UTC')::date-2)+time '00:51') AT TIME ZONE 'UTC'"
def start(name):
    return subprocess.Popen(base, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            text=True, env={**os.environ, 'PGAPPNAME': name})
def send(p, sql):
    p.stdin.write(sql+'\n'); p.stdin.flush()
def ready(p):
    while True:
        line = p.stdout.readline()
        if line.strip() == 'BARRIER_READY': return
        if not line: raise AssertionError(p.stderr.read())
def wait_for_lock(name):
    deadline = time.monotonic()+5
    while time.monotonic()<deadline:
        if query("select count(*) from pg_stat_activity where application_name='"+name+"' and wait_event_type='Lock'") == '1': return
        time.sleep(.02)
    raise AssertionError('Competitor did not wait for canonical room lock')
def command(stay, request):
    return f"SELECT set_config('test.actor','{uid(1)}',true); SELECT public.recover_missed_hotel_check_in('{uid(stay)}',1,1,'{uid(3)}',{actual},'{uid(request)}');"
try:
    subprocess.run(base, input=seed, text=True, check=True, capture_output=True)
    # The second synthetic stay's prior allocation only supported the boundary test.
    query(f"DELETE FROM public.hotel_room_allocations WHERE id='{uid(9)}'")
    a=start('016b_first'); send(a,'BEGIN;'+command(4,10)+" SELECT 'BARRIER_READY';"); ready(a)
    b=start('016b_competitor'); send(b,'BEGIN;'+command(14,11)+' COMMIT;'); b.stdin.close()
    wait_for_lock('016b_competitor')
    send(a,'COMMIT;'); a.stdin.close(); a.wait(timeout=5); b.wait(timeout=5)
    assert a.returncode==0, a.stderr.read()
    assert b.returncode!=0 and '입실 기간' in b.stderr.read()
    assert query('SELECT count(*) FROM hotel_missed_check_in_receipts')=='1'
    print('PASS: simultaneous competing recovery, exactly one success/receipt')
    query(cleanup)
    subprocess.run(base, input=seed, text=True, check=True, capture_output=True)
    query(f"UPDATE hotel_capacity_reservations SET reserved_until=clock_timestamp()+interval '3seconds' WHERE id='{uid(6)}'")
    a=start('016b_room_holder'); send(a,f"BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('hotel-room:{uid(3)}',0)); SELECT 'BARRIER_READY';"); ready(a)
    b=start('016b_expiry_waiter'); send(b,'BEGIN;'+command(4,12).replace("',1,1,", "',1,2,")+' COMMIT;'); b.stdin.close()
    wait_for_lock('016b_expiry_waiter')
    query('SELECT pg_sleep(3.1)')
    send(a,'COMMIT;');a.stdin.close();a.wait(timeout=5);b.wait(timeout=5)
    assert b.returncode!=0 and 'RECOVERY_WINDOW_CLOSED' in b.stderr.read()
    assert query('SELECT count(*) FROM hotel_missed_check_in_receipts')=='0'
    assert query(f"SELECT checked_in_at IS NULL FROM hotel_stays WHERE id='{uid(4)}'")=='t'
    print('PASS: expiry during room-lock wait rejects without partial write')
finally:
    query(cleanup)
