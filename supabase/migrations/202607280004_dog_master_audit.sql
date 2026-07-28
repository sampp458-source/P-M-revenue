-- P&M OS shared Dog Master audit
-- dogs 테이블 구조와 Finance 회계 데이터는 변경하지 않는다.

begin;

do $$
begin
  if to_regclass('public.entity_audit_events') is null then
    raise exception
      '202607280001_operations_foundation.sql을 먼저 적용해 공용 감사 원장을 준비해 주세요.';
  end if;
end
$$;

create or replace function public.record_dog_master_audit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  audit_action text;
  audit_reason text;
begin
  audit_action := case
    when old.is_active = true and new.is_active = false then 'archived'
    when old.is_active = false and new.is_active = true then 'restored'
    else 'updated'
  end;

  audit_reason := case audit_action
    when 'archived' then 'Dog Master 비활성화'
    when 'restored' then 'Dog Master 활성 복구'
    else 'Dog Master 정보 수정'
  end;

  insert into public.entity_audit_events (
    module_code,
    entity_type,
    entity_id,
    action,
    before_data,
    after_data,
    changed_by,
    change_reason
  )
  values (
    'shared_master',
    'dog',
    new.id,
    audit_action,
    to_jsonb(old),
    to_jsonb(new),
    auth.uid(),
    audit_reason
  );

  return new;
end;
$$;

drop trigger if exists dogs_master_audit
  on public.dogs;

create trigger dogs_master_audit
  after update
  on public.dogs
  for each row
  execute function public.record_dog_master_audit();

revoke all on function public.record_dog_master_audit()
  from public;

commit;
