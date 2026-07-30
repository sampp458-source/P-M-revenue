-- Operations Schedule Foundation + Single Schedule 제한적 Rollback
-- Foundation의 membership/calendar/type 및 공용 entity_audit_events는 유지한다.
-- 일정 데이터가 한 건이라도 있으면 데이터 보호를 위해 전체 Rollback을 중단한다.

begin;

do $$
declare
  row_count bigint;
begin
  if to_regclass('public.operation_schedules') is not null then
    execute 'select count(*) from public.operation_schedules'
      into row_count;
    if row_count > 0 then
      raise exception
        'operation_schedules에 %건이 존재하여 Rollback을 중단합니다.',
        row_count;
    end if;
  end if;

  if to_regclass('public.operation_schedule_assignees') is not null then
    execute 'select count(*) from public.operation_schedule_assignees'
      into row_count;
    if row_count > 0 then
      raise exception
        'operation_schedule_assignees에 %건이 존재하여 Rollback을 중단합니다.',
        row_count;
    end if;
  end if;

  if to_regclass('public.operation_schedule_customers') is not null then
    execute 'select count(*) from public.operation_schedule_customers'
      into row_count;
    if row_count > 0 then
      raise exception
        'operation_schedule_customers에 %건이 존재하여 Rollback을 중단합니다.',
        row_count;
    end if;
  end if;

  if to_regclass('public.operation_schedule_dogs') is not null then
    execute 'select count(*) from public.operation_schedule_dogs'
      into row_count;
    if row_count > 0 then
      raise exception
        'operation_schedule_dogs에 %건이 존재하여 Rollback을 중단합니다.',
        row_count;
    end if;
  end if;
end;
$$;

do $$
begin
  if to_regclass('public.operation_schedule_assignees') is not null then
    execute 'drop trigger if exists operation_schedule_assignees_protect_metadata on public.operation_schedule_assignees';
    execute 'drop trigger if exists operation_schedule_assignees_updated_at on public.operation_schedule_assignees';
    execute 'drop trigger if exists operation_schedule_assignees_audit on public.operation_schedule_assignees';
    execute 'drop trigger if exists operation_schedule_assignees_block_delete on public.operation_schedule_assignees';
  end if;

  if to_regclass('public.operation_schedule_customers') is not null then
    execute 'drop trigger if exists operation_schedule_customers_protect_metadata on public.operation_schedule_customers';
    execute 'drop trigger if exists operation_schedule_customers_updated_at on public.operation_schedule_customers';
    execute 'drop trigger if exists operation_schedule_customers_audit on public.operation_schedule_customers';
    execute 'drop trigger if exists operation_schedule_customers_block_delete on public.operation_schedule_customers';
  end if;

  if to_regclass('public.operation_schedule_dogs') is not null then
    execute 'drop trigger if exists operation_schedule_dogs_protect_metadata on public.operation_schedule_dogs';
    execute 'drop trigger if exists operation_schedule_dogs_updated_at on public.operation_schedule_dogs';
    execute 'drop trigger if exists operation_schedule_dogs_audit on public.operation_schedule_dogs';
    execute 'drop trigger if exists operation_schedule_dogs_block_delete on public.operation_schedule_dogs';
  end if;

  if to_regclass('public.operation_schedules') is not null then
    execute 'drop trigger if exists operation_schedules_protect_metadata on public.operation_schedules';
    execute 'drop trigger if exists operation_schedules_updated_at on public.operation_schedules';
    execute 'drop trigger if exists operation_schedules_audit on public.operation_schedules';
    execute 'drop trigger if exists operation_schedules_block_delete on public.operation_schedules';
  end if;
end;
$$;

drop function if exists public.archive_operation_schedule(
  uuid, integer, text, uuid
);
drop function if exists public.set_operation_schedule_status(
  uuid, integer, text, text, uuid
);
drop function if exists public.update_operation_schedule(
  uuid, integer, uuid, uuid, text, timestamptz, timestamptz,
  boolean, text, uuid[], uuid[], uuid[], uuid
);
drop function if exists public.create_operation_schedule(
  uuid, uuid, text, timestamptz, timestamptz,
  boolean, text, uuid[], uuid[], uuid[], uuid
);
drop function if exists public.get_operation_schedules_for_day(date);
drop function if exists public.sync_operation_schedule_links(
  uuid, uuid[], uuid[], uuid[], uuid
);
drop function if exists public.assert_operation_schedule_input(
  uuid, uuid, text, timestamptz, timestamptz,
  uuid[], uuid[], uuid[]
);
drop function if exists public.operation_schedule_json(uuid);

drop table if exists public.operation_schedule_assignees;
drop table if exists public.operation_schedule_customers;
drop table if exists public.operation_schedule_dogs;
drop table if exists public.operation_schedules;

drop function if exists public.block_operation_schedule_delete();
drop function if exists public.record_operation_schedule_audit_event();
drop function if exists public.protect_operation_link_metadata();
drop function if exists public.protect_operation_schedule_metadata();

commit;
