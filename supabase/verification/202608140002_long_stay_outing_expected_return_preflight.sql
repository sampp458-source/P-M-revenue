\set ON_ERROR_STOP on
begin read only;

do $$
begin
  if to_regclass('public.long_stay_absence_events') is null
    or to_regprocedure('public.start_long_stay_absence(uuid,integer,timestamp with time zone,timestamp with time zone,text,text,uuid)') is null
    or to_regprocedure('public.complete_long_stay_absence(uuid,integer,timestamp with time zone,text,text,uuid)') is null
    or to_regprocedure('public.get_long_stay_month(date)') is null
    or to_regprocedure('public.long_stay_contract_projection_internal(uuid)') is null then
    raise exception 'STOP_LONG_STAY_OUTING_EXPECTED_RETURN_DEPENDENCY';
  end if;
  if to_regprocedure('public.start_long_stay_absence_v2(uuid,integer,timestamp with time zone,date,time without time zone,boolean,text,text,uuid)') is not null
    or to_regprocedure('public.get_long_stay_month_v2(date)') is not null
    or exists(
      select 1 from information_schema.columns
      where table_schema='public' and table_name='long_stay_absence_events'
        and column_name in ('expected_return_date','expected_return_time_unspecified')
    ) then
    raise exception 'STOP_LONG_STAY_OUTING_EXPECTED_RETURN_ALREADY_PRESENT';
  end if;
end;
$$;

select 'READY_TO_APPLY_LONG_STAY_OUTING_REPAIR' status;
rollback;
