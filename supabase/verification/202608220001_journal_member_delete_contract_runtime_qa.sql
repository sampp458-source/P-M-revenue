\set ON_ERROR_STOP on
begin;
select hotel_qa.assert_isolated_environment();

select set_config('request.jwt.claim.sub', (
  select profile.id::text
  from public.profiles profile
  join public.operation_memberships membership on membership.profile_id = profile.id
  where profile.role = 'staff'
    and profile.is_active
    and profile.account_status = 'active'
    and membership.is_active
  order by profile.created_at, profile.id
  limit 1
), true);
select set_config('request.jwt.claim.role', 'authenticated', true);

create temp table journal_member_delete_qa_result(
  scenario text primary key,
  result text not null
) on commit drop;

do $$
declare
  actor_id uuid := auth.uid();
  qa_date constant date := date '2000-01-01';
  dog_ids uuid[];
  entry_ids uuid[];
  day_id uuid;
  version_value integer;
  request_not_started uuid := gen_random_uuid();
  admin_id uuid;
  result jsonb;
  audit_count integer;
  dogs_before integer;
  customers_before integer;
  other_entries_before integer;
begin
  if actor_id is null or not public.is_active_operation_member()
    or coalesce(public.is_admin(), false) then
    raise exception 'STOP_JOURNAL_MEMBER_DELETE_STAFF_FIXTURE';
  end if;
  if exists (
    select 1 from public.journal_days
    where business_date = qa_date and journal_type = 'daycare_daily'
  ) then
    raise exception 'STOP_JOURNAL_MEMBER_DELETE_QA_DATE_NOT_EMPTY';
  end if;

  select array_agg(id order by id) into dog_ids
  from (
    select dog.id
    from public.dogs dog
    join public.customers customer on customer.id = dog.customer_id
    where dog.is_active and customer.is_active
    order by dog.created_at, dog.id
    limit 4
  ) dogs;
  if cardinality(dog_ids) <> 4 then
    raise exception 'STOP_JOURNAL_MEMBER_DELETE_DOG_FIXTURE';
  end if;

  select count(*) into dogs_before from public.dogs;
  select count(*) into customers_before from public.customers;
  select count(*) into other_entries_before from public.journal_entries;

  result := public.register_journal_roster(qa_date, dog_ids, gen_random_uuid());
  day_id := (result ->> 'journalDayId')::uuid;
  select array_agg(entry.id order by entry.dog_id) into entry_ids
  from public.journal_entries entry
  where entry.journal_day_id = day_id;
  if cardinality(entry_ids) <> 4 then
    raise exception 'STOP_JOURNAL_MEMBER_DELETE_REGISTER';
  end if;

  select version into version_value from public.journal_entries where id = entry_ids[1];
  result := public.remove_journal_roster_entry(entry_ids[1], version_value, request_not_started);
  if exists(select 1 from public.journal_entries where id = entry_ids[1]) then
    raise exception 'STOP_JOURNAL_MEMBER_DELETE_NOT_STARTED';
  end if;
  insert into journal_member_delete_qa_result values('A_MEMBER_DELETE_NOT_STARTED', 'PASS');

  result := public.remove_journal_roster_entry(entry_ids[1], version_value, request_not_started);
  if (result -> 'summary' ->> 'total')::integer <> 3 then
    raise exception 'STOP_JOURNAL_MEMBER_DELETE_REPLAY';
  end if;
  insert into journal_member_delete_qa_result values('B_REPLAY_IDEMPOTENT', 'PASS');

  begin
    perform public.remove_journal_roster_entry(entry_ids[4], 1, request_not_started);
    raise exception 'STOP_JOURNAL_MEMBER_DELETE_REQUEST_REUSE_NOT_REJECTED';
  exception when invalid_parameter_value then null;
  end;
  insert into journal_member_delete_qa_result values('C_REQUEST_REUSE_OTHER_ENTRY_REJECT', 'PASS');

  select version into version_value from public.journal_entries where id = entry_ids[2];
  perform public.set_journal_entry_status(entry_ids[2], version_value, 'in_progress', gen_random_uuid());
  select version into version_value from public.journal_entries where id = entry_ids[2];
  perform public.remove_journal_roster_entry(entry_ids[2], version_value, gen_random_uuid());
  insert into journal_member_delete_qa_result values('D_MEMBER_DELETE_IN_PROGRESS', 'PASS');

  select version into version_value from public.journal_entries where id = entry_ids[3];
  perform public.set_journal_entry_status(entry_ids[3], version_value, 'completed', gen_random_uuid());
  select version into version_value from public.journal_entries where id = entry_ids[3];
  perform public.remove_journal_roster_entry(entry_ids[3], version_value, gen_random_uuid());
  insert into journal_member_delete_qa_result values('E_MEMBER_DELETE_COMPLETED', 'PASS');

  select version into version_value from public.journal_entries where id = entry_ids[4];
  begin
    perform public.remove_journal_roster_entry(entry_ids[4], version_value + 1, gen_random_uuid());
    raise exception 'STOP_JOURNAL_MEMBER_DELETE_STALE_NOT_REJECTED';
  exception when sqlstate 'PT409' then null;
  end;
  insert into journal_member_delete_qa_result values('F_STALE_VERSION_PT409', 'PASS');

  update public.operation_memberships
  set is_active = false, updated_at = clock_timestamp()
  where profile_id = actor_id;
  begin
    perform public.remove_journal_roster_entry(entry_ids[4], version_value, gen_random_uuid());
    raise exception 'STOP_JOURNAL_MEMBER_DELETE_INACTIVE_NOT_REJECTED';
  exception when insufficient_privilege then null;
  end;
  insert into journal_member_delete_qa_result values('G_INACTIVE_MEMBER_REJECT', 'PASS');

  update public.operation_memberships
  set is_active = true, updated_at = clock_timestamp()
  where profile_id = actor_id;
  perform set_config('request.jwt.claim.sub', '', true);
  begin
    perform public.remove_journal_roster_entry(entry_ids[4], version_value, gen_random_uuid());
    raise exception 'STOP_JOURNAL_MEMBER_DELETE_ANON_NOT_REJECTED';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claim.sub', actor_id::text, true);
  insert into journal_member_delete_qa_result values('H_ANONYMOUS_REJECT', 'PASS');

  perform public.remove_journal_roster_entry(entry_ids[4], version_value, gen_random_uuid());
  if exists(select 1 from public.journal_entries where journal_day_id = day_id) then
    raise exception 'STOP_JOURNAL_MEMBER_DELETE_ENTRY_RESIDUE';
  end if;
  insert into journal_member_delete_qa_result values('I_EXACT_ENTRY_DELETE', 'PASS');

  result := public.register_journal_roster(qa_date, dog_ids[1:3], gen_random_uuid());
  if (result -> 'summary' ->> 'total')::integer <> 3 then
    raise exception 'STOP_JOURNAL_MEMBER_DELETE_RECREATE';
  end if;
  insert into journal_member_delete_qa_result values('J_RECREATE_SAME_DOG_DATE', 'PASS');

  select profile.id into admin_id
  from public.profiles profile
  join public.operation_memberships membership on membership.profile_id = profile.id
  where profile.role = 'admin'
    and profile.is_active
    and profile.account_status = 'active'
    and membership.is_active
  order by profile.created_at, profile.id
  limit 1;
  if admin_id is null then
    raise exception 'STOP_JOURNAL_MEMBER_DELETE_ADMIN_FIXTURE';
  end if;
  perform set_config('request.jwt.claim.sub', admin_id::text, true);

  select array_agg(entry.id order by entry.dog_id) into entry_ids
  from public.journal_entries entry
  where entry.journal_day_id = day_id;
  select version into version_value from public.journal_entries where id = entry_ids[2];
  perform public.set_journal_entry_status(entry_ids[2], version_value, 'in_progress', gen_random_uuid());
  select version into version_value from public.journal_entries where id = entry_ids[3];
  perform public.set_journal_entry_status(entry_ids[3], version_value, 'completed', gen_random_uuid());

  select version into version_value from public.journal_entries where id = entry_ids[1];
  perform public.remove_journal_roster_entry(entry_ids[1], version_value, gen_random_uuid());
  insert into journal_member_delete_qa_result values('K_ADMIN_DELETE_NOT_STARTED', 'PASS');
  select version into version_value from public.journal_entries where id = entry_ids[2];
  perform public.remove_journal_roster_entry(entry_ids[2], version_value, gen_random_uuid());
  insert into journal_member_delete_qa_result values('L_ADMIN_DELETE_IN_PROGRESS', 'PASS');
  select version into version_value from public.journal_entries where id = entry_ids[3];
  perform public.remove_journal_roster_entry(entry_ids[3], version_value, gen_random_uuid());
  insert into journal_member_delete_qa_result values('M_ADMIN_DELETE_COMPLETED', 'PASS');

  perform set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
  begin
    perform public.remove_journal_roster_entry(gen_random_uuid(), 1, gen_random_uuid());
    raise exception 'STOP_JOURNAL_MEMBER_DELETE_NON_MEMBER_NOT_REJECTED';
  exception when insufficient_privilege then null;
  end;
  insert into journal_member_delete_qa_result values('N_NON_OPERATIONS_MEMBER_REJECT', 'PASS');
  perform set_config('request.jwt.claim.sub', actor_id::text, true);

  if not exists(select 1 from public.journal_days where id = day_id) then
    raise exception 'STOP_JOURNAL_MEMBER_DELETE_DAY_REMOVED';
  end if;
  insert into journal_member_delete_qa_result values('O_JOURNAL_DAY_PRESERVED', 'PASS');

  if (select count(*) from public.dogs) <> dogs_before
    or (select count(*) from public.customers) <> customers_before
    or (select count(*) from public.journal_entries) <> other_entries_before then
    raise exception 'STOP_JOURNAL_MEMBER_DELETE_BUSINESS_SCOPE';
  end if;
  insert into journal_member_delete_qa_result values('P_DOG_CUSTOMER_OTHER_JOURNAL_PRESERVED', 'PASS');

  select count(*) into audit_count
  from public.entity_audit_events audit
  where audit.module_code = 'journal'
    and audit.entity_type = 'journal_entries'
    and audit.action = 'archived'
    and audit.change_reason = 'journal_entry_delete'
    and (audit.after_data ->> 'journalDayId')::uuid = day_id
    and audit.request_id is not null
    and audit.after_data ? 'dogId'
    and audit.after_data ? 'statusBeforeDelete';
  if audit_count <> 7 then
    raise exception 'STOP_JOURNAL_MEMBER_DELETE_AUDIT';
  end if;
  insert into journal_member_delete_qa_result values('Q_AUDIT_EXACT', 'PASS');
end;
$$;

select * from journal_member_delete_qa_result order by scenario;
do $$
begin
  if (select count(*) from journal_member_delete_qa_result) <> 17 then
    raise exception 'STOP_JOURNAL_MEMBER_DELETE_QA_MATRIX_COUNT';
  end if;
end;
$$;
rollback;

do $$
begin
  if exists (
    select 1 from public.journal_days
    where business_date = date '2000-01-01' and journal_type = 'daycare_daily'
  ) then
    raise exception 'STOP_JOURNAL_MEMBER_DELETE_QA_RESIDUE';
  end if;
end;
$$;
select 'R_QA_RESIDUE_0' as scenario, 'PASS' as result;
select 'JOURNAL_MEMBER_DELETE_RUNTIME_QA_ROLLED_BACK' as status;
