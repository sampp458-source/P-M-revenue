-- Feature rollback only. Converted aggregate data is deliberately preserved.
begin;

drop function if exists public.convert_legacy_hotel_schedules_to_reservation(
  uuid, uuid, uuid, uuid, uuid, uuid[], text, uuid
);

do $$
begin
  if to_regprocedure(
    'public.convert_legacy_hotel_schedules_to_reservation(uuid,uuid,uuid,uuid,uuid,uuid[],text,uuid)'
  ) is not null then
    raise exception 'ROLLBACK_FAILED_CONVERSION_RPC_STILL_EXISTS';
  end if;
end;
$$;

commit;
