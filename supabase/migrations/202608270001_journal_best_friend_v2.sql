-- P&M Journal Best Friend V2: ordered same-day Dog and Teacher targets.
begin;

do $$
declare invalid_legacy_count bigint;
begin
  if to_regclass('public.journal_entries') is null
    or to_regclass('public.entity_audit_events') is null
    or to_regprocedure('public.journal_entry_json_internal(uuid)') is null
    or to_regprocedure('public.update_journal_entry_draft(uuid,integer,text[],boolean,boolean,text,text[],text,text,uuid,text,text,text,text,text,uuid)') is null
    or to_regprocedure('public.remove_journal_roster_entry(uuid,integer,uuid)') is null
    or to_regprocedure('public.is_active_operation_member()') is null then
    raise exception 'STOP_JOURNAL_BEST_FRIEND_V2_BASELINE_MISSING';
  end if;
  if to_regclass('public.journal_entry_best_friend_targets') is not null
    or to_regprocedure('public.update_journal_entry_draft_v2(uuid,integer,text[],boolean,boolean,text,text[],text,text,jsonb,text,text,text,text,text,uuid)') is not null then
    raise exception 'STOP_JOURNAL_BEST_FRIEND_V2_ALREADY_APPLIED';
  end if;
  select count(*) into invalid_legacy_count
  from public.journal_entries source
  where source.best_friend_dog_id is not null
    and not exists (
      select 1 from public.journal_entries friend
      where friend.journal_day_id=source.journal_day_id
        and friend.dog_id=source.best_friend_dog_id
        and friend.id<>source.id
    );
  if invalid_legacy_count<>0 then
    raise exception 'STOP_JOURNAL_BEST_FRIEND_V2_INVALID_LEGACY_REFERENCE';
  end if;
end;
$$;

create table public.journal_entry_best_friend_targets (
  id uuid primary key default gen_random_uuid(),
  journal_entry_id uuid not null references public.journal_entries(id) on delete cascade,
  target_type text not null check (target_type in ('DOG','TEACHER')),
  dog_id uuid null references public.dogs(id) on delete restrict,
  sort_order integer not null check (sort_order between 0 and 4),
  created_at timestamptz not null default clock_timestamp(),
  created_by uuid not null references public.profiles(id) on delete restrict,
  constraint journal_entry_best_friend_targets_semantics check (
    (target_type='DOG' and dog_id is not null)
    or (target_type='TEACHER' and dog_id is null)
  ),
  constraint journal_entry_best_friend_targets_entry_order_unique unique(journal_entry_id,sort_order)
);

create unique index journal_entry_best_friend_targets_dog_unique
  on public.journal_entry_best_friend_targets(journal_entry_id,dog_id)
  where target_type='DOG';
create unique index journal_entry_best_friend_targets_teacher_unique
  on public.journal_entry_best_friend_targets(journal_entry_id)
  where target_type='TEACHER';
create index journal_entry_best_friend_targets_entry_idx
  on public.journal_entry_best_friend_targets(journal_entry_id,sort_order,id);
create index journal_entry_best_friend_targets_dog_idx
  on public.journal_entry_best_friend_targets(dog_id,journal_entry_id)
  where target_type='DOG';

alter table public.journal_entry_best_friend_targets enable row level security;
create policy journal_entry_best_friend_targets_select_active_member
  on public.journal_entry_best_friend_targets for select to authenticated
  using (public.is_active_operation_member());
revoke all on table public.journal_entry_best_friend_targets from public,anon,authenticated;
grant select on table public.journal_entry_best_friend_targets to authenticated,service_role;

insert into public.journal_entry_best_friend_targets(
  journal_entry_id,target_type,dog_id,sort_order,created_at,created_by
)
select entry.id,'DOG',entry.best_friend_dog_id,0,entry.updated_at,entry.updated_by
from public.journal_entries entry
where entry.best_friend_dog_id is not null;

create or replace function public.journal_entry_json_internal(p_entry_id uuid)
returns jsonb language sql stable security definer
set search_path=public,pg_temp
as $$
  select jsonb_build_object(
    'id',entry.id,
    'journalDayId',entry.journal_day_id,
    'businessDate',day.business_date,
    'dog',jsonb_build_object('id',dog.id,'name',dog.name),
    'customer',jsonb_build_object('id',customer.id,'name',customer.name),
    'status',upper(entry.status),
    'conditionCodes',to_jsonb(entry.condition_codes),
    'urination',entry.urination,
    'defecation',entry.defecation,
    'stoolCondition',entry.stool_condition,
    'mealCodes',to_jsonb(entry.meal_codes),
    'teacherRelationship',entry.teacher_relationship,
    'friendRelationship',entry.friend_relationship,
    'bestFriendDogId',entry.best_friend_dog_id,
    'bestFriendTargets',coalesce((
      select jsonb_agg(
        case when target.target_type='DOG'
          then jsonb_build_object('type','DOG','dogId',target.dog_id)
          else jsonb_build_object('type','TEACHER','dogId',null)
        end order by target.sort_order,target.id
      )
      from public.journal_entry_best_friend_targets target
      where target.journal_entry_id=entry.id
    ),'[]'::jsonb),
    'mannersActivityName',entry.manners_activity_name,
    'mannersEvaluation',entry.manners_evaluation,
    'physicalActivityName',entry.physical_activity_name,
    'physicalEvaluation',entry.physical_evaluation,
    'teacherComment',entry.teacher_comment,
    'version',entry.version,
    'createdAt',entry.created_at,
    'updatedAt',entry.updated_at
  )
  from public.journal_entries entry
  join public.journal_days day on day.id=entry.journal_day_id
  join public.dogs dog on dog.id=entry.dog_id
  join public.customers customer on customer.id=entry.customer_id
  where entry.id=p_entry_id and public.is_active_operation_member();
$$;

create function public.update_journal_entry_draft_v2(
  p_entry_id uuid,
  p_expected_version integer,
  p_condition_codes text[],
  p_urination boolean,
  p_defecation boolean,
  p_stool_condition text,
  p_meal_codes text[],
  p_teacher_relationship text,
  p_friend_relationship text,
  p_best_friend_targets jsonb,
  p_manners_activity_name text,
  p_manners_evaluation text,
  p_physical_activity_name text,
  p_physical_evaluation text,
  p_teacher_comment text,
  p_request_id uuid
)
returns jsonb language plpgsql security definer
set search_path=public,pg_temp
as $$
declare
  actor_id uuid:=auth.uid();
  row_before public.journal_entries%rowtype;
  row_after public.journal_entries%rowtype;
  existing_event public.entity_audit_events%rowtype;
  request_payload jsonb;
  before_payload jsonb;
  result jsonb;
  normalized_conditions text[]:=coalesce(p_condition_codes,'{}'::text[]);
  normalized_meals text[]:=coalesce(p_meal_codes,'{}'::text[]);
  normalized_stool text:=case when p_defecation is true then nullif(p_stool_condition,'') else null end;
  normalized_manners text:=nullif(btrim(coalesce(p_manners_activity_name,'')),'');
  normalized_physical text:=nullif(btrim(coalesce(p_physical_activity_name,'')),'');
  normalized_comment text:=nullif(btrim(coalesce(p_teacher_comment,'')),'');
  normalized_targets jsonb:='[]'::jsonb;
  existing_targets jsonb:='[]'::jsonb;
  legacy_projection uuid;
begin
  if actor_id is null or not public.is_active_operation_member() then
    raise exception '일지를 작성할 권한이 없습니다.' using errcode='42501';
  end if;
  if p_entry_id is null or p_expected_version is null or p_request_id is null then
    raise exception '일지 항목, 버전, 요청 ID가 필요합니다.' using errcode='22023';
  end if;
  if normalized_conditions <@ array['active','calm','tired','sensitive']::text[] is not true
    or (select count(*) from unnest(normalized_conditions) code)<>cardinality(array(select distinct code from unnest(normalized_conditions) code))
    or normalized_meals <@ array['brought_food','daycare_food','brought_snack','daycare_snack']::text[] is not true
    or (select count(*) from unnest(normalized_meals) code)<>cardinality(array(select distinct code from unnest(normalized_meals) code))
    or (normalized_stool is not null and normalized_stool not in ('good','very_loose','slightly_loose','poor'))
    or (p_teacher_relationship is not null and p_teacher_relationship not in ('loves_teacher','prefers_friends','uncomfortable_with_teacher'))
    or (p_friend_relationship is not null and p_friend_relationship not in ('loves_friends','prefers_teacher','uncomfortable_with_friends'))
    or (p_manners_evaluation is not null and p_manners_evaluation not in ('excellent','can_improve','difficult'))
    or (p_physical_evaluation is not null and p_physical_evaluation not in ('champion','fun','rest'))
    or char_length(coalesce(normalized_manners,''))>80
    or char_length(coalesce(normalized_physical,''))>80
    or char_length(coalesce(normalized_comment,''))>500 then
    raise exception '일지 입력값을 확인해 주세요.' using errcode='22023';
  end if;
  if p_best_friend_targets is null or jsonb_typeof(p_best_friend_targets)<>'array' then
    raise exception '제일 친한 친구 대상 유형을 확인해 주세요.' using errcode='22023';
  end if;
  if jsonb_array_length(p_best_friend_targets)>5 then
    raise exception '제일 친한 친구는 최대 5명까지 선택할 수 있습니다.' using errcode='22023';
  end if;
  if exists(
    select 1 from jsonb_array_elements(p_best_friend_targets) as selected(target)
    where jsonb_typeof(target)<>'object'
      or target->>'type' not in ('DOG','TEACHER')
      or (target->>'type'='DOG' and (
        nullif(target->>'dogId','') is null
        or (target->>'dogId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      ))
      or (target->>'type'='TEACHER' and nullif(target->>'dogId','') is not null)
  ) then
    raise exception '제일 친한 친구 대상 유형을 확인해 주세요.' using errcode='22023';
  end if;
  if exists(
    select 1
    from jsonb_array_elements(p_best_friend_targets) as selected(target)
    group by case when target->>'type'='TEACHER' then 'TEACHER' else 'DOG:'||(target->>'dogId') end
    having count(*)>1
  ) then
    raise exception '같은 제일 친한 친구 대상을 중복 선택할 수 없습니다.' using errcode='22023';
  end if;
  select coalesce(jsonb_agg(
    case when target->>'type'='DOG'
      then jsonb_build_object('type','DOG','dogId',(target->>'dogId')::uuid)
      else jsonb_build_object('type','TEACHER','dogId',null)
    end order by ordinal
  ),'[]'::jsonb)
  into normalized_targets
  from jsonb_array_elements(p_best_friend_targets) with ordinality selected(target,ordinal);

  request_payload:=jsonb_build_object(
    'entryId',p_entry_id,'conditionCodes',normalized_conditions,'urination',p_urination,
    'defecation',p_defecation,'stoolCondition',normalized_stool,'mealCodes',normalized_meals,
    'teacherRelationship',p_teacher_relationship,'friendRelationship',p_friend_relationship,
    'bestFriendTargets',normalized_targets,'mannersActivityName',normalized_manners,
    'mannersEvaluation',p_manners_evaluation,'physicalActivityName',normalized_physical,
    'physicalEvaluation',p_physical_evaluation,'teacherComment',normalized_comment
  );
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
  select * into existing_event from public.entity_audit_events audit
  where audit.module_code='journal' and audit.entity_type='journal_entries'
    and audit.entity_id=p_entry_id and audit.request_id=p_request_id
    and audit.change_reason in ('Journal draft updated','Journal completed entry updated');
  if found then
    if existing_event.after_data->'request' is distinct from request_payload then
      raise exception '동일 요청 ID가 다른 일지 저장에 사용되었습니다.' using errcode='22023';
    end if;
    return existing_event.after_data->'entry';
  end if;

  select * into row_before from public.journal_entries where id=p_entry_id for update;
  if not found then raise exception '일지 항목을 찾을 수 없습니다.' using errcode='P0002'; end if;
  if row_before.version<>p_expected_version then
    raise exception '다른 사용자가 먼저 변경했습니다.' using errcode='PT409';
  end if;
  if exists(
    select 1 from jsonb_array_elements(normalized_targets) as selected(target)
    where target->>'type'='DOG' and (target->>'dogId')::uuid=row_before.dog_id
  ) then
    raise exception '자기 자신을 제일 친한 친구로 선택할 수 없습니다.' using errcode='22023';
  end if;
  if exists(
    select 1 from jsonb_array_elements(normalized_targets) as selected(target)
    where target->>'type'='DOG' and not exists(
      select 1 from public.journal_entries friend
      where friend.journal_day_id=row_before.journal_day_id
        and friend.dog_id=(target->>'dogId')::uuid
        and friend.id<>row_before.id
    )
  ) then
    raise exception '같은 날 등원 명단의 반려견만 선택할 수 있습니다.' using errcode='22023';
  end if;
  select coalesce(jsonb_agg(
    case when target.target_type='DOG'
      then jsonb_build_object('type','DOG','dogId',target.dog_id)
      else jsonb_build_object('type','TEACHER','dogId',null)
    end order by target.sort_order,target.id
  ),'[]'::jsonb)
  into existing_targets
  from public.journal_entry_best_friend_targets target
  where target.journal_entry_id=p_entry_id;
  select (target->>'dogId')::uuid into legacy_projection
  from jsonb_array_elements(normalized_targets) with ordinality selected(target,ordinal)
  where target->>'type'='DOG' order by ordinal limit 1;

  if row_before.condition_codes is not distinct from normalized_conditions
    and row_before.urination is not distinct from p_urination
    and row_before.defecation is not distinct from p_defecation
    and row_before.stool_condition is not distinct from normalized_stool
    and row_before.meal_codes is not distinct from normalized_meals
    and row_before.teacher_relationship is not distinct from p_teacher_relationship
    and row_before.friend_relationship is not distinct from p_friend_relationship
    and existing_targets is not distinct from normalized_targets
    and row_before.best_friend_dog_id is not distinct from legacy_projection
    and row_before.manners_activity_name is not distinct from normalized_manners
    and row_before.manners_evaluation is not distinct from p_manners_evaluation
    and row_before.physical_activity_name is not distinct from normalized_physical
    and row_before.physical_evaluation is not distinct from p_physical_evaluation
    and row_before.teacher_comment is not distinct from normalized_comment then
    return public.journal_entry_json_internal(p_entry_id);
  end if;

  before_payload:=public.journal_entry_json_internal(p_entry_id);
  update public.journal_entries set
    condition_codes=normalized_conditions,urination=p_urination,defecation=p_defecation,
    stool_condition=normalized_stool,meal_codes=normalized_meals,
    teacher_relationship=p_teacher_relationship,friend_relationship=p_friend_relationship,
    best_friend_dog_id=legacy_projection,manners_activity_name=normalized_manners,
    manners_evaluation=p_manners_evaluation,physical_activity_name=normalized_physical,
    physical_evaluation=p_physical_evaluation,teacher_comment=normalized_comment,
    status=case when status='not_started' then 'in_progress' else status end,
    updated_by=actor_id
  where id=p_entry_id returning * into row_after;
  delete from public.journal_entry_best_friend_targets where journal_entry_id=p_entry_id;
  insert into public.journal_entry_best_friend_targets(
    journal_entry_id,target_type,dog_id,sort_order,created_by
  )
  select p_entry_id,target->>'type',
    case when target->>'type'='DOG' then (target->>'dogId')::uuid else null end,
    ordinal-1,actor_id
  from jsonb_array_elements(normalized_targets) with ordinality selected(target,ordinal);
  if row_after.status='completed' then perform public.validate_journal_entry_completion_internal(row_after); end if;
  result:=public.journal_entry_json_internal(p_entry_id);
  insert into public.entity_audit_events(module_code,entity_type,entity_id,action,before_data,after_data,changed_by,change_reason,request_id)
  values('journal','journal_entries',p_entry_id,'updated',before_payload,
    jsonb_build_object('request',request_payload,'entry',result),actor_id,
    case when row_before.status='completed' then 'Journal completed entry updated' else 'Journal draft updated' end,p_request_id);
  return result;
end;
$$;

create or replace function public.update_journal_entry_draft(
  p_entry_id uuid,p_expected_version integer,p_condition_codes text[],p_urination boolean,
  p_defecation boolean,p_stool_condition text,p_meal_codes text[],p_teacher_relationship text,
  p_friend_relationship text,p_best_friend_dog_id uuid,p_manners_activity_name text,
  p_manners_evaluation text,p_physical_activity_name text,p_physical_evaluation text,
  p_teacher_comment text,p_request_id uuid
)
returns jsonb language plpgsql security definer
set search_path=public,pg_temp
as $$
declare
  actor_id uuid:=auth.uid();
  replay_targets jsonb;
  effective_targets jsonb;
  canonical_target_count integer;
  canonical_has_teacher boolean;
begin
  if actor_id is null or not public.is_active_operation_member() then
    raise exception '일지를 작성할 권한이 없습니다.' using errcode='42501';
  end if;
  if p_entry_id is null or p_expected_version is null or p_request_id is null then
    raise exception '일지 항목, 버전, 요청 ID가 필요합니다.' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
  select audit.after_data->'request'->'bestFriendTargets' into replay_targets
  from public.entity_audit_events audit
  where audit.module_code='journal' and audit.entity_type='journal_entries'
    and audit.entity_id=p_entry_id and audit.request_id=p_request_id
    and audit.change_reason in ('Journal draft updated','Journal completed entry updated')
  order by audit.created_at desc,audit.id desc limit 1;
  if found then
    effective_targets:=replay_targets;
  else
    perform 1 from public.journal_entries where id=p_entry_id for update;
    if not found then raise exception '일지 항목을 찾을 수 없습니다.' using errcode='P0002'; end if;
    select count(*),coalesce(bool_or(target.target_type='TEACHER'),false)
    into canonical_target_count,canonical_has_teacher
    from public.journal_entry_best_friend_targets target
    where target.journal_entry_id=p_entry_id;
    if canonical_target_count>1 or canonical_has_teacher then
      raise exception '최신 제일 친한 친구 정보를 다시 불러온 뒤 저장해 주세요.' using errcode='PT409';
    end if;
    effective_targets:=case when p_best_friend_dog_id is null then '[]'::jsonb
      else jsonb_build_array(jsonb_build_object('type','DOG','dogId',p_best_friend_dog_id)) end;
  end if;
  return public.update_journal_entry_draft_v2(
    p_entry_id,p_expected_version,p_condition_codes,p_urination,p_defecation,p_stool_condition,
    p_meal_codes,p_teacher_relationship,p_friend_relationship,effective_targets,
    p_manners_activity_name,p_manners_evaluation,p_physical_activity_name,
    p_physical_evaluation,p_teacher_comment,p_request_id
  );
end;
$$;

create or replace function public.remove_journal_roster_entry(
  p_entry_id uuid,p_expected_version integer,p_request_id uuid
)
returns jsonb language plpgsql security definer
set search_path=public,pg_temp
as $$
declare
  actor_id uuid:=auth.uid();
  row_before public.journal_entries%rowtype;
  dependent_before public.journal_entries%rowtype;
  dependent_version_after integer;
  business_date_value date;
  request_contract jsonb;
  replay_event public.entity_audit_events%rowtype;
  deleted_count integer;
  before_targets jsonb;
  after_targets jsonb;
  next_legacy_projection uuid;
begin
  if actor_id is null or not public.is_active_operation_member() then
    raise exception '일지를 삭제할 권한이 없습니다.' using errcode='42501';
  end if;
  if p_entry_id is null or p_expected_version is null or p_request_id is null then
    raise exception '일지 항목, 버전, 요청 ID가 필요합니다.' using errcode='22023';
  end if;
  request_contract:=jsonb_build_object('entryId',p_entry_id,'expectedVersion',p_expected_version);
  perform pg_advisory_xact_lock(hashtextextended('journal-entry-remove:'||p_request_id::text,0));
  select audit.* into replay_event from public.entity_audit_events audit
  where audit.module_code='journal' and audit.entity_type='journal_entries'
    and audit.action='archived' and audit.request_id=p_request_id
  order by audit.created_at desc,audit.id desc limit 1;
  if found then
    if replay_event.entity_id is distinct from p_entry_id
      or replay_event.after_data->'request' is distinct from request_contract
      or nullif(replay_event.after_data->>'businessDate','') is null then
      raise exception '요청 ID가 다른 일지 삭제에 이미 사용되었습니다.' using errcode='22023';
    end if;
    return public.get_journal_roster((replay_event.after_data->>'businessDate')::date);
  end if;
  select * into row_before from public.journal_entries where id=p_entry_id for update;
  if not found then raise exception '일지 항목을 찾을 수 없습니다.' using errcode='P0002'; end if;
  if row_before.version<>p_expected_version then
    raise exception '다른 사용자가 먼저 변경했습니다.' using errcode='PT409';
  end if;
  select day.business_date into business_date_value from public.journal_days day where day.id=row_before.journal_day_id;
  if business_date_value is null then raise exception '일지 날짜를 찾을 수 없습니다.' using errcode='P0002'; end if;

  for dependent_before in
    select dependent.* from public.journal_entries dependent
    where dependent.journal_day_id=row_before.journal_day_id
      and dependent.id<>row_before.id
      and exists(
        select 1 from public.journal_entry_best_friend_targets target
        where target.journal_entry_id=dependent.id
          and target.target_type='DOG' and target.dog_id=row_before.dog_id
      )
    order by dependent.id for update
  loop
    select coalesce(jsonb_agg(jsonb_build_object('type',target.target_type,'dogId',target.dog_id)
      order by target.sort_order,target.id),'[]'::jsonb)
    into before_targets from public.journal_entry_best_friend_targets target
    where target.journal_entry_id=dependent_before.id;
    delete from public.journal_entry_best_friend_targets target
    where target.journal_entry_id=dependent_before.id
      and target.target_type='DOG' and target.dog_id=row_before.dog_id;
    select target.dog_id into next_legacy_projection
    from public.journal_entry_best_friend_targets target
    where target.journal_entry_id=dependent_before.id and target.target_type='DOG'
    order by target.sort_order,target.id limit 1;
    update public.journal_entries set best_friend_dog_id=next_legacy_projection,updated_by=actor_id
    where id=dependent_before.id returning version into dependent_version_after;
    select coalesce(jsonb_agg(jsonb_build_object('type',target.target_type,'dogId',target.dog_id)
      order by target.sort_order,target.id),'[]'::jsonb)
    into after_targets from public.journal_entry_best_friend_targets target
    where target.journal_entry_id=dependent_before.id;
    insert into public.entity_audit_events(
      module_code,entity_type,entity_id,action,before_data,after_data,changed_by,change_reason,request_id
    ) values(
      'journal','journal_entries',dependent_before.id,'updated',
      jsonb_build_object('journalDayId',dependent_before.journal_day_id,'dogId',dependent_before.dog_id,
        'bestFriendTargets',before_targets,'version',dependent_before.version,'status',dependent_before.status),
      jsonb_build_object('journalDayId',dependent_before.journal_day_id,'dogId',dependent_before.dog_id,
        'bestFriendTargets',after_targets,'version',dependent_version_after,'status',dependent_before.status,
        'removedRosterDogId',row_before.dog_id),
      actor_id,'best_friend_roster_member_removed',p_request_id
    );
  end loop;

  insert into public.entity_audit_events(
    module_code,entity_type,entity_id,action,before_data,after_data,changed_by,change_reason,request_id
  ) values(
    'journal','journal_entries',p_entry_id,'archived',to_jsonb(row_before),
    jsonb_build_object('request',request_contract,'businessDate',business_date_value,
      'journalDayId',row_before.journal_day_id,'dogId',row_before.dog_id,'statusBeforeDelete',row_before.status),
    actor_id,'journal_entry_delete',p_request_id
  );
  delete from public.journal_entries where id=p_entry_id;
  get diagnostics deleted_count=row_count;
  if deleted_count<>1 then raise exception '일지 삭제 대상이 정확히 1건이 아닙니다.' using errcode='P0001'; end if;
  return public.get_journal_roster(business_date_value);
end;
$$;

revoke all on function public.update_journal_entry_draft_v2(uuid,integer,text[],boolean,boolean,text,text[],text,text,jsonb,text,text,text,text,text,uuid) from public,anon;
grant execute on function public.update_journal_entry_draft_v2(uuid,integer,text[],boolean,boolean,text,text[],text,text,jsonb,text,text,text,text,text,uuid) to authenticated,service_role;
revoke all on function public.update_journal_entry_draft(uuid,integer,text[],boolean,boolean,text,text[],text,text,uuid,text,text,text,text,text,uuid) from public,anon;
grant execute on function public.update_journal_entry_draft(uuid,integer,text[],boolean,boolean,text,text[],text,text,uuid,text,text,text,text,text,uuid) to authenticated,service_role;
revoke all on function public.remove_journal_roster_entry(uuid,integer,uuid) from public,anon;
grant execute on function public.remove_journal_roster_entry(uuid,integer,uuid) to authenticated,service_role;

comment on table public.journal_entry_best_friend_targets is
  'Canonical ordered Best Friend targets for one Journal entry. DOG and TEACHER are explicit domain targets; maximum five.';
comment on function public.update_journal_entry_draft_v2(uuid,integer,text[],boolean,boolean,text,text[],text,text,jsonb,text,text,text,text,text,uuid) is
  'Atomically saves a Journal draft and canonical ordered Best Friend targets with optimistic versioning, idempotency, and audit evidence.';
comment on function public.update_journal_entry_draft(uuid,integer,text[],boolean,boolean,text,text[],text,text,uuid,text,text,text,text,text,uuid) is
  'Fail-closed compatibility bridge: legacy saves may update only empty or single-Dog canonical targets; multi-target or Teacher state requires a V2 reload and remains unchanged.';
comment on function public.remove_journal_roster_entry(uuid,integer,uuid) is
  'Deletes one Journal roster entry and atomically removes only that Dog from dependent V2 Best Friend targets, preserving other Dogs, Teacher, status, and business records.';

commit;
