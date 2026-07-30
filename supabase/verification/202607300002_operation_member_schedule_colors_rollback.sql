-- Operations 담당자별 일정 색상 제한적 Rollback

begin;

do $$
declare
  configured_color_count bigint;
begin
  if not exists (
    select 1
    from information_schema.columns column_info
    where column_info.table_schema = 'public'
      and column_info.table_name = 'operation_memberships'
      and column_info.column_name = 'schedule_color'
  ) then
    return;
  end if;

  select count(*)
  into configured_color_count
  from public.operation_memberships membership
  where membership.schedule_color is not null;

  if configured_color_count > 0 then
    raise exception
      '일정 색상이 설정된 Operations Membership이 %건 있어 Rollback을 중단합니다.',
      configured_color_count;
  end if;
end;
$$;

drop function if exists public.set_operation_member_schedule_color(
  uuid, text, timestamptz, uuid
);
drop function if exists public.get_active_operation_assignees();

alter table public.operation_memberships
  drop constraint if exists operation_memberships_schedule_color_check;
alter table public.operation_memberships
  drop column if exists schedule_color;

commit;
