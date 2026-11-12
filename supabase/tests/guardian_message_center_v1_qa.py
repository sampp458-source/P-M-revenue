"""Socket-only synthetic contract QA. Never accepts a network DSN or Production credentials."""
import concurrent.futures
import json
from pathlib import Path
import subprocess
import tempfile
import uuid
PG=Path('/opt/homebrew/opt/postgresql@18/bin')
ROOT=Path(__file__).resolve().parents[2]
out=ROOT/'outputs/guardian-message-center-v1';out.mkdir(parents=True,exist_ok=True)
cluster=Path(tempfile.mkdtemp(prefix='pnm-guardian-qa-'));port='55677';checks=[]
def run(args,**kw):
 r=subprocess.run([str(x) for x in args],capture_output=True,text=True,**kw)
 if r.returncode:raise RuntimeError(r.stderr[-4000:])
 return r.stdout

def sql(source):return run([PG/'psql','-X','-Atq','-v','ON_ERROR_STOP=1','-h',cluster,'-p',port,'-U','postgres','-d','postgres'],input=source).strip()
def check(name,condition):
 if not condition:raise AssertionError(name)
 checks.append(name);print('PASS',name,flush=True)
def rejects(name,source,needle):
 try:sql(source)
 except RuntimeError as e:check(name,needle in str(e));return
 raise AssertionError(name+' accepted')
def uid(n):return '00000000-0000-4000-8000-'+str(n).zfill(12)
def auth(n,source):return f"set role authenticated;select set_config('request.jwt.claim.sub','{uid(n)}',false);"+source
unit='hotel'
def snapshot(text='synthetic manual test',channel='SMS',customer=10):return dict(unit=unit,customerId=uid(customer),channel=channel,type='일반 문자 직접 작성',to='01000000000',originalPhone='01000000000',text=text,phoneChanged=False,overrideReason=None,fallback=False,sender='0212345678',costLabel='contract test')
def save(n=1,text='synthetic manual test',rid=None):
 rid=rid or str(uuid.uuid4());s=snapshot(text);v=json.loads(sql(f"set role service_role;select save_guardian_message_v1('{uid(n)}','{rid}','{json.dumps(s,ensure_ascii=False)}');"));return v,rid,s
try:
 run([PG/'initdb','-D',cluster/'data','-A','trust','-U','postgres','--no-locale','-E','UTF8'])
 run([PG/'pg_ctl','-D',cluster/'data','-l',cluster/'server.log','-o',f"-k {cluster} -p {port} -c listen_addresses=''",'-w','start'])
 check('isolated Unix socket, no TCP listener',sql('show listen_addresses;')=='')
 sql('''CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 GRANT USAGE ON SCHEMA auth TO authenticated,service_role;
 CREATE TABLE profiles(id uuid PRIMARY KEY,role text,is_active boolean,account_status text,name text DEFAULT 'Synthetic Staff');
 CREATE TABLE operation_memberships(profile_id uuid,role text,is_active boolean);
 CREATE TABLE customers(id uuid PRIMARY KEY,name text,phone text,is_active boolean);
 CREATE TABLE dogs(id uuid PRIMARY KEY,customer_id uuid,name text,is_active boolean);
 CREATE TABLE business_units(id uuid PRIMARY KEY,code text);
 CREATE TABLE operation_calendars(id uuid PRIMARY KEY,business_unit_id uuid,scope_type text);
 CREATE TABLE operation_schedules(id uuid PRIMARY KEY,calendar_id uuid,title text,starts_at timestamptz,ends_at timestamptz,status text,version int,archived_at timestamptz,time_unspecified boolean,all_day boolean);
 CREATE TABLE operation_schedule_customers(schedule_id uuid,customer_id uuid,archived_at timestamptz);
 CREATE TABLE operation_schedule_assignees(schedule_id uuid,profile_id uuid,archived_at timestamptz);
 CREATE TABLE operation_schedule_dogs(schedule_id uuid,dog_id uuid,archived_at timestamptz);
 CREATE FUNCTION is_active_operation_member() RETURNS boolean LANGUAGE sql AS $$SELECT EXISTS(SELECT 1 FROM operation_memberships WHERE profile_id=auth.uid() AND is_active)$$;''')
 sql("CREATE FUNCTION guardian_message_external_contract_v1() RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$SELECT true$$;")
 original_acl=sql("select coalesce(proacl::text,'PUBLIC_DEFAULT') from pg_proc where oid='guardian_message_external_contract_v1()'::regprocedure;")
 sql((ROOT/'supabase/migrations/202611060001_guardian_message_center_v1.sql').read_text())
 check('migration never changes unrelated guardian-like function ACL',sql("select coalesce(proacl::text,'PUBLIC_DEFAULT') from pg_proc where oid='guardian_message_external_contract_v1()'::regprocedure;")==original_acl)
 sql(f"insert into profiles(id,role,is_active,account_status) values('{uid(1)}','admin',true,'active'),('{uid(2)}','staff',true,'active'),('{uid(3)}','staff',false,'active'),('{uid(4)}','staff',true,'active');insert into operation_memberships values('{uid(1)}','owner',true),('{uid(2)}','staff',true),('{uid(3)}','staff',true),('{uid(4)}','staff',true);insert into customers values('{uid(10)}','QA Guardian','01000000000',true),('{uid(11)}','Other Guardian','01011111111',true);insert into dogs values('{uid(12)}','{uid(10)}','QA Dog',true);insert into business_units values('{uid(20)}','hotel');insert into operation_calendars values('{uid(21)}','{uid(20)}','business_unit');insert into operation_schedules values('{uid(30)}','{uid(21)}','QA Consultation','2026-11-06T01:00Z','2026-11-06T02:00Z','scheduled',1,null,false,false);insert into operation_schedule_customers values('{uid(30)}','{uid(10)}',null);insert into operation_schedule_assignees values('{uid(30)}','{uid(2)}',null);")
 sql(f"insert into operation_schedule_dogs values('{uid(30)}','{uid(12)}',null);insert into dogs values('{uid(13)}','{uid(10)}','Other Household Dog',true);")
 check('default OFF and internal test gate false',json.loads(sql(auth(1,'select get_guardian_message_access_v1();')) .splitlines()[-1])['enabled'] is False)
 check('admin active Operations access',len(json.loads(sql(auth(1,'select get_guardian_message_access_v1();')).splitlines()[-1])['units'])==3)
 check('staff deny by default',json.loads(sql(auth(2,'select get_guardian_message_access_v1();')).splitlines()[-1])['units']==[])
 rejects('anonymous read denied','set role anon;select get_guardian_message_access_v1();','permission denied')
 rejects('authenticated direct table select denied',auth(1,'select * from guardian_messages;'),'permission denied')
 rejects('authenticated cannot claim/send or impersonate actor',auth(1,f"select claim_guardian_message_v1('{uid(1)}','{uid(100)}','x');"),'permission denied')
 rejects('service cannot bypass via direct table writes','set role service_role;update guardian_message_config set enabled=true;','permission denied')
 permission_request=str(uuid.uuid4())
 permission=f"select set_guardian_message_permission_v1('{uid(2)}','hotel',true,'Local QA approved department','{permission_request}');"
 rejects('staff cannot self grant sending permission',auth(2,permission),'MESSAGE_FORBIDDEN')
 sql(auth(1,permission));sql(auth(1,permission))
 check('permission replay audited once',sql(f"select count(*) from guardian_message_audit where request_id='{permission_request}';")=='1')
 rejects('permission request altered replay rejected',auth(1,permission.replace('true','false')),'MESSAGE_REQUEST_MISMATCH')
 rejects('inactive permission target rejected',auth(1,f"select set_guardian_message_permission_v1('{uid(3)}','hotel',true,'Local QA target check','{uuid.uuid4()}');"),'MESSAGE_PERMISSION_TARGET')
 check('permission directory exposes names and units only',set(json.loads(sql(auth(1,'select get_guardian_message_staff_v1();')).splitlines()[-1])[0])=={'id','name','units'})
 rejects('staff cannot read admin permission directory',auth(2,'select get_guardian_message_staff_v1();'),'MESSAGE_FORBIDDEN')
 sql(f"insert into guardian_message_permissions values('{uid(3)}','hotel',true);")
 check('inactive granted employee denied',json.loads(sql(auth(3,'select get_guardian_message_access_v1();')).splitlines()[-1])['units']==[])
 contacts=json.loads(sql(auth(2,"select search_guardian_message_customers_v1('hotel','Guardian');")).splitlines()[-1]);check('staff limited to assigned customer',len(contacts)==1 and contacts[0]['id']==uid(10));check('list masks phone',contacts[0]['phone_masked']=='010****0000')
 rejects('unassigned customer detail denied',auth(2,f"select get_guardian_message_context_v1('hotel','{uid(11)}');"),'MESSAGE_FORBIDDEN')
 check('short query never enumerates contacts',sql(auth(2,"select search_guardian_message_customers_v1('hotel','Q');")).splitlines()[-1]=='[]')
 c=json.loads(sql(auth(2,f"select get_guardian_message_context_v1('hotel','{uid(10)}','{uid(30)}');")).splitlines()[-1]);check('context exact linked schedule and contact',c['phone']=='01000000000' and c['scheduleVersion']==1 and c['dogNames']=='QA Dog')
 sql(f"update operation_schedules set time_unspecified=true where id='{uid(30)}';")
 check('unknown schedule time never fabricated',json.loads(sql(auth(2,f"select get_guardian_message_context_v1('hotel','{uid(10)}','{uid(30)}');")).splitlines()[-1])['startsAt'] is None)
 sql(f"update operation_schedules set time_unspecified=false where id='{uid(30)}';")
 a,rid,s=save(2);check('preview saves immutable snapshot/hash',len(a['hash'])==64)
 check('same request replay returns same ID',json.loads(sql(f"set role service_role;select save_guardian_message_v1('{uid(2)}','{rid}','{json.dumps(s)}');"))['id']==a['id'])
 altered=s.copy();altered['text']='different';rejects('same request payload mismatch',f"set role service_role;select save_guardian_message_v1('{uid(2)}','{rid}','{json.dumps(altered)}');",'MESSAGE_REQUEST_MISMATCH')
 rejects('OFF rejects actual claim',f"set role service_role;select claim_guardian_message_v1('{uid(2)}','{a['id']}','{a['hash']}');",'MESSAGE_DISABLED')
 sql('update guardian_message_config set enabled=true;')
 rejects('enabled alone cannot bypass internal test gate',f"set role service_role;select claim_guardian_message_v1('{uid(2)}','{a['id']}','{a['hash']}');",'MESSAGE_DISABLED')
 sql('update guardian_message_config set internal_test_verified=true;')
 rejects('old enabled and verified flags cannot bypass explicit OFF scope',f"set role service_role;select claim_guardian_message_v1('{uid(2)}','{a['id']}','{a['hash']}');",'MESSAGE_DISABLED')
 check('internal allowlist empty on installation',sql('select count(*) from guardian_message_internal_recipients;')=='0')
 sql("update guardian_message_config set send_scope='internal',internal_test_verified=false;")
 internal,_,_=save(1,'synthetic internal-only test')
 internal_claim=f"set role service_role;select claim_guardian_message_v1('{uid(1)}','{internal['id']}','{internal['hash']}');"
 rejects('empty allowlist denies internal claim',internal_claim,'MESSAGE_DISABLED')
 approve_request=str(uuid.uuid4())
 approve=f"select set_guardian_message_internal_recipient_v1('01000000000',true,'Synthetic QA approval only','{approve_request}');"
 rejects('ordinary staff cannot register test recipients',auth(2,approve),'MESSAGE_FORBIDDEN')
 sql(auth(1,approve));sql(auth(1,approve))
 check('internal approval audit idempotent',sql(f"select count(*) from guardian_message_audit where request_id='{approve_request}';")=='1')
 check('internal allowlist uses exact destination',sql(auth(1,"select is_guardian_message_internal_recipient_v1('01011111111');")).splitlines()[-1]=='f')
 rejects('staff cannot claim internal even when recipient is approved',f"set role service_role;select claim_guardian_message_v1('{uid(2)}','{a['id']}','{a['hash']}');",'MESSAGE_DISABLED')
 check('approved internal recipient can be claimed by administrator before live test verification',json.loads(sql(internal_claim))['claimed'] is True)
 sql(f"set role service_role;select finish_guardian_message_v1('{uid(1)}','{internal['id']}','failed',null,null,'PROVIDER_REJECTED');")
 check('internal tests never enable customer send scope',sql('select send_scope from guardian_message_config;')=='internal')
 sql("update guardian_message_config set send_scope='live',internal_test_verified=false;")
 rejects('live scope requires completed internal verification',f"set role service_role;select claim_guardian_message_v1('{uid(2)}','{a['id']}','{a['hash']}');",'MESSAGE_DISABLED')
 sql('update guardian_message_config set internal_test_verified=true;')
 rejects('snapshot mismatch blocked',f"set role service_role;select claim_guardian_message_v1('{uid(2)}','{a['id']}','wrong');",'MESSAGE_SNAPSHOT_CHANGED')
 sql(f"update customers set phone='01099999999' where id='{uid(10)}';")
 rejects('stale customer phone blocked',f"set role service_role;select claim_guardian_message_v1('{uid(2)}','{a['id']}','{a['hash']}');",'MESSAGE_CONTEXT_CHANGED')
 sql(f"update customers set phone='01000000000' where id='{uid(10)}';")
 rejects('failed transaction rolls back claim and audit',f"begin;set role service_role;select claim_guardian_message_v1('{uid(2)}','{a['id']}','{a['hash']}');select 1/0;commit;",'division by zero')
 check('rollback restored draft',sql(f"select status from guardian_messages where id='{a['id']}';")=='draft')
 claim=f"set role service_role;select claim_guardian_message_v1('{uid(2)}','{a['id']}','{a['hash']}');"
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(lambda _:json.loads(sql(claim)),range(2)))
 check('concurrent double click claims once',sum(x['claimed'] for x in results)==1)
 sql(f"set role service_role;select finish_guardian_message_v1('{uid(2)}','{a['id']}','unknown',null,null,'PROVIDER_UNCERTAIN');")
 check('timeout cannot be claimed again',json.loads(sql(claim))['claimed'] is False)
 sql(f"set role service_role;select finish_guardian_message_v1('{uid(1)}','{a['id']}','processing','m','g','3000');")
 check('admin result observer recorded as actual actor',sql(f"select actor_id from guardian_message_audit where message_id='{a['id']}' order by recorded_at desc limit 1;")==uid(1))
 check('observer does not change original requester',sql(f"select actor_id from guardian_messages where id='{a['id']}';")==uid(2))
 rejects('wrong provider message ID never updates result',f"set role service_role;select finish_guardian_message_v1('{uid(2)}','{a['id']}','success','wrong','g','4000');",'MESSAGE_PROVIDER_ID_MISMATCH')
 rejects('wrong provider group ID never updates result',f"set role service_role;select finish_guardian_message_v1('{uid(2)}','{a['id']}','success','m','wrong','4000');",'MESSAGE_PROVIDER_ID_MISMATCH')
 rejects('success without both identities blocked',f"set role service_role;select finish_guardian_message_v1('{uid(2)}','{a['id']}','success','m',null,'4000');",'MESSAGE_PROVIDER_ID_REQUIRED')
 rejects('unapproved replacement result is not accepted',f"set role service_role;select finish_guardian_message_v1('{uid(2)}','{a['id']}','success','m','g','4000',true);",'MESSAGE_UNAPPROVED_FALLBACK')
 sql(f"set role service_role;select finish_guardian_message_v1('{uid(2)}','{a['id']}','accepted','m','g','2000');")
 check('late acceptance cannot regress processing',sql(f"select status from guardian_messages where id='{a['id']}';")=='processing')

 rejects('unconfirmed success blocked',f"set role service_role;select finish_guardian_message_v1('{uid(2)}','{a['id']}','success','m','g','2000');",'MESSAGE_UNCONFIRMED_SUCCESS')
 sql(f"set role service_role;select finish_guardian_message_v1('{uid(2)}','{a['id']}','accepted','m','g','2000');select finish_guardian_message_v1('{uid(2)}','{a['id']}','success','m','g','4000');")
 check('provider terminal result tracked',sql(f"select status from guardian_messages where id='{a['id']}';")=='success')
 b,_,_=save(2);rejects('new request duplicate content rate limited',f"set role service_role;select claim_guardian_message_v1('{uid(2)}','{b['id']}','{b['hash']}');",'MESSAGE_RATE_LIMIT')
 rejects('other employee cannot view sensitive message',auth(4,f"select get_guardian_message_v1('{a['id']}');"),'MESSAGE_FORBIDDEN')
 check('other staff history empty',sql(auth(4,'select list_guardian_messages_v1();')).splitlines()[-1]=='[]')
 check('history latest first and masked',json.loads(sql(auth(2,'select list_guardian_messages_v1();')).splitlines()[-1])[0]['recipient']=='010****0000')
 check('audit contains claim and final status',int(sql(f"select count(*) from guardian_message_audit where message_id='{a['id']}';"))>=4)
 check('all new tables RLS enabled',sql("select count(*) from pg_class where relname in('guardian_messages','guardian_message_config','guardian_message_permissions','guardian_message_audit','guardian_message_internal_recipients') and relrowsecurity;")=='5')
 check('no global trigger business mutations',sql("select count(*) from pg_trigger where not tgisinternal;")=='0')
 check('all new functions fixed search path/definer',sql("select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like '%guardian_message%' and (not prosecdef or proconfig is null);")=='0')
 # Business hard-delete compatibility: foreign key clears metadata references, snapshot/audit preserved.
 sql(f"delete from operation_schedule_assignees;delete from operation_schedule_customers;delete from operation_schedule_dogs;delete from operation_schedules where id='{uid(30)}';delete from dogs;delete from customers where id='{uid(10)}';")
 check('customer cleanup preserves message snapshot/audit',sql(f"select snapshot->>'customerId' from guardian_messages where id='{a['id']}';")==uid(10))
 check('metadata FK does not block old customer deletion',sql(f"select customer_id is null from guardian_messages where id='{a['id']}';")=='t')
 print('LOCAL DB',len(checks),'PASS')
 (out/'local-db-results.json').write_text(json.dumps({'boundary':'Isolated Unix-socket PostgreSQL synthetic fixture based on audited dependencies, not a full Production clone','checks':checks,'pass':len(checks)},indent=2))
finally:
 subprocess.run([str(PG/'pg_ctl'),'-D',str(cluster/'data'),'-m','immediate','-w','stop'],capture_output=True)
