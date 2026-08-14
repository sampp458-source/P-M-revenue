begin;

drop function if exists public.start_long_stay_absence_v2(uuid,integer,timestamptz,date,time,boolean,text,text,uuid);
drop function if exists public.get_long_stay_month_v2(date);
drop function if exists public.long_stay_current_absence_projection_internal(uuid);
alter table public.long_stay_absence_events drop constraint if exists long_stay_absence_expected_return_semantics_chk;
alter table public.long_stay_absence_events
  drop column if exists expected_return_time_unspecified,
  drop column if exists expected_return_date;

commit;
