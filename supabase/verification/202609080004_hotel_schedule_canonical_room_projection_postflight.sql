begin transaction read only;

with rpc as (
  select p.oid, p.prosecdef, p.proconfig, p.prosrc, p.proacl, p.proowner, p.provolatile
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'get_operation_hotel_room_projections'
    and pg_get_function_identity_arguments(p.oid) = 'p_operation_schedule_ids uuid[]'
    and pg_get_function_result(p.oid) = 'jsonb'
), checks as (
  select count(*) = 1 as rpc_shape_ok,
    coalesce(bool_and(prosecdef), false) as security_definer_ok,
    coalesce(bool_and(provolatile = 's'), false) as stable_read_only_ok,
    coalesce(bool_and(proconfig @> array['search_path=public, pg_temp']), false)
      as search_path_ok,
    coalesce(bool_and(prosrc like '%auth.uid() is null or not public.is_active_operation_member()%'
      and prosrc like '%using errcode = ''42501''%'), false) as authorization_ok,
    -- Exact shared core fingerprint: no second historical resolver predicate.
    coalesce(bool_and(md5(split_part(split_part(prosrc,
      E'  -- BEGIN CANONICAL PROJECTION CORE\n', 2),
      '  -- END CANONICAL PROJECTION CORE', 1)) = '0328c64a5c26c2481817e91385f548a2'), false)
      as canonical_core_matches_runtime,
    coalesce(bool_and(has_function_privilege('authenticated', oid, 'execute')
      and has_function_privilege('service_role', oid, 'execute')
      and not has_function_privilege('anon', oid, 'execute')
      and not exists (
        select 1 from aclexplode(coalesce(proacl, acldefault('f', proowner))) acl
        where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
      )), false) as acl_ok
  from rpc
)
select
  case when rpc_shape_ok and security_definer_ok and search_path_ok
    and stable_read_only_ok and authorization_ok and canonical_core_matches_runtime and acl_ok
    then 'HOTEL_SCHEDULE_CANONICAL_ROOM_PROJECTION_POSTFLIGHT_PASS'
    else 'HOTEL_SCHEDULE_CANONICAL_ROOM_PROJECTION_POSTFLIGHT_FAIL' end as verdict,
  checks.*, 'INFORMATIONAL_ONLY'::text as business_count_baseline
from checks;

rollback;
