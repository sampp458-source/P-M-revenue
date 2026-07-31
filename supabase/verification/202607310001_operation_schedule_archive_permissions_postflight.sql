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
  position(
    'schedule_row.created_by is distinct from actor_id'
    in lower(pg_get_functiondef(procedure.oid))
  ) > 0 as staff_creator_check_exists,
  position(
    'has_operation_role(array[''manager'', ''owner''])'
    in lower(pg_get_functiondef(procedure.oid))
  ) > 0 as manager_owner_override_exists,
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
