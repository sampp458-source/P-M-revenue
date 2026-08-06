-- Feature rollback only. Existing data and existing Hotel RPCs remain unchanged.

begin;

drop function if exists public.change_room_type_after_check_in(
  uuid, integer, uuid, timestamptz, text, uuid
);
drop function if exists public.change_room_type_before_check_in(
  uuid, integer, uuid, text, uuid
);
drop function if exists public.unassign_hotel_room_before_check_in(
  uuid, integer, text, uuid
);

do $$
begin
  if to_regprocedure(
      'public.unassign_hotel_room_before_check_in(uuid,integer,text,uuid)'
    ) is not null
    or to_regprocedure(
      'public.change_room_type_before_check_in(uuid,integer,uuid,text,uuid)'
    ) is not null
    or to_regprocedure(
      'public.change_room_type_after_check_in(uuid,integer,uuid,timestamp with time zone,text,uuid)'
    ) is not null then
    raise exception 'HOTEL_ROOM_BOARD_CROSS_TYPE_ROLLBACK_FAILED';
  end if;
  if to_regprocedure('public.assign_hotel_room(uuid,integer,uuid,text,uuid)') is null
    or to_regprocedure('public.reassign_hotel_room_before_check_in(uuid,integer,uuid,text,uuid)') is null
    or to_regprocedure('public.move_hotel_room_same_type(uuid,integer,uuid,timestamp with time zone,text,uuid)') is null then
    raise exception 'EXISTING_HOTEL_ROOM_RPC_CONTRACT_MISSING';
  end if;
end;
$$;

commit;
