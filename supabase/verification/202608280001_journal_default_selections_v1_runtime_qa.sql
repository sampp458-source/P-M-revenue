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
  qa_date constant date:=date '2000-01-03';
  existing_date constant date:=date '2000-01-04';
  dog_ids uuid[];
  day_id uuid;
  existing_day_id uuid;
  day_version integer;
  request_a uuid:=gen_random_uuid();
  request_mixed uuid:=gen_random_uuid();
  request_failure uuid:=gen_random_uuid();
  entry_id uuid;
  deleted_id uuid;
  replay_snapshot jsonb;
  existing_snapshot jsonb;
  result jsonb;
  audit_count bigint;
begin
  if auth.uid() is null or not public.is_active_operation_member() then
    raise exception 'STOP_JOURNAL_DEFAULT_SELECTIONS_ACTOR';
  end if;
  if exists(select 1 from public.journal_days
      where business_date in (qa_date,existing_date) and journal_type='daycare_daily') then
    raise exception 'STOP_JOURNAL_DEFAULT_SELECTIONS_QA_DATE';
  end if;
  select array_agg(id order by id) into dog_ids from (
    select dog.id from public.dogs dog join public.customers customer on customer.id=dog.customer_id
    where dog.is_active and customer.is_active order by dog.created_at,dog.id limit 4
  ) source;
  if cardinality(dog_ids)<>4 then raise exception 'STOP_JOURNAL_DEFAULT_SELECTIONS_DOG_FIXTURE'; end if;

  result:=public.register_journal_roster_v2(
    qa_date,dog_ids[1:3],' 기다려 ',' 공놀이 ',null,request_a
  );
  day_id:=(result->>'journalDayId')::uuid;
  day_version:=(result->'defaults'->>'version')::integer;
  if (select count(*) from public.journal_entries entry
      where entry.journal_day_id=day_id
        and entry.condition_codes=array['active']::text[]
        and entry.urination is true and entry.defecation is true
        and entry.stool_condition='good'
        and entry.meal_codes=array['brought_food']::text[]
        and entry.teacher_relationship='loves_teacher'
        and entry.friend_relationship='loves_friends'
        and entry.best_friend_dog_id is null
        and entry.manners_activity_name='기다려' and entry.manners_evaluation='excellent'
        and entry.physical_activity_name='공놀이' and entry.physical_evaluation='champion'
        and entry.teacher_comment is null and entry.status='not_started' and entry.version=1)<>3 then
    raise exception 'STOP_JOURNAL_DEFAULT_SELECTIONS_INITIAL_VALUES';
  end if;
  if exists(select 1 from public.journal_entry_best_friend_targets target
      join public.journal_entries entry on entry.id=target.journal_entry_id
      where entry.journal_day_id=day_id) then
    raise exception 'STOP_JOURNAL_DEFAULT_SELECTIONS_BEST_FRIEND';
  end if;
  if (select count(*) from public.entity_audit_events audit
      where audit.module_code='journal' and audit.request_id=request_a
        and audit.change_reason='Journal roster Dog added'
        and audit.after_data->'conditionCodes'='["active"]'::jsonb
        and audit.after_data->'mealCodes'='["brought_food"]'::jsonb
        and audit.after_data->>'mannersEvaluation'='excellent'
        and audit.after_data->>'physicalEvaluation'='champion'
        and audit.after_data->'bestFriendTargets'='[]'::jsonb
        and audit.after_data->>'status'='NOT_STARTED'
        and (audit.after_data->>'version')::integer=1)<>3 then
    raise exception 'STOP_JOURNAL_DEFAULT_SELECTIONS_CREATE_AUDIT';
  end if;

  select count(*) into audit_count from public.entity_audit_events audit
  where audit.module_code='journal' and audit.request_id=request_a;
  select jsonb_agg(to_jsonb(entry) order by entry.dog_id) into replay_snapshot
  from public.journal_entries entry where entry.journal_day_id=day_id;
  perform public.register_journal_roster_v2(
    qa_date,dog_ids[1:3],'기다려','공놀이',null,request_a
  );
  if replay_snapshot is distinct from (
      select jsonb_agg(to_jsonb(entry) order by entry.dog_id)
      from public.journal_entries entry where entry.journal_day_id=day_id
    ) or audit_count<>(select count(*) from public.entity_audit_events audit
      where audit.module_code='journal' and audit.request_id=request_a) then
    raise exception 'STOP_JOURNAL_DEFAULT_SELECTIONS_REPLAY';
  end if;

  select to_jsonb(entry) into existing_snapshot from public.journal_entries entry
  where entry.journal_day_id=day_id and entry.dog_id=dog_ids[1];
  perform public.register_journal_roster_v2(
    qa_date,array[dog_ids[1]],'기다려','공놀이',day_version,gen_random_uuid()
  );
  if existing_snapshot is distinct from (select to_jsonb(entry) from public.journal_entries entry
      where entry.journal_day_id=day_id and entry.dog_id=dog_ids[1]) then
    raise exception 'STOP_JOURNAL_DEFAULT_SELECTIONS_EXISTING_NOOP';
  end if;

  insert into public.journal_days(
    business_date,journal_type,created_by,default_manners_activity_name,
    default_physical_activity_name,default_activities_version
  ) values(existing_date,'daycare_daily',auth.uid(),'기존 예절','기존 체육',1)
  returning id into existing_day_id;
  insert into public.journal_entries(
    journal_day_id,dog_id,customer_id,status,condition_codes,urination,defecation,
    stool_condition,meal_codes,teacher_relationship,friend_relationship,
    manners_activity_name,manners_evaluation,physical_activity_name,
    physical_evaluation,teacher_comment,created_by,updated_by
  )
  select existing_day_id,dog.id,dog.customer_id,
    case dog.id when dog_ids[1] then 'not_started' when dog_ids[2] then 'in_progress' else 'completed' end,
    case dog.id when dog_ids[1] then '{}'::text[] else array['calm']::text[] end,
    case dog.id when dog_ids[1] then null else false end,
    case dog.id when dog_ids[1] then null else false end,
    null,
    case dog.id when dog_ids[1] then '{}'::text[] else array['daycare_snack']::text[] end,
    case dog.id when dog_ids[1] then null else 'prefers_friends' end,
    case dog.id when dog_ids[1] then null else 'prefers_teacher' end,
    case dog.id when dog_ids[1] then null else '기존 예절' end,
    case dog.id when dog_ids[1] then null else 'can_improve' end,
    case dog.id when dog_ids[1] then null else '기존 체육' end,
    case dog.id when dog_ids[1] then null else 'fun' end,
    case dog.id when dog_ids[3] then '기존 완료 한마디' else null end,
    auth.uid(),auth.uid()
  from public.dogs dog where dog.id=any(dog_ids[1:3]);
  select jsonb_agg(to_jsonb(entry) order by entry.dog_id) into existing_snapshot
  from public.journal_entries entry where entry.journal_day_id=existing_day_id;
  perform public.register_journal_roster_v2(
    existing_date,dog_ids,'신규 예절','신규 체육',1,request_mixed
  );
  if existing_snapshot is distinct from (
      select jsonb_agg(to_jsonb(entry) order by entry.dog_id)
      from public.journal_entries entry
      where entry.journal_day_id=existing_day_id and entry.dog_id=any(dog_ids[1:3])
    ) or not exists(select 1 from public.journal_entries entry
      where entry.journal_day_id=existing_day_id and entry.dog_id=dog_ids[4]
        and entry.condition_codes=array['active']::text[]
        and entry.urination is true and entry.defecation is true
        and entry.stool_condition='good'
        and entry.meal_codes=array['brought_food']::text[]
        and entry.teacher_relationship='loves_teacher'
        and entry.friend_relationship='loves_friends'
        and entry.manners_activity_name='신규 예절' and entry.manners_evaluation='excellent'
        and entry.physical_activity_name='신규 체육' and entry.physical_evaluation='champion'
        and entry.best_friend_dog_id is null and entry.teacher_comment is null
        and entry.status='not_started' and entry.version=1) then
    raise exception 'STOP_JOURNAL_DEFAULT_SELECTIONS_MIXED_EXISTING_NEW';
  end if;

  begin
    perform public.register_journal_roster_v2(
      qa_date,array[dog_ids[4],dog_ids[4]],'기다려','공놀이',day_version,request_failure
    );
    raise exception 'STOP_JOURNAL_DEFAULT_SELECTIONS_DUPLICATE_NOT_REJECTED';
  exception when sqlstate '22023' then null;
  end;
  if exists(select 1 from public.journal_entries where journal_day_id=day_id and dog_id=dog_ids[4])
    or exists(select 1 from public.entity_audit_events where request_id=request_failure) then
    raise exception 'STOP_JOURNAL_DEFAULT_SELECTIONS_PARTIAL_STATE';
  end if;

  select id into deleted_id from public.journal_entries
  where journal_day_id=day_id and dog_id=dog_ids[3];
  perform public.remove_journal_roster_entry(deleted_id,1,gen_random_uuid());
  perform public.register_journal_roster_v2(
    qa_date,array[dog_ids[3]],'기다려','공놀이',day_version,gen_random_uuid()
  );
  select id into entry_id from public.journal_entries
  where journal_day_id=day_id and dog_id=dog_ids[3];
  if entry_id=deleted_id or not exists(select 1 from public.journal_entries entry
      where entry.id=entry_id and entry.version=1 and entry.status='not_started'
        and entry.condition_codes=array['active']::text[] and entry.manners_evaluation='excellent'
        and entry.physical_evaluation='champion') then
    raise exception 'STOP_JOURNAL_DEFAULT_SELECTIONS_DELETE_REREGISTER';
  end if;

  perform public.remove_journal_roster_entry(entry_id,1,gen_random_uuid());
  result:=public.update_journal_day_default_activities(day_id,day_version,null,null,gen_random_uuid());
  day_version:=(result->'defaults'->>'version')::integer;
  perform public.register_journal_roster_v2(
    qa_date,array[dog_ids[3]],null,null,day_version,gen_random_uuid()
  );
  if not exists(select 1 from public.journal_entries entry
      where entry.journal_day_id=day_id and entry.dog_id=dog_ids[3]
        and entry.manners_activity_name is null and entry.manners_evaluation is null
        and entry.physical_activity_name is null and entry.physical_evaluation is null) then
    raise exception 'STOP_JOURNAL_DEFAULT_SELECTIONS_EMPTY_ACTIVITY_PAIR';
  end if;

  begin
    perform public.register_journal_roster_v2(
      ((clock_timestamp() at time zone 'Asia/Seoul')::date+1),array[dog_ids[4]],null,null,null,gen_random_uuid()
    );
    raise exception 'STOP_JOURNAL_DEFAULT_SELECTIONS_FUTURE_NOT_REJECTED';
  exception when sqlstate '22023' then null;
  end;

  if exists(select 1 from public.entity_audit_events audit
      join public.journal_entries entry on entry.id=audit.entity_id
      where entry.journal_day_id=day_id
        and audit.change_reason in ('Journal draft updated','Journal completed entry updated')) then
    raise exception 'STOP_JOURNAL_DEFAULT_SELECTIONS_UPDATE_AUDIT';
  end if;
end;
$$;

select 'JOURNAL_DEFAULT_SELECTIONS_V1_RUNTIME_PASS' as status;
rollback;
