-- P&M Journal: selected-day default activity names copied into new entry snapshots.
begin;

do $$
begin
  if to_regclass('public.journal_days') is null
    or to_regclass('public.journal_entries') is null
    or to_regprocedure('public.get_journal_roster(date)') is null
    or to_regprocedure('public.register_journal_roster(date,uuid[],uuid)') is null
    or to_regprocedure('public.is_active_operation_member()') is null then
    raise exception 'STOP_JOURNAL_DAY_DEFAULT_BASELINE_MISSING';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'journal_days'
      and column_name in ('default_manners_activity_name','default_physical_activity_name','default_activities_version')
  ) or to_regprocedure('public.register_journal_roster_v2(date,uuid[],text,text,integer,uuid)') is not null
    or to_regprocedure('public.update_journal_day_default_activities(uuid,integer,text,text,uuid)') is not null then
    raise exception 'STOP_JOURNAL_DAY_DEFAULT_ALREADY_APPLIED';
  end if;
end;
$$;

alter table public.journal_days
  add column default_manners_activity_name text null,
  add column default_physical_activity_name text null,
  add column default_activities_version integer not null default 1,
  add constraint journal_days_default_manners_activity_length
    check (default_manners_activity_name is null or char_length(default_manners_activity_name) <= 80),
  add constraint journal_days_default_physical_activity_length
    check (default_physical_activity_name is null or char_length(default_physical_activity_name) <= 80),
  add constraint journal_days_default_activities_version_positive
    check (default_activities_version > 0);

create or replace function public.get_journal_roster(p_business_date date)
returns jsonb language sql stable security definer
set search_path=public,pg_temp
as $$
  with target_day as (
    select day.id,day.business_date,day.default_manners_activity_name,
      day.default_physical_activity_name,day.default_activities_version
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
    'defaults',jsonb_build_object(
      'mannersActivityName',(select default_manners_activity_name from target_day),
      'physicalActivityName',(select default_physical_activity_name from target_day),
      'version',(select default_activities_version from target_day)
    ),
    'summary',jsonb_build_object(
      'total',count(*),
      'notStarted',count(*) filter(where status='not_started'),
      'inProgress',count(*) filter(where status='in_progress'),
      'completed',count(*) filter(where status='completed')
    ),
    'entries',coalesce(jsonb_agg(payload order by created_at,id) filter(where id is not null),'[]'::jsonb)
  ) from entries;
$$;

create function public.register_journal_roster_v2(
  p_business_date date,
  p_dog_ids uuid[],
  p_default_manners_activity text,
  p_default_physical_activity text,
  p_expected_defaults_version integer,
  p_request_id uuid
)
returns jsonb language plpgsql security definer
set search_path=public,pg_temp
as $$
declare
  actor_id uuid:=auth.uid();
  day_row public.journal_days%rowtype;
  dog_row record;
  inserted_id uuid;
  day_created boolean:=false;
  normalized_manners text:=nullif(btrim(coalesce(p_default_manners_activity,'')),'');
  normalized_physical text:=nullif(btrim(coalesce(p_default_physical_activity,'')),'');
  normalized_dog_ids uuid[];
  request_payload jsonb;
  before_defaults jsonb;
  after_defaults jsonb;
  existing_event public.entity_audit_events%rowtype;
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
  if char_length(coalesce(normalized_manners,''))>80
    or char_length(coalesce(normalized_physical,''))>80 then
    raise exception '공통 활동명은 80자 이하여야 합니다.' using errcode='22023';
  end if;
  if exists(
    select 1 from unnest(p_dog_ids) as selected_dog(dog_id)
    group by selected_dog.dog_id having count(*)>1
  ) then
    raise exception '같은 반려견을 중복 선택할 수 없습니다.' using errcode='22023';
  end if;
  if (select count(*) from public.dogs dog join public.customers customer on customer.id=dog.customer_id
      where dog.id=any(p_dog_ids) and dog.is_active and customer.is_active)
     <> cardinality(p_dog_ids) then
    raise exception '활성 보호자와 소유 반려견 관계를 확인할 수 없습니다.' using errcode='22023';
  end if;

  select array_agg(selected_dog.dog_id order by selected_dog.dog_id)
  into normalized_dog_ids
  from unnest(p_dog_ids) as selected_dog(dog_id);
  request_payload:=jsonb_build_object(
    'businessDate',p_business_date,'dogIds',to_jsonb(normalized_dog_ids),
    'mannersActivityName',normalized_manners,'physicalActivityName',normalized_physical,
    'expectedDefaultsVersion',p_expected_defaults_version
  );
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
  select * into existing_event from public.entity_audit_events audit
  where audit.module_code='journal' and audit.entity_type='journal_days'
    and audit.request_id=p_request_id
    and audit.change_reason='journal_day_default_activities_register'
  order by audit.created_at,audit.id limit 1;
  if found then
    if existing_event.after_data->'request' is distinct from request_payload then
      raise exception '동일 요청 ID가 다른 일지 등록에 사용되었습니다.' using errcode='22023';
    end if;
    return public.get_journal_roster(p_business_date);
  end if;

  insert into public.journal_days(
    business_date,journal_type,created_by,default_manners_activity_name,
    default_physical_activity_name,default_activities_version
  ) values(
    p_business_date,'daycare_daily',actor_id,normalized_manners,normalized_physical,1
  ) on conflict(business_date,journal_type) do nothing
  returning * into day_row;
  day_created:=found;
  if not day_created then
    select * into day_row from public.journal_days
    where business_date=p_business_date and journal_type='daycare_daily'
    for update;
  end if;

  if day_created then
    if p_expected_defaults_version is not null then
      raise exception '다른 직원이 먼저 공통 활동을 변경했습니다.' using errcode='PT409';
    end if;
    before_defaults:=null;
  else
    if p_expected_defaults_version is null
      or day_row.default_activities_version<>p_expected_defaults_version then
      raise exception '다른 직원이 먼저 공통 활동을 변경했습니다.' using errcode='PT409';
    end if;
    before_defaults:=jsonb_build_object(
      'mannersActivityName',day_row.default_manners_activity_name,
      'physicalActivityName',day_row.default_physical_activity_name,
      'version',day_row.default_activities_version
    );
    if day_row.default_manners_activity_name is distinct from normalized_manners
      or day_row.default_physical_activity_name is distinct from normalized_physical then
      update public.journal_days set
        default_manners_activity_name=normalized_manners,
        default_physical_activity_name=normalized_physical,
        default_activities_version=default_activities_version+1,
        updated_at=clock_timestamp()
      where id=day_row.id returning * into day_row;
    end if;
  end if;

  after_defaults:=jsonb_build_object(
    'mannersActivityName',day_row.default_manners_activity_name,
    'physicalActivityName',day_row.default_physical_activity_name,
    'version',day_row.default_activities_version
  );
  insert into public.entity_audit_events(
    module_code,entity_type,entity_id,action,before_data,after_data,
    changed_by,change_reason,request_id
  ) values(
    'journal','journal_days',day_row.id,case when day_created then 'created' else 'updated' end,
    before_defaults,jsonb_build_object('request',request_payload,'defaults',after_defaults),
    actor_id,'journal_day_default_activities_register',p_request_id
  );

  for dog_row in
    select dog.id,dog.customer_id from public.dogs dog
    where dog.id=any(normalized_dog_ids) order by dog.id
  loop
    inserted_id:=null;
    insert into public.journal_entries(
      journal_day_id,dog_id,customer_id,manners_activity_name,
      physical_activity_name,created_by,updated_by
    ) values(
      day_row.id,dog_row.id,dog_row.customer_id,day_row.default_manners_activity_name,
      day_row.default_physical_activity_name,actor_id,actor_id
    ) on conflict(journal_day_id,dog_id) do nothing returning id into inserted_id;
    if inserted_id is not null then
      insert into public.entity_audit_events(
        module_code,entity_type,entity_id,action,after_data,changed_by,change_reason,request_id
      ) values(
        'journal','journal_entries',inserted_id,'created',public.journal_entry_json_internal(inserted_id),
        actor_id,'Journal roster Dog added',p_request_id
      );
    end if;
  end loop;
  return public.get_journal_roster(p_business_date);
end;
$$;

create or replace function public.register_journal_roster(
  p_business_date date,p_dog_ids uuid[],p_request_id uuid
)
returns jsonb language plpgsql security definer
set search_path=public,pg_temp
as $$
declare day_row public.journal_days%rowtype;
begin
  select * into day_row from public.journal_days
  where business_date=p_business_date and journal_type='daycare_daily';
  return public.register_journal_roster_v2(
    p_business_date,p_dog_ids,day_row.default_manners_activity_name,
    day_row.default_physical_activity_name,day_row.default_activities_version,p_request_id
  );
end;
$$;

create function public.update_journal_day_default_activities(
  p_journal_day_id uuid,
  p_expected_version integer,
  p_default_manners_activity text,
  p_default_physical_activity text,
  p_request_id uuid
)
returns jsonb language plpgsql security definer
set search_path=public,pg_temp
as $$
declare
  actor_id uuid:=auth.uid();
  day_row public.journal_days%rowtype;
  existing_event public.entity_audit_events%rowtype;
  normalized_manners text:=nullif(btrim(coalesce(p_default_manners_activity,'')),'');
  normalized_physical text:=nullif(btrim(coalesce(p_default_physical_activity,'')),'');
  request_payload jsonb;
  before_defaults jsonb;
  after_defaults jsonb;
begin
  if actor_id is null or not public.is_active_operation_member() then
    raise exception '공통 활동을 변경할 권한이 없습니다.' using errcode='42501';
  end if;
  if p_journal_day_id is null or p_expected_version is null or p_request_id is null then
    raise exception '일지 날짜, 버전, 요청 ID가 필요합니다.' using errcode='22023';
  end if;
  if char_length(coalesce(normalized_manners,''))>80
    or char_length(coalesce(normalized_physical,''))>80 then
    raise exception '공통 활동명은 80자 이하여야 합니다.' using errcode='22023';
  end if;
  request_payload:=jsonb_build_object(
    'journalDayId',p_journal_day_id,'mannersActivityName',normalized_manners,
    'physicalActivityName',normalized_physical,'expectedVersion',p_expected_version
  );
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
  select * into existing_event from public.entity_audit_events audit
  where audit.module_code='journal' and audit.entity_type='journal_days'
    and audit.entity_id=p_journal_day_id and audit.request_id=p_request_id
    and audit.change_reason='journal_day_default_activities_update'
  order by audit.created_at,audit.id limit 1;
  if found then
    if existing_event.after_data->'request' is distinct from request_payload then
      raise exception '동일 요청 ID가 다른 공통 활동 변경에 사용되었습니다.' using errcode='22023';
    end if;
    select * into day_row from public.journal_days where id=p_journal_day_id;
    return public.get_journal_roster(day_row.business_date);
  end if;

  select * into day_row from public.journal_days where id=p_journal_day_id for update;
  if not found then raise exception '일지 날짜를 찾을 수 없습니다.' using errcode='P0002'; end if;
  if day_row.default_activities_version<>p_expected_version then
    raise exception '다른 직원이 먼저 공통 활동을 변경했습니다.' using errcode='PT409';
  end if;
  before_defaults:=jsonb_build_object(
    'mannersActivityName',day_row.default_manners_activity_name,
    'physicalActivityName',day_row.default_physical_activity_name,
    'version',day_row.default_activities_version
  );
  if day_row.default_manners_activity_name is distinct from normalized_manners
    or day_row.default_physical_activity_name is distinct from normalized_physical then
    update public.journal_days set
      default_manners_activity_name=normalized_manners,
      default_physical_activity_name=normalized_physical,
      default_activities_version=default_activities_version+1,
      updated_at=clock_timestamp()
    where id=day_row.id returning * into day_row;
  end if;
  after_defaults:=jsonb_build_object(
    'mannersActivityName',day_row.default_manners_activity_name,
    'physicalActivityName',day_row.default_physical_activity_name,
    'version',day_row.default_activities_version
  );
  insert into public.entity_audit_events(
    module_code,entity_type,entity_id,action,before_data,after_data,
    changed_by,change_reason,request_id
  ) values(
    'journal','journal_days',day_row.id,'updated',before_defaults,
    jsonb_build_object('request',request_payload,'defaults',after_defaults),
    actor_id,'journal_day_default_activities_update',p_request_id
  );
  return public.get_journal_roster(day_row.business_date);
end;
$$;

revoke all on function public.register_journal_roster_v2(date,uuid[],text,text,integer,uuid),
  public.update_journal_day_default_activities(uuid,integer,text,text,uuid)
  from public,anon;
grant execute on function public.register_journal_roster_v2(date,uuid[],text,text,integer,uuid),
  public.update_journal_day_default_activities(uuid,integer,text,text,uuid)
  to authenticated,service_role;

comment on function public.register_journal_roster_v2(date,uuid[],text,text,integer,uuid) is
  'Atomically saves selected-day activity defaults and snapshots them into newly inserted Journal entries.';
comment on function public.update_journal_day_default_activities(uuid,integer,text,text,uuid) is
  'Updates future-entry-only Journal day defaults with optimistic concurrency and audit evidence.';

commit;
