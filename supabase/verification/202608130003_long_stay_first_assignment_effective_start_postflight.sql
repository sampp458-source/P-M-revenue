begin read only;

do $$
declare
  helper_oid oid:=to_regprocedure('public.long_stay_first_assignment_effective_date_internal(date,date)');
  confirm_source text;
  availability_source text;
  helper_grantees text[];
begin
  select p.prosrc into confirm_source from pg_proc p
  where p.oid=to_regprocedure('public.confirm_long_stay_month(uuid,integer,date,uuid,uuid,time without time zone,boolean,uuid,uuid,uuid[],text,uuid)');
  select p.prosrc into availability_source from pg_proc p
  where p.oid=to_regprocedure('public.get_long_stay_room_availability(uuid,date,time without time zone,boolean)');
  select coalesce(array(
    select distinct pg_get_userbyid(a.grantee)::text
    from pg_proc p, lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    where p.oid=helper_oid and a.privilege_type='EXECUTE' order by 1
  ),'{}') into helper_grantees;

  if helper_oid is null
    or helper_grantees<>array['postgres']::text[]
    or position('public.long_stay_first_assignment_effective_date_internal(contract_row.started_on,p_service_month)' in confirm_source)=0
    or position('public.long_stay_first_assignment_effective_date_internal(contract_row.started_on,p_service_month)' in availability_source)=0
    or position('using errcode=''PT409''' in confirm_source)=0
    or position('''infinity''::timestamptz' in confirm_source)=0
    or position('allocation.allocated_until>availability_from' in availability_source)=0
    or position('effective_start_overlap' in availability_source)=0
    or position('effective_period_history' in availability_source)=0
    or position('배정 시작 구간과 겹침' in availability_source)=0
    or position('계약 시작 이후 사용 이력과 겹침' in availability_source)>0 then
    raise exception 'STOP_LONG_STAY_FIRST_ASSIGNMENT_EFFECTIVE_START_POSTFLIGHT';
  end if;

  if md5((select p.prosrc from pg_proc p where p.oid='public.complete_hotel_check_out(uuid,integer,timestamp with time zone,uuid)'::regprocedure))<>'7744baa7276dcb70676ec593e8ddc0e6'
    or md5((select p.prosrc from pg_proc p where p.oid='public.reverse_hotel_completion(uuid,integer,text,text,uuid)'::regprocedure))<>'dd4dd04865adfa2dc3ec83097e2b81a3'
    or md5((select p.prosrc from pg_proc p where p.oid='public.get_hotel_operations_snapshot_v2(date)'::regprocedure))<>'7dac53943e2f74f207de1cd36d5023fb' then
    raise exception 'STOP_LONG_STAY_EFFECTIVE_START_FROZEN_HOTEL_DIFF';
  end if;
end;
$$;

select 'LONG_STAY_FIRST_ASSIGNMENT_EFFECTIVE_START_READY' status;
rollback;
