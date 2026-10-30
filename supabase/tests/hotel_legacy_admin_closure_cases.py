# This code runs inside the local-only initialized harness, after existing hotel regression.
import json
baseline=a.function_baseline
base=json.loads(baseline.read_text())
# Captured exact Production definitions, no credentials or real customer attributes.
for f in base['functions']:sql(f['body']+';')
sql(json.loads(a.history_baseline.read_text())['body']+';')
sql((ROOT/'supabase/migrations/202610300001_hotel_legacy_administrative_closure_v1.sql').read_text())
check('new schema has no inferred actual checkout',sql("select count(*)=0 from hotel_stays where administrative_closed_on is not null;")=='t')
ids=['612d58e4-51e7-46f5-8d6a-618cfc804c22','8da96be1-c798-48fb-8e25-0d9c9edc2865']
dogs=['77080f76-0a98-498b-bffd-10733fcbf0d7','d41688aa-1b26-437c-a95e-c737ec302a5c']
entries=['2026-08-16 16:12+09','2026-09-21 19:51+09']; ends=['2026-08-18 00:00+09','2026-09-23 22:00+09'];exit_days=['2026-08-18','2026-09-23'];bounds=['2026-08-19 00:00+09','2026-09-24 00:00+09']
room='56bed086-9fb0-46ec-83a0-95dfad265f65'
sql(auth+f"insert into hotel_rooms(id,room_type_id,name,created_by,updated_by) values('{room}','00000000-0000-4000-8000-000000000041','Synthetic STANDARD 5','{actor}','{actor}');")
sql(auth+f"insert into hotel_rooms(id,room_type_id,name,created_by,updated_by) values(gen_random_uuid(),'00000000-0000-4000-8000-000000000041','Synthetic spare STANDARD','{actor}','{actor}');")
caps=[];allocs=[]
for i,id in enumerate(ids):
 c=str(uuid.uuid4());aa=str(uuid.uuid4());caps.append(c);allocs.append(aa)
 sql(auth+f"insert into dogs(id,name,customer_id) values('{dogs[i]}','Synthetic legacy {i}','00000000-0000-4000-8000-000000000800');insert into hotel_stays(id,dog_id,checked_in_at,checked_in_by,created_by,updated_by,request_id) values('{id}','{dogs[i]}','{entries[i]}','{actor}','{actor}','{actor}',gen_random_uuid());insert into hotel_capacity_reservations(id,hotel_stay_id,source_kind,room_type_id,reserved_from,reserved_until,quantity,created_by,updated_by) values('{c}','{id}','stay','00000000-0000-4000-8000-000000000041','{entries[i]}','{ends[i]}',1,'{actor}','{actor}');insert into hotel_room_allocations(id,capacity_reservation_id,room_id,allocated_from,allocated_until,assignment_reason,created_by,updated_by) values('{aa}','{c}','{room}','{entries[i]}','{ends[i]}','Synthetic initial room','{actor}','{actor}');")
 # Match actual target versions with genuine version/audit triggers.
 for _ in range(2-i):sql(auth+f"update hotel_stays set updated_by='{actor}' where id='{id}';")
versions=[3,2]
runtime_auth="set role authenticated;"+auth
def close(i,rid=None,ver=None):
 return f"select administratively_close_legacy_hotel_stay_v1('{ids[i]}',{versions[i] if ver is None else ver},'과거 퇴실 처리 누락','대표자 확인: 날짜 확정 / 정확한 시각 미확정','{rid or uuid.uuid4()}',true);"
check('date-only read is bounded to exact two records',len(obj(auth+'select get_legacy_hotel_administrative_closure_targets_v1();'))==2)
rejected('unauthenticated closure rejected',close(0),'관리자')
for role in ['anon','service_role']:
 check(role+' cannot execute closure',sql(f"select not has_function_privilege('{role}','public.administratively_close_legacy_hotel_stay_v1(uuid,integer,text,text,uuid,boolean)','execute');")=='t')
rejected('stale version rejected',runtime_auth+close(0,ver=99),'VERSION_CONFLICT')
# A real overlapping planned allocation, not a mock or disabled guard.
block=str(uuid.uuid4());blocka=str(uuid.uuid4());blockstay=str(uuid.uuid4())
blocker_sql=f"insert into hotel_stays(id,dog_id,created_by,updated_by,request_id) values('{blockstay}','00000000-0000-4000-8000-000000000001','{actor}','{actor}',gen_random_uuid());insert into hotel_capacity_reservations(id,hotel_stay_id,source_kind,room_type_id,reserved_from,reserved_until,quantity,created_by,updated_by) values('{block}','{blockstay}','stay','00000000-0000-4000-8000-000000000041','2026-08-18 12:00+09','2026-08-18 13:00+09',1,'{actor}','{actor}');insert into hotel_room_allocations(id,capacity_reservation_id,room_id,allocated_from,allocated_until,assignment_reason,created_by,updated_by) values('{blocka}','{block}','{room}','2026-08-18 12:00+09','2026-08-18 13:00+09','Synthetic actual conflict','{actor}','{actor}');"
unchanged=digest();rejected('conservative unknown-time boundary protects other allocation',auth+'begin;'+blocker_sql+close(0),'충돌');check('guard failure rolls back all metadata and audits',digest()==unchanged)
rejected('archived overlap is not silently ignored',auth+'begin;'+blocker_sql+f"update hotel_room_allocations set archived_at=now(),archived_by='{actor}',archive_reason='Synthetic cancelled blocker',updated_by='{actor}' where id='{blocka}';"+close(0),'충돌')
check('failed archived-history case leaves all data unchanged',digest()==unchanged)
sql(f"update profiles set role='staff' where id='{actor}';")
rejected('active non-admin Operations user cannot close hotel stays',runtime_auth+close(0),'관리자')
sql(f"update profiles set role='admin' where id='{actor}';")
rejected('direct administrative metadata update has no command context',auth+f"update hotel_stays set administrative_closed_on=date '2026-08-18',administrative_closed_by='{actor}',administrative_occupancy_until=timestamptz '2026-08-19 00:00+09',administrative_closed_at=clock_timestamp(),administrative_closure_reason='fake direct update',administrative_closure_evidence='unapproved direct update',administrative_closure_request_id=gen_random_uuid(),administrative_closure_payload_hash='fake' where id='{ids[0]}';",'관리자')
sql("create function public.qa_admin_late_failure() returns trigger language plpgsql as $$ begin raise exception 'QA_LATE_FAILURE'; end $$;create trigger zz_qa_admin_late_failure after update on hotel_stays for each row when(new.administrative_closed_on is not null) execute function public.qa_admin_late_failure();")
before=digest();rejected('failure after capacity allocation and stay writes rolls back transaction',runtime_auth+close(0),'QA_LATE_FAILURE');check('late failure preserves all rows and audit',before==digest() and sql(f"select administrative_closed_on is null and version=3 from hotel_stays where id='{ids[0]}';")=='t')
sql('drop trigger zz_qa_admin_late_failure on hotel_stays;drop function public.qa_admin_late_failure();')
audit_before=int(sql('select count(*) from entity_audit_events;'))
replay=[]
for i in range(2):
 rid=str(uuid.uuid4()); replay.append(rid)
 if i==1:
  with concurrent.futures.ThreadPoolExecutor(2) as pool: values=list(pool.map(lambda _:obj(runtime_auth+close(i,rid)),[1,2]))
  check('concurrent same request commits exactly once',values[0]==values[1]);r=values[0]
 else:r=obj(runtime_auth+close(i,rid))
 versions[i]+=1
 check('target '+str(i)+' administratively closed without fake actual time',r['checkedOutAt'] is None and r['checkedInAt'] is not None and r['administrativeClosure']['confirmedCheckoutDate']==['2026-08-18','2026-09-23'][i] and r['administrativeClosure']['actualCheckoutTimeKnown'] is False)
 check('target '+str(i)+' boundary in capacity/allocation',sql(f"select c.reserved_until=timestamptz '{bounds[i]}' and a.allocated_until=c.reserved_until from hotel_capacity_reservations c join hotel_room_allocations a on a.capacity_reservation_id=c.id where c.id='{caps[i]}';")=='t')
 before=digest();again=obj(runtime_auth+close(i,rid,versions[i]-1));check('same request exactly replays without audit duplication',digest()==before and again==r)
 rejected('different request cannot reclose target',runtime_auth+close(i),'상태')
 rejected('old checkout cannot fabricate actual timestamp after closure',auth+f"select complete_hotel_check_out('{ids[i]}',{versions[i]},'{exit_days[i]} 12:00+09',gen_random_uuid());",'행정 종료')
 rejected('closed allocation cannot be reassigned or reopened',auth+f"update hotel_room_allocations set allocated_until=allocated_until+interval '1 hour',updated_by='{actor}' where id='{allocs[i]}';",'행정 종료')
 check('root audit stores actual actor and request',sql(f"select count(*)=1 from entity_audit_events where entity_type='hotel_stays' and entity_id='{ids[i]}' and request_id='{rid}' and changed_by='{actor}';")=='t')
 check('retained audited history remains continuous',sql(f"select hotel_history_chain_010('hotel_stays',to_jsonb(s),(select jsonb_agg(to_jsonb(e)) from entity_audit_events e where entity_id=s.id)) from hotel_stays s where id='{ids[i]}';")=='t')
check('exactly six audits append for two independent closures',int(sql('select count(*) from entity_audit_events;'))-audit_before==6)
check('neither target remains an infinite current hold',sql("select count(*)=0 from hotel_current_physical_rooms_internal() where stay_id in ('612d58e4-51e7-46f5-8d6a-618cfc804c22','8da96be1-c798-48fb-8e25-0d9c9edc2865');")=='t')

for i in range(2):
 result=obj(auth+f"select hotel_history_individual_010(jsonb_build_object('stay',(select to_jsonb(s) from hotel_stays s where id='{ids[i]}'),'audits',(select jsonb_agg(to_jsonb(e)) from entity_audit_events e where entity_id in('{ids[i]}','{caps[i]}','{allocs[i]}')),'kind','single','asOf',statement_timestamp(),'windowUntil',statement_timestamp(),'allocations',(select jsonb_agg(to_jsonb(a)) from hotel_room_allocations a where id='{allocs[i]}'),'capacities',(select jsonb_agg(to_jsonb(c)) from hotel_capacity_reservations c where id='{caps[i]}'),'rooms',jsonb_build_array(jsonb_build_object('roomId','{room}','roomTypeId','00000000-0000-4000-8000-000000000041'))));")
 check('date-only history retains proven finite administrative segment '+str(i),result['reasonCode'] is None and result['segments'][-1]['endEvent']=='administratively_closed')

catalog=obj("select jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'hash',md5(prosrc),'owner',pg_get_userbyid(proowner),'securityDefiner',prosecdef,'config',proconfig,'acl',proacl) order by proname) from pg_proc p where pronamespace='public'::regnamespace and proname in('administratively_close_legacy_hotel_stay_v1','get_legacy_hotel_administrative_closure_targets_v1','guard_hotel_administrative_closure_v1','hotel_administrative_extension_proven_v1','get_hotel_historical_room_board','hotel_legacy_current_physical_rooms_internal','hotel_current_physical_rooms_internal','hotel_stay_json','record_verified_daycare_visit_v1','complete_verified_daycare_check_out_v1','hotel_history_individual_010','hotel_history_semantic_010','get_hotel_operations_snapshot');")
(a.output/'function-integrity.json').write_text(json.dumps(catalog,indent=2))
check('authenticated session executes under existing admin ACL without owner identity spoof',len(catalog)==13)
