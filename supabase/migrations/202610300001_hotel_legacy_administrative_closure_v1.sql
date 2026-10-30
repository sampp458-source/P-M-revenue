-- Date-only administrative closure. No inferred actual checkout timestamp.
-- Target-limited; retains finite room history through the end of confirmed exit date.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $$ begin
 if current_user<>'postgres' or to_regprocedure('public.administratively_close_legacy_hotel_stay_v1(uuid,integer,text,text,uuid,boolean)') is not null then raise exception 'STOP_ADMIN_CLOSURE_ALREADY_INSTALLED_OR_ROLE'; end if;

 if (select md5(prosrc) from pg_proc where oid=to_regprocedure('complete_verified_daycare_check_out_v1(uuid,integer,timestamp with time zone,uuid,boolean)')) is distinct from '0ab77df751ddef2d4805701412df8d26' then raise exception 'STOP_ADMIN_CLOSURE_PREDECESSOR'; end if;

 if (select md5(prosrc) from pg_proc where oid=to_regprocedure('get_hotel_operations_snapshot(date)')) is distinct from '000665142e258d8ddf52843c7dba16e4' then raise exception 'STOP_ADMIN_CLOSURE_PREDECESSOR'; end if;

 if (select md5(prosrc) from pg_proc where oid=to_regprocedure('hotel_current_physical_rooms_internal()')) is distinct from '0e04f9124a1fe36f1f8a2a8cb8072807' then raise exception 'STOP_ADMIN_CLOSURE_PREDECESSOR'; end if;

 if (select md5(prosrc) from pg_proc where oid=to_regprocedure('hotel_history_individual_010(jsonb)')) is distinct from 'bbb68d23742f00a1e7045d4f46e86698' then raise exception 'STOP_ADMIN_CLOSURE_PREDECESSOR'; end if;

 if (select md5(prosrc) from pg_proc where oid=to_regprocedure('hotel_history_semantic_010(text,jsonb)')) is distinct from '918972afa05c7cf40223c79ecf0f26dc' then raise exception 'STOP_ADMIN_CLOSURE_PREDECESSOR'; end if;

 if (select md5(prosrc) from pg_proc where oid=to_regprocedure('hotel_legacy_current_physical_rooms_internal()')) is distinct from 'b1265f613bb552b393a83db026bb62d6' then raise exception 'STOP_ADMIN_CLOSURE_PREDECESSOR'; end if;

 if (select md5(prosrc) from pg_proc where oid=to_regprocedure('hotel_stay_json(uuid)')) is distinct from '08ed3a31f665205b44cd90b6c61a8241' then raise exception 'STOP_ADMIN_CLOSURE_PREDECESSOR'; end if;

 if (select md5(prosrc) from pg_proc where oid=to_regprocedure('record_verified_daycare_visit_v1(uuid,integer,timestamp with time zone,timestamp with time zone,uuid,boolean)')) is distinct from '9a79ff266f6d068e4ec1cf9e654516a6' then raise exception 'STOP_ADMIN_CLOSURE_PREDECESSOR'; end if;

 if (select md5(prosrc) from pg_proc where oid=to_regprocedure('get_hotel_historical_room_board(date)')) is distinct from '914bfb1c723c9ca3df16d44ce0092add' then raise exception 'STOP_ADMIN_CLOSURE_HISTORY_PREDECESSOR'; end if;
end $$;
alter table public.hotel_stays
 add column administrative_closed_on date,
 add column administrative_occupancy_until timestamptz,
 add column administrative_closed_at timestamptz,
 add column administrative_closed_by uuid references public.profiles(id) on delete restrict,
 add column administrative_closure_reason text,
 add column administrative_closure_evidence text,
 add column administrative_closure_request_id uuid unique,
 add column administrative_closure_payload_hash text;
alter table public.hotel_stays add constraint hotel_administrative_closure_complete check (
 (administrative_closed_on is null and administrative_occupancy_until is null and administrative_closed_at is null and administrative_closed_by is null and administrative_closure_reason is null and administrative_closure_evidence is null and administrative_closure_request_id is null and administrative_closure_payload_hash is null)
 or (administrative_closed_on is not null and administrative_occupancy_until is not null and administrative_closed_at is not null and administrative_closed_by is not null and nullif(btrim(administrative_closure_reason),'') is not null and nullif(btrim(administrative_closure_evidence),'') is not null and administrative_closure_request_id is not null and administrative_closure_payload_hash is not null and checked_in_at is not null and checked_out_at is null and checked_out_by is null and archived_at is null
 and administrative_occupancy_until=(administrative_closed_on+1)::timestamp at time zone 'Asia/Seoul'
 and checked_in_at<administrative_occupancy_until and administrative_occupancy_until<=administrative_closed_at));
comment on column public.hotel_stays.administrative_occupancy_until is 'Conservative EXCLUSIVE end of confirmed checkout DATE for conflict checks. NOT actual checkout time.';
create function public.guard_hotel_administrative_closure_v1() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare sid uuid;
begin
 if tg_table_name='hotel_stays' then
  if tg_op='UPDATE' and new.administrative_closed_on is not null and (new.checked_in_at is distinct from old.checked_in_at or new.checked_out_at is distinct from old.checked_out_at or new.dog_id is distinct from old.dog_id or not ((new.id='612d58e4-51e7-46f5-8d6a-618cfc804c22'::uuid and new.administrative_closed_on=date '2026-08-18') or (new.id='8da96be1-c798-48fb-8e25-0d9c9edc2865'::uuid and new.administrative_closed_on=date '2026-09-23'))) then raise exception '승인된 원본 및 날짜 보존 필요' using errcode='22023'; end if;
  if tg_op='DELETE' then raise exception '호텔 이력 삭제 금지' using errcode='22023'; end if;
  if old.administrative_closed_on is not null then raise exception '행정 종료 호텔 이력은 별도 승인 없이 변경할 수 없습니다.' using errcode='22023'; end if;
  if new.administrative_closed_on is not null and (auth.uid() is null or not public.is_admin() or not public.is_active_operation_member() or not public.can_operate_hotel() or new.administrative_closed_by is distinct from auth.uid() or nullif(current_setting('app.operation_request_id',true),'') is distinct from new.administrative_closure_request_id::text) then raise exception '관리자 행정 종료 권한이 필요합니다.' using errcode='42501'; end if;
 else
  if tg_op='UPDATE' then
   if tg_table_name='hotel_capacity_reservations' then sid:=old.hotel_stay_id;
   else select hotel_stay_id into sid from public.hotel_capacity_reservations where id=old.capacity_reservation_id; end if;
   if exists(select 1 from public.hotel_stays where id=sid and administrative_closed_on is not null) then raise exception '행정 종료 원본 연결은 변경할 수 없습니다.' using errcode='22023'; end if;
  end if;
  if tg_table_name='hotel_capacity_reservations' then
   if tg_op='DELETE' then sid:=old.hotel_stay_id; else sid:=new.hotel_stay_id; end if;
  else
   select hotel_stay_id into sid from public.hotel_capacity_reservations where id=case when tg_op='DELETE' then old.capacity_reservation_id else new.capacity_reservation_id end;
  end if;
  if exists(select 1 from public.hotel_stays where id=sid and administrative_closed_on is not null) then raise exception '행정 종료 호텔 배정 및 Capacity 이력은 변경할 수 없습니다.' using errcode='22023'; end if;
 end if;
 if tg_op='DELETE' then return old; end if; return new;
end $$;
revoke all on function public.guard_hotel_administrative_closure_v1() from public,anon,authenticated,service_role;
create trigger hotel_admin_closure_guard before update or delete on public.hotel_stays for each row execute function public.guard_hotel_administrative_closure_v1();
create trigger hotel_admin_closure_capacity_guard before insert or update or delete on public.hotel_capacity_reservations for each row execute function public.guard_hotel_administrative_closure_v1();
create trigger hotel_admin_closure_allocation_guard before insert or update or delete on public.hotel_room_allocations for each row execute function public.guard_hotel_administrative_closure_v1();

create function public.hotel_administrative_extension_proven_v1(p jsonb,a jsonb,c jsonb,e jsonb) returns boolean language plpgsql immutable set search_path=public,pg_temp as $$
declare s jsonb:=p->'stay'; root jsonb; ca jsonb;
begin
 if s->>'administrative_closed_on' is null or s->>'checked_out_at' is not null or s->>'id' not in('612d58e4-51e7-46f5-8d6a-618cfc804c22','8da96be1-c798-48fb-8e25-0d9c9edc2865') then return false; end if;
 select value into strict root from jsonb_array_elements(p->'audits') where value->>'entity_type'='hotel_stays' and value->>'entity_id'=s->>'id' and value->>'request_id'=s->>'administrative_closure_request_id';
 if root->>'changed_by' is distinct from s->>'administrative_closed_by' or root->'before_data'->>'administrative_closed_on' is not null or root->'after_data'->>'administrative_closed_on' is distinct from s->>'administrative_closed_on' or root->'after_data'->>'checked_out_at' is not null or root->'before_data'->>'checked_in_at' is distinct from s->>'checked_in_at' then return false; end if;
 if root->>'created_at' is distinct from e->>'created_at' or root->>'changed_by' is distinct from e->>'changed_by' or root->>'change_reason' is distinct from e->>'change_reason' or e->'after_data'->>'allocated_until' is distinct from s->>'administrative_occupancy_until' then return false; end if;
 if (public.hotel_history_semantic_010('hotel_room_allocations',e->'before_data')-'allocated_until') is distinct from (public.hotel_history_semantic_010('hotel_room_allocations',e->'after_data')-'allocated_until') then return false; end if;
 select value into strict ca from jsonb_array_elements(p->'audits') where value->>'entity_type'='hotel_capacity_reservations' and value->>'entity_id'=c->>'id' and value->>'created_at'=root->>'created_at' and value->>'changed_by'=root->>'changed_by' and value->>'change_reason'=root->>'change_reason';
 return ca->'after_data'->>'reserved_until'=s->>'administrative_occupancy_until' and (public.hotel_history_semantic_010('hotel_capacity_reservations',ca->'before_data')-'reserved_until')=(public.hotel_history_semantic_010('hotel_capacity_reservations',ca->'after_data')-'reserved_until');
exception when no_data_found or too_many_rows then return false;
end $$;
revoke all on function public.hotel_administrative_extension_proven_v1(jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.complete_verified_daycare_check_out_v1(p_operation_schedule_id uuid, p_expected_version integer, p_checked_out_at timestamp with time zone, p_request_id uuid, p_confirmed boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  actor uuid := auth.uid();
  state_row public.daycare_operation_states%rowtype;
  schedule_row public.operation_schedules%rowtype;
  capacity_row public.hotel_capacity_reservations%rowtype;
  allocation_row public.hotel_room_allocations%rowtype;
  payload jsonb;
  result jsonb;
  reason text := '실제 퇴실 시각 확인 · 미퇴실 기록 정리';
begin
  if actor is null or not public.is_active_operation_member() or not public.can_operate_hotel() then
    raise exception using errcode='42501', message='미퇴실 기록을 처리할 권한이 없습니다.';
  end if;
  if p_confirmed is distinct from true or p_checked_out_at is null or not isfinite(p_checked_out_at)
    or p_checked_out_at > statement_timestamp() or p_request_id is null or p_expected_version is null then
    raise exception using errcode='22023', message='확인한 실제 퇴실 시각, 버전과 요청 ID가 필요합니다. 미래 시각은 사용할 수 없습니다.';
  end if;
  if not public.can_manage_operation_schedule(p_operation_schedule_id) then
    raise exception using errcode='42501', message='해당 일정의 퇴실 기록을 처리할 권한이 없습니다.';
  end if;
  payload := jsonb_build_object('scheduleId',p_operation_schedule_id,'expectedVersion',p_expected_version,
    'checkedOutAt',p_checked_out_at,'confirmed',p_confirmed);
  -- Same request lock/hash contract as the existing daycare commands.
  perform pg_advisory_xact_lock(hashtextextended('daycare-request:'||p_request_id::text,0));
  select * into state_row from public.daycare_operation_states where operation_schedule_id=p_operation_schedule_id for update;
  if not found then raise exception using errcode='P0002',message='Daycare 예약을 확인할 수 없습니다.'; end if;
  if public.daycare_request_replayed_internal(p_operation_schedule_id,p_request_id,'verified_check_out',payload) then
    return jsonb_build_object('operationScheduleId',state_row.operation_schedule_id,'version',state_row.version,
      'checkedOutAt',state_row.checked_out_at,'recordedAt',state_row.updated_at);
  end if;
  select * into schedule_row from public.operation_schedules where id=p_operation_schedule_id for update;
  if not found or schedule_row.archived_at is not null then raise exception using errcode='P0002',message='활성 Daycare 일정을 확인할 수 없습니다.'; end if;
  if state_row.version is distinct from p_expected_version then raise exception using errcode='PT409',message='다른 사용자가 먼저 Daycare 예약을 변경했습니다.'; end if;
  if state_row.schedule_version is distinct from schedule_row.version then raise exception using errcode='PT409',message='VERSION_DESYNC: 일정과 예약 버전을 확인해 주세요.'; end if;
  if state_row.lifecycle_status<>'checked_in' or state_row.checked_out_at is not null or state_row.checked_in_at is null
    or schedule_row.status<>'scheduled' then
    raise exception using errcode='22023',message='실제 입실 중인 Daycare만 퇴실 기록을 확정할 수 있습니다.';
  end if;
  if not isfinite(state_row.checked_in_at) or p_checked_out_at <= state_row.checked_in_at then raise exception using errcode='22023',message='실제 퇴실은 실제 입실보다 늦어야 합니다.'; end if;

  select * into strict capacity_row from public.hotel_capacity_reservations
    where daycare_schedule_id=p_operation_schedule_id and source_kind='daycare' and archived_at is null for update;
  if not isfinite(capacity_row.reserved_from) or not isfinite(capacity_row.reserved_until) then
    raise exception using errcode='22023',message='Daycare Capacity의 유한한 이용 구간을 확인해 주세요.';
  end if;
  if capacity_row.hotel_stay_id is not null or capacity_row.physical_occupancy_id is not null
    or capacity_row.shared_room_group_id is not null or capacity_row.quantity<>1 then
    raise exception using errcode='22023',message='단독 Daycare Capacity 연결을 확인해 주세요.';
  end if;
  -- Match the existing Capacity -> room advisory-lock order before any writes.
  perform public.assert_hotel_total_capacity_available(capacity_row.reserved_from,greatest(capacity_row.reserved_until,p_checked_out_at),1,capacity_row.id);
  perform public.assert_hotel_capacity_available(capacity_row.room_type_id,capacity_row.reserved_from,
    greatest(capacity_row.reserved_until,p_checked_out_at),1,capacity_row.id);
  if (select count(*) from public.hotel_room_allocations where capacity_reservation_id=capacity_row.id and archived_at is null)<>1 then
    raise exception using errcode='22023',message='여러 배정 구간이 있는 기록은 별도 이력 확인이 필요합니다.';
  end if;
  select * into strict allocation_row from public.hotel_room_allocations
    where capacity_reservation_id=capacity_row.id and archived_at is null for update;
  if not isfinite(allocation_row.allocated_from) or not isfinite(allocation_row.allocated_until) then
    raise exception using errcode='22023',message='Daycare 객실 배정의 유한한 이용 구간을 확인해 주세요.';
  end if;
  if allocation_row.allocated_from>state_row.checked_in_at or capacity_row.reserved_from>state_row.checked_in_at then
    raise exception using errcode='22023',message='실제 입실을 포함하는 배정 이력을 확인해 주세요.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('hotel-room:'||allocation_row.room_id::text,0));

  -- Retain all history; only an audit-proven entry reversal is non-occupying.
  if exists(select 1 from public.hotel_room_allocations a
    where a.room_id=allocation_row.room_id and a.capacity_reservation_id<>capacity_row.id
      and a.allocated_from<greatest(allocation_row.allocated_until,p_checked_out_at)
      and a.allocated_until>allocation_row.allocated_from
      and not public.daycare_reversed_allocation_proven_v1(a.id)) then
    raise exception using errcode='23P01',message='실제 퇴실 구간과 다른 객실 배정 이력이 겹칩니다. 이력을 확인해 주세요.';
  end if;
  -- Actual stays/daycare may outlive a planned allocation. Clip preceding segments at the next segment,
  -- and retain the actual checkout bound on the last segment; never equate planned end with actual exit.
  if exists(
    with segments as (
      select a.*, lag(a.allocated_from) over(partition by a.capacity_reservation_id order by a.allocated_from,a.id) prev_from, lead(a.allocated_from) over(partition by a.capacity_reservation_id order by a.allocated_from,a.id) next_from
      from public.hotel_room_allocations a where a.archived_at is null and a.capacity_reservation_id<>capacity_row.id
    ), actual as (
      select a.room_id, case when a.prev_from is null then s.checked_in_at else greatest(a.allocated_from,s.checked_in_at) end lo,
        least(coalesce(a.next_from,'infinity'::timestamptz),coalesce(s.checked_out_at,s.administrative_occupancy_until,'infinity'::timestamptz),
          coalesce(public.daycare_closed_long_stay_bound_v1(a.id),'infinity'::timestamptz)) hi
      from segments a join public.hotel_capacity_reservations c on c.id=a.capacity_reservation_id
      join public.hotel_stays s on s.id=c.hotel_stay_id where s.checked_in_at is not null
      union all
      select a.room_id,case when a.prev_from is null then d.checked_in_at else greatest(a.allocated_from,d.checked_in_at) end,
        least(coalesce(a.next_from,'infinity'::timestamptz),coalesce(d.checked_out_at,'infinity'::timestamptz))
      from segments a join public.hotel_capacity_reservations c on c.id=a.capacity_reservation_id
      join public.daycare_operation_states d on d.operation_schedule_id=c.daycare_schedule_id where d.checked_in_at is not null
      union all
      select o.room_id,o.occupied_from,case when o.status='completed'
        and exists(select 1 from public.hotel_physical_occupancy_members m where m.occupancy_id=o.id and m.left_at is not null)
        and not exists(select 1 from public.hotel_physical_occupancy_members m where m.occupancy_id=o.id and m.archived_at is null and (m.status='active' or m.left_at is null)) then coalesce(
        (select max(m.left_at) from public.hotel_physical_occupancy_members m where m.occupancy_id=o.id),
        o.occupied_until,'infinity'::timestamptz) else 'infinity'::timestamptz end
      from public.hotel_physical_occupancies o where o.capacity_reservation_id is distinct from capacity_row.id
    ) select 1 from actual where room_id=allocation_row.room_id and lo<p_checked_out_at and hi>state_row.checked_in_at
  ) then
    raise exception using errcode='23P01',message='실제 퇴실 구간에 다른 점유 기록이 있거나 종료 근거가 부족합니다. 점유 이력을 확인해 주세요.';
  end if;

  perform set_config('app.operation_change_reason',reason,true);
  perform set_config('app.operation_request_id',p_request_id::text,true);
  if p_checked_out_at>capacity_row.reserved_until then
    update public.hotel_capacity_reservations set reserved_until=p_checked_out_at,updated_by=actor where id=capacity_row.id;
  end if;
  perform public.assert_hotel_room_allocation_available(allocation_row.room_id,capacity_row.id,allocation_row.allocated_from,
    greatest(allocation_row.allocated_until,p_checked_out_at),allocation_row.id);
  perform set_config('app.daycare_orchestration','on',true);
  result:=public.set_operation_schedule_status(p_operation_schedule_id,schedule_row.version,'completed',reason,
    public.daycare_child_request_id_internal(p_request_id,'schedule-complete'));
  perform set_config('app.daycare_orchestration','off',true);
  perform set_config('app.operation_change_reason',reason,true);
  perform set_config('app.operation_request_id',p_request_id::text,true);
  update public.daycare_operation_states set lifecycle_status='completed',schedule_version=(result->>'version')::integer,
    checked_out_at=p_checked_out_at,checked_out_by=actor,updated_by=actor,
    request_history=request_history||jsonb_build_object(p_request_id::text,jsonb_build_object('operationKind','verified_check_out',
      'payloadHash',public.daycare_payload_hash_internal(payload)))
    where operation_schedule_id=p_operation_schedule_id;
  -- Historical extension happens after actual checkout, inside this same atomic command.
  -- Existing triggers remain enabled; current-room acquisition is not misclassified as a historical update.
  if p_checked_out_at>allocation_row.allocated_until then
    update public.hotel_room_allocations set allocated_until=p_checked_out_at,updated_by=actor where id=allocation_row.id;
  end if;
  select * into state_row from public.daycare_operation_states where operation_schedule_id=p_operation_schedule_id;
  return jsonb_build_object('operationScheduleId',state_row.operation_schedule_id,'version',state_row.version,
    'checkedOutAt',state_row.checked_out_at,'recordedAt',state_row.updated_at);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_hotel_operations_snapshot(p_local_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  day_start timestamptz;
  day_end timestamptz;
  selected_instant timestamptz;
  result jsonb;
  physical_rows jsonb;
  physical_stays jsonb;
begin
  if not public.is_active_operation_member() then
    raise exception '호텔 운영 조회 권한이 없습니다.' using errcode = '42501';
  end if;
  if p_local_date is null then
    raise exception '조회 날짜가 필요합니다.' using errcode = '22023';
  end if;

  day_start := p_local_date::timestamp at time zone 'Asia/Seoul';
  day_end := (p_local_date + 1)::timestamp at time zone 'Asia/Seoul';
  selected_instant := case when p_local_date = (now() at time zone 'Asia/Seoul')::date
    then now() else day_start + interval '12 hours' end;

  select jsonb_build_object(
    'date', p_local_date,
    'roomTypes', coalesce(jsonb_agg(jsonb_build_object(
      'id', room_type.id,
      'code', room_type.code,
      'name', room_type.name,
      'activeRooms', (select count(*) from public.hotel_rooms room
        where room.room_type_id = room_type.id and room.is_active and room.archived_at is null),
      'reservedPeak', coalesce((
        with points as (
          select greatest(capacity.reserved_from, day_start) point_at, capacity.quantity::integer delta
          from public.hotel_capacity_reservations capacity
          where capacity.room_type_id = room_type.id and capacity.archived_at is null
            and capacity.reserved_from < day_end and capacity.reserved_until > day_start
          union all
          select least(capacity.reserved_until, day_end), -capacity.quantity::integer
          from public.hotel_capacity_reservations capacity
          where capacity.room_type_id = room_type.id and capacity.archived_at is null
            and capacity.reserved_from < day_end and capacity.reserved_until > day_start
        ), deltas as (select point_at, sum(delta) delta from points group by point_at),
        running as (select sum(delta) over (order by point_at) occupancy from deltas)
        select max(occupancy) from running
      ), 0),
      'checkedInNow', (select count(*) from public.hotel_capacity_reservations capacity
        join public.hotel_stays stay on stay.id = capacity.hotel_stay_id
        where capacity.room_type_id = room_type.id and capacity.archived_at is null
          and stay.archived_at is null and stay.checked_in_at is not null
          and stay.checked_out_at is null and stay.administrative_closed_on is null and capacity.reserved_from <= selected_instant
          and capacity.reserved_until > selected_instant),
      'allocatedNow', (select count(distinct allocation.room_id)
        from public.hotel_room_allocations allocation
        join public.hotel_capacity_reservations capacity on capacity.id = allocation.capacity_reservation_id
        where capacity.room_type_id = room_type.id and capacity.archived_at is null
          and allocation.archived_at is null and allocation.allocated_from <= selected_instant
          and allocation.allocated_until > selected_instant),
      'reservedNow', (select coalesce(sum(capacity.quantity), 0)
        from public.hotel_capacity_reservations capacity
        where capacity.room_type_id = room_type.id and capacity.archived_at is null
          and capacity.reserved_from <= selected_instant
          and capacity.reserved_until > selected_instant),
      'unassignedNow', greatest(0,
        (select coalesce(sum(capacity.quantity), 0)
          from public.hotel_capacity_reservations capacity
          where capacity.room_type_id = room_type.id and capacity.archived_at is null
            and capacity.reserved_from <= selected_instant
            and capacity.reserved_until > selected_instant)
        - (select count(distinct allocation.capacity_reservation_id)
          from public.hotel_room_allocations allocation
          join public.hotel_capacity_reservations capacity on capacity.id = allocation.capacity_reservation_id
          where capacity.room_type_id = room_type.id and capacity.archived_at is null
            and allocation.archived_at is null and allocation.allocated_from <= selected_instant
            and allocation.allocated_until > selected_instant)
      ),
      'physicallyEmpty', greatest(0,
        (select count(*) from public.hotel_rooms room
          where room.room_type_id = room_type.id and room.is_active and room.archived_at is null)
        - (select count(distinct allocation.room_id)
          from public.hotel_room_allocations allocation
          join public.hotel_capacity_reservations capacity on capacity.id = allocation.capacity_reservation_id
          where capacity.room_type_id = room_type.id and capacity.archived_at is null
            and allocation.archived_at is null and allocation.allocated_from <= selected_instant
            and allocation.allocated_until > selected_instant)
      )
    ) order by room_type.sort_order, room_type.code), '[]'::jsonb),
    'rooms', coalesce((select jsonb_agg(jsonb_build_object(
      'id', room.id,
      'name', room.name,
      'roomTypeId', room_type_row.id,
      'roomTypeCode', room_type_row.code,
      'roomTypeName', room_type_row.name,
      'isActive', room.is_active,
      'sortOrder', room.sort_order
    ) order by room_type_row.sort_order, room.sort_order, room.name)
      from public.hotel_rooms room
      join public.hotel_room_types room_type_row on room_type_row.id = room.room_type_id
      where room.archived_at is null
        and room_type_row.archived_at is null), '[]'::jsonb),
    'settings', (select jsonb_build_object(
      'id', settings.id,
      'version', settings.version,
      'defaultCheckInTime', settings.default_check_in_time::text,
      'defaultCheckOutTime', settings.default_check_out_time::text,
      'timezone', settings.timezone
    )
      from public.hotel_operation_settings settings
      where settings.singleton_key = 'default'
        and settings.archived_at is null
      order by settings.created_at, settings.id
      limit 1),
    'stays', coalesce((select jsonb_agg(public.hotel_stay_json(stay.id)
      order by capacity.reserved_from, stay.created_at)
      from public.hotel_stays stay
      join public.hotel_capacity_reservations capacity on capacity.hotel_stay_id = stay.id
      where stay.archived_at is null and capacity.archived_at is null
        and ((capacity.reserved_from < day_end and capacity.reserved_until > day_start)
          or (p_local_date=(statement_timestamp() at time zone 'Asia/Seoul')::date
            and stay.checked_in_at<=statement_timestamp() and stay.checked_out_at is null and stay.administrative_closed_on is null
            and (stay.checked_in_at>=timestamptz '2026-09-25 00:00:00+09' or exists (select 1 from public.hotel_stay_schedule_events ev
              join public.operation_schedules os on os.id=ev.operation_schedule_id
              where ev.hotel_stay_id=stay.id and ev.event_kind='check_out'
                and ev.archived_at is null and os.archived_at is null
                and os.starts_at>=timestamptz '2026-09-25 00:00:00+09' and os.starts_at<day_end))))), '[]'::jsonb),
    'unassignedFuture', coalesce((select jsonb_agg(public.hotel_stay_json(stay.id)
      order by capacity.reserved_from, stay.created_at)
      from public.hotel_stays stay
      join public.hotel_capacity_reservations capacity on capacity.hotel_stay_id = stay.id
      where stay.archived_at is null and capacity.archived_at is null
        and capacity.reserved_until > day_start
        and not exists (select 1 from public.hotel_room_allocations allocation
          where allocation.capacity_reservation_id = capacity.id
            and allocation.archived_at is null)), '[]'::jsonb)
  ) into result
  from public.hotel_room_types room_type
  where room_type.is_active and room_type.archived_at is null;

  if p_local_date=(statement_timestamp() at time zone 'Asia/Seoul')::date then
    result := jsonb_set(result,'{roomTypes}',coalesce((
      select jsonb_agg(item || jsonb_build_object(
        'checkedInNow',n.occupied,'allocatedNow',n.occupied,
        'physicallyEmpty',greatest(0,(item->>'activeRooms')::integer-n.occupied)) order by ordinal)
      from jsonb_array_elements(result->'roomTypes') with ordinality as items(item,ordinal)
      cross join lateral (select count(distinct p.room_id)::integer occupied
        from public.hotel_current_physical_rooms_internal() p
        join public.hotel_rooms room on room.id=p.room_id
        where room.room_type_id=(item->>'id')::uuid) n
    ),'[]'::jsonb));
    select coalesce(jsonb_agg(to_jsonb(p)),'[]'::jsonb) into physical_rows
      from public.hotel_current_physical_rooms_internal() p;
    -- Merge current physical members even after the entire planned day has expired.
    -- Never merge current membership into historical/future selected-date payloads.
    with candidates as (
      select item,ordinal from jsonb_array_elements(result->'stays') with ordinality items(item,ordinal)
      union all
      select public.hotel_stay_json(s.id),jsonb_array_length(result->'stays')+row_number() over(order by s.id)
      from public.hotel_stays s
      where s.administrative_closed_on is null and (exists(select 1 from jsonb_array_elements(physical_rows) p where p->>'stay_id'=s.id::text)
        or exists(select 1 from public.hotel_legacy_physical_anchors_internal() a where a.stay_id=s.id))
        and not exists(select 1 from jsonb_array_elements(result->'stays') item where item->>'id'=s.id::text)
    )
    select coalesce(jsonb_agg(item || jsonb_build_object('currentPhysicalRoom',jsonb_build_object(
      'date',p_local_date,'observedAt',statement_timestamp(),'allocation',resolved.allocation,
      'state',case when resolved.allocation is not null then 'occupied'
        when exists(select 1 from public.long_stay_absence_events e
          where e.hotel_stay_id=(item->>'id')::uuid and e.archived_at is null
            and e.event_type='leave' and e.is_open and e.inventory_mode='release_room'
            and e.occurred_at<=statement_timestamp()) then 'released' else 'unresolved' end
    )) order by ordinal),'[]'::jsonb) into physical_stays
    from candidates
    left join lateral (
      select jsonb_build_object('id',a.id,'roomId',r.id,'roomName',r.name,'roomTypeId',r.room_type_id,
        'allocatedFrom',a.allocated_from,'allocatedUntil',a.allocated_until,
        'assignmentReason',a.assignment_reason,'version',a.version) allocation
      from jsonb_array_elements(physical_rows) p
      join public.hotel_rooms r on r.id=(p->>'room_id')::uuid
      join lateral (select x.* from public.hotel_room_allocations x
        where x.capacity_reservation_id=(p->>'capacity_id')::uuid and x.room_id=r.id
          and x.archived_at is null and x.allocated_from<=statement_timestamp()
        order by x.allocated_from desc,x.id desc limit 1) a on true
      where p->>'stay_id'=item->>'id'
        and (select count(*) from jsonb_array_elements(physical_rows) same_stay
          where same_stay->>'stay_id'=item->>'id')=1
    ) resolved on true;
    result := jsonb_set(result,'{stays}',physical_stays);
    result := result || jsonb_build_object('physicalOccupiedRooms',
      (select count(distinct p->>'room_id') from jsonb_array_elements(physical_rows) p));
  end if;
  return result;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.hotel_current_physical_rooms_internal()
 RETURNS TABLE(room_id uuid, capacity_id uuid, stay_id uuid, occupancy_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT a.room_id,c.id,s.id,NULL::uuid
  FROM public.hotel_stays s
  JOIN public.hotel_capacity_reservations c ON c.hotel_stay_id=s.id AND c.archived_at IS NULL
  CROSS JOIN LATERAL (
    SELECT x.room_id FROM public.hotel_room_allocations x
    WHERE x.capacity_reservation_id=c.id AND x.archived_at IS NULL
      AND x.allocated_from<=statement_timestamp()
    ORDER BY x.allocated_from DESC,x.id DESC LIMIT 1
  ) a
  WHERE s.archived_at IS NULL AND s.checked_in_at>=timestamptz '2026-09-25 00:00:00+09' AND s.checked_in_at<=statement_timestamp() AND s.checked_out_at IS NULL AND s.administrative_closed_on IS NULL
    AND NOT EXISTS (SELECT 1 FROM public.hotel_physical_occupancy_members m
      WHERE m.hotel_stay_id=s.id AND m.archived_at IS NULL AND m.status='active')
  UNION ALL
  SELECT o.room_id,o.capacity_reservation_id,s.id,o.id
  FROM public.hotel_physical_occupancies o
  JOIN public.hotel_physical_occupancy_members m ON m.occupancy_id=o.id AND m.archived_at IS NULL AND m.status='active'
  JOIN public.hotel_stays s ON s.id=m.hotel_stay_id
  WHERE o.archived_at IS NULL AND o.status='active'
    AND s.archived_at IS NULL AND s.checked_in_at>=timestamptz '2026-09-25 00:00:00+09' AND s.checked_in_at<=statement_timestamp() AND s.checked_out_at IS NULL AND s.administrative_closed_on IS NULL
  UNION ALL
  SELECT a.room_id,c.id,NULL::uuid,NULL::uuid
  FROM public.daycare_operation_states d
  JOIN public.hotel_capacity_reservations c ON c.daycare_schedule_id=d.operation_schedule_id AND c.archived_at IS NULL
  CROSS JOIN LATERAL (SELECT x.room_id FROM public.hotel_room_allocations x
    WHERE x.capacity_reservation_id=c.id AND x.archived_at IS NULL AND x.allocated_from<=statement_timestamp()
    ORDER BY x.allocated_from DESC,x.id DESC LIMIT 1) a
  WHERE d.lifecycle_status='checked_in'
  UNION ALL
  SELECT * FROM public.hotel_legacy_current_physical_rooms_internal()
$function$
;

CREATE OR REPLACE FUNCTION public.hotel_history_individual_010(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE s jsonb:=p->'stay'; audits jsonb:=p->'audits'; a jsonb; c jsonb; x jsonb;
 prev jsonb; leave_row jsonb; return_row jsonb; receipt jsonb; room jsonb;
 segments jsonb:='[]'; absences jsonb:='[]'; reason text:='AUDIT_CHAIN_UNPROVEN';
 lo timestamptz; hi timestamptz; required_until timestamptz; start_at timestamptz; end_at timestamptz; leave_at timestamptz; return_at timestamptz;
 cursor_at timestamptz; piece_start timestamptz; piece_end timestamptz; last_absence_end timestamptz;
 longstay boolean:=p->>'kind'='longstay'; matched integer; first_segment boolean:=true;
BEGIN
 lo:=(s->>'checked_in_at')::timestamptz;
 hi:=least(coalesce((s->>'checked_out_at')::timestamptz,(s->>'administrative_occupancy_until')::timestamptz,'infinity'),(p->>'asOf')::timestamptz);
 required_until:=least(hi,coalesce((p->>'windowUntil')::timestamptz,hi));
 IF lo IS NULL OR hi<=lo OR s->>'archived_at' IS NOT NULL THEN
  RETURN jsonb_build_object('reasonCode','ACTUAL_STAY_INTERVAL_UNPROVEN','segments','[]'::jsonb); END IF;
 IF NOT public.hotel_history_chain_010('hotel_stays',s,audits) THEN RAISE EXCEPTION 'unproven' USING errcode='P0010'; END IF;
 -- Rewritten actual check-in/out, including reversal, is outside this release's supported paths.
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(audits) e WHERE e->>'entity_type'='hotel_stays' AND e->>'entity_id'=s->>'id' AND e->'after_data' ? 'created_at'
 AND ((e->'after_data'->>'dog_id' IS DISTINCT FROM s->>'dog_id')
 OR e->'after_data'->>'archived_at' IS NOT NULL
 OR (e->'before_data'->>'checked_in_at' IS NOT NULL AND e->'before_data'->>'checked_in_at' IS DISTINCT FROM e->'after_data'->>'checked_in_at')
 OR (e->'before_data'->>'checked_out_at' IS NOT NULL AND e->'before_data'->>'checked_out_at' IS DISTINCT FROM e->'after_data'->>'checked_out_at'))) THEN
 reason:='UNSUPPORTED_REVERSAL'; RAISE EXCEPTION 'unproven' USING errcode='P0010'; END IF;

 IF longstay AND s->>'checked_out_at' IS NOT NULL THEN RETURN jsonb_build_object('segments','[]'::jsonb,'reasonCode','UNSUPPORTED_LONGSTAY_COMPLETION'); END IF;
 IF longstay THEN
  reason:='ABSENCE_PROVENANCE_UNPROVEN';
  -- Only the observed keep -> release -> different-room return path is enabled.
  IF jsonb_array_length(p->'absences')<>2 THEN RAISE EXCEPTION 'unproven' USING errcode='P0010'; END IF;
  SELECT value INTO leave_row FROM jsonb_array_elements(p->'absences') WHERE value->>'event_type'='leave';
  SELECT value INTO return_row FROM jsonb_array_elements(p->'absences') WHERE value->>'event_type'='return';
  IF leave_row IS NULL OR return_row IS NULL OR leave_row->>'archived_at' IS NOT NULL OR return_row->>'archived_at' IS NOT NULL
   OR return_row->>'paired_leave_event_id' IS DISTINCT FROM leave_row->>'id'
   OR leave_row->>'hotel_stay_id' IS DISTINCT FROM s->>'id' OR return_row->>'hotel_stay_id' IS DISTINCT FROM s->>'id'
   OR leave_row->>'long_stay_contract_id' IS DISTINCT FROM return_row->>'long_stay_contract_id'
   OR leave_row->>'inventory_mode' IS DISTINCT FROM 'release_room' OR leave_row->>'is_open' IS DISTINCT FROM 'false'
   OR leave_row->>'returned_room_id' IS NOT DISTINCT FROM leave_row->>'previous_room_id' THEN RAISE EXCEPTION 'unproven' USING errcode='P0010'; END IF;
  leave_at:=(leave_row->>'occurred_at')::timestamptz; return_at:=(return_row->>'occurred_at')::timestamptz;
  IF leave_at<=lo OR return_at<=leave_at THEN RAISE EXCEPTION 'unproven' USING errcode='P0010'; END IF;
  SELECT count(*) INTO matched FROM jsonb_array_elements(p->'receipts') r
   WHERE r->>'long_stay_contract_id'=leave_row->>'long_stay_contract_id' AND r->'canonical_payload'->>'contractId'=leave_row->>'long_stay_contract_id' AND r->>'absence_event_id'=leave_row->>'id' AND r->>'request_id'=leave_row->>'request_id'
   AND r->>'operation_kind' IN ('start_absence','start_absence_inventory_v1')
   AND (r->'canonical_payload'->>'leftAt')::timestamptz=leave_at
   AND coalesce(r->'canonical_payload'->>'inventoryMode','keep_room')='keep_room';
  IF matched<>1 THEN RAISE EXCEPTION 'unproven' USING errcode='P0010'; END IF;
  SELECT count(*) INTO matched FROM jsonb_array_elements(p->'receipts') r
   WHERE r->>'long_stay_contract_id'=leave_row->>'long_stay_contract_id' AND r->'canonical_payload'->>'contractId'=leave_row->>'long_stay_contract_id' AND r->>'absence_event_id'=leave_row->>'id' AND r->>'operation_kind'='release_room_during_absence_inventory_v1';
  IF matched<>1 THEN RAISE EXCEPTION 'unproven' USING errcode='P0010'; END IF;
  SELECT count(*) INTO matched FROM jsonb_array_elements(p->'receipts') r
   WHERE r->>'long_stay_contract_id'=leave_row->>'long_stay_contract_id' AND r->'canonical_payload'->>'contractId'=leave_row->>'long_stay_contract_id' AND r->>'absence_event_id'=return_row->>'id' AND r->>'request_id'=return_row->>'request_id'
   AND r->>'operation_kind'='complete_absence_inventory_v1'
   AND (r->'canonical_payload'->>'returnedAt')::timestamptz=return_at
   AND r->'canonical_payload'->>'roomId'=leave_row->>'returned_room_id';
  IF matched<>1 THEN RAISE EXCEPTION 'unproven' USING errcode='P0010'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p->'receipts') r WHERE r->>'operation_kind' ~ '(reverse|cancel|complete_check_out)') THEN RAISE EXCEPTION 'unproven' USING errcode='P0010'; END IF;
  SELECT value INTO a FROM jsonb_array_elements(p->'allocations') WHERE value->>'id'=leave_row->>'released_allocation_id';
  SELECT value INTO c FROM jsonb_array_elements(p->'capacities') WHERE value->>'id'=leave_row->>'released_capacity_id';
  IF a IS NULL OR c IS NULL OR a->>'capacity_reservation_id' IS DISTINCT FROM c->>'id'
   OR a->>'room_id' IS DISTINCT FROM leave_row->>'previous_room_id'
   OR (a->>'allocated_until')::timestamptz IS DISTINCT FROM (c->>'reserved_until')::timestamptz
   OR (a->>'allocated_until')::timestamptz<leave_at
   OR (a->>'allocated_until')::timestamptz>(leave_row->>'guarantee_from')::timestamptz THEN RAISE EXCEPTION 'unproven' USING errcode='P0010'; END IF;
  SELECT value INTO a FROM jsonb_array_elements(p->'allocations') WHERE value->>'id'=leave_row->>'returned_allocation_id';
  IF a IS NULL OR a->>'room_id' IS DISTINCT FROM leave_row->>'returned_room_id'
   OR a->>'capacity_reservation_id' IS DISTINCT FROM leave_row->>'return_capacity_id'
   OR (a->>'allocated_from')::timestamptz IS DISTINCT FROM return_at THEN RAISE EXCEPTION 'unproven' USING errcode='P0010'; END IF;
  absences:=jsonb_build_array(jsonb_build_object('from',leave_at,'until',return_at));
 END IF;

 cursor_at:=lo;
 FOR a IN SELECT value FROM jsonb_array_elements(p->'allocations')
 WHERE (value->>'allocated_from')::timestamptz<required_until AND (value->>'allocated_until')::timestamptz>lo
 ORDER BY (value->>'allocated_from')::timestamptz,value->>'id' LOOP
  reason:='AUDIT_CHAIN_UNPROVEN';
  IF NOT public.hotel_history_chain_010('hotel_room_allocations',a,audits) THEN RAISE EXCEPTION 'unproven' USING errcode='P0010'; END IF;
  SELECT value INTO c FROM jsonb_array_elements(p->'capacities') WHERE value->>'id'=a->>'capacity_reservation_id';
  IF c IS NULL OR NOT public.hotel_history_chain_010('hotel_capacity_reservations',c,audits) THEN RAISE EXCEPTION 'unproven' USING errcode='P0010'; END IF;
  reason:='UNSUPPORTED_TRANSITION';
  IF c->>'source_kind' IS DISTINCT FROM 'stay' OR c->>'hotel_stay_id' IS DISTINCT FROM s->>'id' OR c->>'physical_occupancy_id' IS NOT NULL
   OR c->>'quantity' IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'unproven' USING errcode='P0010'; END IF;
  -- A cancelled/reassigned allocation overlapping actual use is not evidence of actual occupancy.
  -- Long Stay inventory release is the sole explicitly proven archive exception here.
  IF (a->>'archived_at' IS NOT NULL OR c->>'archived_at' IS NOT NULL)
   AND NOT (longstay AND a->>'id'=leave_row->>'released_allocation_id' AND c->>'id'=leave_row->>'released_capacity_id') THEN
   reason:='PREASSIGNMENT_OR_ARCHIVE_UNPROVEN'; RAISE EXCEPTION 'unproven' USING errcode='P0010'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(audits) e WHERE e->>'entity_type'='hotel_room_allocations' AND e->>'entity_id'=a->>'id' AND e->'after_data' ? 'created_at'
   AND ((e->'after_data'->>'room_id' IS DISTINCT FROM a->>'room_id')
    OR ((CASE WHEN longstay THEN
       (e->'after_data'->>'allocated_until')::timestamptz > (e->'before_data'->>'allocated_until')::timestamptz
      ELSE (e->'after_data'->>'allocated_until')::timestamptz > (e->'before_data'->>'allocated_until')::timestamptz
       OR (e->>'change_reason'='입실 후 퇴실 예정 변경' AND (e->'after_data'->>'allocated_until')::timestamptz IS DISTINCT FROM (e->'before_data'->>'allocated_until')::timestamptz)
      END) AND (longstay OR NOT (public.hotel_history_planned_adjustment_010(p,a,c,e) or public.hotel_administrative_extension_proven_v1(p,a,c,e))))
    OR (e->'before_data'->>'archived_at' IS NOT NULL AND e->'after_data'->>'archived_at' IS NULL)
    OR (e->'after_data'->>'allocated_from')::timestamptz IS DISTINCT FROM (a->>'allocated_from')::timestamptz
    OR e->'after_data'->>'request_id' IS DISTINCT FROM a->>'request_id'
    OR e->'after_data'->>'capacity_reservation_id' IS DISTINCT FROM c->>'id')) THEN RAISE EXCEPTION 'unproven' USING errcode='P0010'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(audits) e WHERE e->>'entity_type'='hotel_capacity_reservations' AND e->>'entity_id'=c->>'id' AND e->'after_data' ? 'created_at'
   AND (e->'after_data'->>'source_kind' IS DISTINCT FROM 'stay' OR e->'after_data'->>'hotel_stay_id' IS DISTINCT FROM s->>'id' OR e->'after_data'->>'physical_occupancy_id' IS NOT NULL)) THEN RAISE EXCEPTION 'unproven' USING errcode='P0010'; END IF;
  start_at:=greatest(lo,(a->>'allocated_from')::timestamptz); end_at:=least(hi,(a->>'allocated_until')::timestamptz);
  IF (c->>'reserved_from')::timestamptz>start_at OR (c->>'reserved_until')::timestamptz<end_at THEN
   reason:='CAPACITY_ENVELOPE_UNPROVEN'; RAISE EXCEPTION 'unproven' USING errcode='P0010'; END IF;
  IF longstay AND start_at<return_at AND end_at>leave_at THEN end_at:=least(end_at,leave_at); END IF;
  IF start_at>=end_at THEN CONTINUE; END IF;
  SELECT value INTO room FROM jsonb_array_elements(p->'rooms') WHERE value->>'roomId'=a->>'room_id';
  IF room IS NULL THEN reason:='ROOM_CANDIDATE_CONFLICT'; RAISE EXCEPTION 'unproven' USING errcode='P0010'; END IF;
  IF longstay AND cursor_at=leave_at THEN cursor_at:=return_at; END IF;
  IF start_at<>cursor_at THEN reason:='INTERVAL_NOT_COVERED'; RAISE EXCEPTION 'unproven' USING errcode='P0010'; END IF;
  IF NOT first_segment AND NOT (longstay AND a->>'id'=leave_row->>'returned_allocation_id' AND start_at=return_at) THEN
   reason:='MOVE_PROVENANCE_UNPROVEN';
   IF (prev->>'allocated_until')::timestamptz<>start_at OR prev->>'room_id'=a->>'room_id'
    OR prev->>'capacity_reservation_id' IS DISTINCT FROM a->>'capacity_reservation_id' OR a->>'request_id' IS NULL
    OR (SELECT value->>'roomTypeId' FROM jsonb_array_elements(p->'rooms') WHERE value->>'roomId'=prev->>'room_id') IS DISTINCT FROM room->>'roomTypeId'
    OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(audits) e WHERE e->>'entity_type'='hotel_room_allocations' AND e->>'entity_id'=prev->>'id'
     AND (e->'after_data'->>'allocated_until')::timestamptz=start_at
     AND (e->'before_data'->>'allocated_until')::timestamptz>start_at)
    OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(audits) e WHERE e->>'entity_type'='hotel_stays' AND e->>'entity_id'=s->>'id'
     AND e->>'request_id'=a->>'request_id' AND e->'after_data' ? 'created_at'
     AND e->'after_data'->>'checked_in_at' IS NOT NULL
     AND public.hotel_history_semantic_010('hotel_stays',e->'before_data')=public.hotel_history_semantic_010('hotel_stays',e->'after_data')
     AND e->'after_data'->>'id'=s->>'id' AND e->'before_data'->>'id'=s->>'id') THEN RAISE EXCEPTION 'unproven' USING errcode='P0010'; END IF;
  END IF;
  segments:=segments||jsonb_build_array(jsonb_build_object('allocationId',a->'id','roomId',a->'room_id','usedFrom',start_at,'usedUntil',end_at,
   'startEvent',CASE WHEN start_at=lo THEN 'check_in' WHEN longstay AND start_at=return_at THEN 'returned' ELSE 'moved_in' END,
   'endEvent',CASE WHEN end_at=(s->>'checked_out_at')::timestamptz THEN 'check_out' WHEN end_at=(s->>'administrative_occupancy_until')::timestamptz THEN 'administratively_closed' WHEN longstay AND end_at=leave_at THEN 'left_for_absence' ELSE 'moved_out' END));
  prev:=a; cursor_at:=end_at; first_segment:=false;
 END LOOP;
 IF longstay AND cursor_at=leave_at THEN cursor_at:=least(return_at,hi); END IF;
 IF cursor_at<required_until THEN reason:='INTERVAL_NOT_COVERED'; RAISE EXCEPTION 'unproven' USING errcode='P0010'; END IF;
 IF cursor_at>=hi AND hi=(s->>'checked_out_at')::timestamptz AND prev->>'id' IS DISTINCT FROM s->>'checkout_previous_allocation_id' THEN
  reason:='CHECKOUT_LINK_UNPROVEN'; RAISE EXCEPTION 'unproven' USING errcode='P0010'; END IF;
 RETURN jsonb_build_object('segments',segments,'reasonCode',null);
EXCEPTION WHEN SQLSTATE 'P0010' THEN RETURN jsonb_build_object('segments',CASE WHEN reason='MOVE_PROVENANCE_UNPROVEN' THEN segments ELSE '[]'::jsonb END,'reasonCode',reason,'affectedFrom',CASE WHEN reason='MOVE_PROVENANCE_UNPROVEN' THEN cursor_at ELSE lo END);
 WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow OR numeric_value_out_of_range THEN
 RETURN jsonb_build_object('segments','[]'::jsonb,'reasonCode','MALFORMED_EVIDENCE');
END $function$
;

CREATE OR REPLACE FUNCTION public.hotel_history_semantic_010(p_kind text, p_row jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE keys text[]; required_keys text[]; k text; v jsonb; result jsonb:='{}';
BEGIN
 keys:=CASE p_kind
 WHEN 'hotel_stays' THEN ARRAY['id','dog_id','checked_in_at','checked_out_at','checkout_previous_allocation_id','checkout_previous_allocation_until','checkout_previous_reserved_until','archived_at','administrative_closed_on','administrative_occupancy_until','administrative_closed_at','administrative_closed_by','administrative_closure_reason','administrative_closure_evidence','administrative_closure_request_id','administrative_closure_payload_hash']
 WHEN 'hotel_room_allocations' THEN ARRAY['id','capacity_reservation_id','room_id','allocated_from','allocated_until','request_id','archived_at']
 WHEN 'hotel_capacity_reservations' THEN ARRAY['id','hotel_stay_id','physical_occupancy_id','shared_room_group_id','source_kind','room_type_id','quantity','reserved_from','reserved_until','archived_at'] END;
 required_keys:=CASE p_kind WHEN 'hotel_stays' THEN ARRAY['id','dog_id'] WHEN 'hotel_room_allocations' THEN ARRAY['id','capacity_reservation_id','room_id','allocated_from','allocated_until'] WHEN 'hotel_capacity_reservations' THEN ARRAY['id','source_kind','quantity','reserved_from','reserved_until'] END;
 IF keys IS NULL OR EXISTS(SELECT 1 FROM unnest(required_keys) required_field(key) WHERE p_row->>required_field.key IS NULL) THEN RETURN NULL; END IF;
 FOREACH k IN ARRAY keys LOOP
  v:=coalesce(p_row->k,'null');
  IF v<>'null'::jsonb AND k ~ '(_at|_from|_until)$' THEN
   v:=to_jsonb(extract(epoch FROM (p_row->>k)::timestamptz)::text);
  END IF;
  result:=result||jsonb_build_object(k,v);
 END LOOP;
 RETURN result;
EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow OR invalid_datetime_format THEN RETURN NULL;
END $function$
;

CREATE OR REPLACE FUNCTION public.hotel_legacy_current_physical_rooms_internal()
 RETURNS TABLE(room_id uuid, capacity_id uuid, stay_id uuid, occupancy_id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE s record; anchor jsonb; anchors jsonb; ret record; active_shared record;
  anchor_count integer; shared_count integer; seed uuid; cap uuid; resolved uuid;
BEGIN
  SELECT coalesce(jsonb_agg(to_jsonb(a)),'[]'::jsonb) INTO anchors
  FROM public.hotel_legacy_physical_anchors_internal() a;
  FOR s IN SELECT x.* FROM public.hotel_stays x
    WHERE x.archived_at IS NULL AND x.checked_in_at<timestamptz '2026-09-25 00:00:00+09'
      AND x.checked_out_at IS NULL AND x.administrative_closed_on IS NULL LOOP
    seed:=NULL;cap:=NULL;anchor:=NULL;
    SELECT count(*) INTO anchor_count FROM jsonb_array_elements(anchors) a WHERE a->>'stay_id'=s.id::text;
    IF anchor_count=1 THEN
      SELECT a INTO anchor FROM jsonb_array_elements(anchors) a WHERE a->>'stay_id'=s.id::text;
      seed:=(anchor->>'allocation_id')::uuid;cap:=(anchor->>'capacity_id')::uuid;
    END IF;
    -- A release is explicit even when its future return capacity already exists.
    IF EXISTS(SELECT 1 FROM public.long_stay_absence_events e
      WHERE e.hotel_stay_id=s.id AND e.archived_at IS NULL AND e.event_type='leave'
        AND e.inventory_mode='release_room' AND e.is_open
        AND e.occurred_at<=statement_timestamp()) THEN CONTINUE; END IF;
    -- Follow the latest completed actual return with its canonical paired leave.
    SELECT l.returned_allocation_id,l.return_capacity_id INTO ret
    FROM public.long_stay_absence_events r
    JOIN public.long_stay_absence_events l ON l.id=r.paired_leave_event_id
    JOIN public.long_stay_contracts k ON k.id=r.long_stay_contract_id
    JOIN public.hotel_room_allocations a ON a.id=l.returned_allocation_id
    JOIN public.hotel_capacity_reservations c ON c.id=l.return_capacity_id
    WHERE r.hotel_stay_id=s.id AND l.hotel_stay_id=s.id AND k.current_hotel_stay_id=s.id
      AND k.archived_at IS NULL AND k.status='active'
      AND r.event_type='return' AND l.event_type='leave' AND l.inventory_mode='release_room'
      AND NOT l.is_open AND l.inventory_transition_status='room_returned'
      AND r.archived_at IS NULL AND l.archived_at IS NULL
      AND r.long_stay_contract_id=l.long_stay_contract_id
      AND r.occurred_at>=timestamptz '2026-09-25 00:00:00+09'
      AND r.occurred_at<=statement_timestamp() AND r.occurred_at>l.occurred_at
      AND a.capacity_reservation_id=c.id AND a.room_id=l.returned_room_id
      AND a.allocated_from=r.occurred_at AND a.archived_at IS NULL
      AND c.hotel_stay_id=s.id AND c.archived_at IS NULL AND c.source_kind='stay'
    ORDER BY r.occurred_at DESC,r.id LIMIT 1;
    IF FOUND THEN seed:=ret.returned_allocation_id;cap:=ret.return_capacity_id; END IF;
    IF seed IS NULL THEN CONTINUE; END IF;
    SELECT count(*) INTO shared_count
    FROM public.hotel_physical_occupancy_members m
    WHERE m.hotel_stay_id=s.id AND m.archived_at IS NULL AND m.status='active';
    IF shared_count>0 THEN
      IF shared_count<>1 THEN CONTINUE; END IF;
      SELECT o.* INTO active_shared FROM public.hotel_physical_occupancy_members m
      JOIN public.hotel_physical_occupancies o ON o.id=m.occupancy_id
      JOIN public.family_shared_room_groups g ON g.id=o.shared_room_group_id
      JOIN public.hotel_rooms r ON r.id=o.room_id
      JOIN public.hotel_room_types t ON t.id=r.room_type_id
      JOIN public.hotel_capacity_reservations c ON c.id=o.capacity_reservation_id
      WHERE m.hotel_stay_id=s.id AND m.archived_at IS NULL AND m.status='active'
        AND o.archived_at IS NULL AND o.status='active' AND o.occupied_from<=statement_timestamp()
        AND g.archived_at IS NULL AND g.status='allocated' AND t.code='DELUXE'
        AND c.archived_at IS NULL AND c.source_kind='shared_occupancy' AND c.quantity=1
        AND c.physical_occupancy_id=o.id
        AND (c.shared_room_group_id IS NULL OR c.shared_room_group_id=g.id);
      IF FOUND THEN
        room_id:=active_shared.room_id;capacity_id:=active_shared.capacity_reservation_id;
        stay_id:=s.id;occupancy_id:=active_shared.id;RETURN NEXT;
      END IF;
      CONTINUE;
    END IF;
    IF NOT EXISTS(SELECT 1 FROM public.hotel_capacity_reservations c
      WHERE c.id=cap AND c.hotel_stay_id=s.id AND c.archived_at IS NULL AND c.source_kind='stay') THEN CONTINUE; END IF;
    IF seed=(anchor->>'allocation_id')::uuid AND NOT EXISTS(
      SELECT 1 FROM public.hotel_room_allocations a WHERE a.id=seed
        AND a.room_id=(anchor->>'room_id')::uuid
        AND a.allocated_from=(anchor->>'allocated_from')::timestamptz
    ) THEN CONTINUE; END IF;
    resolved:=public.hotel_physical_allocation_successor_internal(seed,cap);
    IF resolved IS NULL THEN CONTINUE; END IF;
    SELECT a.room_id INTO room_id FROM public.hotel_room_allocations a WHERE a.id=resolved;
    capacity_id:=cap;stay_id:=s.id;occupancy_id:=NULL;RETURN NEXT;
  END LOOP;
END $function$
;

CREATE OR REPLACE FUNCTION public.hotel_stay_json(p_hotel_stay_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select jsonb_build_object(
    'id', stay.id,
    'dogId', stay.dog_id,
    'dogName', dog.name,
    'customerId', dog.customer_id,
    'customerName', customer.name,
    'customerPhone', customer.phone,
    'version', stay.version,
    'requestId', stay.request_id,
    'checkedInAt', stay.checked_in_at,
    'checkedInBy', stay.checked_in_by,
    'checkedOutAt', stay.checked_out_at,
    'checkedOutBy', stay.checked_out_by,
    'administrativeClosure',case when stay.administrative_closed_on is null then null else jsonb_build_object('status','administratively_closed','confirmedCheckoutDate',stay.administrative_closed_on,'actualCheckoutTimeKnown',false,'occupancyUntil',stay.administrative_occupancy_until,'processedAt',stay.administrative_closed_at,'processedBy',stay.administrative_closed_by,'reason',stay.administrative_closure_reason,'evidence',stay.administrative_closure_evidence,'requestId',stay.administrative_closure_request_id) end,
    'createdBy', stay.created_by,
    'createdAt', stay.created_at,
    'updatedAt', stay.updated_at,
    'archivedAt', stay.archived_at,

    'capacityReservation',
    jsonb_build_object(
      'id', capacity.id,
      'roomTypeId', room_type.id,
      'roomTypeCode', room_type.code,
      'roomTypeName', room_type.name,
      'reservedFrom', capacity.reserved_from,
      'reservedUntil', capacity.reserved_until,
      'quantity', capacity.quantity
    ),

    'scheduleEvents',
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'eventKind', event.event_kind,
          'schedule',
          public.operation_schedule_json(
            event.operation_schedule_id
          )
        )
        order by case event.event_kind
          when 'check_in' then 1
          else 2
        end
      )
      from public.hotel_stay_schedule_events event
      where event.hotel_stay_id = stay.id
        and event.archived_at is null
    ), '[]'::jsonb),

    'roomAllocations',
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', allocation.id,
          'roomId', room.id,
          'roomName', room.name,
          'roomTypeId', room.room_type_id,
          'allocatedFrom', allocation.allocated_from,
          'allocatedUntil', allocation.allocated_until,
          'assignmentReason', allocation.assignment_reason,
          'version', allocation.version
        )
        order by allocation.allocated_from, allocation.id
      )
      from public.hotel_room_allocations allocation
      join public.hotel_rooms room
        on room.id = allocation.room_id
      where allocation.capacity_reservation_id = capacity.id
        and allocation.archived_at is null
    ), '[]'::jsonb)
  )
  from public.hotel_stays stay
  join public.dogs dog
    on dog.id = stay.dog_id
  left join public.customers customer
    on customer.id = dog.customer_id
  left join public.hotel_capacity_reservations capacity
    on capacity.hotel_stay_id = stay.id
   and capacity.archived_at is null
  left join public.hotel_room_types room_type
    on room_type.id = capacity.room_type_id
  where stay.id = p_hotel_stay_id
    and public.is_active_operation_member();
$function$
;

CREATE OR REPLACE FUNCTION public.record_verified_daycare_visit_v1(p_operation_schedule_id uuid, p_expected_version integer, p_checked_in_at timestamp with time zone, p_checked_out_at timestamp with time zone, p_request_id uuid, p_confirmed boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  actor uuid := auth.uid();
  state_row public.daycare_operation_states%rowtype;
  schedule_row public.operation_schedules%rowtype;
  capacity_row public.hotel_capacity_reservations%rowtype;
  allocation_row public.hotel_room_allocations%rowtype;
  payload jsonb;
  result jsonb;
  reason text := '확인된 실제 이용 시각 사후 기록';
begin
  if actor is null or not public.is_active_operation_member() or not public.can_operate_hotel() then
    raise exception using errcode='42501', message='미퇴실 기록을 처리할 권한이 없습니다.';
  end if;
  if p_confirmed is distinct from true or p_checked_out_at is null or not isfinite(p_checked_out_at)
    or p_checked_out_at > statement_timestamp() or p_request_id is null or p_expected_version is null then
    raise exception using errcode='22023', message='확인한 실제 퇴실 시각, 버전과 요청 ID가 필요합니다. 미래 시각은 사용할 수 없습니다.';
  end if;
  if not public.can_manage_operation_schedule(p_operation_schedule_id) then
    raise exception using errcode='42501', message='해당 일정의 퇴실 기록을 처리할 권한이 없습니다.';
  end if;
  payload := jsonb_build_object('scheduleId',p_operation_schedule_id,'expectedVersion',p_expected_version,
    'checkedInAt',p_checked_in_at,'checkedOutAt',p_checked_out_at,'confirmed',p_confirmed);
  -- Same request lock/hash contract as the existing daycare commands.
  perform pg_advisory_xact_lock(hashtextextended('daycare-request:'||p_request_id::text,0));
  select * into state_row from public.daycare_operation_states where operation_schedule_id=p_operation_schedule_id for update;
  if not found then raise exception using errcode='P0002',message='Daycare 예약을 확인할 수 없습니다.'; end if;
  if public.daycare_request_replayed_internal(p_operation_schedule_id,p_request_id,'retrospective_visit',payload) then
    return public.daycare_reservation_json(p_operation_schedule_id);
  end if;
  select * into schedule_row from public.operation_schedules where id=p_operation_schedule_id for update;
  if not found or schedule_row.archived_at is not null then raise exception using errcode='P0002',message='활성 Daycare 일정을 확인할 수 없습니다.'; end if;
  if state_row.version is distinct from p_expected_version then raise exception using errcode='PT409',message='다른 사용자가 먼저 Daycare 예약을 변경했습니다.'; end if;
  if state_row.schedule_version is distinct from schedule_row.version then raise exception using errcode='PT409',message='VERSION_DESYNC: 일정과 예약 버전을 확인해 주세요.'; end if;
  if state_row.lifecycle_status<>'scheduled' or state_row.checked_in_at is not null or state_row.checked_out_at is not null or schedule_row.status<>'scheduled' then raise exception '미처리 예약만 사후 이용 기록이 가능합니다.' using errcode='22023'; end if;
  if p_checked_in_at is null or not isfinite(p_checked_in_at) or p_checked_in_at>=p_checked_out_at or p_checked_in_at>statement_timestamp() or (p_checked_in_at at time zone 'Asia/Seoul')::date<>(schedule_row.starts_at at time zone 'Asia/Seoul')::date or p_checked_in_at>=schedule_row.ends_at then raise exception '확인된 실제 입퇴실 시각의 날짜와 순서를 확인해 주세요.' using errcode='22023'; end if;


  select * into strict capacity_row from public.hotel_capacity_reservations
    where daycare_schedule_id=p_operation_schedule_id and source_kind='daycare' and archived_at is null for update;
  if not isfinite(capacity_row.reserved_from) or not isfinite(capacity_row.reserved_until) then
    raise exception using errcode='22023',message='Daycare Capacity의 유한한 이용 구간을 확인해 주세요.';
  end if;
  if capacity_row.hotel_stay_id is not null or capacity_row.physical_occupancy_id is not null
    or capacity_row.shared_room_group_id is not null or capacity_row.quantity<>1 then
    raise exception using errcode='22023',message='단독 Daycare Capacity 연결을 확인해 주세요.';
  end if;
  -- Match the existing Capacity -> room advisory-lock order before any writes.
  perform public.assert_hotel_total_capacity_available(capacity_row.reserved_from,greatest(capacity_row.reserved_until,p_checked_out_at),1,capacity_row.id);
  perform public.assert_hotel_capacity_available(capacity_row.room_type_id,capacity_row.reserved_from,
    greatest(capacity_row.reserved_until,p_checked_out_at),1,capacity_row.id);
  if (select count(*) from public.hotel_room_allocations where capacity_reservation_id=capacity_row.id and archived_at is null)<>1 then
    raise exception using errcode='22023',message='여러 배정 구간이 있는 기록은 별도 이력 확인이 필요합니다.';
  end if;
  select * into strict allocation_row from public.hotel_room_allocations
    where capacity_reservation_id=capacity_row.id and archived_at is null for update;
  if not isfinite(allocation_row.allocated_from) or not isfinite(allocation_row.allocated_until) then
    raise exception using errcode='22023',message='Daycare 객실 배정의 유한한 이용 구간을 확인해 주세요.';
  end if;
  if allocation_row.allocated_from>p_checked_in_at or capacity_row.reserved_from>p_checked_in_at then
    raise exception using errcode='22023',message='실제 입실을 포함하는 배정 이력을 확인해 주세요.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('hotel-room:'||allocation_row.room_id::text,0));

  -- Retain all history; only an audit-proven entry reversal is non-occupying.
  if exists(select 1 from public.hotel_room_allocations a
    where a.room_id=allocation_row.room_id and a.capacity_reservation_id<>capacity_row.id
      and a.allocated_from<greatest(allocation_row.allocated_until,p_checked_out_at)
      and a.allocated_until>allocation_row.allocated_from
      and not public.daycare_reversed_allocation_proven_v1(a.id)) then
    raise exception using errcode='23P01',message='실제 퇴실 구간과 다른 객실 배정 이력이 겹칩니다. 이력을 확인해 주세요.';
  end if;
  -- Actual stays/daycare may outlive a planned allocation. Clip preceding segments at the next segment,
  -- and retain the actual checkout bound on the last segment; never equate planned end with actual exit.
  if exists(
    with segments as (
      select a.*, lag(a.allocated_from) over(partition by a.capacity_reservation_id order by a.allocated_from,a.id) prev_from, lead(a.allocated_from) over(partition by a.capacity_reservation_id order by a.allocated_from,a.id) next_from
      from public.hotel_room_allocations a where a.archived_at is null and a.capacity_reservation_id<>capacity_row.id
    ), actual as (
      select a.room_id, case when a.prev_from is null then s.checked_in_at else greatest(a.allocated_from,s.checked_in_at) end lo,
        least(coalesce(a.next_from,'infinity'::timestamptz),coalesce(s.checked_out_at,s.administrative_occupancy_until,'infinity'::timestamptz),
          coalesce(public.daycare_closed_long_stay_bound_v1(a.id),'infinity'::timestamptz)) hi
      from segments a join public.hotel_capacity_reservations c on c.id=a.capacity_reservation_id
      join public.hotel_stays s on s.id=c.hotel_stay_id where s.checked_in_at is not null
      union all
      select a.room_id,case when a.prev_from is null then d.checked_in_at else greatest(a.allocated_from,d.checked_in_at) end,
        least(coalesce(a.next_from,'infinity'::timestamptz),coalesce(d.checked_out_at,'infinity'::timestamptz))
      from segments a join public.hotel_capacity_reservations c on c.id=a.capacity_reservation_id
      join public.daycare_operation_states d on d.operation_schedule_id=c.daycare_schedule_id where d.checked_in_at is not null
      union all
      select o.room_id,o.occupied_from,case when o.status='completed'
        and exists(select 1 from public.hotel_physical_occupancy_members m where m.occupancy_id=o.id and m.left_at is not null)
        and not exists(select 1 from public.hotel_physical_occupancy_members m where m.occupancy_id=o.id and m.archived_at is null and (m.status='active' or m.left_at is null)) then coalesce(
        (select max(m.left_at) from public.hotel_physical_occupancy_members m where m.occupancy_id=o.id),
        o.occupied_until,'infinity'::timestamptz) else 'infinity'::timestamptz end
      from public.hotel_physical_occupancies o where o.capacity_reservation_id is distinct from capacity_row.id
    ) select 1 from actual where room_id=allocation_row.room_id and lo<p_checked_out_at and hi>p_checked_in_at
  ) then
    raise exception using errcode='23P01',message='실제 퇴실 구간에 다른 점유 기록이 있거나 종료 근거가 부족합니다. 점유 이력을 확인해 주세요.';
  end if;

  perform set_config('app.operation_change_reason',reason,true);
  perform set_config('app.operation_request_id',p_request_id::text,true);
  if p_checked_out_at>capacity_row.reserved_until then
    update public.hotel_capacity_reservations set reserved_until=p_checked_out_at,updated_by=actor where id=capacity_row.id;
  end if;
  perform public.assert_hotel_room_allocation_available(allocation_row.room_id,capacity_row.id,allocation_row.allocated_from,
    greatest(allocation_row.allocated_until,p_checked_out_at),allocation_row.id);
  perform set_config('app.daycare_orchestration','on',true);
  result:=public.set_operation_schedule_status(p_operation_schedule_id,schedule_row.version,'completed',reason,
    public.daycare_child_request_id_internal(p_request_id,'schedule-complete'));
  perform set_config('app.daycare_orchestration','off',true);
  perform set_config('app.operation_change_reason',reason,true);
  perform set_config('app.operation_request_id',p_request_id::text,true);
  update public.daycare_operation_states set lifecycle_status='completed',schedule_version=(result->>'version')::integer,
    checked_in_at=p_checked_in_at,checked_in_by=actor,checked_out_at=p_checked_out_at,checked_out_by=actor,updated_by=actor,
    request_history=request_history||jsonb_build_object(p_request_id::text,jsonb_build_object('operationKind','retrospective_visit',
      'payloadHash',public.daycare_payload_hash_internal(payload)))
    where operation_schedule_id=p_operation_schedule_id;
  -- Historical extension happens after actual checkout, inside this same atomic command.
  -- Existing triggers remain enabled; current-room acquisition is not misclassified as a historical update.
  if p_checked_out_at>allocation_row.allocated_until then
    update public.hotel_room_allocations set allocated_until=p_checked_out_at,updated_by=actor where id=allocation_row.id;
  end if;
  select * into state_row from public.daycare_operation_states where operation_schedule_id=p_operation_schedule_id;
  return public.daycare_reservation_json(p_operation_schedule_id);
end;
$function$
;

create function public.get_legacy_hotel_administrative_closure_targets_v1() returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if auth.uid() is null or not public.is_admin() or not public.is_active_operation_member() or not public.can_operate_hotel() then raise exception '관리자 호텔 권한이 필요합니다.' using errcode='42501'; end if;
 return (select jsonb_agg(jsonb_build_object('id',s.id,'dogId',s.dog_id,'dogName',d.name,'version',s.version,'checkedInAt',s.checked_in_at,'checkedOutAt',s.checked_out_at,'confirmedDate',v.day,'administrativeClosure',public.hotel_stay_json(s.id)->'administrativeClosure','capacity',(select to_jsonb(c) from public.hotel_capacity_reservations c where c.hotel_stay_id=s.id and c.archived_at is null),'allocations',(select coalesce(jsonb_agg(to_jsonb(a)),'[]') from public.hotel_room_allocations a join public.hotel_capacity_reservations c on c.id=a.capacity_reservation_id where c.hotel_stay_id=s.id)) order by v.day)
 from (values('612d58e4-51e7-46f5-8d6a-618cfc804c22'::uuid,date '2026-08-18'),('8da96be1-c798-48fb-8e25-0d9c9edc2865'::uuid,date '2026-09-23')) v(id,day) join public.hotel_stays s on s.id=v.id join public.dogs d on d.id=s.dog_id);
end $$;
revoke all on function public.get_legacy_hotel_administrative_closure_targets_v1() from public,anon,service_role;
grant execute on function public.get_legacy_hotel_administrative_closure_targets_v1() to authenticated;
create function public.administratively_close_legacy_hotel_stay_v1(p_hotel_stay_id uuid,p_expected_version integer,p_reason text,p_evidence text,p_request_id uuid,p_confirmed boolean)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=auth.uid(); s public.hotel_stays%rowtype; c public.hotel_capacity_reservations%rowtype; a public.hotel_room_allocations%rowtype; dog uuid; day date; entry timestamptz; until_at timestamptz; payload_hash text; proof jsonb;
begin
 if actor is null or not public.is_admin() or not public.is_active_operation_member() or not public.can_operate_hotel() then raise exception '관리자 호텔 권한이 필요합니다.' using errcode='42501'; end if;
 if p_request_id is null or p_expected_version is null or p_confirmed is distinct from true or nullif(btrim(p_reason),'') is null or nullif(btrim(p_evidence),'') is null then raise exception '대상 버전·확인·사유·근거가 필요합니다.' using errcode='22023'; end if;
 select v.dog,v.day,v.entry into dog,day,entry from (values
 ('612d58e4-51e7-46f5-8d6a-618cfc804c22'::uuid,'77080f76-0a98-498b-bffd-10733fcbf0d7'::uuid,date '2026-08-18',timestamptz '2026-08-16 16:12+09'),
 ('8da96be1-c798-48fb-8e25-0d9c9edc2865'::uuid,'d41688aa-1b26-437c-a95e-c737ec302a5c'::uuid,date '2026-09-23',timestamptz '2026-09-21 19:51+09')) v(id,dog,day,entry) where v.id=p_hotel_stay_id;
 if not found then raise exception '승인된 두 호텔 기록만 처리할 수 있습니다.' using errcode='22023'; end if;
 until_at:=(day+1)::timestamp at time zone 'Asia/Seoul';
 payload_hash:=md5(jsonb_build_object('id',p_hotel_stay_id,'version',p_expected_version,'reason',p_reason,'evidence',p_evidence,'confirmed',p_confirmed,'day',day,'actor',actor)::text);
 perform pg_advisory_xact_lock(hashtextextended('hotel-request:'||p_request_id::text,0));
 select * into strict s from public.hotel_stays where id=p_hotel_stay_id for update;
 if s.administrative_closure_request_id=p_request_id then
  if s.administrative_closure_payload_hash is distinct from payload_hash then raise exception 'REQUEST_PAYLOAD_CONFLICT' using errcode='22023'; end if;
  return public.hotel_stay_json(s.id);
 end if;
 if s.version is distinct from p_expected_version then raise exception 'VERSION_CONFLICT' using errcode='PT409'; end if;
 if s.dog_id is distinct from dog or s.checked_in_at is distinct from entry or s.checked_out_at is not null or s.archived_at is not null or s.administrative_closed_on is not null or until_at>statement_timestamp() then raise exception '대상 입실·퇴실·행정 종료 상태가 달라 중단합니다.' using errcode='22023'; end if;
 if exists(select 1 from public.long_stay_contracts where current_hotel_stay_id=s.id) or exists(select 1 from public.long_stay_absence_events where hotel_stay_id=s.id) or exists(select 1 from public.hotel_physical_occupancy_members where hotel_stay_id=s.id) then raise exception '장기호텔·Shared Room·독립 점유는 이 복구 대상이 아닙니다.' using errcode='22023'; end if;
 if (select count(*) from public.hotel_capacity_reservations where hotel_stay_id=s.id)<>1 then raise exception '다중 Capacity는 별도 검증 필요' using errcode='22023'; end if;
 select * into strict c from public.hotel_capacity_reservations where hotel_stay_id=s.id and archived_at is null for update;
 if c.source_kind<>'stay' or c.quantity<>1 or c.physical_occupancy_id is not null or c.shared_room_group_id is not null or not isfinite(c.reserved_until) or c.reserved_until>until_at or c.reserved_from>s.checked_in_at then raise exception '단독 과거 Capacity 구간 확인 필요' using errcode='22023'; end if;
 if (select count(*) from public.hotel_room_allocations where capacity_reservation_id=c.id)<>1 then raise exception '다중 객실 배정은 별도 검증 필요' using errcode='22023'; end if;
 select * into strict a from public.hotel_room_allocations where capacity_reservation_id=c.id and archived_at is null for update;
 if a.room_id<>'56bed086-9fb0-46ec-83a0-95dfad265f65'::uuid or a.allocated_from is distinct from s.checked_in_at or not isfinite(a.allocated_until) or a.allocated_until>until_at then raise exception '승인된 단독 배정 구간 확인 필요' using errcode='22023'; end if;
 -- Full retained audit chain is mandatory, not just an archived/status flag.
 select coalesce(jsonb_agg(to_jsonb(e)),'[]') into proof from public.entity_audit_events e where module_code='hotel_operations' and entity_id in(s.id,c.id,a.id);
 if not public.hotel_history_chain_010('hotel_stays',to_jsonb(s),proof) or not public.hotel_history_chain_010('hotel_capacity_reservations',to_jsonb(c),proof) or not public.hotel_history_chain_010('hotel_room_allocations',to_jsonb(a),proof) then raise exception '감사 이력 연결 검증 실패' using errcode='22023'; end if;
 perform public.assert_hotel_total_capacity_available(c.reserved_from,until_at,1,c.id);
 perform public.assert_hotel_capacity_available(c.room_type_id,c.reserved_from,until_at,1,c.id);
 perform pg_advisory_xact_lock(hashtextextended('hotel-room:'||a.room_id::text,0));
 if exists(select 1 from public.hotel_room_allocations x where x.room_id=a.room_id and x.capacity_reservation_id<>c.id and x.allocated_from<until_at and x.allocated_until>a.allocated_from) then raise exception '확인된 퇴실 날짜의 보수적 경계와 배정 이력이 충돌합니다.' using errcode='23P01'; end if;
 if exists(select 1 from public.hotel_physical_occupancies where room_id=a.room_id) then raise exception '독립 물리 점유 이력은 별도 검증 필요' using errcode='23P01'; end if;
 -- Actual unresolved history remains independent from planned Capacity intervals.
 if exists(select 1 from public.hotel_stays other_s join public.hotel_capacity_reservations other_c on other_c.hotel_stay_id=other_s.id join public.hotel_room_allocations other_a on other_a.capacity_reservation_id=other_c.id
 where other_s.id<>s.id and other_a.room_id=a.room_id and other_s.checked_in_at<until_at and coalesce(other_s.checked_out_at,other_s.administrative_occupancy_until,'infinity'::timestamptz)>s.checked_in_at) then raise exception '다른 실제 호텔 점유의 종료 근거가 부족합니다.' using errcode='23P01'; end if;
 if exists(select 1 from public.daycare_operation_states d join public.hotel_capacity_reservations dc on dc.daycare_schedule_id=d.operation_schedule_id join public.hotel_room_allocations da on da.capacity_reservation_id=dc.id
 where da.room_id=a.room_id and d.checked_in_at<until_at and coalesce(d.checked_out_at,case when d.lifecycle_status='administratively_released' then d.administrative_released_at end,'infinity'::timestamptz)>s.checked_in_at) then raise exception '다른 실제 Daycare 점유 이력과 충돌합니다.' using errcode='23P01'; end if;
 perform set_config('app.operation_change_reason','호텔 행정 종료 · 실제 퇴실 시각 미확정 · '||p_reason||' · '||p_evidence,true);
 perform set_config('app.operation_request_id',p_request_id::text,true);
 update public.hotel_capacity_reservations set reserved_until=until_at,updated_by=actor where id=c.id;
 update public.hotel_room_allocations set allocated_until=until_at,updated_by=actor where id=a.id;
 update public.hotel_stays set administrative_closed_on=day,administrative_occupancy_until=until_at,administrative_closed_at=clock_timestamp(),administrative_closed_by=actor,administrative_closure_reason=p_reason,administrative_closure_evidence=p_evidence,administrative_closure_request_id=p_request_id,administrative_closure_payload_hash=payload_hash,updated_by=actor where id=s.id;
 if not exists(select 1 from public.hotel_stays where id=s.id and checked_in_at=entry and checked_out_at is null and checked_out_by is null and administrative_closed_on=day and administrative_closed_by=actor and version=p_expected_version+1) or exists(select 1 from public.hotel_current_physical_rooms_internal() where stay_id=s.id) then raise exception '행정 종료 사후 정합성 실패'; end if;
 if not exists(select 1 from public.entity_audit_events where entity_type='hotel_stays' and entity_id=s.id and request_id=p_request_id and changed_by=actor and after_data->>'administrative_closed_on'=day::text) then raise exception '행정 종료 감사 검증 실패'; end if;
 return public.hotel_stay_json(s.id);
end $$;
revoke all on function public.administratively_close_legacy_hotel_stay_v1(uuid,integer,text,text,uuid,boolean) from public,anon,service_role;
grant execute on function public.administratively_close_legacy_hotel_stay_v1(uuid,integer,text,text,uuid,boolean) to authenticated;
CREATE OR REPLACE FUNCTION public.get_hotel_historical_room_board(p_local_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE ds timestamptz; de timestamptz; observed timestamptz:=statement_timestamp();
 scoped_stays jsonb; rooms jsonb; all_segments jsonb:='[]'; unavailable jsonb:='[]'; shared_proof jsonb; ids uuid[];
 ctx record; stay_value jsonb; evidence jsonb; proof jsonb; z jsonb; scope_range jsonb; kind text; reason text; events jsonb;
 start_at timestamptz; end_at timestamptz; affected_from timestamptz; affected_until timestamptz; conflicts text[];
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_active_operation_member() THEN RAISE EXCEPTION 'Hotel history authorization required' USING errcode='42501'; END IF;
 IF p_local_date IS NULL OR p_local_date >= (observed AT TIME ZONE 'Asia/Seoul')::date THEN
  RAISE EXCEPTION 'Past date required' USING errcode='22023'; END IF;
 ds:=p_local_date::timestamp AT TIME ZONE 'Asia/Seoul'; de:=(p_local_date+1)::timestamp AT TIME ZONE 'Asia/Seoul';
 SELECT coalesce(jsonb_agg(jsonb_build_object('roomId',r.id,'roomName',r.name,'roomTypeId',t.id,'roomType',t.name) ORDER BY t.name,r.name,r.id),'[]')
 INTO rooms FROM public.hotel_rooms r JOIN public.hotel_room_types t ON t.id=r.room_type_id;
 -- Scope is not room proof. Retained actual boundaries take precedence over old snapshots.
 -- An audit-only fallback after a reset must have a finite actual checkout: never open
 -- a completed/reset stay merely because an earlier snapshot had a null checkout.
 WITH actual_envelopes AS (
  SELECT s.id,s.checked_in_at used_from,least(coalesce(s.checked_out_at,s.administrative_occupancy_until,observed),observed) used_until
  FROM public.hotel_stays s WHERE s.checked_in_at IS NOT NULL
  UNION ALL
  SELECT s.id,(e.after_data->>'checked_in_at')::timestamptz,
   least(coalesce(s.checked_out_at,(e.after_data->>'checked_out_at')::timestamptz),observed)
  FROM public.hotel_stays s JOIN public.entity_audit_events e ON e.entity_id=s.id AND e.entity_type='hotel_stays'
  WHERE s.checked_in_at IS NULL AND e.module_code='hotel_operations' AND e.after_data ? 'created_at'
   AND e.after_data->>'checked_in_at' IS NOT NULL
   AND coalesce(s.checked_out_at,(e.after_data->>'checked_out_at')::timestamptz) IS NOT NULL
 ), intersections AS (
  SELECT id,greatest(ds,used_from) scope_from,least(de,used_until) scope_until
  FROM actual_envelopes WHERE used_from IS NOT NULL AND used_until IS NOT NULL
 ), ordered AS (
  SELECT *,max(scope_until) OVER(PARTITION BY id ORDER BY scope_from,scope_until ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) prior_until
  FROM intersections WHERE scope_from<scope_until
 ), numbered AS (
  SELECT *,sum(CASE WHEN prior_until IS NULL OR prior_until<scope_from THEN 1 ELSE 0 END)
   OVER(PARTITION BY id ORDER BY scope_from,scope_until) island FROM ordered
 ), intervals AS (
  SELECT id,island,min(scope_from) scope_from,max(scope_until) scope_until FROM numbered GROUP BY id,island
 ), scoped AS (
  SELECT id,min(scope_from) scope_from,max(scope_until) scope_until,
   jsonb_agg(jsonb_build_object('from',scope_from,'until',scope_until) ORDER BY scope_from) scope_ranges
  FROM intervals GROUP BY id
 ) SELECT coalesce(jsonb_agg(to_jsonb(scoped)),'[]') INTO scoped_stays FROM scoped;
 -- All three lifecycle paths consume exactly the same selected-day scope.
 -- Shared ownership wins even when evidence is unavailable; Long Stay cannot fall back to Single.
 SELECT coalesce(array_agg(scope.id),'{}') INTO ids
 FROM jsonb_to_recordset(scoped_stays) AS scope(id uuid,scope_from timestamptz,scope_until timestamptz,scope_ranges jsonb)
 WHERE EXISTS(SELECT 1 FROM public.hotel_physical_occupancy_members m WHERE m.hotel_stay_id=scope.id)
 OR EXISTS(SELECT 1 FROM public.family_booking_members f WHERE f.hotel_stay_id=scope.id AND f.shared_room_group_id IS NOT NULL);
 shared_proof:=public.hotel_shared_verified_segments_internal(ids);
 FOR ctx IN
 WITH stays AS MATERIALIZED (
  SELECT s.*,d.name dog_name,scope.scope_from,scope.scope_until,scope.scope_ranges
  FROM public.hotel_stays s JOIN public.dogs d ON d.id=s.dog_id
  JOIN jsonb_to_recordset(scoped_stays) AS scope(id uuid,scope_from timestamptz,scope_until timestamptz,scope_ranges jsonb) ON scope.id=s.id
 ), capacities AS MATERIALIZED (
  SELECT c.* FROM public.hotel_capacity_reservations c JOIN stays s ON c.hotel_stay_id=s.id
 ), allocations AS MATERIALIZED (
  SELECT a.* FROM public.hotel_room_allocations a JOIN capacities c ON c.id=a.capacity_reservation_id
 ), audits AS MATERIALIZED (
  SELECT e.* FROM public.entity_audit_events e WHERE e.module_code='hotel_operations' AND
  ((e.entity_type='hotel_stays' AND e.entity_id IN (SELECT id FROM stays)) OR
   (e.entity_type='hotel_capacity_reservations' AND e.entity_id IN (SELECT id FROM capacities)) OR
   (e.entity_type='hotel_room_allocations' AND e.entity_id IN (SELECT id FROM allocations)))
 )
 SELECT to_jsonb(s)-ARRAY['dog_name','scope_from','scope_until','scope_ranges'] stay,s.dog_name,s.scope_from,s.scope_until,s.scope_ranges,
  coalesce((SELECT jsonb_agg(to_jsonb(c)) FROM capacities c WHERE c.hotel_stay_id=s.id),'[]') caps,
  coalesce((SELECT jsonb_agg(to_jsonb(a)) FROM allocations a JOIN capacities c ON c.id=a.capacity_reservation_id WHERE c.hotel_stay_id=s.id),'[]') allocs,
  coalesce((SELECT jsonb_agg(to_jsonb(e)) FROM audits e WHERE
    (e.entity_type='hotel_stays' AND e.entity_id=s.id) OR
    (e.entity_type='hotel_capacity_reservations' AND e.entity_id IN(SELECT id FROM capacities WHERE hotel_stay_id=s.id)) OR
    (e.entity_type='hotel_room_allocations' AND e.entity_id IN(SELECT a.id FROM allocations a JOIN capacities c ON c.id=a.capacity_reservation_id WHERE c.hotel_stay_id=s.id))),'[]') audit_rows,
  coalesce((SELECT jsonb_agg(to_jsonb(a)) FROM public.long_stay_absence_events a WHERE a.hotel_stay_id=s.id),'[]') absence_rows,
  coalesce((SELECT jsonb_agg(to_jsonb(r)) FROM public.long_stay_operation_audit_events r WHERE r.long_stay_contract_id IN
   (SELECT c.id FROM public.long_stay_contracts c WHERE c.current_hotel_stay_id=s.id UNION SELECT a.long_stay_contract_id FROM public.long_stay_absence_events a WHERE a.hotel_stay_id=s.id)),'[]') receipts,
  coalesce((SELECT jsonb_agg(to_jsonb(pr)) FROM public.hotel_planned_checkout_requests pr WHERE pr.hotel_stay_id=s.id),'[]') planned_requests,
  EXISTS(SELECT 1 FROM public.long_stay_contracts c WHERE c.current_hotel_stay_id=s.id)
   OR EXISTS(SELECT 1 FROM public.long_stay_absence_events a WHERE a.hotel_stay_id=s.id)
   OR EXISTS(SELECT 1 FROM public.long_stay_monthly_occupancies m WHERE m.hotel_stay_id=s.id) is_longstay
 FROM stays s ORDER BY s.id
 LOOP
  stay_value:=ctx.stay; reason:=NULL;
  kind:=CASE WHEN (stay_value->>'id')::uuid=ANY(ids) THEN 'shared' WHEN ctx.is_longstay THEN 'longstay' ELSE 'single' END;
  IF kind='shared' AND ctx.is_longstay THEN
   reason:='DOMAIN_OWNERSHIP_CONFLICT'; proof:=jsonb_build_object('segments','[]'::jsonb);
  ELSIF kind='shared' THEN
   SELECT value INTO proof FROM jsonb_array_elements(shared_proof) WHERE value->>'hotelStayId'=stay_value->>'id';
   reason:='SHARED_PARTICIPATION_UNPROVEN';
   IF EXISTS(SELECT 1 FROM public.hotel_physical_occupancy_requests r WHERE r.occupancy_id::text=proof->>'physicalOccupancyId' AND r.operation_kind='move') THEN reason:='MOVE_PROVENANCE_UNPROVEN';
   ELSIF EXISTS(SELECT 1 FROM public.hotel_physical_occupancy_requests r WHERE r.occupancy_id::text=proof->>'physicalOccupancyId' AND r.operation_kind='merge_existing_stays') THEN reason:='UNSUPPORTED_SHARED_MERGE'; END IF;
   IF public.hotel_history_shared_gate_010(stay_value,proof,
    (SELECT coalesce(jsonb_agg(to_jsonb(m)),'[]') FROM public.hotel_physical_occupancy_members m WHERE m.hotel_stay_id=(stay_value->>'id')::uuid),
    (SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]') FROM public.hotel_physical_occupancy_requests r WHERE r.occupancy_id::text=proof->>'physicalOccupancyId')) THEN
    reason:=NULL;
   END IF;
   IF reason IS NOT NULL THEN proof:=jsonb_build_object('segments','[]'::jsonb,'reasonCode',reason); END IF;
  ELSE
   evidence:=jsonb_build_object('stay',stay_value,'kind',kind,'capacities',ctx.caps,'allocations',ctx.allocs,'audits',ctx.audit_rows,
    'plannedRequests',CASE WHEN kind='single' THEN ctx.planned_requests ELSE '[]'::jsonb END,'absences',ctx.absence_rows,'receipts',ctx.receipts,'rooms',rooms,'asOf',observed,'windowUntil',de);
   proof:=public.hotel_history_individual_010(evidence);reason:=proof->>'reasonCode';
  END IF;
  IF reason IS NOT NULL OR proof IS NULL THEN
   FOR scope_range IN SELECT value FROM jsonb_array_elements(ctx.scope_ranges) LOOP
   affected_from:=greatest((scope_range->>'from')::timestamptz,coalesce((proof->>'affectedFrom')::timestamptz,(scope_range->>'from')::timestamptz));
   affected_until:=(scope_range->>'until')::timestamptz;
   IF affected_from<affected_until THEN
    unavailable:=unavailable||jsonb_build_array(jsonb_build_object('stayId',stay_value->'id','dogId',stay_value->'dog_id','dogName',ctx.dog_name,'lifecycleKind',kind,
     'reasonCode',coalesce(reason,'AUDIT_CHAIN_UNPROVEN'),'coverageClassification','unavailable','affectedFrom',affected_from,'affectedUntil',affected_until));
   END IF;
   END LOOP;
   IF coalesce(jsonb_array_length(proof->'segments'),0)=0 THEN CONTINUE; END IF;
  END IF;
  FOR z IN SELECT value FROM jsonb_array_elements(proof->'segments') LOOP
   start_at:=(z->>'usedFrom')::timestamptz; end_at:=(z->>'usedUntil')::timestamptz;
   IF greatest(start_at,ctx.scope_from)>=least(end_at,ctx.scope_until) THEN CONTINUE; END IF;
   events:='[]';
   IF stay_value->>'administrative_closed_on' is not null THEN events:=events||'"administratively_closed"'::jsonb; END IF;
   IF start_at<ds THEN events:=events||'"continuing"'::jsonb; END IF;
   IF start_at>=ds THEN events:=events||to_jsonb(CASE WHEN start_at=(stay_value->>'checked_in_at')::timestamptz THEN 'check_in' ELSE coalesce(z->>'startEvent','moved_in') END); END IF;
   IF end_at>=ds AND end_at<de THEN
    IF end_at=(stay_value->>'checked_out_at')::timestamptz THEN events:=events||'"check_out"'::jsonb;
    ELSIF z->>'endEvent'='left_for_absence' THEN events:=events||'"left_for_absence"'::jsonb;
    ELSIF EXISTS(SELECT 1 FROM jsonb_array_elements(proof->'segments') nxt WHERE (nxt->>'usedFrom')::timestamptz=end_at) THEN events:=events||'"moved_out"'::jsonb; END IF;
   END IF;
   all_segments:=all_segments||jsonb_build_array(jsonb_build_object('segmentId',md5(concat_ws(':',stay_value->>'id',coalesce(z->>'allocationId',proof->>'physicalOccupancyId'),z->>'roomId',extract(epoch FROM start_at)::text)),
    'stayId',stay_value->'id','dogId',stay_value->'dog_id','dogName',ctx.dog_name,'lifecycleKind',kind,'physicalOccupancyId',proof->'physicalOccupancyId',
    'roomId',z->'roomId','usedFrom',start_at,'usedUntil',end_at,'displayFrom',greatest(ctx.scope_from,start_at),'displayUntil',least(ctx.scope_until,end_at),
    'selectedDayEvents',events,'provenanceStatus','verified','coverageClassification','verified_supported_path'));
  END LOOP;
 END LOOP;
 -- Cross-stay room conflicts fail closed; co-members of the same proven Shared occupancy are allowed.
 SELECT array_agg(DISTINCT a->>'stayId') INTO conflicts FROM jsonb_array_elements(all_segments) a CROSS JOIN jsonb_array_elements(all_segments) b
 WHERE a->>'stayId'<>b->>'stayId' AND a->>'roomId'=b->>'roomId'
 AND (a->>'displayFrom')::timestamptz<(b->>'displayUntil')::timestamptz AND (b->>'displayFrom')::timestamptz<(a->>'displayUntil')::timestamptz
 AND NOT (a->>'lifecycleKind'='shared' AND b->>'lifecycleKind'='shared' AND a->>'physicalOccupancyId'=b->>'physicalOccupancyId');
 IF conflicts IS NOT NULL THEN
  SELECT unavailable||coalesce(jsonb_agg(x),'[]') INTO unavailable FROM (
   SELECT DISTINCT jsonb_build_object('stayId',s->'stayId','dogId',s->'dogId','dogName',s->'dogName','lifecycleKind',s->'lifecycleKind','reasonCode','ROOM_CANDIDATE_CONFLICT','coverageClassification','unavailable',
    'affectedFrom',s->'displayFrom','affectedUntil',s->'displayUntil') x
   FROM jsonb_array_elements(all_segments) s WHERE s->>'stayId'=ANY(conflicts)) q;
  SELECT coalesce(jsonb_agg(s),'[]') INTO all_segments FROM jsonb_array_elements(all_segments) s WHERE NOT(s->>'stayId'=ANY(conflicts));
 END IF;
 SELECT coalesce(jsonb_agg(q.value ORDER BY q.value->>'stayId',q.value->>'affectedFrom'),'[]') INTO unavailable FROM (SELECT DISTINCT ON (u->>'stayId',u->>'affectedFrom',u->>'affectedUntil') u value FROM jsonb_array_elements(unavailable) u ORDER BY u->>'stayId',u->>'affectedFrom',u->>'affectedUntil',(u->>'reasonCode'='ROOM_CANDIDATE_CONFLICT') DESC) q;
 RETURN jsonb_build_object('selectedDate',p_local_date,'timezone','Asia/Seoul','evidenceAsOf',observed,'readOnly',true,'coverageStatus','PARTIAL',
  'rooms',(SELECT coalesce(jsonb_agg(r||jsonb_build_object('segments',(SELECT coalesce(jsonb_agg(s ORDER BY s->>'displayFrom',s->>'segmentId'),'[]') FROM jsonb_array_elements(all_segments) s WHERE s->>'roomId'=r->>'roomId'))),'[]') FROM jsonb_array_elements(rooms) r),
  'unavailable',unavailable);
END $function$
;
commit;
