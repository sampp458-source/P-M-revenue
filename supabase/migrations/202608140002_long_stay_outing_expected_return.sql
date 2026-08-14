-- Long Stay outing lifecycle repair and lossless expected-return semantics.
-- Existing RPC signatures and historical expected_return_at values remain valid.
begin;

do $$
begin
  if to_regprocedure('public.start_long_stay_absence_v2(uuid,integer,timestamp with time zone,date,time without time zone,boolean,text,text,uuid)') is not null
    or to_regprocedure('public.get_long_stay_month_v2(date)') is not null
    or exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name='long_stay_absence_events'
        and column_name in ('expected_return_date','expected_return_time_unspecified')
    ) then
    raise exception 'STOP_LONG_STAY_OUTING_EXPECTED_RETURN_ALREADY_APPLIED';
  end if;
end;
$$;

alter table public.long_stay_absence_events
  add column expected_return_date date null,
  add column expected_return_time_unspecified boolean not null default false;

alter table public.long_stay_absence_events
  add constraint long_stay_absence_expected_return_semantics_chk check (
    (event_type='return'
      and expected_return_at is null
      and expected_return_date is null
      and not expected_return_time_unspecified)
    or
    (event_type='leave' and (
      (expected_return_date is null and (expected_return_at is null or not expected_return_time_unspecified))
      or
      (expected_return_date is not null and expected_return_time_unspecified and expected_return_at is null)
      or
      (expected_return_date is not null and not expected_return_time_unspecified and expected_return_at is not null)
    ))
  );

comment on column public.long_stay_absence_events.expected_return_date is
  'Expected KST calendar return date; null means the date is unknown.';
comment on column public.long_stay_absence_events.expected_return_time_unspecified is
  'True when an expected date is known but its time is intentionally unspecified; date-null also implies unknown time.';

create function public.long_stay_current_absence_projection_internal(p_contract_id uuid)
returns jsonb language sql stable security definer
set search_path=public,pg_temp
as $$
  select jsonb_build_object(
    'currentAbsence', case when leave_event.id is null then null else jsonb_build_object(
      'id',leave_event.id,
      'leftAt',leave_event.occurred_at,
      'expectedReturnAt',leave_event.expected_return_at,
      'expectedReturnDate',coalesce(
        leave_event.expected_return_date,
        (leave_event.expected_return_at at time zone 'Asia/Seoul')::date
      ),
      'expectedReturnTimeUnspecified',case
        when leave_event.expected_return_date is null and leave_event.expected_return_at is null then true
        else leave_event.expected_return_time_unspecified
      end
    ) end
  )
  from (select 1) seed
  left join lateral (
    select event.*
    from public.long_stay_absence_events event
    where event.long_stay_contract_id=p_contract_id
      and event.event_type='leave'
      and event.is_open
      and event.archived_at is null
    order by event.occurred_at desc,event.id
    limit 1
  ) leave_event on true;
$$;

create function public.get_long_stay_month_v2(p_service_month date)
returns jsonb language plpgsql stable security definer
set search_path=public,pg_temp
as $$
declare base jsonb; enriched jsonb;
begin
  base:=public.get_long_stay_month(p_service_month);
  select coalesce(jsonb_agg(
    item.value||public.long_stay_current_absence_projection_internal((item.value->>'id')::uuid)
    order by item.ordinality
  ),'[]'::jsonb)
  into enriched
  from jsonb_array_elements(base->'contracts') with ordinality item(value,ordinality);
  return jsonb_set(base,'{contracts}',enriched);
end;
$$;

create function public.start_long_stay_absence_v2(
  p_contract_id uuid,
  p_expected_contract_version integer,
  p_left_at timestamptz,
  p_expected_return_date date,
  p_expected_return_time time,
  p_expected_return_time_unspecified boolean,
  p_memo text,
  p_reason text,
  p_request_id uuid
)
returns jsonb language plpgsql security definer
set search_path=public,pg_temp
as $$
declare actor_id uuid:=auth.uid(); contract_row public.long_stay_contracts%rowtype;
declare stay_row public.hotel_stays%rowtype; replay jsonb; payload jsonb; event_id uuid;
declare expected_return_at_value timestamptz;
begin
  if actor_id is null or not public.is_active_operation_member() then
    raise exception '외출 기록 권한이 없습니다.' using errcode='42501';
  end if;
  if p_left_at is null or nullif(btrim(p_reason),'') is null then
    raise exception '외출 시각과 처리 사유가 필요합니다.' using errcode='22023';
  end if;
  if p_expected_return_date is null then
    if p_expected_return_time is not null or not coalesce(p_expected_return_time_unspecified,false) then
      raise exception '예상 복귀 날짜 미정이면 시간도 미정이어야 합니다.' using errcode='22023';
    end if;
    expected_return_at_value:=null;
  elsif coalesce(p_expected_return_time_unspecified,false) then
    if p_expected_return_time is not null then
      raise exception '예상 복귀 시간 미정에는 시간값을 함께 저장할 수 없습니다.' using errcode='22023';
    end if;
    expected_return_at_value:=null;
  else
    if p_expected_return_time is null then
      raise exception '예상 복귀 시간을 입력하거나 시간 미정을 선택해 주세요.' using errcode='22023';
    end if;
    expected_return_at_value:=(p_expected_return_date::timestamp+p_expected_return_time) at time zone 'Asia/Seoul';
    if expected_return_at_value<p_left_at then
      raise exception '예상 복귀는 외출 시각보다 빠를 수 없습니다.' using errcode='22023';
    end if;
  end if;

  payload:=jsonb_build_object(
    'contractId',p_contract_id,'leftAt',p_left_at,
    'expectedReturnDate',p_expected_return_date,
    'expectedReturnTime',p_expected_return_time,
    'expectedReturnTimeUnspecified',coalesce(p_expected_return_time_unspecified,false),
    'memo',nullif(btrim(p_memo),''),'reason',nullif(btrim(p_reason),'')
  );
  replay:=public.long_stay_replay_internal(p_request_id,'start_absence',payload);
  if replay is not null then
    return replay||public.long_stay_current_absence_projection_internal(p_contract_id);
  end if;

  select * into contract_row
  from public.long_stay_contracts
  where id=p_contract_id and archived_at is null
  for update;
  if not found then raise exception '장기호텔 계약을 찾을 수 없습니다.' using errcode='P0002'; end if;
  if contract_row.version<>p_expected_contract_version then
    raise exception '다른 사용자가 먼저 변경했습니다.' using errcode='PT409';
  end if;
  select * into stay_row
  from public.hotel_stays
  where id=contract_row.current_hotel_stay_id and archived_at is null
  for update;
  if contract_row.status not in ('pending','active')
    or stay_row.id is null
    or stay_row.checked_in_at is null
    or stay_row.checked_out_at is not null then
    raise exception '입실 중인 장기호텔만 외출 처리할 수 있습니다.' using errcode='22023';
  end if;
  if exists(
    select 1 from public.long_stay_absence_events event
    where event.long_stay_contract_id=p_contract_id
      and event.event_type='leave' and event.is_open and event.archived_at is null
  ) then
    raise exception '이미 외출 중입니다.' using errcode='23505';
  end if;

  insert into public.long_stay_absence_events(
    long_stay_contract_id,hotel_stay_id,event_type,is_open,occurred_at,
    expected_return_at,expected_return_date,expected_return_time_unspecified,
    memo,reason,request_id,created_by
  ) values(
    p_contract_id,contract_row.current_hotel_stay_id,'leave',true,p_left_at,
    expected_return_at_value,p_expected_return_date,coalesce(p_expected_return_time_unspecified,false),
    nullif(btrim(p_memo),''),btrim(p_reason),p_request_id,actor_id
  ) returning id into event_id;

  update public.long_stay_contracts
  set status='active',version=version+1,updated_by=actor_id,updated_at=clock_timestamp()
  where id=p_contract_id;
  perform public.long_stay_record_operation_internal(
    p_contract_id,null,event_id,'start_absence',p_request_id,payload,null,'{}',p_reason,actor_id
  );
  return public.long_stay_contract_projection_internal(p_contract_id)
    ||public.long_stay_current_absence_projection_internal(p_contract_id)
    ||jsonb_build_object('replayed',false);
end;
$$;

revoke all on function public.long_stay_current_absence_projection_internal(uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.get_long_stay_month_v2(date)
  from public,anon;
grant execute on function public.get_long_stay_month_v2(date)
  to authenticated,service_role;
revoke all on function public.start_long_stay_absence_v2(uuid,integer,timestamptz,date,time,boolean,text,text,uuid)
  from public,anon;
grant execute on function public.start_long_stay_absence_v2(uuid,integer,timestamptz,date,time,boolean,text,text,uuid)
  to authenticated,service_role;

comment on function public.start_long_stay_absence_v2(uuid,integer,timestamptz,date,time,boolean,text,text,uuid) is
  'Starts a Long Stay outing using the linked checked-in Hotel runtime; preserves room/capacity and losslessly stores expected-return uncertainty.';

commit;
