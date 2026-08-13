begin read only;

do $$
declare
  availability_oid oid:=to_regprocedure('public.get_long_stay_room_availability_v2(uuid,date,date,time without time zone,boolean)');
  confirm_oid oid:=to_regprocedure('public.confirm_long_stay_month_v2(uuid,integer,date,date,uuid,uuid,time without time zone,boolean,uuid,uuid,uuid[],text,uuid)');
  availability_source text;
  confirm_source text;
  availability_grantees text[];
  confirm_grantees text[];
begin
  select prosrc into availability_source from pg_proc where oid=availability_oid;
  select prosrc into confirm_source from pg_proc where oid=confirm_oid;
  select coalesce(array(
    select distinct pg_get_userbyid(a.grantee)::text
    from pg_proc p,lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    where p.oid=availability_oid and a.privilege_type='EXECUTE' order by 1
  ),'{}') into availability_grantees;
  select coalesce(array(
    select distinct pg_get_userbyid(a.grantee)::text
    from pg_proc p,lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    where p.oid=confirm_oid and a.privilege_type='EXECUTE' order by 1
  ),'{}') into confirm_grantees;

  if availability_oid is null or confirm_oid is null
    or availability_grantees<>array['authenticated','postgres','service_role']::text[]
    or confirm_grantees<>array['authenticated','postgres','service_role']::text[]
    or position('p_physical_start_date::timestamp' in availability_source)=0
    or position('allocation.allocated_until>availability_from' in availability_source)=0
    or position('객실 사용 시작 시점에 사용 중' in availability_source)=0
    or position('계약 시작 이후 사용 이력과 겹침' in availability_source)>0
    or position('p_physical_start_date,p_check_in_time' in confirm_source)=0
    or position('month_from:=public.long_stay_first_assignment_effective_date_internal' in confirm_source)=0
    or position('using errcode=''PT409''' in confirm_source)=0
    or position('''infinity''::timestamptz' in confirm_source)=0
    or position('기존 Runtime의 객실 사용 시작일은 다시 설정할 수 없습니다.' in confirm_source)=0 then
    raise exception 'STOP_LONG_STAY_EXPLICIT_PHYSICAL_START_POSTFLIGHT';
  end if;

  if md5((select p.prosrc from pg_proc p where p.oid='public.complete_hotel_check_out(uuid,integer,timestamp with time zone,uuid)'::regprocedure))<>'7744baa7276dcb70676ec593e8ddc0e6'
    or md5((select p.prosrc from pg_proc p where p.oid='public.reverse_hotel_completion(uuid,integer,text,text,uuid)'::regprocedure))<>'dd4dd04865adfa2dc3ec83097e2b81a3'
    or md5((select p.prosrc from pg_proc p where p.oid='public.get_hotel_operations_snapshot_v2(date)'::regprocedure))<>'7dac53943e2f74f207de1cd36d5023fb' then
    raise exception 'STOP_LONG_STAY_EXPLICIT_PHYSICAL_START_FROZEN_HOTEL_DIFF';
  end if;
end;
$$;

select 'LONG_STAY_EXPLICIT_PHYSICAL_START_READY' status;
rollback;
