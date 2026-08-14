-- GENERATED FILE: do not edit or assemble by hand.
-- Dashboard phase: POSTFLIGHT_CLEANUP
-- Clean QA exact project: wxbvwixoeczfvbqurdse
-- Production project zorvcuskzemehblqdbfj is rejected before any mutation.
-- Approved migration SHA-256: 5743b1c3be65031bf38284be72b1ce4ed4c8c0f8be002f07bbb417f07e99fec6
-- Embedded source SHA-256: ead406d663e3b351fdefaaf33d2842f147e7f9c4dc0ca222837aa1e704a4ac31
begin read only;
-- DASHBOARD_BINDING_BEGIN
select set_config('app.release_project_ref','wxbvwixoeczfvbqurdse',true);
select set_config('app.release_migration_sha256','5743b1c3be65031bf38284be72b1ce4ed4c8c0f8be002f07bbb417f07e99fec6',true);

do $clean_qa_dashboard_binding$
declare guard hotel_qa.environment_guard%rowtype;
begin
  if current_database()<>'postgres' or current_user<>'postgres'
    or current_setting('app.release_project_ref',true) is distinct from 'wxbvwixoeczfvbqurdse'
    or current_setting('app.release_project_ref',true)='zorvcuskzemehblqdbfj'
    or current_setting('app.release_migration_sha256',true) is distinct from '5743b1c3be65031bf38284be72b1ce4ed4c8c0f8be002f07bbb417f07e99fec6' then
    raise exception 'STOP_LONG_STAY_OUTING_CLEAN_QA_DASHBOARD_BINDING';
  end if;
  select * into guard from hotel_qa.environment_guard;
  if not found
    or guard.qa_project_ref<>'wxbvwixoeczfvbqurdse'
    or guard.production_project_ref<>'zorvcuskzemehblqdbfj'
    or guard.qa_project_ref=guard.production_project_ref then
    raise exception 'STOP_LONG_STAY_OUTING_CLEAN_QA_ENVIRONMENT';
  end if;
  perform hotel_qa.assert_isolated_environment();
end;
$clean_qa_dashboard_binding$;
-- DASHBOARD_BINDING_END


do $$
declare start_oid oid:=to_regprocedure('public.start_long_stay_absence_v2(uuid,integer,timestamp with time zone,date,time without time zone,boolean,text,text,uuid)');
declare month_oid oid:=to_regprocedure('public.get_long_stay_month_v2(date)');
declare helper_oid oid:=to_regprocedure('public.long_stay_current_absence_projection_internal(uuid)');
declare start_source text; start_grantees text[]; month_grantees text[]; helper_grantees text[];
begin
  select prosrc into start_source from pg_proc where oid=start_oid;
  select coalesce(array(select distinct pg_get_userbyid(a.grantee)::text from pg_proc p,lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid=start_oid and a.privilege_type='EXECUTE' order by 1),'{}') into start_grantees;
  select coalesce(array(select distinct pg_get_userbyid(a.grantee)::text from pg_proc p,lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid=month_oid and a.privilege_type='EXECUTE' order by 1),'{}') into month_grantees;
  select coalesce(array(select distinct pg_get_userbyid(a.grantee)::text from pg_proc p,lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid=helper_oid and a.privilege_type='EXECUTE' order by 1),'{}') into helper_grantees;

  if start_oid is null or month_oid is null or helper_oid is null
    or start_grantees<>array['authenticated','postgres','service_role']::text[]
    or month_grantees<>array['authenticated','postgres','service_role']::text[]
    or helper_grantees<>array['postgres']::text[]
    or position('using errcode=''PT409''' in start_source)=0
    or position('contract_row.status not in (''pending'',''active'')' in start_source)=0
    or position('stay_row.checked_in_at is null' in start_source)=0
    or position('stay_row.checked_out_at is not null' in start_source)=0
    or position('expected_return_time_unspecified' in start_source)=0
    or position('update public.long_stay_contracts' in start_source)=0
    or position('status=''active''' in start_source)=0 then
    raise exception 'STOP_LONG_STAY_OUTING_EXPECTED_RETURN_RPC_CONTRACT';
  end if;

  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='long_stay_absence_events' and column_name='expected_return_date' and data_type='date' and is_nullable='YES')
    or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='long_stay_absence_events' and column_name='expected_return_time_unspecified' and data_type='boolean' and is_nullable='NO')
    or not exists(select 1 from pg_constraint where conrelid='public.long_stay_absence_events'::regclass and conname='long_stay_absence_expected_return_semantics_chk') then
    raise exception 'STOP_LONG_STAY_OUTING_EXPECTED_RETURN_STORAGE_CONTRACT';
  end if;

  if md5((select p.prosrc from pg_proc p where p.oid='public.complete_long_stay_absence(uuid,integer,timestamp with time zone,text,text,uuid)'::regprocedure))<>'63c736cc71749d1c550995cf0838980c'
    or md5((select p.prosrc from pg_proc p where p.oid='public.complete_hotel_check_out(uuid,integer,timestamp with time zone,uuid)'::regprocedure))<>'7744baa7276dcb70676ec593e8ddc0e6'
    or md5((select p.prosrc from pg_proc p where p.oid='public.reverse_hotel_completion(uuid,integer,text,text,uuid)'::regprocedure))<>'dd4dd04865adfa2dc3ec83097e2b81a3' then
    raise exception 'STOP_LONG_STAY_OUTING_EXPECTED_RETURN_FROZEN_DIFF';
  end if;

  -- The runtime matrix executes inside one transaction and rolls back. The
  -- contract memo is its canonical marker; every generated Hotel/Long Stay
  -- child row is FK-linked to that contract and cannot survive independently.
  if exists(select 1 from public.long_stay_contracts where memo='LONG_STAY_OUTING_RUNTIME_QA_202608140002') then
    raise exception 'STOP_LONG_STAY_OUTING_RUNTIME_QA_RESIDUE';
  end if;
end;
$$;

select 'LONG_STAY_OUTING_REPAIR_READY' status;
rollback;
