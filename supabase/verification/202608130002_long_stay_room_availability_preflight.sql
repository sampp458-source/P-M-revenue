begin read only;
do $$
begin
  if to_regprocedure('public.get_long_stay_room_availability(uuid,date,time without time zone,boolean)') is not null then
    raise exception 'STOP_LONG_STAY_ROOM_AVAILABILITY_ALREADY_PRESENT';
  end if;
  if to_regprocedure('public.confirm_long_stay_month(uuid,integer,date,uuid,uuid,time without time zone,boolean,uuid,uuid,uuid[],text,uuid)') is null
    or to_regclass('public.hotel_physical_occupancies') is null
    or position('allocation.archived_at is null' in pg_get_functiondef('public.assert_hotel_room_allocation_available(uuid,uuid,timestamp with time zone,timestamp with time zone,uuid)'::regprocedure))=0
    or position('allocation.allocated_from < p_allocated_until' in pg_get_functiondef('public.assert_hotel_room_allocation_available(uuid,uuid,timestamp with time zone,timestamp with time zone,uuid)'::regprocedure))=0
    or position('allocation.allocated_until > p_allocated_from' in pg_get_functiondef('public.assert_hotel_room_allocation_available(uuid,uuid,timestamp with time zone,timestamp with time zone,uuid)'::regprocedure))=0
    or position('errcode = ''23P01''' in pg_get_functiondef('public.assert_hotel_room_allocation_available(uuid,uuid,timestamp with time zone,timestamp with time zone,uuid)'::regprocedure))=0 then
    raise exception 'STOP_LONG_STAY_ROOM_AVAILABILITY_CANONICAL_DIFF';
  end if;
end;
$$;
select 'READY_TO_APPLY_LONG_STAY_ROOM_AVAILABILITY' status;
rollback;
