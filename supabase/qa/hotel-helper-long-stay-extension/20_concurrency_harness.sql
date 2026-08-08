-- ISOLATED CLEAN QA ONLY. Committed fixtures for actual two-session Extension QA.
begin;

select hotel_qa.assert_isolated_environment();

create or replace function hotel_qa.seed_long_stay_extension_concurrency_fixture(
  p_run_id uuid,
  p_fixture_key text,
  p_check_in_date date,
  p_runtime_until timestamptz,
  p_room_type_id uuid,
  p_initial_room_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = hotel_qa, public, pg_temp
as $$
declare
  qa_run hotel_qa.runs%rowtype;
  runtime_input jsonb;
  stay_json jsonb;
  stay_id uuid;
  root_request_id uuid := gen_random_uuid();
begin
  perform hotel_qa.assert_isolated_environment();
  select * into strict qa_run from hotel_qa.runs where id = p_run_id;

  perform set_config('request.jwt.claim.sub', qa_run.actor_profile_id::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', qa_run.actor_profile_id, 'role', 'authenticated')::text,
    true
  );

  runtime_input := public.prepare_hotel_reservation_runtime_input_extended_internal(
    qa_run.calendar_id,
    qa_run.schedule_type_id,
    p_check_in_date,
    time '15:00',
    false,
    null,
    null,
    null,
    false,
    p_runtime_until,
    p_room_type_id,
    qa_run.dog_id,
    qa_run.customer_id,
    array[qa_run.actor_profile_id],
    'Long Stay Extension concurrency fixture ' || p_fixture_key
  );

  stay_json := public.create_hotel_reservation_runtime_extended_internal(
    qa_run.calendar_id,
    qa_run.schedule_type_id,
    qa_run.dog_id,
    p_room_type_id,
    array[qa_run.actor_profile_id],
    'Long Stay Extension concurrency fixture ' || p_fixture_key,
    qa_run.actor_profile_id,
    root_request_id,
    gen_random_uuid(),
    null,
    runtime_input,
    false
  );
  stay_id := (stay_json ->> 'id')::uuid;

  if p_initial_room_id is not null then
    perform public.assign_hotel_room(
      stay_id,
      (stay_json ->> 'version')::integer,
      p_initial_room_id,
      'Long Stay Extension concurrency initial assignment',
      gen_random_uuid()
    );
  end if;

  insert into hotel_qa.fixtures (
    run_id, fixture_key, hotel_stay_id, room_type_id, room_id, request_id, metadata
  ) values (
    p_run_id, p_fixture_key, stay_id, p_room_type_id, p_initial_room_id,
    root_request_id,
    p_metadata || jsonb_build_object(
      'checkInDate', p_check_in_date,
      'runtimeUntil', p_runtime_until,
      'requiredEventKinds', jsonb_build_array('check_in')
    )
  );
  return stay_id;
end;
$$;

do $$
declare
  qa_run hotel_qa.runs%rowtype;
  standard_type public.hotel_room_types%rowtype;
  deluxe_type public.hotel_room_types%rowtype;
  standard_rooms uuid[];
  deluxe_rooms uuid[];
  fixture_date date;
  blocker_index integer;
begin
  perform hotel_qa.assert_isolated_environment();
  select * into qa_run
  from hotel_qa.runs run
  where run.status = 'ready'
  order by run.created_at desc limit 1
  for update;
  if not found then raise exception 'STOP_NO_READY_HOTEL_QA_RUN'; end if;

  if to_regprocedure('public.change_hotel_room_type_and_allocation_extended_internal(text,uuid,integer,uuid,uuid,text,text,timestamp with time zone,text,text,uuid,uuid,text[])') is null then
    raise exception 'STOP_LONG_STAY_EXTENSION_HELPER_MISSING';
  end if;

  select * into strict standard_type from public.hotel_room_types
  where code = 'STANDARD' and is_active and archived_at is null;
  select * into strict deluxe_type from public.hotel_room_types
  where code = 'DELUXE' and is_active and archived_at is null;
  select array_agg(id order by sort_order, id) into standard_rooms
  from public.hotel_rooms
  where room_type_id = standard_type.id and is_active and archived_at is null;
  select array_agg(id order by sort_order, id) into deluxe_rooms
  from public.hotel_rooms
  where room_type_id = deluxe_type.id and is_active and archived_at is null;
  if cardinality(standard_rooms) < 2 or cardinality(deluxe_rooms) < 2 then
    raise exception 'STOP_LONG_STAY_EXTENSION_CONCURRENCY_ROOMS_MISSING';
  end if;

  -- Check-in-only cross-type vs the same target Room.
  fixture_date := qa_run.base_date + 60;
  perform hotel_qa.seed_long_stay_extension_concurrency_fixture(
    qa_run.id, 'ext_room_a', fixture_date,
    ((fixture_date + 1)::timestamp + time '11:00') at time zone 'Asia/Seoul',
    standard_type.id, standard_rooms[1],
    jsonb_build_object('targetRoomIdA', deluxe_rooms[1], 'targetRoomIdB', deluxe_rooms[1])
  );
  perform hotel_qa.seed_long_stay_extension_concurrency_fixture(
    qa_run.id, 'ext_room_b', fixture_date,
    ((fixture_date + 1)::timestamp + time '11:00') at time zone 'Asia/Seoul',
    standard_type.id, standard_rooms[2],
    jsonb_build_object('targetRoomIdA', deluxe_rooms[1], 'targetRoomIdB', deluxe_rooms[1])
  );

  -- Check-in-only last DELUXE capacity: five blockers plus two candidates.
  fixture_date := qa_run.base_date + 64;
  for blocker_index in 1..5 loop
    perform hotel_qa.seed_long_stay_extension_concurrency_fixture(
      qa_run.id, format('ext_capacity_blocker_%s', blocker_index), fixture_date,
      ((fixture_date + 1)::timestamp + time '11:00') at time zone 'Asia/Seoul',
      deluxe_type.id, null
    );
  end loop;
  perform hotel_qa.seed_long_stay_extension_concurrency_fixture(
    qa_run.id, 'ext_capacity_a', fixture_date,
    ((fixture_date + 1)::timestamp + time '11:00') at time zone 'Asia/Seoul',
    standard_type.id, standard_rooms[1], jsonb_build_object('targetRoomIdA', deluxe_rooms[1])
  );
  perform hotel_qa.seed_long_stay_extension_concurrency_fixture(
    qa_run.id, 'ext_capacity_b', fixture_date,
    ((fixture_date + 1)::timestamp + time '11:00') at time zone 'Asia/Seoul',
    standard_type.id, standard_rooms[2], jsonb_build_object('targetRoomIdB', deluxe_rooms[2])
  );

  -- Same Stay/version race with two different target Rooms.
  fixture_date := qa_run.base_date + 68;
  perform hotel_qa.seed_long_stay_extension_concurrency_fixture(
    qa_run.id, 'ext_version', fixture_date,
    ((fixture_date + 1)::timestamp + time '11:00') at time zone 'Asia/Seoul',
    standard_type.id, standard_rooms[1],
    jsonb_build_object('targetRoomIdA', deluxe_rooms[1], 'targetRoomIdB', deluxe_rooms[2])
  );
end;
$$;

create or replace function hotel_qa.arm_long_stay_extension_scenario(
  p_scenario_code text,
  p_delay_seconds integer default 12
)
returns timestamptz
language plpgsql
security invoker
set search_path = hotel_qa, public, pg_temp
as $$
declare
  qa_run_id uuid;
  armed_at timestamptz;
begin
  perform hotel_qa.assert_isolated_environment();
  if p_scenario_code not in (
    'extension_room_competition',
    'extension_type_capacity_competition',
    'extension_version_competition',
    'ordinary_type_capacity_regression'
  ) then
    raise exception 'unsupported Extension concurrency scenario' using errcode = '22023';
  end if;
  select id into qa_run_id from hotel_qa.runs
  where status in ('ready','running') order by created_at desc limit 1;
  if qa_run_id is null then raise exception 'STOP_NO_READY_HOTEL_QA_RUN'; end if;
  delete from hotel_qa.session_results
  where run_id = qa_run_id and scenario_code = p_scenario_code;
  armed_at := clock_timestamp() + make_interval(secs => greatest(p_delay_seconds, 5));
  insert into hotel_qa.scenario_controls(run_id, scenario_code, start_at, status)
  values (qa_run_id, p_scenario_code, armed_at, 'armed')
  on conflict (run_id,scenario_code) do update
  set start_at=excluded.start_at,status='armed',created_at=clock_timestamp();
  update hotel_qa.runs set status='running' where id=qa_run_id;
  return armed_at;
end;
$$;

create or replace function hotel_qa.execute_long_stay_extension_concurrency_session(
  p_scenario_code text,
  p_session_code text
)
returns jsonb
language plpgsql
security invoker
set search_path = hotel_qa, public, pg_temp
as $$
declare
  qa_run hotel_qa.runs%rowtype;
  fixture hotel_qa.fixtures%rowtype;
  control hotel_qa.scenario_controls%rowtype;
  target_type public.hotel_room_types%rowtype;
  target_room public.hotel_rooms%rowtype;
  result_json jsonb;
  expected_version integer;
  started_at timestamptz;
  finished_at timestamptz;
  succeeded boolean := false;
  caught_state text;
  caught_message text;
  selected_fixture_key text;
  check_in_date date;
begin
  perform hotel_qa.assert_isolated_environment();
  if p_session_code not in ('A','B') then raise exception 'invalid session' using errcode='22023'; end if;
  select * into qa_run from hotel_qa.runs
  where status='running' order by created_at desc limit 1;
  if not found then raise exception 'STOP_NO_RUNNING_HOTEL_QA_RUN'; end if;
  select * into control from hotel_qa.scenario_controls
  where run_id=qa_run.id and scenario_code=p_scenario_code and status='armed';
  if not found then raise exception 'STOP_SCENARIO_NOT_ARMED'; end if;

  selected_fixture_key := case p_scenario_code
    when 'extension_room_competition' then 'ext_room_' || lower(p_session_code)
    when 'extension_type_capacity_competition' then 'ext_capacity_' || lower(p_session_code)
    when 'extension_version_competition' then 'ext_version'
    when 'ordinary_type_capacity_regression' then 'race_type_candidate_' || lower(p_session_code)
    else null end;
  if selected_fixture_key is null then raise exception 'unsupported scenario' using errcode='22023'; end if;
  select * into fixture from hotel_qa.fixtures
  where run_id=qa_run.id and hotel_qa.fixtures.fixture_key=selected_fixture_key;
  if not found then raise exception 'STOP_EXTENSION_CONCURRENCY_FIXTURE_MISSING'; end if;

  perform set_config('request.jwt.claim.sub',qa_run.actor_profile_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',qa_run.actor_profile_id,'role','authenticated')::text,true);
  perform set_config('lock_timeout','12s',true);
  perform set_config('statement_timeout','30s',true);
  expected_version := (public.hotel_stay_json(fixture.hotel_stay_id)->>'version')::integer;
  check_in_date := (fixture.metadata->>'checkInDate')::date;

  if p_scenario_code <> 'ordinary_type_capacity_regression' then
    select * into strict target_type from public.hotel_room_types
    where code='DELUXE' and is_active and archived_at is null;
    select * into strict target_room from public.hotel_rooms
    where id = (fixture.metadata->>('targetRoomId'||p_session_code))::uuid;
  end if;

  perform pg_sleep(greatest(extract(epoch from control.start_at-clock_timestamp()),0));
  started_at := clock_timestamp();
  begin
    if p_scenario_code = 'ordinary_type_capacity_regression' then
      select * into strict target_type from public.hotel_room_types
      where code='STANDARD' and is_active and archived_at is null;
      result_json := public.update_flexible_hotel_reservation(
        fixture.hotel_stay_id, expected_version, qa_run.calendar_id, qa_run.schedule_type_id,
        check_in_date, time '15:00', false, check_in_date+1, time '11:00', false,
        target_type.id, qa_run.dog_id, qa_run.customer_id,
        array[qa_run.actor_profile_id], 'ordinary Hotel capacity regression', gen_random_uuid()
      );
    else
      result_json := public.change_hotel_room_type_and_allocation_extended_internal(
        'before_check_in', fixture.hotel_stay_id, expected_version,
        target_room.id, target_type.id, target_type.code, target_room.name,
        null, 'Long Stay Extension two-session QA',
        'Long Stay Extension two-session QA', qa_run.actor_profile_id,
        gen_random_uuid(), array['check_in']::text[]
      );
    end if;
    succeeded := true;
  exception when others then
    get stacked diagnostics caught_state=returned_sqlstate,caught_message=message_text;
  end;
  finished_at := clock_timestamp();
  insert into hotel_qa.session_results(
    run_id,scenario_code,session_code,started_at,finished_at,succeeded,sqlstate,message,result
  ) values (
    qa_run.id,p_scenario_code,p_session_code,started_at,finished_at,succeeded,caught_state,caught_message,result_json
  ) on conflict(run_id,scenario_code,session_code) do update
  set started_at=excluded.started_at,finished_at=excluded.finished_at,
      succeeded=excluded.succeeded,sqlstate=excluded.sqlstate,
      message=excluded.message,result=excluded.result;
  if (select count(*)=2 from hotel_qa.session_results
      where run_id=qa_run.id and scenario_code=p_scenario_code) then
    update hotel_qa.scenario_controls set status='completed'
    where run_id=qa_run.id and scenario_code=p_scenario_code;
  end if;
  return jsonb_build_object('scenario',p_scenario_code,'session',p_session_code,
    'succeeded',succeeded,'sqlstate',caught_state,'message',caught_message,'result',result_json);
end;
$$;

revoke all on function hotel_qa.seed_long_stay_extension_concurrency_fixture(uuid,text,date,timestamptz,uuid,uuid,jsonb) from public,anon,authenticated;
revoke all on function hotel_qa.arm_long_stay_extension_scenario(text,integer) from public,anon,authenticated;
revoke all on function hotel_qa.execute_long_stay_extension_concurrency_session(text,text) from public,anon,authenticated;

commit;

select 'HOTEL_INTERNAL_HELPER_LONG_STAY_EXTENSION_2SESSION_HARNESS_READY' as harness_status;
