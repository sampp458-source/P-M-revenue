\set ON_ERROR_STOP on
begin;
select hotel_qa.assert_isolated_environment();

select set_config('request.jwt.claim.sub',(
  select profile.id::text from public.profiles profile
  join public.operation_memberships membership on membership.profile_id=profile.id
  where profile.is_active and profile.account_status='active' and membership.is_active
  order by profile.created_at,profile.id limit 1
),true);
select set_config('request.jwt.claim.role','authenticated',true);

do $$
declare
  qa_date constant date:=date '2000-01-02';
  dogs uuid[];
  day_id uuid;
  day_version integer;
  entry_ids uuid[];
  entry_version integer;
  result jsonb;
begin
  if auth.uid() is null or not public.is_active_operation_member() then
    raise exception 'STOP_JOURNAL_DAY_DEFAULT_ACTOR';
  end if;
  if exists(select 1 from public.journal_days where business_date=qa_date and journal_type='daycare_daily') then
    raise exception 'STOP_JOURNAL_DAY_DEFAULT_QA_DATE';
  end if;
  select array_agg(id order by id) into dogs from (
    select dog.id from public.dogs dog join public.customers customer on customer.id=dog.customer_id
    where dog.is_active and customer.is_active order by dog.created_at,dog.id limit 4
  ) source;
  if cardinality(dogs)<>4 then raise exception 'STOP_JOURNAL_DAY_DEFAULT_DOG_FIXTURE'; end if;

  result:=public.register_journal_roster_v2(qa_date,dogs[1:3],'  기다려  ',' 밸런스볼 ',null,gen_random_uuid());
  day_id:=(result->>'journalDayId')::uuid;
  day_version:=(result->'defaults'->>'version')::integer;
  if result->'defaults'->>'mannersActivityName'<>'기다려'
    or result->'defaults'->>'physicalActivityName'<>'밸런스볼'
    or (select count(*) from public.journal_entries where journal_day_id=day_id
        and manners_activity_name='기다려' and physical_activity_name='밸런스볼')<>3 then
    raise exception 'STOP_JOURNAL_DAY_DEFAULT_INITIAL_SNAPSHOT';
  end if;

  select array_agg(entry.id order by entry.dog_id) into entry_ids
  from public.journal_entries entry where entry.journal_day_id=day_id;
  select version into entry_version from public.journal_entries where id=entry_ids[1];
  perform public.update_journal_entry_draft(
    entry_ids[1],entry_version,'{}'::text[],null,null,null,'{}'::text[],null,null,null,
    '기다려',null,'터널놀이',null,null,gen_random_uuid()
  );
  if (select physical_activity_name from public.journal_entries where id=entry_ids[1])<>'터널놀이'
    or (select count(*) from public.journal_entries where id=any(entry_ids[2:3]) and physical_activity_name='밸런스볼')<>2
    or (select default_physical_activity_name from public.journal_days where id=day_id)<>'밸런스볼' then
    raise exception 'STOP_JOURNAL_DAY_DEFAULT_OVERRIDE_ISOLATION';
  end if;

  result:=public.update_journal_day_default_activities(day_id,day_version,'매트','터널',gen_random_uuid());
  day_version:=(result->'defaults'->>'version')::integer;
  if (select count(*) from public.journal_entries where id=any(entry_ids[2:3])
      and manners_activity_name='기다려' and physical_activity_name='밸런스볼')<>2 then
    raise exception 'STOP_JOURNAL_DAY_DEFAULT_NO_PROPAGATION';
  end if;
  result:=public.register_journal_roster_v2(qa_date,array[dogs[4]],'매트','터널',day_version,gen_random_uuid());
  if not exists(select 1 from public.journal_entries where journal_day_id=day_id and dog_id=dogs[4]
    and manners_activity_name='매트' and physical_activity_name='터널') then
    raise exception 'STOP_JOURNAL_DAY_DEFAULT_FUTURE_ENTRY';
  end if;

  day_version:=(result->'defaults'->>'version')::integer;
  perform public.register_journal_roster_v2(qa_date,array[dogs[2]],'매트','터널',day_version,gen_random_uuid());
  if (select manners_activity_name from public.journal_entries where journal_day_id=day_id and dog_id=dogs[2])<>'기다려' then
    raise exception 'STOP_JOURNAL_DAY_DEFAULT_EXISTING_READD';
  end if;

  begin
    perform public.update_journal_day_default_activities(day_id,day_version-1,'실패','실패',gen_random_uuid());
    raise exception 'STOP_JOURNAL_DAY_DEFAULT_STALE_NOT_REJECTED';
  exception when sqlstate 'PT409' then null;
  end;
  if (select default_manners_activity_name from public.journal_days where id=day_id)<>'매트' then
    raise exception 'STOP_JOURNAL_DAY_DEFAULT_STALE_MUTATION';
  end if;

  select version into entry_version from public.journal_entries where journal_day_id=day_id and dog_id=dogs[4];
  perform public.remove_journal_roster_entry(
    (select id from public.journal_entries where journal_day_id=day_id and dog_id=dogs[4]),
    entry_version,gen_random_uuid()
  );
  perform public.register_journal_roster_v2(qa_date,array[dogs[4]],'매트','터널',day_version,gen_random_uuid());
  if not exists(select 1 from public.journal_entries where journal_day_id=day_id and dog_id=dogs[4]
    and manners_activity_name='매트' and physical_activity_name='터널')
    or (select default_activities_version from public.journal_days where id=day_id)<>day_version then
    raise exception 'STOP_JOURNAL_DAY_DEFAULT_DELETE_RECREATE';
  end if;

  select version into entry_version from public.journal_entries where journal_day_id=day_id and dog_id=dogs[4];
  perform public.remove_journal_roster_entry(
    (select id from public.journal_entries where journal_day_id=day_id and dog_id=dogs[4]),
    entry_version,gen_random_uuid()
  );
  result:=public.update_journal_day_default_activities(day_id,day_version,'기다려',null,gen_random_uuid());
  day_version:=(result->'defaults'->>'version')::integer;
  perform public.register_journal_roster_v2(qa_date,array[dogs[4]],'기다려',null,day_version,gen_random_uuid());
  if not exists(select 1 from public.journal_entries where journal_day_id=day_id and dog_id=dogs[4]
    and manners_activity_name='기다려' and physical_activity_name is null) then
    raise exception 'STOP_JOURNAL_DAY_DEFAULT_ONE_EMPTY_PHYSICAL';
  end if;

  select version into entry_version from public.journal_entries where journal_day_id=day_id and dog_id=dogs[4];
  perform public.remove_journal_roster_entry(
    (select id from public.journal_entries where journal_day_id=day_id and dog_id=dogs[4]),
    entry_version,gen_random_uuid()
  );
  result:=public.update_journal_day_default_activities(day_id,day_version,null,'밸런스볼',gen_random_uuid());
  day_version:=(result->'defaults'->>'version')::integer;
  perform public.register_journal_roster_v2(qa_date,array[dogs[4]],null,'밸런스볼',day_version,gen_random_uuid());
  if not exists(select 1 from public.journal_entries where journal_day_id=day_id and dog_id=dogs[4]
    and manners_activity_name is null and physical_activity_name='밸런스볼') then
    raise exception 'STOP_JOURNAL_DAY_DEFAULT_ONE_EMPTY_MANNERS';
  end if;

  select version into entry_version from public.journal_entries where journal_day_id=day_id and dog_id=dogs[4];
  perform public.remove_journal_roster_entry(
    (select id from public.journal_entries where journal_day_id=day_id and dog_id=dogs[4]),
    entry_version,gen_random_uuid()
  );
  result:=public.update_journal_day_default_activities(day_id,day_version,'   ',' ',gen_random_uuid());
  day_version:=(result->'defaults'->>'version')::integer;
  perform public.register_journal_roster_v2(qa_date,array[dogs[4]],null,null,day_version,gen_random_uuid());
  if not exists(select 1 from public.journal_entries where journal_day_id=day_id and dog_id=dogs[4]
    and manners_activity_name is null and physical_activity_name is null)
    or exists(select 1 from public.journal_days where id=day_id
      and (default_manners_activity_name is not null or default_physical_activity_name is not null)) then
    raise exception 'STOP_JOURNAL_DAY_DEFAULT_BOTH_EMPTY_NORMALIZATION';
  end if;

  if (select count(*) from public.entity_audit_events where module_code='journal'
      and entity_type='journal_days' and entity_id=day_id
      and change_reason in ('journal_day_default_activities_register','journal_day_default_activities_update')
      and before_data is not null and after_data ? 'defaults' and changed_by=auth.uid() and request_id is not null)<2 then
    raise exception 'STOP_JOURNAL_DAY_DEFAULT_AUDIT';
  end if;
end;
$$;

select 'JOURNAL_DAY_DEFAULT_ACTIVITIES_RUNTIME_PASS' as status;
rollback;
