-- P&M OS Operations schedule foundation
-- 작성만 수행하며 운영 Supabase에는 자동 적용하지 않는다.
-- Finance 회계 객체와 공용 Customer/Dog Master 구조는 변경하지 않는다.

begin;

do $$
begin
  if to_regclass('public.operation_memberships') is null
    or to_regclass('public.operation_calendars') is null
    or to_regclass('public.operation_schedule_types') is null
    or to_regclass('public.entity_audit_events') is null then
    raise exception
      '202607280001_operations_foundation.sql을 먼저 적용해 주세요.'
      using errcode = 'P0001';
  end if;
end;
$$;

comment on column public.operation_memberships.role is
  'Operations 역할: staff=Employee, manager=Manager, owner=Owner';

create table if not exists public.operation_schedule_series (
  id uuid primary key default gen_random_uuid(),
  calendar_id uuid not null
    references public.operation_calendars(id) on delete restrict,
  schedule_type_id uuid not null
    references public.operation_schedule_types(id) on delete restrict,
  title text not null check (nullif(btrim(title), '') is not null),
  description text null,
  recurrence_frequency text not null
    check (recurrence_frequency in ('daily', 'weekly', 'monthly')),
  recurrence_interval integer not null default 1
    check (recurrence_interval between 1 and 365),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  all_day boolean not null default false,
  recurrence_ends_on date null,
  timezone text not null default 'Asia/Seoul'
    check (timezone = 'Asia/Seoul'),
  rolling_horizon_months integer not null default 12
    check (rolling_horizon_months = 12),
  request_id uuid not null unique,
  version integer not null default 1 check (version > 0),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz null,
  archived_by uuid null references public.profiles(id) on delete restrict,
  archive_reason text null,
  constraint operation_schedule_series_time_order
    check (ends_at > starts_at),
  constraint operation_schedule_series_archive_consistency check (
    (
      archived_at is null
      and archived_by is null
      and archive_reason is null
    )
    or (
      archived_at is not null
      and archived_by is not null
      and nullif(btrim(archive_reason), '') is not null
    )
  )
);

create index if not exists operation_schedule_series_calendar_time_idx
  on public.operation_schedule_series (calendar_id, starts_at, ends_at)
  where archived_at is null;

create index if not exists operation_schedule_series_type_idx
  on public.operation_schedule_series (schedule_type_id)
  where archived_at is null;

create table if not exists public.operation_schedules (
  id uuid primary key default gen_random_uuid(),
  series_id uuid null
    references public.operation_schedule_series(id) on delete restrict,
  calendar_id uuid not null
    references public.operation_calendars(id) on delete restrict,
  schedule_type_id uuid not null
    references public.operation_schedule_types(id) on delete restrict,
  title text not null check (nullif(btrim(title), '') is not null),
  description text null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  all_day boolean not null default false,
  timezone text not null default 'Asia/Seoul'
    check (timezone = 'Asia/Seoul'),
  status text not null default 'scheduled'
    check (status in ('scheduled', 'completed', 'cancelled')),
  original_occurrence_at timestamptz null,
  request_id uuid not null unique,
  version integer not null default 1 check (version > 0),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz null,
  archived_by uuid null references public.profiles(id) on delete restrict,
  archive_reason text null,
  constraint operation_schedules_time_order check (ends_at > starts_at),
  constraint operation_schedules_series_occurrence_consistency check (
    (
      series_id is null
      and original_occurrence_at is null
    )
    or (
      series_id is not null
      and original_occurrence_at is not null
    )
  ),
  constraint operation_schedules_archive_consistency check (
    (
      archived_at is null
      and archived_by is null
      and archive_reason is null
    )
    or (
      archived_at is not null
      and archived_by is not null
      and nullif(btrim(archive_reason), '') is not null
    )
  )
);

create unique index if not exists operation_schedules_series_occurrence_uidx
  on public.operation_schedules (series_id, original_occurrence_at)
  where series_id is not null;

create index if not exists operation_schedules_calendar_time_idx
  on public.operation_schedules (calendar_id, starts_at, ends_at)
  where archived_at is null;

create index if not exists operation_schedules_status_time_idx
  on public.operation_schedules (status, starts_at)
  where archived_at is null;

create index if not exists operation_schedules_type_time_idx
  on public.operation_schedules (schedule_type_id, starts_at)
  where archived_at is null;

create table if not exists public.operation_schedule_assignees (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null
    references public.operation_schedules(id) on delete restrict,
  profile_id uuid not null
    references public.profiles(id) on delete restrict,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz null,
  archived_by uuid null references public.profiles(id) on delete restrict,
  archive_reason text null,
  constraint operation_schedule_assignees_archive_consistency check (
    (
      archived_at is null
      and archived_by is null
      and archive_reason is null
    )
    or (
      archived_at is not null
      and archived_by is not null
      and nullif(btrim(archive_reason), '') is not null
    )
  )
);

create unique index if not exists operation_schedule_assignees_active_uidx
  on public.operation_schedule_assignees (schedule_id, profile_id)
  where archived_at is null;

create index if not exists operation_schedule_assignees_profile_idx
  on public.operation_schedule_assignees (profile_id, schedule_id)
  where archived_at is null;

create table if not exists public.operation_schedule_dogs (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null
    references public.operation_schedules(id) on delete restrict,
  dog_id uuid not null references public.dogs(id) on delete restrict,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz null,
  archived_by uuid null references public.profiles(id) on delete restrict,
  archive_reason text null,
  constraint operation_schedule_dogs_archive_consistency check (
    (
      archived_at is null
      and archived_by is null
      and archive_reason is null
    )
    or (
      archived_at is not null
      and archived_by is not null
      and nullif(btrim(archive_reason), '') is not null
    )
  )
);

create unique index if not exists operation_schedule_dogs_active_uidx
  on public.operation_schedule_dogs (schedule_id, dog_id)
  where archived_at is null;

create index if not exists operation_schedule_dogs_dog_idx
  on public.operation_schedule_dogs (dog_id, schedule_id)
  where archived_at is null;

create table if not exists public.operation_schedule_customers (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null
    references public.operation_schedules(id) on delete restrict,
  customer_id uuid not null
    references public.customers(id) on delete restrict,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz null,
  archived_by uuid null references public.profiles(id) on delete restrict,
  archive_reason text null,
  constraint operation_schedule_customers_archive_consistency check (
    (
      archived_at is null
      and archived_by is null
      and archive_reason is null
    )
    or (
      archived_at is not null
      and archived_by is not null
      and nullif(btrim(archive_reason), '') is not null
    )
  )
);

create unique index if not exists operation_schedule_customers_active_uidx
  on public.operation_schedule_customers (schedule_id, customer_id)
  where archived_at is null;

create index if not exists operation_schedule_customers_customer_idx
  on public.operation_schedule_customers (customer_id, schedule_id)
  where archived_at is null;

create or replace function public.protect_operation_schedule_metadata()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.id = old.id;
  new.created_by = old.created_by;
  new.created_at = old.created_at;
  new.version = old.version + 1;
  return new;
end;
$$;

create or replace function public.protect_operation_link_metadata()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.id = old.id;
  new.created_by = old.created_by;
  new.created_at = old.created_at;
  return new;
end;
$$;

create or replace function public.record_operation_schedule_audit_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_action text;
  reason text;
  request_value text;
  parsed_request_id uuid;
begin
  if tg_op = 'DELETE' then
    raise exception 'Operations 일정 원장은 물리 삭제할 수 없습니다.'
      using errcode = 'P0001';
  end if;

  if tg_op = 'INSERT' then
    target_action := 'created';
  elsif old.archived_at is null and new.archived_at is not null then
    target_action := 'archived';
  elsif old.archived_at is not null and new.archived_at is null then
    target_action := 'restored';
  else
    target_action := 'updated';
  end if;

  reason := nullif(
    btrim(current_setting('app.operation_change_reason', true)),
    ''
  );
  request_value := nullif(
    btrim(current_setting('app.operation_request_id', true)),
    ''
  );

  if request_value is not null then
    begin
      parsed_request_id := request_value::uuid;
    exception
      when invalid_text_representation then
        raise exception '유효하지 않은 Operations 요청 ID입니다.'
          using errcode = '22023';
    end;
  end if;

  insert into public.entity_audit_events (
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
  values (
    'operations',
    tg_table_name,
    new.id,
    target_action,
    case when tg_op = 'UPDATE' then to_jsonb(old) else null end,
    to_jsonb(new),
    auth.uid(),
    reason,
    parsed_request_id
  );

  return new;
end;
$$;

create or replace function public.block_operation_schedule_delete()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'Operations 일정 원장은 물리 삭제할 수 없습니다.'
    using errcode = 'P0001';
end;
$$;

drop trigger if exists operation_schedule_series_protect_metadata
  on public.operation_schedule_series;
create trigger operation_schedule_series_protect_metadata
  before update on public.operation_schedule_series
  for each row
  execute function public.protect_operation_schedule_metadata();

drop trigger if exists operation_schedules_protect_metadata
  on public.operation_schedules;
create trigger operation_schedules_protect_metadata
  before update on public.operation_schedules
  for each row
  execute function public.protect_operation_schedule_metadata();

drop trigger if exists operation_schedule_assignees_protect_metadata
  on public.operation_schedule_assignees;
create trigger operation_schedule_assignees_protect_metadata
  before update on public.operation_schedule_assignees
  for each row
  execute function public.protect_operation_link_metadata();

drop trigger if exists operation_schedule_dogs_protect_metadata
  on public.operation_schedule_dogs;
create trigger operation_schedule_dogs_protect_metadata
  before update on public.operation_schedule_dogs
  for each row
  execute function public.protect_operation_link_metadata();

drop trigger if exists operation_schedule_customers_protect_metadata
  on public.operation_schedule_customers;
create trigger operation_schedule_customers_protect_metadata
  before update on public.operation_schedule_customers
  for each row
  execute function public.protect_operation_link_metadata();

drop trigger if exists operation_schedule_series_updated_at
  on public.operation_schedule_series;
create trigger operation_schedule_series_updated_at
  before update on public.operation_schedule_series
  for each row
  execute function public.set_updated_at();

drop trigger if exists operation_schedules_updated_at
  on public.operation_schedules;
create trigger operation_schedules_updated_at
  before update on public.operation_schedules
  for each row
  execute function public.set_updated_at();

drop trigger if exists operation_schedule_assignees_updated_at
  on public.operation_schedule_assignees;
create trigger operation_schedule_assignees_updated_at
  before update on public.operation_schedule_assignees
  for each row
  execute function public.set_updated_at();

drop trigger if exists operation_schedule_dogs_updated_at
  on public.operation_schedule_dogs;
create trigger operation_schedule_dogs_updated_at
  before update on public.operation_schedule_dogs
  for each row
  execute function public.set_updated_at();

drop trigger if exists operation_schedule_customers_updated_at
  on public.operation_schedule_customers;
create trigger operation_schedule_customers_updated_at
  before update on public.operation_schedule_customers
  for each row
  execute function public.set_updated_at();

drop trigger if exists operation_schedule_series_audit
  on public.operation_schedule_series;
create trigger operation_schedule_series_audit
  after insert or update on public.operation_schedule_series
  for each row
  execute function public.record_operation_schedule_audit_event();

drop trigger if exists operation_schedules_audit
  on public.operation_schedules;
create trigger operation_schedules_audit
  after insert or update on public.operation_schedules
  for each row
  execute function public.record_operation_schedule_audit_event();

drop trigger if exists operation_schedule_assignees_audit
  on public.operation_schedule_assignees;
create trigger operation_schedule_assignees_audit
  after insert or update on public.operation_schedule_assignees
  for each row
  execute function public.record_operation_schedule_audit_event();

drop trigger if exists operation_schedule_dogs_audit
  on public.operation_schedule_dogs;
create trigger operation_schedule_dogs_audit
  after insert or update on public.operation_schedule_dogs
  for each row
  execute function public.record_operation_schedule_audit_event();

drop trigger if exists operation_schedule_customers_audit
  on public.operation_schedule_customers;
create trigger operation_schedule_customers_audit
  after insert or update on public.operation_schedule_customers
  for each row
  execute function public.record_operation_schedule_audit_event();

drop trigger if exists operation_schedule_series_block_delete
  on public.operation_schedule_series;
create trigger operation_schedule_series_block_delete
  before delete on public.operation_schedule_series
  for each row
  execute function public.block_operation_schedule_delete();

drop trigger if exists operation_schedules_block_delete
  on public.operation_schedules;
create trigger operation_schedules_block_delete
  before delete on public.operation_schedules
  for each row
  execute function public.block_operation_schedule_delete();

drop trigger if exists operation_schedule_assignees_block_delete
  on public.operation_schedule_assignees;
create trigger operation_schedule_assignees_block_delete
  before delete on public.operation_schedule_assignees
  for each row
  execute function public.block_operation_schedule_delete();

drop trigger if exists operation_schedule_dogs_block_delete
  on public.operation_schedule_dogs;
create trigger operation_schedule_dogs_block_delete
  before delete on public.operation_schedule_dogs
  for each row
  execute function public.block_operation_schedule_delete();

drop trigger if exists operation_schedule_customers_block_delete
  on public.operation_schedule_customers;
create trigger operation_schedule_customers_block_delete
  before delete on public.operation_schedule_customers
  for each row
  execute function public.block_operation_schedule_delete();

alter table public.operation_schedule_series enable row level security;
alter table public.operation_schedules enable row level security;
alter table public.operation_schedule_assignees enable row level security;
alter table public.operation_schedule_dogs enable row level security;
alter table public.operation_schedule_customers enable row level security;

drop policy if exists operation_schedule_series_select_members
  on public.operation_schedule_series;
create policy operation_schedule_series_select_members
  on public.operation_schedule_series
  for select
  to authenticated
  using (public.is_active_operation_member());

drop policy if exists operation_schedules_select_members
  on public.operation_schedules;
create policy operation_schedules_select_members
  on public.operation_schedules
  for select
  to authenticated
  using (public.is_active_operation_member());

drop policy if exists operation_schedule_assignees_select_members
  on public.operation_schedule_assignees;
create policy operation_schedule_assignees_select_members
  on public.operation_schedule_assignees
  for select
  to authenticated
  using (public.is_active_operation_member());

drop policy if exists operation_schedule_dogs_select_members
  on public.operation_schedule_dogs;
create policy operation_schedule_dogs_select_members
  on public.operation_schedule_dogs
  for select
  to authenticated
  using (public.is_active_operation_member());

drop policy if exists operation_schedule_customers_select_members
  on public.operation_schedule_customers;
create policy operation_schedule_customers_select_members
  on public.operation_schedule_customers
  for select
  to authenticated
  using (public.is_active_operation_member());

revoke all on table public.operation_schedule_series
  from anon, authenticated;
revoke all on table public.operation_schedules
  from anon, authenticated;
revoke all on table public.operation_schedule_assignees
  from anon, authenticated;
revoke all on table public.operation_schedule_dogs
  from anon, authenticated;
revoke all on table public.operation_schedule_customers
  from anon, authenticated;

grant select on table public.operation_schedule_series to authenticated;
grant select on table public.operation_schedules to authenticated;
grant select on table public.operation_schedule_assignees to authenticated;
grant select on table public.operation_schedule_dogs to authenticated;
grant select on table public.operation_schedule_customers to authenticated;

revoke all on function public.protect_operation_schedule_metadata()
  from public;
revoke all on function public.protect_operation_link_metadata()
  from public;
revoke all on function public.record_operation_schedule_audit_event()
  from public;
revoke all on function public.block_operation_schedule_delete()
  from public;

commit;
