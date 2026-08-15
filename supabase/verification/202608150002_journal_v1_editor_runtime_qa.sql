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
create temp table journal_editor_qa_result(scenario text primary key,result text not null) on commit drop;

do $$
declare actor_id uuid:=auth.uid(); day_value date:=(clock_timestamp() at time zone 'Asia/Seoul')::date;
declare dog_ids uuid[]; entry_ids uuid[]; roster jsonb; result jsonb; version_value integer; stale_version integer;
declare replay_request uuid:=gen_random_uuid(); audit_before integer; audit_after integer;
begin
  select array_agg(id order by id) into dog_ids from (
    select dog.id from public.dogs dog join public.customers customer on customer.id=dog.customer_id
    where dog.is_active and customer.is_active order by dog.created_at,dog.id limit 4
  ) dogs;
  if actor_id is null or cardinality(dog_ids)<>4 then raise exception 'STOP_JOURNAL_EDITOR_QA_FIXTURE'; end if;
  roster:=public.register_journal_roster(day_value,dog_ids[1:3],gen_random_uuid());
  select array_agg(entry.id order by entry.created_at,entry.id) into entry_ids
  from public.journal_entries entry join public.journal_days day on day.id=entry.journal_day_id
  where day.business_date=day_value;
  result:=public.get_journal_entry(entry_ids[1]);
  if result->>'status'<>'NOT_STARTED' then raise exception 'STOP_EDITOR_A'; end if;
  insert into journal_editor_qa_result values('A_NOT_STARTED_LOAD','PASS');
  select count(*) into audit_before from public.entity_audit_events where module_code='journal';

  version_value:=(result->>'version')::integer;
  result:=public.update_journal_entry_draft(entry_ids[1],version_value,array['active'],null,null,null,'{}',null,null,null,null,null,null,null,null,gen_random_uuid());
  if result->>'status'<>'IN_PROGRESS' then raise exception 'STOP_EDITOR_B'; end if;
  insert into journal_editor_qa_result values('B_FIRST_MUTATION_IN_PROGRESS','PASS');

  version_value:=(result->>'version')::integer;
  result:=public.update_journal_entry_draft(entry_ids[1],version_value,array['active','calm'],null,null,null,'{}',null,null,null,null,null,null,null,null,gen_random_uuid());
  if jsonb_array_length(result->'conditionCodes')<>2 then raise exception 'STOP_EDITOR_C'; end if;
  insert into journal_editor_qa_result values('C_MULTI_CONDITION','PASS');

  version_value:=(result->>'version')::integer;
  result:=public.update_journal_entry_draft(entry_ids[1],version_value,array['active','calm'],true,null,null,'{}',null,null,null,null,null,null,null,null,gen_random_uuid());
  if (result->>'urination')::boolean is not true then raise exception 'STOP_EDITOR_D'; end if;
  insert into journal_editor_qa_result values('D_URINATION','PASS');

  version_value:=(result->>'version')::integer;
  result:=public.update_journal_entry_draft(entry_ids[1],version_value,array['active','calm'],true,false,'good','{}',null,null,null,null,null,null,null,null,gen_random_uuid());
  if result->'stoolCondition'<>'null'::jsonb then raise exception 'STOP_EDITOR_E'; end if;
  insert into journal_editor_qa_result values('E_DEFECATION_NO_STOOL_NULL','PASS');

  version_value:=(result->>'version')::integer;
  result:=public.update_journal_entry_draft(entry_ids[1],version_value,array['active','calm'],true,true,'good','{}',null,null,null,null,null,null,null,null,gen_random_uuid());
  if result->>'stoolCondition'<>'good' then raise exception 'STOP_EDITOR_F'; end if;
  insert into journal_editor_qa_result values('F_DEFECATION_YES_STOOL','PASS');

  version_value:=(result->>'version')::integer;
  result:=public.update_journal_entry_draft(entry_ids[1],version_value,array['active','calm'],true,true,'good',array['brought_food','daycare_snack'],null,null,null,null,null,null,null,null,gen_random_uuid());
  if jsonb_array_length(result->'mealCodes')<>2 then raise exception 'STOP_EDITOR_G'; end if;
  insert into journal_editor_qa_result values('G_MULTI_MEALS','PASS');

  version_value:=(result->>'version')::integer;
  result:=public.update_journal_entry_draft(entry_ids[1],version_value,array['active','calm'],true,true,'good',array['brought_food','daycare_snack'],'loves_teacher',null,null,null,null,null,null,null,gen_random_uuid());
  insert into journal_editor_qa_result values('H_TEACHER_RELATIONSHIP','PASS');
  version_value:=(result->>'version')::integer;
  result:=public.update_journal_entry_draft(entry_ids[1],version_value,array['active','calm'],true,true,'good',array['brought_food','daycare_snack'],'loves_teacher','loves_friends',null,null,null,null,null,null,gen_random_uuid());
  insert into journal_editor_qa_result values('I_FRIEND_RELATIONSHIP','PASS');

  version_value:=(result->>'version')::integer;
  result:=public.update_journal_entry_draft(entry_ids[1],version_value,array['active','calm'],true,true,'good',array['brought_food','daycare_snack'],'loves_teacher','loves_friends',dog_ids[2],null,null,null,null,null,gen_random_uuid());
  if (result->>'bestFriendDogId')::uuid<>dog_ids[2] then raise exception 'STOP_EDITOR_J'; end if;
  insert into journal_editor_qa_result values('J_SAME_ROSTER_BEST_FRIEND','PASS');

  begin
    perform public.update_journal_entry_draft(entry_ids[1],(result->>'version')::integer,array['active'],true,true,'good','{}','loves_teacher','loves_friends',dog_ids[1],null,null,null,null,'메모',gen_random_uuid());
    raise exception 'STOP_EDITOR_K_NOT_REJECTED';
  exception when invalid_parameter_value then null; end;
  insert into journal_editor_qa_result values('K_SELF_BEST_FRIEND_REJECT','PASS');
  begin
    perform public.update_journal_entry_draft(entry_ids[1],(result->>'version')::integer,array['active'],true,true,'good','{}','loves_teacher','loves_friends',dog_ids[4],null,null,null,null,'메모',gen_random_uuid());
    raise exception 'STOP_EDITOR_L_NOT_REJECTED';
  exception when invalid_parameter_value then null; end;
  insert into journal_editor_qa_result values('L_NON_ROSTER_BEST_FRIEND_REJECT','PASS');

  version_value:=(result->>'version')::integer;
  result:=public.update_journal_entry_draft(entry_ids[1],version_value,array['active','calm'],true,true,'good',array['brought_food','daycare_snack'],'loves_teacher','loves_friends',dog_ids[2],'기다려','excellent',null,null,null,gen_random_uuid());
  insert into journal_editor_qa_result values('M_MANNERS_PAIR','PASS');
  version_value:=(result->>'version')::integer;
  result:=public.update_journal_entry_draft(entry_ids[1],version_value,array['active','calm'],true,true,'good',array['brought_food','daycare_snack'],'loves_teacher','loves_friends',dog_ids[2],'기다려','excellent','공놀이','champion',null,gen_random_uuid());
  insert into journal_editor_qa_result values('N_PHYSICAL_PAIR','PASS');

  stale_version:=(result->>'version')::integer;
  result:=public.update_journal_entry_draft(entry_ids[1],stale_version,array['active','calm'],true,true,'good',array['brought_food','daycare_snack'],'loves_teacher','loves_friends',dog_ids[2],'기다려','excellent','공놀이','champion','오늘도 즐겁게 지냈어요.',replay_request);
  if result->>'teacherComment'<>'오늘도 즐겁게 지냈어요.' then raise exception 'STOP_EDITOR_O'; end if;
  insert into journal_editor_qa_result values('O_TEACHER_COMMENT','PASS');
  if (result->>'version')::integer<>stale_version+1 then raise exception 'STOP_EDITOR_P'; end if;
  insert into journal_editor_qa_result values('P_VERSION_INCREMENT','PASS');
  begin
    perform public.update_journal_entry_draft(entry_ids[1],stale_version,array['active'],true,true,'good','{}','loves_teacher','loves_friends',null,null,null,null,null,'다른 저장',gen_random_uuid());
    raise exception 'STOP_EDITOR_Q_NOT_REJECTED';
  exception when sqlstate 'PT409' then null; end;
  insert into journal_editor_qa_result values('Q_STALE_VERSION_PT409','PASS');
  if (public.update_journal_entry_draft(entry_ids[1],stale_version,array['active','calm'],true,true,'good',array['brought_food','daycare_snack'],'loves_teacher','loves_friends',dog_ids[2],'기다려','excellent','공놀이','champion','오늘도 즐겁게 지냈어요.',replay_request)->>'version')::integer<>(result->>'version')::integer then
    raise exception 'STOP_EDITOR_R';
  end if;
  insert into journal_editor_qa_result values('R_REPLAY_IDEMPOTENT','PASS');

  begin
    perform public.complete_journal_entry(entry_ids[2],1,gen_random_uuid());
    raise exception 'STOP_EDITOR_S_NOT_REJECTED';
  exception when invalid_parameter_value then null; end;
  insert into journal_editor_qa_result values('S_INCOMPLETE_COMPLETION_REJECT','PASS');
  result:=public.complete_journal_entry(entry_ids[1],(result->>'version')::integer,gen_random_uuid());
  if result->>'status'<>'COMPLETED' then raise exception 'STOP_EDITOR_T'; end if;
  insert into journal_editor_qa_result values('T_VALID_COMPLETION','PASS');
  roster:=public.get_journal_roster(day_value);
  if (roster->'summary'->>'completed')::integer<>1 then raise exception 'STOP_EDITOR_U'; end if;
  insert into journal_editor_qa_result values('U_SUMMARY_COMPLETED','PASS');
  if public.get_journal_entry(entry_ids[1])->>'status'<>'COMPLETED' then raise exception 'STOP_EDITOR_V'; end if;
  insert into journal_editor_qa_result values('V_COMPLETED_REOPEN','PASS');
  version_value:=(result->>'version')::integer;
  result:=public.update_journal_entry_draft(entry_ids[1],version_value,array['active','calm'],true,true,'good',array['brought_food','daycare_snack'],'loves_teacher','loves_friends',dog_ids[2],'기다려','excellent','공놀이','champion','완료 후 수정한 한마디',gen_random_uuid());
  if result->>'status'<>'COMPLETED' then raise exception 'STOP_EDITOR_W'; end if;
  insert into journal_editor_qa_result values('W_COMPLETED_VALID_EDIT','PASS');
  if jsonb_array_length(roster->'entries')<>3 then raise exception 'STOP_EDITOR_X'; end if;
  insert into journal_editor_qa_result values('X_PREVIOUS_NEXT_ORDER','PASS');

  perform set_config('request.jwt.claim.sub','',true);
  begin
    perform public.get_journal_entry(entry_ids[1]);
    perform public.complete_journal_entry(entry_ids[1],(result->>'version')::integer,gen_random_uuid());
    raise exception 'STOP_EDITOR_Y_NOT_REJECTED';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claim.sub',actor_id::text,true);
  insert into journal_editor_qa_result values('Y_ACTIVE_MEMBER_PERMISSION','PASS');
  select count(*) into audit_after from public.entity_audit_events where module_code='journal';
  if audit_after<=audit_before then raise exception 'STOP_EDITOR_Z'; end if;
  insert into journal_editor_qa_result values('Z_AUDIT','PASS');
end;
$$;

select * from journal_editor_qa_result order by scenario;
do $$ begin if (select count(*) from journal_editor_qa_result)<>26 then raise exception 'STOP_JOURNAL_EDITOR_QA_MATRIX_COUNT'; end if; end $$;
rollback;

do $$
begin
  if exists(select 1 from public.journal_days)
    or exists(select 1 from public.journal_entries)
    or exists(select 1 from public.entity_audit_events where module_code='journal') then
    raise exception 'STOP_JOURNAL_EDITOR_QA_RESIDUE';
  end if;
end;
$$;
select 'AA_QA_RESIDUE_0' scenario,'PASS' result;
select 'JOURNAL_V1_EDITOR_RUNTIME_QA_ROLLED_BACK';
