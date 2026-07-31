-- Read-only postflight: Operations schedule archive permission hotfix

select
  to_regprocedure(
    'public.archive_operation_schedule(uuid,integer,text,uuid)'
  ) is not null as archive_rpc_exists,
  has_function_privilege(
    'authenticated',
    'public.archive_operation_schedule(uuid,integer,text,uuid)',
    'EXECUTE'
  ) as authenticated_can_execute,
  to_regprocedure('public.can_manage_operation_schedule(uuid)') is not null
    as shared_permission_helper_exists,
  exists (
    select 1
    from pg_trigger trigger_info
    where trigger_info.tgrelid = 'public.operation_schedules'::regclass
      and trigger_info.tgname = 'operation_schedules_write_permission'
      and not trigger_info.tgisinternal
  ) as update_permission_trigger_exists,
  position(
    'can_manage_operation_schedule(p_schedule_id)'
    in lower(pg_get_functiondef(procedure.oid))
  ) > 0 as archive_uses_shared_permission_check,
  position(
    'archived_at = now()'
    in lower(pg_get_functiondef(procedure.oid))
  ) > 0 as soft_archive_preserved,
  position(
    'delete from'
    in lower(pg_get_functiondef(procedure.oid))
  ) = 0 as physical_delete_absent
from pg_proc procedure
join pg_namespace namespace
  on namespace.oid = procedure.pronamespace
where namespace.nspname = 'public'
  and procedure.proname = 'archive_operation_schedule'
  and pg_get_function_identity_arguments(procedure.oid) =
    'p_schedule_id uuid, p_expected_version integer, p_reason text, p_request_id uuid';

select
  position(
    'schedule.created_by = auth.uid()'
    in lower(pg_get_functiondef(procedure.oid))
  ) > 0 as creator_allowed,
  position(
    'assignee.profile_id = auth.uid()'
    in lower(pg_get_functiondef(procedure.oid))
  ) > 0 as active_assignee_allowed,
  position(
    'assignee.archived_at is null'
    in lower(pg_get_functiondef(procedure.oid))
  ) > 0 as archived_assignee_excluded,
  position(
    'has_operation_role(array[''manager'', ''owner''])'
    in lower(pg_get_functiondef(procedure.oid))
  ) > 0 as manager_owner_allowed
from pg_proc procedure
join pg_namespace namespace
  on namespace.oid = procedure.pronamespace
where namespace.nspname = 'public'
  and procedure.proname = 'can_manage_operation_schedule';

select
  count(*) filter (where schedule.archived_at is null) as active_schedules,
  count(*) filter (where schedule.archived_at is not null) as archived_schedules,
  count(*) filter (
    where schedule.archived_at is not null
      and (
        schedule.archived_by is null
        or nullif(btrim(schedule.archive_reason), '') is null
      )
  ) as invalid_archive_metadata
from public.operation_schedules schedule;
