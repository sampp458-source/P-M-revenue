-- Read-only preflight: Operations schedule archive permission hotfix

select
  to_regclass('public.operation_schedules') is not null
    as operation_schedules_exists,
  to_regclass('public.operation_schedule_assignees') is not null
    as operation_schedule_assignees_exists,
  to_regclass('public.operation_memberships') is not null
    as operation_memberships_exists,
  to_regprocedure(
    'public.archive_operation_schedule(uuid,integer,text,uuid)'
  ) is not null as archive_rpc_exists,
  to_regprocedure('public.is_active_operation_member()') is not null
    as active_member_function_exists,
  to_regprocedure('public.has_operation_role(text[])') is not null
    as operation_role_function_exists,
  to_regprocedure('public.update_operation_schedule(uuid,integer,uuid,uuid,text,timestamp with time zone,timestamp with time zone,boolean,text,uuid[],uuid[],uuid[],uuid)')
    is not null as update_rpc_exists;

select
  pg_get_functiondef(procedure.oid) as current_archive_rpc_definition,
  has_function_privilege(
    'authenticated',
    procedure.oid,
    'EXECUTE'
  ) as authenticated_can_execute
from pg_proc procedure
join pg_namespace namespace
  on namespace.oid = procedure.pronamespace
where namespace.nspname = 'public'
  and procedure.proname = 'archive_operation_schedule'
  and pg_get_function_identity_arguments(procedure.oid) =
    'p_schedule_id uuid, p_expected_version integer, p_reason text, p_request_id uuid';

select
  membership.role,
  membership.is_active,
  count(*) as member_count
from public.operation_memberships membership
group by membership.role, membership.is_active
order by membership.role, membership.is_active desc;

select
  to_regprocedure('public.can_manage_operation_schedule(uuid)') is not null
    as permission_helper_already_exists,
  to_regprocedure(
    'public.enforce_operation_schedule_write_permission()'
  ) is not null as permission_trigger_function_already_exists,
  exists (
    select 1
    from pg_trigger trigger_info
    where trigger_info.tgrelid = 'public.operation_schedules'::regclass
      and trigger_info.tgname = 'operation_schedules_write_permission'
      and not trigger_info.tgisinternal
  ) as permission_trigger_already_exists;
