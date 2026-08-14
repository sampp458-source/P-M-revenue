-- Production-only, read-only Daycare V1 postflight.
begin read only;
select set_config('app.release_project_ref','zorvcuskzemehblqdbfj',true);
select set_config('app.release_migration_sha256','a94b254bad910f7e89ba2581189a5b421c96e9ac361a9d22a29f84ee18a521ef',true);

do $production_binding$
begin
  if current_setting('app.release_project_ref',true) is distinct from 'zorvcuskzemehblqdbfj'
    or current_setting('app.release_project_ref',true)='wxbvwixoeczfvbqurdse'
    or current_setting('app.release_migration_sha256',true) is distinct from
      'a94b254bad910f7e89ba2581189a5b421c96e9ac361a9d22a29f84ee18a521ef'
    or current_database()<>'postgres' or current_user<>'postgres'
    or to_regclass('hotel_qa.environment_guard') is not null then
    raise exception 'STOP_DAYCARE_V1_PRODUCTION_BINDING';
  end if;
end;
$production_binding$;

do $postflight$
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
  rpc_grantees text[];
  internal_grantees text[];
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
    or has_table_privilege('anon','public.daycare_operation_states','select,insert,update,delete')
    or has_table_privilege('authenticated','public.daycare_operation_states','insert,update,delete')
    or not has_table_privilege('authenticated','public.daycare_operation_states','select')
    or not has_table_privilege('service_role','public.daycare_operation_states','select')
    or (select count(*) from pg_policy where polrelid='public.daycare_operation_states'::regclass and polname='daycare_operation_states_select_members')<>1 then
    raise exception 'STOP_DAYCARE_V1_RLS_ACL';
  end if;

  select coalesce(array_agg(distinct pg_get_userbyid(a.grantee)::text order by pg_get_userbyid(a.grantee)::text),'{}')
  into rpc_grantees
  from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in (
    'create_daycare_reservation','update_daycare_reservation','cancel_daycare_reservation',
    'assign_daycare_room','unassign_daycare_room','complete_daycare_check_in',
    'complete_daycare_check_out','get_daycare_operations_for_date','daycare_reservation_json'
  ) and a.privilege_type='EXECUTE';
  if rpc_grantees is distinct from array['authenticated','postgres','service_role']::text[] then
    raise exception 'STOP_DAYCARE_V1_PUBLIC_RPC_ACL';
  end if;

  select coalesce(array_agg(distinct pg_get_userbyid(a.grantee)::text order by pg_get_userbyid(a.grantee)::text),'{}')
  into internal_grantees
  from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in (
    'daycare_payload_hash_internal','daycare_child_request_id_internal',
    'protect_daycare_operation_state_internal','prevent_daycare_operation_state_delete_internal',
    'record_daycare_operation_audit_internal','guard_daycare_schedule_generic_mutation_internal',
    'assert_daycare_reservation_input_internal','daycare_request_replayed_internal',
    'daycare_append_request_internal'
  ) and a.privilege_type='EXECUTE';
  if internal_grantees is distinct from array['postgres']::text[] then
    raise exception 'STOP_DAYCARE_V1_INTERNAL_RPC_ACL';
  end if;

  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in (
      'create_daycare_reservation','update_daycare_reservation','cancel_daycare_reservation',
      'assign_daycare_room','unassign_daycare_room','complete_daycare_check_in',
      'complete_daycare_check_out'
    ) and (not p.prosecdef or p.provolatile<>'v' or position('PT409' in p.prosrc)=0 and p.proname<>'create_daycare_reservation')
  ) then
    raise exception 'STOP_DAYCARE_V1_RPC_CONTRACT';
  end if;

  if not exists(select 1 from pg_constraint where conrelid='public.daycare_operation_states'::regclass and conname='daycare_operation_states_lifecycle_check')
    or not exists(select 1 from pg_indexes where schemaname='public' and tablename='hotel_capacity_reservations' and indexdef like '%daycare_schedule_id%') then
    raise exception 'STOP_DAYCARE_V1_CONSTRAINT_SET';
  end if;

  if md5((select p.prosrc from pg_proc p where p.oid='public.complete_hotel_check_out(uuid,integer,timestamp with time zone,uuid)'::regprocedure))<>'7744baa7276dcb70676ec593e8ddc0e6'
    or md5((select p.prosrc from pg_proc p where p.oid='public.reverse_hotel_completion(uuid,integer,text,text,uuid)'::regprocedure))<>'dd4dd04865adfa2dc3ec83097e2b81a3'
    or md5((select p.prosrc from pg_proc p where p.oid='public.get_hotel_operations_snapshot_v2(date)'::regprocedure))<>'7dac53943e2f74f207de1cd36d5023fb'
    or (select p.provolatile from pg_proc p where p.oid='public.get_hotel_operations_snapshot_v2(date)'::regprocedure)<>'s' then
    raise exception 'STOP_DAYCARE_V1_FROZEN_HOTEL_DIFF';
  end if;
end;
$postflight$;

select 'DAYCARE_V1_READY' status;
rollback;
