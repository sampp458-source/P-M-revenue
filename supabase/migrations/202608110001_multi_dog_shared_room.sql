-- P&M OS Multi-Dog Shared Room platform.
-- Physical room/capacity ownership is separated from Dog-specific hotel_stays.

begin;

do $$
begin
  if to_regclass('public.hotel_physical_occupancies') is not null
    or to_regclass('public.hotel_physical_occupancy_members') is not null
    or to_regclass('public.hotel_physical_occupancy_requests') is not null then
    raise exception 'STOP_MULTI_DOG_SHARED_ROOM_ALREADY_APPLIED';
  end if;
  if to_regclass('public.family_bookings') is null
    or to_regclass('public.family_booking_members') is null
    or to_regclass('public.family_shared_room_groups') is null
    or to_regclass('public.hotel_stays') is null
    or to_regclass('public.hotel_capacity_reservations') is null
    or to_regclass('public.hotel_room_allocations') is null then
    raise exception 'STOP_MULTI_DOG_SHARED_ROOM_DEPENDENCY_MISSING';
  end if;
  if exists (
    select 1 from public.family_shared_room_groups room_group
    where room_group.archived_at is null
      and room_group.status = 'allocated'
  ) then
    raise exception 'STOP_MULTI_DOG_SHARED_ROOM_BACKFILL_REQUIRED';
  end if;
  if (select count(*) from public.hotel_room_types room_type
      where room_type.archived_at is null and room_type.is_active
        and upper(btrim(room_type.code)) = 'DELUXE'
        and upper(btrim(room_type.name)) = 'DELUXE') <> 1 then
    raise exception 'STOP_MULTI_DOG_SHARED_ROOM_DELUXE_CANONICAL_MISMATCH';
  end if;
end;
$$;

create table public.hotel_physical_occupancies (
  id uuid primary key default gen_random_uuid(),
  family_booking_id uuid not null references public.family_bookings(id) on delete restrict,
  shared_room_group_id uuid not null references public.family_shared_room_groups(id) on delete restrict,
  customer_id uuid not null references public.customers(id) on delete restrict,
  room_type_id uuid not null references public.hotel_room_types(id) on delete restrict,
  room_id uuid not null references public.hotel_rooms(id) on delete restrict,
  occupied_from timestamptz not null,
  occupied_until timestamptz not null,
  restore_occupied_until timestamptz null,
  capacity_reservation_id uuid null,
  room_allocation_id uuid null,
  status text not null default 'active'
    check (status in ('active','completed','released')),
  version integer not null default 1 check (version > 0),
  request_id uuid not null unique,
  canonical_payload_hash text not null check (canonical_payload_hash ~ '^[0-9a-f]{32}$'),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_by uuid not null references public.profiles(id) on delete restrict,
  updated_at timestamptz not null default now(),
  completed_at timestamptz null,
  archived_at timestamptz null,
  archived_by uuid null references public.profiles(id) on delete restrict,
  archive_reason text null,
  constraint hotel_physical_occupancies_time_check check (occupied_until > occupied_from),
  constraint hotel_physical_occupancies_completion_check check (
    (status = 'active' and completed_at is null and restore_occupied_until is null)
    or (status in ('completed','released') and completed_at is not null and restore_occupied_until is not null)
  ),
  constraint hotel_physical_occupancies_archive_check check (
    (archived_at is null and archived_by is null and archive_reason is null)
    or (archived_at is not null and archived_by is not null and nullif(btrim(archive_reason),'') is not null)
  ),
  unique (shared_room_group_id)
);

create table public.hotel_physical_occupancy_members (
  id uuid primary key default gen_random_uuid(),
  occupancy_id uuid not null references public.hotel_physical_occupancies(id) on delete restrict,
  family_booking_member_id uuid not null references public.family_booking_members(id) on delete restrict,
  hotel_stay_id uuid not null references public.hotel_stays(id) on delete restrict,
  dog_id uuid not null references public.dogs(id) on delete restrict,
  status text not null default 'active' check (status in ('active','completed','left')),
  joined_at timestamptz not null default now(),
  left_at timestamptz null,
  version integer not null default 1 check (version > 0),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_by uuid not null references public.profiles(id) on delete restrict,
  updated_at timestamptz not null default now(),
  archived_at timestamptz null,
  archived_by uuid null references public.profiles(id) on delete restrict,
  archive_reason text null,
  constraint hotel_physical_occupancy_members_lifecycle_check check (
    (status = 'active' and left_at is null)
    or (status in ('completed','left') and left_at is not null)
  ),
  constraint hotel_physical_occupancy_members_archive_check check (
    (archived_at is null and archived_by is null and archive_reason is null)
    or (archived_at is not null and archived_by is not null and nullif(btrim(archive_reason),'') is not null)
  )
);

create unique index hotel_physical_occupancy_members_stay_uidx
  on public.hotel_physical_occupancy_members(hotel_stay_id)
  where archived_at is null;
create unique index hotel_physical_occupancy_members_family_member_uidx
  on public.hotel_physical_occupancy_members(family_booking_member_id)
  where archived_at is null;
create unique index hotel_physical_occupancy_members_dog_uidx
  on public.hotel_physical_occupancy_members(occupancy_id,dog_id)
  where archived_at is null;
create index hotel_physical_occupancy_members_occupancy_idx
  on public.hotel_physical_occupancy_members(occupancy_id,status)
  where archived_at is null;

create table public.hotel_physical_occupancy_requests (
  request_id uuid primary key,
  occupancy_id uuid null references public.hotel_physical_occupancies(id) on delete restrict,
  operation_kind text not null check (operation_kind in (
    'create','join','check_in','check_out','reverse_completion','move'
  )),
  canonical_payload_hash text not null check (canonical_payload_hash ~ '^[0-9a-f]{32}$'),
  response jsonb null,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  completed_at timestamptz null
);

alter table public.hotel_capacity_reservations
  add column physical_occupancy_id uuid null
    references public.hotel_physical_occupancies(id) on delete restrict;

alter table public.hotel_capacity_reservations
  drop constraint hotel_capacity_reservations_source_kind_check;
alter table public.hotel_capacity_reservations
  add constraint hotel_capacity_reservations_source_kind_check
  check (source_kind in ('stay','daycare','shared_occupancy'));

alter table public.hotel_capacity_reservations
  drop constraint hotel_capacity_reservations_source_check;
alter table public.hotel_capacity_reservations
  add constraint hotel_capacity_reservations_source_check check (
    (source_kind = 'stay' and hotel_stay_id is not null and daycare_schedule_id is null and physical_occupancy_id is null)
    or (source_kind = 'daycare' and hotel_stay_id is null and daycare_schedule_id is not null and physical_occupancy_id is null)
    or (source_kind = 'shared_occupancy' and hotel_stay_id is null and daycare_schedule_id is null and physical_occupancy_id is not null)
  );

create unique index hotel_capacity_reservations_physical_occupancy_uidx
  on public.hotel_capacity_reservations(physical_occupancy_id)
  where source_kind = 'shared_occupancy' and archived_at is null;

alter table public.hotel_physical_occupancies
  add constraint hotel_physical_occupancies_capacity_fkey
    foreign key (capacity_reservation_id) references public.hotel_capacity_reservations(id) on delete restrict,
  add constraint hotel_physical_occupancies_allocation_fkey
    foreign key (room_allocation_id) references public.hotel_room_allocations(id) on delete restrict;

create index hotel_physical_occupancies_room_overlap_idx
  on public.hotel_physical_occupancies(room_id,occupied_from,occupied_until)
  where archived_at is null and status = 'active';
create index hotel_physical_occupancies_family_idx
  on public.hotel_physical_occupancies(family_booking_id,status,created_at desc)
  where archived_at is null;

create function public.shared_hotel_payload_hash(p_payload jsonb)
returns text language sql immutable strict
set search_path = public, pg_temp
as $$ select md5(p_payload::text); $$;

create function public.claim_shared_hotel_request_internal(
  p_request_id uuid,
  p_operation_kind text,
  p_payload jsonb,
  p_occupancy_id uuid default null
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  wanted_hash text := public.shared_hotel_payload_hash(p_payload);
  existing public.hotel_physical_occupancy_requests%rowtype;
begin
  if actor_id is null or not public.is_active_operation_member() then
    raise exception '공유 객실 작업 권한이 없습니다.' using errcode='42501';
  end if;
  if p_request_id is null then
    raise exception '요청 ID가 필요합니다.' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('shared-hotel-request:'||p_request_id::text,0));
  select * into existing from public.hotel_physical_occupancy_requests
  where request_id=p_request_id for update;
  if found then
    if existing.operation_kind<>p_operation_kind or existing.canonical_payload_hash<>wanted_hash then
      raise exception '동일 요청 ID가 다른 공유 객실 작업에 사용되었습니다.' using errcode='PT409';
    end if;
    return existing.response;
  end if;
  insert into public.hotel_physical_occupancy_requests(
    request_id,occupancy_id,operation_kind,canonical_payload_hash,created_by
  ) values (p_request_id,p_occupancy_id,p_operation_kind,wanted_hash,actor_id);
  return null;
end;
$$;

create function public.finish_shared_hotel_request_internal(
  p_request_id uuid,
  p_occupancy_id uuid,
  p_response jsonb
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  update public.hotel_physical_occupancy_requests
  set occupancy_id=p_occupancy_id,response=p_response,completed_at=now()
  where request_id=p_request_id and response is null;
  return p_response;
end;
$$;

create function public.shared_hotel_occupancy_json_internal(p_occupancy_id uuid)
returns jsonb
language sql stable security definer set search_path = public, pg_temp
as $$
select jsonb_build_object(
  'id',o.id,'familyBookingId',o.family_booking_id,'sharedRoomGroupId',o.shared_room_group_id,
  'customerId',o.customer_id,'roomTypeId',o.room_type_id,'roomTypeCode',rt.code,
  'roomId',o.room_id,'roomName',r.name,'occupiedFrom',o.occupied_from,
  'occupiedUntil',o.occupied_until,'status',o.status,'version',o.version,
  'capacityReservationId',o.capacity_reservation_id,'roomAllocationId',o.room_allocation_id,
  'capacityUsed',case when o.status='active' then 1 else 0 end,
  'dogCount',(select count(*) from public.hotel_physical_occupancy_members m where m.occupancy_id=o.id and m.archived_at is null and m.status='active'),
  'members',coalesce((select jsonb_agg(jsonb_build_object(
    'id',m.id,'familyBookingMemberId',m.family_booking_member_id,'hotelStayId',m.hotel_stay_id,
    'dogId',m.dog_id,'dogName',d.name,'status',m.status,'joinedAt',m.joined_at,'leftAt',m.left_at
  ) order by d.name,m.id) from public.hotel_physical_occupancy_members m join public.dogs d on d.id=m.dog_id
    where m.occupancy_id=o.id and m.archived_at is null),'[]'::jsonb)
)
from public.hotel_physical_occupancies o
join public.hotel_rooms r on r.id=o.room_id
join public.hotel_room_types rt on rt.id=o.room_type_id
where o.id=p_occupancy_id;
$$;

create function public.get_shared_hotel_room_occupancy(p_occupancy_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  if not public.is_active_operation_member() then
    raise exception '공유 객실 조회 권한이 없습니다.' using errcode='42501';
  end if;
  return public.shared_hotel_occupancy_json_internal(p_occupancy_id);
end;
$$;

create function public.get_hotel_shared_room_occupancies(p_date date)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  if not public.is_active_operation_member() then
    raise exception '공유 객실 조회 권한이 없습니다.' using errcode='42501';
  end if;
  return coalesce((select jsonb_agg(public.shared_hotel_occupancy_json_internal(o.id) order by r.sort_order,r.name,o.id)
    from public.hotel_physical_occupancies o join public.hotel_rooms r on r.id=o.room_id
    where o.archived_at is null and o.status='active'
      and o.occupied_from < ((p_date+1)::timestamp at time zone 'Asia/Seoul')
      and o.occupied_until > (p_date::timestamp at time zone 'Asia/Seoul')),'[]'::jsonb);
end;
$$;

create function public.assert_shared_hotel_occupancy_internal(p_occupancy_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  o public.hotel_physical_occupancies%rowtype;
  g public.family_shared_room_groups%rowtype;
  cap public.hotel_capacity_reservations%rowtype;
  alloc public.hotel_room_allocations%rowtype;
begin
  select * into o from public.hotel_physical_occupancies where id=p_occupancy_id;
  if not found or o.archived_at is not null then return; end if;
  select * into g from public.family_shared_room_groups where id=o.shared_room_group_id and archived_at is null;
  if not found or g.family_booking_id<>o.family_booking_id or g.room_type_id<>o.room_type_id then
    raise exception '공유 객실 Family intent 관계가 올바르지 않습니다.' using errcode='23514';
  end if;
  if not exists (select 1 from public.family_bookings f where f.id=o.family_booking_id and f.customer_id=o.customer_id and f.archived_at is null) then
    raise exception '공유 객실 보호자 관계가 올바르지 않습니다.' using errcode='23514';
  end if;
  if not exists (select 1 from public.hotel_room_types rt where rt.id=o.room_type_id and rt.is_active and rt.archived_at is null
    and upper(btrim(rt.code))='DELUXE' and upper(btrim(rt.name))='DELUXE') then
    raise exception '공유 객실은 DELUXE만 사용할 수 있습니다.' using errcode='23514';
  end if;
  if not exists (select 1 from public.hotel_rooms r where r.id=o.room_id and r.room_type_id=o.room_type_id and r.is_active and r.archived_at is null) then
    raise exception '공유 객실과 객실 유형이 일치하지 않습니다.' using errcode='23514';
  end if;
  if o.capacity_reservation_id is null or o.room_allocation_id is null then
    raise exception '공유 객실 Capacity/Allocation 연결이 필요합니다.' using errcode='23514';
  end if;
  select * into cap from public.hotel_capacity_reservations where id=o.capacity_reservation_id and physical_occupancy_id=o.id and source_kind='shared_occupancy' and archived_at is null;
  select * into alloc from public.hotel_room_allocations where id=o.room_allocation_id and capacity_reservation_id=o.capacity_reservation_id and archived_at is null;
  if cap.id is null or alloc.id is null or cap.quantity<>1 or cap.room_type_id<>o.room_type_id or alloc.room_id<>o.room_id then
    raise exception '공유 객실 Capacity/Allocation 소유권이 올바르지 않습니다.' using errcode='23514';
  end if;
  if cap.reserved_from<>o.occupied_from or cap.reserved_until<>o.occupied_until
    or alloc.allocated_from<>o.occupied_from or alloc.allocated_until<>o.occupied_until then
    raise exception '공유 객실 기간과 Capacity/Allocation 기간이 일치하지 않습니다.' using errcode='23514';
  end if;
  if o.status='active' and (select count(*) from public.hotel_physical_occupancy_members m where m.occupancy_id=o.id and m.archived_at is null and m.status='active')<1 then
    raise exception '활성 공유 객실에는 활성 Dog member가 필요합니다.' using errcode='23514';
  end if;
end;
$$;

create function public.assert_shared_hotel_member_internal(p_member_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  m public.hotel_physical_occupancy_members%rowtype;
  o public.hotel_physical_occupancies%rowtype;
begin
  select * into m from public.hotel_physical_occupancy_members where id=p_member_id;
  if not found or m.archived_at is not null then return; end if;
  select * into o from public.hotel_physical_occupancies where id=m.occupancy_id and archived_at is null;
  if not found then raise exception '공유 객실 Root를 확인할 수 없습니다.' using errcode='23514'; end if;
  if not exists (
    select 1 from public.family_booking_members fm
    join public.hotel_stays s on s.id=fm.hotel_stay_id
    join public.dogs d on d.id=fm.dog_id
    where fm.id=m.family_booking_member_id and fm.family_booking_id=o.family_booking_id
      and fm.shared_room_group_id=o.shared_room_group_id and fm.service_type='hotel'
      and fm.hotel_stay_id=m.hotel_stay_id and fm.dog_id=m.dog_id
      and fm.archived_at is null and s.id=m.hotel_stay_id and s.dog_id=m.dog_id and s.archived_at is null
      and d.customer_id=o.customer_id
  ) then
    raise exception '공유 객실 Dog/Stay/Family intent 관계가 올바르지 않습니다.' using errcode='23514';
  end if;
end;
$$;

create function public.enforce_shared_hotel_occupancy_deferred()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$ begin perform public.assert_shared_hotel_occupancy_internal(coalesce(new.id,old.id)); return coalesce(new,old); end; $$;
create function public.enforce_shared_hotel_member_deferred()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$ begin perform public.assert_shared_hotel_member_internal(coalesce(new.id,old.id)); return coalesce(new,old); end; $$;
create function public.enforce_shared_capacity_deferred()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$ begin if coalesce(new.physical_occupancy_id,old.physical_occupancy_id) is not null then perform public.assert_shared_hotel_occupancy_internal(coalesce(new.physical_occupancy_id,old.physical_occupancy_id)); end if; return coalesce(new,old); end; $$;
create function public.enforce_shared_allocation_deferred()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare oid uuid;
begin
  select physical_occupancy_id into oid from public.hotel_capacity_reservations where id=coalesce(new.capacity_reservation_id,old.capacity_reservation_id);
  if oid is not null then perform public.assert_shared_hotel_occupancy_internal(oid); end if;
  return coalesce(new,old);
end;
$$;

create constraint trigger hotel_physical_occupancies_invariant
after insert or update on public.hotel_physical_occupancies deferrable initially deferred
for each row execute function public.enforce_shared_hotel_occupancy_deferred();
create constraint trigger hotel_physical_occupancy_members_invariant
after insert or update on public.hotel_physical_occupancy_members deferrable initially deferred
for each row execute function public.enforce_shared_hotel_member_deferred();
create constraint trigger hotel_capacity_reservations_shared_invariant
after insert or update on public.hotel_capacity_reservations deferrable initially deferred
for each row execute function public.enforce_shared_capacity_deferred();
create constraint trigger hotel_room_allocations_shared_invariant
after insert or update on public.hotel_room_allocations deferrable initially deferred
for each row execute function public.enforce_shared_allocation_deferred();

create function public.create_shared_hotel_room_occupancy(
  p_shared_room_group_id uuid,
  p_room_id uuid,
  p_request_id uuid
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  actor_id uuid:=auth.uid(); replay jsonb; payload jsonb;
  g public.family_shared_room_groups%rowtype; f public.family_bookings%rowtype;
  r public.hotel_rooms%rowtype; rt public.hotel_room_types%rowtype;
  occupancy_id uuid:=gen_random_uuid(); capacity_id uuid; allocation_id uuid; result jsonb;
  member_count integer;
begin
  payload:=jsonb_build_object('roomId',p_room_id,'sharedRoomGroupId',p_shared_room_group_id);
  replay:=public.claim_shared_hotel_request_internal(p_request_id,'create',payload,null);
  if replay is not null then return replay; end if;
  select * into g from public.family_shared_room_groups where id=p_shared_room_group_id for update;
  if not found or g.archived_at is not null or g.status<>'requested' then raise exception '활성 Shared Room intent를 확인할 수 없습니다.' using errcode='23514'; end if;
  select * into f from public.family_bookings where id=g.family_booking_id and archived_at is null for update;
  if not found then raise exception 'Family Booking을 확인할 수 없습니다.' using errcode='P0002'; end if;
  select * into rt from public.hotel_room_types where id=g.room_type_id and is_active and archived_at is null;
  if not found or upper(btrim(rt.code))<>'DELUXE' or upper(btrim(rt.name))<>'DELUXE' then raise exception '공유 객실은 DELUXE만 사용할 수 있습니다.' using errcode='23514'; end if;
  select * into r from public.hotel_rooms where id=p_room_id and room_type_id=rt.id and is_active and archived_at is null;
  if not found then raise exception '활성 DELUXE 호실을 확인할 수 없습니다.' using errcode='23514'; end if;
  select count(*) into member_count from public.family_booking_members fm
  where fm.shared_room_group_id=g.id and fm.family_booking_id=f.id and fm.service_type='hotel' and fm.archived_at is null;
  if member_count<2 or member_count<>g.requested_capacity then raise exception 'Shared Room intent의 Dog member 수가 올바르지 않습니다.' using errcode='23514'; end if;
  if exists (select 1 from public.family_booking_members fm join public.hotel_stays s on s.id=fm.hotel_stay_id join public.dogs d on d.id=fm.dog_id
    left join public.hotel_capacity_reservations c on c.hotel_stay_id=s.id and c.archived_at is null
    where fm.shared_room_group_id=g.id and fm.archived_at is null and (
      d.customer_id<>f.customer_id or s.dog_id<>fm.dog_id or s.archived_at is not null or s.checked_out_at is not null
      or c.id is null or c.quantity<>1 or c.room_type_id<>g.room_type_id
      or c.reserved_from<>g.normalized_starts_at or c.reserved_until<>g.normalized_ends_at
      or exists(select 1 from public.hotel_room_allocations a where a.capacity_reservation_id=c.id and a.archived_at is null)
    )) then raise exception 'Shared Room member의 Family/Stay/Capacity 계약이 올바르지 않습니다.' using errcode='23514'; end if;
  perform 1 from public.hotel_stays s join public.family_booking_members fm on fm.hotel_stay_id=s.id
    where fm.shared_room_group_id=g.id and fm.archived_at is null order by s.id for update of s;
  perform pg_advisory_xact_lock(hashtextextended('hotel-capacity:all',0));
  perform pg_advisory_xact_lock(hashtextextended('hotel-capacity:'||g.room_type_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('hotel-room:'||p_room_id::text,0));
  perform set_config('app.operation_change_reason','다견 DELUXE 공유 객실 생성',true);
  update public.hotel_capacity_reservations c set archived_at=now(),archived_by=actor_id,archive_reason='Physical Occupancy로 통합',updated_by=actor_id
  where c.archived_at is null and exists(select 1 from public.family_booking_members fm where fm.shared_room_group_id=g.id and fm.hotel_stay_id=c.hotel_stay_id and fm.archived_at is null);
  perform public.assert_hotel_total_capacity_available(g.normalized_starts_at,g.normalized_ends_at,1,null);
  perform public.assert_hotel_capacity_available(g.room_type_id,g.normalized_starts_at,g.normalized_ends_at,1,null);
  insert into public.hotel_physical_occupancies(id,family_booking_id,shared_room_group_id,customer_id,room_type_id,room_id,occupied_from,occupied_until,status,request_id,canonical_payload_hash,created_by,updated_by)
  values(occupancy_id,f.id,g.id,f.customer_id,g.room_type_id,p_room_id,g.normalized_starts_at,g.normalized_ends_at,'active',p_request_id,public.shared_hotel_payload_hash(payload),actor_id,actor_id);
  insert into public.hotel_capacity_reservations(source_kind,physical_occupancy_id,room_type_id,reserved_from,reserved_until,quantity,created_by,updated_by)
  values('shared_occupancy',occupancy_id,g.room_type_id,g.normalized_starts_at,g.normalized_ends_at,1,actor_id,actor_id) returning id into capacity_id;
  perform public.assert_hotel_room_allocation_available(p_room_id,capacity_id,g.normalized_starts_at,g.normalized_ends_at,null);
  insert into public.hotel_room_allocations(capacity_reservation_id,room_id,allocated_from,allocated_until,assignment_reason,created_by,updated_by)
  values(capacity_id,p_room_id,g.normalized_starts_at,g.normalized_ends_at,'다견 DELUXE 공유 객실',actor_id,actor_id) returning id into allocation_id;
  update public.hotel_physical_occupancies set capacity_reservation_id=capacity_id,room_allocation_id=allocation_id,updated_by=actor_id where id=occupancy_id;
  insert into public.hotel_physical_occupancy_members(occupancy_id,family_booking_member_id,hotel_stay_id,dog_id,status,created_by,updated_by)
  select occupancy_id,fm.id,fm.hotel_stay_id,fm.dog_id,'active',actor_id,actor_id from public.family_booking_members fm
  where fm.shared_room_group_id=g.id and fm.archived_at is null order by fm.id;
  update public.family_shared_room_groups set status='allocated',updated_by=actor_id where id=g.id;
  insert into public.entity_audit_events(module_code,entity_type,entity_id,action,after_data,changed_by,change_reason,request_id)
  values('hotel_operations','hotel_physical_occupancies',occupancy_id,'created',public.shared_hotel_occupancy_json_internal(occupancy_id),actor_id,'다견 DELUXE 공유 객실 생성',p_request_id);
  result:=public.shared_hotel_occupancy_json_internal(occupancy_id);
  return public.finish_shared_hotel_request_internal(p_request_id,occupancy_id,result);
end;
$$;

create function public.join_shared_hotel_room_occupancy(
  p_occupancy_id uuid,
  p_family_booking_member_id uuid,
  p_expected_occupancy_version integer,
  p_request_id uuid
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  actor_id uuid:=auth.uid(); replay jsonb; payload jsonb;
  o public.hotel_physical_occupancies%rowtype; fm public.family_booking_members%rowtype;
  s public.hotel_stays%rowtype; c public.hotel_capacity_reservations%rowtype; result jsonb;
begin
  payload:=jsonb_build_object('expectedOccupancyVersion',p_expected_occupancy_version,'familyBookingMemberId',p_family_booking_member_id,'occupancyId',p_occupancy_id);
  replay:=public.claim_shared_hotel_request_internal(p_request_id,'join',payload,p_occupancy_id);
  if replay is not null then return replay; end if;
  select * into o from public.hotel_physical_occupancies where id=p_occupancy_id for update;
  if not found or o.archived_at is not null or o.status<>'active' then raise exception '활성 공유 객실을 확인할 수 없습니다.' using errcode='P0002'; end if;
  if o.version<>p_expected_occupancy_version then raise exception '다른 사용자가 먼저 공유 객실을 변경했습니다.' using errcode='PT409'; end if;
  select * into fm from public.family_booking_members where id=p_family_booking_member_id for update;
  if not found or fm.archived_at is not null or fm.family_booking_id<>o.family_booking_id or fm.shared_room_group_id<>o.shared_room_group_id or fm.service_type<>'hotel' then
    raise exception '동일 Family의 Shared Room intent member만 추가할 수 있습니다.' using errcode='23514';
  end if;
  if exists(select 1 from public.hotel_physical_occupancy_members m where m.family_booking_member_id=fm.id and m.archived_at is null) then raise exception '이미 공유 객실에 포함된 Dog입니다.' using errcode='23505'; end if;
  select * into s from public.hotel_stays where id=fm.hotel_stay_id for update;
  select * into c from public.hotel_capacity_reservations where hotel_stay_id=s.id and archived_at is null for update;
  if s.id is null or s.dog_id<>fm.dog_id or s.checked_out_at is not null or c.id is null or c.room_type_id<>o.room_type_id
    or c.reserved_from<>o.occupied_from or c.reserved_until<>o.occupied_until
    or not exists(select 1 from public.dogs d where d.id=fm.dog_id and d.customer_id=o.customer_id)
    or exists(select 1 from public.hotel_room_allocations a where a.capacity_reservation_id=c.id and a.archived_at is null) then
    raise exception '추가 Dog의 Stay/Capacity/Family 계약이 호환되지 않습니다.' using errcode='23514';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('hotel-capacity:all',0));
  perform pg_advisory_xact_lock(hashtextextended('hotel-capacity:'||o.room_type_id::text,0));
  perform set_config('app.operation_change_reason','다견 공유 객실 member 추가',true);
  update public.hotel_capacity_reservations set archived_at=now(),archived_by=actor_id,archive_reason='Physical Occupancy에 가입',updated_by=actor_id where id=c.id;
  insert into public.hotel_physical_occupancy_members(occupancy_id,family_booking_member_id,hotel_stay_id,dog_id,status,created_by,updated_by)
  values(o.id,fm.id,s.id,fm.dog_id,'active',actor_id,actor_id);
  update public.hotel_physical_occupancies set updated_by=actor_id where id=o.id;
  result:=public.shared_hotel_occupancy_json_internal(o.id);
  return public.finish_shared_hotel_request_internal(p_request_id,o.id,result);
end;
$$;

create function public.complete_shared_hotel_check_in(
  p_occupancy_id uuid,p_hotel_stay_id uuid,p_expected_occupancy_version integer,
  p_expected_stay_version integer,p_completed_at timestamptz,p_request_id uuid
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare actor_id uuid:=auth.uid(); replay jsonb; payload jsonb; o public.hotel_physical_occupancies%rowtype; s public.hotel_stays%rowtype; result jsonb;
begin
  payload:=jsonb_build_object('completedAt',p_completed_at,'expectedOccupancyVersion',p_expected_occupancy_version,'expectedStayVersion',p_expected_stay_version,'hotelStayId',p_hotel_stay_id,'occupancyId',p_occupancy_id);
  replay:=public.claim_shared_hotel_request_internal(p_request_id,'check_in',payload,p_occupancy_id); if replay is not null then return replay; end if;
  select * into o from public.hotel_physical_occupancies where id=p_occupancy_id for update;
  select * into s from public.hotel_stays where id=p_hotel_stay_id for update;
  if o.id is null or o.status<>'active' or s.id is null or s.archived_at is not null
    or not exists(select 1 from public.hotel_physical_occupancy_members m where m.occupancy_id=o.id and m.hotel_stay_id=s.id and m.status='active' and m.archived_at is null) then
    raise exception '활성 공유 객실 Dog Stay를 확인할 수 없습니다.' using errcode='P0002';
  end if;
  if o.version<>p_expected_occupancy_version or s.version<>p_expected_stay_version then raise exception '다른 사용자가 먼저 처리했습니다.' using errcode='PT409'; end if;
  if s.checked_in_at is null then
    if p_completed_at is null or p_completed_at<o.occupied_from or p_completed_at>=o.occupied_until then raise exception '공유 객실 점유 기간 안의 입실 시각이 필요합니다.' using errcode='22023'; end if;
    perform set_config('app.operation_change_reason','다견 공유 객실 입실 완료',true);
    perform set_config('app.operation_request_id',p_request_id::text,true);
    update public.hotel_stays set checked_in_at=p_completed_at,checked_in_by=actor_id,updated_by=actor_id where id=s.id;
    update public.family_booking_members set status='checked_in',updated_by=actor_id
      where hotel_stay_id=s.id and family_booking_id=o.family_booking_id and archived_at is null;
    perform set_config('app.operation_request_id','',true);
    update public.hotel_physical_occupancies set updated_by=actor_id where id=o.id;
  end if;
  result:=jsonb_build_object('occupancy',public.shared_hotel_occupancy_json_internal(o.id),'stay',public.hotel_stay_json(s.id));
  return public.finish_shared_hotel_request_internal(p_request_id,o.id,result);
end;
$$;

create function public.complete_shared_hotel_member_check_out(
  p_occupancy_id uuid,p_hotel_stay_id uuid,p_expected_occupancy_version integer,
  p_expected_stay_version integer,p_completed_at timestamptz,p_request_id uuid
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  actor_id uuid:=auth.uid(); replay jsonb; payload jsonb; o public.hotel_physical_occupancies%rowtype;
  s public.hotel_stays%rowtype; m public.hotel_physical_occupancy_members%rowtype;
  remaining integer; result jsonb;
begin
  payload:=jsonb_build_object('completedAt',p_completed_at,'expectedOccupancyVersion',p_expected_occupancy_version,'expectedStayVersion',p_expected_stay_version,'hotelStayId',p_hotel_stay_id,'occupancyId',p_occupancy_id);
  replay:=public.claim_shared_hotel_request_internal(p_request_id,'check_out',payload,p_occupancy_id); if replay is not null then return replay; end if;
  select * into o from public.hotel_physical_occupancies where id=p_occupancy_id for update;
  select * into s from public.hotel_stays where id=p_hotel_stay_id for update;
  select * into m from public.hotel_physical_occupancy_members where occupancy_id=p_occupancy_id and hotel_stay_id=p_hotel_stay_id and archived_at is null for update;
  if o.id is null or o.status<>'active' or s.id is null or m.id is null or m.status<>'active' then raise exception '퇴실할 공유 객실 member를 확인할 수 없습니다.' using errcode='P0002'; end if;
  if o.version<>p_expected_occupancy_version or s.version<>p_expected_stay_version then raise exception '다른 사용자가 먼저 처리했습니다.' using errcode='PT409'; end if;
  if s.checked_in_at is null or p_completed_at is null or p_completed_at<=s.checked_in_at or p_completed_at<=o.occupied_from then raise exception '입실 이후의 유효한 퇴실 시각이 필요합니다.' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('hotel-capacity:all',0));
  perform pg_advisory_xact_lock(hashtextextended('hotel-capacity:'||o.room_type_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('hotel-room:'||o.room_id::text,0));
  perform set_config('app.operation_change_reason','다견 공유 객실 member 퇴실',true);
  perform set_config('app.operation_request_id',p_request_id::text,true);
  update public.hotel_stays set checked_out_at=p_completed_at,checked_out_by=actor_id,
    checkout_previous_reserved_until=o.occupied_until,checkout_previous_allocation_id=o.room_allocation_id,
    checkout_previous_allocation_until=o.occupied_until,updated_by=actor_id where id=s.id;
  perform set_config('app.operation_request_id','',true);
  update public.hotel_physical_occupancy_members set status='completed',left_at=p_completed_at,updated_by=actor_id where id=m.id;
  update public.family_booking_members set status='completed',updated_by=actor_id
    where hotel_stay_id=s.id and family_booking_id=o.family_booking_id and archived_at is null;
  select count(*) into remaining from public.hotel_physical_occupancy_members x where x.occupancy_id=o.id and x.archived_at is null and x.status='active';
  if remaining=0 then
    if p_completed_at>o.occupied_until then
      perform public.assert_hotel_total_capacity_available(o.occupied_from,p_completed_at,1,o.capacity_reservation_id);
      perform public.assert_hotel_capacity_available(o.room_type_id,o.occupied_from,p_completed_at,1,o.capacity_reservation_id);
      perform public.assert_hotel_room_allocation_available(o.room_id,o.capacity_reservation_id,o.occupied_from,p_completed_at,o.room_allocation_id);
    end if;
    update public.hotel_capacity_reservations set reserved_until=p_completed_at,updated_by=actor_id where id=o.capacity_reservation_id;
    update public.hotel_room_allocations set allocated_until=p_completed_at,updated_by=actor_id where id=o.room_allocation_id;
    update public.hotel_physical_occupancies set restore_occupied_until=o.occupied_until,occupied_until=p_completed_at,status='completed',completed_at=p_completed_at,updated_by=actor_id where id=o.id;
    update public.family_shared_room_groups set status='released',updated_by=actor_id where id=o.shared_room_group_id;
  else
    update public.hotel_physical_occupancies set updated_by=actor_id where id=o.id;
  end if;
  result:=jsonb_build_object('occupancy',public.shared_hotel_occupancy_json_internal(o.id),'stay',public.hotel_stay_json(s.id),'remainingActiveMembers',remaining);
  return public.finish_shared_hotel_request_internal(p_request_id,o.id,result);
end;
$$;

create function public.reverse_shared_hotel_member_completion(
  p_occupancy_id uuid,p_hotel_stay_id uuid,p_expected_occupancy_version integer,
  p_expected_stay_version integer,p_reason text,p_request_id uuid
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  actor_id uuid:=auth.uid(); replay jsonb; payload jsonb; o public.hotel_physical_occupancies%rowtype;
  s public.hotel_stays%rowtype; m public.hotel_physical_occupancy_members%rowtype;
  restore_until timestamptz; result jsonb;
begin
  if not public.has_operation_role(array['owner','manager']) then raise exception 'Operations Owner/Manager만 완료를 취소할 수 있습니다.' using errcode='42501'; end if;
  if nullif(btrim(p_reason),'') is null then raise exception '완료 취소 사유가 필요합니다.' using errcode='22023'; end if;
  payload:=jsonb_build_object('expectedOccupancyVersion',p_expected_occupancy_version,'expectedStayVersion',p_expected_stay_version,'hotelStayId',p_hotel_stay_id,'occupancyId',p_occupancy_id,'reason',btrim(p_reason));
  replay:=public.claim_shared_hotel_request_internal(p_request_id,'reverse_completion',payload,p_occupancy_id); if replay is not null then return replay; end if;
  select * into o from public.hotel_physical_occupancies where id=p_occupancy_id for update;
  select * into s from public.hotel_stays where id=p_hotel_stay_id for update;
  select * into m from public.hotel_physical_occupancy_members where occupancy_id=p_occupancy_id and hotel_stay_id=p_hotel_stay_id and archived_at is null for update;
  if o.id is null or s.id is null or m.id is null or m.status<>'completed' or s.checked_out_at is null then raise exception '되돌릴 공유 객실 완료 기록을 확인할 수 없습니다.' using errcode='P0002'; end if;
  if o.version<>p_expected_occupancy_version or s.version<>p_expected_stay_version then raise exception '다른 사용자가 먼저 처리했습니다.' using errcode='PT409'; end if;
  perform pg_advisory_xact_lock(hashtextextended('hotel-capacity:all',0));
  perform pg_advisory_xact_lock(hashtextextended('hotel-capacity:'||o.room_type_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('hotel-room:'||o.room_id::text,0));
  perform set_config('app.operation_change_reason',btrim(p_reason),true);
  perform set_config('app.operation_request_id',p_request_id::text,true);
  if o.status='completed' then
    restore_until:=o.restore_occupied_until;
    if restore_until is null or restore_until<=o.occupied_from then raise exception '복원할 공유 객실 기간을 확인할 수 없습니다.' using errcode='P0002'; end if;
    perform public.assert_hotel_total_capacity_available(o.occupied_from,restore_until,1,o.capacity_reservation_id);
    perform public.assert_hotel_capacity_available(o.room_type_id,o.occupied_from,restore_until,1,o.capacity_reservation_id);
    -- Restore the capacity interval before validating the room interval, matching
    -- the existing reverse_hotel_completion contract. A later room conflict
    -- rolls this update back atomically with the caller transaction.
    update public.hotel_capacity_reservations
       set reserved_until=restore_until,updated_by=actor_id
     where id=o.capacity_reservation_id;
    perform public.assert_hotel_room_allocation_available(o.room_id,o.capacity_reservation_id,o.occupied_from,restore_until,o.room_allocation_id);
    update public.hotel_room_allocations set allocated_until=restore_until,updated_by=actor_id where id=o.room_allocation_id;
    update public.hotel_physical_occupancies set occupied_until=restore_until,restore_occupied_until=null,status='active',completed_at=null,updated_by=actor_id where id=o.id;
    update public.family_shared_room_groups set status='allocated',updated_by=actor_id where id=o.shared_room_group_id;
  else
    update public.hotel_physical_occupancies set updated_by=actor_id where id=o.id;
  end if;
  update public.hotel_stays set checked_out_at=null,checked_out_by=null,checkout_previous_reserved_until=null,
    checkout_previous_allocation_id=null,checkout_previous_allocation_until=null,updated_by=actor_id where id=s.id;
  perform set_config('app.operation_request_id','',true);
  update public.hotel_physical_occupancy_members set status='active',left_at=null,updated_by=actor_id where id=m.id;
  update public.family_booking_members set status=case when s.checked_in_at is null then 'confirmed' else 'checked_in' end,updated_by=actor_id
    where hotel_stay_id=s.id and family_booking_id=o.family_booking_id and archived_at is null;
  result:=jsonb_build_object('occupancy',public.shared_hotel_occupancy_json_internal(o.id),'stay',public.hotel_stay_json(s.id));
  return public.finish_shared_hotel_request_internal(p_request_id,o.id,result);
end;
$$;

create function public.move_shared_hotel_room_occupancy(
  p_occupancy_id uuid,p_new_room_id uuid,p_expected_occupancy_version integer,
  p_reason text,p_request_id uuid
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare actor_id uuid:=auth.uid(); replay jsonb; payload jsonb; o public.hotel_physical_occupancies%rowtype; nr public.hotel_rooms%rowtype; result jsonb; lock_room uuid;
begin
  if nullif(btrim(p_reason),'') is null then raise exception '객실 이동 사유가 필요합니다.' using errcode='22023'; end if;
  payload:=jsonb_build_object('expectedOccupancyVersion',p_expected_occupancy_version,'newRoomId',p_new_room_id,'occupancyId',p_occupancy_id,'reason',btrim(p_reason));
  replay:=public.claim_shared_hotel_request_internal(p_request_id,'move',payload,p_occupancy_id); if replay is not null then return replay; end if;
  select * into o from public.hotel_physical_occupancies where id=p_occupancy_id for update;
  if not found or o.status<>'active' or o.archived_at is not null then raise exception '활성 공유 객실을 확인할 수 없습니다.' using errcode='P0002'; end if;
  if o.version<>p_expected_occupancy_version then raise exception '다른 사용자가 먼저 변경했습니다.' using errcode='PT409'; end if;
  select * into nr from public.hotel_rooms where id=p_new_room_id and is_active and archived_at is null;
  if not found or nr.room_type_id<>o.room_type_id or not exists(select 1 from public.hotel_room_types rt where rt.id=nr.room_type_id and rt.is_active and rt.archived_at is null and upper(btrim(rt.code))='DELUXE' and upper(btrim(rt.name))='DELUXE') then
    raise exception '공유 객실 전체 이동은 DELUXE 호실 사이에서만 가능합니다.' using errcode='23514';
  end if;
  for lock_room in select x from unnest(array[o.room_id,p_new_room_id]) x order by x loop
    perform pg_advisory_xact_lock(hashtextextended('hotel-room:'||lock_room::text,0));
  end loop;
  perform public.assert_hotel_room_allocation_available(p_new_room_id,o.capacity_reservation_id,o.occupied_from,o.occupied_until,o.room_allocation_id);
  perform set_config('app.operation_change_reason',btrim(p_reason),true);
  update public.hotel_room_allocations set room_id=p_new_room_id,assignment_reason=btrim(p_reason),updated_by=actor_id where id=o.room_allocation_id;
  update public.hotel_physical_occupancies set room_id=p_new_room_id,updated_by=actor_id where id=o.id;
  result:=public.shared_hotel_occupancy_json_internal(o.id);
  return public.finish_shared_hotel_request_internal(p_request_id,o.id,result);
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['hotel_physical_occupancies','hotel_physical_occupancy_members'] loop
    execute format('create trigger %I_updated_at before update on public.%I for each row execute function public.set_updated_at()',t,t);
    execute format('create trigger %I_protect_metadata before update on public.%I for each row execute function public.protect_hotel_entity_metadata()',t,t);
    execute format('create trigger %I_no_delete before delete on public.%I for each row execute function public.prevent_hotel_physical_delete()',t,t);
    execute format('create trigger %I_audit after insert or update on public.%I for each row execute function public.record_hotel_operation_audit_event()',t,t);
  end loop;
end;
$$;

alter table public.hotel_physical_occupancies enable row level security;
alter table public.hotel_physical_occupancy_members enable row level security;
alter table public.hotel_physical_occupancy_requests enable row level security;

revoke all on table public.hotel_physical_occupancies from public,anon,authenticated,service_role;
revoke all on table public.hotel_physical_occupancy_members from public,anon,authenticated,service_role;
revoke all on table public.hotel_physical_occupancy_requests from public,anon,authenticated,service_role;
grant all on table public.hotel_physical_occupancies to service_role;
grant all on table public.hotel_physical_occupancy_members to service_role;
grant all on table public.hotel_physical_occupancy_requests to service_role;

do $$
declare f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in (
      'shared_hotel_payload_hash','claim_shared_hotel_request_internal','finish_shared_hotel_request_internal',
      'shared_hotel_occupancy_json_internal','assert_shared_hotel_occupancy_internal','assert_shared_hotel_member_internal',
      'enforce_shared_hotel_occupancy_deferred','enforce_shared_hotel_member_deferred','enforce_shared_capacity_deferred','enforce_shared_allocation_deferred'
    )
  loop execute format('revoke all on function %s from public,anon,authenticated,service_role',f); end loop;
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in (
      'get_shared_hotel_room_occupancy','get_hotel_shared_room_occupancies','create_shared_hotel_room_occupancy',
      'join_shared_hotel_room_occupancy','complete_shared_hotel_check_in','complete_shared_hotel_member_check_out',
      'reverse_shared_hotel_member_completion','move_shared_hotel_room_occupancy'
    )
  loop
    execute format('revoke all on function %s from public,anon',f);
    execute format('grant execute on function %s to authenticated,service_role',f);
  end loop;
end;
$$;

commit;
