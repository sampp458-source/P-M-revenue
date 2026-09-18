"""LOCAL socket-only current-baseline real RPC/removal concurrency. No helper substitute.
Usage: python3 real_rpc_concurrency.py <build-result.json> <output-dir>
Requires a running seeded baseline with correction + V2-B already applied.
Each case uses a separate local database clone. Does not apply migrations.
"""
from pathlib import Path
import subprocess,json,time,sys
pg=Path('/opt/homebrew/opt/postgresql@18/bin'); report=json.loads(Path(sys.argv[1]).read_text()); sock=Path(report['cluster']); out=Path(sys.argv[2]);out.mkdir(parents=True,exist_ok=True)
assert sock.is_dir() and sock.name.startswith('dog-current-baseline-')
base='dog_current_baseline'
def args(db):return [str(pg/'psql'),'-X','-h',str(sock),'-p','55509','-U','postgres','-d',db,'-v','ON_ERROR_STOP=1','-At']
def sql(s,db=base):return subprocess.run(args(db),input=s,text=True,capture_output=True)
f=lambda n:"'00000000-0000-4000-8000-"+str(n).zfill(12)+"'::uuid"
auth="SET LOCAL request.jwt.claim.sub='00000000-0000-4000-8000-000000000900'; SET LOCAL ROLE authenticated;"
def removal(n):return f"SELECT remove_dog_profile({f(n)},1,preview_dog_profile_removal({f(n)})->>'graphFingerprint','hard_delete',gen_random_uuid(),'Synthetic race');"
def rpc(kind):
 if kind=='schedule':return f"SELECT create_operation_schedule({f(22)},{f(30)},'Synthetic race',now()+interval '3 days',now()+interval '3 days 1 hour',false,false,'Synthetic',ARRAY[{f(900)}],ARRAY[{f(800)}],ARRAY[{f(7)}],gen_random_uuid());"
 if kind=='hotel':return f"SELECT create_flexible_hotel_reservation({f(20)},{f(30)},current_date+3,'09:00',false,current_date+4,'15:00',false,{f(40)},{f(7)},{f(800)},ARRAY[{f(900)}],'Synthetic',gen_random_uuid());"
 if kind=='long_stay':return f"SELECT create_long_stay_contract({f(800)},{f(7)},current_date+3,current_date+10,{f(40)},{f(54)},1000,1,'Synthetic',gen_random_uuid());"
 return f"""SELECT create_unassigned_shared_room_family_booking({f(800)},'Synthetic',false,(SELECT jsonb_agg(jsonb_build_object('stableMemberKey','member-'||n,'dogId',('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'serviceType','hotel','assigneeIds',jsonb_build_array({f(900)}),'sharedRoomGroupKey','race-group','calendarId',{f(20)},'scheduleTypeId',{f(30)},'checkInDate',current_date+3,'checkInTime','09:00','checkOutDate',current_date+5,'checkOutTime','15:00','roomTypeId',{f(40)})) FROM generate_series(7,8) n),{f(40)},true,gen_random_uuid());"""
results=[]
for kind in ['schedule','hotel','long_stay','shared']:
 for order,n in [('removal_first',7),('domain_first',7),('different_dog',9)]+([('second_member',8)] if kind=='shared' else []):
  db='qa_rpc_'+kind+'_'+order
  made=sql('CREATE DATABASE '+db+' TEMPLATE '+base+';', 'postgres');assert made.returncode==0,made.stderr
  left=rpc(kind) if order in ['domain_first','different_dog','second_member'] else removal(n)
  right=removal(n) if order in ['domain_first','different_dog','second_member'] else rpc(kind)
  p=subprocess.Popen(args(db),stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
  p.stdin.write("SET application_name='qa_rpc_holder';BEGIN;"+auth+left+"SELECT pg_sleep(2);COMMIT;");p.stdin.close()
  ready=False
  for _ in range(100):
   if sql("SELECT count(*) FROM pg_stat_activity WHERE datname='"+db+"' AND application_name='qa_rpc_holder' AND wait_event='PgSleep';",'postgres').stdout.strip()=='1':ready=True;break
   if p.poll() is not None:break
   time.sleep(.02)
  if not ready:
   err=p.stderr.read();results.append({'domain':kind,'order':order,'status':'HOLDER_FAILED','error':err});break
  start=time.monotonic();r=sql("BEGIN;SET LOCAL statement_timeout='6s';SET LOCAL lock_timeout='5s';"+auth+right+'COMMIT;',db);elapsed=time.monotonic()-start
  p.wait();left_error=p.stderr.read();left_output=p.stdout.read()
  expected_success=order=='different_dog'; ok=(r.returncode==0)==expected_success and p.returncode==0 and 'deadlock detected' not in r.stderr.lower()
  # Independent operation must finish while holder is still sleeping/transaction open.
  if expected_success:ok=ok and elapsed<1.5
  if not expected_success:ok=ok and any(x in r.stderr for x in ['DOG_BUSY','INVALID_PROFILE_STATE','DOG_NOT_FOUND','DOG_PROFILE','DOG_HAS','DOG_REFERENCE','DOG_NOT_ACTIVE','삭제','반려견','GRAPH','REMOVAL']) and 'timeout' not in r.stderr.lower()
  state=sql("SELECT jsonb_build_object('dogs',(SELECT jsonb_agg(jsonb_build_object('id',id,'status',profile_status)) FROM dogs WHERE id IN ("+','.join(f(x) for x in [7,8,9])+")),'receipts',(SELECT count(*) FROM dog_profile_removal_receipts));",db).stdout.strip()
  results.append({'domain':kind,'order':order,'status':'PASS' if ok else 'FAIL','secondSeconds':round(elapsed,3),'secondExit':r.returncode,'error':r.stderr,'state':state})
  sql('DROP DATABASE '+db+';', 'postgres')
(out/'real-rpc-concurrency.json').write_text(json.dumps(results,indent=2));print(json.dumps(results,indent=2));raise SystemExit(0 if len(results)==13 and all(r['status']=='PASS' for r in results) else 2)
