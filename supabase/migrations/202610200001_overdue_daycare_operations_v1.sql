begin;

-- Read-only recovery visibility. No allocation, capacity or lifecycle mutations.
create function public.get_overdue_daycare_operations_v1()
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_active_operation_member() then
    raise exception using errcode = '42501', message = '호텔 운영 조회 권한이 없습니다.';
  end if;
  return (
    select coalesce(jsonb_agg(public.daycare_reservation_json(state.operation_schedule_id)
      order by state.checked_in_at, state.operation_schedule_id), '[]'::jsonb)
    from public.daycare_operation_states state
    join public.operation_schedules schedule on schedule.id = state.operation_schedule_id
    where schedule.archived_at is null
      and state.lifecycle_status = 'checked_in'
      and state.checked_in_at is not null
      and state.checked_out_at is null
      and (schedule.starts_at at time zone 'Asia/Seoul')::date
        < (statement_timestamp() at time zone 'Asia/Seoul')::date
  );
end;
$$;
revoke all on function public.get_overdue_daycare_operations_v1() from public, anon, service_role;
grant execute on function public.get_overdue_daycare_operations_v1() to authenticated;

commit;
