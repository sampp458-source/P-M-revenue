-- Run only against the local synthetic fixture. Every record rolls back.
begin;
do $$ begin
 if current_database()<>'daycare_department_final_qa' or inet_server_addr() is not null then
   raise exception 'LOCAL_ONLY';
 end if;
end $$;
insert into auth.users(id,email) values
 ('00000000-0000-4000-8000-000000000907','staff-qa@example.invalid'),
 ('00000000-0000-4000-8000-000000000908','inactive-qa@example.invalid');
insert into profiles(id,name,role,is_active,account_status) values
 ('00000000-0000-4000-8000-000000000907','Synthetic Relief Staff','staff',true,'active'),
 ('00000000-0000-4000-8000-000000000908','Synthetic Inactive Staff','staff',true,'active')
 on conflict(id) do update set account_status='active';
update operation_memberships set role='staff',is_active=(profile_id::text like '%907') where profile_id::text in
 ('00000000-0000-4000-8000-000000000907','00000000-0000-4000-8000-000000000908');
set local role authenticated;
do $$
declare
 owner_id text:='00000000-0000-4000-8000-000000000900';
 staff_id text:='00000000-0000-4000-8000-000000000907';
 inactive_id text:='00000000-0000-4000-8000-000000000908';
 calendar uuid:='00000000-0000-4000-8000-000000000020';
 kind uuid:='5cadf20b-021a-4948-a5dd-471677f51d21';
 guardian uuid:='00000000-0000-4000-8000-000000000800';
 dog_a uuid:='00000000-0000-4000-8000-000000000001';
 dog_b uuid:='00000000-0000-4000-8000-000000000002';
 deluxe uuid:='00000000-0000-4000-8000-000000000040';
 room uuid:='00000000-0000-4000-8000-000000000051';
 day date:=(statement_timestamp() at time zone 'Asia/Seoul')::date;
 actual_in timestamptz:=date_trunc('day',statement_timestamp(),'Asia/Seoul');
 actual_out timestamptz:=statement_timestamp();
 r jsonb; sid uuid; v integer; pair boolean;
begin
 foreach pair in array array[true,false] loop
   room := case when pair then '00000000-0000-4000-8000-000000000051'::uuid else '00000000-0000-4000-8000-000000000052'::uuid end;
   perform set_config('request.jwt.claim.sub',owner_id,true);
   if pair then
     r:=create_shared_daycare_reservation_v1(calendar,kind,guardian,array[dog_a,dog_b],day,'00:00','23:59',deluxe,null,array[owner_id::uuid],null,gen_random_uuid());
   else
     r:=create_daycare_reservation(calendar,kind,guardian,dog_a,day,'00:00','23:59',deluxe,null,array[owner_id::uuid],null,gen_random_uuid());
   end if;
   sid:=(r->>'operationScheduleId')::uuid; v:=(r->>'version')::integer;
   perform set_config('request.jwt.claim.sub',inactive_id,true);
   if is_active_operation_member() or can_manage_operation_schedule(sid) then raise exception 'Inactive member has daycare access'; end if;
   begin
     perform assign_daycare_room(sid,v,room,'Inactive user must be denied',gen_random_uuid());
     raise exception 'Unexpected inactive room assignment';
   exception when insufficient_privilege then null;
   end;
   perform set_config('request.jwt.claim.sub',staff_id,true);
   if not is_active_operation_member() or not can_manage_operation_schedule(sid) then raise exception 'Cross-staff daycare permission missing'; end if;
   begin
     perform set_operation_schedule_status(sid,(r->>'scheduleVersion')::integer,'cancelled','Generic mutation is prohibited',gen_random_uuid());
     raise exception 'Unexpected generic cancellation';
   exception when raise_exception then
     if sqlerrm not like '%Daycare 전용 화면%' then raise; end if;
   end;
   begin
     perform update_operation_schedule(sid,(r->>'scheduleVersion')::integer,calendar,kind,r->>'title',
       (r->>'startsAt')::timestamptz,(r->>'endsAt')::timestamptz,false,false,r->>'memo',
       array[staff_id::uuid],array[guardian],(case when pair then array[dog_a,dog_b] else array[dog_a] end),gen_random_uuid());
     raise exception 'Unexpected generic reassignment';
   exception when raise_exception then
     if sqlerrm not like '%Daycare 전용 화면%' then raise; end if;
   end;
   r:=assign_daycare_room(sid,v,room,'Synthetic shift handoff',gen_random_uuid());
   if r->>'lifecycleStatus'<>'scheduled' or r->'roomAllocation'->>'roomId'<>room::text
      or jsonb_array_length(r->'dogs')<>(case when pair then 2 else 1 end) then
     raise exception 'Assignment incorrectly changed lifecycle or group';
   end if;
   r:=unassign_daycare_room(sid,(r->>'version')::integer,'Synthetic unassign',gen_random_uuid());
   if r->'roomAllocation' is distinct from 'null'::jsonb then raise exception 'Cross-staff unassignment failed'; end if;
   r:=update_daycare_reservation(sid,(r->>'version')::integer,calendar,kind,guardian,dog_a,day,'00:00','23:59',deluxe,room,array[owner_id::uuid],'shift edit',gen_random_uuid());
   if r->>'memo'<>'shift edit' or r->'roomAllocation'->>'roomId'<>room::text then raise exception 'Cross-staff edit failed'; end if;
   if pair then
     r:=complete_daycare_check_in(sid,(r->>'version')::integer,actual_in,gen_random_uuid());
     if r->>'lifecycleStatus'<>'checked_in' then raise exception 'Cross-staff check-in failed'; end if;
     r:=complete_daycare_check_out(sid,(r->>'version')::integer,actual_out,gen_random_uuid());
     if r->>'lifecycleStatus'<>'completed' or r->>'scheduleStatus'<>'completed' or jsonb_array_length(r->'dogs')<>2
       or can_manage_operation_schedule(sid) then raise exception 'Cross-staff completion did not preserve group or close permission'; end if;
   else
     r:=cancel_daycare_reservation(sid,(r->>'version')::integer,'Synthetic handoff cancellation',gen_random_uuid());
     if r->>'lifecycleStatus'<>'cancelled' or r->>'scheduleStatus'<>'cancelled'
       or can_manage_operation_schedule(sid) then raise exception 'Cross-staff cancellation failed'; end if;
   end if;
 end loop;
 perform set_config('request.jwt.claim.sub',owner_id,true);
 r:=create_daycare_reservation(calendar,kind,guardian,dog_a,day-1,'01:00','02:00',deluxe,room,array[owner_id::uuid],null,gen_random_uuid());
 sid:=(r->>'operationScheduleId')::uuid;
 perform set_config('request.jwt.claim.sub',staff_id,true);
 if can_manage_operation_schedule(sid) then raise exception 'Unexpected past-date cross-staff permission'; end if;
 begin
   perform complete_daycare_check_in(sid,(r->>'version')::integer,(day-1+time '01:10') at time zone 'Asia/Seoul',gen_random_uuid());
   raise exception 'Unexpected past-date check-in';
 exception when insufficient_privilege then
   if sqlerrm not like '%관리자 권한%' then raise; end if;
 end;
 raise notice 'PASS: cross-staff two-dog daycare assign/unassign/edit/check-in/checkout, single daycare edit/cancel, inactive account rejection, ordinary mutation guard, admin-only history';
end $$;
rollback;
