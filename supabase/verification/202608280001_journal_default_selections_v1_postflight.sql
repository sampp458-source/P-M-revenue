\set ON_ERROR_STOP on
begin read only;

do $$
declare
  register_source text;
  register_contract text;
  legacy_source text;
begin
  if to_regprocedure('public.register_journal_roster_v2(date,uuid[],text,text,integer,uuid)') is null
    or to_regprocedure('public.register_journal_roster(date,uuid[],uuid)') is null then
    raise exception 'STOP_JOURNAL_DEFAULT_SELECTIONS_POSTFLIGHT_RPC';
  end if;
  select lower(pg_get_functiondef(
    'public.register_journal_roster_v2(date,uuid[],text,text,integer,uuid)'::regprocedure
  )) into register_source;
  register_contract:=regexp_replace(register_source,'\s+','','g');
  select lower(regexp_replace(pg_get_functiondef(
    'public.register_journal_roster(date,uuid[],uuid)'::regprocedure
  ),'\s+','','g')) into legacy_source;

  if position('array[''active'']::text[],true,true' in register_contract)=0
    or position('''good'',array[''brought_food'']::text[],''loves_teacher'',''loves_friends''' in register_contract)=0
    or position('casewhenday_row.default_manners_activity_nameisnotnullthen''excellent''elsenullend' in register_contract)=0
    or position('casewhenday_row.default_physical_activity_nameisnotnullthen''champion''elsenullend' in register_contract)=0
    or position('null,day_row.default_manners_activity_name' in register_contract)=0
    or position('null,actor_id,actor_id' in register_contract)=0
    or position('teacher_comment,created_by,updated_by)values(' in register_contract)=0
    or position('onconflict(journal_day_id,dog_id)donothing' in register_contract)=0
    or position('ifinserted_idisnotnullthen' in register_contract)=0
    or position('journalrosterdogadded' in register_contract)=0
    or position('returnpublic.register_journal_roster_v2(' in legacy_source)=0 then
    raise exception 'STOP_JOURNAL_DEFAULT_SELECTIONS_POSTFLIGHT_CREATE_CONTRACT';
  end if;

  if position('updatepublic.journal_entries' in register_contract)>0
    or position('insertintopublic.journal_entry_best_friend_targets' in register_contract)>0
    or coalesce(obj_description(
      'public.register_journal_roster_v2(date,uuid[],text,text,integer,uuid)'::regprocedure,
      'pg_proc'
    ),'') not like '%Journal Default Selections V1%' then
    raise exception 'STOP_JOURNAL_DEFAULT_SELECTIONS_POSTFLIGHT_SCOPE';
  end if;

  if not exists(select 1 from pg_attribute attribute
      join pg_attrdef default_value on default_value.adrelid=attribute.attrelid
        and default_value.adnum=attribute.attnum
      where attribute.attrelid='public.journal_entries'::regclass
        and attribute.attname='status'
        and lower(regexp_replace(pg_get_expr(default_value.adbin,default_value.adrelid),'\s+','','g'))='''not_started''::text')
    or not exists(select 1 from pg_attribute attribute
      join pg_attrdef default_value on default_value.adrelid=attribute.attrelid
        and default_value.adnum=attribute.attnum
      where attribute.attrelid='public.journal_entries'::regclass
        and attribute.attname='version'
        and regexp_replace(pg_get_expr(default_value.adbin,default_value.adrelid),'\s+','','g')='1') then
    raise exception 'STOP_JOURNAL_DEFAULT_SELECTIONS_POSTFLIGHT_DEFAULT_CONTRACT';
  end if;

  if has_function_privilege('public','public.register_journal_roster_v2(date,uuid[],text,text,integer,uuid)','EXECUTE')
    or has_function_privilege('anon','public.register_journal_roster_v2(date,uuid[],text,text,integer,uuid)','EXECUTE')
    or not has_function_privilege('authenticated','public.register_journal_roster_v2(date,uuid[],text,text,integer,uuid)','EXECUTE')
    or not has_function_privilege('service_role','public.register_journal_roster_v2(date,uuid[],text,text,integer,uuid)','EXECUTE')
    or has_table_privilege('authenticated','public.journal_entries','INSERT,UPDATE,DELETE') then
    raise exception 'STOP_JOURNAL_DEFAULT_SELECTIONS_POSTFLIGHT_ACL';
  end if;
end;
$$;

select 'JOURNAL_DEFAULT_SELECTIONS_V1_READY' as status;
rollback;
