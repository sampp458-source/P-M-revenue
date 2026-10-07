"""Disposable clone-only transactional predecessor/absence guard regression."""
import argparse,json,subprocess
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--pg-bin',required=True);p.add_argument('--socket',required=True);p.add_argument('--port',required=True);p.add_argument('--clone',required=True);p.add_argument('--migration',required=True);p.add_argument('--safeupdate-library',required=True);p.add_argument('--output',required=True);a=p.parse_args()
assert a.socket.startswith('/tmp/')
db='paymentqa_guards';conn=['-h',a.socket,'-p',a.port,'-U','postgres'];pg=Path(a.pg_bin)
def query(s):return subprocess.check_output([str(pg/'psql'),'-X',*conn,'-d',db,'-Atq','-v','ON_ERROR_STOP=1','-c',s],text=True).strip()
def snapshot():return query("SELECT md5(jsonb_build_object('classes',(SELECT jsonb_agg(c.relname ORDER BY c.relname) FROM pg_class c WHERE c.relnamespace='public'::regnamespace),'functions',(SELECT jsonb_agg(pg_get_functiondef(p.oid) ORDER BY p.oid::regprocedure::text) FROM pg_proc p WHERE p.pronamespace='public'::regnamespace),'constraints',(SELECT jsonb_agg(jsonb_build_array(c.conname,pg_get_constraintdef(c.oid),c.convalidated) ORDER BY c.conname) FROM pg_constraint c WHERE c.connamespace='public'::regnamespace))::text);")
cases=[
 ('missing capability CHECK','ALTER TABLE notification_capability_grants DROP CONSTRAINT notification_capability_grants_capability_check;','PAYMENT_CHECK_PREDECESSOR_MISMATCH'),
 ('missing deep-link CHECK','ALTER TABLE notifications DROP CONSTRAINT notifications_deep_link_type_check;','PAYMENT_CHECK_PREDECESSOR_MISMATCH'),
 ('capability definition drift',"ALTER TABLE notification_capability_grants DROP CONSTRAINT notification_capability_grants_capability_check;ALTER TABLE notification_capability_grants ADD CONSTRAINT notification_capability_grants_capability_check CHECK(capability IS NOT NULL);",'PAYMENT_CHECK_PREDECESSOR_MISMATCH'),
 ('deep-link definition drift',"ALTER TABLE notifications DROP CONSTRAINT notifications_deep_link_type_check;ALTER TABLE notifications ADD CONSTRAINT notifications_deep_link_type_check CHECK(deep_link_type IS NOT NULL);",'PAYMENT_CHECK_PREDECESSOR_MISMATCH'),
 ('unvalidated CHECK',"ALTER TABLE notification_capability_grants DROP CONSTRAINT notification_capability_grants_capability_check;ALTER TABLE notification_capability_grants ADD CONSTRAINT notification_capability_grants_capability_check CHECK(capability IN('ANNOUNCEMENT_PUBLISH','ANNOUNCEMENT_RECEIPTS_VIEW','TASK_REQUEST_CREATE')) NOT VALID;",'PAYMENT_CHECK_PREDECESSOR_MISMATCH'),
 ('partial table','CREATE TABLE public.payment_requests(id uuid);','PAYMENT_OBJECT_ALREADY_EXISTS'),
 ('partial helper','CREATE FUNCTION public.payment_command_v1() RETURNS void LANGUAGE sql AS $$SELECT$$;','PAYMENT_OBJECT_ALREADY_EXISTS'),
 ('partial index name','CREATE TABLE public.payment_request_inbox(id uuid);','PAYMENT_OBJECT_ALREADY_EXISTS'),
 ('function predecessor drift',"CREATE OR REPLACE FUNCTION public.push_delivery_valid_v1(p_delivery_id uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;",'PAYMENT_PREDECESSOR_MISMATCH'),
]
results=[]
for name,drift,error in cases:
 subprocess.run([str(pg/'dropdb'),*conn,'--if-exists',db],check=True,capture_output=True)
 subprocess.run([str(pg/'createdb'),*conn,db],check=True,capture_output=True)
 subprocess.run([str(pg/'psql'),'-X',*conn,'-d',db,'-v','ON_ERROR_STOP=1','-f',a.clone],check=True,capture_output=True)
 query(drift);before=snapshot()
 r=subprocess.run([str(pg/'psql'),'-X',*conn,'-d',db,'-v','ON_ERROR_STOP=1','-c',"LOAD '"+a.safeupdate_library.replace("'","''")+"';",'-f',a.migration],text=True,capture_output=True)
 assert r.returncode and error in r.stderr,(name,r.stderr)
 assert snapshot()==before,name+' partial mutation/rollback failure'
 results.append({'case':name,'error':error,'schema_rollback':'EXACT_MATCH'});print('PASS',name,'transaction rollback exact',flush=True)
Path(a.output).write_text(json.dumps(results,indent=2));print('TOTAL',len(results))
subprocess.run([str(pg/'dropdb'),*conn,db],check=True,capture_output=True)
