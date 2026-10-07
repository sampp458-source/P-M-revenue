"""Disposable schema-only clone QA. Unix socket only; no production/data export/provider.
Install candidate first. All fixtures synthetic; every connection loads safeupdate.
"""
import argparse, subprocess, json, uuid, concurrent.futures, datetime, time
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--socket',required=True);p.add_argument('--database',required=True);p.add_argument('--port',required=True);p.add_argument('--psql',required=True);p.add_argument('--safeupdate-library',required=True);p.add_argument('--output',required=True);a=p.parse_args()
assert a.socket.startswith('/tmp/') and a.database.startswith('paymentqa')
checks=[]
def uid(i):return f'70000000-0000-4000-8000-{i:012d}'
def key():return str(uuid.uuid4())
def literal(v):return "'"+str(v).replace("'","''")+"'"
def sql(s,user=None,fail=None):
 pre=f"LOAD {literal(a.safeupdate_library)}; SET statement_timeout='15s'; SET lock_timeout='10s';"
 if user:pre+=f"SET ROLE authenticated; SET request.jwt.claim.sub='{uid(user)}';"
 r=subprocess.run([a.psql,'-X','-h',a.socket,'-p',a.port,'-U','postgres','-d',a.database,'-Atq','-v','ON_ERROR_STOP=1'],input=pre+s,text=True,capture_output=True)
 if fail:assert r.returncode and fail in r.stderr,(fail,r.stderr)
 elif r.returncode:raise AssertionError(r.stderr)
 return r.stdout.strip()
def check(name,value=True):
 assert value,name;checks.append(name);print('PASS',name,flush=True);Path(a.output).write_text(json.dumps({'count':len(checks),'checks':checks},indent=2))
def grant(user,cap,actor=1,active=True,version=0,request=None,fail=None):return sql(f"SELECT set_payment_request_capability_v1('{uid(user)}','{cap}',{str(active).lower()},{version},'{request or key()}');",actor,fail)
def command(kind='c',action='CREATE',rid=None,version=0,user=2,request=None,payload=None,fail=None):
 names={'c':{'ADMIN_CANCELLED':'administratively_cancel_payment_confirmation_request_v1','CREATE':'create_payment_confirmation_request_v1','CONFIRMED':'confirm_payment_confirmation_request_v1','NOT_FOUND':'mark_payment_confirmation_not_found_v1','CANCELLED':'cancel_payment_confirmation_request_v1'},'p':{'ADMIN_CANCELLED':'administratively_cancel_payment_request_v1','CREATE':'create_payment_request_v1','ACKNOWLEDGED':'acknowledge_payment_request_v1','COMPLETED':'complete_payment_request_v1','REJECTED':'reject_payment_request_v1','CANCELLED':'cancel_payment_request_v1'}}
 if payload is None:payload=({'handler_id':uid(3),'payer_name':'Synthetic new payer','amount':100000,'dog_name':'Synthetic dog','note':None} if kind=='c' else {'handler_id':uid(3),'title':'Synthetic payment','payee_name':'Synthetic vendor','amount':420000,'reason':'Workflow only','due_at':None}) if action=='CREATE' else {'note':'Synthetic result'}
 q=f"SELECT {names[kind][action]}('{request or key()}',{version},{literal(json.dumps(payload))}::jsonb"+(f",'{rid}'" if rid else '')+');'
 r=sql(q,user,fail);return json.loads(r) if not fail else None
check('safeupdate ON',sql('SHOW safeupdate.enabled;')=='on')
check('empty production-schema clone',sql('SELECT count(*) FROM profiles;')=='0')
for i in range(1,9):sql(f"INSERT INTO auth.users(id)VALUES('{uid(i)}');INSERT INTO profiles(id,name,role,is_active,account_status)VALUES('{uid(i)}','Synthetic {i}','{'admin' if i in [1,4] else 'staff'}',{str(i!=6).lower()},'{'pending' if i==7 else 'active'}');")
sql(f"UPDATE operation_memberships SET role='owner' WHERE profile_id IN('{uid(1)}','{uid(5)}'); DELETE FROM operation_memberships WHERE profile_id='{uid(4)}';")
sql("INSERT INTO notification_push_config(singleton,enabled)VALUES(true,false);INSERT INTO notification_schedule_config(singleton,enabled,daily_summary_enabled)VALUES(true,false,false);INSERT INTO notification_task_config(singleton,task_request_enabled,reminder_enabled)VALUES(true,true,false);")
check('sources default OFF',json.loads(sql('SELECT get_payment_request_access_v1();',1))['confirmation_enabled'] is False)
command(fail='PAYMENT_DISABLED')
for role in ['anon','authenticated','service_role']:
 check(role+' direct table ACL closed',sql(f"SELECT bool_and(NOT has_table_privilege('{role}',oid,'SELECT,INSERT,UPDATE,DELETE')) FROM pg_class WHERE relnamespace='public'::regnamespace AND relname IN('payment_requests','payment_confirmation_requests','payment_request_audit_events','payment_request_command_receipts','payment_request_config');")=='t')
 check(role+' internal helper ACL closed',sql(f"SELECT NOT has_function_privilege('{role}','payment_command_v1(text,uuid,text,jsonb,bigint,uuid)','EXECUTE');")=='t')
for cap in ['PAYMENT_CONFIRMATION_REQUEST_CREATE','PAYMENT_REQUEST_CREATE']:
 grant(2,cap,actor=5);grant(2,cap,actor=4,fail='CAPABILITY_OWNER_REQUIRED');grant(2,cap,actor=2,fail='CAPABILITY_OWNER_REQUIRED')
for cap in ['PAYMENT_CONFIRMATION_REVIEW','PAYMENT_REQUEST_PROCESS','PAYMENT_REQUESTS_VIEW_ALL']:
 grant(3,cap);grant(3,cap,actor=5,fail='CAPABILITY_OWNER_REQUIRED');grant(3,cap,actor=2,fail='CAPABILITY_OWNER_REQUIRED')
 # Finance-only administrator can manage others but cannot make itself an eligible handler.
 grant(4,cap,actor=4,fail='TASK_OPERATIONS_REQUIRED')
grant(1,'PAYMENT_CONFIRMATION_REVIEW');check('finance self grant; creator vs finance split; Finance-only handler blocked')
k=key();grant(8,'PAYMENT_REQUEST_PROCESS',request=k);grant(8,'PAYMENT_REQUEST_PROCESS',request=k)
grant(8,'PAYMENT_REQUEST_PROCESS',active=False,version=1,request=k,fail='REQUEST_ID_PAYLOAD_MISMATCH')
check('grant exact retry single audit/version and different payload conflict',sql(f"SELECT (SELECT count(*) FROM entity_audit_events WHERE request_id='{k}')=1 AND (SELECT version FROM notification_capability_grants WHERE profile_id='{uid(8)}' AND capability='PAYMENT_REQUEST_PROCESS')=1;")=='t')
grant(8,'PAYMENT_REQUEST_PROCESS',active=False,version=1)
check('RLS enabled all five new tables',sql("SELECT bool_and(relrowsecurity) FROM pg_class WHERE relnamespace='public'::regnamespace AND relname IN('payment_requests','payment_confirmation_requests','payment_request_audit_events','payment_request_command_receipts','payment_request_config');")=='t')
sql(f"SELECT set_notification_capability_v1('{uid(2)}','PAYMENT_REQUEST_PROCESS',true,0,'{key()}');",1,'INVALID_CAPABILITY_INPUT');check('legacy setter cannot bypass Finance whitelist')
sql('UPDATE payment_request_config SET payment_confirmation_enabled=true,payment_request_enabled=true WHERE singleton;')
command(user=5,fail='PAYMENT_FORBIDDEN');command(user=6,fail='PAYMENT_FORBIDDEN');command(user=7,fail='PAYMENT_FORBIDDEN');command(user=4,fail='PAYMENT_FORBIDDEN')
check('no owner implicit CREATE, inactive pending Finance-only rejected')
for bad in [uid(2),uid(4),uid(6)]:command(payload={'handler_id':bad,'payer_name':'Synthetic','amount':1},fail='INVALID_PAYMENT_HANDLER')
check('handler eligibility rechecked')
# Finance fixtures: actual existing registration/payment/refund RPCs, exclusively in clone.
sql(f"INSERT INTO business_units(id,code,name,sort_order)VALUES('{uid(101)}','hotel','Synthetic Hotel',1);INSERT INTO product_categories(id,business_unit_id,name)VALUES('{uid(102)}','{uid(101)}','Synthetic');INSERT INTO products(id,business_unit_id,category_id,name,default_price)VALUES('{uid(103)}','{uid(101)}','{uid(102)}','Synthetic',200000);")
sale={'sale_date':'2026-01-10','business_unit_id':uid(101),'product_category_id':uid(102),'product_id':uid(103),'original_amount':200000,'additional_amount':0,'discount_amount':0,'paid_amount':100000,'outstanding_amount':100000,'quantity':1,'unit_price':200000,'payment_method':'transfer','customer_type':'new','dog_name':'Synthetic','customer_name':'Synthetic'}
sid=sql(f"SELECT create_sale_with_payments({literal(json.dumps(sale))}::jsonb,'[{{\"payment_method\":\"transfer\",\"amount\":50000}},{{\"payment_method\":\"card\",\"amount\":50000}}]'::jsonb);",1)
sql(f"SELECT add_sale_payment('{sid}',10000,'cash','2026-01-11',NULL,'{key()}');",1)
sql(f"SELECT record_sale_refund('{sid}','2026-01-12',1000,'Synthetic');",1)
pid=sql(f"SELECT id FROM sale_payments WHERE sale_id='{sid}' AND payment_method='cash';")
sql(f"SELECT void_sale_payment('{pid}','Synthetic duplicate void test');",1)
sql(f"SELECT void_sale_payment('{pid}','Synthetic duplicate void test');",1)
sql(f"SELECT add_sale_payment('{sid}',20000,'transfer','2026-01-13',NULL,'{key()}');",1)
check('existing sales registration add/refund/void/outstanding collection RPCs work',sql(f"SELECT paid_amount=120000 AND refund_amount=1000 AND outstanding_amount=80000 FROM sales WHERE id='{sid}';")=='t')
sql(f"INSERT INTO monthly_closings(year,month,closed_by)VALUES(2025,1,'{uid(1)}');")
def fingerprint():return sql("SELECT jsonb_build_object('sale_count',(SELECT count(*) FROM sales),'payment_count',(SELECT count(*) FROM sale_payments),'refund_count',(SELECT count(*) FROM sale_refunds),'closing_count',(SELECT count(*) FROM monthly_closings),'sales',(SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'')) FROM sales t),'payments',(SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'')) FROM sale_payments t),'refunds',(SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'')) FROM sale_refunds t),'closings',(SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'')) FROM monthly_closings t),'paid',(SELECT sum(paid_amount)FROM sales),'refund',(SELECT sum(refund_amount)FROM sales),'outstanding',(SELECT sum(outstanding_amount)FROM sales));")
before=fingerprint();Path(a.output+'.financial-before.json').write_text(before)
k=key();r=command(request=k);assert command(request=k)==r;command(request=k,payload={'handler_id':uid(3),'payer_name':'Changed','amount':1},fail='REQUEST_ID_PAYLOAD_MISMATCH');check('create idempotency independent of customer/sale rows')
notice=sql(f"SELECT id FROM notifications WHERE deep_link_id='{r['id']}';");sql(f"SELECT mark_notification_read_v1('{notice}');",3);check('notification read does not resolve',sql(f"SELECT status FROM payment_confirmation_requests WHERE id='{r['id']}';")=='REQUESTED')
k=key();done=command(action='CONFIRMED',rid=r['id'],version=1,user=3,request=k,payload={'note':None});assert command(action='CONFIRMED',rid=r['id'],version=1,user=3,request=k,payload={'note':None})==done
command(action='CANCELLED',rid=r['id'],version=2,fail='PAYMENT_INVALID_TRANSITION');check('confirm optional note terminal and retry stable')
r=command();command(action='NOT_FOUND',rid=r['id'],version=1,user=3,payload={'note':None});r=command();command(action='CANCELLED',rid=r['id'],version=1);check('not-found optional note and requester cancel')
command(payload={'handler_id':uid(3),'payer_name':'x','amount':0},fail='violates check constraint');command(payload={'handler_id':uid(3),'payer_name':'x','amount':'1.2'},fail='invalid input syntax');check('positive integer amount')
for action in ['COMPLETED','REJECTED','CANCELLED']:
 r=command('p')
 if action=='COMPLETED':
  command('p','COMPLETED',r['id'],1,3,fail='PAYMENT_INVALID_TRANSITION');k=key();command('p','ACKNOWLEDGED',r['id'],1,3,request=k);command('p','ACKNOWLEDGED',r['id'],1,3,request=k)
  command('p','CANCELLED',r['id'],2,2,fail='PAYMENT_INVALID_TRANSITION')
 command('p',action,r['id'],2 if action=='COMPLETED' else 1,2 if action=='CANCELLED' else 3)
check('payment ACK required, duplicate ACK, complete, reject, cancel, cancel-after-ACK denied')
r=command('p');command('p','ACKNOWLEDGED',r['id'],1,3);command('p','REJECTED',r['id'],2,3);check('reject after ACK')
command('p',payload={'handler_id':uid(3),'title':'x','payee_name':'x','amount':1,'reason':'x','due_at':'2000-01-01T00:00:00+09:00'},fail='PAYMENT_DUE_MUST_BE_FUTURE');check('optional due and past due validation')
command('p',payload={'handler_id':uid(3),'title':'x','payee_name':'x','amount':1,'reason':'x','due_at':'2099-01-01'},fail='PAYMENT_DUE_MUST_BE_FUTURE');check('date-only due rejected without invented midnight')
for end in ['COMPLETED','REJECTED']:
 due=(datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(seconds=1)).isoformat()
 late=command('p',payload={'handler_id':uid(3),'title':'Late handling','payee_name':'x','amount':1,'reason':'x','due_at':due})
 time.sleep(1.1)
 command('p','ACKNOWLEDGED',late['id'],1,3);command('p',end,late['id'],2,3)
check('past due after valid creation still permits ACK COMPLETE REJECT')
check('owner all scope no financial row/count leak',json.loads(sql("SELECT get_request_hub_v1('all','ALL','all',0);",5))['count']==0)
check('unrelated detail rejected',bool(sql(f"SELECT get_payment_request_detail_v1('PAYMENT_REQUEST','{r['id']}');",8,'PAYMENT_NOT_FOUND')==''))
for kind,actions in [('c',['CONFIRMED','NOT_FOUND']),('c',['CONFIRMED','CANCELLED']),('p',['ACKNOWLEDGED','CANCELLED']),('p',['COMPLETED','REJECTED'])]:
 for _ in range(10):
  r=command(kind);v=1
  if actions[0]=='COMPLETED':command('p','ACKNOWLEDGED',r['id'],1,3);v=2
  def race(act):
   try:command(kind,act,r['id'],v,2 if act=='CANCELLED' else 3);return 'success'
   except AssertionError as e:assert 'PAYMENT_VERSION_CONFLICT' in str(e) or 'PAYMENT_INVALID_TRANSITION' in str(e),str(e);return 'conflict'
  with concurrent.futures.ThreadPoolExecutor(max_workers=2)as pool:results=list(pool.map(race,actions))
  assert results.count('success')==1,results
 check('ten races '+str(actions)+' one winner no deadlock')
# Clear prior synthetic open work through normal commands so each revoke race has one assignment.
for kind,table in [('c','payment_confirmation_requests'),('p','payment_requests')]:
 for item in json.loads(sql(f"SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]')FROM {table} r WHERE status IN('REQUESTED','ACKNOWLEDGED','NOT_FOUND');")):
  command(kind,'CONFIRMED' if item['status']=='NOT_FOUND' else 'CANCELLED' if item['status']=='REQUESTED' else 'REJECTED',item['id'],item['version'],2 if item['status']=='REQUESTED' else 3)
for kind,action in [('c','CONFIRMED'),('c','NOT_FOUND'),('p','ACKNOWLEDGED'),('p','COMPLETED'),('p','REJECTED')]:
 cap='PAYMENT_CONFIRMATION_REVIEW' if kind=='c' else 'PAYMENT_REQUEST_PROCESS'
 for _ in range(10):
  r=command(kind);v=1
  if action=='COMPLETED':command('p','ACKNOWLEDGED',r['id'],1,3);v=2
  version=int(sql(f"SELECT version FROM notification_capability_grants WHERE profile_id='{uid(3)}' AND capability='{cap}';"))
  def revoke():
   try:grant(3,cap,active=False,version=version);return 'revoked'
   except AssertionError as e:assert 'PAYMENT_CAPABILITY_IN_USE' in str(e),str(e);return 'blocked'
  with concurrent.futures.ThreadPoolExecutor(max_workers=2)as pool:
   f=pool.submit(command,kind,action,r['id'],v,3);g=pool.submit(revoke);f.result();outcome=g.result()
  assert sql(f"SELECT NOT EXISTS(SELECT 1 FROM payment_rows_v1() r WHERE handler_id='{uid(3)}' AND status IN('REQUESTED','ACKNOWLEDGED') AND NOT payment_has_capability_v1(handler_id,CASE request_type WHEN 'PAYMENT_CONFIRMATION_REQUEST' THEN 'PAYMENT_CONFIRMATION_REVIEW' ELSE 'PAYMENT_REQUEST_PROCESS' END));")=='t'
  if action=='NOT_FOUND':assert outcome=='blocked';command('c','CONFIRMED',r['id'],2,3)
  if action=='ACKNOWLEDGED':assert outcome=='blocked';command('p','COMPLETED',r['id'],2,3)
  if outcome=='revoked':command(kind,action,r['id'],v,3,fail='PAYMENT_FORBIDDEN');grant(3,cap,version=version+1)
 check('ten revoke x '+action+' no unresolved orphan and no deadlock')
# Explicit guards before action (including ACK state) do not change capability/audit/version.
for kind,ack in [('c',False),('p',False),('p',True)]:
 r=command(kind)
 if ack:command('p','ACKNOWLEDGED',r['id'],1,3)
 cap='PAYMENT_CONFIRMATION_REVIEW' if kind=='c' else 'PAYMENT_REQUEST_PROCESS'
 version=int(sql(f"SELECT version FROM notification_capability_grants WHERE profile_id='{uid(3)}' AND capability='{cap}';"));k=key()
 grant(3,cap,active=False,version=version,request=k,fail='PAYMENT_CAPABILITY_IN_USE')
 assert sql(f"SELECT active AND version={version} AND NOT EXISTS(SELECT 1 FROM entity_audit_events WHERE request_id='{k}') FROM notification_capability_grants WHERE profile_id='{uid(3)}' AND capability='{cap}';")=='t'
 command(kind,'REJECTED' if ack else 'CANCELLED',r['id'],2 if ack else 1,3 if ack else 2)
 grant(3,cap,active=False,version=version,request=k);grant(3,cap,version=version+1)
check('REQUESTED confirmation/payment and ACK payment reject ordinary revoke atomically')
# Exact retry races, recipient authorization and installed delivery validity path.
for kind,action in [('c','CONFIRMED'),('p','COMPLETED')]:
 r=command(kind);v=1
 if kind=='p':command('p','ACKNOWLEDGED',r['id'],1,3);v=2
 k=key()
 with concurrent.futures.ThreadPoolExecutor(max_workers=4)as pool:results=list(pool.map(lambda _:command(kind,action,r['id'],v,3,request=k),range(4)))
 check('four concurrent identical '+action+' one audit',all(x==results[0]for x in results) and sql(f"SELECT count(*)FROM payment_request_audit_events WHERE request_id='{k}';")=='1')
for user in [2,3]:sql("SELECT register_web_push_subscription_v1('https://fcm.googleapis.com/fcm/send/payment-local-"+str(user)+"','B"+'A'*86+"','"+'B'*22+"');",user)
# Administrative recovery requires active Finance admin AND explicit financial view permission.
grant(1,'PAYMENT_REQUESTS_VIEW_ALL')
for kind in ['c','p']:
 for loss in ['profile','account','membership','capability']:
  r=command(kind);v=1
  if kind=='p':command('p','ACKNOWLEDGED',r['id'],1,3);v=2
  command(kind,'ADMIN_CANCELLED',r['id'],v,1,fail='PAYMENT_ADMIN_CLOSE_NOT_ALLOWED')
  cap='PAYMENT_CONFIRMATION_REVIEW' if kind=='c' else 'PAYMENT_REQUEST_PROCESS'
  down={'profile':f"UPDATE profiles SET account_status='inactive' WHERE id='{uid(3)}';",'account':f"UPDATE profiles SET account_status='pending' WHERE id='{uid(3)}';",'membership':f"UPDATE operation_memberships SET is_active=false WHERE profile_id='{uid(3)}';",'capability':f"UPDATE notification_capability_grants SET active=false,revoked_at=clock_timestamp() WHERE profile_id='{uid(3)}' AND capability='{cap}';"}[loss]
  # Synthetic legacy/external eligibility loss; ordinary capability revoke is separately blocked above.
  sql(down)
  detail=json.loads(sql(f"SELECT get_payment_request_detail_v1('{'PAYMENT_REQUEST' if kind=='p' else 'PAYMENT_CONFIRMATION_REQUEST'}','{r['id']}');",1));assert detail['handler_unavailable'] and detail['can_admin_close']
  requester=json.loads(sql(f"SELECT get_payment_request_detail_v1('{'PAYMENT_REQUEST' if kind=='p' else 'PAYMENT_CONFIRMATION_REQUEST'}','{r['id']}');",2));assert requester['handler_unavailable'] and not requester['can_admin_close']
  command(kind,'ADMIN_CANCELLED',r['id'],v,2,fail='PAYMENT_FORBIDDEN');command(kind,'ADMIN_CANCELLED',r['id'],v,4,fail='PAYMENT_FORBIDDEN')
  command(kind,'ADMIN_CANCELLED',r['id'],v,1,payload={'note':None},fail='PAYMENT_REASON_REQUIRED')
  if kind=='p':command(kind,'CANCELLED',r['id'],v,2,fail='PAYMENT_INVALID_TRANSITION')
  k=key();result=command(kind,'ADMIN_CANCELLED',r['id'],v,1,request=k);assert command(kind,'ADMIN_CANCELLED',r['id'],v,1,request=k)==result
  table='payment_requests' if kind=='p' else 'payment_confirmation_requests'
  assert sql(f"SELECT status='CANCELLED' AND administrative_cancelled AND cancelled_by='{uid(1)}' AND {'processor_id' if kind=='p' else 'reviewer_id'}='{uid(3)}' FROM {table} WHERE id='{r['id']}';")=='t'
  expected='PAYMENT_ADMIN_CANCELLED' if kind=='p' else 'CONFIRMATION_ADMIN_CANCELLED'
  assert sql(f"SELECT count(*)=1 AND bool_and(action='{expected}' AND metadata->>'administrative'='true') FROM payment_request_audit_events WHERE request_id='{k}';")=='t'
  assert sql(f"SELECT count(*)=1 AND bool_and(n.recipient_id='{uid(2)}' AND n.category='{'PAYMENT_REQUEST' if kind=='p' else 'PAYMENT_CONFIRMATION_REQUEST'}' AND push_delivery_valid_v1(d.id)) FROM notifications n JOIN notification_events e ON e.id=n.event_id JOIN notification_push_deliveries d ON d.notification_id=n.id WHERE n.deep_link_id='{r['id']}' AND e.event_type LIKE '%CANCELLED';")=='t'
  assert json.loads(sql(f"SELECT get_payment_request_detail_v1('{'PAYMENT_REQUEST' if kind=='p' else 'PAYMENT_CONFIRMATION_REQUEST'}','{r['id']}');",2))['administrative_cancelled']
  sql(f"UPDATE profiles SET is_active=true,account_status='active' WHERE id='{uid(3)}';UPDATE operation_memberships SET is_active=true WHERE profile_id='{uid(3)}';UPDATE notification_capability_grants SET active=true,revoked_at=NULL WHERE profile_id='{uid(3)}' AND capability='{cap}';")
  command(kind,'ADMIN_CANCELLED',r['id'],v+1,1,fail='PAYMENT_ADMIN_CLOSE_NOT_ALLOWED')
  check(kind+' '+loss+' loss recovery, explicit audit, requester notification and retry')
r=command('c');sql(f"UPDATE profiles SET account_status='inactive' WHERE id IN('{uid(2)}','{uid(3)}');")
command('c','ADMIN_CANCELLED',r['id'],1,1)
assert sql(f"SELECT count(*) FROM notifications n JOIN notification_events e ON e.id=n.event_id WHERE n.deep_link_id='{r['id']}' AND e.event_type IN('PAYMENT_CONFIRMATION_CANCELLED','PAYMENT_CONFIRMATION_ADMIN_CANCELLED');")=='0'
sql(f"UPDATE profiles SET account_status='active' WHERE id IN('{uid(2)}','{uid(3)}');")
check('confirmation both parties inactive remains recoverable; inactive requester receives no notification')
# Distinct administrative notification taxonomy, copy, recipient, idempotency and pre-send validity.
for kind in ['c','p']:
 domain='PAYMENT_CONFIRMATION_REQUEST' if kind=='c' else 'PAYMENT_REQUEST'
 prefix='PAYMENT_CONFIRMATION' if kind=='c' else 'PAYMENT_REQUEST'
 for administrative in [False,True]:
  r=command(kind);v=1;action='ADMIN_CANCELLED' if administrative else 'CANCELLED'
  if administrative:
   if kind=='p':command('p','ACKNOWLEDGED',r['id'],1,3);v=2
   sql(f"UPDATE operation_memberships SET is_active=false WHERE profile_id='{uid(3)}';")
  k=key();result=command(kind,action,r['id'],v,1 if administrative else 2,request=k)
  assert command(kind,action,r['id'],v,1 if administrative else 2,request=k)==result
  event=prefix+'_'+action;other=prefix+('_CANCELLED' if administrative else '_ADMIN_CANCELLED');recipient=2 if administrative else 3
  expected_title=('결제 확인 요청이 관리 종료되었습니다.' if kind=='c' else '지급 요청이 관리 종료되었습니다.') if administrative else '요청이 취소되었습니다.'
  expected_message=('입금 여부는 별도로 확인해 주세요.' if kind=='c' else '외부 지급 여부는 별도로 확인해 주세요.') if administrative else '요청 상세에서 확인해 주세요.'
  rows=json.loads(sql(f"SELECT jsonb_agg(jsonb_build_object('event',e.event_type,'recipient',n.recipient_id,'title',n.title,'message',n.message,'delivery',d.id,'valid',push_delivery_valid_v1(d.id),'notice',n.id,'event_id',e.id)) FROM notification_events e JOIN notifications n ON n.event_id=e.id JOIN notification_push_deliveries d ON d.notification_id=n.id WHERE e.source_id='{r['id']}' AND e.event_type='{event}';"))
  assert len(rows)==1 and rows[0]['recipient']==uid(recipient) and rows[0]['title']==expected_title and rows[0]['message']==expected_message and rows[0]['valid'],rows
  assert sql(f"SELECT count(*) FROM notification_events WHERE source_id='{r['id']}' AND event_type='{other}';")=='0'
  assert sql(f"SELECT count(*) FROM payment_request_audit_events WHERE request_id='{k}';")=='1'
  # Restoring handler availability must not make the opposite cancellation meaning valid.
  sql(f"UPDATE operation_memberships SET is_active=true WHERE profile_id='{uid(3)}';")
  for candidate_event in [event,other,('PAYMENT_REQUEST' if kind=='c' else 'PAYMENT_CONFIRMATION')+'_'+action]:
   for candidate_recipient in [2,3]:
    expected=candidate_event==event and candidate_recipient==recipient
    assert sql(f"SELECT payment_push_valid_v1('{domain}','{r['id']}','{uid(candidate_recipient)}','{candidate_event}');")==('t' if expected else 'f')
  # Actual installed delivery validator rejects a stale/misclassified cancellation event.
  assert sql(f"BEGIN; UPDATE notification_events SET event_type='{other}' WHERE id='{rows[0]['event_id']}'; SELECT NOT push_delivery_valid_v1('{rows[0]['delivery']}'); ROLLBACK;")=='t'
  assert sql(f"SELECT push_delivery_valid_v1('{rows[0]['delivery']}');")=='t'
  inbox=json.loads(sql('SELECT get_notification_inbox_v1(0,false);',recipient))
  notice=next(n for n in inbox['items'] if n['id']==rows[0]['notice'])
  assert notice['title']==expected_title and notice['message']==expected_message
  detail=json.loads(sql(f"SELECT get_notification_detail_v1('{rows[0]['notice']}');",recipient))
  assert detail['title']==expected_title and detail['deep_link_type']==domain and detail['deep_link_id']==r['id']
  check(kind+' '+action+' exact event/recipient/copy, inbox/detail, retry and opposite validity rejected')
 # Inactive requester: administrative canonical/audit survives but no result event/notice/delivery.
 r=command(kind);v=1
 if kind=='p':command('p','ACKNOWLEDGED',r['id'],1,3);v=2
 sql(f"UPDATE profiles SET account_status='inactive' WHERE id IN('{uid(2)}','{uid(3)}');")
 k=key();command(kind,'ADMIN_CANCELLED',r['id'],v,1,request=k)
 table='payment_requests' if kind=='p' else 'payment_confirmation_requests'
 assert sql(f"SELECT status='CANCELLED' AND administrative_cancelled FROM {table} WHERE id='{r['id']}';")=='t'
 assert sql(f"SELECT count(*) FROM payment_request_audit_events WHERE request_id='{k}';")=='1'
 assert sql(f"SELECT count(*) FROM notification_events WHERE source_id='{r['id']}' AND event_type LIKE '%CANCELLED';")=='0'
 assert sql(f"SELECT count(*) FROM notifications n JOIN notification_events e ON e.id=n.event_id LEFT JOIN notification_push_deliveries d ON d.notification_id=n.id WHERE e.source_id='{r['id']}' AND e.event_type LIKE '%CANCELLED';")=='0'
 sql(f"UPDATE profiles SET account_status='active' WHERE id IN('{uid(2)}','{uid(3)}');")
 check(kind+' inactive requester administrative close: canonical/audit only, zero result notification/delivery')

# Ordinary VIEW_ALL reader and active Finance admin without VIEW_ALL cannot close.
r=command('p');command('p','ACKNOWLEDGED',r['id'],1,3)
sql(f"UPDATE profiles SET role='admin' WHERE id='{uid(5)}';UPDATE operation_memberships SET is_active=false WHERE profile_id='{uid(3)}';")
command('p','ADMIN_CANCELLED',r['id'],2,5,fail='PAYMENT_FORBIDDEN');command('p','ADMIN_CANCELLED',r['id'],2,2,fail='PAYMENT_FORBIDDEN')
command('p','ADMIN_CANCELLED',r['id'],2,1)
sql(f"UPDATE profiles SET role='staff' WHERE id='{uid(5)}';UPDATE operation_memberships SET is_active=true WHERE profile_id='{uid(3)}';")
check('Finance role does not implicitly broaden financial read or recovery authority')
for _ in range(10):
 r=command('p');command('p','ACKNOWLEDGED',r['id'],1,3)
 def deactivate():sql(f"BEGIN;UPDATE profiles SET account_status='inactive' WHERE id='{uid(3)}';SELECT pg_sleep(0.04);COMMIT;")
 def try_close():
  try:return command('p','ADMIN_CANCELLED',r['id'],2,1)
  except AssertionError as e:assert 'PAYMENT_ADMIN_CLOSE_NOT_ALLOWED' in str(e),str(e);return None
 with concurrent.futures.ThreadPoolExecutor(max_workers=2)as pool:
  f=pool.submit(deactivate);g=pool.submit(try_close);f.result();result=g.result()
 if not result:result=command('p','ADMIN_CANCELLED',r['id'],2,1)
 assert result['status']=='CANCELLED'
 sql(f"UPDATE profiles SET account_status='active' WHERE id='{uid(3)}';")
check('ten profile deactivation x administrative close races no deadlock, recoverable after observed loss')
for _ in range(10):
 r=command('p');command('p','ACKNOWLEDGED',r['id'],1,3);sql(f"UPDATE operation_memberships SET is_active=false WHERE profile_id='{uid(3)}';")
 with concurrent.futures.ThreadPoolExecutor(max_workers=2)as pool:
  f=pool.submit(command,'p','ADMIN_CANCELLED',r['id'],2,1);g=pool.submit(command,'p','COMPLETED',r['id'],2,3,fail='PAYMENT_FORBIDDEN');assert f.result()['status']=='CANCELLED';g.result()
 sql(f"UPDATE operation_memberships SET is_active=true WHERE profile_id='{uid(3)}';")
check('ten admin close x stale COMPLETE races: close only, no duplicate payment outcome')
r=command('p');command('p','ACKNOWLEDGED',r['id'],1,3);sql(f"UPDATE profiles SET account_status='inactive' WHERE id='{uid(3)}';");k=key()
with concurrent.futures.ThreadPoolExecutor(max_workers=4)as pool:results=list(pool.map(lambda _:command('p','ADMIN_CANCELLED',r['id'],2,1,request=k),range(4)))
check('four concurrent admin retries one audit/event/notification/delivery',all(x==results[0]for x in results) and sql(f"SELECT count(*) FROM payment_request_audit_events WHERE request_id='{k}';")=='1' and sql(f"SELECT count(*) FROM notification_events e JOIN notifications n ON n.event_id=e.id JOIN notification_push_deliveries d ON d.notification_id=n.id WHERE e.source_id='{r['id']}' AND e.event_type='PAYMENT_REQUEST_ADMIN_CANCELLED';")=='1')
sql(f"UPDATE profiles SET account_status='active' WHERE id='{uid(3)}';")
r=command();did=sql(f"SELECT d.id FROM notification_push_deliveries d JOIN notifications n ON n.id=d.notification_id WHERE n.deep_link_id='{r['id']}';")
check('one assigned subscription one delivery valid',sql(f"SELECT push_delivery_valid_v1('{did}');")=='t')
command(action='CONFIRMED',rid=r['id'],version=1,user=3)
check('stale requested provider send suppressed',sql(f"SELECT NOT push_delivery_valid_v1('{did}');")=='t')
check('result to requester only, fixed privacy notification body',sql(f"SELECT count(*)=1 FROM notifications WHERE deep_link_id='{r['id']}' AND recipient_id='{uid(2)}' AND title='입금이 확인되었습니다.' AND message='요청 상세에서 확인해 주세요.';")=='t')
check('ACK has no event',sql("SELECT count(*) FROM notification_events WHERE event_type='PAYMENT_REQUEST_ACKNOWLEDGED';")=='0')
check('view-all cannot process someone else assigned request',bool(command(action='CONFIRMED',rid=command()['id'],version=1,user=1,fail='PAYMENT_FORBIDDEN') is None))
check('no financial publication',sql("SELECT count(*) FROM pg_publication_tables WHERE tablename IN('payment_requests','payment_confirmation_requests');")=='0')
# Financial aggregate after every successful test path remains authoritative.
# Mixed-domain lock order: Push config before ordered inbox revisions, matching existing Task.
sql("INSERT INTO vault.decrypted_secrets(name,decrypted_secret) VALUES('notification_push_worker_url','https://localfixture.supabase.co/functions/v1/notification-push-dispatch'),('notification_push_worker_secret','local-fixture-only-not-a-secret-00000000');UPDATE notification_push_config SET enabled=true WHERE singleton;")
sql(f"SELECT set_notification_capability_v1('{uid(2)}','TASK_REQUEST_CREATE',true,0,'{key()}');",1)
for _ in range(20):
 def task_write():return sql(f"SELECT create_task_request_v1('{key()}','Synthetic mixed race','No production',now()+interval '1 day',ARRAY['{uid(3)}'::uuid]);",2)
 with concurrent.futures.ThreadPoolExecutor(max_workers=2)as pool:
  jobs=[pool.submit(task_write),pool.submit(command)];[j.result()for j in jobs]
check('twenty Task x Payment create races with Push ON and shared recipients no deadlock')
check('Task sent facade counterparty is recipient, not sender',all(row['counterparty']=='Synthetic 3' for row in json.loads(sql("SELECT get_request_hub_v1('sent','TASK_REQUEST','all',0);",2))['items']))
check('push wake safeupdate healthy in clone',sql('SELECT last_wake_error IS NULL FROM notification_push_config WHERE singleton;')=='t')
after=fingerprint();Path(a.output+'.financial-after.json').write_text(after);check('all commands financial fingerprints identical',before==after)
check('paid/refund consistency preserved',sql("SELECT NOT EXISTS(SELECT 1 FROM sales s WHERE paid_amount<>(SELECT coalesce(sum(amount),0)FROM sale_payments WHERE sale_id=s.id AND voided_at IS NULL) OR refund_amount<>(SELECT coalesce(sum(amount),0)FROM sale_refunds WHERE sale_id=s.id AND voided_at IS NULL));")=='t')
check('event/notification duplicates zero',sql('SELECT NOT EXISTS(SELECT 1 FROM notification_events GROUP BY dedupe_key HAVING count(*)>1) AND NOT EXISTS(SELECT 1 FROM notifications GROUP BY event_id,recipient_id HAVING count(*)>1);')=='t')
check('audit metadata has no free text',sql("SELECT bool_and(metadata - ARRAY['note_present','administrative'] = '{}'::jsonb)FROM payment_request_audit_events;")=='t')
check('reminder unchanged OFF',sql('SELECT NOT reminder_enabled FROM notification_task_config WHERE singleton;')=='t')
sql('UPDATE payment_request_config SET payment_confirmation_enabled=false,payment_request_enabled=false WHERE singleton;');check('source OFF hides rows/count',json.loads(sql("SELECT get_request_hub_v1('sent','PAYMENT_REQUEST','all',0);",2))['count']==0)
print('TOTAL',len(checks))
