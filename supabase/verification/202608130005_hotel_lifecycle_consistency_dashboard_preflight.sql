-- GENERATED; do not edit or assemble by hand.
-- Production zorvcuskzemehblqdbfj; Clean QA wxbvwixoeczfvbqurdse is rejected.
-- Approved source SHA-256: 59276b6e3534d7565ef2d0805d94bc1d6b2fd22de9edc6e1a1a3b88dd984691d
-- Migration SHA-256: 5012670da85361cbfdccbf835722cd1f82065292a90f666a88c7113dbbc9aa03
begin read only;
select set_config('app.release_project_ref','zorvcuskzemehblqdbfj',true);
select set_config('app.release_migration_sha256','5012670da85361cbfdccbf835722cd1f82065292a90f666a88c7113dbbc9aa03',true);
-- APPROVED_SOURCE_BODY_BEGIN: PREFLIGHT

do $production_binding$
begin
  if current_setting('app.release_project_ref',true) is distinct from 'zorvcuskzemehblqdbfj'
    or current_setting('app.release_project_ref',true)='wxbvwixoeczfvbqurdse'
    or current_setting('app.release_migration_sha256',true) is distinct from
      '5012670da85361cbfdccbf835722cd1f82065292a90f666a88c7113dbbc9aa03'
    or current_database()<>'postgres' or current_user<>'postgres'
    or to_regclass('hotel_qa.environment_guard') is not null then
    raise exception 'STOP_HOTEL_LIFECYCLE_PRODUCTION_BINDING';
  end if;
end;
$production_binding$;

do $preflight$
begin
  if to_regprocedure('public.update_checked_in_hotel_planned_checkout(uuid,integer,date,time without time zone,boolean,uuid)') is not null
    or to_regclass('public.hotel_planned_checkout_requests') is not null
    or to_regprocedure('public.sync_hotel_lifecycle_schedule_status_internal()') is not null
    or exists (
      select 1 from pg_trigger
      where tgrelid='public.hotel_stays'::regclass
        and tgname='hotel_stays_calendar_lifecycle_sync'
        and not tgisinternal
    ) then
    raise exception 'STOP_HOTEL_LIFECYCLE_CONSISTENCY_ALREADY_APPLIED';
  end if;

  if to_regprocedure('public.assert_hotel_total_capacity_available(timestamp with time zone,timestamp with time zone,integer,uuid)') is null
    or to_regprocedure('public.assert_hotel_capacity_available(uuid,timestamp with time zone,timestamp with time zone,integer,uuid)') is null
    or to_regprocedure('public.hotel_stay_json(uuid)') is null
    or to_regclass('public.hotel_physical_occupancies') is null
    or to_regclass('public.hotel_physical_occupancy_members') is null
    or to_regclass('public.long_stay_contracts') is null then
    raise exception 'STOP_HOTEL_LIFECYCLE_CONSISTENCY_DEPENDENCY_MISSING';
  end if;

  if exists (
    select 1 from public.hotel_stays stay
    where stay.archived_at is null
      and exists (
        select 1 from (values ('check_in'::text),('check_out'::text)) kind(event_kind)
        where (
          select count(*) from public.hotel_stay_schedule_events event
          join public.operation_schedules schedule on schedule.id=event.operation_schedule_id
          where event.hotel_stay_id=stay.id and event.event_kind=kind.event_kind
            and event.archived_at is null and schedule.archived_at is null
        )<>case
          when kind.event_kind='check_out' and exists(
            select 1 from public.long_stay_contracts contract
            where contract.current_hotel_stay_id=stay.id
              and contract.archived_at is null
              and contract.planned_check_out_date is null
          ) then 0
          else 1
        end
      )
  ) then
    raise exception 'STOP_HOTEL_LIFECYCLE_CALENDAR_LINK_BASELINE';
  end if;

  if md5((select p.prosrc from pg_proc p where p.oid='public.complete_hotel_check_out(uuid,integer,timestamp with time zone,uuid)'::regprocedure))<>'7744baa7276dcb70676ec593e8ddc0e6'
    or md5((select p.prosrc from pg_proc p where p.oid='public.reverse_hotel_completion(uuid,integer,text,text,uuid)'::regprocedure))<>'dd4dd04865adfa2dc3ec83097e2b81a3'
    or md5((select p.prosrc from pg_proc p where p.oid='public.get_hotel_operations_snapshot_v2(date)'::regprocedure))<>'7dac53943e2f74f207de1cd36d5023fb' then
    raise exception 'STOP_HOTEL_LIFECYCLE_FROZEN_HOTEL_BASELINE';
  end if;
end;
$preflight$;

select 'READY_TO_APPLY_HOTEL_LIFECYCLE_CONSISTENCY' status;
-- APPROVED_SOURCE_BODY_END: PREFLIGHT
rollback;
