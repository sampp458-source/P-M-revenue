-- Unassigned DELUXE Shared Room reservation and later physical-room allocation.
-- Historical migrations and public RPC signatures remain intact.

begin;

do $$
begin
  if to_regclass('public.hotel_capacity_reservations') is null
    or to_regclass('public.family_bookings') is null
    or to_regclass('public.family_booking_members') is null
    or to_regclass('public.family_shared_room_groups') is null
    or to_regclass('public.hotel_physical_occupancies') is null
    or to_regprocedure('public.create_shared_hotel_room_occupancy(uuid,uuid,uuid)') is null
    or to_regprocedure('public.create_unassigned_shared_room_family_booking(uuid,text,boolean,jsonb,uuid,boolean,uuid)') is not null
    or exists (
      select 1
      from public.family_shared_room_groups shared_group
      where shared_group.archived_at is null
        and shared_group.status = 'requested'
    )
  then
    raise exception 'STOP_UNASSIGNED_SHARED_ROOM_BACKEND_BASELINE';
  end if;
end;
$$;

alter table public.hotel_capacity_reservations
  add column shared_room_group_id uuid null
    references public.family_shared_room_groups(id) on delete restrict;

alter table public.hotel_capacity_reservations
  drop constraint hotel_capacity_reservations_source_kind_check;
alter table public.hotel_capacity_reservations
  add constraint hotel_capacity_reservations_source_kind_check
  check (source_kind in ('stay','daycare','shared_group','shared_occupancy'));

alter table public.hotel_capacity_reservations
  drop constraint hotel_capacity_reservations_source_check;
alter table public.hotel_capacity_reservations
  add constraint hotel_capacity_reservations_source_check check (
    (source_kind = 'stay'
      and hotel_stay_id is not null
      and daycare_schedule_id is null
      and shared_room_group_id is null
      and physical_occupancy_id is null)
    or (source_kind = 'daycare'
      and hotel_stay_id is null
      and daycare_schedule_id is not null
      and shared_room_group_id is null
      and physical_occupancy_id is null)
    or (source_kind = 'shared_group'
      and hotel_stay_id is null
      and daycare_schedule_id is null
      and shared_room_group_id is not null
      and physical_occupancy_id is null)
    or (source_kind = 'shared_occupancy'
      and hotel_stay_id is null
      and daycare_schedule_id is null
      and shared_room_group_id is null
      and physical_occupancy_id is not null)
  );

alter table public.hotel_capacity_reservations
  add constraint hotel_capacity_reservations_shared_group_quantity_check
  check (source_kind <> 'shared_group' or quantity = 1);

create unique index hotel_capacity_reservations_shared_group_uidx
  on public.hotel_capacity_reservations(shared_room_group_id)
  where source_kind = 'shared_group' and archived_at is null;

create index hotel_capacity_reservations_shared_group_lookup_idx
  on public.hotel_capacity_reservations(
    shared_room_group_id, reserved_from, reserved_until
  ) where shared_room_group_id is not null;

-- Every typed Capacity uses the canonical aggregate -> type lock order. This
-- makes Shared-vs-Single last-room competition deterministic without changing
-- the function signature or availability semantics.
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

  perform pg_advisory_xact_lock(hashtextextended('hotel-capacity:all', 0));
  perform pg_advisory_xact_lock(hashtextextended(
    'hotel-capacity:' || p_room_type_id::text, 0
  ));

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
    select greatest(reservation.reserved_from, p_reserved_from) starts_at,
      least(reservation.reserved_until, p_reserved_until) ends_at,
      reservation.quantity::integer quantity
    from public.hotel_capacity_reservations reservation
    where reservation.room_type_id = p_room_type_id
      and reservation.archived_at is null
      and reservation.id is distinct from p_exclude_reservation_id
      and reservation.reserved_from < p_reserved_until
      and reservation.reserved_until > p_reserved_from
    union all
    select p_reserved_from, p_reserved_until, p_quantity
  ), points as (
    select starts_at point_at, quantity delta from intervals
    union all
    select ends_at point_at, -quantity delta from intervals
  ), deltas as (
    select point_at, sum(delta) delta from points group by point_at
  ), running as (
    select sum(delta) over (
      order by point_at rows unbounded preceding
    ) occupancy
    from deltas
  )
  select coalesce(max(occupancy), 0)::integer into peak_reserved from running;

  if peak_reserved > active_room_count then
    raise exception '선택한 기간의 객실 유형 Capacity가 부족합니다.'
      using errcode = '23514',
        detail = format(
          'active_rooms=%s, requested_peak=%s',
          active_room_count, peak_reserved
        );
  end if;
end;
$$;

create function public.assert_requested_shared_room_capacity_internal(
  p_shared_room_group_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  shared_group public.family_shared_room_groups%rowtype;
  family public.family_bookings%rowtype;
  active_group_capacity_count integer;
  active_member_capacity_count integer;
  active_occupancy_count integer;
  active_member_count integer;
begin
  if p_shared_room_group_id is null then return; end if;
  select * into shared_group
  from public.family_shared_room_groups
  where id = p_shared_room_group_id;
  if not found or shared_group.archived_at is not null then return; end if;

  select * into family
  from public.family_bookings
  where id = shared_group.family_booking_id and archived_at is null;
  if not found then
    raise exception 'Shared Room Family Booking을 확인할 수 없습니다.'
      using errcode = '23514';
  end if;

  select count(*)::integer into active_group_capacity_count
  from public.hotel_capacity_reservations capacity
  where capacity.shared_room_group_id = shared_group.id
    and capacity.source_kind = 'shared_group'
    and capacity.archived_at is null;

  select count(*)::integer into active_member_capacity_count
  from public.hotel_capacity_reservations capacity
  where capacity.archived_at is null
    and exists (
      select 1 from public.family_booking_members member
      where member.shared_room_group_id = shared_group.id
        and member.hotel_stay_id = capacity.hotel_stay_id
        and member.archived_at is null
    );

  select count(*)::integer into active_occupancy_count
  from public.hotel_physical_occupancies occupancy
  where occupancy.shared_room_group_id = shared_group.id
    and occupancy.archived_at is null;

  select count(*)::integer into active_member_count
  from public.family_booking_members member
  join public.hotel_stays stay on stay.id = member.hotel_stay_id
  join public.dogs dog on dog.id = member.dog_id
  where member.shared_room_group_id = shared_group.id
    and member.family_booking_id = family.id
    and member.service_type = 'hotel'
    and member.archived_at is null
    and stay.archived_at is null
    and stay.dog_id = member.dog_id
    and dog.customer_id = family.customer_id;

  if shared_group.status = 'requested' then
    if active_group_capacity_count <> 1
      or active_member_capacity_count <> 0
      or active_occupancy_count <> 0
      or active_member_count <> shared_group.requested_capacity
      or not exists (
        select 1
        from public.hotel_capacity_reservations capacity
        join public.hotel_room_types room_type
          on room_type.id = capacity.room_type_id
        where capacity.shared_room_group_id = shared_group.id
          and capacity.source_kind = 'shared_group'
          and capacity.archived_at is null
          and capacity.quantity = 1
          and capacity.room_type_id = shared_group.room_type_id
          and capacity.reserved_from = shared_group.normalized_starts_at
          and capacity.reserved_until = shared_group.normalized_ends_at
          and room_type.is_active and room_type.archived_at is null
          and upper(btrim(room_type.code)) = 'DELUXE'
          and upper(btrim(room_type.name)) = 'DELUXE'
          and not exists (
            select 1 from public.hotel_room_allocations allocation
            where allocation.capacity_reservation_id = capacity.id
              and allocation.archived_at is null
          )
      ) then
      raise exception '미배정 Shared Room Capacity 계약이 올바르지 않습니다.'
        using errcode = '23514';
    end if;
  elsif active_group_capacity_count <> 0 then
    raise exception 'requested 상태가 아닌 Shared Group에는 미배정 Capacity가 남을 수 없습니다.'
      using errcode = '23514';
  end if;
end;
$$;

create function public.enforce_requested_shared_room_capacity_deferred()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare group_id uuid;
begin
  if tg_table_name = 'family_shared_room_groups' then
    group_id := coalesce(new.id, old.id);
  elsif tg_table_name = 'family_booking_members' then
    group_id := coalesce(new.shared_room_group_id, old.shared_room_group_id);
  else
    group_id := coalesce(new.shared_room_group_id, old.shared_room_group_id);
  end if;
  if group_id is not null then
    perform public.assert_requested_shared_room_capacity_internal(group_id);
  end if;
  return coalesce(new, old);
end;
$$;

create constraint trigger family_shared_room_groups_requested_capacity_invariant
after insert or update on public.family_shared_room_groups
deferrable initially deferred
for each row execute function public.enforce_requested_shared_room_capacity_deferred();

create constraint trigger family_booking_members_requested_capacity_invariant
after insert or update on public.family_booking_members
deferrable initially deferred
for each row execute function public.enforce_requested_shared_room_capacity_deferred();

create constraint trigger hotel_capacity_requested_shared_group_invariant
after insert or update on public.hotel_capacity_reservations
deferrable initially deferred
for each row execute function public.enforce_requested_shared_room_capacity_deferred();

create function public.guard_requested_shared_room_member_mutation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare protected_member boolean := false;
begin
  if tg_table_name = 'hotel_stays' then
    select exists (
      select 1
      from public.family_booking_members member
      join public.family_shared_room_groups shared_group
        on shared_group.id = member.shared_room_group_id
      where member.hotel_stay_id = old.id
        and member.archived_at is null
        and shared_group.archived_at is null
        and shared_group.status = 'requested'
    ) into protected_member;
    if protected_member and (
      new.dog_id is distinct from old.dog_id
      or new.checked_in_at is distinct from old.checked_in_at
      or new.checked_out_at is distinct from old.checked_out_at
      or new.archived_at is distinct from old.archived_at
    ) then
      raise exception '미배정 함께 투숙 예약은 개별 반려견 단위로 변경하거나 취소할 수 없습니다.'
        using errcode = 'PT409';
    end if;
  elsif tg_table_name = 'operation_schedules' then
    select exists (
      select 1
      from public.hotel_stay_schedule_events event
      join public.family_booking_members member
        on member.hotel_stay_id = event.hotel_stay_id
      join public.family_shared_room_groups shared_group
        on shared_group.id = member.shared_room_group_id
      where event.operation_schedule_id = old.id
        and event.archived_at is null
        and member.archived_at is null
        and shared_group.archived_at is null
        and shared_group.status = 'requested'
    ) into protected_member;
    if protected_member and (
      new.starts_at is distinct from old.starts_at
      or new.ends_at is distinct from old.ends_at
      or new.status is distinct from old.status
      or new.archived_at is distinct from old.archived_at
      or new.calendar_id is distinct from old.calendar_id
      or new.schedule_type_id is distinct from old.schedule_type_id
      or new.time_unspecified is distinct from old.time_unspecified
    ) then
      raise exception '미배정 함께 투숙 예약의 일정은 그룹 단위 변경 기능이 필요합니다.'
        using errcode = 'PT409';
    end if;
  end if;
  return new;
end;
$$;

create trigger hotel_stays_requested_shared_room_guard
before update on public.hotel_stays
for each row execute function public.guard_requested_shared_room_member_mutation();

create trigger operation_schedules_requested_shared_room_guard
before update on public.operation_schedules
for each row execute function public.guard_requested_shared_room_member_mutation();

create function public.create_unassigned_shared_hotel_stay_internal(
  p_calendar_id uuid,
  p_schedule_type_id uuid,
  p_check_in_date date,
  p_check_in_time time,
  p_check_in_time_unspecified boolean,
  p_check_out_date date,
  p_check_out_time time,
  p_check_out_time_unspecified boolean,
  p_room_type_id uuid,
  p_dog_id uuid,
  p_customer_id uuid,
  p_assignee_ids uuid[],
  p_memo text,
  p_stay_request_id uuid,
  p_check_in_request_id uuid,
  p_check_out_request_id uuid,
  p_actor_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  runtime_input jsonb;
  check_in_schedule jsonb;
  check_out_schedule jsonb;
  stay_id uuid;
begin
  runtime_input := public.prepare_hotel_reservation_runtime_input_internal(
    p_calendar_id, p_schedule_type_id,
    p_check_in_date, p_check_in_time, p_check_in_time_unspecified,
    p_check_out_date, p_check_out_time, p_check_out_time_unspecified,
    p_room_type_id, p_dog_id, p_customer_id, p_assignee_ids, p_memo
  );

  check_in_schedule := public.create_operation_schedule(
    p_calendar_id,
    p_schedule_type_id,
    runtime_input ->> 'checkInTitle',
    (runtime_input ->> 'checkInScheduleAt')::timestamptz,
    (runtime_input ->> 'expectedCheckInEndsAt')::timestamptz,
    false,
    (runtime_input ->> 'checkInTimeUnspecified')::boolean,
    p_memo,
    p_assignee_ids,
    array[p_customer_id],
    array[p_dog_id],
    p_check_in_request_id
  );
  check_out_schedule := public.create_operation_schedule(
    p_calendar_id,
    p_schedule_type_id,
    runtime_input ->> 'checkOutTitle',
    (runtime_input ->> 'checkOutScheduleAt')::timestamptz,
    (runtime_input ->> 'expectedCheckOutEndsAt')::timestamptz,
    false,
    (runtime_input ->> 'checkOutTimeUnspecified')::boolean,
    p_memo,
    p_assignee_ids,
    array[p_customer_id],
    array[p_dog_id],
    p_check_out_request_id
  );

  perform set_config(
    'app.operation_change_reason',
    '미배정 함께 투숙 예약 생성',
    true
  );
  perform set_config('app.operation_request_id', p_stay_request_id::text, true);
  insert into public.hotel_stays(
    dog_id, request_id, created_by, updated_by
  ) values (
    p_dog_id, p_stay_request_id, p_actor_id, p_actor_id
  ) returning id into stay_id;

  insert into public.hotel_stay_schedule_events(
    hotel_stay_id, operation_schedule_id, event_kind, created_by, updated_by
  ) values
    (stay_id, (check_in_schedule ->> 'id')::uuid, 'check_in', p_actor_id, p_actor_id),
    (stay_id, (check_out_schedule ->> 'id')::uuid, 'check_out', p_actor_id, p_actor_id);

  return stay_id;
end;
$$;

revoke all on function public.create_unassigned_shared_hotel_stay_internal(
  uuid,uuid,date,time,boolean,date,time,boolean,uuid,uuid,uuid,uuid[],text,
  uuid,uuid,uuid,uuid
) from public, anon, authenticated;

create function public.create_unassigned_shared_room_family_booking(
  p_customer_id uuid,
  p_common_memo text,
  p_payment_bundle_requested boolean,
  p_members jsonb,
  p_room_type_id uuid,
  p_shared_room_intent boolean,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  canonical_payload_value jsonb;
  payload_hash_value text;
  existing_booking public.family_bookings%rowtype;
  created_family_booking_id uuid;
  created_shared_room_group_id uuid;
  created_shared_capacity_id uuid;
  shared_group_key text;
  member_count integer;
  group_count integer;
  member_value jsonb;
  service_payload jsonb;
  assignee_ids uuid[];
  stay_request_id uuid;
  stay_id uuid;
  member_id uuid;
  group_starts_at timestamptz;
  group_ends_at timestamptz;
  first_member jsonb;
  actual_member_count integer;
  actual_stay_count integer;
  actual_schedule_count integer;
  actual_group_count integer;
  individual_capacity_count integer;
  shared_capacity_count integer;
  occupancy_count integer;
  allocation_count integer;
begin
  if actor_id is null or not public.is_active_operation_member() then
    raise exception '미배정 함께 투숙 예약 생성 권한이 없습니다.'
      using errcode = '42501';
  end if;
  if p_request_id is null then
    raise exception '미배정 함께 투숙 예약 request_id가 필요합니다.'
      using errcode = '22023';
  end if;
  if p_shared_room_intent is distinct from true then
    raise exception '같은 객실에서 함께 투숙할지 명시적으로 선택해야 합니다.'
      using errcode = '23514';
  end if;
  if p_room_type_id is null then
    raise exception 'DELUXE 객실 유형이 필요합니다.' using errcode = '22023';
  end if;

  canonical_payload_value := public.canonicalize_family_booking_payload(
    p_customer_id, p_common_memo, p_payment_bundle_requested, p_members
  );
  perform public.assert_family_booking_payload(canonical_payload_value);
  payload_hash_value := public.family_booking_payload_hash(
    canonical_payload_value
  );
  member_count := jsonb_array_length(canonical_payload_value -> 'members');

  if member_count < 2 then
    raise exception '같은 객실 예약에는 반려견 두 마리 이상이 필요합니다.'
      using errcode = '23514';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(canonical_payload_value -> 'members') member(value)
    where member.value ->> 'serviceType' <> 'hotel'
      or member.value ->> 'sharedRoomGroupKey' is null
      or (member.value -> 'servicePayload' ->> 'roomTypeId')::uuid
        is distinct from p_room_type_id
  ) then
    raise exception '모든 반려견은 동일한 DELUXE 함께 투숙 예약이어야 합니다.'
      using errcode = '23514';
  end if;

  select count(distinct member.value ->> 'sharedRoomGroupKey'),
    min(member.value ->> 'sharedRoomGroupKey')
  into group_count, shared_group_key
  from jsonb_array_elements(canonical_payload_value -> 'members') member(value);
  if group_count <> 1 or shared_group_key is null then
    raise exception '하나의 함께 투숙 그룹만 생성할 수 있습니다.'
      using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.hotel_room_types room_type
    where room_type.id = p_room_type_id
      and room_type.is_active and room_type.archived_at is null
      and upper(btrim(room_type.code)) = 'DELUXE'
      and upper(btrim(room_type.name)) = 'DELUXE'
  ) then
    raise exception '함께 투숙 예약은 활성 DELUXE만 사용할 수 있습니다.'
      using errcode = '23514';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'family-booking-request:' || p_request_id::text, 0
  ));
  select * into existing_booking
  from public.family_bookings booking
  where booking.request_id = p_request_id;
  if existing_booking.id is not null then
    if existing_booking.archived_at is not null
      or existing_booking.canonical_payload_hash <> payload_hash_value
      or existing_booking.canonical_payload <> canonical_payload_value then
      raise exception '동일 request_id의 함께 투숙 예약 입력이 일치하지 않습니다.'
        using errcode = '23505';
    end if;
    select shared_group.id into created_shared_room_group_id
    from public.family_shared_room_groups shared_group
    where shared_group.family_booking_id = existing_booking.id
      and shared_group.stable_group_key = shared_group_key
      and shared_group.archived_at is null;
    perform public.assert_requested_shared_room_capacity_internal(
      created_shared_room_group_id
    );
    return jsonb_build_object(
      'familyBooking', public.family_booking_json(existing_booking.id),
      'sharedRoomGroupId', created_shared_room_group_id,
      'replayed', true
    );
  end if;

  perform 1 from public.customers customer
  where customer.id = p_customer_id and customer.is_active
  for update;
  perform 1 from public.dogs dog
  where dog.id in (
    select (member.value ->> 'dogId')::uuid
    from jsonb_array_elements(canonical_payload_value -> 'members') member(value)
  )
  order by dog.id for update;
  perform pg_advisory_xact_lock(hashtextextended('hotel-capacity:all', 0));
  perform pg_advisory_xact_lock(hashtextextended(
    'hotel-capacity:' || p_room_type_id::text, 0
  ));

  select member.value into first_member
  from jsonb_array_elements(canonical_payload_value -> 'members') member(value)
  order by member.value ->> 'stableMemberKey' limit 1;
  service_payload := first_member -> 'servicePayload';
  group_starts_at := case
    when (service_payload ->> 'checkInTimeUnspecified')::boolean
      then (service_payload ->> 'checkInDate')::date::timestamp
        at time zone 'Asia/Seoul'
    else ((service_payload ->> 'checkInDate')::date::timestamp
      + (service_payload ->> 'checkInTime')::time) at time zone 'Asia/Seoul'
  end;
  group_ends_at := case
    when (service_payload ->> 'checkOutTimeUnspecified')::boolean
      then ((service_payload ->> 'checkOutDate')::date + 1)::timestamp
        at time zone 'Asia/Seoul'
    else ((service_payload ->> 'checkOutDate')::date::timestamp
      + (service_payload ->> 'checkOutTime')::time) at time zone 'Asia/Seoul'
  end;
  perform public.assert_hotel_total_capacity_available(
    group_starts_at, group_ends_at, 1, null
  );
  perform public.assert_hotel_capacity_available(
    p_room_type_id, group_starts_at, group_ends_at, 1, null
  );

  perform set_config(
    'app.family_booking_change_reason',
    '미배정 함께 투숙 예약 생성',
    true
  );
  perform set_config('app.family_booking_request_id', p_request_id::text, true);
  insert into public.family_bookings(
    customer_id, status, common_memo, payment_bundle_requested,
    canonical_payload, canonical_payload_hash, request_id,
    created_by, updated_by
  ) values (
    p_customer_id, 'pending', nullif(btrim(p_common_memo), ''),
    coalesce(p_payment_bundle_requested, false), canonical_payload_value,
    payload_hash_value, p_request_id, actor_id, actor_id
  ) returning id into created_family_booking_id;

  for member_value in
    select member.value
    from jsonb_array_elements(canonical_payload_value -> 'members') member(value)
    order by member.value ->> 'dogId', member.value ->> 'stableMemberKey'
  loop
    service_payload := member_value -> 'servicePayload';
    select coalesce(array_agg(value::uuid order by value), '{}'::uuid[])
    into assignee_ids
    from jsonb_array_elements_text(member_value -> 'assigneeIds') ids(value);
    stay_request_id := public.family_booking_internal_request_id(
      p_request_id,
      (member_value ->> 'dogId')::uuid,
      'hotel',
      member_value ->> 'stableMemberKey',
      'hotel_reservation'
    );
    stay_id := public.create_unassigned_shared_hotel_stay_internal(
      (service_payload ->> 'calendarId')::uuid,
      (service_payload ->> 'scheduleTypeId')::uuid,
      (service_payload ->> 'checkInDate')::date,
      (service_payload ->> 'checkInTime')::time,
      (service_payload ->> 'checkInTimeUnspecified')::boolean,
      (service_payload ->> 'checkOutDate')::date,
      (service_payload ->> 'checkOutTime')::time,
      (service_payload ->> 'checkOutTimeUnspecified')::boolean,
      p_room_type_id,
      (member_value ->> 'dogId')::uuid,
      p_customer_id,
      assignee_ids,
      member_value ->> 'memo',
      stay_request_id,
      public.family_booking_internal_request_id(
        p_request_id, (member_value ->> 'dogId')::uuid, 'hotel',
        member_value ->> 'stableMemberKey', 'hotel_check_in'
      ),
      public.family_booking_internal_request_id(
        p_request_id, (member_value ->> 'dogId')::uuid, 'hotel',
        member_value ->> 'stableMemberKey', 'hotel_check_out'
      ),
      actor_id
    );
    insert into public.family_booking_members(
      family_booking_id, stable_member_key, dog_id, service_type, status,
      hotel_stay_id, created_by, updated_by
    ) values (
      created_family_booking_id,
      member_value ->> 'stableMemberKey',
      (member_value ->> 'dogId')::uuid,
      'hotel', 'confirmed', stay_id, actor_id, actor_id
    ) returning id into member_id;
  end loop;

  insert into public.family_shared_room_groups(
    family_booking_id, stable_group_key, leader_member_id, room_type_id,
    normalized_starts_at, normalized_ends_at, requested_capacity,
    status, created_by, updated_by
  )
  select created_family_booking_id, shared_group_key, member.id,
    p_room_type_id, group_starts_at, group_ends_at, member_count,
    'requested', actor_id, actor_id
  from public.family_booking_members member
  where member.family_booking_id = created_family_booking_id
  order by member.stable_member_key limit 1
  returning id into created_shared_room_group_id;

  update public.family_booking_members member
  set shared_room_group_id = created_shared_room_group_id,
      updated_by = actor_id
  where member.family_booking_id = created_family_booking_id;

  perform set_config(
    'app.operation_change_reason',
    '미배정 함께 투숙 DELUXE Capacity 생성',
    true
  );
  perform set_config('app.operation_request_id', p_request_id::text, true);
  insert into public.hotel_capacity_reservations(
    source_kind, shared_room_group_id, room_type_id,
    reserved_from, reserved_until, quantity, created_by, updated_by
  ) values (
    'shared_group', created_shared_room_group_id, p_room_type_id,
    group_starts_at, group_ends_at, 1, actor_id, actor_id
  ) returning id into created_shared_capacity_id;

  update public.family_bookings booking
  set status = public.family_booking_derived_status(booking.id),
      updated_by = actor_id
  where booking.id = created_family_booking_id;

  select count(*), count(*) filter (where member.hotel_stay_id is not null)
  into actual_member_count, actual_stay_count
  from public.family_booking_members member
  where member.family_booking_id = created_family_booking_id
    and member.archived_at is null;
  select count(*) into actual_schedule_count
  from public.hotel_stay_schedule_events event
  join public.family_booking_members member
    on member.hotel_stay_id = event.hotel_stay_id
  where member.family_booking_id = created_family_booking_id
    and member.archived_at is null and event.archived_at is null
    and event.event_kind in ('check_in','check_out');
  select count(*) into actual_group_count
  from public.family_shared_room_groups shared_group
  where shared_group.family_booking_id = created_family_booking_id
    and shared_group.status = 'requested' and shared_group.archived_at is null;
  select count(*) into individual_capacity_count
  from public.hotel_capacity_reservations capacity
  join public.family_booking_members member
    on member.hotel_stay_id = capacity.hotel_stay_id
  where member.family_booking_id = created_family_booking_id
    and capacity.archived_at is null;
  select count(*) into shared_capacity_count
  from public.hotel_capacity_reservations capacity
  where capacity.shared_room_group_id = created_shared_room_group_id
    and capacity.source_kind = 'shared_group'
    and capacity.quantity = 1 and capacity.archived_at is null;
  select count(*) into occupancy_count
  from public.hotel_physical_occupancies occupancy
  where occupancy.shared_room_group_id = created_shared_room_group_id
    and occupancy.archived_at is null;
  select count(*) into allocation_count
  from public.hotel_room_allocations allocation
  where allocation.capacity_reservation_id = created_shared_capacity_id
    and allocation.archived_at is null;

  if actual_member_count <> member_count
    or actual_stay_count <> member_count
    or actual_schedule_count <> member_count * 2
    or actual_group_count <> 1
    or individual_capacity_count <> 0
    or shared_capacity_count <> 1
    or occupancy_count <> 0
    or allocation_count <> 0 then
    raise exception '미배정 함께 투숙 예약 생성 결과가 올바르지 않습니다.'
      using errcode = 'P0001';
  end if;
  perform public.assert_requested_shared_room_capacity_internal(
    created_shared_room_group_id
  );

  return jsonb_build_object(
    'familyBooking', public.family_booking_json(created_family_booking_id),
    'sharedRoomGroupId', created_shared_room_group_id,
    'replayed', false
  );
end;
$$;

comment on function public.create_unassigned_shared_room_family_booking(
  uuid,text,boolean,jsonb,uuid,boolean,uuid
) is 'Atomic unassigned DELUXE Shared Room reservation. Creates N Stay identities and one shared-group Capacity without a physical room.';

revoke all on function public.create_unassigned_shared_room_family_booking(
  uuid,text,boolean,jsonb,uuid,boolean,uuid
) from public, anon;
grant execute on function public.create_unassigned_shared_room_family_booking(
  uuid,text,boolean,jsonb,uuid,boolean,uuid
) to authenticated, service_role;

-- Signature is intentionally unchanged. The legacy N individual-Capacity path
-- and the new one shared-group-Capacity path converge to the same final state.
create or replace function public.create_shared_hotel_room_occupancy(
  p_shared_room_group_id uuid,
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
  replay jsonb;
  payload jsonb;
  shared_group public.family_shared_room_groups%rowtype;
  family public.family_bookings%rowtype;
  room public.hotel_rooms%rowtype;
  room_type public.hotel_room_types%rowtype;
  requested_capacity public.hotel_capacity_reservations%rowtype;
  occupancy_id uuid := gen_random_uuid();
  capacity_id uuid;
  allocation_id uuid;
  result jsonb;
  member_count integer;
  requested_capacity_count integer;
  individual_capacity_count integer;
begin
  payload := jsonb_build_object(
    'roomId', p_room_id,
    'sharedRoomGroupId', p_shared_room_group_id
  );
  replay := public.claim_shared_hotel_request_internal(
    p_request_id, 'create', payload, null
  );
  if replay is not null then return replay; end if;

  select * into shared_group
  from public.family_shared_room_groups
  where id = p_shared_room_group_id for update;
  if not found or shared_group.archived_at is not null
    or shared_group.status <> 'requested' then
    raise exception '활성 Shared Room intent를 확인할 수 없습니다.'
      using errcode = '23514';
  end if;
  select * into family
  from public.family_bookings
  where id = shared_group.family_booking_id and archived_at is null
  for update;
  if not found then
    raise exception 'Family Booking을 확인할 수 없습니다.' using errcode = 'P0002';
  end if;
  select * into room_type
  from public.hotel_room_types
  where id = shared_group.room_type_id and is_active and archived_at is null;
  if not found or upper(btrim(room_type.code)) <> 'DELUXE'
    or upper(btrim(room_type.name)) <> 'DELUXE' then
    raise exception '공유 객실은 DELUXE만 사용할 수 있습니다.'
      using errcode = '23514';
  end if;
  select * into room
  from public.hotel_rooms
  where id = p_room_id and room_type_id = room_type.id
    and is_active and archived_at is null;
  if not found then
    raise exception '활성 DELUXE 호실을 확인할 수 없습니다.'
      using errcode = '23514';
  end if;

  select count(*)::integer into member_count
  from public.family_booking_members member
  where member.shared_room_group_id = shared_group.id
    and member.family_booking_id = family.id
    and member.service_type = 'hotel'
    and member.archived_at is null;
  if member_count < 2 or member_count <> shared_group.requested_capacity then
    raise exception 'Shared Room intent의 Dog member 수가 올바르지 않습니다.'
      using errcode = '23514';
  end if;

  select count(*)::integer into requested_capacity_count
  from public.hotel_capacity_reservations capacity
  where capacity.shared_room_group_id = shared_group.id
    and capacity.source_kind = 'shared_group'
    and capacity.archived_at is null;
  if requested_capacity_count = 1 then
    select * into requested_capacity
    from public.hotel_capacity_reservations capacity
    where capacity.shared_room_group_id = shared_group.id
      and capacity.source_kind = 'shared_group'
      and capacity.archived_at is null
    for update;
  end if;
  select count(*)::integer into individual_capacity_count
  from public.hotel_capacity_reservations capacity
  where capacity.archived_at is null
    and exists (
      select 1 from public.family_booking_members member
      where member.shared_room_group_id = shared_group.id
        and member.hotel_stay_id = capacity.hotel_stay_id
        and member.archived_at is null
    );

  if requested_capacity_count = 1 then
    if individual_capacity_count <> 0
      or requested_capacity.quantity <> 1
      or requested_capacity.room_type_id <> shared_group.room_type_id
      or requested_capacity.reserved_from <> shared_group.normalized_starts_at
      or requested_capacity.reserved_until <> shared_group.normalized_ends_at
      or exists (
        select 1 from public.hotel_room_allocations allocation
        where allocation.capacity_reservation_id = requested_capacity.id
          and allocation.archived_at is null
      ) then
      raise exception '미배정 Shared Room Capacity 계약이 올바르지 않습니다.'
        using errcode = '23514';
    end if;
  elsif requested_capacity_count = 0 then
    if individual_capacity_count <> member_count or exists (
      select 1
      from public.family_booking_members member
      join public.hotel_stays stay on stay.id = member.hotel_stay_id
      join public.dogs dog on dog.id = member.dog_id
      left join public.hotel_capacity_reservations capacity
        on capacity.hotel_stay_id = stay.id and capacity.archived_at is null
      where member.shared_room_group_id = shared_group.id
        and member.archived_at is null
        and (
          dog.customer_id <> family.customer_id
          or stay.dog_id <> member.dog_id
          or stay.archived_at is not null
          or stay.checked_out_at is not null
          or capacity.id is null
          or capacity.quantity <> 1
          or capacity.room_type_id <> shared_group.room_type_id
          or capacity.reserved_from <> shared_group.normalized_starts_at
          or capacity.reserved_until <> shared_group.normalized_ends_at
          or exists (
            select 1 from public.hotel_room_allocations allocation
            where allocation.capacity_reservation_id = capacity.id
              and allocation.archived_at is null
          )
        )
    ) then
      raise exception 'Legacy Shared Room member Capacity 계약이 올바르지 않습니다.'
        using errcode = '23514';
    end if;
  else
    raise exception 'Shared Room Capacity owner가 중복되었습니다.'
      using errcode = '23514';
  end if;

  perform 1
  from public.hotel_stays stay
  join public.family_booking_members member on member.hotel_stay_id = stay.id
  where member.shared_room_group_id = shared_group.id
    and member.archived_at is null
  order by stay.id for update of stay;
  perform pg_advisory_xact_lock(hashtextextended('hotel-capacity:all', 0));
  perform pg_advisory_xact_lock(hashtextextended(
    'hotel-capacity:' || shared_group.room_type_id::text, 0
  ));
  perform pg_advisory_xact_lock(hashtextextended(
    'hotel-room:' || p_room_id::text, 0
  ));

  if requested_capacity_count = 1 then
    perform public.assert_hotel_total_capacity_available(
      shared_group.normalized_starts_at,
      shared_group.normalized_ends_at,
      1,
      requested_capacity.id
    );
    perform public.assert_hotel_capacity_available(
      shared_group.room_type_id,
      shared_group.normalized_starts_at,
      shared_group.normalized_ends_at,
      1,
      requested_capacity.id
    );
  else
    perform set_config(
      'app.operation_change_reason',
      'Physical Occupancy로 통합',
      true
    );
    update public.hotel_capacity_reservations capacity
    set archived_at = now(), archived_by = actor_id,
        archive_reason = 'Physical Occupancy로 통합', updated_by = actor_id
    where capacity.archived_at is null and exists (
      select 1 from public.family_booking_members member
      where member.shared_room_group_id = shared_group.id
        and member.hotel_stay_id = capacity.hotel_stay_id
        and member.archived_at is null
    );
    perform public.assert_hotel_total_capacity_available(
      shared_group.normalized_starts_at,
      shared_group.normalized_ends_at,
      1,
      null
    );
    perform public.assert_hotel_capacity_available(
      shared_group.room_type_id,
      shared_group.normalized_starts_at,
      shared_group.normalized_ends_at,
      1,
      null
    );
  end if;

  perform set_config(
    'app.operation_change_reason',
    '다견 DELUXE 공유 객실 배정',
    true
  );
  perform set_config('app.operation_request_id', p_request_id::text, true);
  insert into public.hotel_physical_occupancies(
    id, family_booking_id, shared_room_group_id, customer_id,
    room_type_id, room_id, occupied_from, occupied_until, status,
    request_id, canonical_payload_hash, created_by, updated_by
  ) values (
    occupancy_id, family.id, shared_group.id, family.customer_id,
    shared_group.room_type_id, p_room_id,
    shared_group.normalized_starts_at, shared_group.normalized_ends_at,
    'active', p_request_id, public.shared_hotel_payload_hash(payload),
    actor_id, actor_id
  );

  if requested_capacity_count = 1 then
    capacity_id := requested_capacity.id;
    update public.hotel_capacity_reservations capacity
    set source_kind = 'shared_occupancy',
        shared_room_group_id = null,
        physical_occupancy_id = occupancy_id,
        updated_by = actor_id
    where capacity.id = capacity_id;
  else
    insert into public.hotel_capacity_reservations(
      source_kind, physical_occupancy_id, room_type_id,
      reserved_from, reserved_until, quantity, created_by, updated_by
    ) values (
      'shared_occupancy', occupancy_id, shared_group.room_type_id,
      shared_group.normalized_starts_at, shared_group.normalized_ends_at,
      1, actor_id, actor_id
    ) returning id into capacity_id;
  end if;

  perform public.assert_hotel_room_allocation_available(
    p_room_id, capacity_id,
    shared_group.normalized_starts_at,
    shared_group.normalized_ends_at,
    null
  );
  insert into public.hotel_room_allocations(
    capacity_reservation_id, room_id, allocated_from, allocated_until,
    assignment_reason, request_id, created_by, updated_by
  ) values (
    capacity_id, p_room_id,
    shared_group.normalized_starts_at, shared_group.normalized_ends_at,
    '다견 DELUXE 공유 객실 배정', p_request_id, actor_id, actor_id
  ) returning id into allocation_id;

  update public.hotel_physical_occupancies occupancy
  set capacity_reservation_id = capacity_id,
      room_allocation_id = allocation_id,
      updated_by = actor_id
  where occupancy.id = occupancy_id;
  insert into public.hotel_physical_occupancy_members(
    occupancy_id, family_booking_member_id, hotel_stay_id, dog_id,
    status, created_by, updated_by
  )
  select occupancy_id, member.id, member.hotel_stay_id, member.dog_id,
    'active', actor_id, actor_id
  from public.family_booking_members member
  where member.shared_room_group_id = shared_group.id
    and member.archived_at is null
  order by member.id;
  update public.family_shared_room_groups target
  set status = 'allocated', updated_by = actor_id
  where target.id = shared_group.id;

  insert into public.entity_audit_events(
    module_code, entity_type, entity_id, action, after_data,
    changed_by, change_reason, request_id
  ) values (
    'hotel_operations', 'hotel_physical_occupancies', occupancy_id,
    'created', public.shared_hotel_occupancy_json_internal(occupancy_id),
    actor_id, '다견 DELUXE 공유 객실 배정', p_request_id
  );
  result := public.shared_hotel_occupancy_json_internal(occupancy_id);
  return public.finish_shared_hotel_request_internal(
    p_request_id, occupancy_id, result
  );
end;
$$;

comment on function public.create_shared_hotel_room_occupancy(
  uuid,uuid,uuid
) is 'Allocates either legacy individual-capacity or unassigned shared-group-capacity Shared Room intent to one active DELUXE room.';

revoke all on function public.create_shared_hotel_room_occupancy(
  uuid,uuid,uuid
) from public, anon;
grant execute on function public.create_shared_hotel_room_occupancy(
  uuid,uuid,uuid
) to authenticated, service_role;

comment on column public.hotel_capacity_reservations.shared_room_group_id
  is 'Owner of one active quantity=1 DELUXE Capacity while a Shared Room Group remains requested and physically unassigned.';

commit;
