"""Conservative full-public closure, including FK and trigger edges.
PL/pgSQL string bodies are not fully represented by pg_depend. Source references
are included; the sole captured dynamic SQL resolver is reviewed separately.
This report does NOT certify arbitrary dynamic SQL with a regex.
"""
import json,re,sys
from pathlib import Path
m=json.loads(Path(sys.argv[1]).read_text());out=Path(sys.argv[2]);out.mkdir(exist_ok=True,parents=True)
functions={f['signature']:f for f in m['functions']};byname={}
for sig,f in functions.items():byname.setdefault(f['name'],set()).add('function:'+sig)
tables={t['name'] for t in m['relations']};edges={};missing={};dynamic=[]
for sig,f in functions.items():
 key='function:'+sig;edges[key]=set()
 for name in set(re.findall(r'\bpublic\.([a-z_][a-z_0-9]*)',f['body'],re.I)):
  if name in tables:edges[key].add('table:'+name)
  if name in byname:edges[key]|=byname[name]
  if name not in tables and name not in byname:missing.setdefault(sig,[]).append(name)
 if re.search(r'\bexecute\b',f['body'],re.I):dynamic.append(sig)
 for schema,name in re.findall(r'\b(auth|extensions|vault)\.([a-z_][a-z_0-9]*)',f['body']):
  if name in byname:edges[key]|=byname[name]
  else:edges[key].add('external:'+schema+'.'+name)
for t in m['relations']:edges['table:'+t['name']]=set()
for t in m['triggers']:
 edges.setdefault('table:'+t['table'],set()).add('function:'+t['function'])
for c in m['constraints']:
 if c['reference']:edges.setdefault('table:'+c['table'],set()).add(('external:' if '.' in c['reference'] else 'table:')+c['reference'])
# Explicit reviewed dynamic inventory: dog_structured_traces_v2a enumerates public
# catalog tables and JSON columns. Whole-public capture is included, not samples.
for sig in dynamic:
 if functions[sig]['name']=='dog_structured_traces_v2a':edges['function:'+sig]|={'table:'+t for t in tables}
roots=[s for s,f in functions.items() if re.match(r'(create_|update_|complete_|cancel_|assign_|reassign_|move_|reverse_|finalize_|check_in_|recover_|confirm_|start_|record_|add_|return_|get_hotel_historical|get_historical_dog|preview_dog)',f['name']) and f['return']!='trigger']
report=[]
for root in roots:
 start='function:'+root;seen=set();todo=list(edges[start])
 while todo:
  node=todo.pop()
  if node in seen:continue
  seen.add(node);todo.extend(edges.get(node,set())-seen)
 report.append({'rootRpc':root,'directDependencies':sorted(edges[start]),'transitiveDependencies':sorted(seen),'missingInternal':[n for n in seen if not n.startswith('external:') and n not in edges],'externalDependencies':sorted(n for n in seen if n.startswith('external:'))})
(out/'dependency-graph.json').write_text(json.dumps({'roots':report,'missingExplicitPublicReferences':missing,'dynamicSqlReviewRequired':dynamic,'capturedPgDepend':m['dependencies']},indent=2))
print(json.dumps({'rootCount':len(roots),'missingExplicitReferences':missing,'missingInternal':sorted({n for r in report for n in r['missingInternal']}),'external':sorted({n for r in report for n in r['externalDependencies']}),'dynamicSql':dynamic},indent=2))
