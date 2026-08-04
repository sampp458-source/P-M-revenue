-- Hotel flexible reservation extension: authenticated Snapshot v2 runtime QA
-- Run separately after HOTEL_FLEXIBLE_DDL_CONTRACT_READY.

begin;

do $$
declare
  actor_id uuid;
begin
  select membership.profile_id
  into actor_id
  from public.operation_memberships membership
  join public.profiles profile on profile.id = membership.profile_id
  where membership.role in ('owner', 'manager')
    and membership.is_active
    and profile.is_active
    and profile.account_status = 'active'
  order by
    case membership.role when 'owner' then 0 else 1 end,
    membership.updated_at,
    membership.profile_id
  limit 1;

  if actor_id is null then
    raise exception '활성 Operations owner 또는 manager가 없습니다.'
      using errcode = 'P0001';
  end if;

  perform set_config('request.jwt.claim.sub', actor_id::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', actor_id::text,
      'role', 'authenticated'
    )::text,
    true
  );

  if auth.uid() is distinct from actor_id then
    raise exception 'Snapshot Runtime QA 사용자 컨텍스트 설정에 실패했습니다.'
      using
        errcode = 'P0001',
        detail = format(
          'expected_actor_id=%s; actual_auth_uid=%s',
          actor_id,
          auth.uid()
        );
  end if;
end;
$$;

with runtime_context as (
  select
    auth.uid() as actor_profile_id,
    (now() at time zone 'Asia/Seoul')::date as target_date
), snapshot_result as materialized (
  select
    runtime_context.actor_profile_id,
    runtime_context.target_date,
    public.get_hotel_operations_snapshot_v2(
      runtime_context.target_date
    ) as payload
  from runtime_context
), checks as (
  select
    actor_profile_id is not null as authenticated_actor_ready,
    payload is not null as snapshot_returned,
    payload ? 'roomTypes' as room_types_ready,
    payload ? 'rooms' as rooms_ready,
    payload ? 'settings' as settings_ready,
    payload ? 'stays' as stays_ready,
    payload ? 'unassignedFuture' as unassigned_future_ready,
    payload ? 'roomTypeUnspecified' as room_type_unspecified_ready,
    payload ? 'totalCapacity' as total_capacity_ready,
    payload ? 'confirmedRemainingByType'
      as confirmed_remaining_by_type_ready,
    payload ? 'unassignedRoomTypeCount'
      as unassigned_room_type_count_ready,
    payload ? 'overallSafeRemaining' as overall_safe_remaining_ready,
    payload ? 'individualTypeAvailabilityWarning'
      as individual_type_availability_warning_ready,
    not exists (
      select 1
      from jsonb_array_elements(payload -> 'roomTypes') room_type(item)
      where not (item ? 'confirmedReservedPeak')
        or not (item ? 'confirmedReservationCount')
        or not (item ? 'confirmedRemaining')
        or not (item ? 'conservativeRemaining')
        or not (item ? 'affectedByUnspecifiedCount')
    ) as room_type_item_contract_ready,
    payload -> 'roomTypeUnspecified' ? 'reservedPeak'
      and payload -> 'roomTypeUnspecified' ? 'reservationCount'
      as unspecified_summary_contract_ready,
    payload -> 'totalCapacity' ? 'totalReservationCount'
      and payload -> 'totalCapacity' ? 'confirmedReservedPeak'
      and payload -> 'totalCapacity' ? 'unspecifiedReservedPeak'
      and payload -> 'totalCapacity' ? 'totalReservedPeak'
      and payload -> 'totalCapacity' ? 'safeRemaining'
      and payload -> 'totalCapacity'
        ? 'individualTypeAvailabilityWarning'
      as total_capacity_contract_ready
  from snapshot_result
)
select
  case
    when not authenticated_actor_ready
      then 'FAILED_AUTHENTICATED_ACTOR_CONTEXT'
    when not snapshot_returned
      then 'FAILED_SNAPSHOT_V2_RUNTIME_RESPONSE'
    when not room_types_ready
      or not rooms_ready
      or not settings_ready
      or not stays_ready
      or not unassigned_future_ready
      or not room_type_unspecified_ready
      or not total_capacity_ready
      or not confirmed_remaining_by_type_ready
      or not unassigned_room_type_count_ready
      or not overall_safe_remaining_ready
      or not individual_type_availability_warning_ready
      or not room_type_item_contract_ready
      or not unspecified_summary_contract_ready
      or not total_capacity_contract_ready
      then 'FAILED_SNAPSHOT_V2_RUNTIME_CONTRACT'
    else 'HOTEL_FLEXIBLE_SNAPSHOT_RUNTIME_READY'
  end as runtime_qa_status,
  checks.*
from checks;

rollback;
