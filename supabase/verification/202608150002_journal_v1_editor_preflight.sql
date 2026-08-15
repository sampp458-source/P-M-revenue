\set ON_ERROR_STOP on
begin read only;
select hotel_qa.assert_isolated_environment();

do $$
begin
  if to_regclass('public.journal_entries') is null
    or to_regprocedure('public.journal_entry_json_internal(uuid)') is null
    or to_regprocedure('public.get_journal_roster(date)') is null
    or to_regprocedure('public.set_journal_entry_status(uuid,integer,text,uuid)') is null then
    raise exception 'STOP_JOURNAL_EDITOR_BASELINE_MISSING';
  end if;
  if to_regprocedure('public.get_journal_entry(uuid)') is not null
    or to_regprocedure('public.complete_journal_entry(uuid,integer,uuid)') is not null
    or to_regprocedure('public.update_journal_entry_draft(uuid,integer,text[],boolean,boolean,text,text[],text,text,uuid,text,text,text,text,text,uuid)') is not null then
    raise exception 'STOP_JOURNAL_EDITOR_ALREADY_APPLIED';
  end if;
  if exists(select 1 from public.journal_entries where char_length(coalesce(teacher_comment,''))>500) then
    raise exception 'STOP_JOURNAL_EDITOR_COMMENT_BASELINE';
  end if;
end;
$$;

select 'READY_TO_APPLY_JOURNAL_V1_EDITOR';
rollback;
