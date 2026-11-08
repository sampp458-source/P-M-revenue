# Real SQL + unchanged guards, synthetic identities, Unix socket only.
cap=json.loads(a.production_contract.read_text())
sql('alter table hotel_stays add column if not exists administrative_occupancy_until timestamptz;')
for f in cap['functions']:
 if f['name'] in ['daycare_preentry_reassignment_proven_v2','daycare_closed_long_stay_bound_v1','record_verified_daycare_visit_v1']:sql(f['definition'])
dependency=(ROOT/'supabase/migrations/202610100001_hotel_daycare_department.sql').read_text()
for startmark,endmark in [('create or replace function public.assert_daycare_reservation_input_internal(','$$;'),('CREATE OR REPLACE FUNCTION public.register_hotel_daycare_capacity(','$function$')]:
 start=dependency.index(startmark);body=dependency.index('as $$',start)+5 if endmark=='$$;' else dependency.index('AS $function$',start)+len('AS $function$');end=dependency.index(endmark,body)+len(endmark);sql(dependency[start:end]+';')
sql(auth+f"insert into operation_schedule_types(id,name,color,created_by) values('5cadf20b-021a-4948-a5dd-471677f51d21','Synthetic Hotel Daycare','#123456','{actor}'); insert into operation_calendar_schedule_types(calendar_id,schedule_type_id,created_by) values('00000000-0000-4000-8000-000000000020','5cadf20b-021a-4948-a5dd-471677f51d21','{actor}');")
sql("create table qa_retro_function_baseline as select oid,prosrc,proacl from pg_proc where pronamespace='public'::regnamespace;")
sql((ROOT/'supabase/migrations/202611080001_daycare_retrospective_completion_v1.sql').read_text())
check('new command preserves every existing function body and ACL',sql("select not exists(select 1 from qa_retro_function_baseline b join pg_proc p on p.oid=b.oid where p.prosrc is distinct from b.prosrc or p.proacl is distinct from b.proacl);")=='t')
check('new RPC secure definer and search path',sql("select prosecdef and proconfig=array['search_path=public, pg_temp'] and pg_get_userbyid(proowner)='postgres' from pg_proc where oid='complete_retrospective_daycare_visit_v1(uuid,integer,uuid,timestamptz,timestamptz,text,text,uuid,boolean)'::regprocedure;")=='t')
check('authenticated execute only (not anon/service/public)',sql("select has_function_privilege('authenticated','complete_retrospective_daycare_visit_v1(uuid,integer,uuid,timestamptz,timestamptz,text,text,uuid,boolean)','execute') and not has_function_privilege('anon','complete_retrospective_daycare_visit_v1(uuid,integer,uuid,timestamptz,timestamptz,text,text,uuid,boolean)','execute') and not has_function_privilege('service_role','complete_retrospective_daycare_visit_v1(uuid,integer,uuid,timestamptz,timestamptz,text,text,uuid,boolean)','execute');")=='t')
standard='00000000-0000-4000-8000-000000000041';day='2026-11-07';rooms=[str(uuid.uuid4()) for _ in range(12)]
for i,room in enumerate(rooms):sql(auth+f"insert into hotel_rooms(id,room_type_id,name,sort_order,created_by,updated_by) values('{room}','{standard}','Retroactive synthetic STANDARD {i}',{500+i},'{actor}','{actor}');")
def retroplan(dog=1,room=None,service=day):
 return obj(auth+f"select create_daycare_reservation('00000000-0000-4000-8000-000000000020','5cadf20b-021a-4948-a5dd-471677f51d21','00000000-0000-4000-8000-000000000800','00000000-0000-4000-8000-{dog:012d}','{service}','10:00','18:00','{standard}',{repr(room) if room else 'null'},array['{actor}'::uuid],null,gen_random_uuid());")
def retrocall(v,room,entry=day+' 10:20+09',exit=day+' 18:10+09',rid=None,version=None,confirmed='true'):
 return f"select complete_retrospective_daycare_visit_v1('{v['operationScheduleId']}',{v['version'] if version is None else version},{repr(room) if room else 'null'},{repr(entry) if entry else 'null'},{repr(exit) if exit else 'null'},'Forgot to record actual use','Synthetic staff confirmation','{rid or uuid.uuid4()}',{confirmed});"
v=retroplan();rid=str(uuid.uuid4());before=sql('select count(*) from hotel_physical_occupancies;');oldstays=sql("select md5(coalesce(jsonb_agg(to_jsonb(s) order by id)::text,'[]')) from hotel_stays s;")
rejected('unauthenticated historical write denied',retrocall(v,rooms[0]),'권한')
sql(f"update profiles set role='staff' where id='{actor}';")
rejected('staff direct RPC denied',auth+retrocall(v,rooms[0]),'관리자')
sql(f"update profiles set role='admin' where id='{actor}';")
for name,kw in [('missing actual entry',{'entry':None}),('missing actual exit',{'exit':None}),('missing room',{'room':None}),('unconfirmed visit',{'confirmed':'false'}),('reversed times',{'entry':day+' 19:00+09'}),('wrong service date',{'entry':'2026-11-06 10:00+09'}),('stale version',{'version':99})]:
 args={'room':rooms[0],**kw};snap=digest();rejected(name,auth+retrocall(v,**args),'먼저' if name=='stale version' else ('서비스' if name=='wrong service date' else '필요'));check(name+' no partial writes',digest()==snap)
result=obj(auth+retrocall(v,rooms[0],rid=rid))
check('unassigned past visit completes with confirmed room',result['lifecycleStatus']=='completed' and result['roomAllocation']['roomId']==rooms[0])
check('actual time exact and schedule completed/version synchronized',sql(f"select d.checked_in_at=timestamptz '{day} 10:20+09' and d.checked_out_at=timestamptz '{day} 18:10+09' and s.status='completed' and d.schedule_version=s.version from daycare_operation_states d join operation_schedules s on s.id=d.operation_schedule_id where s.id='{v['operationScheduleId']}';")=='t')
check('allocation and capacity actual range match',result['capacityReservation']['reservedFrom']==result['roomAllocation']['allocatedFrom'] and result['capacityReservation']['reservedUntil']==result['roomAllocation']['allocatedUntil'])
check('no current physical occupancy generated',sql('select count(*) from hotel_physical_occupancies;')==before)
check('existing hotel stay digest unchanged',sql("select md5(coalesce(jsonb_agg(to_jsonb(s) order by id)::text,'[]')) from hotel_stays s;")==oldstays)
check('same request id replays exact completed result',obj(auth+retrocall(v,rooms[0],rid=rid))==result)
rejected('new request cannot complete twice',auth+retrocall(result,rooms[0]),'미처리')
check('root evidence reason actor request retained',sql(f"select exists(select 1 from entity_audit_events where entity_id='{v['operationScheduleId']}' and request_id='{rid}' and changed_by='{actor}' and change_reason like '%Synthetic staff confirmation%');")=='t')
# Real historical room collision; the first planned update must roll back completely.
block=retroplan(2,rooms[1]);bad=retroplan(3);snap=digest();rejected('STANDARD overlap blocked',auth+retrocall(bad,rooms[1]),'호실');check('collision leaves no partial allocation schedule capacity audit',digest()==snap)
# A late failure occurs AFTER official update has created an allocation.
late=retroplan(4);sql("create function qa_retro_late_fail() returns trigger language plpgsql as $$ begin if new.lifecycle_status='completed' then raise exception 'QA_RETRO_LATE_ABORT'; end if; return new; end $$; create trigger zzzz_retro_fail before update on daycare_operation_states for each row execute function qa_retro_late_fail();")
snap=digest();rejected('completion failure after assignment aborts everything',auth+retrocall(late,rooms[2]),'QA_RETRO_LATE_ABORT');check('late failure entire data and audit rollback',digest()==snap);sql('drop trigger zzzz_retro_fail on daycare_operation_states; drop function qa_retro_late_fail();')
race=retroplan(5)
def concurrent_retro(_):
 try:return obj(auth+retrocall(race,rooms[3]))
 except RuntimeError as e:return str(e)
with concurrent.futures.ThreadPoolExecutor(2) as pool:out=list(pool.map(concurrent_retro,[1,2]))
check('concurrent distinct requests commit once',sum(isinstance(o,dict) for o in out)==1)
future=retroplan(6,service='2098-11-07');snap=digest();rejected('future service cannot be retrospectively completed',auth+retrocall(future,rooms[4],entry='2098-11-07 10:20+09',exit='2098-11-07 18:10+09'),'미래' if False else '필요');check('future rejection no writes',digest()==snap)

# Real authenticated role cannot use old verified-visit RPC to bypass new admin UI.
legacy=retroplan(7,rooms[5]);snap=digest()
sql(f"update profiles set role='staff' where id='{actor}';")
rejected('legacy direct past visit also requires admin',auth+f"set role authenticated; select record_verified_daycare_visit_v1('{legacy['operationScheduleId']}',{legacy['version']},'{day} 10:30+09','{day} 17:00+09',gen_random_uuid(),true);",'관리자')
sql(f"update profiles set role='admin' where id='{actor}';")
check('legacy direct staff attempt rolled back all business data',digest()==snap)
rolecase=retroplan(8)
roleout=obj(auth+"set role authenticated;"+retrocall(rolecase,rooms[6]))
check('authenticated administrator executes canonical single transaction',roleout['lifecycleStatus']=='completed')
check('original audits retained',old_audit_digest==sql(f"select md5(string_agg(to_jsonb(e)::text,'|' order by id)) from entity_audit_events e where id in({old_audit_ids});"))
# Different service date: current rooms can remain in use while an unrelated past visit completes.
phys=sql("select md5(coalesce(jsonb_agg(to_jsonb(o) order by id)::text,'[]')) from hotel_physical_occupancies o;")
more=retroplan(9);obj(auth+retrocall(more,rooms[7]))
check('all existing physical occupancies byte-identical after retrospective completion',phys==sql("select md5(coalesce(jsonb_agg(to_jsonb(o) order by id)::text,'[]')) from hotel_physical_occupancies o;"))
