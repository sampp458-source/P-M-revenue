begin;

do $$
begin
  if to_regclass('public.family_bookings') is null
    or to_regclass('public.family_booking_members') is null
    or to_regclass('public.family_shared_room_groups') is null
    or to_regprocedure('public.family_booking_json(uuid)') is null
    or to_regprocedure('public.is_active_operation_member()') is null then
    raise exception 'Family Booking Platform 계약이 준비되지 않았습니다.';
  end if;

  if to_regprocedure('public.get_family_booking(uuid)') is not null
    or to_regprocedure('public.get_customer_family_bookings(uuid)') is not null then
    raise exception 'Family Booking 조회 계약이 이미 존재합니다.';
  end if;
end;
$$;

create function public.get_family_booking(p_family_booking_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  result_value jsonb;
begin
  if not public.is_active_operation_member() then
    raise exception 'Family Booking을 조회할 권한이 없습니다.'
      using errcode = '42501';
  end if;

  if p_family_booking_id is null then
    raise exception 'Family Booking ID가 필요합니다.'
      using errcode = '22023';
  end if;

  select public.family_booking_json(booking.id)
    || jsonb_build_object(
      'customerName', customer.name,
      'members', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', member.id,
          'stableMemberKey', member.stable_member_key,
          'dogId', member.dog_id,
          'dogName', dog.name,
          'serviceType', member.service_type,
          'status', member.status,
          'hotelStayId', member.hotel_stay_id,
          'operationScheduleId', member.operation_schedule_id,
          'sharedRoomGroupId', member.shared_room_group_id,
          'version', member.version,
          'serviceVersion', coalesce(stay.version, schedule.version),
          'service', case
            when member.service_type = 'hotel' then jsonb_build_object(
              'startsAt', capacity.reserved_from,
              'endsAt', capacity.reserved_until,
              'checkedInAt', stay.checked_in_at,
              'checkedOutAt', stay.checked_out_at,
              'roomTypeCode', room_type.code
            )
            else jsonb_build_object(
              'startsAt', schedule.starts_at,
              'endsAt', schedule.ends_at,
              'scheduleStatus', schedule.status,
              'calendarId', schedule.calendar_id,
              'scheduleTypeId', schedule.schedule_type_id
            )
          end
        ) order by member.stable_member_key)
        from public.family_booking_members member
        join public.dogs dog on dog.id = member.dog_id
        left join public.hotel_stays stay on stay.id = member.hotel_stay_id
        left join public.hotel_capacity_reservations capacity
          on capacity.hotel_stay_id = stay.id
         and capacity.archived_at is null
        left join public.hotel_room_types room_type
          on room_type.id = capacity.room_type_id
        left join public.operation_schedules schedule
          on schedule.id = member.operation_schedule_id
        where member.family_booking_id = booking.id
          and member.archived_at is null
      ), '[]'::jsonb)
    )
  into result_value
  from public.family_bookings booking
  join public.customers customer on customer.id = booking.customer_id
  where booking.id = p_family_booking_id
    and booking.archived_at is null;

  if result_value is null then
    raise exception 'Family Booking을 찾을 수 없습니다.'
      using errcode = 'P0002';
  end if;

  return result_value;
end;
$$;

create function public.get_customer_family_bookings(p_customer_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  result_value jsonb;
begin
  if not public.is_active_operation_member() then
    raise exception 'Family Booking을 조회할 권한이 없습니다.'
      using errcode = '42501';
  end if;

  if p_customer_id is null then
    raise exception 'Customer ID가 필요합니다.'
      using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.customers customer where customer.id = p_customer_id
  ) then
    raise exception 'Customer를 찾을 수 없습니다.'
      using errcode = 'P0002';
  end if;

  select coalesce(
    jsonb_agg(public.get_family_booking(booking.id) order by booking.created_at desc),
    '[]'::jsonb
  )
  into result_value
  from public.family_bookings booking
  where booking.customer_id = p_customer_id
    and booking.archived_at is null;

  return result_value;
end;
$$;

revoke all on function public.get_family_booking(uuid)
  from public, anon;
revoke all on function public.get_customer_family_bookings(uuid)
  from public, anon;
grant execute on function public.get_family_booking(uuid)
  to authenticated;
grant execute on function public.get_customer_family_bookings(uuid)
  to authenticated;

revoke select on table public.family_bookings from authenticated;
revoke select on table public.family_booking_members from authenticated;
revoke select on table public.family_shared_room_groups from authenticated;

commit;
