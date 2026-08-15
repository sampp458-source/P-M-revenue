-- P&M Journal V1 Phase 1: canonical daily roster and editor-ready entry domain.
begin;

do $$
begin
  if to_regclass('public.journal_days') is not null
    or to_regclass('public.journal_entries') is not null
    or to_regprocedure('public.get_journal_roster(date)') is not null then
    raise exception 'STOP_JOURNAL_V1_ROSTER_ALREADY_APPLIED';
  end if;
  if to_regclass('public.customers') is null
    or to_regclass('public.dogs') is null
    or to_regclass('public.profiles') is null
    or to_regclass('public.operation_memberships') is null
    or to_regclass('public.entity_audit_events') is null
    or to_regprocedure('public.is_active_operation_member()') is null then
    raise exception 'STOP_JOURNAL_V1_ROSTER_DEPENDENCY_MISSING';
  end if;
end;
$$;

create table public.journal_days (
  id uuid primary key default gen_random_uuid(),
  business_date date not null,
  journal_type text not null default 'daycare_daily'
    check (journal_type = 'daycare_daily'),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint journal_days_business_date_type_unique
    unique (business_date, journal_type)
);

create table public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  journal_day_id uuid not null references public.journal_days(id) on delete restrict,
  dog_id uuid not null references public.dogs(id) on delete restrict,
  customer_id uuid not null references public.customers(id) on delete restrict,
  status text not null default 'not_started'
    check (status in ('not_started','in_progress','completed')),
  condition_codes text[] not null default '{}'::text[]
    check (condition_codes <@ array['active','calm','tired','sensitive']::text[]),
  urination boolean null,
  defecation boolean null,
  stool_condition text null
    check (stool_condition is null or stool_condition in ('good','very_loose','slightly_loose','poor')),
  meal_codes text[] not null default '{}'::text[]
    check (meal_codes <@ array['brought_food','daycare_food','brought_snack','daycare_snack']::text[]),
  teacher_relationship text null
    check (teacher_relationship is null or teacher_relationship in ('loves_teacher','prefers_friends','uncomfortable_with_teacher')),
  friend_relationship text null
    check (friend_relationship is null or friend_relationship in ('loves_friends','prefers_teacher','uncomfortable_with_friends')),
  best_friend_dog_id uuid null references public.dogs(id) on delete restrict,
  manners_activity_name text null,
  manners_evaluation text null
    check (manners_evaluation is null or manners_evaluation in ('excellent','can_improve','difficult')),
  physical_activity_name text null,
  physical_evaluation text null
    check (physical_evaluation is null or physical_evaluation in ('champion','fun','rest')),
  teacher_comment text null,
  version integer not null default 1 check (version > 0),
  created_by uuid not null references public.profiles(id) on delete restrict,
  updated_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint journal_entries_day_dog_unique unique (journal_day_id, dog_id),
  constraint journal_entries_stool_semantics check (
    (defecation is true) or stool_condition is null
  ),
  constraint journal_entries_best_friend_not_self check (
    best_friend_dog_id is null or best_friend_dog_id <> dog_id
  )
);

create index journal_entries_day_status_idx
  on public.journal_entries(journal_day_id, status, created_at, id);
create index journal_entries_dog_created_idx
  on public.journal_entries(dog_id, created_at desc);

create function public.protect_journal_entry_metadata_internal()
returns trigger language plpgsql security definer
set search_path=public,pg_temp
as $$
begin
  if new.id<>old.id or new.journal_day_id<>old.journal_day_id
    or new.dog_id<>old.dog_id or new.customer_id<>old.customer_id
    or new.created_by<>old.created_by or new.created_at<>old.created_at then
    raise exception 'Journal entry identity metadata cannot be changed.' using errcode='22023';
  end if;
  new.version:=old.version+1;
  new.updated_at:=clock_timestamp();
  return new;
end;
$$;

create trigger journal_entries_protect_metadata
before update on public.journal_entries for each row
execute function public.protect_journal_entry_metadata_internal();

create function public.journal_entry_json_internal(p_entry_id uuid)
returns jsonb language sql stable security definer
set search_path=public,pg_temp
as $$
  select jsonb_build_object(
    'id',entry.id,
    'journalDayId',entry.journal_day_id,
    'businessDate',day.business_date,
    'dog',jsonb_build_object('id',dog.id,'name',dog.name),
    'customer',jsonb_build_object('id',customer.id,'name',customer.name),
    'status',upper(entry.status),
    'version',entry.version,
    'createdAt',entry.created_at,
    'updatedAt',entry.updated_at
  )
  from public.journal_entries entry
  join public.journal_days day on day.id=entry.journal_day_id
  join public.dogs dog on dog.id=entry.dog_id
  join public.customers customer on customer.id=entry.customer_id
  where entry.id=p_entry_id and public.is_active_operation_member();
$$;

create function public.get_journal_roster(p_business_date date)
returns jsonb language sql stable security definer
set search_path=public,pg_temp
as $$
  with target_day as (
    select day.id,day.business_date
    from public.journal_days day
    where day.business_date=p_business_date and day.journal_type='daycare_daily'
      and public.is_active_operation_member()
  ), entries as (
    select entry.id,entry.status,entry.created_at,
      public.journal_entry_json_internal(entry.id) payload
    from target_day day
    join public.journal_entries entry on entry.journal_day_id=day.id
  )
  select jsonb_build_object(
    'businessDate',p_business_date,
    'journalDayId',(select id from target_day),
    'summary',jsonb_build_object(
      'total',count(*),
      'notStarted',count(*) filter(where status='not_started'),
      'inProgress',count(*) filter(where status='in_progress'),
      'completed',count(*) filter(where status='completed')
    ),
    'entries',coalesce(jsonb_agg(payload order by created_at,id) filter(where id is not null),'[]'::jsonb)
  ) from entries;
$$;

create function public.register_journal_roster(
  p_business_date date,
  p_dog_ids uuid[],
  p_request_id uuid
)
returns jsonb language plpgsql security definer
set search_path=public,pg_temp
as $$
declare actor_id uuid:=auth.uid(); day_id uuid; dog_row record; inserted_id uuid; day_created boolean:=false;
begin
  if actor_id is null or not public.is_active_operation_member() then
    raise exception '일지 명단을 등록할 권한이 없습니다.' using errcode='42501';
  end if;
  if p_business_date is null or p_business_date>(clock_timestamp() at time zone 'Asia/Seoul')::date then
    raise exception '오늘 또는 과거 날짜의 일지 명단만 등록할 수 있습니다.' using errcode='22023';
  end if;
  if p_request_id is null or cardinality(coalesce(p_dog_ids,'{}'::uuid[]))=0 then
    raise exception '등록할 반려견과 요청 ID가 필요합니다.' using errcode='22023';
  end if;
  if exists(select 1 from unnest(p_dog_ids) id group by id having count(*)>1) then
    raise exception '같은 반려견을 중복 선택할 수 없습니다.' using errcode='22023';
  end if;
  if (select count(*) from public.dogs dog join public.customers customer on customer.id=dog.customer_id
      where dog.id=any(p_dog_ids) and dog.is_active and customer.is_active)
     <> cardinality(p_dog_ids) then
    raise exception '활성 보호자와 소유 반려견 관계를 확인할 수 없습니다.' using errcode='22023';
  end if;

  insert into public.journal_days(business_date,journal_type,created_by)
  values(p_business_date,'daycare_daily',actor_id)
  on conflict(business_date,journal_type) do nothing
  returning id into day_id;
  if day_id is not null then
    day_created:=true;
  else
    select id into day_id from public.journal_days
    where business_date=p_business_date and journal_type='daycare_daily';
  end if;
  if day_created then
    insert into public.entity_audit_events(module_code,entity_type,entity_id,action,after_data,changed_by,change_reason,request_id)
    values('journal','journal_days',day_id,'created',jsonb_build_object('businessDate',p_business_date,'journalType','daycare_daily'),actor_id,'Journal day created',p_request_id);
  end if;

  for dog_row in
    select dog.id, dog.customer_id from public.dogs dog where dog.id=any(p_dog_ids) order by dog.id
  loop
    inserted_id:=null;
    insert into public.journal_entries(journal_day_id,dog_id,customer_id,created_by,updated_by)
    values(day_id,dog_row.id,dog_row.customer_id,actor_id,actor_id)
    on conflict(journal_day_id,dog_id) do nothing returning id into inserted_id;
    if inserted_id is not null then
      insert into public.entity_audit_events(module_code,entity_type,entity_id,action,after_data,changed_by,change_reason,request_id)
      values('journal','journal_entries',inserted_id,'created',public.journal_entry_json_internal(inserted_id),actor_id,'Journal roster Dog added',p_request_id);
    end if;
  end loop;
  return public.get_journal_roster(p_business_date);
end;
$$;

create function public.set_journal_entry_status(
  p_entry_id uuid,p_expected_version integer,p_status text,p_request_id uuid
)
returns jsonb language plpgsql security definer
set search_path=public,pg_temp
as $$
declare actor_id uuid:=auth.uid(); row_before public.journal_entries%rowtype; result jsonb;
begin
  if actor_id is null or not public.is_active_operation_member() then
    raise exception '일지 상태를 변경할 권한이 없습니다.' using errcode='42501';
  end if;
  if p_request_id is null or p_status not in ('not_started','in_progress','completed') then
    raise exception '유효한 일지 상태와 요청 ID가 필요합니다.' using errcode='22023';
  end if;
  select * into row_before from public.journal_entries where id=p_entry_id for update;
  if not found then raise exception '일지 항목을 찾을 수 없습니다.' using errcode='P0002'; end if;
  if row_before.version<>p_expected_version then
    raise exception '다른 사용자가 먼저 변경했습니다.' using errcode='PT409';
  end if;
  update public.journal_entries set status=p_status,updated_by=actor_id where id=p_entry_id;
  result:=public.journal_entry_json_internal(p_entry_id);
  insert into public.entity_audit_events(module_code,entity_type,entity_id,action,before_data,after_data,changed_by,change_reason,request_id)
  values('journal','journal_entries',p_entry_id,'updated',to_jsonb(row_before),result,actor_id,'Journal status changed',p_request_id);
  return result;
end;
$$;

create function public.remove_journal_roster_entry(
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

alter table public.journal_days enable row level security;
alter table public.journal_entries enable row level security;
create policy journal_days_select_members on public.journal_days
for select to authenticated using(public.is_active_operation_member());
create policy journal_entries_select_members on public.journal_entries
for select to authenticated using(public.is_active_operation_member());

revoke all on table public.journal_days,public.journal_entries from public,anon,authenticated,service_role;
grant select on table public.journal_days,public.journal_entries to authenticated,service_role;
revoke all on function public.protect_journal_entry_metadata_internal(),
  public.journal_entry_json_internal(uuid) from public,anon,authenticated,service_role;

do $$ declare signature text; begin
  foreach signature in array array[
    'public.get_journal_roster(date)',
    'public.register_journal_roster(date,uuid[],uuid)',
    'public.set_journal_entry_status(uuid,integer,text,uuid)',
    'public.remove_journal_roster_entry(uuid,integer,uuid)'
  ] loop
    execute format('revoke all on function %s from public,anon',signature);
    execute format('grant execute on function %s to authenticated,service_role',signature);
  end loop;
end $$;

commit;
