-- CLEAN QA ONLY. Read-only postflight.
\set ON_ERROR_STOP on
begin read only;
select hotel_qa.assert_isolated_environment();

do $$
declare execute_grantees text[];
begin
  if to_regprocedure('public.release_long_stay_room_during_absence(uuid,integer,text,uuid)') is null then
    raise exception 'STOP_LONG_STAY_KEEP_TO_RELEASE_RPC_MISSING';
  end if;
  select array_agg(grantee order by grantee) into execute_grantees
  from information_schema.routine_privileges
  where specific_schema='public'
    and routine_name='release_long_stay_room_during_absence'
    and privilege_type='EXECUTE';
  if execute_grantees is distinct from array['authenticated','postgres','service_role']::text[] then
    raise exception 'STOP_LONG_STAY_KEEP_TO_RELEASE_RPC_ACL';
  end if;
  if not exists (
    select 1 from pg_proc procedure_row
    where procedure_row.oid='public.release_long_stay_room_during_absence(uuid,integer,text,uuid)'::regprocedure
      and procedure_row.prosecdef and procedure_row.provolatile='v'
      and procedure_row.proconfig @> array['search_path=public, pg_temp']::text[]
  ) then
    raise exception 'STOP_LONG_STAY_KEEP_TO_RELEASE_RPC_METADATA';
  end if;
  if exists (
    select 1 from public.long_stay_absence_events event
    where event.inventory_mode='release_room' and event.is_open and event.archived_at is null
      and (event.return_capacity_id is null or event.guarantee_from is null
        or event.inventory_transition_status<>'room_released')
  ) then
    raise exception 'STOP_LONG_STAY_KEEP_TO_RELEASE_RUNTIME_STATE';
  end if;
  if exists (
    select 1 from public.long_stay_contracts contract
    where contract.memo='LONG_STAY_KEEP_TO_RELEASE_RUNTIME_QA_202608140004'
  ) or exists (
    select 1 from public.hotel_room_types room_type
    where room_type.code like 'QA_KEEP_RELEASE_%'
  ) then
    raise exception 'STOP_LONG_STAY_KEEP_TO_RELEASE_QA_RESIDUE';
  end if;
end;
$$;

select 'LONG_STAY_KEEP_TO_RELEASE_READY' status;
rollback;
