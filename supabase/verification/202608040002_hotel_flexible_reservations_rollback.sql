-- Full rollback for Hotel flexible reservation extension.
-- It is intentionally blocked while any Capacity row has an unspecified type.

begin;

select
  count(*) as existing_hotel_time_unspecified_schedule_count,
  'INFO_ONLY_NOT_A_ROLLBACK_BLOCKER'::text as rollback_note
from public.hotel_stay_schedule_events event
join public.hotel_stays stay on stay.id = event.hotel_stay_id
join public.operation_schedules schedule
  on schedule.id = event.operation_schedule_id
where event.archived_at is null
  and stay.archived_at is null
  and schedule.archived_at is null
  and schedule.time_unspecified;

do $$
declare
  unspecified_count bigint;
begin
  select count(*)
  into unspecified_count
  from public.hotel_capacity_reservations capacity
  where capacity.room_type_id is null;

  if unspecified_count > 0 then
    raise exception
      '객실 유형 미정 Capacity %건이 있어 완전 Rollback할 수 없습니다.',
      unspecified_count
      using errcode = 'P0001',
        detail = '해당 예약을 정상 취소하거나 객실 유형을 확정한 뒤 다시 실행해 주세요.';
  end if;

end;
$$;

drop function if exists public.get_hotel_operations_snapshot_v2(date);
drop function if exists public.finalize_and_complete_hotel_check_out(
  uuid, integer, timestamptz, uuid
);
drop function if exists public.finalize_and_complete_hotel_check_in(
  uuid, integer, timestamptz, uuid, uuid, uuid
);
drop function if exists public.update_flexible_hotel_reservation(
  uuid, integer, uuid, uuid, date, time, boolean, date, time,
  boolean, uuid, uuid, uuid, uuid[], text, uuid
);
drop function if exists public.create_flexible_hotel_reservation(
  uuid, uuid, date, time, boolean, date, time, boolean,
  uuid, uuid, uuid, uuid[], text, uuid
);

drop trigger if exists hotel_capacity_reservations_total_capacity_guard
  on public.hotel_capacity_reservations;
drop trigger if exists hotel_room_allocations_room_type_guard
  on public.hotel_room_allocations;
drop function if exists public.enforce_hotel_allocation_room_type();
drop function if exists public.enforce_hotel_total_capacity();
drop function if exists public.assert_hotel_total_capacity_available(
  timestamptz, timestamptz, integer, uuid
);

drop index if exists
  public.hotel_capacity_reservations_unspecified_overlap_idx;

alter table public.hotel_capacity_reservations
  drop constraint if exists
    hotel_capacity_reservations_room_type_state_check;

alter table public.hotel_capacity_reservations
  alter column room_type_id set not null;

commit;
