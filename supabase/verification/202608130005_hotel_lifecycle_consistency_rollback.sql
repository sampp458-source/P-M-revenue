begin;

do $$
begin
  if exists(select 1 from public.hotel_planned_checkout_requests) then
    raise exception 'STOP_HOTEL_LIFECYCLE_ROLLBACK_REQUEST_HISTORY_EXISTS';
  end if;
end;
$$;

drop trigger if exists hotel_stays_calendar_lifecycle_sync on public.hotel_stays;
drop function if exists public.sync_hotel_lifecycle_schedule_status_internal();
drop function if exists public.update_checked_in_hotel_planned_checkout(
  uuid,integer,date,time without time zone,boolean,uuid
);
drop table if exists public.hotel_planned_checkout_requests;

commit;

select 'HOTEL_LIFECYCLE_CONSISTENCY_ROLLBACK_READY' as status;
