-- Read-only Room Board projection for requested, physically unassigned Shared Room groups.
-- Family Booking tables remain inaccessible through authenticated direct SELECT.

begin;

do $$
begin
  if to_regclass('public.family_bookings') is null
    or to_regclass('public.family_booking_members') is null
    or to_regclass('public.family_shared_room_groups') is null
    or to_regclass('public.hotel_capacity_reservations') is null
    or to_regclass('public.hotel_physical_occupancies') is null
    or to_regprocedure('public.is_active_operation_member()') is null
    or to_regprocedure('public.get_hotel_shared_room_occupancies(date)') is null
    or to_regprocedure('public.get_unassigned_shared_hotel_room_groups(date)') is not null
  then
    raise exception 'STOP_UNASSIGNED_SHARED_ROOM_READ_CONTRACT_BASELINE';
  end if;

  if has_table_privilege('authenticated', 'public.family_bookings', 'SELECT')
    or has_table_privilege('authenticated', 'public.family_booking_members', 'SELECT')
    or has_table_privilege('authenticated', 'public.family_shared_room_groups', 'SELECT')
  then
    raise exception 'STOP_FAMILY_BOOKING_DIRECT_READ_ACL_DRIFT';
  end if;
end;
$$;

create function public.get_unassigned_shared_hotel_room_groups(p_date date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  selected_start timestamptz;
  selected_end timestamptz;
  result jsonb;
begin
  if not public.is_active_operation_member() then
    raise exception '미배정 Shared Room 예약을 조회할 권한이 없습니다.'
      using errcode = '42501';
  end if;

  if p_date is null then
    raise exception '호텔 운영 날짜가 필요합니다.'
      using errcode = '22023';
  end if;

  selected_start := p_date::timestamp at time zone 'Asia/Seoul';
  selected_end := (p_date + 1)::timestamp at time zone 'Asia/Seoul';

  if exists (
    select 1
    from public.family_shared_room_groups shared_group
    join public.family_bookings booking
      on booking.id = shared_group.family_booking_id
     and booking.archived_at is null
    where shared_group.status = 'requested'
      and shared_group.archived_at is null
      and shared_group.normalized_starts_at < selected_end
      and shared_group.normalized_ends_at > selected_start
      and (
        shared_group.requested_capacity < 2
        or (
          select count(*)
          from public.family_booking_members member
          join public.hotel_stays stay
            on stay.id = member.hotel_stay_id
           and stay.archived_at is null
          join public.dogs dog
            on dog.id = member.dog_id
           and dog.customer_id = booking.customer_id
          where member.shared_room_group_id = shared_group.id
            and member.family_booking_id = booking.id
            and member.service_type = 'hotel'
            and member.archived_at is null
            and stay.dog_id = member.dog_id
        ) <> shared_group.requested_capacity
        or (
          select count(*)
          from public.hotel_capacity_reservations capacity
          join public.hotel_room_types room_type
            on room_type.id = capacity.room_type_id
           and room_type.is_active
           and room_type.archived_at is null
           and upper(btrim(room_type.code)) = 'DELUXE'
          where capacity.shared_room_group_id = shared_group.id
            and capacity.source_kind = 'shared_group'
            and capacity.archived_at is null
            and capacity.quantity = 1
            and capacity.room_type_id = shared_group.room_type_id
            and capacity.reserved_from = shared_group.normalized_starts_at
            and capacity.reserved_until = shared_group.normalized_ends_at
        ) <> 1
        or exists (
          select 1
          from public.hotel_physical_occupancies occupancy
          where occupancy.shared_room_group_id = shared_group.id
            and occupancy.archived_at is null
        )
      )
  ) then
    raise exception '미배정 Shared Room 조회 계약이 올바르지 않습니다.'
      using errcode = '23514';
  end if;

  select coalesce(
    jsonb_agg(group_projection.value order by group_projection.starts_at, group_projection.group_id),
    '[]'::jsonb
  )
  into result
  from (
    select
      shared_group.id as group_id,
      shared_group.normalized_starts_at as starts_at,
      jsonb_build_object(
        'sharedRoomGroupId', shared_group.id,
        'familyBookingId', booking.id,
        'customerId', booking.customer_id,
        'customerName', customer.name,
        'dogMembers', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'familyBookingMemberId', member.id,
              'hotelStayId', member.hotel_stay_id,
              'dogId', member.dog_id,
              'dogName', dog.name
            ) order by member.stable_member_key, member.id
          )
          from public.family_booking_members member
          join public.hotel_stays stay
            on stay.id = member.hotel_stay_id
           and stay.archived_at is null
          join public.dogs dog
            on dog.id = member.dog_id
           and dog.customer_id = booking.customer_id
          where member.shared_room_group_id = shared_group.id
            and member.family_booking_id = booking.id
            and member.service_type = 'hotel'
            and member.archived_at is null
            and stay.dog_id = member.dog_id
        ), '[]'::jsonb),
        'dogCount', shared_group.requested_capacity,
        'roomTypeId', shared_group.room_type_id,
        'roomTypeCode', 'DELUXE',
        'reservedFrom', shared_group.normalized_starts_at,
        'reservedUntil', shared_group.normalized_ends_at,
        'capacityReservationId', capacity.id,
        'requestedCapacity', 1,
        'status', 'requested',
        'version', shared_group.version
      ) as value
    from public.family_shared_room_groups shared_group
    join public.family_bookings booking
      on booking.id = shared_group.family_booking_id
     and booking.archived_at is null
    join public.customers customer
      on customer.id = booking.customer_id
    join public.hotel_room_types room_type
      on room_type.id = shared_group.room_type_id
     and room_type.is_active
     and room_type.archived_at is null
     and upper(btrim(room_type.code)) = 'DELUXE'
    join public.hotel_capacity_reservations capacity
      on capacity.shared_room_group_id = shared_group.id
     and capacity.source_kind = 'shared_group'
     and capacity.quantity = 1
     and capacity.archived_at is null
     and capacity.room_type_id = shared_group.room_type_id
     and capacity.reserved_from = shared_group.normalized_starts_at
     and capacity.reserved_until = shared_group.normalized_ends_at
    where shared_group.status = 'requested'
      and shared_group.archived_at is null
      and shared_group.normalized_starts_at < selected_end
      and shared_group.normalized_ends_at > selected_start
      and not exists (
        select 1
        from public.hotel_physical_occupancies occupancy
        where occupancy.shared_room_group_id = shared_group.id
          and occupancy.archived_at is null
      )
  ) group_projection;

  return result;
end;
$$;

comment on function public.get_unassigned_shared_hotel_room_groups(date)
  is 'Read-only, group-cardinality Room Board projection for requested DELUXE Shared Room groups overlapping one Seoul business date.';

revoke all on function public.get_unassigned_shared_hotel_room_groups(date)
  from public, anon;
grant execute on function public.get_unassigned_shared_hotel_room_groups(date)
  to authenticated, service_role;

commit;
