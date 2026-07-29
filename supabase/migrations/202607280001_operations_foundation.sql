-- P&M OS Operations foundation
-- 실행 전 검토용 Migration. Finance 회계 객체는 변경하지 않는다.

begin;

create table if not exists public.operation_memberships (
  profile_id uuid primary key references public.profiles(id) on delete restrict,
  role text not null default 'staff'
    check (role in ('staff', 'manager', 'owner')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.operation_calendars (
  id uuid primary key default gen_random_uuid(),
  name text not null check (nullif(btrim(name), '') is not null),
  scope_type text not null
    check (scope_type in ('business_unit', 'common', 'personal')),
  business_unit_id uuid null
    references public.business_units(id) on delete restrict,
  color text not null check (color ~ '^#[0-9A-Fa-f]{6}$'),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_by uuid null references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint operation_calendars_scope_consistency check (
    (
      scope_type = 'business_unit'
      and business_unit_id is not null
    )
    or (
      scope_type in ('common', 'personal')
      and business_unit_id is null
    )
  )
);

create unique index if not exists operation_calendars_name_uidx
  on public.operation_calendars (lower(btrim(name)));

create unique index if not exists operation_calendars_business_unit_uidx
  on public.operation_calendars (business_unit_id)
  where scope_type = 'business_unit';

create unique index if not exists operation_calendars_singleton_scope_uidx
  on public.operation_calendars (scope_type)
  where scope_type in ('common', 'personal');

create index if not exists operation_calendars_active_sort_idx
  on public.operation_calendars (is_active, sort_order, name);

create table if not exists public.operation_schedule_types (
  id uuid primary key default gen_random_uuid(),
  name text not null check (nullif(btrim(name), '') is not null),
  color text not null check (color ~ '^#[0-9A-Fa-f]{6}$'),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_by uuid null references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists operation_schedule_types_name_uidx
  on public.operation_schedule_types (lower(btrim(name)));

create index if not exists operation_schedule_types_active_sort_idx
  on public.operation_schedule_types (is_active, sort_order, name);

create table if not exists public.entity_audit_events (
  id uuid primary key default gen_random_uuid(),
  module_code text not null
    check (nullif(btrim(module_code), '') is not null),
  entity_type text not null check (nullif(btrim(entity_type), '') is not null),
  entity_id uuid not null,
  action text not null check (action in ('created', 'updated', 'archived', 'restored')),
  before_data jsonb null,
  after_data jsonb null,
  changed_by uuid null references public.profiles(id) on delete set null,
  change_reason text null,
  request_id uuid null,
  created_at timestamptz not null default now()
);

create index if not exists entity_audit_events_entity_created_idx
  on public.entity_audit_events (
    module_code,
    entity_type,
    entity_id,
    created_at desc
  );

create index if not exists entity_audit_events_request_idx
  on public.entity_audit_events (request_id)
  where request_id is not null;

create or replace function public.is_active_operation_member()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.operation_memberships membership
    join public.profiles profile
      on profile.id = membership.profile_id
    where membership.profile_id = auth.uid()
      and membership.is_active = true
      and profile.is_active = true
      and profile.account_status = 'active'
  );
$$;

create or replace function public.has_operation_role(p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.operation_memberships membership
    join public.profiles profile
      on profile.id = membership.profile_id
    where membership.profile_id = auth.uid()
      and membership.role = any(p_roles)
      and membership.is_active = true
      and profile.is_active = true
      and profile.account_status = 'active'
  );
$$;

create or replace function public.sync_operation_membership_from_profile()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.is_active = true and new.account_status = 'active' then
    insert into public.operation_memberships (
      profile_id,
      role,
      is_active
    )
    values (
      new.id,
      'staff',
      true
    )
    on conflict (profile_id) do update
      set is_active = true,
          updated_at = now();
  else
    update public.operation_memberships
    set is_active = false,
        updated_at = now()
    where profile_id = new.id
      and is_active = true;
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_sync_operation_membership on public.profiles;
create trigger profiles_sync_operation_membership
  after insert or update of is_active, account_status
  on public.profiles
  for each row
  execute function public.sync_operation_membership_from_profile();

create or replace function public.protect_operation_setting_metadata()
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

drop trigger if exists operation_calendars_protect_metadata
  on public.operation_calendars;
create trigger operation_calendars_protect_metadata
  before update on public.operation_calendars
  for each row
  execute function public.protect_operation_setting_metadata();

drop trigger if exists operation_schedule_types_protect_metadata
  on public.operation_schedule_types;
create trigger operation_schedule_types_protect_metadata
  before update on public.operation_schedule_types
  for each row
  execute function public.protect_operation_setting_metadata();

drop trigger if exists operation_memberships_updated_at
  on public.operation_memberships;
create trigger operation_memberships_updated_at
  before update on public.operation_memberships
  for each row
  execute function public.set_updated_at();

drop trigger if exists operation_calendars_updated_at
  on public.operation_calendars;
create trigger operation_calendars_updated_at
  before update on public.operation_calendars
  for each row
  execute function public.set_updated_at();

drop trigger if exists operation_schedule_types_updated_at
  on public.operation_schedule_types;
create trigger operation_schedule_types_updated_at
  before update on public.operation_schedule_types
  for each row
  execute function public.set_updated_at();

create or replace function public.record_operation_audit_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_id uuid;
  target_id_value text;
  target_action text;
  before_row jsonb;
  after_row jsonb;
  reason text;
  request_value text;
  parsed_request_id uuid;
begin
  after_row := to_jsonb(new);

  if tg_op = 'INSERT' then
    target_action := 'created';
  elsif tg_op = 'UPDATE' then
    before_row := to_jsonb(old);
    target_action := case
      when before_row ->> 'is_active' = 'true'
        and after_row ->> 'is_active' = 'false'
        then 'archived'
      when before_row ->> 'is_active' = 'false'
        and after_row ->> 'is_active' = 'true'
        then 'restored'
      when before_row ->> 'archived_at' is null
        and after_row ->> 'archived_at' is not null
        then 'archived'
      when before_row ->> 'archived_at' is not null
        and after_row ->> 'archived_at' is null
        then 'restored'
      else 'updated'
    end;
  else
    raise exception 'Operations 원장은 물리 삭제할 수 없습니다.'
      using errcode = 'P0001';
  end if;

  target_id_value := coalesce(
    after_row ->> 'id',
    after_row ->> 'profile_id',
    after_row ->> 'schedule_id'
  );

  if target_id_value is null then
    raise exception
      'Operations 감사 대상 %에서 식별자(id, profile_id, schedule_id)를 확인할 수 없습니다.',
      tg_table_name
      using errcode = 'P0001';
  end if;

  begin
    target_id := target_id_value::uuid;
  exception
    when invalid_text_representation then
      raise exception
        'Operations 감사 대상 %의 식별자가 유효한 UUID가 아닙니다.',
        tg_table_name
        using errcode = '22023';
  end;

  reason := nullif(btrim(current_setting('app.operation_change_reason', true)), '');
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
    target_id,
    target_action,
    before_row,
    after_row,
    auth.uid(),
    reason,
    parsed_request_id
  );

  return new;
end;
$$;

drop trigger if exists operation_memberships_audit
  on public.operation_memberships;
create trigger operation_memberships_audit
  after insert or update on public.operation_memberships
  for each row
  execute function public.record_operation_audit_event();

drop trigger if exists operation_calendars_audit
  on public.operation_calendars;
create trigger operation_calendars_audit
  after insert or update on public.operation_calendars
  for each row
  execute function public.record_operation_audit_event();

drop trigger if exists operation_schedule_types_audit
  on public.operation_schedule_types;
create trigger operation_schedule_types_audit
  after insert or update on public.operation_schedule_types
  for each row
  execute function public.record_operation_audit_event();

insert into public.operation_memberships (
  profile_id,
  role,
  is_active
)
select
  profile.id,
  'staff',
  true
from public.profiles profile
where profile.is_active = true
  and profile.account_status = 'active'
on conflict (profile_id) do nothing;

do $$
begin
  if (
    select count(*)
    from public.business_units
    where code in ('daycare', 'training', 'hotel')
  ) <> 3 then
    raise exception 'Operations 기본 Calendar에 필요한 사업부 3개를 확인할 수 없습니다.'
      using errcode = 'P0001';
  end if;
end;
$$;

insert into public.operation_calendars (
  name,
  scope_type,
  business_unit_id,
  color,
  is_active,
  sort_order,
  created_by
)
select
  seed.name,
  'business_unit',
  unit.id,
  seed.color,
  true,
  seed.sort_order,
  null
from (
  values
    ('daycare', '유치원', '#52B8D0', 10),
    ('training', '교육센터', '#4568B2', 20),
    ('hotel', '호텔', '#C99845', 30)
) as seed(code, name, color, sort_order)
join public.business_units unit
  on unit.code = seed.code
where not exists (
  select 1
  from public.operation_calendars calendar
  where calendar.scope_type = 'business_unit'
    and calendar.business_unit_id = unit.id
);

insert into public.operation_calendars (
  name,
  scope_type,
  business_unit_id,
  color,
  is_active,
  sort_order,
  created_by
)
select
  seed.name,
  seed.scope_type,
  null,
  seed.color,
  true,
  seed.sort_order,
  null
from (
  values
    ('공통', 'common', '#5B7FA3', 40),
    ('개인', 'personal', '#7A8797', 50)
) as seed(name, scope_type, color, sort_order)
where not exists (
  select 1
  from public.operation_calendars calendar
  where calendar.scope_type = seed.scope_type
);

insert into public.operation_schedule_types (
  name,
  color,
  is_active,
  sort_order,
  created_by
)
select
  seed.name,
  seed.color,
  true,
  seed.sort_order,
  null
from (
  values
    ('수업', '#4568B2', 10),
    ('상담', '#52B8D0', 20),
    ('입실·퇴실', '#C99845', 30),
    ('회의', '#66758A', 40),
    ('내부 업무', '#5B7FA3', 50),
    ('개인 일정', '#7A8797', 60),
    ('휴무', '#B56A6A', 70),
    ('기타', '#8A96A6', 80)
) as seed(name, color, sort_order)
where not exists (
  select 1
  from public.operation_schedule_types schedule_type
  where lower(btrim(schedule_type.name)) = lower(btrim(seed.name))
);

alter table public.operation_memberships enable row level security;
alter table public.operation_calendars enable row level security;
alter table public.operation_schedule_types enable row level security;
alter table public.entity_audit_events enable row level security;

drop policy if exists operation_memberships_select_self
  on public.operation_memberships;
create policy operation_memberships_select_self
  on public.operation_memberships
  for select
  to authenticated
  using (
    profile_id = auth.uid()
    and public.is_active_operation_member()
  );

drop policy if exists operation_calendars_select_active_members
  on public.operation_calendars;
create policy operation_calendars_select_active_members
  on public.operation_calendars
  for select
  to authenticated
  using (public.is_active_operation_member());

drop policy if exists operation_calendars_insert_managers
  on public.operation_calendars;
create policy operation_calendars_insert_managers
  on public.operation_calendars
  for insert
  to authenticated
  with check (
    public.has_operation_role(array['manager', 'owner'])
    and created_by = auth.uid()
  );

drop policy if exists operation_calendars_update_managers
  on public.operation_calendars;
create policy operation_calendars_update_managers
  on public.operation_calendars
  for update
  to authenticated
  using (public.has_operation_role(array['manager', 'owner']))
  with check (public.has_operation_role(array['manager', 'owner']));

drop policy if exists operation_schedule_types_select_active_members
  on public.operation_schedule_types;
create policy operation_schedule_types_select_active_members
  on public.operation_schedule_types
  for select
  to authenticated
  using (public.is_active_operation_member());

drop policy if exists operation_schedule_types_insert_managers
  on public.operation_schedule_types;
create policy operation_schedule_types_insert_managers
  on public.operation_schedule_types
  for insert
  to authenticated
  with check (
    public.has_operation_role(array['manager', 'owner'])
    and created_by = auth.uid()
  );

drop policy if exists operation_schedule_types_update_managers
  on public.operation_schedule_types;
create policy operation_schedule_types_update_managers
  on public.operation_schedule_types
  for update
  to authenticated
  using (public.has_operation_role(array['manager', 'owner']))
  with check (public.has_operation_role(array['manager', 'owner']));

drop policy if exists entity_audit_events_select_managers
  on public.entity_audit_events;
create policy entity_audit_events_select_managers
  on public.entity_audit_events
  for select
  to authenticated
  using (public.has_operation_role(array['manager', 'owner']));

revoke all on table public.operation_memberships from anon, authenticated;
revoke all on table public.operation_calendars from anon, authenticated;
revoke all on table public.operation_schedule_types from anon, authenticated;
revoke all on table public.entity_audit_events from anon, authenticated;

grant select on table public.operation_memberships to authenticated;
grant select, insert, update on table public.operation_calendars to authenticated;
grant select, insert, update on table public.operation_schedule_types to authenticated;
grant select on table public.entity_audit_events to authenticated;

revoke all on function public.is_active_operation_member() from public;
revoke all on function public.has_operation_role(text[]) from public;
revoke all on function public.sync_operation_membership_from_profile() from public;
revoke all on function public.protect_operation_setting_metadata() from public;
revoke all on function public.record_operation_audit_event() from public;

grant execute on function public.is_active_operation_member()
  to authenticated;
grant execute on function public.has_operation_role(text[])
  to authenticated;

commit;
