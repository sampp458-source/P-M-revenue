-- Daycare is a hotel room operation. Allow staff handoffs without changing
-- generic calendar writes, the historical administrator guard, or any data.
begin;

do $$
begin
  if md5(pg_get_functiondef('public.can_manage_operation_schedule(uuid)'::regprocedure))
      is distinct from 'd419dfd9971ed9de41e69ab0d9a45c13' then
    raise exception 'STOP_DAYCARE_STAFF_PERMISSION_PREDECESSOR_MISMATCH';
  end if;
  if md5((select prosrc from pg_proc where oid = 'public.guard_daycare_schedule_generic_mutation_internal()'::regprocedure))
      is distinct from '9e52e01bdab9913b77c0ad58d157033a' then
    raise exception 'STOP_DAYCARE_CALENDAR_GUARD_PREDECESSOR_MISMATCH';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgfoid = 'public.guard_daycare_schedule_generic_mutation_internal()'::regprocedure
      and tgrelid = 'public.operation_schedules'::regclass and tgenabled in ('O', 'A')
  ) or not exists (
    select 1 from pg_trigger
    where tgfoid = 'public.guard_retrospective_daycare_admin_v1()'::regprocedure
      and tgrelid = 'public.daycare_operation_states'::regclass and tgenabled in ('O', 'A')
  ) then
    raise exception 'STOP_DAYCARE_STAFF_PERMISSION_GUARD_MISMATCH';
  end if;
end;
$$;

create or replace function public.can_manage_operation_schedule(p_schedule_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
    and public.is_active_operation_member()
    and (
      public.has_operation_role(array['manager', 'owner'])
      or exists (
        select 1 from public.operation_schedules schedule
        where schedule.id = p_schedule_id and schedule.created_by = auth.uid()
      )
      or exists (
        select 1 from public.operation_schedule_assignees assignee
        where assignee.schedule_id = p_schedule_id
          and assignee.profile_id = auth.uid() and assignee.archived_at is null
      )
      or exists (
        select 1
        from public.hotel_stay_schedule_events event
        join public.hotel_stays stay on stay.id = event.hotel_stay_id
        join public.operation_schedules schedule on schedule.id = event.operation_schedule_id
        join public.operation_calendars calendar on calendar.id = schedule.calendar_id
        join public.business_units unit on unit.id = calendar.business_unit_id
        where event.operation_schedule_id = p_schedule_id
          and event.event_kind in ('check_in', 'check_out')
          and event.archived_at is null and stay.archived_at is null
          and schedule.archived_at is null and unit.code = 'hotel'
      )
      -- Match hotel staff handoffs only for linked, open room-owning daycare.
      -- A generic calendar entry must not acquire the hotel exception.
      or exists (
        select 1
        from public.daycare_operation_states state
        join public.operation_schedules schedule on schedule.id = state.operation_schedule_id
        join public.operation_calendars calendar on calendar.id = schedule.calendar_id
        join public.business_units unit on unit.id = calendar.business_unit_id
        where state.operation_schedule_id = p_schedule_id
          and state.lifecycle_status in ('scheduled', 'checked_in')
          and schedule.status = 'scheduled' and schedule.archived_at is null
          and (schedule.starts_at at time zone 'Asia/Seoul')::date
            >= (statement_timestamp() at time zone 'Asia/Seoul')::date
          and (unit.code = 'daycare' or (unit.code = 'hotel' and
            schedule.schedule_type_id = '5cadf20b-021a-4948-a5dd-471677f51d21'::uuid))
      )
    );
$$;

-- Protect the full generic Calendar edit too (including assignees/dog links).
-- The dedicated daycare commands already opt into the existing orchestration.
create or replace function public.guard_daycare_schedule_generic_mutation_internal()
returns trigger language plpgsql security definer set search_path=public,pg_temp
as $$
begin
  if exists(select 1 from public.daycare_operation_states state where state.operation_schedule_id=old.id)
    and current_setting('app.daycare_orchestration',true) is distinct from 'on'
    and (auth.uid() is not null or new.version is distinct from old.version or (new.calendar_id,new.schedule_type_id,new.title,new.description,new.starts_at,new.ends_at,
      new.all_day,new.time_unspecified,new.status,new.archived_at,new.archive_reason)
      is distinct from
      (old.calendar_id,old.schedule_type_id,old.title,old.description,old.starts_at,old.ends_at,
       old.all_day,old.time_unspecified,old.status,old.archived_at,old.archive_reason)) then
    raise exception '객실형 Daycare 예약은 Daycare 전용 화면에서 변경해 주세요.' using errcode='P0001';
  end if;
  return new;
end;
$$;

commit;
