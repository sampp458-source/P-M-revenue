begin;

do $$
begin
  if to_regprocedure('public.get_long_stay_room_availability_v2(uuid,date,date,time without time zone,boolean)') is null
    or to_regprocedure('public.confirm_long_stay_month_v2(uuid,integer,date,date,uuid,uuid,time without time zone,boolean,uuid,uuid,uuid[],text,uuid)') is null then
    raise exception 'STOP_LONG_STAY_EXPLICIT_PHYSICAL_START_ROLLBACK_TARGET_MISSING';
  end if;
end;
$$;

drop function public.confirm_long_stay_month_v2(uuid,integer,date,date,uuid,uuid,time,boolean,uuid,uuid,uuid[],text,uuid);
drop function public.get_long_stay_room_availability_v2(uuid,date,date,time,boolean);

commit;
