"""Local production-schema clone only; requires V1 fixture QA then append-only candidate."""
from pathlib import Path
exec(Path(__file__).with_name('payment_requests_v1_qa.py').read_text().split("check('safeupdate ON'")[0])
# Existing synthetic actors only. Restore fixture eligibility after the V1 revoke/race suite.
sql("UPDATE profiles SET is_active=true,account_status='active' WHERE id::text LIKE '70000000-%';UPDATE operation_memberships SET is_active=true WHERE profile_id::text LIKE '70000000-%';UPDATE notification_capability_grants SET active=true WHERE profile_id IN('"+uid(2)+"','"+uid(3)+"') AND capability LIKE 'PAYMENT_%';UPDATE payment_request_config SET payment_confirmation_enabled=true,payment_request_enabled=true WHERE singleton;")
financial=sql("SELECT md5(string_agg(x::text,'' ORDER BY x::text)) FROM(SELECT to_jsonb(s)x FROM sales s UNION ALL SELECT to_jsonb(p)FROM sale_payments p UNION ALL SELECT to_jsonb(r)FROM sale_refunds r UNION ALL SELECT to_jsonb(m)FROM monthly_closings m)t;")
kind='PAYMENT_CONFIRMATION_REQUEST'
def do(action,r,actor=2,payload=None,k=None,fail=None):
 names={'UPDATED':'update_payment_confirmation_request_v1','DELETED':'delete_payment_confirmation_request_v1','CONFIRMED':'confirm_payment_confirmation_request_v1','NOT_FOUND':'mark_payment_confirmation_not_found_v1','CANCELLED':'cancel_payment_confirmation_request_v1'}
 if payload is None:payload={'payer_name':'Changed payer','reported_amount':12500,'dog_name':'Synthetic','note':'Updated'}if action=='UPDATED'else {}if action=='DELETED'else {'note':'Synthetic result'}
 v=sql(f"SELECT {names[action]}('{k or key()}',{r['version']},{literal(json.dumps(payload))}::jsonb,'{r['id']}');",actor,fail)
 return None if fail else json.loads(v)
def detail(r,user=2):return json.loads(sql(f"SELECT get_payment_request_detail_v1('{kind}','{r['id']}');",user))
def listed(r,scope,user,filter):return sql(f"SELECT EXISTS(SELECT 1 FROM jsonb_array_elements(get_request_hub_v1('{scope}','{kind}','{filter}',0)->'items')i WHERE i->>'id'='{r['id']}');",user)=='t'
for status in ['REQUESTED','NOT_FOUND']:
 r=command();
 if status=='NOT_FOUND':r=do('NOT_FOUND',r,3)
 check(status+' detail accessible',detail(r)['status']==status)
 for scope,user in [('inbox',3),('sent',2),('all',3)]:
  check(status+' '+scope+' active',listed(r,scope,user,'active'))
  check(status+' '+scope+' not done',not listed(r,scope,user,'done'))
 r=do('CONFIRMED',r,3);check(status+' -> confirmed',detail(r)['status']=='CONFIRMED')
 do('UPDATED',r,fail='PAYMENT_INVALID_TRANSITION');do('DELETED',r,fail='PAYMENT_INVALID_TRANSITION');check('confirmed cannot edit/delete')
 for scope,user in [('inbox',3),('sent',2),('all',3)]:check('confirmed '+scope+' done',listed(r,scope,user,'done'))
for status in ['REQUESTED','NOT_FOUND']:
 r=command()
 if status=='NOT_FOUND':r=do('NOT_FOUND',r,3)
 do('UPDATED',r,actor=3,fail='PAYMENT_FORBIDDEN');do('DELETED',r,actor=3,fail='PAYMENT_FORBIDDEN');check(status+' requester-only')
 do('UPDATED',r,payload={'payer_name':'X','reported_amount':1,'reviewer_id':uid(1)},fail='INVALID_PAYMENT_INPUT');check('reviewer change denied')
 k=key();old=r;r=do('UPDATED',r,k=k);check('update exact retry',do('UPDATED',old,k=k)==r)
 do('UPDATED',old,k=k,payload={'payer_name':'Mismatch','reported_amount':1},fail='REQUEST_ID_PAYLOAD_MISMATCH');check('update different payload denied')
 d=detail(r);check(status+' update resets metadata',d['status']=='REQUESTED' and d['resolved_at']is None and d['resolved_by']is None and d['resolution_note']is None)
 check('update audit/receipt/event once',sql(f"SELECT (SELECT count(*) FROM payment_request_audit_events WHERE request_id='{k}')=1 AND (SELECT count(*) FROM payment_request_command_receipts WHERE request_id='{k}')=1 AND (SELECT count(*)FROM notification_events WHERE source_id='{r['id']}' AND event_type='PAYMENT_CONFIRMATION_UPDATED')=1;")=='t')
 # Repeated edit/recheck cycles must produce new notification events, not be deduped forever.
 r=do('NOT_FOUND',r,3);r=do('UPDATED',r);r=do('NOT_FOUND',r,3)
 check('versioned event dedupe supports repeated reviews',int(sql(f"SELECT count(*)FROM notification_events WHERE source_id='{r['id']}' AND event_type='PAYMENT_CONFIRMATION_UPDATED';"))==2)
 k=key();old=r;r=do('DELETED',r,k=k);check('delete retry same result',do('DELETED',old,k=k)==r)
 check('tombstone preserves canonical row',sql(f"SELECT status='CANCELLED' AND deleted_at IS NOT NULL AND deleted_by='{uid(2)}' FROM payment_confirmation_requests WHERE id='{r['id']}';")=='t')
 for scope,user in [('inbox',3),('sent',2),('all',3)]:
  for filter in ['active','done','all']:check('deleted hidden '+scope+' '+filter,not listed(r,scope,user,filter))
 sql(f"SELECT get_payment_request_detail_v1('{kind}','{r['id']}');",2,'PAYMENT_NOT_FOUND');check('deleted deep link fails closed')
 check('deleted audit and receipt retained',sql(f"SELECT (SELECT count(*)FROM payment_request_audit_events WHERE confirmation_id='{r['id']}')>1 AND (SELECT count(*)FROM payment_request_command_receipts WHERE confirmation_id='{r['id']}')>1;")=='t')
 check('deleted notifications revoked',sql(f"SELECT NOT EXISTS(SELECT 1 FROM notifications WHERE deep_link_id='{r['id']}' AND revoked_at IS NULL);")=='t')
r=do('NOT_FOUND',command(),3);r=do('CANCELLED',r);check('NOT_FOUND requester withdrawal supported',r['status']=='CANCELLED')
do('DELETED',r,fail='PAYMENT_INVALID_TRANSITION');check('cancelled not ordinarily deleted')
# Note-only editing uses the same reset and reviewer notification contract.
r=do('NOT_FOUND',command(),3);r=do('UPDATED',r,payload={'payer_name':'Synthetic new payer','reported_amount':100000,'dog_name':'Synthetic dog','note':'Note only'});check('note edit also resets',r['status']=='REQUESTED')
# Lock/version competition. Exactly one winner, loser cannot duplicate a transition.
for left,right in [('UPDATED','CONFIRMED'),('UPDATED','NOT_FOUND'),('DELETED','CONFIRMED'),('DELETED','NOT_FOUND'),('NOT_FOUND','CONFIRMED')]:
 for i in range(5):
  r=command();keys=[key(),key()]
  def call(pair):
   action,k=pair
   try:return do(action,r,actor=2 if action in ['UPDATED','DELETED']else 3,k=k)
   except AssertionError as e:
    assert 'PAYMENT_VERSION_CONFLICT'in str(e)or 'PAYMENT_NOT_FOUND'in str(e),str(e);return None
  with concurrent.futures.ThreadPoolExecutor(2)as pool:out=list(pool.map(call,[(left,keys[0]),(right,keys[1])]))
  assert sum(x is not None for x in out)==1
 check(left+' x '+right+' five races: one winner/no deadlock')
for action in ['UPDATED','DELETED']:
 r=command();k=key()
 with concurrent.futures.ThreadPoolExecutor(2)as pool:out=list(pool.map(lambda _:do(action,r,k=k),range(2)))
 check(action+' concurrent identical retry',out[0]==out[1]and sql(f"SELECT count(*) FROM payment_request_audit_events WHERE request_id='{k}';")=='1')
check('financial ledger bytes unchanged',financial==sql("SELECT md5(string_agg(x::text,'' ORDER BY x::text)) FROM(SELECT to_jsonb(s)x FROM sales s UNION ALL SELECT to_jsonb(p)FROM sale_payments p UNION ALL SELECT to_jsonb(r)FROM sale_refunds r UNION ALL SELECT to_jsonb(m)FROM monthly_closings m)t;"))
for rpc in ['update','delete']:
 check(rpc+' RPC ACL',sql(f"SELECT has_function_privilege('authenticated','{rpc}_payment_confirmation_request_v1(uuid,bigint,jsonb,uuid)','EXECUTE') AND NOT has_function_privilege('anon','{rpc}_payment_confirmation_request_v1(uuid,bigint,jsonb,uuid)','EXECUTE') AND NOT has_function_privilege('service_role','{rpc}_payment_confirmation_request_v1(uuid,bigint,jsonb,uuid)','EXECUTE');")=='t')
r=command();sql('UPDATE payment_request_config SET payment_confirmation_enabled=false WHERE singleton;');do('UPDATED',r,fail='PAYMENT_DISABLED');do('DELETED',r,fail='PAYMENT_DISABLED');check('source OFF blocks new commands')
print('TOTAL',len(checks))
