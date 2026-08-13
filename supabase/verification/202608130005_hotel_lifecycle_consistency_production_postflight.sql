begin read only;

do $production_binding$
begin
  if current_setting('app.release_project_ref',true) is distinct from 'zorvcuskzemehblqdbfj'
    or current_setting('app.release_project_ref',true)='wxbvwixoeczfvbqurdse'
    or current_setting('app.release_migration_sha256',true) is distinct from
      '5012670da85361cbfdccbf835722cd1f82065292a90f666a88c7113dbbc9aa03'
    or current_database()<>'postgres' or current_user<>'postgres'
    or to_regclass('hotel_qa.environment_guard') is not null then
    raise exception 'STOP_HOTEL_LIFECYCLE_PRODUCTION_BINDING';
  end if;
end;
$production_binding$;

do $postflight$
declare
  rpc_oid oid:=to_regprocedure('public.update_checked_in_hotel_planned_checkout(uuid,integer,date,time without time zone,boolean,uuid)');
  trigger_oid oid:=to_regprocedure('public.sync_hotel_lifecycle_schedule_status_internal()');
  rpc_source text; rpc_grantees text[]; trigger_grantees text[];
begin
  if rpc_oid is null or trigger_oid is null
    or to_regclass('public.hotel_planned_checkout_requests') is null then
    raise exception 'STOP_HOTEL_LIFECYCLE_OBJECT_MISSING';
  end if;
  select p.prosrc into rpc_source from pg_proc p where p.oid=rpc_oid;
  select coalesce(array(
    select distinct pg_get_userbyid(a.grantee)::text
    from pg_proc p,lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    where p.oid=rpc_oid and a.privilege_type='EXECUTE' order by 1
  ),'{}') into rpc_grantees;
  select coalesce(array(
    select distinct pg_get_userbyid(a.grantee)::text
    from pg_proc p,lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    where p.oid=trigger_oid and a.privilege_type='EXECUTE' order by 1
  ),'{}') into trigger_grantees;
  if rpc_grantees<>array['authenticated','postgres','service_role']::text[]
    or trigger_grantees<>array['postgres']::text[] then
    raise exception 'STOP_HOTEL_LIFECYCLE_RPC_ACL';
  end if;
  if has_table_privilege('anon','public.hotel_planned_checkout_requests','SELECT')
    or has_table_privilege('authenticated','public.hotel_planned_checkout_requests','SELECT')
    or has_table_privilege('service_role','public.hotel_planned_checkout_requests','SELECT')
    or not (select relrowsecurity from pg_class where oid='public.hotel_planned_checkout_requests'::regclass) then
    raise exception 'STOP_HOTEL_LIFECYCLE_LEDGER_ACL';
  end if;
  if (select count(*) from pg_trigger where tgrelid='public.hotel_stays'::regclass
      and tgname='hotel_stays_calendar_lifecycle_sync' and not tgisinternal)<>1 then
    raise exception 'STOP_HOTEL_LIFECYCLE_TRIGGER';
  end if;
  if position('using errcode=''PT409''' in rpc_source)=0
    or position('assert_hotel_capacity_available' in rpc_source)=0
    or position('other_allocation.allocated_from<capacity_until' in rpc_source)=0
    or position('other_allocation.allocated_from<target_physical_until' in rpc_source)=0
    or position('assert_hotel_total_capacity_available' in rpc_source)=0
    or position('target_physical_until' in rpc_source)=0
    or position('long_stay_contracts' in rpc_source)=0
    or position('using errcode=''40001''' in rpc_source)>0 then
    raise exception 'STOP_HOTEL_LIFECYCLE_RPC_CONTRACT';
  end if;
  if exists (
    select 1 from public.hotel_stays stay
    join public.hotel_stay_schedule_events event on event.hotel_stay_id=stay.id
    join public.operation_schedules schedule on schedule.id=event.operation_schedule_id
    where stay.archived_at is null and event.archived_at is null and schedule.archived_at is null
      and event.event_kind in ('check_in','check_out')
      and schedule.status is distinct from case event.event_kind
        when 'check_in' then case when stay.checked_in_at is null then 'scheduled' else 'completed' end
        when 'check_out' then case when stay.checked_out_at is null then 'scheduled' else 'completed' end
      end
  ) then
    raise exception 'STOP_HOTEL_LIFECYCLE_CALENDAR_PROJECTION';
  end if;
  if md5((select p.prosrc from pg_proc p where p.oid='public.complete_hotel_check_out(uuid,integer,timestamp with time zone,uuid)'::regprocedure))<>'7744baa7276dcb70676ec593e8ddc0e6'
    or md5((select p.prosrc from pg_proc p where p.oid='public.reverse_hotel_completion(uuid,integer,text,text,uuid)'::regprocedure))<>'dd4dd04865adfa2dc3ec83097e2b81a3'
    or md5((select p.prosrc from pg_proc p where p.oid='public.get_hotel_operations_snapshot_v2(date)'::regprocedure))<>'7dac53943e2f74f207de1cd36d5023fb' then
    raise exception 'STOP_HOTEL_LIFECYCLE_FROZEN_HOTEL_DIFF';
  end if;
end;
$postflight$;

select 'HOTEL_LIFECYCLE_CONSISTENCY_READY' status;
rollback;
