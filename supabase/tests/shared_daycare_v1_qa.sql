-- Execute only in the socket-only daycare_department_final_qa synthetic fixture.
begin;
do $$ begin
 if current_database()<>'daycare_department_final_qa' or inet_server_addr() is not null then
   raise exception 'LOCAL_ONLY';
 end if;
end $$;
insert into customers(id,name) values ('00000000-0000-4000-8000-000000000801','Other synthetic guardian');
update dogs set customer_id='00000000-0000-4000-8000-000000000801'
 where id='00000000-0000-4000-8000-000000000009';
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000900',true);

do $$
declare
 actor uuid:=auth.uid();
 calendar uuid:='00000000-0000-4000-8000-000000000020';
 kind uuid:='5cadf20b-021a-4948-a5dd-471677f51d21';
 guardian uuid:='00000000-0000-4000-8000-000000000800';
 dog_a uuid:='00000000-0000-4000-8000-000000000001';
 dog_b uuid:='00000000-0000-4000-8000-000000000002';
 other_dog uuid:='00000000-0000-4000-8000-000000000009';
 deluxe uuid:='00000000-0000-4000-8000-000000000040';
 standard uuid:='00000000-0000-4000-8000-000000000041';
 room uuid:='00000000-0000-4000-8000-000000000051';
 room2 uuid:='00000000-0000-4000-8000-000000000052';
 day date:=(statement_timestamp() at time zone 'Asia/Seoul')::date-1;
 req uuid:=gen_random_uuid();
 reservation jsonb; replay jsonb; sid uuid; cap uuid; v integer;
begin
 if not has_function_privilege('authenticated','public.create_shared_daycare_reservation_v1(uuid,uuid,uuid,uuid[],date,time,time,uuid,uuid,uuid[],text,uuid)','execute')
   or has_function_privilege('anon','public.create_shared_daycare_reservation_v1(uuid,uuid,uuid,uuid[],date,time,time,uuid,uuid,uuid[],text,uuid)','execute') then
   raise exception 'ACL parity failed';
 end if;
 begin
   perform create_shared_daycare_reservation_v1(calendar,kind,guardian,array[dog_a,dog_b],day,'09:00','17:00',standard,null,array[actor],null,gen_random_uuid());
   raise exception 'STANDARD accepted';
 exception when invalid_parameter_value then
   if sqlerrm not like '%디럭스%' then raise; end if;
 end;
 begin
   perform create_shared_daycare_reservation_v1(calendar,kind,guardian,array[dog_a,other_dog],day,'09:00','17:00',deluxe,null,array[actor],null,gen_random_uuid());
   raise exception 'Cross-household accepted';
 exception when invalid_parameter_value then
   if sqlerrm not like '%소유 반려견%' then raise; end if;
 end;
 begin
   perform create_shared_daycare_reservation_v1(calendar,kind,guardian,array[dog_a,dog_a],day,'09:00','17:00',deluxe,null,array[actor],null,gen_random_uuid());
   raise exception 'Duplicate dogs accepted';
 exception when invalid_parameter_value then
   if sqlerrm not like '%두 마리%' then raise; end if;
 end;
 reservation:=create_shared_daycare_reservation_v1(calendar,kind,guardian,array[dog_b,dog_a],day,'09:00','17:00',deluxe,room,array[actor],null,req);
 sid:=(reservation->>'operationScheduleId')::uuid;
 cap:=(reservation->'capacityReservation'->>'id')::uuid;
 v:=(reservation->>'version')::integer;
 if jsonb_array_length(reservation->'dogs')<>2 or reservation->'dog'->>'id'<>dog_a::text
   or (select count(*) from operation_schedule_dogs where schedule_id=sid and archived_at is null)<>2
   or (select count(*) from hotel_capacity_reservations where daycare_schedule_id=sid and quantity=1 and archived_at is null)<>1
   or (select count(*) from hotel_room_allocations where capacity_reservation_id=cap and room_id=room and archived_at is null)<>1
   or reservation->>'title' not like '%Synthetic Dog 1 + Synthetic Dog 2%' then
   raise exception 'Expected two dogs, one calendar item and one room allocation: %', reservation;
 end if;
 replay:=create_shared_daycare_reservation_v1(calendar,kind,guardian,array[dog_a,dog_b],day,'09:00','17:00',deluxe,room,array[actor],null,req);
 if replay is distinct from reservation then raise exception 'Not idempotent when dog order is reversed'; end if;
 begin
   perform create_daycare_reservation(calendar,kind,guardian,dog_a,day,'10:00','13:00',deluxe,room,array[actor],null,gen_random_uuid());
   raise exception 'Overlapping room accepted';
 exception when exclusion_violation then null;
 end;
 if (select count(*) from daycare_operation_states)<>1 then raise exception 'Overlap left a partial booking'; end if;
 begin
   perform update_daycare_reservation(sid,v,calendar,kind,guardian,dog_a,day,'09:00','17:00',standard,null,array[actor],null,gen_random_uuid());
   raise exception 'Shared booking downgraded to STANDARD';
 exception when invalid_parameter_value then null;
 end;
 reservation:=update_daycare_reservation(sid,v,calendar,kind,guardian,dog_a,day,'09:30','17:30',deluxe,room2,array[actor],'edited',gen_random_uuid());
 if jsonb_array_length(reservation->'dogs')<>2 or reservation->'roomAllocation'->>'roomId'<>room2::text then
   raise exception 'Ordinary edit did not preserve group and change room';
 end if;
 reservation:=complete_daycare_check_in(sid,(reservation->>'version')::integer,(day+time '09:30') at time zone 'Asia/Seoul',gen_random_uuid());
 if reservation->>'lifecycleStatus'<>'checked_in' or jsonb_array_length(reservation->'dogs')<>2 then raise exception 'Group check-in failed'; end if;
 if get_overdue_daycare_operations_v1() #>> '{0,dog,name}' <> 'Synthetic Dog 1 + Synthetic Dog 2' then raise exception 'Overdue names missing'; end if;
 reservation:=complete_daycare_check_out(sid,(reservation->>'version')::integer,(day+time '17:30') at time zone 'Asia/Seoul',gen_random_uuid());
 if reservation->>'lifecycleStatus'<>'completed' or jsonb_array_length(reservation->'dogs')<>2 then raise exception 'Group checkout failed'; end if;
 reservation:=create_shared_daycare_reservation_v1(calendar,kind,guardian,array[dog_a,dog_b],day+2,'09:00','17:00',deluxe,null,array[actor],null,gen_random_uuid());
 sid:=(reservation->>'operationScheduleId')::uuid;
 if reservation->'roomAllocation' is distinct from 'null'::jsonb or jsonb_array_length(get_daycare_operations_for_date(day+2)) is distinct from 1 then
   raise exception 'Unassigned future shared hold missing';
 end if;
 reservation:=assign_daycare_room(sid,(reservation->>'version')::integer,room,'Synthetic allocation',gen_random_uuid());
 if reservation->'roomAllocation'->>'roomId' is distinct from room::text then raise exception 'Shared assignment failed'; end if;
 reservation:=cancel_daycare_reservation(sid,(reservation->>'version')::integer,'Synthetic cancellation',gen_random_uuid());
 if reservation->>'lifecycleStatus' is distinct from 'cancelled' or (select count(*) from hotel_capacity_reservations where daycare_schedule_id=sid and archived_at is null)<>0 then
   raise exception 'Shared cancellation did not release room';
 end if;
 reservation:=create_daycare_reservation(calendar,kind,guardian,dog_a,day+2,'09:00','17:00',deluxe,null,array[actor],null,gen_random_uuid());
 if jsonb_array_length(reservation->'dogs')<>1 then raise exception 'Single-dog contract failed'; end if;
 raise notice 'PASS: permissions, Deluxe only, same owner, unique pair, one schedule/capacity/room, replay, overlap rollback, edit, arrival, overdue names, checkout, future unassigned hold, assignment, cancellation, legacy single dog';
end $$;
rollback;
