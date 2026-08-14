\set ON_ERROR_STOP on
begin;
select hotel_qa.assert_isolated_environment();

do $$
begin
  if exists(select 1 from public.daycare_operation_states) then
    raise exception 'STOP_DAYCARE_V1_ROLLBACK_DATA_PRESENT';
  end if;
end;
$$;

drop trigger if exists operation_schedules_daycare_guard on public.operation_schedules;
drop trigger if exists daycare_operation_states_audit on public.daycare_operation_states;
drop trigger if exists daycare_operation_states_no_delete on public.daycare_operation_states;
drop trigger if exists daycare_operation_states_protect on public.daycare_operation_states;

drop function if exists public.get_daycare_operations_for_date(date);
drop function if exists public.complete_daycare_check_out(uuid,integer,timestamp with time zone,uuid);
drop function if exists public.complete_daycare_check_in(uuid,integer,timestamp with time zone,uuid);
drop function if exists public.unassign_daycare_room(uuid,integer,text,uuid);
drop function if exists public.assign_daycare_room(uuid,integer,uuid,text,uuid);
drop function if exists public.cancel_daycare_reservation(uuid,integer,text,uuid);
drop function if exists public.update_daycare_reservation(uuid,integer,uuid,uuid,uuid,uuid,date,time without time zone,time without time zone,uuid,uuid,uuid[],text,uuid);
drop function if exists public.create_daycare_reservation(uuid,uuid,uuid,uuid,date,time without time zone,time without time zone,uuid,uuid,uuid[],text,uuid);
drop function if exists public.daycare_append_request_internal(uuid,uuid,text,jsonb,uuid,text);
drop function if exists public.daycare_request_replayed_internal(uuid,uuid,text,jsonb);
drop function if exists public.assert_daycare_reservation_input_internal(uuid,uuid,uuid,uuid,date,time without time zone,time without time zone,uuid,uuid,uuid[]);
drop function if exists public.daycare_reservation_json(uuid);
drop function if exists public.guard_daycare_schedule_generic_mutation_internal();
drop function if exists public.record_daycare_operation_audit_internal();
drop function if exists public.prevent_daycare_operation_state_delete_internal();
drop function if exists public.protect_daycare_operation_state_internal();
drop function if exists public.daycare_child_request_id_internal(uuid,text);
drop function if exists public.daycare_payload_hash_internal(jsonb);
drop table public.daycare_operation_states;

select 'DAYCARE_V1_ROLLBACK_READY';
commit;
