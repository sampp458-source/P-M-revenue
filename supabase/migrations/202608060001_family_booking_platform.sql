-- Family Booking Platform append-only migration.
-- Review package only: do not execute without explicit approval.

begin;

do $$
begin
  if to_regclass('public.customers') is null
    or to_regclass('public.dogs') is null
    or to_regclass('public.profiles') is null
    or to_regclass('public.operation_memberships') is null
    or to_regclass('public.operation_schedules') is null
    or to_regclass('public.entity_audit_events') is null
    or to_regclass('public.hotel_stays') is null
    or to_regprocedure('public.is_active_operation_member()') is null
    or to_regprocedure(
      'public.create_operation_schedule(uuid,uuid,text,timestamp with time zone,timestamp with time zone,boolean,boolean,text,uuid[],uuid[],uuid[],uuid)'
    ) is null
    or to_regprocedure(
      'public.create_flexible_hotel_reservation(uuid,uuid,date,time without time zone,boolean,date,time without time zone,boolean,uuid,uuid,uuid,uuid[],text,uuid)'
    ) is null
  then
    raise exception 'STOP_FAMILY_BOOKING_REQUIRED_CONTRACT_MISSING';
  end if;

  if to_regclass('public.family_bookings') is not null
    or to_regclass('public.family_booking_members') is not null
    or to_regclass('public.family_shared_room_groups') is not null
    or to_regprocedure(
      'public.create_family_booking(uuid,text,boolean,jsonb,uuid)'
    ) is not null
  then
    raise exception 'STOP_FAMILY_BOOKING_OBJECTS_ALREADY_EXIST';
  end if;
end;
$$;

create table public.family_bookings (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete restrict,
  status text not null default 'pending'
    check (status in (
      'draft', 'pending', 'active', 'partially_completed',
      'completed', 'partially_cancelled', 'cancelled'
    )),
  common_memo text null,
  payment_bundle_requested boolean not null default false,
  canonical_payload jsonb not null,
  canonical_payload_hash text not null
    check (canonical_payload_hash ~ '^[0-9a-f]{64}$'),
  request_id uuid not null unique,
  version integer not null default 1 check (version > 0),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_by uuid not null references public.profiles(id) on delete restrict,
  updated_at timestamptz not null default now(),
  archived_at timestamptz null,
  archived_by uuid null references public.profiles(id) on delete restrict,
  archive_reason text null,
  constraint family_bookings_archive_check check (
    (archived_at is null and archived_by is null and archive_reason is null)
    or (
      archived_at is not null and archived_by is not null
      and nullif(btrim(archive_reason), '') is not null
    )
  )
);

create index family_bookings_customer_status_idx
  on public.family_bookings (customer_id, status, created_at desc)
  where archived_at is null;

create index family_bookings_payload_hash_idx
  on public.family_bookings (canonical_payload_hash);

create table public.family_booking_members (
  id uuid primary key default gen_random_uuid(),
  family_booking_id uuid not null
    references public.family_bookings(id) on delete restrict,
  stable_member_key text not null
    check (
      nullif(btrim(stable_member_key), '') is not null
      and char_length(btrim(stable_member_key)) <= 120
      and btrim(stable_member_key) ~ '^[A-Za-z0-9._:-]+$'
    ),
  dog_id uuid not null references public.dogs(id) on delete restrict,
  service_type text not null
    check (service_type in ('hotel', 'training', 'daycare')),
  status text not null default 'pending'
    check (status in (
      'pending', 'confirmed', 'checked_in', 'completed', 'cancelled'
    )),
  hotel_stay_id uuid null references public.hotel_stays(id) on delete restrict,
  operation_schedule_id uuid null
    references public.operation_schedules(id) on delete restrict,
  shared_room_group_id uuid null,
  version integer not null default 1 check (version > 0),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_by uuid not null references public.profiles(id) on delete restrict,
  updated_at timestamptz not null default now(),
  archived_at timestamptz null,
  archived_by uuid null references public.profiles(id) on delete restrict,
  archive_reason text null,
  constraint family_booking_members_service_record_check check (
    (
      service_type = 'hotel'
      and hotel_stay_id is not null
      and operation_schedule_id is null
    )
    or (
      service_type in ('training', 'daycare')
      and hotel_stay_id is null
      and operation_schedule_id is not null
    )
  ),
  constraint family_booking_members_archive_check check (
    (archived_at is null and archived_by is null and archive_reason is null)
    or (
      archived_at is not null and archived_by is not null
      and nullif(btrim(archive_reason), '') is not null
    )
  ),
  unique (family_booking_id, stable_member_key),
  unique (family_booking_id, dog_id)
);

create unique index family_booking_members_hotel_stay_uidx
  on public.family_booking_members (hotel_stay_id)
  where hotel_stay_id is not null and archived_at is null;

create unique index family_booking_members_schedule_uidx
  on public.family_booking_members (operation_schedule_id)
  where operation_schedule_id is not null and archived_at is null;

create index family_booking_members_family_status_idx
  on public.family_booking_members (family_booking_id, status, stable_member_key)
  where archived_at is null;

create table public.family_shared_room_groups (
  id uuid primary key default gen_random_uuid(),
  family_booking_id uuid not null
    references public.family_bookings(id) on delete restrict,
  stable_group_key text not null
    check (
      nullif(btrim(stable_group_key), '') is not null
      and char_length(btrim(stable_group_key)) <= 120
      and btrim(stable_group_key) ~ '^[A-Za-z0-9._:-]+$'
    ),
  leader_member_id uuid not null
    references public.family_booking_members(id) on delete restrict,
  room_type_id uuid not null
    references public.hotel_room_types(id) on delete restrict,
  normalized_starts_at timestamptz not null,
  normalized_ends_at timestamptz not null,
  requested_capacity integer not null check (requested_capacity >= 2),
  status text not null default 'requested'
    check (status in ('requested', 'allocated', 'released', 'cancelled')),
  version integer not null default 1 check (version > 0),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_by uuid not null references public.profiles(id) on delete restrict,
  updated_at timestamptz not null default now(),
  archived_at timestamptz null,
  archived_by uuid null references public.profiles(id) on delete restrict,
  archive_reason text null,
  constraint family_shared_room_groups_time_check
    check (normalized_ends_at > normalized_starts_at),
  constraint family_shared_room_groups_archive_check check (
    (archived_at is null and archived_by is null and archive_reason is null)
    or (
      archived_at is not null and archived_by is not null
      and nullif(btrim(archive_reason), '') is not null
    )
  ),
  unique (family_booking_id, stable_group_key)
);

alter table public.family_booking_members
  add constraint family_booking_members_shared_room_group_fkey
  foreign key (shared_room_group_id)
  references public.family_shared_room_groups(id)
  on delete restrict;

create index family_shared_room_groups_family_idx
  on public.family_shared_room_groups (
    family_booking_id, status, normalized_starts_at, normalized_ends_at
  )
  where archived_at is null;

create function public.family_booking_internal_request_id(
  p_family_request_id uuid,
  p_dog_id uuid,
  p_service_type text,
  p_stable_member_key text,
  p_operation_kind text
)
returns uuid
language plpgsql
immutable
strict
set search_path = public, pg_temp
as $$
declare
  hash_value text;
begin
  if p_service_type not in ('hotel', 'training', 'daycare')
    or nullif(btrim(p_stable_member_key), '') is null
    or nullif(btrim(p_operation_kind), '') is null then
    raise exception '내부 서비스 요청 키 입력이 올바르지 않습니다.'
      using errcode = '22023';
  end if;

  hash_value := encode(extensions.digest(
    p_family_request_id::text || '|' || p_dog_id::text || '|'
      || p_service_type || '|' || btrim(p_stable_member_key) || '|'
      || btrim(p_operation_kind),
    'sha256'
  ), 'hex');

  return (
    substr(hash_value, 1, 8) || '-' ||
    substr(hash_value, 9, 4) || '-' ||
    '5' || substr(hash_value, 14, 3) || '-' ||
    'a' || substr(hash_value, 18, 3) || '-' ||
    substr(hash_value, 21, 12)
  )::uuid;
end;
$$;

create function public.canonicalize_family_booking_payload(
  p_customer_id uuid,
  p_common_memo text,
  p_payment_bundle_requested boolean,
  p_members jsonb
)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  canonical_members jsonb;
  canonical_shared_room_groups jsonb;
begin
  if p_customer_id is null
    or p_members is null
    or jsonb_typeof(p_members) <> 'array'
    or jsonb_array_length(p_members) = 0 then
    raise exception '보호자와 한 개 이상의 Family Member가 필요합니다.'
      using errcode = '22023';
  end if;

  select jsonb_agg(source.canonical_member order by source.stable_member_key)
  into canonical_members
  from (
    select
      btrim(member.value ->> 'stableMemberKey') as stable_member_key,
      jsonb_build_object(
        'stableMemberKey', btrim(member.value ->> 'stableMemberKey'),
        'dogId', ((member.value ->> 'dogId')::uuid)::text,
        'serviceType', lower(btrim(member.value ->> 'serviceType')),
        'assigneeIds', coalesce((
          select jsonb_agg(assignee.id order by assignee.id)
          from (
            select distinct (btrim(value)::uuid)::text as id
            from jsonb_array_elements_text(
              coalesce(member.value -> 'assigneeIds', '[]'::jsonb)
            ) assignee_value(value)
            where nullif(btrim(value), '') is not null
          ) assignee
        ), '[]'::jsonb),
        'memo', nullif(btrim(member.value ->> 'memo'), ''),
        'sharedRoomGroupKey', nullif(
          btrim(member.value ->> 'sharedRoomGroupKey'), ''
        ),
        'servicePayload', case lower(btrim(member.value ->> 'serviceType'))
          when 'hotel' then jsonb_build_object(
            'calendarId', ((member.value ->> 'calendarId')::uuid)::text,
            'scheduleTypeId',
              ((member.value ->> 'scheduleTypeId')::uuid)::text,
            'checkInDate', to_char(
              (member.value ->> 'checkInDate')::date, 'YYYY-MM-DD'
            ),
            'checkInTime', case
              when coalesce(
                (member.value ->> 'checkInTimeUnspecified')::boolean, false
              ) then null
              else to_char(
                (member.value ->> 'checkInTime')::time, 'HH24:MI:SS'
              )
            end,
            'checkInTimeUnspecified', coalesce(
              (member.value ->> 'checkInTimeUnspecified')::boolean, false
            ),
            'checkOutDate', to_char(
              (member.value ->> 'checkOutDate')::date, 'YYYY-MM-DD'
            ),
            'checkOutTime', case
              when coalesce(
                (member.value ->> 'checkOutTimeUnspecified')::boolean, false
              ) then null
              else to_char(
                (member.value ->> 'checkOutTime')::time, 'HH24:MI:SS'
              )
            end,
            'checkOutTimeUnspecified', coalesce(
              (member.value ->> 'checkOutTimeUnspecified')::boolean, false
            ),
            'roomTypeId', case
              when nullif(btrim(member.value ->> 'roomTypeId'), '') is null
                then null
              else ((member.value ->> 'roomTypeId')::uuid)::text
            end
          )
          when 'training' then jsonb_build_object(
            'calendarId', ((member.value ->> 'calendarId')::uuid)::text,
            'scheduleTypeId',
              ((member.value ->> 'scheduleTypeId')::uuid)::text,
            'title', btrim(member.value ->> 'title'),
            'startsAt', to_char(
              (member.value ->> 'startsAt')::timestamptz
                at time zone 'UTC',
              'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
            ),
            'endsAt', to_char(
              (member.value ->> 'endsAt')::timestamptz
                at time zone 'UTC',
              'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
            ),
            'allDay', coalesce(
              (member.value ->> 'allDay')::boolean, false
            ),
            'timeUnspecified', coalesce(
              (member.value ->> 'timeUnspecified')::boolean, false
            )
          )
          when 'daycare' then jsonb_build_object(
            'calendarId', ((member.value ->> 'calendarId')::uuid)::text,
            'scheduleTypeId',
              ((member.value ->> 'scheduleTypeId')::uuid)::text,
            'title', btrim(member.value ->> 'title'),
            'startsAt', to_char(
              (member.value ->> 'startsAt')::timestamptz
                at time zone 'UTC',
              'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
            ),
            'endsAt', to_char(
              (member.value ->> 'endsAt')::timestamptz
                at time zone 'UTC',
              'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
            ),
            'allDay', coalesce(
              (member.value ->> 'allDay')::boolean, false
            ),
            'timeUnspecified', coalesce(
              (member.value ->> 'timeUnspecified')::boolean, false
            )
          )
          else null
        end
      ) as canonical_member
    from jsonb_array_elements(p_members) member(value)
  ) source;

  select coalesce(jsonb_agg(jsonb_build_object(
    'stableGroupKey', shared_group.group_key,
    'memberStableKeys', shared_group.member_keys
  ) order by shared_group.group_key), '[]'::jsonb)
  into canonical_shared_room_groups
  from (
    select
      member.value ->> 'sharedRoomGroupKey' as group_key,
      jsonb_agg(
        member.value ->> 'stableMemberKey'
        order by member.value ->> 'stableMemberKey'
      ) as member_keys
    from jsonb_array_elements(canonical_members) member(value)
    where member.value ->> 'sharedRoomGroupKey' is not null
    group by member.value ->> 'sharedRoomGroupKey'
  ) shared_group;

  return jsonb_build_object(
    'customerId', p_customer_id::text,
    'commonMemo', nullif(btrim(p_common_memo), ''),
    'paymentBundleRequested', coalesce(p_payment_bundle_requested, false),
    'members', canonical_members,
    'sharedRoomGroups', canonical_shared_room_groups
  );
exception
  when invalid_text_representation or datetime_field_overflow then
    raise exception 'Family Booking UUID 또는 날짜·시간 형식이 올바르지 않습니다.'
      using errcode = '22023';
end;
$$;

create function public.family_booking_payload_hash(p_payload jsonb)
returns text
language sql
immutable
strict
set search_path = public, pg_temp
as $$
  select encode(extensions.digest(p_payload::text, 'sha256'), 'hex');
$$;

create function public.assert_family_booking_payload(
  p_canonical_payload jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  customer_id_value uuid;
begin
  if auth.uid() is null or not public.is_active_operation_member() then
    raise exception 'Family Booking 생성 권한이 없습니다.'
      using errcode = '42501';
  end if;

  customer_id_value := (p_canonical_payload ->> 'customerId')::uuid;

  if not exists (
    select 1 from public.customers customer
    where customer.id = customer_id_value
      and customer.is_active
  ) then
    raise exception '활성 보호자를 확인할 수 없습니다.'
      using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_canonical_payload -> 'members') member(value)
    group by member.value ->> 'stableMemberKey'
    having count(*) > 1
  ) then
    raise exception 'stable_member_key가 중복되었습니다.'
      using errcode = '23505';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_canonical_payload -> 'members') member(value)
    group by member.value ->> 'dogId'
    having count(*) > 1
  ) then
    raise exception '한 Family Booking에 같은 반려견을 중복 등록할 수 없습니다.'
      using errcode = '23505';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_canonical_payload -> 'members') member(value)
    left join public.dogs dog
      on dog.id = (member.value ->> 'dogId')::uuid
    where dog.id is null
      or not dog.is_active
      or dog.customer_id is distinct from customer_id_value
  ) then
    raise exception '모든 반려견은 활성 상태이며 같은 보호자 소속이어야 합니다.'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_canonical_payload -> 'members') member(value)
    where nullif(btrim(member.value ->> 'stableMemberKey'), '') is null
      or btrim(member.value ->> 'stableMemberKey')
        !~ '^[A-Za-z0-9._:-]+$'
      or member.value ->> 'serviceType'
        not in ('hotel', 'training', 'daycare')
      or jsonb_array_length(member.value -> 'assigneeIds') = 0
  ) then
    raise exception 'Member key, 서비스 또는 담당자 입력을 확인해 주세요.'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_canonical_payload -> 'members') member(value)
    cross join lateral jsonb_array_elements_text(
      member.value -> 'assigneeIds'
    ) requested(profile_id)
    left join public.profiles profile
      on profile.id = requested.profile_id::uuid
    left join public.operation_memberships membership
      on membership.profile_id = requested.profile_id::uuid
    where profile.id is null
      or not profile.is_active
      or profile.account_status <> 'active'
      or membership.profile_id is null
      or not membership.is_active
  ) then
    raise exception '활성 Operations 구성원만 담당자로 지정할 수 있습니다.'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_canonical_payload -> 'members') member(value)
    where member.value ->> 'serviceType' = 'hotel'
      and (
        (member.value -> 'servicePayload' ->> 'checkOutDate')::date
          < (member.value -> 'servicePayload' ->> 'checkInDate')::date
        or (
          (member.value -> 'servicePayload' ->> 'checkOutDate')::date
            = (member.value -> 'servicePayload' ->> 'checkInDate')::date
          and not (
            member.value -> 'servicePayload'
              ->> 'checkInTimeUnspecified'
          )::boolean
          and not (
            member.value -> 'servicePayload'
              ->> 'checkOutTimeUnspecified'
          )::boolean
          and (member.value -> 'servicePayload' ->> 'checkOutTime')::time
            <= (member.value -> 'servicePayload' ->> 'checkInTime')::time
        )
      )
  ) then
    raise exception '호텔 Member의 입실·퇴실 범위가 올바르지 않습니다.'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_canonical_payload -> 'members') member(value)
    where member.value ->> 'serviceType' in ('training', 'daycare')
      and (
        nullif(btrim(member.value -> 'servicePayload' ->> 'title'), '')
          is null
        or (member.value -> 'servicePayload' ->> 'endsAt')::timestamptz
          <= (member.value -> 'servicePayload' ->> 'startsAt')::timestamptz
      )
  ) then
    raise exception '교육·유치원 Member의 제목과 일정 범위를 확인해 주세요.'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_canonical_payload -> 'members') member(value)
    where member.value ->> 'serviceType' in ('training', 'daycare')
      and not exists (
        select 1
        from public.operation_calendars calendar
        join public.business_units unit
          on unit.id = calendar.business_unit_id
        join public.operation_calendar_schedule_types mapping
          on mapping.calendar_id = calendar.id
         and mapping.schedule_type_id =
           (member.value -> 'servicePayload' ->> 'scheduleTypeId')::uuid
        where calendar.id =
            (member.value -> 'servicePayload' ->> 'calendarId')::uuid
          and calendar.is_active
          and unit.is_active
          and unit.code = member.value ->> 'serviceType'
          and mapping.is_active
          and mapping.archived_at is null
      )
  ) then
    raise exception '교육·유치원 Calendar와 일정 유형 계약을 확인해 주세요.'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_canonical_payload -> 'members') member(value)
    where member.value ->> 'sharedRoomGroupKey' is not null
      and member.value ->> 'serviceType' <> 'hotel'
  ) then
    raise exception 'Shared Room Group에는 Hotel Member만 포함할 수 있습니다.'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_canonical_payload -> 'members') member(value)
    left join public.hotel_room_types room_type
      on room_type.id =
        (member.value -> 'servicePayload' ->> 'roomTypeId')::uuid
    where member.value ->> 'sharedRoomGroupKey' is not null
      and (
        room_type.id is null
        or not room_type.is_active
        or room_type.archived_at is not null
        or room_type.code <> 'DELUXE'
      )
  ) then
    raise exception 'Shared Room Group은 활성 DELUXE 예약만 허용합니다.'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from (
      select
        member.value ->> 'sharedRoomGroupKey' as group_key,
        count(*) as member_count,
        count(distinct concat_ws('|',
          member.value -> 'servicePayload' ->> 'checkInDate',
          member.value -> 'servicePayload' ->> 'checkInTime',
          member.value -> 'servicePayload' ->> 'checkInTimeUnspecified',
          member.value -> 'servicePayload' ->> 'checkOutDate',
          member.value -> 'servicePayload' ->> 'checkOutTime',
          member.value -> 'servicePayload' ->> 'checkOutTimeUnspecified'
        )) as period_count
      from jsonb_array_elements(p_canonical_payload -> 'members') member(value)
      where member.value ->> 'sharedRoomGroupKey' is not null
      group by member.value ->> 'sharedRoomGroupKey'
    ) shared_group
    where shared_group.member_count < 2
      or shared_group.period_count <> 1
  ) then
    raise exception 'Shared Room Group은 동일 기간의 Dog 두 마리 이상이어야 합니다.'
      using errcode = '23514';
  end if;
end;
$$;

create function public.family_booking_derived_status(
  p_family_booking_id uuid
)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with states as (
    select
      count(*)::integer as total_count,
      count(*) filter (where member.status = 'pending')::integer
        as pending_count,
      count(*) filter (where member.status = 'confirmed')::integer
        as confirmed_count,
      count(*) filter (where member.status = 'checked_in')::integer
        as checked_in_count,
      count(*) filter (where member.status = 'completed')::integer
        as completed_count,
      count(*) filter (where member.status = 'cancelled')::integer
        as cancelled_count
    from public.family_booking_members member
    where member.family_booking_id = p_family_booking_id
      and member.archived_at is null
  )
  select case
    when total_count = 0 then 'pending'
    when cancelled_count = total_count then 'cancelled'
    when cancelled_count > 0 then 'partially_cancelled'
    when completed_count = total_count then 'completed'
    when completed_count > 0 then 'partially_completed'
    when checked_in_count > 0 or confirmed_count > 0 then 'active'
    else 'pending'
  end
  from states;
$$;

create function public.family_booking_json(p_family_booking_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', booking.id,
    'customerId', booking.customer_id,
    'status', public.family_booking_derived_status(booking.id),
    'storedStatus', booking.status,
    'commonMemo', booking.common_memo,
    'paymentBundleRequested', booking.payment_bundle_requested,
    'requestId', booking.request_id,
    'version', booking.version,
    'createdAt', booking.created_at,
    'updatedAt', booking.updated_at,
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', member.id,
        'stableMemberKey', member.stable_member_key,
        'dogId', member.dog_id,
        'serviceType', member.service_type,
        'status', member.status,
        'hotelStayId', member.hotel_stay_id,
        'operationScheduleId', member.operation_schedule_id,
        'sharedRoomGroupId', member.shared_room_group_id,
        'version', member.version,
        'serviceVersion', coalesce(stay.version, schedule.version)
      ) order by member.stable_member_key)
      from public.family_booking_members member
      left join public.hotel_stays stay on stay.id = member.hotel_stay_id
      left join public.operation_schedules schedule
        on schedule.id = member.operation_schedule_id
      where member.family_booking_id = booking.id
        and member.archived_at is null
    ), '[]'::jsonb),
    'sharedRoomGroups', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', shared_group.id,
        'stableGroupKey', shared_group.stable_group_key,
        'leaderMemberId', shared_group.leader_member_id,
        'roomTypeId', shared_group.room_type_id,
        'normalizedStartsAt', shared_group.normalized_starts_at,
        'normalizedEndsAt', shared_group.normalized_ends_at,
        'requestedCapacity', shared_group.requested_capacity,
        'status', shared_group.status,
        'version', shared_group.version
      ) order by shared_group.stable_group_key)
      from public.family_shared_room_groups shared_group
      where shared_group.family_booking_id = booking.id
        and shared_group.archived_at is null
    ), '[]'::jsonb)
  )
  from public.family_bookings booking
  where booking.id = p_family_booking_id
    and booking.archived_at is null
    and public.is_active_operation_member();
$$;

create function public.family_booking_set_metadata()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.id is distinct from old.id
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at then
    raise exception 'Family Booking 생성 메타데이터는 변경할 수 없습니다.'
      using errcode = 'P0001';
  end if;

  if tg_table_name = 'family_bookings' then
    if (
      new.customer_id is distinct from old.customer_id
      or new.request_id is distinct from old.request_id
      or new.canonical_payload is distinct from old.canonical_payload
      or new.canonical_payload_hash is distinct from old.canonical_payload_hash
    ) then
      raise exception 'Family Booking Root 식별 및 Replay 계약은 변경할 수 없습니다.'
        using errcode = 'P0001';
    end if;
  end if;

  if tg_table_name = 'family_booking_members' then
    if (
      new.family_booking_id is distinct from old.family_booking_id
      or new.stable_member_key is distinct from old.stable_member_key
      or new.dog_id is distinct from old.dog_id
      or new.service_type is distinct from old.service_type
      or new.hotel_stay_id is distinct from old.hotel_stay_id
      or new.operation_schedule_id is distinct from old.operation_schedule_id
    ) then
      raise exception 'Family Booking Member 식별 및 Service 연결은 변경할 수 없습니다.'
        using errcode = 'P0001';
    end if;
  end if;

  new.version := old.version + 1;
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end;
$$;

create function public.prevent_family_booking_physical_delete()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'Family Booking 원장은 물리 삭제할 수 없습니다.'
    using errcode = 'P0001';
end;
$$;

create function public.record_family_booking_audit_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  action_value text;
  request_value text;
  parsed_request_id uuid;
  reason_value text;
begin
  -- Pending Root는 서비스 결과가 모두 확정되기 전의 트랜잭션 내부 상태다.
  -- 최종 상태 전환에서만 원 request_id를 가진 Root Audit 한 건을 남긴다.
  if tg_table_name = 'family_bookings'
    and tg_op = 'INSERT'
    and new.status = 'pending' then
    return new;
  end if;

  action_value := case
    when tg_table_name = 'family_bookings'
      and tg_op = 'UPDATE'
      and old.status = 'pending'
      and new.status <> 'pending' then 'created'
    when tg_op = 'INSERT' then 'created'
    when old.archived_at is null and new.archived_at is not null
      then 'archived'
    when old.archived_at is not null and new.archived_at is null
      then 'restored'
    else 'updated'
  end;

  reason_value := nullif(btrim(
    current_setting('app.family_booking_change_reason', true)
  ), '');
  request_value := nullif(btrim(
    current_setting('app.family_booking_request_id', true)
  ), '');

  if tg_table_name = 'family_bookings' and request_value is not null then
    parsed_request_id := request_value::uuid;
  else
    parsed_request_id := null;
  end if;

  if auth.uid() is null then
    raise exception 'Family Booking Audit 변경자를 확인할 수 없습니다.'
      using errcode = '23502';
  end if;

  insert into public.entity_audit_events (
    module_code, entity_type, entity_id, action,
    before_data, after_data, changed_by, change_reason, request_id
  ) values (
    'family_booking', tg_table_name, new.id, action_value,
    case when tg_op = 'UPDATE' then to_jsonb(old) else null end,
    to_jsonb(new), auth.uid(), reason_value, parsed_request_id
  );

  return new;
exception
  when invalid_text_representation then
    raise exception '유효하지 않은 Family Booking Audit request_id입니다.'
      using errcode = '22023';
end;
$$;

create trigger family_bookings_metadata
  before update on public.family_bookings
  for each row execute function public.family_booking_set_metadata();
create trigger family_booking_members_metadata
  before update on public.family_booking_members
  for each row execute function public.family_booking_set_metadata();
create trigger family_shared_room_groups_metadata
  before update on public.family_shared_room_groups
  for each row execute function public.family_booking_set_metadata();

create trigger family_bookings_no_delete
  before delete on public.family_bookings
  for each row execute function public.prevent_family_booking_physical_delete();
create trigger family_booking_members_no_delete
  before delete on public.family_booking_members
  for each row execute function public.prevent_family_booking_physical_delete();
create trigger family_shared_room_groups_no_delete
  before delete on public.family_shared_room_groups
  for each row execute function public.prevent_family_booking_physical_delete();

create trigger family_bookings_audit
  after insert or update on public.family_bookings
  for each row execute function public.record_family_booking_audit_event();
create trigger family_booking_members_audit
  after insert or update on public.family_booking_members
  for each row execute function public.record_family_booking_audit_event();
create trigger family_shared_room_groups_audit
  after insert or update on public.family_shared_room_groups
  for each row execute function public.record_family_booking_audit_event();

create function public.create_family_hotel_member(
  p_service_request_id uuid,
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
  p_memo text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  service_result jsonb;
  service_record_id uuid;
  active_event_count integer;
  matching_event_count integer;
begin
  service_result := public.create_flexible_hotel_reservation(
    p_calendar_id, p_schedule_type_id,
    p_check_in_date, p_check_in_time, p_check_in_time_unspecified,
    p_check_out_date, p_check_out_time, p_check_out_time_unspecified,
    p_room_type_id, p_dog_id, p_customer_id, p_assignee_ids, p_memo,
    p_service_request_id
  );

  service_record_id := (service_result ->> 'id')::uuid;
  if service_record_id is null or not exists (
    select 1
    from public.hotel_stays stay
    where stay.id = service_record_id
      and stay.dog_id = p_dog_id
      and stay.archived_at is null
  ) then
    raise exception 'Hotel Adapter 반환 예약이 요청 반려견과 일치하지 않습니다.'
      using errcode = 'P0002';
  end if;

  select
    count(*)::integer,
    count(*) filter (
      where schedule.id is not null
        and schedule.archived_at is null
        and exists (
          select 1
          from public.operation_schedule_dogs dog_link
          where dog_link.schedule_id = schedule.id
            and dog_link.dog_id = p_dog_id
            and dog_link.archived_at is null
        )
        and not exists (
          select 1
          from public.operation_schedule_dogs dog_link
          where dog_link.schedule_id = schedule.id
            and dog_link.dog_id <> p_dog_id
            and dog_link.archived_at is null
        )
        and exists (
          select 1
          from public.operation_schedule_customers customer_link
          where customer_link.schedule_id = schedule.id
            and customer_link.customer_id = p_customer_id
            and customer_link.archived_at is null
        )
        and not exists (
          select 1
          from public.operation_schedule_customers customer_link
          where customer_link.schedule_id = schedule.id
            and customer_link.customer_id <> p_customer_id
            and customer_link.archived_at is null
        )
    )::integer
  into active_event_count, matching_event_count
  from public.hotel_stay_schedule_events event_link
  left join public.operation_schedules schedule
    on schedule.id = event_link.operation_schedule_id
  where event_link.hotel_stay_id = service_record_id
    and event_link.archived_at is null
    and event_link.event_kind in ('check_in', 'check_out');

  if active_event_count <> 2 or matching_event_count <> 2 then
    raise exception 'Hotel Adapter 반환 예약의 고객·반려견·일정 계약이 일치하지 않습니다.'
      using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'serviceRecordId', service_record_id,
    'serviceVersion', (service_result ->> 'version')::integer,
    'dogId', p_dog_id,
    'customerId', p_customer_id,
    'serviceType', 'hotel'
  );
end;
$$;

create function public.create_family_training_member(
  p_service_request_id uuid,
  p_calendar_id uuid,
  p_schedule_type_id uuid,
  p_title text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_all_day boolean,
  p_time_unspecified boolean,
  p_dog_id uuid,
  p_customer_id uuid,
  p_assignee_ids uuid[],
  p_memo text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  service_result jsonb;
  service_record_id uuid;
begin
  if not exists (
    select 1
    from public.operation_calendars calendar
    join public.business_units unit on unit.id = calendar.business_unit_id
    where calendar.id = p_calendar_id
      and calendar.is_active and unit.is_active and unit.code = 'training'
  ) then
    raise exception '활성 교육 Calendar를 확인할 수 없습니다.'
      using errcode = '22023';
  end if;

  service_result := public.create_operation_schedule(
    p_calendar_id, p_schedule_type_id, p_title,
    p_starts_at, p_ends_at, p_all_day, p_time_unspecified,
    p_memo, p_assignee_ids, array[p_customer_id], array[p_dog_id],
    p_service_request_id
  );

  service_record_id := (service_result ->> 'id')::uuid;
  if service_record_id is null or not exists (
    select 1
    from public.operation_schedules schedule
    join public.operation_calendars calendar
      on calendar.id = schedule.calendar_id
    join public.business_units unit
      on unit.id = calendar.business_unit_id
    where schedule.id = service_record_id
      and schedule.archived_at is null
      and unit.code = 'training'
      and exists (
        select 1 from public.operation_schedule_dogs dog_link
        where dog_link.schedule_id = schedule.id
          and dog_link.dog_id = p_dog_id
          and dog_link.archived_at is null
      )
      and not exists (
        select 1 from public.operation_schedule_dogs dog_link
        where dog_link.schedule_id = schedule.id
          and dog_link.dog_id <> p_dog_id
          and dog_link.archived_at is null
      )
      and exists (
        select 1 from public.operation_schedule_customers customer_link
        where customer_link.schedule_id = schedule.id
          and customer_link.customer_id = p_customer_id
          and customer_link.archived_at is null
      )
      and not exists (
        select 1 from public.operation_schedule_customers customer_link
        where customer_link.schedule_id = schedule.id
          and customer_link.customer_id <> p_customer_id
          and customer_link.archived_at is null
      )
  ) then
    raise exception 'Training Adapter 반환 일정의 고객·반려견·서비스 계약이 일치하지 않습니다.'
      using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'serviceRecordId', service_record_id,
    'serviceVersion', (service_result ->> 'version')::integer,
    'dogId', p_dog_id,
    'customerId', p_customer_id,
    'serviceType', 'training'
  );
end;
$$;

create function public.create_family_daycare_member(
  p_service_request_id uuid,
  p_calendar_id uuid,
  p_schedule_type_id uuid,
  p_title text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_all_day boolean,
  p_time_unspecified boolean,
  p_dog_id uuid,
  p_customer_id uuid,
  p_assignee_ids uuid[],
  p_memo text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  service_result jsonb;
  service_record_id uuid;
begin
  if not exists (
    select 1
    from public.operation_calendars calendar
    join public.business_units unit on unit.id = calendar.business_unit_id
    where calendar.id = p_calendar_id
      and calendar.is_active and unit.is_active and unit.code = 'daycare'
  ) then
    raise exception '활성 유치원 Calendar를 확인할 수 없습니다.'
      using errcode = '22023';
  end if;

  service_result := public.create_operation_schedule(
    p_calendar_id, p_schedule_type_id, p_title,
    p_starts_at, p_ends_at, p_all_day, p_time_unspecified,
    p_memo, p_assignee_ids, array[p_customer_id], array[p_dog_id],
    p_service_request_id
  );

  service_record_id := (service_result ->> 'id')::uuid;
  if service_record_id is null or not exists (
    select 1
    from public.operation_schedules schedule
    join public.operation_calendars calendar
      on calendar.id = schedule.calendar_id
    join public.business_units unit
      on unit.id = calendar.business_unit_id
    where schedule.id = service_record_id
      and schedule.archived_at is null
      and unit.code = 'daycare'
      and exists (
        select 1 from public.operation_schedule_dogs dog_link
        where dog_link.schedule_id = schedule.id
          and dog_link.dog_id = p_dog_id
          and dog_link.archived_at is null
      )
      and not exists (
        select 1 from public.operation_schedule_dogs dog_link
        where dog_link.schedule_id = schedule.id
          and dog_link.dog_id <> p_dog_id
          and dog_link.archived_at is null
      )
      and exists (
        select 1 from public.operation_schedule_customers customer_link
        where customer_link.schedule_id = schedule.id
          and customer_link.customer_id = p_customer_id
          and customer_link.archived_at is null
      )
      and not exists (
        select 1 from public.operation_schedule_customers customer_link
        where customer_link.schedule_id = schedule.id
          and customer_link.customer_id <> p_customer_id
          and customer_link.archived_at is null
      )
  ) then
    raise exception 'Daycare Adapter 반환 일정의 고객·반려견·서비스 계약이 일치하지 않습니다.'
      using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'serviceRecordId', service_record_id,
    'serviceVersion', (service_result ->> 'version')::integer,
    'dogId', p_dog_id,
    'customerId', p_customer_id,
    'serviceType', 'daycare'
  );
end;
$$;

create function public.create_family_booking(
  p_customer_id uuid,
  p_common_memo text,
  p_payment_bundle_requested boolean,
  p_members jsonb,
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
  booking_id uuid;
  member_value jsonb;
  service_payload jsonb;
  service_result jsonb;
  service_request_id uuid;
  service_record_id uuid;
  assignee_ids uuid[];
  member_id uuid;
  group_record record;
  group_member jsonb;
  group_id uuid;
  group_starts_at timestamptz;
  group_ends_at timestamptz;
  root_audit_count integer;
begin
  if actor_id is null or not public.is_active_operation_member() then
    raise exception 'Family Booking 생성 권한이 없습니다.'
      using errcode = '42501';
  end if;
  if p_request_id is null then
    raise exception 'Family Booking request_id가 필요합니다.'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'family-booking-request:' || p_request_id::text, 0
  ));

  canonical_payload_value := public.canonicalize_family_booking_payload(
    p_customer_id, p_common_memo, p_payment_bundle_requested, p_members
  );
  payload_hash_value := public.family_booking_payload_hash(
    canonical_payload_value
  );

  select booking.* into existing_booking
  from public.family_bookings booking
  where booking.request_id = p_request_id;

  if existing_booking.id is not null then
    if existing_booking.archived_at is not null
      or existing_booking.canonical_payload_hash <> payload_hash_value
      or existing_booking.canonical_payload <> canonical_payload_value then
      raise exception '동일 request_id의 Family Booking 입력 계약이 일치하지 않습니다.'
        using errcode = '23505';
    end if;
    return public.family_booking_json(existing_booking.id);
  end if;

  perform public.assert_family_booking_payload(canonical_payload_value);

  -- 중첩 서비스 RPC가 다시 획득할 결정적 request lock을 먼저 확보한다.
  perform pg_advisory_xact_lock(case
    when member.value ->> 'serviceType' = 'hotel' then hashtextextended(
      'hotel-request:' || public.family_booking_internal_request_id(
        p_request_id,
        (member.value ->> 'dogId')::uuid,
        member.value ->> 'serviceType',
        member.value ->> 'stableMemberKey',
        'hotel_reservation'
      )::text, 0
    )
    else hashtextextended(
      public.family_booking_internal_request_id(
        p_request_id,
        (member.value ->> 'dogId')::uuid,
        member.value ->> 'serviceType',
        member.value ->> 'stableMemberKey',
        case member.value ->> 'serviceType'
          when 'training' then 'training_schedule'
          else 'daycare_schedule'
        end
      )::text, 0
    )
  end)
  from jsonb_array_elements(
    canonical_payload_value -> 'members'
  ) member(value)
  order by
    member.value ->> 'serviceType',
    member.value ->> 'dogId',
    member.value ->> 'stableMemberKey';

  perform 1 from public.customers customer
  where customer.id = p_customer_id and customer.is_active
  for update;

  perform 1
  from public.dogs dog
  where dog.id in (
    select (member.value ->> 'dogId')::uuid
    from jsonb_array_elements(
      canonical_payload_value -> 'members'
    ) member(value)
  )
  order by dog.id
  for update;

  -- 모든 확정 Room Type lock을 UUID 순서로 먼저 획득한다.
  perform pg_advisory_xact_lock(hashtextextended(
    'hotel-capacity:' || room_type_id::text, 0
  ))
  from (
    select distinct
      (member.value -> 'servicePayload' ->> 'roomTypeId')::uuid
        as room_type_id
    from jsonb_array_elements(
      canonical_payload_value -> 'members'
    ) member(value)
    where member.value ->> 'serviceType' = 'hotel'
      and member.value -> 'servicePayload' ->> 'roomTypeId' is not null
    order by room_type_id
  ) locked_room_type;

  perform set_config('app.family_booking_request_id', '', true);
  perform set_config(
    'app.family_booking_change_reason', 'Family Booking 생성 준비', true
  );

  insert into public.family_bookings (
    customer_id, status, common_memo, payment_bundle_requested,
    canonical_payload, canonical_payload_hash, request_id,
    created_by, updated_by
  ) values (
    p_customer_id, 'pending', nullif(btrim(p_common_memo), ''),
    coalesce(p_payment_bundle_requested, false), canonical_payload_value,
    payload_hash_value, p_request_id, actor_id, actor_id
  ) returning id into booking_id;

  -- 확정 유형 Hotel Member를 먼저 처리하고, 미정 유형은 그 뒤에 처리한다.
  for member_value in
    select member.value
    from jsonb_array_elements(
      canonical_payload_value -> 'members'
    ) member(value)
    order by
      case
        when member.value ->> 'serviceType' = 'hotel'
          and member.value -> 'servicePayload' ->> 'roomTypeId' is not null
          then 0
        when member.value ->> 'serviceType' in ('training', 'daycare')
          then 1
        else 2
      end,
      coalesce(member.value -> 'servicePayload' ->> 'roomTypeId', ''),
      member.value ->> 'dogId',
      member.value ->> 'stableMemberKey'
  loop
    service_payload := member_value -> 'servicePayload';
    select coalesce(array_agg(value::uuid order by value), '{}'::uuid[])
    into assignee_ids
    from jsonb_array_elements_text(member_value -> 'assigneeIds') ids(value);

    service_request_id := public.family_booking_internal_request_id(
      p_request_id,
      (member_value ->> 'dogId')::uuid,
      member_value ->> 'serviceType',
      member_value ->> 'stableMemberKey',
      case member_value ->> 'serviceType'
        when 'hotel' then 'hotel_reservation'
        when 'training' then 'training_schedule'
        else 'daycare_schedule'
      end
    );

    if member_value ->> 'serviceType' = 'hotel' then
      service_result := public.create_family_hotel_member(
        service_request_id,
        (service_payload ->> 'calendarId')::uuid,
        (service_payload ->> 'scheduleTypeId')::uuid,
        (service_payload ->> 'checkInDate')::date,
        (service_payload ->> 'checkInTime')::time,
        (service_payload ->> 'checkInTimeUnspecified')::boolean,
        (service_payload ->> 'checkOutDate')::date,
        (service_payload ->> 'checkOutTime')::time,
        (service_payload ->> 'checkOutTimeUnspecified')::boolean,
        (service_payload ->> 'roomTypeId')::uuid,
        (member_value ->> 'dogId')::uuid,
        p_customer_id, assignee_ids, member_value ->> 'memo'
      );
    elsif member_value ->> 'serviceType' = 'training' then
      service_result := public.create_family_training_member(
        service_request_id,
        (service_payload ->> 'calendarId')::uuid,
        (service_payload ->> 'scheduleTypeId')::uuid,
        service_payload ->> 'title',
        (service_payload ->> 'startsAt')::timestamptz,
        (service_payload ->> 'endsAt')::timestamptz,
        (service_payload ->> 'allDay')::boolean,
        (service_payload ->> 'timeUnspecified')::boolean,
        (member_value ->> 'dogId')::uuid,
        p_customer_id, assignee_ids, member_value ->> 'memo'
      );
    else
      service_result := public.create_family_daycare_member(
        service_request_id,
        (service_payload ->> 'calendarId')::uuid,
        (service_payload ->> 'scheduleTypeId')::uuid,
        service_payload ->> 'title',
        (service_payload ->> 'startsAt')::timestamptz,
        (service_payload ->> 'endsAt')::timestamptz,
        (service_payload ->> 'allDay')::boolean,
        (service_payload ->> 'timeUnspecified')::boolean,
        (member_value ->> 'dogId')::uuid,
        p_customer_id, assignee_ids, member_value ->> 'memo'
      );
    end if;

    service_record_id := (service_result ->> 'serviceRecordId')::uuid;
    if service_record_id is null
      or (service_result ->> 'dogId')::uuid
        is distinct from (member_value ->> 'dogId')::uuid
      or (service_result ->> 'customerId')::uuid
        is distinct from p_customer_id
      or service_result ->> 'serviceType'
        is distinct from member_value ->> 'serviceType' then
      raise exception '서비스 Adapter 반환 ID·고객·반려견·서비스 계약이 일치하지 않습니다.'
        using errcode = 'P0002';
    end if;

    perform set_config('app.family_booking_request_id', '', true);
    perform set_config(
      'app.family_booking_change_reason',
      'Family Booking Member 서비스 연결', true
    );

    insert into public.family_booking_members (
      family_booking_id, stable_member_key, dog_id, service_type, status,
      hotel_stay_id, operation_schedule_id, created_by, updated_by
    ) values (
      booking_id,
      member_value ->> 'stableMemberKey',
      (member_value ->> 'dogId')::uuid,
      member_value ->> 'serviceType',
      'confirmed',
      case when member_value ->> 'serviceType' = 'hotel'
        then service_record_id else null end,
      case when member_value ->> 'serviceType' in ('training', 'daycare')
        then service_record_id else null end,
      actor_id, actor_id
    ) returning id into member_id;
  end loop;

  for group_record in
    select
      member.value ->> 'sharedRoomGroupKey' as stable_group_key,
      min(member.value ->> 'stableMemberKey') as leader_stable_member_key,
      count(*)::integer as requested_capacity
    from jsonb_array_elements(
      canonical_payload_value -> 'members'
    ) member(value)
    where member.value ->> 'sharedRoomGroupKey' is not null
    group by member.value ->> 'sharedRoomGroupKey'
    order by member.value ->> 'sharedRoomGroupKey'
  loop
    select member.value into group_member
    from jsonb_array_elements(
      canonical_payload_value -> 'members'
    ) member(value)
    where member.value ->> 'stableMemberKey'
      = group_record.leader_stable_member_key;

    service_payload := group_member -> 'servicePayload';
    group_starts_at := case
      when (service_payload ->> 'checkInTimeUnspecified')::boolean
        then (service_payload ->> 'checkInDate')::date::timestamp
          at time zone 'Asia/Seoul'
      else (
        (service_payload ->> 'checkInDate')::date::timestamp
        + (service_payload ->> 'checkInTime')::time
      ) at time zone 'Asia/Seoul'
    end;
    group_ends_at := case
      when (service_payload ->> 'checkOutTimeUnspecified')::boolean
        then (
          (service_payload ->> 'checkOutDate')::date + 1
        )::timestamp at time zone 'Asia/Seoul'
      else (
        (service_payload ->> 'checkOutDate')::date::timestamp
        + (service_payload ->> 'checkOutTime')::time
      ) at time zone 'Asia/Seoul'
    end;

    insert into public.family_shared_room_groups (
      family_booking_id, stable_group_key, leader_member_id,
      room_type_id, normalized_starts_at, normalized_ends_at,
      requested_capacity, status, created_by, updated_by
    )
    select
      booking_id, group_record.stable_group_key, member.id,
      (service_payload ->> 'roomTypeId')::uuid,
      group_starts_at, group_ends_at,
      group_record.requested_capacity, 'requested', actor_id, actor_id
    from public.family_booking_members member
    where member.family_booking_id = booking_id
      and member.stable_member_key = group_record.leader_stable_member_key
    returning id into group_id;

    update public.family_booking_members member
    set shared_room_group_id = group_id
    where member.family_booking_id = booking_id
      and member.stable_member_key in (
        select grouped.value ->> 'stableMemberKey'
        from jsonb_array_elements(
          canonical_payload_value -> 'members'
        ) grouped(value)
        where grouped.value ->> 'sharedRoomGroupKey'
          = group_record.stable_group_key
      );
  end loop;

  perform set_config(
    'app.family_booking_change_reason', 'Family Booking 원자적 생성 완료', true
  );
  perform set_config(
    'app.family_booking_request_id', p_request_id::text, true
  );

  update public.family_bookings booking
  set status = public.family_booking_derived_status(booking.id),
      updated_by = actor_id
  where booking.id = booking_id;

  select count(*)::integer into root_audit_count
  from public.entity_audit_events audit
  where audit.module_code = 'family_booking'
    and audit.entity_type = 'family_bookings'
    and audit.entity_id = booking_id
    and audit.request_id = p_request_id;

  if root_audit_count <> 1 then
    raise exception 'Family Booking Root Audit은 정확히 한 건이어야 합니다.'
      using errcode = 'P0001',
        detail = format('root_audit_count=%s', root_audit_count);
  end if;

  return public.family_booking_json(booking_id);
end;
$$;

alter table public.family_bookings enable row level security;
alter table public.family_booking_members enable row level security;
alter table public.family_shared_room_groups enable row level security;

create policy family_bookings_select_members
  on public.family_bookings
  for select to authenticated
  using (public.is_active_operation_member());
create policy family_booking_members_select_members
  on public.family_booking_members
  for select to authenticated
  using (public.is_active_operation_member());
create policy family_shared_room_groups_select_members
  on public.family_shared_room_groups
  for select to authenticated
  using (public.is_active_operation_member());

revoke all on table public.family_bookings from public, anon, authenticated;
revoke all on table public.family_booking_members from public, anon, authenticated;
revoke all on table public.family_shared_room_groups
  from public, anon, authenticated;
grant select on table public.family_bookings to authenticated;
grant select on table public.family_booking_members to authenticated;
grant select on table public.family_shared_room_groups to authenticated;

revoke all on function public.family_booking_internal_request_id(
  uuid, uuid, text, text, text
) from public, anon, authenticated;
revoke all on function public.canonicalize_family_booking_payload(
  uuid, text, boolean, jsonb
) from public, anon, authenticated;
revoke all on function public.family_booking_payload_hash(jsonb)
  from public, anon, authenticated;
revoke all on function public.assert_family_booking_payload(jsonb)
  from public, anon, authenticated;
revoke all on function public.family_booking_derived_status(uuid)
  from public, anon, authenticated;
revoke all on function public.family_booking_set_metadata()
  from public, anon, authenticated;
revoke all on function public.prevent_family_booking_physical_delete()
  from public, anon, authenticated;
revoke all on function public.record_family_booking_audit_event()
  from public, anon, authenticated;
revoke all on function public.create_family_hotel_member(
  uuid, uuid, uuid, date, time, boolean, date, time, boolean,
  uuid, uuid, uuid, uuid[], text
) from public, anon, authenticated;
revoke all on function public.create_family_training_member(
  uuid, uuid, uuid, text, timestamptz, timestamptz,
  boolean, boolean, uuid, uuid, uuid[], text
) from public, anon, authenticated;
revoke all on function public.create_family_daycare_member(
  uuid, uuid, uuid, text, timestamptz, timestamptz,
  boolean, boolean, uuid, uuid, uuid[], text
) from public, anon, authenticated;

revoke all on function public.family_booking_json(uuid)
  from public, anon;
grant execute on function public.family_booking_json(uuid)
  to authenticated;

revoke all on function public.create_family_booking(
  uuid, text, boolean, jsonb, uuid
) from public, anon;
grant execute on function public.create_family_booking(
  uuid, text, boolean, jsonb, uuid
) to authenticated;

commit;
