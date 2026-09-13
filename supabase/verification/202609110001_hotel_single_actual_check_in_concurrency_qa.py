# LOCAL SYNTHETIC ONLY. Requires fixture setup and migration on the fixed Unix socket.
import subprocess,time,pathlib
base=['psql','-X','-h','/tmp/016-validation','-p','55486','-U','qa016','-d','single_checkin_fixture_016','-v','ON_ERROR_STOP=1','-At']
u=lambda n:f'20000000-0000-4000-8000-{n:012d}'
guard=subprocess.check_output(base+['-c', "select current_database()='single_checkin_fixture_016' and inet_server_addr() is null"],text=True).strip()
assert guard=='t', 'LOCAL_ONLY'
qa=pathlib.Path(__file__).with_name('202609110001_hotel_single_actual_check_in_runtime_qa.sql').read_text()
seed=qa[qa.index("SELECT set_config('test.actor'"):qa.index('SAVEPOINT scenario;')]
subprocess.run(base,input='BEGIN;'+seed+f"DELETE FROM public.hotel_room_allocations WHERE id='{u(9)}'; COMMIT;",text=True,check=True,capture_output=True)
def sql(stay,req,pause):return f"BEGIN; SELECT set_config('test.actor','{u(1)}',true); SELECT public.check_in_unassigned_hotel_stay('{u(stay)}',1,1,'{u(3)}','2002-01-01 00:51Z','{u(req)}'); SELECT pg_sleep({pause}); COMMIT;"
a=subprocess.Popen(base,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True);a.stdin.write(sql(4,10,1));a.stdin.close()
time.sleep(.2)
b=subprocess.run(base,input=sql(14,11,0),capture_output=True,text=True)
a.wait();out=a.stdout.read();err=a.stderr.read()
assert a.returncode==0,(out,err)
assert b.returncode!=0 and '입실 기간' in b.stderr,b.stderr
print('CONCURRENCY: PASS — first success, competing second conflict after wait')
count=subprocess.check_output(base+['-c','select count(*) from hotel_single_check_in_receipts'],text=True).strip();assert count=='1',count
print('SUCCESS_RECEIPTS: 1')

# Remove only synthetic rows created by this run; no schema or function cleanup.
subprocess.run(base,input="BEGIN; TRUNCATE public.hotel_single_check_in_receipts,public.hotel_room_allocations,public.hotel_capacity_reservations,public.hotel_stays,public.profiles,public.hotel_stay_schedule_events,public.operation_schedules,public.hotel_rooms,public.hotel_room_types,public.entity_audit_events; COMMIT;",text=True,check=True,capture_output=True)
