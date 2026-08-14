\set ON_ERROR_STOP on
begin read only;

select hotel_qa.assert_isolated_environment();

do $$
begin
  if to_regclass('public.daycare_operation_states') is not null
    or to_regprocedure('public.create_daycare_reservation(uuid,uuid,uuid,uuid,date,time without time zone,time without time zone,uuid,uuid,uuid[],text,uuid)') is not null then
    raise exception 'STOP_DAYCARE_V1_ALREADY_PRESENT';
  end if;

  if to_regclass('public.operation_schedules') is null
    or to_regclass('public.hotel_capacity_reservations') is null
    or to_regclass('public.hotel_room_allocations') is null
    or to_regprocedure('public.create_operation_schedule(uuid,uuid,text,timestamp with time zone,timestamp with time zone,boolean,boolean,text,uuid[],uuid[],uuid[],uuid)') is null
    or to_regprocedure('public.update_operation_schedule(uuid,integer,uuid,uuid,text,timestamp with time zone,timestamp with time zone,boolean,boolean,text,uuid[],uuid[],uuid[],uuid)') is null
    or to_regprocedure('public.register_hotel_daycare_capacity(uuid,uuid,uuid)') is null
    or to_regprocedure('public.assign_hotel_daycare_room(uuid,uuid,text,uuid)') is null then
    raise exception 'STOP_DAYCARE_V1_DEPENDENCY_MISSING';
  end if;

  if exists (
    select 1
    from public.hotel_capacity_reservations capacity
    where capacity.source_kind='daycare'
      and capacity.archived_at is null
      and not exists (
        select 1 from public.operation_schedules schedule
        where schedule.id=capacity.daycare_schedule_id and schedule.archived_at is null
      )
  ) then
    raise exception 'STOP_DAYCARE_ORPHAN_CAPACITY';
  end if;
end;
$$;

select 'READY_TO_APPLY_DAYCARE_V1';
rollback;
