-- CLEAN QA ONLY. Read-only preflight.
\set ON_ERROR_STOP on
begin read only;
select hotel_qa.assert_isolated_environment();

do $$
begin
  if to_regprocedure('public.start_long_stay_absence_v3(uuid,integer,timestamp with time zone,date,time without time zone,boolean,text,text,text,uuid)') is null
    or to_regprocedure('public.complete_long_stay_absence_v2(uuid,integer,timestamp with time zone,uuid,text,text,uuid)') is null
    or to_regprocedure('public.set_long_stay_absence_expected_return_v2(uuid,integer,date,time without time zone,boolean,text,uuid)') is null
    or to_regprocedure('public.assert_long_stay_runtime_invariant_internal(uuid)') is null then
    raise exception 'STOP_LONG_STAY_KEEP_TO_RELEASE_BASELINE_MISSING';
  end if;
  if to_regprocedure('public.release_long_stay_room_during_absence(uuid,integer,text,uuid)') is not null then
    raise exception 'STOP_LONG_STAY_KEEP_TO_RELEASE_ALREADY_PRESENT';
  end if;
  if exists (
    select 1 from public.long_stay_absence_events event
    where event.inventory_mode='release_room' and event.is_open and event.archived_at is null
      and (event.return_capacity_id is null or event.guarantee_from is null
        or event.inventory_transition_status<>'room_released')
  ) then
    raise exception 'STOP_LONG_STAY_KEEP_TO_RELEASE_BASELINE_RUNTIME_STATE';
  end if;
end;
$$;

select 'READY_TO_APPLY_LONG_STAY_KEEP_TO_RELEASE' status;
rollback;
