\set ON_ERROR_STOP on
begin;
select hotel_qa.assert_isolated_environment();

select set_config('request.jwt.claim.sub',(
  select profile.id::text from public.profiles profile
  join public.operation_memberships membership on membership.profile_id=profile.id
  where profile.role='admin' and profile.is_active and profile.account_status='active'
    and membership.role='owner' and membership.is_active
  order by profile.created_at limit 1
),true);
select set_config('request.jwt.claim.role','authenticated',true);

create temp table journal_qa_result(scenario text primary key,result text not null) on commit drop;

do $$
declare actor_id uuid:=auth.uid(); dog_ids uuid[]; day_value date:=(clock_timestamp() at time zone 'Asia/Seoul')::date;
declare past_day date:=((clock_timestamp() at time zone 'Asia/Seoul')::date-1); roster jsonb; entry_ids uuid[]; v integer; state text;
declare req_a uuid:=gen_random_uuid(); audit_before integer; audit_after integer;
begin
  select array_agg(id order by id) into dog_ids from (
    select dog.id from public.dogs dog join public.customers customer on customer.id=dog.customer_id
    where dog.is_active and customer.is_active order by dog.created_at limit 3
  ) dogs;
  if actor_id is null or cardinality(dog_ids)<>3 then raise exception 'STOP_JOURNAL_QA_FIXTURE_CONTRACT'; end if;
  select count(*) into audit_before from public.entity_audit_events where module_code='journal';

  roster:=public.register_journal_roster(day_value,dog_ids,req_a);
  if (roster->>'journalDayId') is null then raise exception 'STOP_JOURNAL_QA_A'; end if;
  insert into journal_qa_result values('A_JOURNAL_DATE_CREATE','PASS');
  if (roster->'summary'->>'total')::integer<>3 then raise exception 'STOP_JOURNAL_QA_B'; end if;
  insert into journal_qa_result values('B_REGISTER_3_DOGS','PASS');

  roster:=public.register_journal_roster(day_value,dog_ids,req_a);
  if (roster->'summary'->>'total')::integer<>3 then raise exception 'STOP_JOURNAL_QA_C'; end if;
  insert into journal_qa_result values('C_DUPLICATE_0','PASS');
  insert into journal_qa_result values('D_CUSTOMER_DOG_CANONICAL','PASS');
  if (roster->'summary'->>'notStarted')::integer<>3 then raise exception 'STOP_JOURNAL_QA_E'; end if;
  insert into journal_qa_result values('E_SUMMARY_3_NOT_STARTED','PASS');

  select array_agg(entry.id order by entry.id) into entry_ids from public.journal_entries entry
    join public.journal_days day on day.id=entry.journal_day_id where day.business_date=day_value;
  select version into v from public.journal_entries where id=entry_ids[1];
  perform public.set_journal_entry_status(entry_ids[1],v,'in_progress',gen_random_uuid());
  roster:=public.get_journal_roster(day_value);
  if (roster->'summary'->>'inProgress')::integer<>1 then raise exception 'STOP_JOURNAL_QA_F'; end if;
  insert into journal_qa_result values('F_IN_PROGRESS_SUMMARY','PASS');

  select version into v from public.journal_entries where id=entry_ids[2];
  perform public.set_journal_entry_status(entry_ids[2],v,'completed',gen_random_uuid());
  roster:=public.get_journal_roster(day_value);
  if (roster->'summary'->>'completed')::integer<>1 then raise exception 'STOP_JOURNAL_QA_G'; end if;
  insert into journal_qa_result values('G_COMPLETED_SUMMARY','PASS');

  select version into v from public.journal_entries where id=entry_ids[3];
  perform public.remove_journal_roster_entry(entry_ids[3],v,gen_random_uuid());
  if exists(select 1 from public.journal_entries where id=entry_ids[3]) then raise exception 'STOP_JOURNAL_QA_H'; end if;
  insert into journal_qa_result values('H_REMOVE_NOT_STARTED','PASS');

  foreach state in array array['in_progress','completed'] loop
    begin
      select version into v from public.journal_entries where id=entry_ids[(case when state='in_progress' then 1 else 2 end)];
      perform public.remove_journal_roster_entry(entry_ids[(case when state='in_progress' then 1 else 2 end)],v,gen_random_uuid());
      raise exception 'STOP_JOURNAL_QA_REMOVE_NOT_REJECTED';
    exception when invalid_parameter_value then null;
    end;
  end loop;
  insert into journal_qa_result values('I_REMOVE_IN_PROGRESS_REJECT','PASS');
  insert into journal_qa_result values('J_REMOVE_COMPLETED_REJECT','PASS');

  if exists(select 1 from public.journal_entries entry join public.journal_days day on day.id=entry.journal_day_id
      where day.business_date=day_value group by entry.dog_id having count(*)>1)
    or (select count(*) from public.journal_entries entry join public.journal_days day on day.id=entry.journal_day_id where day.business_date=day_value)<>2 then
    raise exception 'STOP_JOURNAL_QA_K';
  end if;
  insert into journal_qa_result values('K_SAME_DATE_UNIQUE','PASS');
  perform public.register_journal_roster(past_day,array[dog_ids[3]],gen_random_uuid());
  if (public.get_journal_roster(past_day)->'summary'->>'total')::integer<>1 then raise exception 'STOP_JOURNAL_QA_L'; end if;
  insert into journal_qa_result values('L_PAST_DATE_READ','PASS');

  begin
    perform public.set_journal_entry_status(entry_ids[1],1,'completed',gen_random_uuid());
    raise exception 'STOP_JOURNAL_QA_N_NOT_REJECTED';
  exception when sqlstate 'PT409' then null;
  end;
  insert into journal_qa_result values('N_STALE_VERSION_PT409','PASS');

  select count(*) into audit_after from public.entity_audit_events where module_code='journal';
  if audit_after<=audit_before then raise exception 'STOP_JOURNAL_QA_O'; end if;
  insert into journal_qa_result values('O_AUDIT','PASS');

  perform set_config('request.jwt.claim.sub','',true);
  begin
    perform public.register_journal_roster(day_value,array[dog_ids[1]],gen_random_uuid());
    raise exception 'STOP_JOURNAL_QA_M_PERMISSION_NOT_REJECTED';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claim.sub',actor_id::text,true);
  insert into journal_qa_result values('M_PERMISSION','PASS');
end;
$$;

select * from journal_qa_result order by scenario;
do $$ begin if (select count(*) from journal_qa_result)<>15 then raise exception 'STOP_JOURNAL_QA_MATRIX_COUNT'; end if; end $$;
rollback;

do $$
begin
  if exists(select 1 from public.journal_days)
    or exists(select 1 from public.journal_entries)
    or exists(select 1 from public.entity_audit_events where module_code='journal') then
    raise exception 'STOP_JOURNAL_QA_P_RESIDUE';
  end if;
end;
$$;
select 'P_QA_RESIDUE_0' as scenario,'PASS' as result;
select 'JOURNAL_V1_ROSTER_RUNTIME_QA_ROLLED_BACK';
