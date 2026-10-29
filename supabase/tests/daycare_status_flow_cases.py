# Synthetic data only; real official commands and real triggers, never Production.
check('status flow uses Unix-socket isolated DB',sql("select inet_server_addr() is null and current_database()='daycare_department_final_qa';")=='t')
dependency=(ROOT/'supabase/migrations/202610100001_hotel_daycare_department.sql').read_text()
dep_start=dependency.index('create or replace function public.assert_daycare_reservation_input_internal(')
dep_body=dependency.index('as $$',dep_start)+5
dep_end=dependency.index('$$;',dep_body)+3
sql(dependency[dep_start:dep_end])
check('new scenarios use exact Production hotel input validator hash',sql("select md5(prosrc) from pg_proc where oid='assert_daycare_reservation_input_internal(uuid,uuid,uuid,uuid,date,time,time,uuid,uuid,uuid[])'::regprocedure;")=='30bb837cd6fcbcd048c37fec1899ff17')
register_start=dependency.index('CREATE OR REPLACE FUNCTION public.register_hotel_daycare_capacity(')
register_body=dependency.index('AS $function$',register_start)+len('AS $function$')
register_end=dependency.index('$function$',register_body)+len('$function$')
sql(dependency[register_start:register_end]+';')
check('new scenarios use exact installed Hotel Capacity registration body',sql("select md5(prosrc) from pg_proc where oid='register_hotel_daycare_capacity(uuid,uuid,uuid)'::regprocedure;")=='d83eb430768f73e412ec8727efe388f3')
check('Rocky uses unchanged Production official update RPC body',sql("select md5(prosrc) from pg_proc where oid='update_daycare_reservation(uuid,integer,uuid,uuid,uuid,uuid,date,time,time,uuid,uuid,uuid[],text,uuid)'::regprocedure;")=='d4b3be35343749acde33dc881ca6c2bc')
sql(auth+f"""insert into operation_schedule_types(id,name,color,created_by) values('5cadf20b-021a-4948-a5dd-471677f51d21','Synthetic Hotel Daycare','#123456','{actor}');
insert into operation_calendar_schedule_types(calendar_id,schedule_type_id,created_by) values('00000000-0000-4000-8000-000000000020','5cadf20b-021a-4948-a5dd-471677f51d21','{actor}');""")

room=str(uuid.uuid4());rid=str(uuid.uuid4());day='2026-10-27'
sql(auth+f"insert into hotel_rooms(id,room_type_id,name,sort_order,created_by,updated_by) values('{room}','00000000-0000-4000-8000-000000000041','Synthetic status-flow STANDARD',700,'{actor}','{actor}');")
v=obj(auth+f"select create_daycare_reservation('00000000-0000-4000-8000-000000000020','5cadf20b-021a-4948-a5dd-471677f51d21','00000000-0000-4000-8000-000000000800','00000000-0000-4000-8000-000000000007','{day}','10:30','19:00','00000000-0000-4000-8000-000000000041',null,array['{actor}'::uuid],null,gen_random_uuid());")
flow=[v]
check('new official reservation is scheduled without invented actuals',v['lifecycleStatus']=='scheduled' and v['checkedInAt'] is None and v['checkedOutAt'] is None)
v=obj(auth+f"select assign_daycare_room('{v['operationScheduleId']}',{v['version']},'{room}','확인한 호실 배정',gen_random_uuid());")
flow.append(v)
check('official room assignment retains pending status',v['roomAllocation']['roomId']==room and v['lifecycleStatus']=='scheduled')
v=obj(auth+f"select complete_daycare_check_in('{v['operationScheduleId']}',{v['version']},'{day} 10:30+09','{rid}');")
flow.append(v)
check('explicit actual entry becomes checked_in, not schedule completed',v['lifecycleStatus']=='checked_in' and v['scheduleStatus']=='scheduled' and v['checkedOutAt'] is None)
check('checked-in room has real physical hold',sql(f"select exists(select 1 from hotel_current_physical_rooms_internal() where capacity_id='{v['capacityReservation']['id']}');")=='t')
check('fresh canonical reread preserves actual entry',obj(auth+f"select daycare_reservation_json('{v['operationScheduleId']}');")==v)
v=obj(auth+f"select complete_daycare_check_out('{v['operationScheduleId']}',{v['version']},'{day} 18:10+09',gen_random_uuid());")
flow.append(v)
check('normal checkout completes Daycare and schedule in one contract',v['lifecycleStatus']=='completed' and v['scheduleStatus']=='completed')
check('normal checkout preserves actual times and schedule version sync',sql(f"select d.checked_in_at=timestamptz '{day} 10:30+09' and d.checked_out_at=timestamptz '{day} 18:10+09' and d.schedule_version=s.version from daycare_operation_states d join operation_schedules s on s.id=d.operation_schedule_id where s.id='{v['operationScheduleId']}';")=='t')
check('checkout removes current physical hold without deleting allocation history',sql(f"select not exists(select 1 from hotel_current_physical_rooms_internal() where capacity_id='{v['capacityReservation']['id']}') and exists(select 1 from hotel_room_allocations where id='{v['roomAllocation']['id']}');")=='t')
reader=str(uuid.uuid4())
sql(f"insert into auth.users(id,email) values('{reader}','status-reader@example.invalid'); insert into profiles(id,name,role,is_active,account_status) values('{reader}','Synthetic second Operations reader','staff',true,'active'); update operation_memberships set role='staff',is_active=true where profile_id='{reader}';")
read=obj(f"select set_config('request.jwt.claim.sub','{reader}',false); select daycare_reservation_json('{v['operationScheduleId']}');")
check('independent Operations reader sees same canonical completed state',read==v)
check('date range reread keeps completed instead of inferring from plan',obj(auth+f"select daycare_reservation_json('{v['operationScheduleId']}');")==v)
fixture={'source':'real isolated DB official create -> assign -> check-in -> checkout, real triggers, exact installed Hotel input contract','states':[{'lifecycleStatus':x['lifecycleStatus'],'checkedInAt':x['checkedInAt'],'checkedOutAt':x['checkedOutAt'],'scheduleStatus':x['scheduleStatus'],'version':x['version'],'scheduleVersion':x['scheduleVersion']} for x in flow],'secondReader':{'lifecycleStatus':read['lifecycleStatus'],'checkedInAt':read['checkedInAt'],'checkedOutAt':read['checkedOutAt']}}
(a.output/'status-flow.json').write_text(json.dumps(fixture,indent=2))
