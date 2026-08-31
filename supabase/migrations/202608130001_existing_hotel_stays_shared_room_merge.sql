-- Merge independently-created Hotel Stays into one DELUXE physical occupancy.
-- Existing Stay, schedule, and finance identities are preserved.

begin;

do $$
begin
  if to_regclass('public.hotel_physical_occupancies') is null
    or to_regclass('public.hotel_physical_occupancy_members') is null
    or to_regclass('public.hotel_physical_occupancy_requests') is null
    or to_regprocedure('public.shared_hotel_occupancy_json_internal(uuid)') is null
    or to_regprocedure('public.claim_shared_hotel_request_internal(uuid,text,jsonb,uuid)') is null
    or to_regprocedure('public.merge_existing_hotel_stays_into_shared_room(uuid[],integer[],boolean,uuid)') is not null
  then
    raise exception 'STOP_EXISTING_STAY_SHARED_ROOM_MERGE_BASELINE';
  end if;
end;
$$;

alter table public.hotel_physical_occupancy_requests
  drop constraint hotel_physical_occupancy_requests_operation_kind_check;
alter table public.hotel_physical_occupancy_requests
  add constraint hotel_physical_occupancy_requests_operation_kind_check
  check (operation_kind in (
    'create','join','check_in','check_out','reverse_completion','move',
    'merge_existing_stays'
  ));

create function public.merge_existing_hotel_stays_into_shared_room(
  p_hotel_stay_ids uuid[],
  p_expected_versions integer[],
  p_shared_room_intent boolean,
  p_request_id uuid
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  payload jsonb;
  replay jsonb;
  primary_stay public.hotel_stays%rowtype;
  primary_customer_id uuid;
  primary_capacity public.hotel_capacity_reservations%rowtype;
  primary_allocation public.hotel_room_allocations%rowtype;
  room public.hotel_rooms%rowtype;
  room_type public.hotel_room_types%rowtype;
  candidate record;
  family_id uuid := gen_random_uuid();
  group_id uuid := gen_random_uuid();
  occupancy_id uuid := gen_random_uuid();
  leader_member_id uuid;
  result jsonb;
  wanted_count integer;
  unique_count integer;
begin
  if p_shared_room_intent is distinct from true then
    raise exception '같은 방 투숙을 명시적으로 선택해야 합니다.' using errcode='23514';
  end if;
  wanted_count := coalesce(cardinality(p_hotel_stay_ids),0);
  if wanted_count < 2 or wanted_count <> coalesce(cardinality(p_expected_versions),0) then
    raise exception '같은 방으로 결합할 예약과 version을 확인해 주세요.' using errcode='22023';
  end if;
  select count(distinct id) into unique_count from unnest(p_hotel_stay_ids) id;
  if unique_count <> wanted_count or p_request_id is null then
    raise exception '중복되지 않은 예약과 request_id가 필요합니다.' using errcode='22023';
  end if;

  payload := jsonb_build_object(
    'expectedVersions',to_jsonb(p_expected_versions),
    'hotelStayIds',to_jsonb(p_hotel_stay_ids),
    'sharedRoomIntent',true
  );
  replay := public.claim_shared_hotel_request_internal(
    p_request_id,'merge_existing_stays',payload,null
  );
  if replay is not null then return replay; end if;

  -- Match the existing Hotel lock order: aggregate, type, room, then Stay IDs.
  perform pg_advisory_xact_lock(hashtextextended('hotel-capacity:all',0));
  select s.* into primary_stay
  from public.hotel_stays s where s.id=p_hotel_stay_ids[1];
  if not found then raise exception '기준 호텔 예약을 찾을 수 없습니다.' using errcode='P0002'; end if;
  select dog.customer_id into primary_customer_id
  from public.dogs dog where dog.id=primary_stay.dog_id;
  if primary_customer_id is null then
    raise exception '기준 예약의 보호자를 찾을 수 없습니다.' using errcode='P0002';
  end if;
  select c.* into primary_capacity
  from public.hotel_capacity_reservations c
  where c.hotel_stay_id=primary_stay.id and c.source_kind='stay' and c.archived_at is null;
  select a.* into primary_allocation
  from public.hotel_room_allocations a
  where a.capacity_reservation_id=primary_capacity.id and a.archived_at is null;
  if primary_capacity.id is null or primary_allocation.id is null then
    raise exception '기준 예약은 먼저 DELUXE 호실에 배정되어야 합니다.' using errcode='23514';
  end if;
  if primary_allocation.allocated_from<>primary_capacity.reserved_from
    or primary_allocation.allocated_until<>primary_capacity.reserved_until then
    raise exception '전체 예약 기간에 배정된 DELUXE 예약만 기준 예약으로 사용할 수 있습니다.' using errcode='23514';
  end if;
  select * into room from public.hotel_rooms
  where id=primary_allocation.room_id and is_active and archived_at is null;
  select * into room_type from public.hotel_room_types
  where id=primary_capacity.room_type_id and is_active and archived_at is null;
  if room.id is null or room.room_type_id<>room_type.id
    or upper(btrim(room_type.code))<>'DELUXE'
    or upper(btrim(room_type.name))<>'DELUXE' then
    raise exception '같은 방 투숙은 DELUXE에서만 가능합니다.' using errcode='23514';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('hotel-capacity:'||room_type.id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('hotel-room:'||room.id::text,0));
  perform 1 from public.hotel_stays s
    where s.id=any(p_hotel_stay_ids) order by s.id for update;

  for candidate in
    select s.*, dog.customer_id, input.ordinality, input.expected_version,
      c.id capacity_id, c.room_type_id capacity_room_type_id,
      c.reserved_from, c.reserved_until, c.quantity,
      a.id allocation_id, a.room_id allocation_room_id
    from unnest(p_hotel_stay_ids,p_expected_versions) with ordinality
      input(stay_id,expected_version,ordinality)
    join public.hotel_stays s on s.id=input.stay_id
    left join public.dogs dog on dog.id=s.dog_id
    left join public.hotel_capacity_reservations c
      on c.hotel_stay_id=s.id and c.source_kind='stay' and c.archived_at is null
    left join public.hotel_room_allocations a
      on a.capacity_reservation_id=c.id and a.archived_at is null
    order by s.id
  loop
    if candidate.archived_at is not null or candidate.checked_out_at is not null
      or candidate.version<>candidate.expected_version then
      raise exception '예약이 변경되었거나 결합할 수 없는 상태입니다.' using errcode='PT409';
    end if;
    if candidate.customer_id is null or candidate.customer_id<>primary_customer_id then
      raise exception '같은 보호자의 예약만 같은 방으로 결합할 수 있습니다.' using errcode='23514';
    end if;
    if candidate.capacity_id is null or candidate.quantity<>1
      or candidate.capacity_room_type_id<>room_type.id
      or candidate.reserved_from<>primary_capacity.reserved_from
      or candidate.reserved_until<>primary_capacity.reserved_until then
      raise exception '같은 방 투숙은 입·퇴실 기간이 동일한 DELUXE 예약끼리만 가능합니다.' using errcode='23514';
    end if;
    if candidate.ordinality>1 and candidate.allocation_id is not null
      and candidate.allocation_room_id<>room.id then
      raise exception '다른 호실에 배정된 예약은 먼저 배정을 해제해 주세요.' using errcode='23514';
    end if;
    if exists(select 1 from public.hotel_physical_occupancy_members m
      where m.hotel_stay_id=candidate.id and m.archived_at is null) then
      raise exception '이미 다른 공유 객실에 포함된 예약입니다.' using errcode='23514';
    end if;
    if exists(select 1 from public.family_booking_members fm
      where fm.hotel_stay_id=candidate.id and fm.archived_at is null) then
      raise exception '기존 Family Booking 예약은 해당 Family Booking에서 배정해 주세요.' using errcode='23514';
    end if;
  end loop;
  if (select count(*) from public.hotel_stays where id=any(p_hotel_stay_ids))<>wanted_count then
    raise exception '결합할 호텔 예약을 모두 찾을 수 없습니다.' using errcode='P0002';
  end if;
  if (select count(distinct dog_id) from public.hotel_stays where id=any(p_hotel_stay_ids))<>wanted_count then
    raise exception '같은 반려견 예약을 중복 결합할 수 없습니다.' using errcode='23514';
  end if;

  perform set_config('app.operation_change_reason','기존 호텔 예약 같은 방 결합',true);
  insert into public.family_bookings(
    id,customer_id,status,common_memo,payment_bundle_requested,
    canonical_payload,canonical_payload_hash,request_id,created_by,updated_by
  ) values (
    family_id,primary_customer_id,'active','기존 호텔 예약 Shared Room 결합',false,
    payload,encode(extensions.digest(payload::text,'sha256'),'hex'),p_request_id,actor_id,actor_id
  );

  insert into public.family_booking_members(
    family_booking_id,stable_member_key,dog_id,service_type,status,hotel_stay_id,
    created_by,updated_by
  )
  select family_id,'existing-stay-'||s.id::text,s.dog_id,'hotel',
    case when s.checked_in_at is null then 'confirmed' else 'checked_in' end,s.id,actor_id,actor_id
  from public.hotel_stays s where s.id=any(p_hotel_stay_ids) order by s.id;
  select id into leader_member_id from public.family_booking_members
    where family_booking_id=family_id and hotel_stay_id=primary_stay.id;
  insert into public.family_shared_room_groups(
    id,family_booking_id,stable_group_key,leader_member_id,room_type_id,
    normalized_starts_at,normalized_ends_at,requested_capacity,status,created_by,updated_by
  ) values (
    group_id,family_id,'existing-stays-'||p_request_id::text,leader_member_id,room_type.id,
    primary_capacity.reserved_from,primary_capacity.reserved_until,wanted_count,'allocated',actor_id,actor_id
  );
  update public.family_booking_members set shared_room_group_id=group_id,updated_by=actor_id
    where family_booking_id=family_id;

  insert into public.hotel_physical_occupancies(
    id,family_booking_id,shared_room_group_id,customer_id,room_type_id,room_id,
    occupied_from,occupied_until,capacity_reservation_id,room_allocation_id,status,
    request_id,canonical_payload_hash,created_by,updated_by
  ) values (
    occupancy_id,family_id,group_id,primary_customer_id,room_type.id,room.id,
    primary_capacity.reserved_from,primary_capacity.reserved_until,
    primary_capacity.id,primary_allocation.id,'active',p_request_id,
    public.shared_hotel_payload_hash(payload),actor_id,actor_id
  );

  -- Reuse the primary capacity/allocation and release every joining aggregate.
  update public.hotel_capacity_reservations set
    source_kind='shared_occupancy',hotel_stay_id=null,physical_occupancy_id=occupancy_id,
    updated_by=actor_id
  where id=primary_capacity.id;
  update public.hotel_room_allocations set archived_at=now(),archived_by=actor_id,
    archive_reason='기존 호텔 예약 Shared Room 결합',updated_by=actor_id
  where id<>primary_allocation.id and archived_at is null
    and capacity_reservation_id in (
      select c.id from public.hotel_capacity_reservations c
      where c.hotel_stay_id=any(p_hotel_stay_ids[2:wanted_count]) and c.archived_at is null
    );
  update public.hotel_capacity_reservations set archived_at=now(),archived_by=actor_id,
    archive_reason='Physical Occupancy로 통합',updated_by=actor_id
  where hotel_stay_id=any(p_hotel_stay_ids[2:wanted_count]) and archived_at is null;

  insert into public.hotel_physical_occupancy_members(
    occupancy_id,family_booking_member_id,hotel_stay_id,dog_id,status,created_by,updated_by
  )
  select occupancy_id,fm.id,fm.hotel_stay_id,fm.dog_id,'active',actor_id,actor_id
  from public.family_booking_members fm where fm.family_booking_id=family_id order by fm.id;

  insert into public.entity_audit_events(
    module_code,entity_type,entity_id,action,after_data,changed_by,change_reason,request_id
  ) values (
    'hotel_operations','hotel_physical_occupancies',occupancy_id,'created',
    public.shared_hotel_occupancy_json_internal(occupancy_id),actor_id,
    '기존 호텔 예약 같은 방 결합',p_request_id
  );
  result:=public.shared_hotel_occupancy_json_internal(occupancy_id);
  return public.finish_shared_hotel_request_internal(p_request_id,occupancy_id,result);
end;
$$;

revoke all on function public.merge_existing_hotel_stays_into_shared_room(uuid[],integer[],boolean,uuid) from public;
grant execute on function public.merge_existing_hotel_stays_into_shared_room(uuid[],integer[],boolean,uuid)
  to authenticated,service_role,postgres;

commit;
