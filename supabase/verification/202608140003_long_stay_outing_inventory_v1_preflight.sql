-- CLEAN QA ONLY. Read-only preflight.
\set ON_ERROR_STOP on
begin read only;
select hotel_qa.assert_isolated_environment();

do $$
begin
  if to_regprocedure('public.start_long_stay_absence_v2(uuid,integer,timestamp with time zone,date,time without time zone,boolean,text,text,uuid)') is null
    or to_regprocedure('public.complete_long_stay_absence(uuid,integer,timestamp with time zone,text,text,uuid)') is null
    or to_regprocedure('public.get_long_stay_month_v2(date)') is null then
    raise exception 'STOP_LONG_STAY_OUTING_INVENTORY_BASELINE_MISSING';
  end if;
  if to_regprocedure('public.start_long_stay_absence_v3(uuid,integer,timestamp with time zone,date,time without time zone,boolean,text,text,text,uuid)') is not null
    or to_regprocedure('public.guard_long_stay_outing_released_checkout()') is not null
    or exists(select 1 from information_schema.columns where table_schema='public'
      and table_name='long_stay_absence_events' and column_name='inventory_mode') then
    raise exception 'STOP_LONG_STAY_OUTING_INVENTORY_ALREADY_PRESENT';
  end if;
  if exists(select 1 from public.hotel_capacity_reservations capacity
    where capacity.source_kind='stay' and capacity.archived_at is null
    group by capacity.hotel_stay_id having count(*)<>1) then
    raise exception 'STOP_LONG_STAY_CAPACITY_BASELINE_INVALID';
  end if;
end;
$$;

select 'READY_TO_APPLY_LONG_STAY_OUTING_INVENTORY_V1' status;
rollback;
