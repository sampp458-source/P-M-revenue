-- Production-only, read-only Daycare V1 release gate.
begin read only;
select set_config('app.release_project_ref','zorvcuskzemehblqdbfj',true);
select set_config('app.release_migration_sha256','a94b254bad910f7e89ba2581189a5b421c96e9ac361a9d22a29f84ee18a521ef',true);

do $production_binding$
begin
  if current_setting('app.release_project_ref',true) is distinct from 'zorvcuskzemehblqdbfj'
    or current_setting('app.release_project_ref',true)='wxbvwixoeczfvbqurdse'
    or current_setting('app.release_migration_sha256',true) is distinct from
      'a94b254bad910f7e89ba2581189a5b421c96e9ac361a9d22a29f84ee18a521ef'
    or current_database()<>'postgres' or current_user<>'postgres'
    or to_regclass('hotel_qa.environment_guard') is not null then
    raise exception 'STOP_DAYCARE_V1_PRODUCTION_BINDING';
  end if;
end;
$production_binding$;

do $preflight$
begin
  if to_regclass('public.daycare_operation_states') is not null
    or exists (
      select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname in (
        'create_daycare_reservation','update_daycare_reservation','cancel_daycare_reservation',
        'assign_daycare_room','unassign_daycare_room','complete_daycare_check_in',
        'complete_daycare_check_out','get_daycare_operations_for_date',
        'daycare_payload_hash_internal','daycare_child_request_id_internal',
        'protect_daycare_operation_state_internal','prevent_daycare_operation_state_delete_internal',
        'record_daycare_operation_audit_internal','guard_daycare_schedule_generic_mutation_internal',
        'daycare_reservation_json','assert_daycare_reservation_input_internal',
        'daycare_request_replayed_internal','daycare_append_request_internal'
      )
    ) then
    raise exception 'STOP_DAYCARE_V1_ALREADY_PRESENT';
  end if;

  if to_regclass('public.operation_schedules') is null
    or to_regclass('public.hotel_capacity_reservations') is null
    or to_regclass('public.hotel_room_allocations') is null
    or to_regprocedure('public.create_operation_schedule(uuid,uuid,text,timestamp with time zone,timestamp with time zone,boolean,boolean,text,uuid[],uuid[],uuid[],uuid)') is null
    or to_regprocedure('public.update_operation_schedule(uuid,integer,uuid,uuid,text,timestamp with time zone,timestamp with time zone,boolean,boolean,text,uuid[],uuid[],uuid[],uuid)') is null
    or to_regprocedure('public.set_operation_schedule_status(uuid,integer,text,text,uuid)') is null
    or to_regprocedure('public.register_hotel_daycare_capacity(uuid,uuid,uuid)') is null
    or to_regprocedure('public.assign_hotel_daycare_room(uuid,uuid,text,uuid)') is null then
    raise exception 'STOP_DAYCARE_V1_DEPENDENCY_MISSING';
  end if;

  if exists (
    select 1 from public.hotel_capacity_reservations capacity
    where capacity.source_kind='daycare' and capacity.archived_at is null
      and not exists (
        select 1 from public.operation_schedules schedule
        where schedule.id=capacity.daycare_schedule_id and schedule.archived_at is null
      )
  ) then
    raise exception 'STOP_DAYCARE_ORPHAN_CAPACITY';
  end if;

  if md5((select p.prosrc from pg_proc p where p.oid='public.complete_hotel_check_out(uuid,integer,timestamp with time zone,uuid)'::regprocedure))<>'7744baa7276dcb70676ec593e8ddc0e6'
    or md5((select p.prosrc from pg_proc p where p.oid='public.reverse_hotel_completion(uuid,integer,text,text,uuid)'::regprocedure))<>'dd4dd04865adfa2dc3ec83097e2b81a3'
    or md5((select p.prosrc from pg_proc p where p.oid='public.get_hotel_operations_snapshot_v2(date)'::regprocedure))<>'7dac53943e2f74f207de1cd36d5023fb'
    or (select p.provolatile from pg_proc p where p.oid='public.get_hotel_operations_snapshot_v2(date)'::regprocedure)<>'s' then
    raise exception 'STOP_DAYCARE_V1_FROZEN_HOTEL_BASELINE';
  end if;
end;
$preflight$;

select 'READY_TO_APPLY_DAYCARE_V1' status;
rollback;
