"""Disposable local schema-only migration guard and pre-existing row compatibility QA."""
from pathlib import Path
import json,subprocess,hashlib,re
import argparse
parser=argparse.ArgumentParser();parser.add_argument('--pg-bin',required=True);parser.add_argument('--socket',required=True);parser.add_argument('--port',required=True);parser.add_argument('--clone-schema',required=True);parser.add_argument('--output',required=True);options=parser.parse_args()
assert options.socket.startswith('/tmp/')
r=Path(__file__).resolve().parents[2];pg=options.pg_bin.rstrip('/')+'/';args=['-h',options.socket,'-p',options.port,'-U','postgres'];out=Path(options.output);out.mkdir(parents=True,exist_ok=True)
def q(s,db='paymentqa_guard',fail=False):
 x=subprocess.run([pg+'psql','-X',*args,'-d',db,'-Atq','-v','ON_ERROR_STOP=1'],input=s,text=True,capture_output=True)
 if fail:assert x.returncode,x.stdout
 else:assert not x.returncode,x.stderr
 return x.stdout if not fail else x.stderr
subprocess.run([pg+'dropdb',*args,'--if-exists','paymentqa_guard'],capture_output=True,check=True);subprocess.run([pg+'createdb',*args,'paymentqa_guard'],check=True)
q(Path(options.clone_schema).read_text());q((r/'supabase/migrations/202610070001_payment_requests_v1.sql').read_text())
s=(r/'supabase/migrations/202610070002_payment_confirmation_reopen_edit_delete_fix.sql').read_text()
checks={}
for name in re.findall("PREDECESSOR_MISMATCH: (\\w+)",s):
 sig=q(f"SELECT oid::regprocedure::text FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='{name}';").strip()
 # A config alteration changes pg_get_functiondef, inside candidate's own transaction.
 altered=s.replace('BEGIN;',f'BEGIN; ALTER FUNCTION {sig} SET statement_timeout=\'1s\';',1)
 checks[name]='CONFIRMATION_PREDECESSOR_MISMATCH' in q(altered,fail=True)
 checks[name+' rollback']=q("SELECT count(*)FROM pg_attribute WHERE attrelid='payment_confirmation_requests'::regclass AND attname='deleted_at'AND NOT attisdropped;").strip()=='0'
# Synthetic pre-fix NOT_FOUND row: migration must not rewrite even version/timestamps.
u='71000000-0000-4000-8000-000000000001';v='71000000-0000-4000-8000-000000000002';rid='71000000-0000-4000-8000-000000000003'
q(f"INSERT INTO auth.users(id)VALUES('{u}'),('{v}');INSERT INTO profiles(id,name,role,is_active,account_status)VALUES('{u}','Synthetic requester','admin',true,'active'),('{v}','Synthetic reviewer','staff',true,'active');INSERT INTO notification_capability_grants(profile_id,capability,active,granted_by)VALUES('{v}','PAYMENT_CONFIRMATION_REVIEW',true,'{u}');INSERT INTO payment_confirmation_requests(id,requester_id,reviewer_id,payer_name,reported_amount,status,request_id,payload_hash,version,resolved_at,resolved_by)VALUES('{rid}','{u}','{v}','Existing pilot equivalent',10000,'NOT_FOUND',gen_random_uuid(),'synthetic',2,now(),'{v}');")
before=q(f"SELECT to_jsonb(r) FROM payment_confirmation_requests r WHERE id='{rid}';").strip();q(s);after=q(f"SELECT to_jsonb(r)-ARRAY['deleted_at','deleted_by'] FROM payment_confirmation_requests r WHERE id='{rid}';").strip();checks['existing_NOT_FOUND_byte_equivalent']=before==after
q("UPDATE payment_request_config SET payment_confirmation_enabled=true WHERE singleton;")
checks['existing_pilot_OPEN']=q(f"SET ROLE authenticated;SET request.jwt.claim.sub='{v}';SELECT (get_request_hub_v1('inbox','PAYMENT_CONFIRMATION_REQUEST','active',0)->'items'->0->>'lifecycle')='OPEN';").strip()=='t'
checks['existing_pilot_confirmable']='CONFIRMED'in q(f"SET ROLE authenticated;SET request.jwt.claim.sub='{v}';SELECT confirm_payment_confirmation_request_v1(gen_random_uuid(),2,'{{}}','{rid}');")
checks['reapply_rejected']='CONFIRMATION_PREDECESSOR_MISMATCH'in q(s,fail=True)
(out/'migration-checks.json').write_text(json.dumps(checks,indent=2));print(json.dumps(checks,indent=2));assert all(checks.values())
