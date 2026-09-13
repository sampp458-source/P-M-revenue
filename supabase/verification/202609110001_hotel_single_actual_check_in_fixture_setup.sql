-- LOCAL SYNTHETIC SCHEMA, NOT A PRODUCTION MIGRATION.
DO $$ BEGIN IF current_database()<>'single_checkin_fixture_016' OR inet_server_addr() IS NOT NULL THEN RAISE EXCEPTION 'LOCAL_ONLY'; END IF; END $$;
create schema auth; create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$; create function public.is_active_operation_member() returns boolean language sql stable as $$select auth.uid() is not null$$;
create table public.entity_audit_events("id" uuid,"module_code" text,"entity_type" text,"entity_id" uuid,"action" text,"before_data" jsonb,"after_data" jsonb,"changed_by" uuid,"change_reason" text,"request_id" uuid,"created_at" timestamp with time zone);
create table public.family_booking_members("id" uuid,"family_booking_id" uuid,"stable_member_key" text,"dog_id" uuid,"service_type" text,"status" text,"hotel_stay_id" uuid,"operation_schedule_id" uuid,"shared_room_group_id" uuid,"version" integer,"created_by" uuid,"created_at" timestamp with time zone,"updated_by" uuid,"updated_at" timestamp with time zone,"archived_at" timestamp with time zone,"archived_by" uuid,"archive_reason" text);
create table public.family_shared_room_groups("id" uuid,"family_booking_id" uuid,"stable_group_key" text,"leader_member_id" uuid,"room_type_id" uuid,"normalized_starts_at" timestamp with time zone,"normalized_ends_at" timestamp with time zone,"requested_capacity" integer,"status" text,"version" integer,"created_by" uuid,"created_at" timestamp with time zone,"updated_by" uuid,"updated_at" timestamp with time zone,"archived_at" timestamp with time zone,"archived_by" uuid,"archive_reason" text);
create table public.hotel_capacity_reservations("id" uuid,"source_kind" text,"hotel_stay_id" uuid,"daycare_schedule_id" uuid,"room_type_id" uuid,"reserved_from" timestamp with time zone,"reserved_until" timestamp with time zone,"quantity" smallint,"version" integer,"request_id" uuid,"created_by" uuid,"created_at" timestamp with time zone,"updated_by" uuid,"updated_at" timestamp with time zone,"archived_at" timestamp with time zone,"archived_by" uuid,"archive_reason" text,"physical_occupancy_id" uuid,"shared_room_group_id" uuid);
create table public.hotel_physical_occupancies("id" uuid,"family_booking_id" uuid,"shared_room_group_id" uuid,"customer_id" uuid,"room_type_id" uuid,"room_id" uuid,"occupied_from" timestamp with time zone,"occupied_until" timestamp with time zone,"restore_occupied_until" timestamp with time zone,"capacity_reservation_id" uuid,"room_allocation_id" uuid,"status" text,"version" integer,"request_id" uuid,"canonical_payload_hash" text,"created_by" uuid,"created_at" timestamp with time zone,"updated_by" uuid,"updated_at" timestamp with time zone,"completed_at" timestamp with time zone,"archived_at" timestamp with time zone,"archived_by" uuid,"archive_reason" text);
create table public.hotel_physical_occupancy_members("id" uuid,"occupancy_id" uuid,"family_booking_member_id" uuid,"hotel_stay_id" uuid,"dog_id" uuid,"status" text,"joined_at" timestamp with time zone,"left_at" timestamp with time zone,"version" integer,"created_by" uuid,"created_at" timestamp with time zone,"updated_by" uuid,"updated_at" timestamp with time zone,"archived_at" timestamp with time zone,"archived_by" uuid,"archive_reason" text);
create table public.hotel_physical_occupancy_requests("request_id" uuid,"occupancy_id" uuid,"operation_kind" text,"canonical_payload_hash" text,"response" jsonb,"created_by" uuid,"created_at" timestamp with time zone,"completed_at" timestamp with time zone);
create table public.hotel_room_allocations("id" uuid,"capacity_reservation_id" uuid,"room_id" uuid,"allocated_from" timestamp with time zone,"allocated_until" timestamp with time zone,"assignment_reason" text,"version" integer,"request_id" uuid,"created_by" uuid,"created_at" timestamp with time zone,"updated_by" uuid,"updated_at" timestamp with time zone,"archived_at" timestamp with time zone,"archived_by" uuid,"archive_reason" text);
create table public.hotel_stays("id" uuid,"dog_id" uuid,"checked_in_at" timestamp with time zone,"checked_in_by" uuid,"checked_out_at" timestamp with time zone,"checked_out_by" uuid,"checkout_previous_reserved_until" timestamp with time zone,"checkout_previous_allocation_id" uuid,"checkout_previous_allocation_until" timestamp with time zone,"version" integer,"request_id" uuid,"created_by" uuid,"created_at" timestamp with time zone,"updated_by" uuid,"updated_at" timestamp with time zone,"archived_at" timestamp with time zone,"archived_by" uuid,"archive_reason" text);
create table public.dogs(id uuid,name text);
create table public.hotel_rooms(id uuid,name text,room_type_id uuid);
create table public.hotel_room_types(id uuid,name text);
create table public.hotel_stay_schedule_events(id uuid,hotel_stay_id uuid,operation_schedule_id uuid,event_kind text,archived_at timestamptz);
create table public.operation_schedules(id uuid);
create function public.get_operation_hotel_room_projections(uuid[]) returns jsonb language sql stable as $$select coalesce(current_setting('test.base',true),'[]')::jsonb$$;
CREATE OR REPLACE FUNCTION public.protect_hotel_entity_metadata()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  new.id := old.id;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  if to_jsonb(new) ? 'version' then
    new.version := old.version + 1;
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.record_hotel_operation_audit_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  action_value text;
  request_value text;
  parsed_request_id uuid;
  reason_value text;
  changed_by_value uuid;
begin
  if tg_op = 'INSERT' then
    action_value := 'created';
  elsif old.archived_at is null and new.archived_at is not null then
    action_value := 'archived';
  elsif old.archived_at is not null and new.archived_at is null then
    action_value := 'restored';
  else
    action_value := 'updated';
  end if;

  reason_value := nullif(btrim(current_setting('app.operation_change_reason', true)), '');
  request_value := nullif(btrim(current_setting('app.operation_request_id', true)), '');

  -- 운영 Audit의 request_id UNIQUE 계약을 유지한다.
  -- Aggregate Root인 Stay와 Settings만 원 요청 ID를 사용한다.
  if tg_table_name in ('hotel_stays', 'hotel_operation_settings')
    and request_value is not null then
    begin
      parsed_request_id := request_value::uuid;
    exception when invalid_text_representation then
      raise exception '유효하지 않은 Hotel Operations 요청 ID입니다.';
    end;
  else
    parsed_request_id := null;
  end if;

  -- 인증된 런타임 작업은 실제 auth.uid()를 우선 사용한다.
  -- SQL Editor 유지보수처럼 auth.uid()가 없는 경우에는 호출 SQL이 명시한
  -- Hotel 행의 updated_by를 사용한다. 둘 다 없으면 무기명 Audit을 남기지 않는다.
  changed_by_value := coalesce(auth.uid(), new.updated_by);
  if changed_by_value is null then
    raise exception 'Hotel Operations Audit 변경자를 확인할 수 없습니다. updated_by를 명시해 주세요.'
      using errcode = '23502';
  end if;

  insert into public.entity_audit_events (
    module_code, entity_type, entity_id, action, before_data, after_data,
    changed_by, change_reason, request_id
  ) values (
    'hotel_operations', tg_table_name, new.id, action_value,
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,
    to_jsonb(new), changed_by_value, reason_value, parsed_request_id
  );
  return new;
end;
$function$
;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE TABLE public.profiles(id uuid PRIMARY KEY);
CREATE TABLE public.long_stay_monthly_occupancies(id uuid,hotel_stay_id uuid);
CREATE TABLE public.long_stay_contracts(id uuid,current_hotel_stay_id uuid);
CREATE TABLE public.long_stay_absence_events(id uuid,hotel_stay_id uuid);
ALTER TABLE public.hotel_rooms ADD PRIMARY KEY(id);
ALTER TABLE public.hotel_rooms ADD is_active boolean DEFAULT true, ADD archived_at timestamptz, ADD sort_order integer DEFAULT 0;
ALTER TABLE public.hotel_room_types ADD code text, ADD is_active boolean DEFAULT true, ADD archived_at timestamptz;
ALTER TABLE public.operation_schedules ADD starts_at timestamptz, ADD ends_at timestamptz, ADD archived_at timestamptz;
ALTER TABLE public.hotel_stays ADD PRIMARY KEY(id);
ALTER TABLE public.hotel_stays ALTER id SET DEFAULT gen_random_uuid(), ALTER version SET DEFAULT 1, ALTER created_at SET DEFAULT now(), ALTER updated_at SET DEFAULT now();
CREATE TRIGGER metadata BEFORE UPDATE ON public.hotel_stays FOR EACH ROW EXECUTE FUNCTION public.protect_hotel_entity_metadata();
CREATE TRIGGER audit AFTER INSERT OR UPDATE ON public.hotel_stays FOR EACH ROW EXECUTE FUNCTION public.record_hotel_operation_audit_event();
ALTER TABLE public.hotel_capacity_reservations ADD PRIMARY KEY(id);
ALTER TABLE public.hotel_capacity_reservations ALTER id SET DEFAULT gen_random_uuid(), ALTER version SET DEFAULT 1, ALTER created_at SET DEFAULT now(), ALTER updated_at SET DEFAULT now();
CREATE TRIGGER metadata BEFORE UPDATE ON public.hotel_capacity_reservations FOR EACH ROW EXECUTE FUNCTION public.protect_hotel_entity_metadata();
CREATE TRIGGER audit AFTER INSERT OR UPDATE ON public.hotel_capacity_reservations FOR EACH ROW EXECUTE FUNCTION public.record_hotel_operation_audit_event();
ALTER TABLE public.hotel_room_allocations ADD PRIMARY KEY(id);
ALTER TABLE public.hotel_room_allocations ALTER id SET DEFAULT gen_random_uuid(), ALTER version SET DEFAULT 1, ALTER created_at SET DEFAULT now(), ALTER updated_at SET DEFAULT now();
CREATE TRIGGER metadata BEFORE UPDATE ON public.hotel_room_allocations FOR EACH ROW EXECUTE FUNCTION public.protect_hotel_entity_metadata();
CREATE TRIGGER audit AFTER INSERT OR UPDATE ON public.hotel_room_allocations FOR EACH ROW EXECUTE FUNCTION public.record_hotel_operation_audit_event();
create or replace function public.assert_hotel_room_allocation_available(
  p_room_id uuid,
  p_capacity_reservation_id uuid,
  p_allocated_from timestamptz,
  p_allocated_until timestamptz,
  p_exclude_allocation_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  room_row public.hotel_rooms%rowtype;
  reservation_row public.hotel_capacity_reservations%rowtype;
begin
  if p_allocated_from is null or p_allocated_until is null
    or p_allocated_until <= p_allocated_from then
    raise exception '유효한 호실 배정 기간이 필요합니다.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('hotel-room:' || p_room_id::text, 0));

  select * into room_row from public.hotel_rooms room
  where room.id = p_room_id and room.is_active and room.archived_at is null;
  if not found then
    raise exception '활성 호실을 확인할 수 없습니다.' using errcode = 'P0002';
  end if;

  select * into reservation_row from public.hotel_capacity_reservations reservation
  where reservation.id = p_capacity_reservation_id and reservation.archived_at is null;
  if not found then
    raise exception '활성 Capacity 예약을 확인할 수 없습니다.' using errcode = 'P0002';
  end if;

  if room_row.room_type_id <> reservation_row.room_type_id then
    raise exception '예약한 객실 유형과 선택한 호실 유형이 다릅니다.' using errcode = '22023';
  end if;
  if p_allocated_from < reservation_row.reserved_from
    or p_allocated_until > reservation_row.reserved_until then
    raise exception '호실 배정 기간은 Capacity 예약 기간 안이어야 합니다.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.hotel_room_allocations allocation
    where allocation.room_id = p_room_id
      and allocation.archived_at is null
      and allocation.id is distinct from p_exclude_allocation_id
      and allocation.allocated_from < p_allocated_until
      and allocation.allocated_until > p_allocated_from
  ) then
    raise exception '선택한 기간에 이미 사용 중인 호실입니다.' using errcode = '23P01';
  end if;
end;
$$;
create or replace function public.complete_hotel_check_in(
  p_hotel_stay_id uuid,
  p_expected_version integer,
  p_completed_at timestamptz,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  stay_row public.hotel_stays%rowtype;
  capacity_id uuid;
  effective_at timestamptz := coalesce(p_completed_at, now());
begin
  if actor_id is null or not public.is_active_operation_member() then
    raise exception '입실 완료 권한이 없습니다.' using errcode = '42501';
  end if;
  if p_request_id is null or p_expected_version is null then
    raise exception '요청 ID와 기존 버전이 필요합니다.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('hotel-request:' || p_request_id::text, 0));
  if public.is_replayed_hotel_stay_request(p_hotel_stay_id, p_request_id) then
    return public.hotel_stay_json(p_hotel_stay_id);
  end if;
  select * into stay_row from public.hotel_stays stay where stay.id = p_hotel_stay_id for update;
  if not found or stay_row.archived_at is not null then raise exception '활성 호텔 예약을 확인할 수 없습니다.' using errcode = 'P0002'; end if;
  if stay_row.version <> p_expected_version then raise exception '다른 사용자가 먼저 처리했습니다.' using errcode = '40001'; end if;
  if stay_row.checked_in_at is not null then return public.hotel_stay_json(p_hotel_stay_id); end if;
  select id into capacity_id from public.hotel_capacity_reservations
    where hotel_stay_id = p_hotel_stay_id and archived_at is null;
  if not exists (select 1 from public.hotel_room_allocations allocation
    where allocation.capacity_reservation_id = capacity_id and allocation.archived_at is null
      and allocation.allocated_from <= effective_at and allocation.allocated_until > effective_at) then
    raise exception '입실 완료 전에 해당 시각의 실제 호실 배정이 필요합니다.' using errcode = '23514';
  end if;
  perform set_config('app.operation_change_reason', '호텔 입실 완료', true);
  perform set_config('app.operation_request_id', p_request_id::text, true);
  update public.hotel_stays set checked_in_at = effective_at, checked_in_by = actor_id,
    updated_by = actor_id where id = p_hotel_stay_id;
  return public.hotel_stay_json(p_hotel_stay_id);
end;
$$;
create or replace function public.assign_hotel_room(
  p_hotel_stay_id uuid,
  p_expected_version integer,
  p_room_id uuid,
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
  stay_row public.hotel_stays%rowtype;
  capacity_row public.hotel_capacity_reservations%rowtype;
begin
  if actor_id is null or not public.is_active_operation_member() then
    raise exception '호실 배정 권한이 없습니다.' using errcode = '42501';
  end if;
  if p_request_id is null or p_expected_version is null then
    raise exception '요청 ID와 기존 버전이 필요합니다.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('hotel-request:' || p_request_id::text, 0));
  if public.is_replayed_hotel_stay_request(p_hotel_stay_id, p_request_id) then
    return public.hotel_stay_json(p_hotel_stay_id);
  end if;
  select * into stay_row from public.hotel_stays stay
    where stay.id = p_hotel_stay_id for update;
  if not found or stay_row.archived_at is not null then
    raise exception '활성 호텔 예약을 확인할 수 없습니다.' using errcode = 'P0002';
  end if;
  if stay_row.version <> p_expected_version then
    raise exception '다른 사용자가 먼저 호텔 예약을 수정했습니다.' using errcode = '40001';
  end if;
  if stay_row.checked_out_at is not null then
    raise exception '퇴실 완료된 예약에는 호실을 배정할 수 없습니다.' using errcode = '22023';
  end if;
  select * into capacity_row from public.hotel_capacity_reservations capacity
    where capacity.hotel_stay_id = p_hotel_stay_id and capacity.archived_at is null for update;
  if not found then raise exception 'Capacity 예약을 확인할 수 없습니다.' using errcode = 'P0002'; end if;
  if exists (select 1 from public.hotel_room_allocations allocation
    where allocation.capacity_reservation_id = capacity_row.id
      and allocation.archived_at is null) then
    raise exception '이미 배정된 호실이 있습니다. 객실 이동을 사용해 주세요.' using errcode = '23505';
  end if;

  perform public.assert_hotel_room_allocation_available(
    p_room_id, capacity_row.id, capacity_row.reserved_from, capacity_row.reserved_until, null
  );
  perform set_config('app.operation_change_reason', coalesce(nullif(btrim(p_reason), ''), '호텔 호실 배정'), true);
  perform set_config('app.operation_request_id', p_request_id::text, true);
  insert into public.hotel_room_allocations (
    capacity_reservation_id, room_id, allocated_from, allocated_until,
    assignment_reason, request_id, created_by, updated_by
  ) values (
    capacity_row.id, p_room_id, capacity_row.reserved_from, capacity_row.reserved_until,
    nullif(btrim(p_reason), ''), p_request_id, actor_id, actor_id
  );
  update public.hotel_stays set updated_by = actor_id where id = p_hotel_stay_id;
  return public.hotel_stay_json(p_hotel_stay_id);
end;
$$;
create or replace function public.move_hotel_room_same_type(
  p_hotel_stay_id uuid,
  p_expected_version integer,
  p_new_room_id uuid,
  p_move_at timestamptz,
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
  stay_row public.hotel_stays%rowtype;
  capacity_row public.hotel_capacity_reservations%rowtype;
  current_allocation public.hotel_room_allocations%rowtype;
begin
  if actor_id is null or not public.is_active_operation_member() then
    raise exception '객실 이동 권한이 없습니다.' using errcode = '42501';
  end if;
  if p_request_id is null or p_expected_version is null or p_move_at is null
    or nullif(btrim(p_reason), '') is null then
    raise exception '요청 ID, 기존 버전, 이동 시각, 이동 사유가 필요합니다.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('hotel-request:' || p_request_id::text, 0));
  if public.is_replayed_hotel_stay_request(p_hotel_stay_id, p_request_id) then
    return public.hotel_stay_json(p_hotel_stay_id);
  end if;
  select * into stay_row from public.hotel_stays stay
    where stay.id = p_hotel_stay_id for update;
  if not found or stay_row.archived_at is not null then
    raise exception '활성 호텔 예약을 확인할 수 없습니다.' using errcode = 'P0002';
  end if;
  if stay_row.version <> p_expected_version then
    raise exception '다른 사용자가 먼저 호텔 예약을 수정했습니다.' using errcode = '40001';
  end if;
  if stay_row.checked_out_at is not null then
    raise exception '퇴실 완료된 예약은 객실을 이동할 수 없습니다.' using errcode = '22023';
  end if;
  if stay_row.checked_in_at is null then
    raise exception '입실 전에는 사전 호실 재배정 기능을 사용해 주세요.' using errcode = '22023';
  end if;
  select * into capacity_row from public.hotel_capacity_reservations capacity
    where capacity.hotel_stay_id = p_hotel_stay_id and capacity.archived_at is null for update;
  select allocation.* into current_allocation
  from public.hotel_room_allocations allocation
  where allocation.capacity_reservation_id = capacity_row.id
    and allocation.archived_at is null
    and allocation.allocated_from <= p_move_at
    and allocation.allocated_until > p_move_at
  order by allocation.allocated_from desc limit 1 for update;
  if not found then raise exception '이동할 현재 호실 배정을 확인할 수 없습니다.' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.hotel_rooms room
    where room.id = p_new_room_id and room.room_type_id = capacity_row.room_type_id
      and room.is_active and room.archived_at is null) then
    raise exception 'Sprint 1에서는 같은 객실 유형 안에서만 이동할 수 있습니다.' using errcode = '22023';
  end if;
  if p_move_at <= current_allocation.allocated_from
    or p_move_at >= current_allocation.allocated_until then
    raise exception '이동 시각은 현재 배정 구간 안이어야 합니다.' using errcode = '22023';
  end if;
  perform public.assert_hotel_room_allocation_available(
    p_new_room_id, capacity_row.id, p_move_at, current_allocation.allocated_until, null
  );

  perform set_config('app.operation_change_reason', btrim(p_reason), true);
  perform set_config('app.operation_request_id', p_request_id::text, true);
  update public.hotel_room_allocations allocation
  set allocated_until = p_move_at, assignment_reason = btrim(p_reason), updated_by = actor_id
  where allocation.id = current_allocation.id;
  insert into public.hotel_room_allocations (
    capacity_reservation_id, room_id, allocated_from, allocated_until,
    assignment_reason, request_id, created_by, updated_by
  ) values (
    capacity_row.id, p_new_room_id, p_move_at, current_allocation.allocated_until,
    btrim(p_reason), p_request_id, actor_id, actor_id
  );
  update public.hotel_stays set updated_by = actor_id where id = p_hotel_stay_id;
  return public.hotel_stay_json(p_hotel_stay_id);
end;
$$;
create function public.enforce_hotel_allocation_room_type()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  capacity_room_type_id uuid;
  selected_room_type_id uuid;
begin
  if new.archived_at is not null then
    return new;
  end if;

  select capacity.room_type_id
  into capacity_room_type_id
  from public.hotel_capacity_reservations capacity
  where capacity.id = new.capacity_reservation_id
    and capacity.archived_at is null;
  if not found or capacity_room_type_id is null then
    raise exception '객실 유형을 확정한 뒤 호실을 배정해 주세요.'
      using errcode = '23514';
  end if;

  select room.room_type_id
  into selected_room_type_id
  from public.hotel_rooms room
  where room.id = new.room_id
    and room.is_active
    and room.archived_at is null;
  if not found or selected_room_type_id <> capacity_room_type_id then
    raise exception '확정된 객실 유형과 선택한 호실 유형이 다릅니다.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;
CREATE TRIGGER room_type BEFORE INSERT OR UPDATE ON public.hotel_room_allocations FOR EACH ROW EXECUTE FUNCTION public.enforce_hotel_allocation_room_type();
CREATE FUNCTION public.hotel_stay_json(p_id uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT to_jsonb(s) FROM public.hotel_stays s WHERE id=p_id $$;
CREATE FUNCTION public.is_replayed_hotel_stay_request(p_id uuid,p_request uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT EXISTS(SELECT 1 FROM public.entity_audit_events WHERE entity_id=p_id AND request_id=p_request) $$;
create or replace function public.complete_hotel_check_out(
  p_hotel_stay_id uuid,
  p_expected_version integer,
  p_completed_at timestamptz,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  stay_row public.hotel_stays%rowtype;
  capacity_row public.hotel_capacity_reservations%rowtype;
  final_allocation public.hotel_room_allocations%rowtype;
  effective_at timestamptz := coalesce(p_completed_at, now());
begin
  if actor_id is null or not public.is_active_operation_member() then
    raise exception '퇴실 완료 권한이 없습니다.' using errcode = '42501';
  end if;
  if p_request_id is null or p_expected_version is null then raise exception '요청 ID와 기존 버전이 필요합니다.' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('hotel-request:' || p_request_id::text, 0));
  if public.is_replayed_hotel_stay_request(p_hotel_stay_id, p_request_id) then
    return public.hotel_stay_json(p_hotel_stay_id);
  end if;
  select * into stay_row from public.hotel_stays stay where stay.id = p_hotel_stay_id for update;
  if not found or stay_row.archived_at is not null then raise exception '활성 호텔 예약을 확인할 수 없습니다.' using errcode = 'P0002'; end if;
  if stay_row.version <> p_expected_version then raise exception '다른 사용자가 먼저 처리했습니다.' using errcode = '40001'; end if;
  if stay_row.checked_in_at is null then raise exception '입실 완료 후 퇴실 처리할 수 있습니다.' using errcode = '22023'; end if;
  if effective_at <= stay_row.checked_in_at then raise exception '퇴실 완료 시각은 입실 완료 시각보다 늦어야 합니다.' using errcode = '22023'; end if;
  if stay_row.checked_out_at is not null then return public.hotel_stay_json(p_hotel_stay_id); end if;
  select * into capacity_row from public.hotel_capacity_reservations capacity
    where capacity.hotel_stay_id = p_hotel_stay_id and capacity.archived_at is null for update;
  if not found then raise exception '활성 Capacity 예약을 확인할 수 없습니다.' using errcode = 'P0002'; end if;
  select * into final_allocation from public.hotel_room_allocations allocation
  where allocation.capacity_reservation_id = capacity_row.id
    and allocation.archived_at is null
  order by allocation.allocated_until desc, allocation.allocated_from desc
  limit 1 for update;
  if not found then raise exception '퇴실 처리할 최종 호실 배정을 확인할 수 없습니다.' using errcode = 'P0002'; end if;
  if effective_at <= final_allocation.allocated_from then
    raise exception '퇴실 완료 시각은 최종 호실 배정 시작보다 늦어야 합니다.' using errcode = '22023';
  end if;

  if effective_at > capacity_row.reserved_until then
    perform public.assert_hotel_capacity_available(
      capacity_row.room_type_id, capacity_row.reserved_from, effective_at,
      capacity_row.quantity, capacity_row.id
    );
    -- 기존 Capacity를 먼저 바꾸지 않고 예상 종료시각 기준으로 호실 충돌을 검사한다.
    perform pg_advisory_xact_lock(
      hashtextextended('hotel-room:' || final_allocation.room_id::text, 0)
    );
    if exists (
      select 1 from public.hotel_room_allocations other_allocation
      where other_allocation.room_id = final_allocation.room_id
        and other_allocation.archived_at is null
        and other_allocation.id <> final_allocation.id
        and other_allocation.allocated_from < effective_at
        and other_allocation.allocated_until > final_allocation.allocated_from
    ) then
      raise exception '실제 퇴실 시각까지 최종 호실을 연장할 수 없습니다.'
        using errcode = '23P01';
    end if;
  end if;

  perform set_config('app.operation_change_reason', '호텔 퇴실 완료', true);
  perform set_config('app.operation_request_id', p_request_id::text, true);
  if effective_at > capacity_row.reserved_until then
    update public.hotel_capacity_reservations capacity
    set reserved_until = effective_at, updated_by = actor_id
    where capacity.id = capacity_row.id;
  end if;
  update public.hotel_room_allocations allocation
  set allocated_until = effective_at, updated_by = actor_id
  where allocation.id = final_allocation.id;
  update public.hotel_stays
  set checked_out_at = effective_at,
      checked_out_by = actor_id,
      checkout_previous_reserved_until = capacity_row.reserved_until,
      checkout_previous_allocation_id = final_allocation.id,
      checkout_previous_allocation_until = final_allocation.allocated_until,
      updated_by = actor_id
  where id = p_hotel_stay_id;
  return public.hotel_stay_json(p_hotel_stay_id);
end;
$$;
CREATE FUNCTION public.hotel_history_semantic_010(p_kind text,p_row jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE keys text[]; required_keys text[]; k text; v jsonb; result jsonb:='{}';
BEGIN
 keys:=CASE p_kind
 WHEN 'hotel_stays' THEN ARRAY['id','dog_id','checked_in_at','checked_out_at','checkout_previous_allocation_id','checkout_previous_allocation_until','checkout_previous_reserved_until','archived_at']
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
END $$;
CREATE FUNCTION public.hotel_history_chain_010(p_kind text,p_row jsonb,p_audits jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE x jsonb; previous jsonb; current_value jsonb; n integer:=0;
BEGIN
 IF coalesce(p_row->>'version','') !~ '^[1-9][0-9]*$' THEN RETURN false; END IF;
 FOR x IN SELECT value FROM jsonb_array_elements(p_audits)
 WHERE value->>'entity_type'=p_kind AND value->>'entity_id'=p_row->>'id'
 AND value->'after_data' ? 'created_at'
 ORDER BY (value->'after_data'->>'version')::integer LOOP
  n:=n+1; current_value:=public.hotel_history_semantic_010(p_kind,x->'after_data');
  IF current_value IS NULL OR x->'after_data'->>'version' IS DISTINCT FROM n::text THEN RETURN false; END IF;
  IF n=1 THEN
   IF x->>'action' IS DISTINCT FROM 'created' OR nullif(x->'before_data','null') IS NOT NULL THEN RETURN false; END IF;
  ELSIF x->'before_data'->>'version' IS DISTINCT FROM (n-1)::text
   OR public.hotel_history_semantic_010(p_kind,x->'before_data') IS DISTINCT FROM previous THEN RETURN false;
  END IF;
  previous:=current_value;
 END LOOP;
 RETURN coalesce(n>0 AND n::text=p_row->>'version' AND previous=public.hotel_history_semantic_010(p_kind,p_row),false);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN false;
END $$;
CREATE FUNCTION public.hotel_history_planned_adjustment_010(p jsonb,a jsonb,c jsonb,e jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE b jsonb:=e->'before_data'; n jsonb:=e->'after_data'; ca jsonb; root jsonb; req jsonb; snap jsonb; sa jsonb;
 matches integer:=0; roots integer; caps integer; allocations integer; s jsonb:=p->'stay';
BEGIN
 IF p->>'kind' IS DISTINCT FROM 'single' OR e->>'action' IS DISTINCT FROM 'updated'
  OR e->>'change_reason' IS DISTINCT FROM '입실 후 퇴실 예정 변경'
  OR b->>'id' IS DISTINCT FROM a->>'id' OR n->>'id' IS DISTINCT FROM a->>'id'
  OR b->>'archived_at' IS NOT NULL OR n->>'archived_at' IS NOT NULL
  OR c->>'source_kind' IS DISTINCT FROM 'stay' OR c->>'hotel_stay_id' IS DISTINCT FROM s->>'id'
  OR c->>'physical_occupancy_id' IS NOT NULL OR c->>'shared_room_group_id' IS NOT NULL
  OR c->>'quantity' IS DISTINCT FROM '1'
  OR (public.hotel_history_semantic_010('hotel_room_allocations',b)-'allocated_until') IS DISTINCT FROM
     (public.hotel_history_semantic_010('hotel_room_allocations',n)-'allocated_until')
  OR (b->>'allocated_until')::timestamptz IS NOT DISTINCT FROM (n->>'allocated_until')::timestamptz
  OR NOT public.hotel_history_chain_010('hotel_stays',s,p->'audits')
  OR NOT public.hotel_history_chain_010('hotel_room_allocations',a,p->'audits')
  OR NOT public.hotel_history_chain_010('hotel_capacity_reservations',c,p->'audits') THEN RETURN false; END IF;
 FOR req IN SELECT value FROM jsonb_array_elements(coalesce(p->'plannedRequests','[]')) LOOP
  IF req->>'request_id' IS NULL OR req->>'hotel_stay_id' IS DISTINCT FROM s->>'id'
   OR req->>'completed_at' IS NULL OR jsonb_typeof(req->'response') IS DISTINCT FROM 'object' THEN CONTINUE; END IF;
  snap:=req->'response';
  IF snap->>'id' IS DISTINCT FROM s->>'id' OR snap->>'dogId' IS DISTINCT FROM s->>'dog_id' THEN CONTINUE; END IF;
  SELECT count(*) INTO roots FROM jsonb_array_elements(p->'audits') x WHERE x->>'entity_type'='hotel_stays' AND x->>'entity_id'=s->>'id'
   AND x->>'request_id'=req->>'request_id' AND x->'after_data' ? 'created_at'
   AND x->'after_data'->>'version'=snap->>'version';
  IF roots<>1 THEN CONTINUE; END IF;
  SELECT x INTO root FROM jsonb_array_elements(p->'audits') x WHERE x->>'entity_type'='hotel_stays' AND x->>'entity_id'=s->>'id'
   AND x->>'request_id'=req->>'request_id' AND x->'after_data' ? 'created_at' AND x->'after_data'->>'version'=snap->>'version';
  IF root->>'action' IS DISTINCT FROM 'updated' OR root->>'change_reason' IS DISTINCT FROM '입실 후 퇴실 예정 변경'
   OR root->'before_data'->>'checked_in_at' IS NULL OR root->'after_data'->>'checked_out_at' IS NOT NULL
   OR root->'before_data'->>'archived_at' IS NOT NULL OR root->'after_data'->>'archived_at' IS NOT NULL
   OR public.hotel_history_semantic_010('hotel_stays',root->'before_data') IS DISTINCT FROM public.hotel_history_semantic_010('hotel_stays',root->'after_data')
   OR (snap->>'checkedInAt')::timestamptz IS DISTINCT FROM (root->'after_data'->>'checked_in_at')::timestamptz
   OR snap->>'checkedOutAt' IS NOT NULL OR snap->>'archivedAt' IS NOT NULL
   OR (n->>'allocated_until')::timestamptz <= (snap->>'checkedInAt')::timestamptz THEN CONTINUE; END IF;
  SELECT count(*) INTO allocations FROM jsonb_array_elements(snap->'roomAllocations') x WHERE x->>'id'=a->>'id';
  IF allocations<>1 THEN CONTINUE; END IF;
  SELECT x INTO sa FROM jsonb_array_elements(snap->'roomAllocations') x WHERE x->>'id'=a->>'id';
  IF sa->>'version' IS DISTINCT FROM n->>'version' OR sa->>'roomId' IS DISTINCT FROM n->>'room_id'
   OR (sa->>'allocatedFrom')::timestamptz IS DISTINCT FROM (n->>'allocated_from')::timestamptz
   OR (sa->>'allocatedUntil')::timestamptz IS DISTINCT FROM (n->>'allocated_until')::timestamptz
   OR sa->>'roomTypeId' IS DISTINCT FROM c->>'room_type_id'
   OR snap->'capacityReservation'->>'id' IS DISTINCT FROM c->>'id'
   OR snap->'capacityReservation'->>'roomTypeId' IS DISTINCT FROM c->>'room_type_id'
   OR snap->'capacityReservation'->>'quantity' IS DISTINCT FROM c->>'quantity'
   OR (snap->'capacityReservation'->>'reservedFrom')::timestamptz IS DISTINCT FROM (c->>'reserved_from')::timestamptz
   OR (snap->'capacityReservation'->>'reservedUntil')::timestamptz IS DISTINCT FROM (n->>'allocated_until')::timestamptz
   OR (e->>'request_id' IS NOT NULL AND e->>'request_id'<>req->>'request_id') THEN CONTINUE; END IF;
  -- Capacity response has no version in the established DTO. Require a unique
  -- exact before/after edge; repeated identical edges cannot be guessed apart.
  SELECT count(*) INTO caps FROM jsonb_array_elements(p->'audits') x
   WHERE x->>'entity_type'='hotel_capacity_reservations' AND x->>'entity_id'=c->>'id' AND x->'after_data' ? 'created_at'
   AND (x->'before_data'->>'reserved_until')::timestamptz=(b->>'allocated_until')::timestamptz
   AND (x->'after_data'->>'reserved_until')::timestamptz=(n->>'allocated_until')::timestamptz;
  IF caps<>1 THEN CONTINUE; END IF;
  SELECT x INTO ca FROM jsonb_array_elements(p->'audits') x
   WHERE x->>'entity_type'='hotel_capacity_reservations' AND x->>'entity_id'=c->>'id' AND x->'after_data' ? 'created_at'
   AND (x->'before_data'->>'reserved_until')::timestamptz=(b->>'allocated_until')::timestamptz
   AND (x->'after_data'->>'reserved_until')::timestamptz=(n->>'allocated_until')::timestamptz;
  IF ca->>'action' IS DISTINCT FROM 'updated' OR ca->>'change_reason' IS DISTINCT FROM '입실 후 퇴실 예정 변경'
   OR (ca->>'request_id' IS NOT NULL AND ca->>'request_id'<>req->>'request_id')
   OR ca->'before_data'->>'archived_at' IS NOT NULL OR ca->'after_data'->>'archived_at' IS NOT NULL
   OR (public.hotel_history_semantic_010('hotel_capacity_reservations',ca->'before_data')-'reserved_until') IS DISTINCT FROM
      (public.hotel_history_semantic_010('hotel_capacity_reservations',ca->'after_data')-'reserved_until')
   OR (public.hotel_history_semantic_010('hotel_capacity_reservations',ca->'after_data')-'reserved_until') IS DISTINCT FROM
      (public.hotel_history_semantic_010('hotel_capacity_reservations',c)-'reserved_until')
   OR ca->'after_data'->>'hotel_stay_id' IS DISTINCT FROM s->>'id'
   OR ca->'after_data'->>'source_kind' IS DISTINCT FROM 'stay'
   OR ca->'after_data'->>'physical_occupancy_id' IS NOT NULL OR ca->'after_data'->>'shared_room_group_id' IS NOT NULL THEN CONTINUE; END IF;
  matches:=matches+1;
 END LOOP;
 RETURN matches=1;
EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow OR numeric_value_out_of_range OR invalid_parameter_value THEN RETURN false;
END $$;
CREATE OR REPLACE FUNCTION public.hotel_history_individual_010(p jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE s jsonb:=p->'stay'; audits jsonb:=p->'audits'; a jsonb; c jsonb; x jsonb;
 prev jsonb; leave_row jsonb; return_row jsonb; receipt jsonb; room jsonb;
 segments jsonb:='[]'; absences jsonb:='[]'; reason text:='AUDIT_CHAIN_UNPROVEN';
 lo timestamptz; hi timestamptz; required_until timestamptz; start_at timestamptz; end_at timestamptz; leave_at timestamptz; return_at timestamptz;
 cursor_at timestamptz; piece_start timestamptz; piece_end timestamptz; last_absence_end timestamptz;
 longstay boolean:=p->>'kind'='longstay'; matched integer; first_segment boolean:=true;
BEGIN
 lo:=(s->>'checked_in_at')::timestamptz;
 hi:=least(coalesce((s->>'checked_out_at')::timestamptz,'infinity'),(p->>'asOf')::timestamptz);
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
      END) AND (longstay OR NOT public.hotel_history_planned_adjustment_010(p,a,c,e)))
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
   'endEvent',CASE WHEN end_at=(s->>'checked_out_at')::timestamptz THEN 'check_out' WHEN longstay AND end_at=leave_at THEN 'left_for_absence' ELSE 'moved_out' END));
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
END $$;

CREATE FUNCTION public.has_operation_role(text[]) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT auth.uid() IS NOT NULL $$;
CREATE FUNCTION public.can_manage_operation_schedule(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT auth.uid() IS NOT NULL $$;
ALTER TABLE public.operation_schedules ADD title text, ADD updated_by uuid, ADD time_unspecified boolean DEFAULT false;
CREATE OR REPLACE FUNCTION public.reverse_hotel_completion(p_hotel_stay_id uuid, p_expected_version integer, p_completion_kind text, p_reason text, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  actor_id uuid := auth.uid();
  stay_row public.hotel_stays%rowtype;
  capacity_row public.hotel_capacity_reservations%rowtype;
  final_allocation public.hotel_room_allocations%rowtype;
begin
  if actor_id is null
    or not public.has_operation_role(
      array['owner', 'manager']
    ) then
    raise exception 'Operations Owner/Manager만 완료 상태를 되돌릴 수 있습니다.'
      using errcode = '42501';
  end if;

  if p_request_id is null
    or p_expected_version is null
    or p_completion_kind not in (
      'check_in',
      'check_out'
    )
    or nullif(btrim(p_reason), '') is null then
    raise exception '완료 종류, 요청 ID, 기존 버전, 되돌리기 사유가 필요합니다.'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'hotel-request:' || p_request_id::text,
      0
    )
  );

  if public.is_replayed_hotel_stay_request(
    p_hotel_stay_id,
    p_request_id
  ) then
    return public.hotel_stay_json(p_hotel_stay_id);
  end if;

  select *
  into stay_row
  from public.hotel_stays stay
  where stay.id = p_hotel_stay_id
  for update;

  if not found
    or stay_row.archived_at is not null then
    raise exception '활성 호텔 예약을 확인할 수 없습니다.'
      using errcode = 'P0002';
  end if;

  if stay_row.version <> p_expected_version then
    raise exception '다른 사용자가 먼저 처리했습니다.'
      using errcode = '40001';
  end if;

  if p_completion_kind = 'check_in'
    and stay_row.checked_out_at is not null then
    raise exception '퇴실 완료를 먼저 되돌려야 합니다.'
      using errcode = '22023';
  end if;

  perform set_config(
    'app.operation_change_reason',
    btrim(p_reason),
    true
  );

  perform set_config(
    'app.operation_request_id',
    p_request_id::text,
    true
  );

  if p_completion_kind = 'check_in' then
    update public.hotel_stays
    set
      checked_in_at = null,
      checked_in_by = null,
      updated_by = actor_id
    where id = p_hotel_stay_id;

  else
    if stay_row.checked_out_at is null
      or stay_row.checkout_previous_reserved_until is null
      or stay_row.checkout_previous_allocation_id is null
      or stay_row.checkout_previous_allocation_until is null then
      raise exception '되돌릴 퇴실 완료 기록을 확인할 수 없습니다.'
        using errcode = 'P0002';
    end if;

    select *
    into capacity_row
    from public.hotel_capacity_reservations capacity
    where capacity.hotel_stay_id = p_hotel_stay_id
      and capacity.archived_at is null
    for update;

    select *
    into final_allocation
    from public.hotel_room_allocations allocation
    where allocation.id =
      stay_row.checkout_previous_allocation_id
      and allocation.capacity_reservation_id =
        capacity_row.id
      and allocation.archived_at is null
    for update;

    if not found then
      raise exception '복원할 최종 호실 배정 기록을 확인할 수 없습니다.'
        using errcode = 'P0002';
    end if;

    if stay_row.checkout_previous_allocation_until
      <= final_allocation.allocated_from then
      raise exception '저장된 이전 호실 종료 시각이 유효하지 않습니다.'
        using errcode = '22023';
    end if;

    if stay_row.checkout_previous_reserved_until
      > capacity_row.reserved_until then
      perform public.assert_hotel_capacity_available(
        capacity_row.room_type_id,
        capacity_row.reserved_from,
        stay_row.checkout_previous_reserved_until,
        capacity_row.quantity,
        capacity_row.id
      );
    end if;

    -- Global advisory lock order: Room Type -> Room -> Total Capacity.
    -- The existing room assertion below reuses this transaction-level lock.
    perform pg_advisory_xact_lock(
      hashtextextended(
        'hotel-room:' || final_allocation.room_id::text,
        0
      )
    );

    update public.hotel_capacity_reservations capacity
    set
      reserved_until =
        stay_row.checkout_previous_reserved_until,
      updated_by = actor_id
    where capacity.id = capacity_row.id;

    perform public.assert_hotel_room_allocation_available(
      final_allocation.room_id,
      capacity_row.id,
      final_allocation.allocated_from,
      stay_row.checkout_previous_allocation_until,
      final_allocation.id
    );

    update public.hotel_room_allocations allocation
    set
      allocated_until =
        stay_row.checkout_previous_allocation_until,
      updated_by = actor_id
    where allocation.id = final_allocation.id;

    update public.hotel_stays
    set
      checked_out_at = null,
      checked_out_by = null,
      checkout_previous_reserved_until = null,
      checkout_previous_allocation_id = null,
      checkout_previous_allocation_until = null,
      updated_by = actor_id
    where id = p_hotel_stay_id;
  end if;

  return public.hotel_stay_json(p_hotel_stay_id);
end;
$function$;
create function public.finalize_and_complete_hotel_check_in(
  p_hotel_stay_id uuid,
  p_expected_version integer,
  p_completed_at timestamptz,
  p_room_type_id uuid,
  p_room_id uuid,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  stay_row public.hotel_stays%rowtype;
  capacity_row public.hotel_capacity_reservations%rowtype;
  check_in_schedule public.operation_schedules%rowtype;
  check_out_schedule public.operation_schedules%rowtype;
  current_allocation public.hotel_room_allocations%rowtype;
  allocation_count integer;
  dog_name text;
  room_type_code text;
begin
  if actor_id is null or not public.is_active_operation_member() then
    raise exception '입실 완료 권한이 없습니다.' using errcode = '42501';
  end if;
  if p_request_id is null or p_expected_version is null
    or p_completed_at is null or p_room_type_id is null or p_room_id is null then
    raise exception '입실 시간, 객실 유형, 호실, 요청 ID가 필요합니다.'
      using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended('hotel-request:' || p_request_id::text, 0)
  );
  if public.is_replayed_hotel_stay_request(p_hotel_stay_id, p_request_id) then
    return public.hotel_stay_json(p_hotel_stay_id);
  end if;

  select stay.* into stay_row
  from public.hotel_stays stay
  where stay.id = p_hotel_stay_id for update;
  if not found or stay_row.archived_at is not null then
    raise exception '활성 호텔 예약을 확인할 수 없습니다.' using errcode = 'P0002';
  end if;
  if stay_row.version <> p_expected_version then
    raise exception '다른 사용자가 먼저 처리했습니다.' using errcode = '40001';
  end if;
  if stay_row.checked_in_at is not null then
    return public.hotel_stay_json(p_hotel_stay_id);
  end if;

  select capacity.* into capacity_row
  from public.hotel_capacity_reservations capacity
  where capacity.hotel_stay_id = p_hotel_stay_id
    and capacity.archived_at is null
  for update;
  select schedule.* into check_in_schedule
  from public.hotel_stay_schedule_events event
  join public.operation_schedules schedule
    on schedule.id = event.operation_schedule_id
  where event.hotel_stay_id = p_hotel_stay_id
    and event.event_kind = 'check_in'
    and event.archived_at is null
  for update of schedule;
  select schedule.* into check_out_schedule
  from public.hotel_stay_schedule_events event
  join public.operation_schedules schedule
    on schedule.id = event.operation_schedule_id
  where event.hotel_stay_id = p_hotel_stay_id
    and event.event_kind = 'check_out'
    and event.archived_at is null
  for update of schedule;
  if capacity_row.id is null
    or check_in_schedule.id is null
    or check_out_schedule.id is null then
    raise exception '호텔 예약 연결 구조가 완전하지 않습니다.' using errcode = 'P0002';
  end if;
  if (p_completed_at at time zone 'Asia/Seoul')::date
    <> (check_in_schedule.starts_at at time zone 'Asia/Seoul')::date then
    raise exception '입실 완료 시각은 기존 입실 예약일 내에서만 확정할 수 있습니다.'
      using errcode = '22023';
  end if;
  if not public.can_manage_operation_schedule(check_in_schedule.id) then
    raise exception '입실 Calendar 일정을 수정할 권한이 없습니다.'
      using errcode = '42501';
  end if;
  if p_completed_at >= capacity_row.reserved_until then
    raise exception '입실 완료 시각은 현재 퇴실 Capacity 종료보다 빨라야 합니다.'
      using errcode = '22023';
  end if;

  select room_type.code into room_type_code
  from public.hotel_room_types room_type
  where room_type.id = p_room_type_id
    and room_type.is_active and room_type.archived_at is null;
  select dog.name into dog_name from public.dogs dog where dog.id = stay_row.dog_id;
  if room_type_code is null or dog_name is null then
    raise exception '활성 객실 유형 또는 반려견을 확인할 수 없습니다.'
      using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from public.hotel_rooms room
    where room.id = p_room_id
      and room.room_type_id = p_room_type_id
      and room.is_active and room.archived_at is null
  ) then
    raise exception '선택한 객실 유형에 속한 활성 호실이 아닙니다.'
      using errcode = '22023';
  end if;
  select count(*)::integer into allocation_count
  from public.hotel_room_allocations allocation
  where allocation.capacity_reservation_id = capacity_row.id
    and allocation.archived_at is null;
  if allocation_count > 1 then
    raise exception '입실 전 활성 호실 배정은 최대 1건이어야 합니다.'
      using errcode = '22023';
  end if;
  if allocation_count = 1 then
    select allocation.* into current_allocation
    from public.hotel_room_allocations allocation
    where allocation.capacity_reservation_id = capacity_row.id
      and allocation.archived_at is null
    for update;
  end if;

  -- 글로벌 Advisory Lock 순서: 객실 유형 -> 호실 -> 전체 Capacity.
  perform public.assert_hotel_capacity_available(
    p_room_type_id,
    p_completed_at,
    capacity_row.reserved_until,
    1,
    capacity_row.id
  );
  perform pg_advisory_xact_lock(
    hashtextextended('hotel-room:' || p_room_id::text, 0)
  );

  perform set_config('app.operation_change_reason', '입실 시 미정 예약 확정', true);
  perform set_config('app.operation_request_id', '', true);
  update public.hotel_capacity_reservations capacity
  set room_type_id = p_room_type_id,
      reserved_from = p_completed_at,
      updated_by = actor_id
  where capacity.id = capacity_row.id;

  if allocation_count = 1 and current_allocation.room_id <> p_room_id then
    update public.hotel_room_allocations allocation
    set archived_at = now(), archived_by = actor_id,
        archive_reason = '입실 완료 시 호실 확정 변경',
        updated_by = actor_id
    where allocation.id = current_allocation.id;
    allocation_count := 0;
  end if;

  perform public.assert_hotel_room_allocation_available(
    p_room_id,
    capacity_row.id,
    p_completed_at,
    capacity_row.reserved_until,
    case when allocation_count = 1 then current_allocation.id else null end
  );
  if allocation_count = 1 then
    update public.hotel_room_allocations allocation
    set allocated_from = p_completed_at,
        allocated_until = capacity_row.reserved_until,
        updated_by = actor_id
    where allocation.id = current_allocation.id;
  else
    insert into public.hotel_room_allocations (
      capacity_reservation_id, room_id, allocated_from, allocated_until,
      assignment_reason, request_id, created_by, updated_by
    ) values (
      capacity_row.id, p_room_id, p_completed_at, capacity_row.reserved_until,
      '입실 완료 시 호실 확정', null, actor_id, actor_id
    );
  end if;

  perform set_config('app.operation_request_id', gen_random_uuid()::text, true);
  update public.operation_schedules schedule
  set starts_at = p_completed_at,
      ends_at = p_completed_at + interval '1 hour',
      time_unspecified = false,
      title = format('%s · 호텔링 · %s · 입실', dog_name, room_type_code),
      updated_by = actor_id
  where schedule.id = check_in_schedule.id;
  perform set_config('app.operation_request_id', gen_random_uuid()::text, true);
  update public.operation_schedules schedule
  set title = format('%s · 호텔링 · %s · 퇴실', dog_name, room_type_code),
      updated_by = actor_id
  where schedule.id = check_out_schedule.id;

  perform set_config('app.operation_request_id', p_request_id::text, true);
  update public.hotel_stays stay
  set checked_in_at = p_completed_at,
      checked_in_by = actor_id,
      updated_by = actor_id
  where stay.id = p_hotel_stay_id;

  return public.hotel_stay_json(p_hotel_stay_id);
end;
$$;
create or replace function public.assert_hotel_capacity_available(
  p_room_type_id uuid,
  p_reserved_from timestamptz,
  p_reserved_until timestamptz,
  p_quantity integer default 1,
  p_exclude_reservation_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  active_room_count integer;
  peak_reserved integer;
begin
  if p_room_type_id is null or p_reserved_from is null or p_reserved_until is null
    or p_reserved_until <= p_reserved_from or p_quantity <> 1 then
    raise exception '유효한 객실 유형과 예약 기간이 필요합니다.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('hotel-capacity:' || p_room_type_id::text, 0));

  select count(*) into active_room_count
  from public.hotel_rooms room
  join public.hotel_room_types room_type on room_type.id = room.room_type_id
  where room.room_type_id = p_room_type_id
    and room.is_active and room.archived_at is null
    and room_type.is_active and room_type.archived_at is null;

  if active_room_count = 0 then
    raise exception '예약 가능한 활성 객실이 없습니다.' using errcode = '22023';
  end if;

  with intervals as (
    select greatest(reservation.reserved_from, p_reserved_from) as starts_at,
      least(reservation.reserved_until, p_reserved_until) as ends_at,
      reservation.quantity::integer as quantity
    from public.hotel_capacity_reservations reservation
    where reservation.room_type_id = p_room_type_id
      and reservation.archived_at is null
      and reservation.id is distinct from p_exclude_reservation_id
      and reservation.reserved_from < p_reserved_until
      and reservation.reserved_until > p_reserved_from
    union all
    select p_reserved_from, p_reserved_until, p_quantity
  ), points as (
    select starts_at as point_at, quantity as delta from intervals
    union all
    select ends_at as point_at, -quantity as delta from intervals
  ), deltas as (
    select point_at, sum(delta) as delta from points group by point_at
  ), running as (
    select point_at, sum(delta) over (order by point_at rows unbounded preceding) as occupancy
    from deltas
  )
  select coalesce(max(occupancy), 0)::integer into peak_reserved from running;

  if peak_reserved > active_room_count then
    raise exception '선택한 기간의 객실 유형 Capacity가 부족합니다.'
      using errcode = '23514',
        detail = format('active_rooms=%s, requested_peak=%s', active_room_count, peak_reserved);
  end if;
end;
$$;
