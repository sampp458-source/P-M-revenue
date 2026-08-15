-- Production Journal Editor migration
-- Embedded source: supabase/migrations/202608150002_journal_v1_editor.sql
-- Embedded source SHA-256: 497fbd16f349212405b2ba22d3388d00ac55423070698ebd9fc3a29a5a0ccff1
begin read only;
select set_config('app.release_project_ref','zorvcuskzemehblqdbfj',true);
select set_config('app.release_migration_sha256','497fbd16f349212405b2ba22d3388d00ac55423070698ebd9fc3a29a5a0ccff1',true);
do $$ begin
  if current_setting('app.release_project_ref',true) is distinct from 'zorvcuskzemehblqdbfj'
    or current_setting('app.release_project_ref',true)='wxbvwixoeczfvbqurdse'
    or current_setting('app.release_migration_sha256',true) is distinct from '497fbd16f349212405b2ba22d3388d00ac55423070698ebd9fc3a29a5a0ccff1'
    or current_database()<>'postgres' or current_user<>'postgres'
    or to_regclass('hotel_qa.environment_guard') is not null then
    raise exception 'STOP_JOURNAL_EDITOR_PRODUCTION_BINDING';
  end if;
end $$;
rollback;
-- P&M Journal V1 Phase 2: typed editor, ordered draft autosave, and completion.
begin;

do $$
begin
  if to_regclass('public.journal_entries') is null
    or to_regprocedure('public.journal_entry_json_internal(uuid)') is null
    or to_regprocedure('public.get_journal_roster(date)') is null
    or to_regprocedure('public.is_active_operation_member()') is null then
    raise exception 'STOP_JOURNAL_EDITOR_BASELINE_MISSING';
  end if;
  if to_regprocedure('public.update_journal_entry_draft(uuid,integer,text[],boolean,boolean,text,text[],text,text,uuid,text,text,text,text,text,uuid)') is not null
    or to_regprocedure('public.complete_journal_entry(uuid,integer,uuid)') is not null
    or to_regprocedure('public.get_journal_entry(uuid)') is not null then
    raise exception 'STOP_JOURNAL_EDITOR_ALREADY_APPLIED';
  end if;
  if exists(select 1 from public.journal_entries where char_length(coalesce(teacher_comment,''))>500) then
    raise exception 'STOP_JOURNAL_EDITOR_COMMENT_BASELINE';
  end if;
end;
$$;

alter table public.journal_entries
  add constraint journal_entries_teacher_comment_length
  check (teacher_comment is null or char_length(teacher_comment)<=500);

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

create function public.get_journal_entry(p_entry_id uuid)
returns jsonb language sql stable security definer
set search_path=public,pg_temp
as $$
  select public.journal_entry_json_internal(p_entry_id);
$$;

create function public.validate_journal_entry_completion_internal(p_entry public.journal_entries)
returns void language plpgsql stable security definer
set search_path=public,pg_temp
as $$
begin
  if cardinality(p_entry.condition_codes)<1
    or p_entry.urination is null
    or p_entry.defecation is null
    or (p_entry.defecation and p_entry.stool_condition is null)
    or p_entry.teacher_relationship is null
    or p_entry.friend_relationship is null
    or nullif(btrim(coalesce(p_entry.teacher_comment,'')),'') is null then
    raise exception '필수 일지 내용을 모두 입력해 주세요.' using errcode='22023';
  end if;
  if (nullif(btrim(coalesce(p_entry.manners_activity_name,'')),'') is null)
       <> (p_entry.manners_evaluation is null)
    or (nullif(btrim(coalesce(p_entry.physical_activity_name,'')),'') is null)
       <> (p_entry.physical_evaluation is null) then
    raise exception '활동명과 평가는 함께 입력해 주세요.' using errcode='22023';
  end if;
end;
$$;

create function public.update_journal_entry_draft(
  p_entry_id uuid,
  p_expected_version integer,
  p_condition_codes text[],
  p_urination boolean,
  p_defecation boolean,
  p_stool_condition text,
  p_meal_codes text[],
  p_teacher_relationship text,
  p_friend_relationship text,
  p_best_friend_dog_id uuid,
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

  request_payload:=jsonb_build_object(
    'entryId',p_entry_id,'conditionCodes',normalized_conditions,'urination',p_urination,
    'defecation',p_defecation,'stoolCondition',normalized_stool,'mealCodes',normalized_meals,
    'teacherRelationship',p_teacher_relationship,'friendRelationship',p_friend_relationship,
    'bestFriendDogId',p_best_friend_dog_id,'mannersActivityName',normalized_manners,
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
  if p_best_friend_dog_id=row_before.dog_id then
    raise exception '자기 자신을 제일 친한 친구로 선택할 수 없습니다.' using errcode='22023';
  end if;
  if p_best_friend_dog_id is not null and not exists(
    select 1 from public.journal_entries friend
    where friend.journal_day_id=row_before.journal_day_id and friend.dog_id=p_best_friend_dog_id
  ) then
    raise exception '같은 날 등원 명단의 반려견만 선택할 수 있습니다.' using errcode='22023';
  end if;

  if row_before.condition_codes is not distinct from normalized_conditions
    and row_before.urination is not distinct from p_urination
    and row_before.defecation is not distinct from p_defecation
    and row_before.stool_condition is not distinct from normalized_stool
    and row_before.meal_codes is not distinct from normalized_meals
    and row_before.teacher_relationship is not distinct from p_teacher_relationship
    and row_before.friend_relationship is not distinct from p_friend_relationship
    and row_before.best_friend_dog_id is not distinct from p_best_friend_dog_id
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
    best_friend_dog_id=p_best_friend_dog_id,manners_activity_name=normalized_manners,
    manners_evaluation=p_manners_evaluation,physical_activity_name=normalized_physical,
    physical_evaluation=p_physical_evaluation,teacher_comment=normalized_comment,
    status=case when status='not_started' then 'in_progress' else status end,
    updated_by=actor_id
  where id=p_entry_id returning * into row_after;
  if row_after.status='completed' then perform public.validate_journal_entry_completion_internal(row_after); end if;
  result:=public.journal_entry_json_internal(p_entry_id);
  insert into public.entity_audit_events(module_code,entity_type,entity_id,action,before_data,after_data,changed_by,change_reason,request_id)
  values('journal','journal_entries',p_entry_id,'updated',before_payload,
    jsonb_build_object('request',request_payload,'entry',result),actor_id,
    case when row_before.status='completed' then 'Journal completed entry updated' else 'Journal draft updated' end,p_request_id);
  return result;
end;
$$;

create function public.complete_journal_entry(
  p_entry_id uuid,p_expected_version integer,p_request_id uuid
)
returns jsonb language plpgsql security definer
set search_path=public,pg_temp
as $$
declare actor_id uuid:=auth.uid(); row_before public.journal_entries%rowtype;
declare existing_event public.entity_audit_events%rowtype; result jsonb; before_payload jsonb;
begin
  if actor_id is null or not public.is_active_operation_member() then
    raise exception '일지 작성을 완료할 권한이 없습니다.' using errcode='42501';
  end if;
  if p_entry_id is null or p_expected_version is null or p_request_id is null then
    raise exception '일지 항목, 버전, 요청 ID가 필요합니다.' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
  select * into existing_event from public.entity_audit_events audit
  where audit.module_code='journal' and audit.entity_type='journal_entries'
    and audit.entity_id=p_entry_id and audit.request_id=p_request_id
    and audit.change_reason='Journal entry completed';
  if found then return existing_event.after_data->'entry'; end if;
  select * into row_before from public.journal_entries where id=p_entry_id for update;
  if not found then raise exception '일지 항목을 찾을 수 없습니다.' using errcode='P0002'; end if;
  if row_before.version<>p_expected_version then raise exception '다른 사용자가 먼저 변경했습니다.' using errcode='PT409'; end if;
  perform public.validate_journal_entry_completion_internal(row_before);
  if row_before.status='completed' then return public.journal_entry_json_internal(p_entry_id); end if;
  before_payload:=public.journal_entry_json_internal(p_entry_id);
  update public.journal_entries set status='completed',updated_by=actor_id where id=p_entry_id;
  result:=public.journal_entry_json_internal(p_entry_id);
  insert into public.entity_audit_events(module_code,entity_type,entity_id,action,before_data,after_data,changed_by,change_reason,request_id)
  values('journal','journal_entries',p_entry_id,'updated',before_payload,
    jsonb_build_object('request',jsonb_build_object('entryId',p_entry_id),'entry',result),
    actor_id,'Journal entry completed',p_request_id);
  return result;
end;
$$;

create or replace function public.set_journal_entry_status(
  p_entry_id uuid,p_expected_version integer,p_status text,p_request_id uuid
)
returns jsonb language plpgsql security definer
set search_path=public,pg_temp
as $$
declare actor_id uuid:=auth.uid(); row_before public.journal_entries%rowtype; result jsonb;
begin
  if actor_id is null or not public.is_active_operation_member() then raise exception '일지 상태를 변경할 권한이 없습니다.' using errcode='42501'; end if;
  if p_request_id is null or p_status not in ('not_started','in_progress','completed') then raise exception '유효한 일지 상태와 요청 ID가 필요합니다.' using errcode='22023'; end if;
  select * into row_before from public.journal_entries where id=p_entry_id for update;
  if not found then raise exception '일지 항목을 찾을 수 없습니다.' using errcode='P0002'; end if;
  if row_before.version<>p_expected_version then raise exception '다른 사용자가 먼저 변경했습니다.' using errcode='PT409'; end if;
  if p_status='completed' then perform public.validate_journal_entry_completion_internal(row_before); end if;
  update public.journal_entries set status=p_status,updated_by=actor_id where id=p_entry_id;
  result:=public.journal_entry_json_internal(p_entry_id);
  insert into public.entity_audit_events(module_code,entity_type,entity_id,action,before_data,after_data,changed_by,change_reason,request_id)
  values('journal','journal_entries',p_entry_id,'updated',to_jsonb(row_before),result,actor_id,'Journal status changed',p_request_id);
  return result;
end;
$$;

revoke all on function public.validate_journal_entry_completion_internal(public.journal_entries)
  from public,anon,authenticated,service_role;
do $$ declare signature text; begin
  foreach signature in array array[
    'public.get_journal_entry(uuid)',
    'public.update_journal_entry_draft(uuid,integer,text[],boolean,boolean,text,text[],text,text,uuid,text,text,text,text,text,uuid)',
    'public.complete_journal_entry(uuid,integer,uuid)'
  ] loop
    execute format('revoke all on function %s from public,anon',signature);
    execute format('grant execute on function %s to authenticated,service_role',signature);
  end loop;
end $$;

commit;
