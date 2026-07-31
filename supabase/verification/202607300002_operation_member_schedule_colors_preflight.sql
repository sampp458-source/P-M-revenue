-- Operations 담당자별 일정 색상 적용 전 읽기 전용 점검

select
  to_regclass('public.operation_memberships') is not null
    as operation_memberships_exists,
  to_regclass('public.profiles') is not null
    as profiles_exists,
  to_regclass('public.entity_audit_events') is not null
    as entity_audit_events_exists,
  to_regprocedure('public.is_active_operation_member()') is not null
    as active_member_function_exists,
  to_regprocedure('public.record_operation_audit_event()') is not null
    as audit_function_exists;

select
  exists (
    select 1
    from pg_trigger trigger_info
    where trigger_info.tgrelid = 'public.operation_memberships'::regclass
      and trigger_info.tgname = 'operation_memberships_audit'
      and not trigger_info.tgisinternal
  ) as membership_audit_trigger_exists,
  exists (
    select 1
    from information_schema.columns column_info
    where column_info.table_schema = 'public'
      and column_info.table_name = 'entity_audit_events'
      and column_info.column_name = 'request_id'
      and column_info.is_nullable = 'YES'
  ) as audit_request_id_is_nullable;

select
  exists (
    select 1
    from information_schema.columns column_info
    where column_info.table_schema = 'public'
      and column_info.table_name = 'operation_memberships'
      and column_info.column_name = 'schedule_color'
  ) as schedule_color_already_exists,
  to_regprocedure('public.get_active_operation_assignees()') is not null
    as assignee_rpc_already_exists,
  to_regprocedure(
    'public.set_operation_member_schedule_color(uuid,text,timestamp with time zone,uuid)'
  ) is not null as color_rpc_already_exists;

select
  membership.profile_id,
  profile.name,
  membership.role,
  membership.is_active,
  profile.is_active as profile_is_active,
  profile.account_status,
  to_jsonb(membership) ->> 'schedule_color' as current_schedule_color
from public.operation_memberships membership
join public.profiles profile
  on profile.id = membership.profile_id
order by profile.name nulls last, membership.profile_id;

select
  (select count(*) from public.sales) as finance_sales_rows,
  (select count(*) from public.sale_payments) as finance_payment_rows,
  (select count(*) from public.sale_refunds) as finance_refund_rows,
  (
    select count(*)
    from public.operation_memberships membership
    join public.profiles profile
      on profile.id = membership.profile_id
    where membership.role = 'owner'
      and membership.is_active = true
      and profile.is_active = true
      and profile.account_status = 'active'
  ) as active_owner_count;

with state as (
  select
    to_regclass('public.operation_memberships') is not null
      and to_regclass('public.profiles') is not null
      and to_regclass('public.entity_audit_events') is not null
      and to_regprocedure('public.is_active_operation_member()') is not null
      and to_regprocedure('public.record_operation_audit_event()') is not null
      as foundation_ready,
    exists (
      select 1
      from pg_trigger trigger_info
      where trigger_info.tgrelid = 'public.operation_memberships'::regclass
        and trigger_info.tgname = 'operation_memberships_audit'
        and not trigger_info.tgisinternal
    ) as audit_trigger_ready,
    exists (
      select 1
      from information_schema.columns column_info
      where column_info.table_schema = 'public'
        and column_info.table_name = 'entity_audit_events'
        and column_info.column_name = 'request_id'
        and column_info.is_nullable = 'YES'
    ) as request_id_nullable,
    exists (
      select 1
      from public.profiles profile
      where profile.role = 'admin'
        and profile.is_active = true
        and profile.account_status = 'active'
    ) as active_admin_exists
)
select
  case
    when not foundation_ready then 'STOP_FOUNDATION_NOT_READY'
    when not audit_trigger_ready then 'STOP_AUDIT_TRIGGER_NOT_READY'
    when not request_id_nullable then 'STOP_AUDIT_REQUEST_ID_NOT_NULLABLE'
    when not active_admin_exists then 'STOP_ACTIVE_ADMIN_MISSING'
    else 'READY'
  end as preflight_status,
  *
from state;
