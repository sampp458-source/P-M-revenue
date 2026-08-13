begin read only;
do $$
declare
  target oid:=to_regprocedure('public.get_long_stay_room_availability(uuid,date,time without time zone,boolean)');
  grantees text[];
begin
  if target is null then raise exception 'STOP_LONG_STAY_ROOM_AVAILABILITY_MISSING'; end if;
  select array_agg(distinct coalesce(role.rolname,'PUBLIC') order by coalesce(role.rolname,'PUBLIC'))
  into grantees from aclexplode(coalesce((select proacl from pg_proc where oid=target),acldefault('f',(select proowner from pg_proc where oid=target)))) acl
  left join pg_roles role on role.oid=acl.grantee where acl.privilege_type='EXECUTE';
  if grantees<>array['authenticated','postgres','service_role']::text[]
    or not (select prosecdef and provolatile='s' and pg_get_userbyid(proowner)='postgres'
      and 'search_path=public, pg_temp'=any(proconfig) from pg_proc where oid=target)
    or position('allocation.archived_at is null' in pg_get_functiondef(target))=0
    or position('allocation.allocated_until>availability_from' in pg_get_functiondef(target))=0
    or position('shared_occupancy' in pg_get_functiondef(target))=0
    or position('long_stay' in pg_get_functiondef(target))=0
    or position('is_active_operation_member' in pg_get_functiondef(target))=0 then
    raise exception 'STOP_LONG_STAY_ROOM_AVAILABILITY_CONTRACT_DIFF';
  end if;
  if position('allocation.archived_at is null' in pg_get_functiondef('public.assert_hotel_room_allocation_available(uuid,uuid,timestamp with time zone,timestamp with time zone,uuid)'::regprocedure))=0
    or position('allocation.allocated_from < p_allocated_until' in pg_get_functiondef('public.assert_hotel_room_allocation_available(uuid,uuid,timestamp with time zone,timestamp with time zone,uuid)'::regprocedure))=0
    or position('allocation.allocated_until > p_allocated_from' in pg_get_functiondef('public.assert_hotel_room_allocation_available(uuid,uuid,timestamp with time zone,timestamp with time zone,uuid)'::regprocedure))=0
    or position('errcode = ''23P01''' in pg_get_functiondef('public.assert_hotel_room_allocation_available(uuid,uuid,timestamp with time zone,timestamp with time zone,uuid)'::regprocedure))=0 then
    raise exception 'STOP_LONG_STAY_ROOM_CONFLICT_GUARD_CHANGED';
  end if;
end;
$$;
select 'LONG_STAY_ROOM_AVAILABILITY_READY' status;
rollback;
