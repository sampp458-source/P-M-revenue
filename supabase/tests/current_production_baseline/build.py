"""Build ONLY a new Unix-socket isolated DB from a catalog-only capture.
No remote connection support. No historical migration replay or candidate apply.
Production capture stays outside the source tree. Full alignment is fail-closed.
"""
import argparse, hashlib, json, re, subprocess, tempfile
from pathlib import Path

Q=lambda s:'"'+s.replace('"','""')+'"'
L=lambda s:"'"+s.replace("'","''")+"'"

def main():
 p=argparse.ArgumentParser();p.add_argument('manifest',type=Path);p.add_argument('--pg-bin',type=Path,default=Path('/opt/homebrew/opt/postgresql@18/bin'));p.add_argument('--output',type=Path,required=True);a=p.parse_args()
 m=json.loads(a.manifest.read_text()); assert m['readOnly']=='on'
 a.output.mkdir(parents=True,exist_ok=True); cluster=Path(tempfile.mkdtemp(prefix='dog-current-baseline-')); report={'status':'BLOCKED','cluster':str(cluster),'productionManifestSha256':hashlib.sha256(a.manifest.read_bytes()).hexdigest(),'environmentDifferences':[],'candidateApplied':False}
 def run(args,**kw):return subprocess.run([str(x) for x in args],text=True,capture_output=True,**kw)
 def sql(s):
  r=run([a.pg_bin/'psql','-X','-h',cluster,'-p','55509','-U','postgres','-d','dog_current_baseline','-v','ON_ERROR_STOP=1','-At'],input=s)
  if r.returncode:raise RuntimeError(r.stderr)
  return r.stdout
 def acl(kind,target,items,owner):
  # Explicit absence of grants is preserved, including PostgreSQL default PUBLIC function EXECUTE.
  commands=[f'REVOKE ALL ON {kind} {target} FROM PUBLIC,anon,authenticated,service_role;']
  mapping={'r':'SELECT','a':'INSERT','w':'UPDATE','d':'DELETE','D':'TRUNCATE','x':'REFERENCES','t':'TRIGGER','X':'EXECUTE','U':'USAGE','m':'MAINTAIN'}
  if items is None: items=[owner+'=X/'+owner,'=X/'+owner] if kind=='FUNCTION' else []
  for item in items:
   match=re.fullmatch(r'([^=]*)=([^/]*)/(.+)',item); assert match,item
   grantee,privs,grantor=match.groups(); assert grantor==owner,(target,item)
   role=Q(grantee) if grantee else 'PUBLIC'
   for code,star in re.findall(r'([A-Za-z])(\*?)',privs):
    if code not in mapping:raise RuntimeError('Unmodeled ACL '+item)
    commands.append(f'GRANT {mapping[code]} ON {kind} {target} TO {role}'+(' WITH GRANT OPTION' if star else '')+';')
  return '\n'.join(commands)
 try:
  r=run([a.pg_bin/'initdb','-D',cluster/'data','--auth=trust','--username=postgres','--no-locale']);assert r.returncode==0,r.stderr
  r=run([a.pg_bin/'pg_ctl','-D',cluster/'data','-l',cluster/'server.log','-o',f"-h '' -k {cluster} -p 55509",'start']);assert r.returncode==0,r.stderr
  r=run([a.pg_bin/'createdb','-h',cluster,'-p','55509','-U','postgres','dog_current_baseline']);assert r.returncode==0,r.stderr
  sql("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE ROLE supabase_auth_admin; CREATE SCHEMA auth; CREATE SCHEMA extensions; GRANT USAGE ON SCHEMA public,auth,extensions TO authenticated,anon,service_role; CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_user_meta_data jsonb,created_at timestamptz DEFAULT now());")
  roles={f['owner'] for f in m['functions']}|{t['owner'] for t in m['relations']}
  for obj in m['functions']+m['relations']:
   for item in obj['acl'] or []:roles.add(item.split('=')[0])
  for role in sorted(roles-{'','postgres','anon','authenticated','service_role','supabase_auth_admin'}):sql('CREATE ROLE '+Q(role)+';')
  report['environmentDifferences'].append('auth.users is a synthetic identity boundary (id/email/raw_user_meta_data/created_at); no auth business rows copied')
  localver=sql('SHOW server_version;').strip();report['localVersion']=localver
  if localver!=m['serverVersion']:report['environmentDifferences'].append('PostgreSQL '+m['serverVersion']+' -> '+localver)
  for e in m['extensions']:
   if e['name']=='plpgsql':continue
   if e['name'] in ('supabase_vault','pg_stat_statements'):
    report['environmentDifferences'].append('Not installed: '+e['name']+' '+e['version']+'; transitive dependency must be ruled out');continue
   sql(f"CREATE EXTENSION {Q(e['name'])} WITH SCHEMA {Q(e['schema'])} VERSION {L(e['version'])};")
  assert not m['types'],'Unmodeled enum/domain types'
  for t in m['relations']:
   assert t['kind']=='r' and not t['options'],t['name']
   cols=[]
   for c in t['columns']:
    assert not c['identity'] and not c['generated'],c
    cols.append(Q(c['name'])+' '+c['type']+(' NOT NULL' if c['notNull'] else ''))
   sql('CREATE TABLE public.'+Q(t['name'])+'('+','.join(cols)+');')
  # Functions remain verbatim; check_function_bodies=false only defers dependency order validation.
  sql('SET check_function_bodies=false;\n'+'\n'.join(f['definition']+';' for f in m['functions']))
  for t in m['relations']:
   for c in t['columns']:
    if c['default'] is not None:sql('ALTER TABLE public.'+Q(t['name'])+' ALTER COLUMN '+Q(c['name'])+' SET DEFAULT '+c['default']+';')
  for c in sorted(m['constraints'],key=lambda c:c['type']=='f'):
   if c['type']=='t':continue  # Recreated by its captured CONSTRAINT TRIGGER, not ALTER TABLE.
   sql('ALTER TABLE '+c['table']+' ADD CONSTRAINT '+Q(c['name'])+' '+c['definition']+';')
  for i in m['indexes']:
   if not i['constraintOwned']:sql(i['definition']+';')
  for t in m['triggers']:
   sql(t['definition']+';')
   if t['enabled']!='O':sql('ALTER TABLE '+t['table']+' '+{'D':'DISABLE','R':'ENABLE REPLICA','A':'ENABLE ALWAYS'}[t['enabled']]+' TRIGGER '+Q(t['name'])+';')
  for p in m['policies']:
   cmd={'*':'ALL','r':'SELECT','a':'INSERT','w':'UPDATE','d':'DELETE'}[p['command']]
   sql('CREATE POLICY '+Q(p['name'])+' ON '+p['table']+' AS '+('PERMISSIVE' if p['permissive'] else 'RESTRICTIVE')+' FOR '+cmd+' TO '+','.join(Q(x) for x in p['roles'])+(' USING ('+p['using']+')' if p['using'] else '')+(' WITH CHECK ('+p['check']+')' if p['check'] else '')+';')
  for t in m['relations']:
   target='public.'+Q(t['name']);sql('ALTER TABLE '+target+' OWNER TO '+Q(t['owner'])+';'+acl('TABLE',target,t['acl'],t['owner']))
   if t['rls']:sql('ALTER TABLE '+target+' ENABLE ROW LEVEL SECURITY;')
   if t['forceRls']:sql('ALTER TABLE '+target+' FORCE ROW LEVEL SECURITY;')
   for c in t['columns']:
    if c['acl']:raise RuntimeError('Column ACL requires exact implementation: '+t['name']+'.'+c['name'])
  for f in m['functions']:
   sql('ALTER FUNCTION '+f['signature']+' OWNER TO '+Q(f['owner'])+';'+acl('FUNCTION',f['signature'],f['acl'],f['owner']))
  # Validation executes every definition again with normal checking where PostgreSQL supports it.
  sql('SET check_function_bodies=true;\n'+'\n'.join(f['definition']+';' for f in m['functions']))
  # Store machine-readable catalog via the same capture query, independent of psql formatting.
  capture=Path(__file__).with_name('catalog.sql').read_text();capture=capture[:capture.index('SELECT n AS chunk_number')]+"SELECT catalog FROM manifest;\nROLLBACK;"
  raw=sql(capture); local=json.loads(next(line for line in raw.splitlines() if line.startswith('{')));(a.output/'local-catalog.json').write_text(json.dumps(local,ensure_ascii=False,indent=2))
  diffs={}
  for key in ['relations','functions','constraints','indexes','triggers','policies','types']:
   left=json.loads(json.dumps(m[key]));right=json.loads(json.dumps(local[key]))
   if key=='functions':
    for f in left+right:
     if f['acl'] is not None:f['acl']=sorted(f['acl'])
   if key=='constraints':
    # PG18 exposes NOT NULL as pg_constraint rows; PG17 exposes attnotnull only.
    # Relations/columns (including attnotnull) must independently match exactly.
    report['pg18NotNullCatalogRows']=sum(c['type']=='n' for c in right)
    right=[c for c in right if c['type']!='n']
   left.sort(key=lambda x:json.dumps(x,sort_keys=True,ensure_ascii=False))
   right.sort(key=lambda x:json.dumps(x,sort_keys=True,ensure_ascii=False))
   # Object order depends on cluster collation; every per-object value stays exact.
   if left!=right:diffs[key]={'production':left,'local':right}
  (a.output/'alignment-differences.json').write_text(json.dumps(diffs,ensure_ascii=False,indent=2))
  report['alignmentMismatchCategories']=list(diffs);report['status']='CATALOG_MATCH_ENVIRONMENT_REVIEW_REQUIRED' if not diffs else 'ALIGNMENT_BLOCKED'
 except Exception as ex:report['error']=str(ex)
 finally:
  if (cluster/'data/postmaster.pid').exists():run([a.pg_bin/'pg_ctl','-D',cluster/'data','stop','-m','fast'])
  (a.output/'build-result.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
 return 0 if report['status']=='CATALOG_MATCH_ENVIRONMENT_REVIEW_REQUIRED' else 2
if __name__=='__main__':raise SystemExit(main())
