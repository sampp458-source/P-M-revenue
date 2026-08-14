\set ON_ERROR_STOP on
begin read only;

select hotel_qa.assert_isolated_environment();

do $$
declare
  expected_public text[]:=array[
    'assign_daycare_room(uuid,integer,uuid,text,uuid)',
    'cancel_daycare_reservation(uuid,integer,text,uuid)',
    'complete_daycare_check_in(uuid,integer,timestamp with time zone,uuid)',
    'complete_daycare_check_out(uuid,integer,timestamp with time zone,uuid)',
    'create_daycare_reservation(uuid,uuid,uuid,uuid,date,time without time zone,time without time zone,uuid,uuid,uuid[],text,uuid)',
    'get_daycare_operations_for_date(date)',
    'unassign_daycare_room(uuid,integer,text,uuid)',
    'update_daycare_reservation(uuid,integer,uuid,uuid,uuid,uuid,date,time without time zone,time without time zone,uuid,uuid,uuid[],text,uuid)'
  ];
  actual_public text[];
begin
  if to_regclass('public.daycare_operation_states') is null then
    raise exception 'STOP_DAYCARE_V1_TABLE_MISSING';
  end if;

  select array_agg(p.proname||'('||replace(oidvectortypes(p.proargtypes),', ',',')||')' order by 1)
  into actual_public
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in (
    'create_daycare_reservation','update_daycare_reservation','cancel_daycare_reservation',
    'assign_daycare_room','unassign_daycare_room','complete_daycare_check_in',
    'complete_daycare_check_out','get_daycare_operations_for_date'
  );
  if actual_public is distinct from expected_public then
    raise exception 'STOP_DAYCARE_V1_PUBLIC_RPC_SET';
  end if;

  if (select count(*) from pg_trigger where tgrelid='public.daycare_operation_states'::regclass and not tgisinternal)<>3
    or not exists(select 1 from pg_trigger where tgrelid='public.operation_schedules'::regclass and tgname='operation_schedules_daycare_guard' and not tgisinternal) then
    raise exception 'STOP_DAYCARE_V1_TRIGGER_SET';
  end if;

  if not (select relrowsecurity from pg_class where oid='public.daycare_operation_states'::regclass)
    or has_table_privilege('anon','public.daycare_operation_states','select')
    or has_table_privilege('authenticated','public.daycare_operation_states','insert,update,delete') then
    raise exception 'STOP_DAYCARE_V1_RLS_ACL';
  end if;

  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname=any(array[
      'create_daycare_reservation','update_daycare_reservation','cancel_daycare_reservation',
      'assign_daycare_room','unassign_daycare_room','complete_daycare_check_in','complete_daycare_check_out'
    ]) and (
      has_function_privilege('anon',p.oid,'execute')
      or not has_function_privilege('authenticated',p.oid,'execute')
      or not p.prosecdef or p.provolatile<>'v'
    )
  ) then
    raise exception 'STOP_DAYCARE_V1_RPC_CONTRACT';
  end if;

  if not exists(select 1 from pg_constraint where conrelid='public.daycare_operation_states'::regclass and conname='daycare_operation_states_lifecycle_check')
    or not exists(select 1 from pg_indexes where schemaname='public' and tablename='hotel_capacity_reservations' and indexdef like '%daycare_schedule_id%') then
    raise exception 'STOP_DAYCARE_V1_CONSTRAINT_SET';
  end if;
end;
$$;

select 'DAYCARE_V1_READY';
rollback;
