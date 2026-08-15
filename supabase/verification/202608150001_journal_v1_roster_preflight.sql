\set ON_ERROR_STOP on
begin read only;
select hotel_qa.assert_isolated_environment();

do $$
begin
  if to_regclass('public.journal_days') is not null
    or to_regclass('public.journal_entries') is not null
    or to_regprocedure('public.get_journal_roster(date)') is not null then
    raise exception 'STOP_JOURNAL_V1_ROSTER_ALREADY_PRESENT';
  end if;
  if to_regclass('public.customers') is null or to_regclass('public.dogs') is null
    or to_regclass('public.operation_memberships') is null
    or to_regclass('public.entity_audit_events') is null
    or to_regprocedure('public.is_active_operation_member()') is null then
    raise exception 'STOP_JOURNAL_V1_ROSTER_DEPENDENCY_MISSING';
  end if;
  if (select count(*) from public.profiles profile join public.operation_memberships membership on membership.profile_id=profile.id
      where profile.role='admin' and profile.is_active and profile.account_status='active'
        and membership.role='owner' and membership.is_active)<>1 then
    raise exception 'STOP_JOURNAL_QA_OWNER_CONTRACT';
  end if;
end;
$$;

select 'READY_TO_APPLY_JOURNAL_V1_ROSTER';
rollback;
