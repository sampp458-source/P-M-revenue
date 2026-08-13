begin read only;

select case when
  to_regprocedure('public.get_long_stay_room_availability_v2(uuid,date,date,time without time zone,boolean)') is null
  and to_regprocedure('public.confirm_long_stay_month_v2(uuid,integer,date,date,uuid,uuid,time without time zone,boolean,uuid,uuid,uuid[],text,uuid)') is null
  and to_regprocedure('public.long_stay_first_assignment_effective_date_internal(date,date)') is not null
  and to_regprocedure('public.get_long_stay_room_availability(uuid,date,time without time zone,boolean)') is not null
  and to_regprocedure('public.confirm_long_stay_month(uuid,integer,date,uuid,uuid,time without time zone,boolean,uuid,uuid,uuid[],text,uuid)') is not null
then 'READY_TO_APPLY_LONG_STAY_EXPLICIT_PHYSICAL_START'
else 'STOP_LONG_STAY_EXPLICIT_PHYSICAL_START_PREFLIGHT' end status;

rollback;
