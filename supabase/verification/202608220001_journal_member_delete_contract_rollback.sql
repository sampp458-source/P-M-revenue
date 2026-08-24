begin;

create or replace function public.remove_journal_roster_entry(
  p_entry_id uuid,p_expected_version integer,p_request_id uuid
)
returns jsonb language plpgsql security definer
set search_path=public,pg_temp
as $$
declare actor_id uuid:=auth.uid(); row_before public.journal_entries%rowtype; business_date_value date;
begin
  if actor_id is null or not public.is_active_operation_member() then
    raise exception '일지 명단에서 제거할 권한이 없습니다.' using errcode='42501';
  end if;
  if p_request_id is null then raise exception '요청 ID가 필요합니다.' using errcode='22023'; end if;
  select entry.* into row_before from public.journal_entries entry where entry.id=p_entry_id for update;
  if not found then raise exception '일지 항목을 찾을 수 없습니다.' using errcode='P0002'; end if;
  if row_before.version<>p_expected_version then
    raise exception '다른 사용자가 먼저 변경했습니다.' using errcode='PT409';
  end if;
  if row_before.status<>'not_started' then
    raise exception '작성중이거나 완료된 일지는 명단에서 제거할 수 없습니다.' using errcode='22023';
  end if;
  select business_date into business_date_value from public.journal_days where id=row_before.journal_day_id;
  insert into public.entity_audit_events(module_code,entity_type,entity_id,action,before_data,changed_by,change_reason,request_id)
  values('journal','journal_entries',p_entry_id,'archived',to_jsonb(row_before),actor_id,'Journal roster Dog removed',p_request_id);
  delete from public.journal_entries where id=p_entry_id;
  return public.get_journal_roster(business_date_value);
end;
$$;

revoke all on function public.remove_journal_roster_entry(uuid, integer, uuid) from public, anon;
grant execute on function public.remove_journal_roster_entry(uuid, integer, uuid) to authenticated, service_role;

comment on function public.remove_journal_roster_entry(uuid, integer, uuid) is
  'Remove a NOT_STARTED Dog from the Journal roster without deleting the Journal day.';

commit;
