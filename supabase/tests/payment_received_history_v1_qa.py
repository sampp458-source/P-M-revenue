"""Synthetic local-only history query QA. Roll back all fixture writes."""
import subprocess,json,uuid
from pathlib import Path
PG='/opt/homebrew/opt/postgresql@18/bin/psql'
args=[PG,'-X','-h','/tmp/pnm-payment-history','-p','55628','-U','postgres','-d','paymentqa_history','-Atq','-v','ON_ERROR_STOP=1']
actor='71000000-0000-4000-8000-000000000001';other='71000000-0000-4000-8000-000000000002'
setup=f"BEGIN; INSERT INTO auth.users(id) VALUES('{actor}'),('{other}'); INSERT INTO profiles(id,name,role,is_active,account_status) VALUES('{actor}','History reviewer','admin',true,'active'),('{other}','Other','staff',true,'active'); UPDATE operation_memberships SET is_active=true WHERE profile_id IN('{actor}','{other}'); INSERT INTO notification_capability_grants(profile_id,capability,active,granted_by) VALUES('{actor}','PAYMENT_CONFIRMATION_REVIEW',true,'{actor}'),('{actor}','PAYMENT_REQUEST_PROCESS',true,'{actor}'); UPDATE payment_request_config SET payment_confirmation_enabled=true,payment_request_enabled=true WHERE singleton;"
def confirmation(status,at=None,deleted=False,reviewer=actor):
 fields='id,requester_id,reviewer_id,payer_name,reported_amount,status,request_id,payload_hash'
 vals=f"'{uuid.uuid4()}','{other}','{reviewer}','Fixture',100,'{status}','{uuid.uuid4()}','fixture'"
 if status in ['CONFIRMED','NOT_FOUND']:fields+=',resolved_at,resolved_by';vals+=f",'{at}','{actor}'"
 if status=='CANCELLED':fields+=',cancelled_at,cancelled_by,cancel_reason';vals+=f",'{at}','{actor}','fixture'"
 if deleted:fields+=',deleted_at,deleted_by';vals+=f",'{at}','{other}'"
 return f'INSERT INTO payment_confirmation_requests({fields}) VALUES({vals});'
setup+=''.join(confirmation('REQUESTED')for _ in range(69))+confirmation('NOT_FOUND','2099-10-07 15:00Z')
setup+=''.join(confirmation('CONFIRMED','2099-10-08 01:00Z')for _ in range(28))+confirmation('CANCELLED','2099-10-07 15:00Z')+confirmation('CONFIRMED','2099-10-08 14:59:59Z')
setup+=confirmation('CONFIRMED','2099-10-07 14:59:59Z')+confirmation('CONFIRMED','2099-10-08 15:00Z')+confirmation('CANCELLED','2099-10-08 01:00Z',True)+confirmation('CONFIRMED','2099-10-08 01:00Z',reviewer=other)
for status,column in [('COMPLETED','completed_at'),('REJECTED','rejected_at'),('CANCELLED','cancelled_at')]:
 extra=",acknowledged_at"if status=='COMPLETED'else f",{status.lower() if status=='REJECTED'else 'cancelled'}_by,{ 'rejection_reason' if status=='REJECTED'else 'cancel_reason'}"
 more=",'2099-10-07 15:00Z'"if status=='COMPLETED'else f",'{actor}','fixture'"
 # rejected_by uses canonical past participle
 extra=extra.replace('rejected_by','rejected_by')
 setup+=f"INSERT INTO payment_requests(id,requester_id,processor_id,title,payee_name,requested_amount,reason,status,request_id,payload_hash,{column}{extra}) VALUES('{uuid.uuid4()}','{other}','{actor}','Payment','Vendor',100,'fixture','{status}','{uuid.uuid4()}','fixture','2099-10-08 01:00Z'{more});"
task_id=str(uuid.uuid4())
setup+=f"INSERT INTO task_requests(id,requester_id,title,body,due_at,request_id,payload_hash) VALUES('{task_id}','{other}','Task must stay separate','fixture','2099-10-10 00:00Z','{uuid.uuid4()}','fixture'); INSERT INTO task_request_targets(task_request_id,recipient_id) VALUES('{task_id}','{actor}');"
setup+=f"SET ROLE authenticated; SET request.jwt.claim.sub='{actor}';"
queries=["SELECT get_payment_received_history_v1('PAYMENT_CONFIRMATION_REQUEST','2099-10-08',0,50,0);","SELECT get_payment_received_history_v1('PAYMENT_CONFIRMATION_REQUEST','2099-10-08',0,50,50);","SELECT get_payment_received_history_v1('PAYMENT_REQUEST','2099-10-08',0,50,0);","SELECT get_payment_received_history_v1('ALL','2099-10-08',0,50,0);",f"SET request.jwt.claim.sub='{other}';SELECT get_payment_received_history_v1('ALL','2099-10-08',0,50,0);","RESET ROLE; UPDATE payment_request_config SET payment_request_enabled=false WHERE singleton;",f"SET ROLE authenticated; SET request.jwt.claim.sub='{actor}';SELECT get_payment_received_history_v1('PAYMENT_REQUEST','2099-10-08',0,50,0);","ROLLBACK;"]
r=subprocess.run(args,input=setup+'\n'.join(queries),text=True,capture_output=True);assert r.returncode==0,r.stderr
rows=[json.loads(line)for line in r.stdout.splitlines()if line.startswith('{')]
checks=[]
def check(name,condition):assert condition,name;checks.append(name)
a,b,c,combined,d,e=rows
check('OPEN 70 independent count',a['open']['count']==70 and len(a['open']['items'])==50)
check('OPEN second page 20',b['open']['count']==70 and len(b['open']['items'])==20)
check('CLOSED 30 independent count/pages',a['count']==30 and b['count']==30 and len(a['items'])==30)
check('NOT_FOUND remains OPEN',any(x['status']=='NOT_FOUND'for x in a['open']['items']+b['open']['items']))
check('KST start inclusive/end exclusive; deleted and other reviewer excluded',a['count']==30)
check('CONFIRMED/CANCELLED states retained',set(x['status']for x in a['items'])=={'CONFIRMED','CANCELLED'})
check('Payment completed/rejected/cancelled sources',c['count']==3 and set(x['status']for x in c['items'])=={'COMPLETED','REJECTED','CANCELLED'})
check('other user receives no reviewer data',d['count']==1 and d['open']['count']==0)
check('Payment OFF returns zero',e['count']==0 and e['open']['count']==0)
check('no overlap queue/history',not(set(x['id']for x in a['open']['items'])&set(x['id']for x in a['items'])))
check('ALL payment scope excludes Task and merges two payment types on server',combined['open']['count']==70 and combined['count']==33 and all(x['request_type']!='TASK_REQUEST' for x in combined['open']['items']+combined['items']))
check('actual processing timestamps descending', [x['processed_at'] for x in a['items']]==sorted([x['processed_at']for x in a['items']],reverse=True))
print(json.dumps({'checks':checks,'passed':len(checks)},indent=2))
# Negative authorization and pagination checks are local transactions, never Production.
for role,user,call,error in [
 ('anon',None,"get_payment_received_history_v1('ALL','2099-10-08',0,50,0)",'permission denied'),
 ('authenticated',None,"get_payment_received_history_v1('ALL','2099-10-08',0,50,0)",'PAYMENT_FORBIDDEN'),
 ('authenticated','70000000-0000-4000-8000-000000000003',"get_payment_received_history_v1('ALL','2099-10-08',-1,50,0)",'INVALID_PAGE'),
 ('authenticated','70000000-0000-4000-8000-000000000003',"get_payment_received_history_v1('ALL','2099-10-08',0,51,0)",'INVALID_PAGE'),
]:
 pre=f'BEGIN; SET ROLE {role};'+(f"SET request.jwt.claim.sub='{user}';"if user else '')
 denied=subprocess.run(args,input=pre+'SELECT '+call+';ROLLBACK;',text=True,capture_output=True)
 assert denied.returncode!=0 and error in denied.stderr,denied.stderr
 print('PASS authorization/argument rejection',role,error)
