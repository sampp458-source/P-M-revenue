-- Operations 일정 보관(삭제 UI) 최소 권한 정책
-- Finance 객체는 변경하지 않는다.

begin;

do $$
begin
  if to_regclass('public.operation_schedules') is null
    or to_regclass('public.operation_schedule_assignees') is null
    or to_regclass('public.operation_memberships') is null
    or to_regprocedure(
      'public.archive_operation_schedule(uuid,integer,text,uuid)'
    ) is null
    or to_regprocedure('public.is_active_operation_member()') is null
    or to_regprocedure('public.has_operation_role(text[])') is null then
    raise exception 'Operations Single Schedule 기반을 먼저 확인해 주세요.';
  end if;
end;
$$;

create or replace function public.can_manage_operation_schedule(
  p_schedule_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    auth.uid() is not null
    and public.is_active_operation_member()
    and (
      public.has_operation_role(array['manager', 'owner'])
      or exists (
        select 1
        from public.operation_schedules schedule
        where schedule.id = p_schedule_id
          and schedule.created_by = auth.uid()
      )
      or exists (
        select 1
        from public.operation_schedule_assignees assignee
        where assignee.schedule_id = p_schedule_id
          and assignee.profile_id = auth.uid()
          and assignee.archived_at is null
      )
    );
$$;

create or replace function public.enforce_operation_schedule_write_permission()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null
    and not public.can_manage_operation_schedule(old.id) then
    raise exception '일정 생성자 또는 담당자만 일정을 변경할 수 있습니다.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists operation_schedules_write_permission
  on public.operation_schedules;
create trigger operation_schedules_write_permission
  before update on public.operation_schedules
  for each row
  execute function public.enforce_operation_schedule_write_permission();

create or replace function public.archive_operation_schedule(
  p_schedule_id uuid,
  p_expected_version integer,
  p_reason text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  schedule_row public.operation_schedules%rowtype;
  request_entity_id uuid;
begin
  if actor_id is null or not public.is_active_operation_member() then
    raise exception 'Operations 일정 보관 권한이 없습니다.'
      using errcode = '42501';
  end if;

  if p_request_id is null
    or p_expected_version is null
    or nullif(btrim(p_reason), '') is null then
    raise exception '요청 ID, 기존 버전, 보관 사유가 필요합니다.'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));

  select audit.entity_id
  into request_entity_id
  from public.entity_audit_events audit
  where audit.module_code = 'operations'
    and audit.entity_type = 'operation_schedules'
    and audit.request_id = p_request_id
  order by audit.created_at
  limit 1;

  if request_entity_id is not null then
    if request_entity_id <> p_schedule_id then
      raise exception '이미 다른 일정에 사용된 요청 ID입니다.'
        using errcode = '23505';
    end if;
    return public.operation_schedule_json(p_schedule_id);
  end if;

  select schedule.*
  into schedule_row
  from public.operation_schedules schedule
  where schedule.id = p_schedule_id
  for update;

  if not found then
    raise exception '보관할 일정을 확인할 수 없습니다.'
      using errcode = 'P0002';
  end if;

  if not public.can_manage_operation_schedule(p_schedule_id) then
    raise exception '일정 생성자 또는 담당자만 일정을 삭제할 수 있습니다.'
      using errcode = '42501';
  end if;

  if schedule_row.archived_at is not null then
    return public.operation_schedule_json(p_schedule_id);
  end if;

  if schedule_row.version <> p_expected_version then
    raise exception '다른 사용자가 먼저 일정을 수정했습니다. 새로고침 후 다시 시도해 주세요.'
      using errcode = '40001';
  end if;

  perform set_config('app.operation_change_reason', btrim(p_reason), true);
  perform set_config('app.operation_request_id', p_request_id::text, true);

  update public.operation_schedules schedule
  set archived_at = now(),
      archived_by = actor_id,
      archive_reason = btrim(p_reason),
      updated_by = actor_id
  where schedule.id = p_schedule_id;

  return public.operation_schedule_json(p_schedule_id);
end;
$$;

revoke all on function public.archive_operation_schedule(
  uuid, integer, text, uuid
) from public, anon;
grant execute on function public.archive_operation_schedule(
  uuid, integer, text, uuid
) to authenticated;

revoke all on function public.can_manage_operation_schedule(uuid)
  from public, anon;
grant execute on function public.can_manage_operation_schedule(uuid)
  to authenticated;
revoke all on function public.enforce_operation_schedule_write_permission()
  from public;

commit;
