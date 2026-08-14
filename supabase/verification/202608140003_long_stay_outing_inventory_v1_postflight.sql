-- CLEAN QA ONLY. Read-only postflight.
\set ON_ERROR_STOP on
begin read only;
select hotel_qa.assert_isolated_environment();

do $$
declare column_count integer; execute_grantees text[];
begin
  select count(*) into column_count from information_schema.columns
  where table_schema='public' and table_name='long_stay_absence_events'
    and column_name in ('inventory_mode','previous_room_id','released_allocation_id',
      'released_capacity_id','return_capacity_id','guarantee_from','returned_room_id',
      'returned_allocation_id','inventory_transition_status');
  if column_count<>9 then raise exception 'STOP_LONG_STAY_OUTING_INVENTORY_COLUMNS'; end if;
  if to_regprocedure('public.start_long_stay_absence_v3(uuid,integer,timestamp with time zone,date,time without time zone,boolean,text,text,text,uuid)') is null
    or to_regprocedure('public.complete_long_stay_absence_v2(uuid,integer,timestamp with time zone,uuid,text,text,uuid)') is null
    or to_regprocedure('public.get_long_stay_return_room_availability(uuid,timestamp with time zone)') is null
    or to_regprocedure('public.set_long_stay_absence_expected_return_v2(uuid,integer,date,time without time zone,boolean,text,uuid)') is null then
    raise exception 'STOP_LONG_STAY_OUTING_INVENTORY_FUNCTIONS';
  end if;
  if to_regprocedure('public.guard_long_stay_outing_released_checkout()') is null
    or not exists (
      select 1
      from pg_trigger trigger_row
      join pg_class relation on relation.oid=trigger_row.tgrelid
      join pg_namespace namespace on namespace.oid=relation.relnamespace
      where namespace.nspname='public' and relation.relname='hotel_stays'
        and trigger_row.tgname='long_stay_outing_released_checkout_guard'
        and not trigger_row.tgisinternal
    ) then
    raise exception 'STOP_LONG_STAY_OUTING_RELEASED_CHECKOUT_GUARD';
  end if;
  select array_agg(grantee order by grantee) into execute_grantees
  from information_schema.routine_privileges
  where specific_schema='public' and routine_name='start_long_stay_absence_v3'
    and privilege_type='EXECUTE';
  if execute_grantees is distinct from array['authenticated','postgres','service_role']::text[] then
    raise exception 'STOP_LONG_STAY_OUTING_INVENTORY_RPC_ACL';
  end if;
  if exists(select 1 from public.long_stay_absence_events event
    where event.inventory_mode='release_room' and event.is_open and event.archived_at is null
      and (event.return_capacity_id is null or event.guarantee_from is null
        or event.inventory_transition_status<>'room_released')) then
    raise exception 'STOP_LONG_STAY_OUTING_INVENTORY_RUNTIME_STATE';
  end if;
  if exists (
    select 1 from public.long_stay_contracts contract
    where contract.memo='LONG_STAY_OUTING_INVENTORY_RUNTIME_QA_202608140003'
  ) or exists (
    select 1 from public.hotel_room_types room_type
    where room_type.code like 'QA_OUTING_INV_%' or room_type.code like 'QA_OUTING_OTHER_%'
  ) or exists (
    select 1 from public.operation_schedules schedule
    where schedule.description in (
      'OUTING GAP HOTEL QA','OUTING GAP DAYCARE QA','EARLY CONFLICT 1',
      'EARLY CONFLICT 2','RETURN BOUNDARY BLOCKER','RETURN BOUNDARY HOTEL',
      'RETURN BOUNDARY DAYCARE'
    )
  ) then
    raise exception 'STOP_LONG_STAY_OUTING_INVENTORY_QA_RESIDUE';
  end if;
end;
$$;

select 'LONG_STAY_OUTING_INVENTORY_V1_READY' status;
rollback;
