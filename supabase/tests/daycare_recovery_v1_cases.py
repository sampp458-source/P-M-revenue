# Runs in the existing socket-only captured-schema harness, after all 80 legacy checks.
preserved_ids=sql("select string_agg(quote_literal(operation_schedule_id),',') from daycare_operation_states;")
preserved_rows=obj(f'select jsonb_agg(to_jsonb(d) order by operation_schedule_id) from daycare_operation_states d where operation_schedule_id in({preserved_ids});')
old_audit_ids=sql("select string_agg(quote_literal(id),',') from entity_audit_events;")
old_audit_digest=sql(f"select md5(string_agg(to_jsonb(e)::text,'|' order by id)) from entity_audit_events e where id in({old_audit_ids});")
if sql("select to_regprocedure('public.record_verified_daycare_visit_v1(uuid,integer,timestamptz,timestamptz,uuid,boolean)') is null;")=='t':
 sql((ROOT/'supabase/migrations/202610240001_daycare_administrative_reconciliation_v1.sql').read_text())
for i in range(21,28):
    sql(auth+f"insert into hotel_rooms(id,room_type_id,name,sort_order,created_by,updated_by) values('00000000-0000-4000-8000-{50+i:012d}','00000000-0000-4000-8000-000000000040','Recovery room {i}',{i},'{actor}','{actor}');")
recoveryday=sql("select '2026-10-04'::text;")
# Planned replacement precedes the stale hold; no current occupancy guard is bypassed.
replacement=create(9,today,room=21,checkin=False)
check('empty independent recovery room accepts a planned reservation', replacement['lifecycleStatus']=='scheduled')
bobby=create(1,recoveryday,room=21)
# Synthetic original entry20:22, analogous contradiction; do not invent a checkout.
sql(auth+f"update daycare_operation_states set checked_in_at='{recoveryday} 20:22+09',updated_by='{actor}' where operation_schedule_id='{bobby['operationScheduleId']}';")
bobby=obj(auth+f"select daycare_reservation_json('{bobby['operationScheduleId']}');")
def admin(v, rid=None, dog='00000000-0000-4000-8000-000000000001', confirmed='true'):
    return f"select administratively_release_daycare_occupancy_v1('{v['operationScheduleId']}','{dog}',{v['version']},'Synthetic contradictory timestamps','Staff attests departed; actual time unknown','Synthetic approval reference',{confirmed},'{rid or uuid.uuid4()}');"
oldin=bobby['checkedInAt'];oldAudit=int(sql('select count(*) from entity_audit_events;'))
rejected('admin requires explicit vacant confirmation',auth+admin(bobby,confirmed='false'),'근거')
rejected('admin exact dog guard',auth+admin(bobby,dog='00000000-0000-4000-8000-000000000002'),'반려견')
rejected('admin denied without auth',admin(bobby),'권한')
sql(f"update profiles set role='staff' where id='{actor}';")
rejected('admin denied to Operations non-admin',auth+admin(bobby),'관리자')
sql(f"update profiles set role='admin' where id='{actor}';")
collision_stay,collision_capacity,collision_allocation=uid(),uid(),uid()
current_acquisition=auth+f"""begin;
insert into hotel_stays(id,dog_id,checked_in_at,checked_in_by,request_id,created_by,updated_by) values('{collision_stay}','00000000-0000-4000-8000-000000000009','2026-10-24 09:00+09','{actor}',gen_random_uuid(),'{actor}','{actor}');
insert into hotel_capacity_reservations(id,source_kind,hotel_stay_id,room_type_id,reserved_from,reserved_until,quantity,created_by,updated_by) values('{collision_capacity}','stay','{collision_stay}','00000000-0000-4000-8000-000000000040','2026-10-24 09:00+09','2098-12-31 18:00+09',1,'{actor}','{actor}');
insert into hotel_room_allocations(id,capacity_reservation_id,room_id,allocated_from,allocated_until,created_by,updated_by) values('{collision_allocation}','{collision_capacity}','00000000-0000-4000-8000-000000000071','2026-10-24 09:00+09','2098-12-31 18:00+09','{actor}','{actor}');commit;"""
collision_before=digest()
rejected('current allocation acquisition rejects another actual occupant',current_acquisition,'실제 퇴실이 완료되지')
check('rejected acquisition rolls back new stay capacity allocation and audit',digest()==collision_before)
rejected('Bobby-equivalent stale hold blocks a new actual checkin before release',auth+f"select complete_daycare_check_in('{replacement['operationScheduleId']}',{replacement['version']},'{today} 09:00+09',gen_random_uuid());",'실제 퇴실이 완료되지')
rid=str(uuid.uuid4());released=obj(auth+admin(bobby,rid))
replacement=obj(auth+f"select complete_daycare_check_in('{replacement['operationScheduleId']}',{replacement['version']},'{today} 09:00+09',gen_random_uuid());")
check('same DELUXE room becomes available through normal checkin after admin release',replacement['lifecycleStatus']=='checked_in')
check('admin state is explicitly separate from completed',released['lifecycleStatus']=='administratively_released')
check('admin preserves original entry and unknown exit',released['checkedInAt']==oldin and released['checkedOutAt'] is None)
check('admin release has separate server metadata',released['administrativeRelease']['actualCheckoutKnown'] is False and released['administrativeRelease']['releasedBy']==actor)
check('admin retains schedule workflow without fake completion',released['scheduleStatus']=='scheduled')
check('admin versions increase once',released['version']==bobby['version']+1)
check('admin removes exact physical hold',sql(f"select not exists(select 1 from hotel_current_physical_rooms_internal() where capacity_id='{bobby['capacityReservation']['id']}');")=='t')
check('admin preserves archived allocation identity and range',sql(f"select count(*)=1 and bool_and(archived_at is not null) from hotel_room_allocations where capacity_reservation_id='{bobby['capacityReservation']['id']}';")=='t')
check('admin preserves old audits and appends release audits',int(sql('select count(*) from entity_audit_events;'))>oldAudit)
check('admin replay is write-free',obj(auth+admin(bobby,rid))==released)
rejected('admin terminal row cannot be edited',auth+f"update daycare_operation_states set updated_by='{actor}' where operation_schedule_id='{bobby['operationScheduleId']}';",'변경할 수')
rejected('normal checkout cannot reinterpret admin release',auth+command(released,recoveryday+' 23:00+09'),'실제 입실 중')
# Explicit actual times in one command; actual current occupancy is never created.
v=create(2,recoveryday,room=22,checkin=False)
def retro(v,entry,exit,rid=None,confirmed='true'):
 return f"select record_verified_daycare_visit_v1('{v['operationScheduleId']}',{v['version']},'{entry}','{exit}','{rid or uuid.uuid4()}',{confirmed});"
rejected('retrospective unknown confirmation rejected',auth+retro(v,recoveryday+' 11:00+09',recoveryday+' 19:00+09',confirmed='false'),'확인한 실제')
rejected('retrospective reversed times rejected',auth+retro(v,recoveryday+' 19:00+09',recoveryday+' 11:00+09'),'날짜와 순서')
rejected('retrospective future rejected',auth+retro(v,recoveryday+' 11:00+09','2099-01-01 19:00+09'),'미래')
rejected('retrospective wrong service date rejected',auth+retro(v,following+' 11:00+09',following+' 19:00+09'),'날짜와 순서')
current_holder=create(3,today,room=22)
check('historical visit does not displace later current occupant',sql(f"select exists(select 1 from hotel_current_physical_rooms_internal() where capacity_id='{current_holder['capacityReservation']['id']}');")=='t')
before=digest();rid=str(uuid.uuid4());out=obj(auth+retro(v,recoveryday+' 11:00+09',recoveryday+' 19:00+09',rid))
row=obj(auth+f"select daycare_reservation_json('{v['operationScheduleId']}');")
check('late recording succeeds with explicitly known past times',row['lifecycleStatus']=='completed' and row['checkedInAt'].startswith(recoveryday+'T11:00') and row['checkedOutAt'].startswith(recoveryday+'T19:00'))
check('late recording stores current actor and processing time',sql(f"select updated_by='{actor}' and updated_at>checked_out_at from daycare_operation_states where operation_schedule_id='{v['operationScheduleId']}';")=='t')
check('late recording leaves no current hold',sql(f"select not exists(select 1 from hotel_current_physical_rooms_internal() where capacity_id='{v['capacityReservation']['id']}');")=='t')
check('later current occupant preserved after historical record',sql(f"select exists(select 1 from hotel_current_physical_rooms_internal() where capacity_id='{current_holder['capacityReservation']['id']}');")=='t')
check('late recording versions sync',row['scheduleVersion']==2 and row['version']==v['version']+1)
check('late recording retry preserves outcome',obj(auth+retro(v,recoveryday+' 11:00+09',recoveryday+' 19:00+09',rid))==out)
rejected('duplicate new retrospective request rejected',auth+retro(row,recoveryday+' 11:00+09',recoveryday+' 19:00+09'),'미처리 예약')
# Existing current occupancy must not be erased by administrative reconciliation.
x=create(3,recoveryday,room=23);snap=digest()
rejected('admin wrong version rolls back',auth+admin({**x,'version':0},dog='00000000-0000-4000-8000-000000000003'),'VERSION_CONFLICT')
check('failed admin has identical business digest',digest()==snap)
# Install a real independent competing hold using existing fixture utility; no guards disabled.
# Check both RPCs retain role/security boundary.
for name,sig in [('admin','administratively_release_daycare_occupancy_v1(uuid,uuid,integer,text,text,text,boolean,uuid)'),('retro','record_verified_daycare_visit_v1(uuid,integer,timestamptz,timestamptz,uuid,boolean)')]:
 for role in ['anon','service_role']:
  check(name+' '+role+' denied',sql(f"select not has_function_privilege('{role}','{sig}','execute');")=='t')
 check(name+' fixed search_path SECDEF',sql(f"select prosecdef and proconfig=array['search_path=public, pg_temp'] from pg_proc where oid='{sig}'::regprocedure;")=='t')

# Atomicity: fail after both archival writes; exception must undo all rows and audit.
y=create(4,recoveryday,room=24);before=digest()
sql("create function qa_reject_recovery() returns trigger language plpgsql as $$ begin if new.lifecycle_status='administratively_released' then raise exception 'QA_LATE_ABORT'; end if; return new; end $$; create trigger zzzz_qa_recovery before update on daycare_operation_states for each row execute function qa_reject_recovery();")
rejected('late administrative failure rolls back entire transaction',auth+admin(y,dog='00000000-0000-4000-8000-000000000004'),'QA_LATE_ABORT')
check('archival rows and audits unchanged after late abort',digest()==before)
sql('drop trigger zzzz_qa_recovery on daycare_operation_states; drop function qa_reject_recovery();')
rid=str(uuid.uuid4())
with concurrent.futures.ThreadPoolExecutor(2) as pool:
 values=list(pool.map(lambda _:obj(auth+admin(y,rid,dog='00000000-0000-4000-8000-000000000004')),[1,2]))
check('concurrent identical admin requests produce one release',values[0]==values[1] and values[0]['version']==y['version']+1)
z=create(5,recoveryday,room=25,checkin=False)
def race(_):
 try:return obj(auth+retro(z,recoveryday+' 11:00+09',recoveryday+' 19:00+09'))
 except RuntimeError as e:return str(e)
with concurrent.futures.ThreadPoolExecutor(2) as pool:values=list(pool.map(race,[1,2]))
check('concurrent different retrospective requests commit only once',sum(isinstance(v,dict) for v in values)==1 and any('먼저' in v for v in values if isinstance(v,str)))
# Actor and immutable originals remain in retained audit JSON.
check('administrative audits retain original20:22 entry',sql(f"select exists(select 1 from entity_audit_events where entity_id='{bobby['operationScheduleId']}' and before_data->>'lifecycle_status'='checked_in' and after_data->>'lifecycle_status'='administratively_released' and (before_data->>'checked_in_at')::timestamptz=(after_data->>'checked_in_at')::timestamptz and after_data->>'checked_out_at' is null and changed_by='{actor}' and request_id is not null);")=='t')
# General same-day entry and checkout are unchanged on unreconciled records.
w=create(6,recoveryday,room=26)
obj(auth+command(w,recoveryday+' 17:00+09'))
check('normal verified checkout still works after new metadata',sql(f"select lifecycle_status='completed' and administrative_released_at is null from daycare_operation_states where operation_schedule_id='{w['operationScheduleId']}';")=='t')
rejected('new migration cannot be silently rerun',(ROOT/'supabase/migrations/202610240001_daycare_administrative_reconciliation_v1.sql').read_text(),'STOP_RECOVERY_PREDECESSOR')

# Future actual times are rejected server-side on the existing normal commands too.
futureday=sql("select '2099-01-01'::text;")
future=create(7,futureday,room=27,checkin=False)
rejected('normal checkin refuses future actual time',auth+f"select complete_daycare_check_in('{future['operationScheduleId']}',{future['version']},'{futureday} 11:00+09',gen_random_uuid());",'미래')
rejected('normal checkout refuses future actual time',auth+f"select complete_daycare_check_out('{current_holder['operationScheduleId']}',{current_holder['version']},'{futureday} 19:00+09',gen_random_uuid());",'미래')

metadata=['administrative_approved_at','administrative_approved_by','administrative_released_at','administrative_released_by','administrative_release_reason','administrative_release_evidence','administrative_release_approval','administrative_release_request_id']
oldrows=obj(f'select jsonb_agg(to_jsonb(d) order by operation_schedule_id) from daycare_operation_states d where operation_schedule_id in({preserved_ids});')
check('all preexisting completed/Nai-equivalent and other state values retained', [{k:v for k,v in row.items() if k not in metadata} for row in oldrows]==[{k:v for k,v in row.items() if k not in metadata} for row in preserved_rows])
check('all preexisting audit rows byte retained',old_audit_digest==sql(f"select md5(string_agg(to_jsonb(e)::text,'|' order by id)) from entity_audit_events e where id in({old_audit_ids});"))

rejected('retrospective anonymous role denied',retro(v,recoveryday+' 11:00+09',recoveryday+' 19:00+09'),'권한')
rejected('retrospective unassigned staff denied',other_auth+retro(v,recoveryday+' 11:00+09',recoveryday+' 19:00+09'),'해당 일정')
check('administrative release records approving and processing principal',sql(f"select administrative_approved_by='{actor}' and administrative_released_by='{actor}' and administrative_approved_at<=administrative_released_at and checked_out_at is null from daycare_operation_states where operation_schedule_id='{bobby['operationScheduleId']}';")=='t')
check('admin creates exactly three attributed state/capacity/allocation audits',sql(f"select count(*)=3 and bool_and(changed_by='{actor}') from entity_audit_events where request_id=(select administrative_release_request_id from daycare_operation_states where operation_schedule_id='{bobby['operationScheduleId']}') or change_reason like '%[request:'||(select administrative_release_request_id::text from daycare_operation_states where operation_schedule_id='{bobby['operationScheduleId']}')||']%';")=='t')
# A retained active Shared physical hold stays protective even if its parent status is inconsistent.
# Reuse the existing constrained historical-import fixture; no trigger or constraint is disabled.
physical_target=create(8,recoveryday,room=10)
physical_snapshot=digest()
physical_count=sql('select count(*) from hotel_physical_occupancies;')
rejected('admin protects independent active Shared physical hold',physical_fixture.replace(reopen,'')+admin(physical_target,dog='00000000-0000-4000-8000-000000000008'),'다른 유효 점유')
check('physical-conflict admin rollback preserves all rows',digest()==physical_snapshot and physical_count==sql('select count(*) from hotel_physical_occupancies;'))

terminal_before=digest()
rejected('legacy capacity registration cannot reopen administrative release',auth+f"select register_hotel_daycare_capacity('{bobby['operationScheduleId']}','00000000-0000-4000-8000-000000000040',gen_random_uuid());",'행정 해제 기록')
rejected('administrative capacity cannot be restored',auth+f"update hotel_capacity_reservations set archived_at=null,archived_by=null,archive_reason=null,version=version+1,updated_by='{actor}' where id='{bobby['capacityReservation']['id']}';",'행정 해제 기록')
rejected('administrative allocation cannot be restored',auth+f"update hotel_room_allocations set archived_at=null,archived_by=null,archive_reason=null,version=version+1,updated_by='{actor}' where capacity_reservation_id='{bobby['capacityReservation']['id']}';",'행정 해제 기록')
check('all terminal reopen attempts are rollback-safe',digest()==terminal_before)
