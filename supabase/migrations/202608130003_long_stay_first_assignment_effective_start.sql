-- Align first Long Stay runtime creation with the first managed service month.
begin;

do $guard$
declare
  confirm_source text;
  availability_source text;
begin
  if to_regprocedure('public.long_stay_first_assignment_effective_date_internal(date,date)') is not null then
    raise exception 'STOP_LONG_STAY_EFFECTIVE_START_ALREADY_APPLIED';
  end if;

  select p.prosrc into confirm_source
  from pg_proc p
  where p.oid=to_regprocedure('public.confirm_long_stay_month(uuid,integer,date,uuid,uuid,time without time zone,boolean,uuid,uuid,uuid[],text,uuid)');
  select p.prosrc into availability_source
  from pg_proc p
  where p.oid=to_regprocedure('public.get_long_stay_room_availability(uuid,date,time without time zone,boolean)');

  if confirm_source is null
    or md5(confirm_source)<>'64d86aa3e90d8261eaf7f716a9ed5280'
    or position('using errcode=''PT409''' in confirm_source)=0
    or position('contract_row.started_on,p_check_in_time' in confirm_source)=0
    or availability_source is null
    or position('then contract_row.started_on::timestamp at time zone ''Asia/Seoul''' in availability_source)=0
    or position('else ''계약 시작 이후 사용 이력과 겹침''' in availability_source)=0 then
    raise exception 'STOP_LONG_STAY_EFFECTIVE_START_BEFORE_CONTRACT';
  end if;
end;
$guard$;

create function public.long_stay_first_assignment_effective_date_internal(
  p_started_on date,
  p_service_month date
)
returns date
language sql
immutable
strict
security invoker
set search_path=public,pg_temp
as $$
  select greatest(p_started_on,p_service_month)
$$;

revoke all on function public.long_stay_first_assignment_effective_date_internal(date,date)
  from public,anon,authenticated,service_role;
grant execute on function public.long_stay_first_assignment_effective_date_internal(date,date)
  to postgres;

do $rewrite$
declare
  target regprocedure;
  definition_before text;
  definition_after text;
begin
  target:='public.get_long_stay_room_availability(uuid,date,time without time zone,boolean)'::regprocedure;
  select pg_get_functiondef(target) into definition_before;
  definition_after:=replace(
    definition_before,
    'then contract_row.started_on::timestamp at time zone ''Asia/Seoul''',
    'then public.long_stay_first_assignment_effective_date_internal(contract_row.started_on,p_service_month)::timestamp at time zone ''Asia/Seoul'''
  );
  definition_after:=replace(
    definition_after,
    'else (contract_row.started_on::timestamp+p_check_in_time) at time zone ''Asia/Seoul''',
    'else (public.long_stay_first_assignment_effective_date_internal(contract_row.started_on,p_service_month)::timestamp+p_check_in_time) at time zone ''Asia/Seoul'''
  );
  definition_after:=replace(
    definition_after,
    'when allocation.allocated_from>statement_timestamp() then ''future''
        else ''past_overlap''',
    'when allocation.allocated_from<availability_from
          and allocation.allocated_until>availability_from then ''effective_start_overlap''
        when allocation.allocated_from>statement_timestamp() then ''future''
        else ''effective_period_history'''
  );
  definition_after:=replace(
    definition_after,
    'when allocation.allocated_from>statement_timestamp() then ''미래 예약 있음''
        else ''계약 시작 이후 사용 이력과 겹침''',
    'when allocation.allocated_from<availability_from
          and allocation.allocated_until>availability_from then ''배정 시작 구간과 겹침''
        when allocation.allocated_from>statement_timestamp() then ''미래 예약 있음''
        else ''배정 대상 기간의 종료 이력과 겹침'''
  );
  if definition_after=definition_before
    or position('contract_row.started_on::timestamp at time zone ''Asia/Seoul''' in definition_after)>0
    or position('(contract_row.started_on::timestamp+p_check_in_time)' in definition_after)>0
    or position('계약 시작 이후 사용 이력과 겹침' in definition_after)>0
    or position('effective_period_history' in definition_after)=0 then
    raise exception 'STOP_LONG_STAY_EFFECTIVE_START_AVAILABILITY_REWRITE';
  end if;
  execute definition_after;

  target:='public.confirm_long_stay_month(uuid,integer,date,uuid,uuid,time without time zone,boolean,uuid,uuid,uuid[],text,uuid)'::regprocedure;
  select pg_get_functiondef(target) into definition_before;
  definition_after:=replace(
    definition_before,
    'month_from:=greatest(p_service_month::timestamp at time zone ''Asia/Seoul'',contract_row.started_on::timestamp at time zone ''Asia/Seoul'');',
    'month_from:=public.long_stay_first_assignment_effective_date_internal(contract_row.started_on,p_service_month)::timestamp at time zone ''Asia/Seoul'';'
  );
  definition_after:=replace(
    definition_after,
    'p_calendar_id,p_schedule_type_id,contract_row.started_on,p_check_in_time,',
    'p_calendar_id,p_schedule_type_id,public.long_stay_first_assignment_effective_date_internal(contract_row.started_on,p_service_month),p_check_in_time,'
  );
  if definition_after=definition_before
    or position('month_from:=greatest(p_service_month::timestamp at time zone ''Asia/Seoul'',contract_row.started_on::timestamp at time zone ''Asia/Seoul'');' in definition_after)>0
    or position('p_calendar_id,p_schedule_type_id,contract_row.started_on,p_check_in_time,' in definition_after)>0
    or position('using errcode=''PT409''' in definition_after)=0 then
    raise exception 'STOP_LONG_STAY_EFFECTIVE_START_CONFIRM_REWRITE';
  end if;
  execute definition_after;
end;
$rewrite$;

commit;
