\set ON_ERROR_STOP on
begin read only;

do $$
declare
  release_ref text:=current_setting('app.release_project_ref',true);
  release_sha text:=current_setting('app.release_migration_sha256',true);
  legacy_count bigint;
  stale_count bigint;
begin
  if release_ref is distinct from 'zorvcuskzemehblqdbfj' then
    raise exception 'STOP_JOURNAL_BEST_FRIEND_V2_PRODUCTION_TARGET';
  end if;
  if release_ref='wxbvwixoeczfvbqurdse' then
    raise exception 'STOP_JOURNAL_BEST_FRIEND_V2_CLEAN_QA_REJECT';
  end if;
  if release_sha is distinct from '24e549cc8381a0c73b7ddf2fe50e6af1f888544b49fbcadf3fd433b0e5ccbc6d' then
    raise exception 'STOP_JOURNAL_BEST_FRIEND_V2_MIGRATION_SHA';
  end if;
  if to_regclass('public.journal_entries') is null
    or to_regclass('public.journal_days') is null
    or to_regclass('public.entity_audit_events') is null
    or to_regprocedure('public.journal_entry_json_internal(uuid)') is null
    or to_regprocedure('public.update_journal_entry_draft(uuid,integer,text[],boolean,boolean,text,text[],text,text,uuid,text,text,text,text,text,uuid)') is null
    or to_regprocedure('public.remove_journal_roster_entry(uuid,integer,uuid)') is null
    or to_regprocedure('public.complete_journal_entry(uuid,integer,uuid)') is null then
    raise exception 'STOP_JOURNAL_BEST_FRIEND_V2_BASELINE_MISSING';
  end if;
  if (select udt_name from information_schema.columns
      where table_schema='public' and table_name='journal_entries' and column_name='best_friend_dog_id')<>'uuid' then
    raise exception 'STOP_JOURNAL_BEST_FRIEND_V2_LEGACY_TYPE';
  end if;
  if not exists(select 1 from pg_trigger where tgrelid='public.journal_entries'::regclass
      and tgname='journal_entries_protect_metadata' and not tgisinternal)
    or to_regprocedure('public.protect_journal_entry_metadata_internal()') is null then
    raise exception 'STOP_JOURNAL_BEST_FRIEND_V2_VERSION_CONTRACT';
  end if;
  if to_regclass('public.journal_entry_best_friend_targets') is not null
    or to_regprocedure('public.update_journal_entry_draft_v2(uuid,integer,text[],boolean,boolean,text,text[],text,text,jsonb,text,text,text,text,text,uuid)') is not null then
    raise exception 'STOP_JOURNAL_BEST_FRIEND_V2_OBJECT_COLLISION';
  end if;
  select count(*) into legacy_count from public.journal_entries where best_friend_dog_id is not null;
  select count(*) into stale_count from public.journal_entries source
  where source.best_friend_dog_id is not null and not exists(
    select 1 from public.journal_entries friend
    where friend.journal_day_id=source.journal_day_id
      and friend.dog_id=source.best_friend_dog_id and friend.id<>source.id
  );
  if stale_count<>0 then raise exception 'STOP_JOURNAL_BEST_FRIEND_V2_STALE_LEGACY_REFERENCE'; end if;
  if has_table_privilege('authenticated','public.journal_entries','INSERT,UPDATE,DELETE') then
    raise exception 'STOP_JOURNAL_BEST_FRIEND_V2_DIRECT_MUTATION_BASELINE';
  end if;
  raise notice 'legacy_best_friend_count=%',legacy_count;
end;
$$;

select 'READY_TO_APPLY_JOURNAL_BEST_FRIEND_V2' as status;
rollback;
