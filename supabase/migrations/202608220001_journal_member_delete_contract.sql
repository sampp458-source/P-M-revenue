begin;

create or replace function public.remove_journal_roster_entry(
  p_entry_id uuid,
  p_expected_version integer,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  row_before public.journal_entries%rowtype;
  business_date_value date;
  request_contract jsonb;
  replay_event public.entity_audit_events%rowtype;
  deleted_count integer;
begin
  if actor_id is null or not public.is_active_operation_member() then
    raise exception '일지를 삭제할 권한이 없습니다.' using errcode = '42501';
  end if;
  if p_entry_id is null or p_expected_version is null or p_request_id is null then
    raise exception '일지 항목, 버전, 요청 ID가 필요합니다.' using errcode = '22023';
  end if;

  request_contract := jsonb_build_object(
    'entryId', p_entry_id,
    'expectedVersion', p_expected_version
  );

  perform pg_advisory_xact_lock(hashtextextended('journal-entry-remove:' || p_request_id::text, 0));

  select audit.*
    into replay_event
  from public.entity_audit_events audit
  where audit.module_code = 'journal'
    and audit.entity_type = 'journal_entries'
    and audit.action = 'archived'
    and audit.request_id = p_request_id
  order by audit.created_at desc, audit.id desc
  limit 1;

  if found then
    if replay_event.entity_id is distinct from p_entry_id
      or replay_event.after_data -> 'request' is distinct from request_contract
      or nullif(replay_event.after_data ->> 'businessDate', '') is null then
      raise exception '요청 ID가 다른 일지 삭제에 이미 사용되었습니다.' using errcode = '22023';
    end if;
    business_date_value := (replay_event.after_data ->> 'businessDate')::date;
    return public.get_journal_roster(business_date_value);
  end if;

  select entry.*
    into row_before
  from public.journal_entries entry
  where entry.id = p_entry_id
  for update;
  if not found then
    raise exception '일지 항목을 찾을 수 없습니다.' using errcode = 'P0002';
  end if;
  if row_before.version <> p_expected_version then
    raise exception '다른 사용자가 먼저 변경했습니다.' using errcode = 'PT409';
  end if;

  select day.business_date
    into business_date_value
  from public.journal_days day
  where day.id = row_before.journal_day_id;
  if business_date_value is null then
    raise exception '일지 날짜를 찾을 수 없습니다.' using errcode = 'P0002';
  end if;

  insert into public.entity_audit_events(
    module_code,
    entity_type,
    entity_id,
    action,
    before_data,
    after_data,
    changed_by,
    change_reason,
    request_id
  )
  values(
    'journal',
    'journal_entries',
    p_entry_id,
    'archived',
    to_jsonb(row_before),
    jsonb_build_object(
      'request', request_contract,
      'businessDate', business_date_value,
      'journalDayId', row_before.journal_day_id,
      'dogId', row_before.dog_id,
      'statusBeforeDelete', row_before.status
    ),
    actor_id,
    'journal_entry_delete',
    p_request_id
  );

  delete from public.journal_entries
  where id = p_entry_id;
  get diagnostics deleted_count = row_count;
  if deleted_count <> 1 then
    raise exception '일지 삭제 대상이 정확히 1건이 아닙니다.' using errcode = 'P0001';
  end if;

  return public.get_journal_roster(business_date_value);
end;
$$;

revoke all on function public.remove_journal_roster_entry(uuid, integer, uuid) from public, anon;
grant execute on function public.remove_journal_roster_entry(uuid, integer, uuid) to authenticated, service_role;

comment on function public.remove_journal_roster_entry(uuid, integer, uuid) is
  'Delete exactly one Journal entry at any status for an active Operations member. Versioned, idempotent, audited; preserves Journal day and business records.';

commit;
