-- Long Stay Platform rollback. New objects only.
begin;
do $$ begin
  if exists(select 1 from public.long_stay_contracts) then
    raise exception 'STOP_LONG_STAY_ROLLBACK_DATA_EXISTS';
  end if;
end $$;
drop trigger if exists long_stay_allocation_runtime_invariant on public.hotel_room_allocations;
drop trigger if exists long_stay_capacity_runtime_invariant on public.hotel_capacity_reservations;
drop trigger if exists long_stay_hotel_stay_runtime_invariant on public.hotel_stays;
drop trigger if exists long_stay_contract_runtime_invariant on public.long_stay_contracts;
drop function if exists public.get_long_stay_month(date);
drop function if exists public.get_customer_long_stays(uuid);
drop function if exists public.get_long_stay_contract(uuid);
drop function if exists public.reverse_long_stay_completion(uuid,integer,integer,text,uuid);
drop function if exists public.complete_long_stay_check_out(uuid,integer,integer,timestamptz,text,uuid);
drop function if exists public.set_long_stay_planned_checkout(uuid,integer,date,uuid,uuid,time,boolean,uuid[],text,uuid);
drop function if exists public.complete_long_stay_absence(uuid,integer,timestamptz,text,text,uuid);
drop function if exists public.start_long_stay_absence(uuid,integer,timestamptz,timestamptz,text,text,uuid);
drop function if exists public.complete_long_stay_check_in(uuid,integer,integer,timestamptz,text,uuid);
drop function if exists public.confirm_long_stay_month(uuid,integer,date,uuid,uuid,time,boolean,uuid,uuid,uuid[],text,uuid);
drop function if exists public.create_long_stay_contract(uuid,uuid,date,date,uuid,uuid,numeric,integer,text,uuid);
drop function if exists public.long_stay_deferred_invariant_trigger();
drop function if exists public.assert_long_stay_runtime_invariant_internal(uuid);
drop function if exists public.long_stay_record_operation_internal(uuid,uuid,uuid,text,uuid,jsonb,jsonb,uuid[],text,uuid);
drop function if exists public.long_stay_replay_internal(uuid,text,jsonb);
drop function if exists public.long_stay_contract_projection_internal(uuid);
drop function if exists public.long_stay_payload_hash_internal(jsonb);
drop function if exists public.long_stay_internal_request_id(uuid,text,uuid,text);
drop table public.long_stay_operation_audit_events;
drop table public.long_stay_absence_events;
drop table public.long_stay_monthly_occupancies;
drop table public.long_stay_contracts;
commit;
