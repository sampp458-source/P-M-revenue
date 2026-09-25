"""Called only by the Unix-socket synthetic runner. Two genuine entry RPCs race."""
import subprocess
import time
from pathlib import Path


def verify(pg, cluster, root):
    cmd = [str(pg/'psql'), '-X', '-h', str(cluster), '-p', '55519', '-U', 'postgres', '-d', 'single_checkin_fixture_016', '-v', 'ON_ERROR_STOP=1', '-At']
    def sql(text):
        result = subprocess.run(cmd, input=text, text=True, capture_output=True)
        assert result.returncode == 0, result.stderr
        return result.stdout
    seed = (root/'supabase/tests/hotel_physical_occupancy_v1_qa.sql').read_text().split('-- A stale preallocation')[0]
    seed += '''
    DELETE FROM hotel_room_allocations WHERE id=pg_temp.f(41);
    UPDATE hotel_room_allocations SET allocated_from=now()-interval '3 hours' WHERE id=pg_temp.f(42);
    INSERT INTO hotel_room_allocations(id,capacity_reservation_id,room_id,allocated_from,allocated_until,created_by,updated_by)
    VALUES(pg_temp.f(43),pg_temp.f(32),pg_temp.f(12),now()-interval '1 hour',now()+interval '1 day',pg_temp.f(900),pg_temp.f(900));
    COMMIT;
    '''
    sql(seed)
    actor = "SELECT set_config('test.actor','00000000-0000-4000-8000-000000000900',false);"
    first = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    first.stdin.write("BEGIN;"+actor+"SELECT complete_hotel_check_in('00000000-0000-4000-8000-000000000021',1,now()-interval '2 hours',gen_random_uuid()); SELECT pg_sleep(1); COMMIT;")
    first.stdin.close()
    # Wait until the first command holds the room lock, rather than relying on a fixed startup delay.
    deadline = time.monotonic()+5
    while time.monotonic()<deadline:
        if 't' in sql("SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND granted AND pid<>pg_backend_pid());"):
            break
        time.sleep(.02)
    second = subprocess.run(cmd, input=actor+"SELECT complete_hotel_check_in('00000000-0000-4000-8000-000000000022',1,now(),gen_random_uuid());", text=True, capture_output=True)
    first.wait(timeout=10)
    err = first.stderr.read()
    assert first.returncode == 0, err
    assert second.returncode != 0 and '실제 퇴실이 완료되지 않은 호실' in second.stderr, second.stderr
    assert sql("SELECT count(*) FROM public.hotel_current_physical_rooms_internal();").strip()=='1'
    return {'result':'PASS','successfulPhysicalEntries':1,'rejectedPhysicalEntries':1}
