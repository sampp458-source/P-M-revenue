"""Build current catalog baseline, prove alignment, append correction + candidate locally.
No Production connection support. Independent test failures remain release failures.
"""
import argparse,hashlib,json,subprocess,sys
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('manifest',type=Path);p.add_argument('output',type=Path);p.add_argument('--accept-local-environment-differences',action='store_true');a=p.parse_args()
assert a.accept_local_environment_differences,'Review PG/auth/extension boundaries first'
here=Path(__file__).resolve().parent;root=here.parents[2];pg=Path('/opt/homebrew/opt/postgresql@18/bin');a.output.mkdir(parents=True,exist_ok=True);results={};cluster=None
correction=root/'supabase/migrations/202609170002_dog_schedule_audit_trace_resolution.sql';candidate=root/'supabase/migrations/202609180001_dog_profile_removal.sql'
closure=root/'supabase/migrations/202609170003_dog_structured_trace_provenance_closure.sql'
results['migrationHashes']={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in [correction,closure,candidate]}
def process(args,label):
 r=subprocess.run([str(x) for x in args],text=True,capture_output=True);(a.output/(label+'.log')).write_text(r.stdout+r.stderr);results[label]={'exitCode':r.returncode,'status':'PASS' if r.returncode==0 else 'FAIL'};return r
try:
 r=process([sys.executable,here/'build.py',a.manifest,'--output',a.output/'baseline'],'build');assert r.returncode==0
 b=json.loads((a.output/'baseline/build-result.json').read_text());assert b['alignmentMismatchCategories']==[];cluster=Path(b['cluster'])
 assert process([pg/'pg_ctl','-D',cluster/'data','-l',cluster/'server.log','-o',f"-h '' -k {cluster} -p 55509",'start'],'start').returncode==0
 def sqlfile(path,label):return process([pg/'psql','-X','-h',cluster,'-p','55509','-U','postgres','-d','dog_current_baseline','-v','ON_ERROR_STOP=1','-f',path],label)
 assert sqlfile(here/'seed.sql','seed').returncode==0
 for f in ['domain_smoke','domain_extended']:assert sqlfile(here/(f+'.sql'),'pre_'+f).returncode==0
 assert sqlfile(correction,'correction_apply').returncode==0
 assert sqlfile(here/'schedule_audit_provenance.sql','v2a_provenance').returncode==0
 assert sqlfile(closure,'closure_apply').returncode==0
 assert sqlfile(candidate,'v2b_apply').returncode==0
 for f in ['schedule_audit_provenance','domain_smoke','domain_extended','removal_matrix','sales_completed_removal','domain_removal','domain_removal_independent','shared_terminal','journal_provenance','request_provenance','lifecycle_negative','rollback_permission','performance']:
  sqlfile(here/(f+'.sql'),f)
 process([sys.executable,here/'real_rpc_concurrency.py',a.output/'baseline/build-result.json',a.output],'concurrency')
except Exception as e:results['infrastructureError']=repr(e)
finally:
 if cluster:process([pg/'pg_ctl','-D',cluster/'data','stop','-m','fast'],'stop')
 results['releasePass']=not results.get('infrastructureError') and all(x.get('status')=='PASS' for x in results.values() if isinstance(x,dict) and 'status' in x)
 (a.output/'integration-result.json').write_text(json.dumps(results,indent=2));print(json.dumps(results,indent=2))
raise SystemExit(0 if results['releasePass'] else 2)
