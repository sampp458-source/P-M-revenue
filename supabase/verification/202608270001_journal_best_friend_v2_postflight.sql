\set ON_ERROR_STOP on
begin read only;

do $$
declare
  release_ref text:=current_setting('app.release_project_ref',true);
  release_sha text:=current_setting('app.release_migration_sha256',true);
  save_source text;
  legacy_source text;
  remove_source text;
  json_source text;
  save_contract text;
  legacy_contract text;
  remove_contract text;
  json_contract text;
  execute_grantees text[];
begin
  if release_ref is distinct from 'zorvcuskzemehblqdbfj' or release_ref='wxbvwixoeczfvbqurdse' then
    raise exception 'STOP_JOURNAL_BEST_FRIEND_V2_PRODUCTION_TARGET';
  end if;
  if release_sha is distinct from '24e549cc8381a0c73b7ddf2fe50e6af1f888544b49fbcadf3fd433b0e5ccbc6d' then
    raise exception 'STOP_JOURNAL_BEST_FRIEND_V2_MIGRATION_SHA';
  end if;
  if to_regclass('public.journal_entry_best_friend_targets') is null
    or to_regprocedure('public.update_journal_entry_draft_v2(uuid,integer,text[],boolean,boolean,text,text[],text,text,jsonb,text,text,text,text,text,uuid)') is null then
    raise exception 'STOP_JOURNAL_BEST_FRIEND_V2_OBJECTS';
  end if;
  if (select count(*) from pg_constraint where conrelid='public.journal_entry_best_friend_targets'::regclass
      and conname in ('journal_entry_best_friend_targets_semantics','journal_entry_best_friend_targets_entry_order_unique'))<>2
    or (select count(*) from pg_indexes where schemaname='public' and tablename='journal_entry_best_friend_targets'
      and indexname in ('journal_entry_best_friend_targets_dog_unique','journal_entry_best_friend_targets_teacher_unique',
        'journal_entry_best_friend_targets_entry_idx','journal_entry_best_friend_targets_dog_idx'))<>4 then
    raise exception 'STOP_JOURNAL_BEST_FRIEND_V2_CONSTRAINT_INDEX';
  end if;
  if not (select relrowsecurity from pg_class where oid='public.journal_entry_best_friend_targets'::regclass)
    or (select count(*) from pg_policies where schemaname='public' and tablename='journal_entry_best_friend_targets'
      and policyname='journal_entry_best_friend_targets_select_active_member')<>1 then
    raise exception 'STOP_JOURNAL_BEST_FRIEND_V2_RLS';
  end if;
  if has_table_privilege('authenticated','public.journal_entry_best_friend_targets','INSERT,UPDATE,DELETE')
    or not has_table_privilege('authenticated','public.journal_entry_best_friend_targets','SELECT') then
    raise exception 'STOP_JOURNAL_BEST_FRIEND_V2_TABLE_ACL';
  end if;
  if exists(select 1 from public.journal_entry_best_friend_targets
      where (target_type='DOG')<>(dog_id is not null) or sort_order not between 0 and 4)
    or exists(select journal_entry_id,dog_id from public.journal_entry_best_friend_targets where target_type='DOG'
      group by journal_entry_id,dog_id having count(*)>1)
    or exists(select journal_entry_id from public.journal_entry_best_friend_targets where target_type='TEACHER'
      group by journal_entry_id having count(*)>1)
    or exists(select journal_entry_id from public.journal_entry_best_friend_targets group by journal_entry_id having count(*)>5) then
    raise exception 'STOP_JOURNAL_BEST_FRIEND_V2_TARGET_INVARIANT';
  end if;
  if exists(
    select 1 from public.journal_entry_best_friend_targets target
    join public.journal_entries source on source.id=target.journal_entry_id
    where target.target_type='DOG' and (target.dog_id=source.dog_id or not exists(
      select 1 from public.journal_entries friend
      where friend.journal_day_id=source.journal_day_id and friend.dog_id=target.dog_id and friend.id<>source.id
    ))
  ) then raise exception 'STOP_JOURNAL_BEST_FRIEND_V2_ROSTER_INVARIANT'; end if;
  if exists(
    select 1 from public.journal_entries entry
    where entry.best_friend_dog_id is distinct from (
      select target.dog_id from public.journal_entry_best_friend_targets target
      where target.journal_entry_id=entry.id and target.target_type='DOG'
      order by target.sort_order,target.id limit 1
    )
  ) then raise exception 'STOP_JOURNAL_BEST_FRIEND_V2_LEGACY_PROJECTION'; end if;

  select pg_get_functiondef('public.update_journal_entry_draft_v2(uuid,integer,text[],boolean,boolean,text,text[],text,text,jsonb,text,text,text,text,text,uuid)'::regprocedure) into save_source;
  select pg_get_functiondef('public.update_journal_entry_draft(uuid,integer,text[],boolean,boolean,text,text[],text,text,uuid,text,text,text,text,text,uuid)'::regprocedure) into legacy_source;
  select pg_get_functiondef('public.remove_journal_roster_entry(uuid,integer,uuid)'::regprocedure) into remove_source;
  select pg_get_functiondef('public.journal_entry_json_internal(uuid)'::regprocedure) into json_source;
  save_contract:=regexp_replace(lower(save_source),'[[:space:]]+','','g');
  legacy_contract:=regexp_replace(lower(legacy_source),'[[:space:]]+','','g');
  remove_contract:=regexp_replace(lower(remove_source),'[[:space:]]+','','g');
  json_contract:=regexp_replace(lower(json_source),'[[:space:]]+','','g');
  if position('is_active_operation_member()' in save_contract)=0
    or position('forupdate' in save_contract)=0
    or position('errcode=''pt409''' in save_contract)=0
    or position('bestfriendtargets' in save_contract)=0
    or position('deletefrompublic.journal_entry_best_friend_targets' in save_contract)=0
    or position('insertintopublic.journal_entry_best_friend_targets' in save_contract)=0
    or position('journaldraftupdated' in save_contract)=0
    or position('journalcompletedentryupdated' in save_contract)=0
    or position('entity_audit_events' in save_contract)=0 then
    raise exception 'STOP_JOURNAL_BEST_FRIEND_V2_SAVE_CONTRACT';
  end if;
  if position('update_journal_entry_draft_v2' in legacy_contract)=0
    or position('canonical_target_count>1orcanonical_has_teacher' in legacy_contract)=0
    or position('errcode=''pt409''' in legacy_contract)=0
    or position('replay_targets' in legacy_contract)=0
    or position('pg_advisory_xact_lock' in legacy_contract)=0
    or position('forupdate' in legacy_contract)=0 then
    raise exception 'STOP_JOURNAL_BEST_FRIEND_V2_LEGACY_BRIDGE_CONTRACT';
  end if;
  if position('bestfriendtargets' in json_contract)=0
    or position('journal_entry_best_friend_targets' in json_contract)=0
    or position('orderbytarget.sort_order,target.id' in json_contract)=0 then
    raise exception 'STOP_JOURNAL_BEST_FRIEND_V2_READ_CONTRACT';
  end if;
  if position('best_friend_roster_member_removed' in remove_contract)=0
    or position('target.target_type=''dog''' in remove_contract)=0
    or position('target.dog_id=row_before.dog_id' in remove_contract)=0
    or position('best_friend_dog_id=next_legacy_projection' in remove_contract)=0
    or position('updated_by=actor_id' in remove_contract)=0
    or position('dependent_version_after' in remove_contract)=0
    or position('journal_entry_delete' in remove_contract)=0
    or position('deletefrompublic.journal_days' in remove_contract)>0
    or position('deletefrompublic.dogs' in remove_contract)>0
    or position('deletefrompublic.customers' in remove_contract)>0 then
    raise exception 'STOP_JOURNAL_BEST_FRIEND_V2_DELETE_CONTRACT';
  end if;
  select array_agg(grantee order by grantee) into execute_grantees
  from information_schema.routine_privileges
  where specific_schema='public' and routine_name='update_journal_entry_draft_v2' and privilege_type='EXECUTE';
  if execute_grantees is distinct from array['authenticated','postgres','service_role']::text[] then
    raise exception 'STOP_JOURNAL_BEST_FRIEND_V2_RPC_ACL';
  end if;
end;
$$;

select 'JOURNAL_BEST_FRIEND_V2_READY' as status;
rollback;
