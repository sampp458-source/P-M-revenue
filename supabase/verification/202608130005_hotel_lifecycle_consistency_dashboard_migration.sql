-- GENERATED; do not edit or assemble by hand.
-- Production zorvcuskzemehblqdbfj; Clean QA wxbvwixoeczfvbqurdse is rejected.
-- Migration SHA-256: 5012670da85361cbfdccbf835722cd1f82065292a90f666a88c7113dbbc9aa03
begin;
select set_config('app.release_project_ref','zorvcuskzemehblqdbfj',true);
select set_config('app.release_migration_sha256','5012670da85361cbfdccbf835722cd1f82065292a90f666a88c7113dbbc9aa03',true);
do $binding$ begin
  if current_setting('app.release_project_ref',true) is distinct from 'zorvcuskzemehblqdbfj'
    or current_setting('app.release_project_ref',true)='wxbvwixoeczfvbqurdse'
    or current_setting('app.release_migration_sha256',true) is distinct from '5012670da85361cbfdccbf835722cd1f82065292a90f666a88c7113dbbc9aa03'
    or current_database()<>'postgres' or current_user<>'postgres'
    or to_regclass('hotel_qa.environment_guard') is not null then
    raise exception 'STOP_HOTEL_LIFECYCLE_PRODUCTION_BINDING';
  end if;
end; $binding$;
-- APPROVED_SOURCE_BODY_BEGIN: MIGRATION

do $$
begin
  if to_regprocedure(
      'public.update_checked_in_hotel_planned_checkout(uuid,integer,date,time without time zone,boolean,uuid)'
    ) is not null
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
end;
$$;

create table public.hotel_planned_checkout_requests (
  request_id uuid primary key,
  hotel_stay_id uuid not null references public.hotel_stays(id) on delete restrict,
  canonical_payload_hash text not null check (canonical_payload_hash ~ '^[0-9a-f]{32}$'),
  response jsonb null,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz null,
  constraint hotel_planned_checkout_requests_completion_check check (
    (response is null and completed_at is null)
    or (response is not null and completed_at is not null)
  )
);

alter table public.hotel_planned_checkout_requests enable row level security;
revoke all on table public.hotel_planned_checkout_requests
  from public, anon, authenticated, service_role;

create function public.sync_hotel_lifecycle_schedule_status_internal()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  event_kind_value text;
  schedule_status_value text;
  linked_event_count integer;
  root_request_id text;
begin
  if new.checked_in_at is not distinct from old.checked_in_at
    and new.checked_out_at is not distinct from old.checked_out_at then
    return new;
  end if;

  root_request_id := current_setting('app.operation_request_id', true);
  perform set_config('app.operation_request_id', '', true);

  if new.checked_in_at is distinct from old.checked_in_at then
    event_kind_value := 'check_in';
    schedule_status_value := case when new.checked_in_at is null then 'scheduled' else 'completed' end;

    select count(*)::integer into linked_event_count
    from public.hotel_stay_schedule_events event
    join public.operation_schedules schedule
      on schedule.id=event.operation_schedule_id
    where event.hotel_stay_id=new.id
      and event.event_kind=event_kind_value
      and event.archived_at is null
      and schedule.archived_at is null;
    if linked_event_count<>1 then
      raise exception 'Hotel check-in Calendar event 연결은 정확히 1건이어야 합니다.'
        using errcode='P0002';
    end if;

    update public.operation_schedules schedule
    set status=schedule_status_value,updated_by=new.updated_by
    from public.hotel_stay_schedule_events event
    where event.hotel_stay_id=new.id
      and event.event_kind=event_kind_value
      and event.archived_at is null
      and event.operation_schedule_id=schedule.id
      and schedule.archived_at is null
      and schedule.status is distinct from schedule_status_value;
  end if;

  if new.checked_out_at is distinct from old.checked_out_at then
    event_kind_value := 'check_out';
    schedule_status_value := case when new.checked_out_at is null then 'scheduled' else 'completed' end;

    select count(*)::integer into linked_event_count
    from public.hotel_stay_schedule_events event
    join public.operation_schedules schedule
      on schedule.id=event.operation_schedule_id
    where event.hotel_stay_id=new.id
      and event.event_kind=event_kind_value
      and event.archived_at is null
      and schedule.archived_at is null;
    if linked_event_count<>1 then
      raise exception 'Hotel check-out Calendar event 연결은 정확히 1건이어야 합니다.'
        using errcode='P0002';
    end if;

    update public.operation_schedules schedule
    set status=schedule_status_value,updated_by=new.updated_by
    from public.hotel_stay_schedule_events event
    where event.hotel_stay_id=new.id
      and event.event_kind=event_kind_value
      and event.archived_at is null
      and event.operation_schedule_id=schedule.id
      and schedule.archived_at is null
      and schedule.status is distinct from schedule_status_value;
  end if;

  perform set_config('app.operation_request_id',coalesce(root_request_id,''),true);
  return new;
end;
$$;

create trigger hotel_stays_calendar_lifecycle_sync
after update of checked_in_at,checked_out_at on public.hotel_stays
for each row execute function public.sync_hotel_lifecycle_schedule_status_internal();

create function public.update_checked_in_hotel_planned_checkout(
  p_hotel_stay_id uuid,
  p_expected_version integer,
  p_check_out_date date,
  p_check_out_time time,
  p_check_out_time_unspecified boolean,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid:=auth.uid();
  payload_hash_value text;
  existing_request public.hotel_planned_checkout_requests%rowtype;
  stay_row public.hotel_stays%rowtype;
  checkout_schedule public.operation_schedules%rowtype;
  capacity_row public.hotel_capacity_reservations%rowtype;
  allocation_row public.hotel_room_allocations%rowtype;
  occupancy_row public.hotel_physical_occupancies%rowtype;
  member_row public.hotel_physical_occupancy_members%rowtype;
  schedule_at timestamptz;
  capacity_until timestamptz;
  schedule_ends_at timestamptz;
  target_physical_until timestamptz;
  active_member_count integer;
  result_value jsonb;
  root_request_id text;
begin
  if actor_id is null or not public.is_active_operation_member() then
    raise exception '퇴실 예정 변경 권한이 없습니다.' using errcode='42501';
  end if;
  if p_hotel_stay_id is null or p_expected_version is null
    or p_check_out_date is null or p_request_id is null then
    raise exception '호텔 Stay, 기존 버전, 새 퇴실일, 요청 ID가 필요합니다.' using errcode='22023';
  end if;
  if not coalesce(p_check_out_time_unspecified,false) and p_check_out_time is null then
    raise exception '퇴실 시간이 확정된 경우 새 퇴실 시간이 필요합니다.' using errcode='22023';
  end if;

  payload_hash_value:=md5(jsonb_build_object(
    'checkOutDate',p_check_out_date,
    'checkOutTime',p_check_out_time,
    'checkOutTimeUnspecified',coalesce(p_check_out_time_unspecified,false),
    'hotelStayId',p_hotel_stay_id
  )::text);

  perform pg_advisory_xact_lock(hashtextextended('hotel-request:'||p_request_id::text,0));
  select * into existing_request
  from public.hotel_planned_checkout_requests
  where request_id=p_request_id for update;
  if found then
    if existing_request.hotel_stay_id<>p_hotel_stay_id
      or existing_request.canonical_payload_hash<>payload_hash_value then
      raise exception '동일 요청 ID가 다른 퇴실 예정 변경에 사용되었습니다.' using errcode='PT409';
    end if;
    if existing_request.response is null then
      raise exception '동일 퇴실 예정 변경 요청이 아직 처리 중입니다.' using errcode='PT409';
    end if;
    return existing_request.response;
  end if;

  insert into public.hotel_planned_checkout_requests(
    request_id,hotel_stay_id,canonical_payload_hash,created_by
  ) values (p_request_id,p_hotel_stay_id,payload_hash_value,actor_id);

  -- Shared Room RPCs lock Physical Occupancy before the member Stay. Preserve
  -- the same order here so planned-checkout changes cannot deadlock checkout.
  select member.* into member_row
  from public.hotel_physical_occupancy_members member
  where member.hotel_stay_id=p_hotel_stay_id
    and member.archived_at is null;
  if found then
    select * into occupancy_row
    from public.hotel_physical_occupancies occupancy
    where occupancy.id=member_row.occupancy_id for update;
  end if;

  select * into stay_row
  from public.hotel_stays stay
  where stay.id=p_hotel_stay_id for update;
  if not found or stay_row.archived_at is not null then
    raise exception '활성 호텔 예약을 확인할 수 없습니다.' using errcode='P0002';
  end if;
  if stay_row.version<>p_expected_version then
    raise exception '다른 사용자가 먼저 호텔 예약을 변경했습니다.' using errcode='PT409';
  end if;
  if stay_row.checked_in_at is null or stay_row.checked_out_at is not null then
    raise exception '입실 완료 후 퇴실 전인 Hotel Stay만 퇴실 예정일을 변경할 수 있습니다.' using errcode='22023';
  end if;

  if member_row.id is not null then
    select * into member_row
    from public.hotel_physical_occupancy_members member
    where member.id=member_row.id
      and member.occupancy_id=occupancy_row.id
      and member.hotel_stay_id=stay_row.id
      and member.archived_at is null
    for update;
  end if;
  if exists (
    select 1 from public.long_stay_contracts contract
    where contract.current_hotel_stay_id=stay_row.id
      and contract.archived_at is null
  ) then
    raise exception '장기호텔 퇴실 예정은 장기호텔 전용 기능에서 변경해 주세요.' using errcode='22023';
  end if;

  select schedule.* into checkout_schedule
  from public.hotel_stay_schedule_events event
  join public.operation_schedules schedule on schedule.id=event.operation_schedule_id
  where event.hotel_stay_id=stay_row.id
    and event.event_kind='check_out'
    and event.archived_at is null
    and schedule.archived_at is null
  for update of schedule;
  if not found then
    raise exception '연결된 퇴실 Calendar 일정을 확인할 수 없습니다.' using errcode='P0002';
  end if;
  if not public.can_manage_operation_schedule(checkout_schedule.id) then
    raise exception '퇴실 Calendar 일정 생성자 또는 담당자만 변경할 수 있습니다.' using errcode='42501';
  end if;

  schedule_at:=case when coalesce(p_check_out_time_unspecified,false)
    then p_check_out_date::timestamp at time zone 'Asia/Seoul'
    else (p_check_out_date::timestamp+p_check_out_time) at time zone 'Asia/Seoul'
  end;
  capacity_until:=case when coalesce(p_check_out_time_unspecified,false)
    then (p_check_out_date+1)::timestamp at time zone 'Asia/Seoul'
    else schedule_at
  end;
  schedule_ends_at:=case when coalesce(p_check_out_time_unspecified,false)
    then schedule_at+interval '1 day'
    else schedule_at+interval '1 hour'
  end;

  if capacity_until<=stay_row.checked_in_at or capacity_until<=statement_timestamp()
    or (not coalesce(p_check_out_time_unspecified,false) and schedule_at<=statement_timestamp()) then
    raise exception '새 퇴실 예정은 현재 시각과 실제 입실 시각보다 늦어야 합니다.' using errcode='22023';
  end if;

  if member_row.id is null then
    select * into capacity_row
    from public.hotel_capacity_reservations capacity
    where capacity.hotel_stay_id=stay_row.id
      and capacity.source_kind='stay'
      and capacity.archived_at is null for update;
    if not found or capacity_row.room_type_id is null then
      raise exception '활성 Hotel Capacity를 확인할 수 없습니다.' using errcode='P0002';
    end if;
    select * into allocation_row
    from public.hotel_room_allocations allocation
    where allocation.capacity_reservation_id=capacity_row.id
      and allocation.archived_at is null
    order by allocation.allocated_from desc,allocation.id desc
    limit 1 for update;
    if not found then
      raise exception '현재 사용 중인 호실 배정을 확인할 수 없습니다.' using errcode='P0002';
    end if;

    perform pg_advisory_xact_lock(hashtextextended('hotel-capacity:'||capacity_row.room_type_id::text,0));
    perform pg_advisory_xact_lock(hashtextextended('hotel-room:'||allocation_row.room_id::text,0));
    if capacity_until>capacity_row.reserved_until then
      perform public.assert_hotel_capacity_available(
        capacity_row.room_type_id,capacity_row.reserved_from,capacity_until,
        capacity_row.quantity,capacity_row.id
      );
      if exists (
        select 1 from public.hotel_room_allocations other_allocation
        where other_allocation.room_id=allocation_row.room_id
          and other_allocation.archived_at is null
          and other_allocation.id<>allocation_row.id
          and other_allocation.allocated_from<capacity_until
          and other_allocation.allocated_until>allocation_row.allocated_from
      ) then
        raise exception '해당 기간에 이 객실의 다음 예약이 있습니다.'
          using errcode='23P01';
      end if;
      perform public.assert_hotel_total_capacity_available(
        capacity_row.reserved_from,capacity_until,capacity_row.quantity,capacity_row.id
      );
    end if;
  else
    if occupancy_row.id is null or occupancy_row.status<>'active'
      or member_row.status<>'active' then
      raise exception '활성 공유 객실 member를 확인할 수 없습니다.' using errcode='P0002';
    end if;
    select * into capacity_row
    from public.hotel_capacity_reservations capacity
    where capacity.id=occupancy_row.capacity_reservation_id
      and capacity.source_kind='shared_occupancy'
      and capacity.archived_at is null for update;
    select * into allocation_row
    from public.hotel_room_allocations allocation
    where allocation.id=occupancy_row.room_allocation_id
      and allocation.capacity_reservation_id=capacity_row.id
      and allocation.archived_at is null for update;
    if capacity_row.id is null or allocation_row.id is null then
      raise exception '공유 객실 Physical Capacity/Allocation을 확인할 수 없습니다.' using errcode='P0002';
    end if;

    select count(*)::integer,max(case
      when member.hotel_stay_id=stay_row.id then capacity_until
      when schedule.time_unspecified then
        ((schedule.starts_at at time zone 'Asia/Seoul')::date+1)::timestamp at time zone 'Asia/Seoul'
      else schedule.starts_at
    end)
    into active_member_count,target_physical_until
    from public.hotel_physical_occupancy_members member
    join public.hotel_stay_schedule_events event
      on event.hotel_stay_id=member.hotel_stay_id
      and event.event_kind='check_out' and event.archived_at is null
    join public.operation_schedules schedule
      on schedule.id=event.operation_schedule_id and schedule.archived_at is null
    where member.occupancy_id=occupancy_row.id
      and member.status='active' and member.archived_at is null;
    if active_member_count<1 or target_physical_until is null
      or target_physical_until<=occupancy_row.occupied_from then
      raise exception '공유 객실 member 퇴실 예정 경계를 계산할 수 없습니다.' using errcode='P0002';
    end if;

    perform pg_advisory_xact_lock(hashtextextended('hotel-capacity:'||occupancy_row.room_type_id::text,0));
    perform pg_advisory_xact_lock(hashtextextended('hotel-room:'||occupancy_row.room_id::text,0));
    if target_physical_until>occupancy_row.occupied_until then
      perform public.assert_hotel_capacity_available(
        occupancy_row.room_type_id,occupancy_row.occupied_from,target_physical_until,1,capacity_row.id
      );
      if exists (
        select 1 from public.hotel_room_allocations other_allocation
        where other_allocation.room_id=occupancy_row.room_id
          and other_allocation.archived_at is null
          and other_allocation.id<>allocation_row.id
          and other_allocation.allocated_from<target_physical_until
          and other_allocation.allocated_until>occupancy_row.occupied_from
      ) then
        raise exception '해당 기간에 이 공유 객실의 다음 예약이 있습니다.'
          using errcode='23P01';
      end if;
      perform public.assert_hotel_total_capacity_available(
        occupancy_row.occupied_from,target_physical_until,1,capacity_row.id
      );
    end if;
  end if;

  perform set_config('app.operation_change_reason','입실 후 퇴실 예정 변경',true);
  root_request_id:=current_setting('app.operation_request_id',true);
  perform set_config('app.operation_request_id','',true);
  update public.operation_schedules
  set starts_at=schedule_at,ends_at=schedule_ends_at,
      time_unspecified=coalesce(p_check_out_time_unspecified,false),
      status='scheduled',updated_by=actor_id
  where id=checkout_schedule.id;
  perform set_config('app.operation_request_id',p_request_id::text,true);

  if member_row.id is null then
    update public.hotel_capacity_reservations
    set reserved_until=capacity_until,updated_by=actor_id
    where id=capacity_row.id;
    update public.hotel_room_allocations
    set allocated_until=capacity_until,updated_by=actor_id
    where id=allocation_row.id;
  elsif target_physical_until is distinct from occupancy_row.occupied_until then
    update public.hotel_capacity_reservations
    set reserved_until=target_physical_until,updated_by=actor_id
    where id=capacity_row.id;
    update public.hotel_room_allocations
    set allocated_until=target_physical_until,updated_by=actor_id
    where id=allocation_row.id;
    update public.hotel_physical_occupancies
    set occupied_until=target_physical_until,updated_by=actor_id
    where id=occupancy_row.id;
  end if;

  update public.hotel_stays
  set updated_by=actor_id
  where id=stay_row.id;

  result_value:=public.hotel_stay_json(stay_row.id);
  update public.hotel_planned_checkout_requests
  set response=result_value,completed_at=clock_timestamp()
  where request_id=p_request_id;
  perform set_config('app.operation_request_id',coalesce(root_request_id,''),true);
  return result_value;
end;
$$;

revoke all on function public.sync_hotel_lifecycle_schedule_status_internal()
  from public, anon, authenticated, service_role;
revoke all on function public.update_checked_in_hotel_planned_checkout(
  uuid,integer,date,time without time zone,boolean,uuid
) from public, anon;
grant execute on function public.update_checked_in_hotel_planned_checkout(
  uuid,integer,date,time without time zone,boolean,uuid
) to authenticated, service_role;

-- Existing Hotel-linked schedules are brought to the same lifecycle projection.
-- This is canonical repair DML only; no Hotel Stay, Capacity or Allocation changes.
do $$
declare
  backfill_actor uuid;
begin
  select membership.profile_id into backfill_actor
  from public.operation_memberships membership
  join public.profiles profile on profile.id=membership.profile_id
  where membership.role='owner' and membership.is_active
    and profile.role='admin' and profile.is_active
    and profile.account_status='active'
  order by membership.updated_at,membership.profile_id
  limit 1;
  if backfill_actor is null then
    raise exception 'STOP_HOTEL_LIFECYCLE_BACKFILL_ACTOR_MISSING';
  end if;

  perform set_config('request.jwt.claim.sub',backfill_actor::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object(
    'sub',backfill_actor,'role','authenticated'
  )::text,true);
  perform set_config('app.operation_change_reason','Hotel lifecycle Calendar 상태 정렬',true);
  perform set_config('app.operation_request_id','',true);

  update public.operation_schedules schedule
  set status=case event.event_kind
      when 'check_in' then case when stay.checked_in_at is null then 'scheduled' else 'completed' end
      when 'check_out' then case when stay.checked_out_at is null then 'scheduled' else 'completed' end
    end,
    updated_by=backfill_actor
  from public.hotel_stay_schedule_events event
  join public.hotel_stays stay on stay.id=event.hotel_stay_id
  where event.operation_schedule_id=schedule.id
    and event.event_kind in ('check_in','check_out')
    and event.archived_at is null
    and stay.archived_at is null
    and schedule.archived_at is null
    and schedule.status is distinct from case event.event_kind
      when 'check_in' then case when stay.checked_in_at is null then 'scheduled' else 'completed' end
      when 'check_out' then case when stay.checked_out_at is null then 'scheduled' else 'completed' end
    end;
end;
$$;

-- APPROVED_SOURCE_BODY_END: MIGRATION
commit;
