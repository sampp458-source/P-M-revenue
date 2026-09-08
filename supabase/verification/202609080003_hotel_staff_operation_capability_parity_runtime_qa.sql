-- ISOLATED / ROLLBACK-ONLY QA. Never run against Production.
begin;

select hotel_qa.assert_isolated_environment();

create temporary table hotel_staff_capability_qa_calls (
  signature text primary key,
  call_sql text not null
) on commit drop;

insert into hotel_staff_capability_qa_calls(signature, call_sql) values
  ('public.change_room_type_before_check_in(uuid,integer,uuid,text,uuid)',
   'select public.change_room_type_before_check_in(null::uuid,null::integer,null::uuid,null::text,null::uuid)'),
  ('public.change_room_type_after_check_in(uuid,integer,uuid,timestamp with time zone,text,uuid)',
   'select public.change_room_type_after_check_in(null::uuid,null::integer,null::uuid,null::timestamptz,null::text,null::uuid)'),
  ('public.reverse_hotel_completion(uuid,integer,text,text,uuid)',
   'select public.reverse_hotel_completion(null::uuid,null::integer,null::text,null::text,null::uuid)'),
  ('public.reverse_check_in_and_unassign_hotel_room(uuid,integer,text,uuid)',
   'select public.reverse_check_in_and_unassign_hotel_room(null::uuid,null::integer,null::text,null::uuid)'),
  ('public.reverse_shared_hotel_member_completion(uuid,uuid,integer,integer,text,uuid)',
   'select public.reverse_shared_hotel_member_completion(null::uuid,null::uuid,null::integer,null::integer,null::text,null::uuid)'),
  ('public.reverse_shared_hotel_member_check_in(uuid,uuid,integer,integer,text,uuid)',
   'select public.reverse_shared_hotel_member_check_in(null::uuid,null::uuid,null::integer,null::integer,null::text,null::uuid)'),
  ('public.reverse_check_in_and_unassign_shared_hotel_room(uuid,integer,text,uuid)',
   'select public.reverse_check_in_and_unassign_shared_hotel_room(null::uuid,null::integer,null::text,null::uuid)'),
  ('public.create_long_stay_contract(uuid,uuid,date,date,uuid,uuid,numeric,integer,text,uuid)',
   'select public.create_long_stay_contract(null::uuid,null::uuid,null::date,null::date,null::uuid,null::uuid,null::numeric,null::integer,null::text,null::uuid)'),
  ('public.confirm_long_stay_month(uuid,integer,date,uuid,uuid,time without time zone,boolean,uuid,uuid,uuid[],text,uuid)',
   'select public.confirm_long_stay_month(null::uuid,null::integer,null::date,null::uuid,null::uuid,null::time,null::boolean,null::uuid,null::uuid,null::uuid[],null::text,null::uuid)'),
  ('public.confirm_long_stay_month_v2(uuid,integer,date,date,uuid,uuid,time without time zone,boolean,uuid,uuid,uuid[],text,uuid)',
   'select public.confirm_long_stay_month_v2(null::uuid,null::integer,null::date,null::date,null::uuid,null::uuid,null::time,null::boolean,null::uuid,null::uuid,null::uuid[],null::text,null::uuid)'),
  ('public.set_long_stay_planned_checkout(uuid,integer,date,uuid,uuid,time without time zone,boolean,uuid[],text,uuid)',
   'select public.set_long_stay_planned_checkout(null::uuid,null::integer,null::date,null::uuid,null::uuid,null::time,null::boolean,null::uuid[],null::text,null::uuid)'),
  ('public.reverse_long_stay_completion(uuid,integer,integer,text,uuid)',
   'select public.reverse_long_stay_completion(null::uuid,null::integer,null::integer,null::text,null::uuid)'),
  ('public.cancel_hotel_reservation(uuid,integer,text,uuid)',
   'select public.cancel_hotel_reservation(null::uuid,null::integer,null::text,null::uuid)'),
  ('public.cancel_shared_hotel_room_family_booking(uuid,integer,text,uuid)',
   'select public.cancel_shared_hotel_room_family_booking(null::uuid,null::integer,null::text,null::uuid)');

create temporary table hotel_staff_capability_qa_results (
  persona text not null,
  signature text not null,
  expected_authorized boolean not null,
  observed_authorized boolean not null,
  sqlstate text,
  primary key (persona, signature)
) on commit drop;

create function pg_temp.hotel_staff_assert_allowlist(
  p_persona text,
  p_expected_authorized boolean
) returns void
language plpgsql
as $$
declare
  target record;
  observed boolean;
  observed_state text;
begin
  for target in select * from hotel_staff_capability_qa_calls order by signature loop
    observed := true;
    observed_state := null;
    begin
      execute target.call_sql;
    exception when others then
      get stacked diagnostics observed_state = returned_sqlstate;
      observed := observed_state <> '42501';
    end;

    insert into hotel_staff_capability_qa_results values (
      p_persona, target.signature, p_expected_authorized, observed, observed_state
    );
    if observed is distinct from p_expected_authorized then
      raise exception 'HOTEL_STAFF_CAPABILITY_PERSONA_FAILED persona=% signature=% sqlstate=%',
        p_persona, target.signature, coalesce(observed_state, 'SUCCESS');
    end if;
  end loop;
end;
$$;

do $$
declare
  actor uuid;
  original_membership_role text;
  original_membership_active boolean;
  original_profile_active boolean;
  original_account_status text;
  nonmember_actor uuid := gen_random_uuid();
  settings_rejected boolean := false;
begin
  select membership.profile_id, membership.role, membership.is_active,
    profile.is_active, profile.account_status
  into actor, original_membership_role, original_membership_active,
    original_profile_active, original_account_status
  from public.operation_memberships membership
  join public.profiles profile on profile.id = membership.profile_id
  where membership.is_active
    and profile.is_active
    and profile.account_status = 'active'
  order by membership.profile_id
  limit 1;

  if actor is null then
    raise exception 'STOP_HOTEL_STAFF_CAPABILITY_QA_ACTOR_REQUIRED';
  end if;

  perform set_config('request.jwt.claim.sub', actor::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', actor, 'role', 'authenticated'
  )::text, true);

  update public.profiles
  set is_active = true, account_status = 'active'
  where id = actor;
  update public.operation_memberships
  set is_active = true, role = 'owner'
  where profile_id = actor;
  perform pg_temp.hotel_staff_assert_allowlist('A_OWNER', true);

  update public.operation_memberships set role = 'manager' where profile_id = actor;
  perform pg_temp.hotel_staff_assert_allowlist('B_MANAGER', true);

  update public.operation_memberships set role = 'staff' where profile_id = actor;
  perform pg_temp.hotel_staff_assert_allowlist('C_ACTIVE_STAFF', true);

  begin
    perform public.update_hotel_operation_settings(
      null::integer, null::time, null::time, null::uuid
    );
  exception when insufficient_privilege then
    settings_rejected := true;
  end;
  if not settings_rejected then
    raise exception 'HOTEL_SETTINGS_MUST_REJECT_STAFF';
  end if;

  update public.operation_memberships set is_active = false where profile_id = actor;
  perform pg_temp.hotel_staff_assert_allowlist('D_INACTIVE_OPERATION_MEMBER', false);

  update public.operation_memberships set is_active = true where profile_id = actor;
  update public.profiles set is_active = false where id = actor;
  perform pg_temp.hotel_staff_assert_allowlist('E_INACTIVE_PROFILE', false);

  update public.profiles set is_active = true, account_status = 'inactive' where id = actor;
  perform pg_temp.hotel_staff_assert_allowlist('E_INACTIVE_ACCOUNT', false);

  perform set_config('request.jwt.claim.sub', nonmember_actor::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', nonmember_actor, 'role', 'authenticated'
  )::text, true);
  perform pg_temp.hotel_staff_assert_allowlist('F_AUTHENTICATED_NON_MEMBER', false);

  perform set_config('request.jwt.claim.sub', actor::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', actor, 'role', 'authenticated'
  )::text, true);
  update public.profiles
  set is_active = original_profile_active, account_status = original_account_status
  where id = actor;
  update public.operation_memberships
  set is_active = original_membership_active, role = original_membership_role
  where profile_id = actor;
end;
$$;

select
  case when count(*) = 98
      and bool_and(expected_authorized = observed_authorized)
    then 'HOTEL_STAFF_OPERATION_CAPABILITY_PARITY_RUNTIME_QA_PASS'
    else 'HOTEL_STAFF_OPERATION_CAPABILITY_PARITY_RUNTIME_QA_FAIL'
  end verdict,
  count(*) filter (where persona = 'A_OWNER' and observed_authorized) owner_allowlist_pass,
  count(*) filter (where persona = 'B_MANAGER' and observed_authorized) manager_allowlist_pass,
  count(*) filter (where persona = 'C_ACTIVE_STAFF' and observed_authorized) staff_allowlist_pass,
  count(*) filter (where persona like 'D_%' and not observed_authorized) inactive_member_reject,
  count(*) filter (where persona like 'E_%' and not observed_authorized) inactive_profile_account_reject,
  count(*) filter (where persona = 'F_AUTHENTICATED_NON_MEMBER' and not observed_authorized) non_member_reject,
  'PASS'::text staff_hotel_settings_rejected,
  'ROLLBACK_ONLY'::text mutation_contract
from hotel_staff_capability_qa_results;

rollback;
