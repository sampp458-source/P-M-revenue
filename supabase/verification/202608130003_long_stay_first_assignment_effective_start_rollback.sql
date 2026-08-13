begin;

do $rollback$
declare target regprocedure; before_definition text; after_definition text;
begin
  target:='public.get_long_stay_room_availability(uuid,date,time without time zone,boolean)'::regprocedure;
  select pg_get_functiondef(target) into before_definition;
  after_definition:=replace(before_definition,
    'public.long_stay_first_assignment_effective_date_internal(contract_row.started_on,p_service_month)::timestamp',
    'contract_row.started_on::timestamp');
  after_definition:=replace(after_definition,
    'when allocation.allocated_from<availability_from
          and allocation.allocated_until>availability_from then ''effective_start_overlap''
        when allocation.allocated_from>statement_timestamp() then ''future''
        else ''effective_period_history''',
    'when allocation.allocated_from>statement_timestamp() then ''future''
        else ''past_overlap''');
  after_definition:=replace(after_definition,
    'when allocation.allocated_from<availability_from
          and allocation.allocated_until>availability_from then ''배정 시작 구간과 겹침''
        when allocation.allocated_from>statement_timestamp() then ''미래 예약 있음''
        else ''배정 대상 기간의 종료 이력과 겹침''',
    'when allocation.allocated_from>statement_timestamp() then ''미래 예약 있음''
        else ''계약 시작 이후 사용 이력과 겹침''');
  execute after_definition;

  target:='public.confirm_long_stay_month(uuid,integer,date,uuid,uuid,time without time zone,boolean,uuid,uuid,uuid[],text,uuid)'::regprocedure;
  select pg_get_functiondef(target) into before_definition;
  after_definition:=replace(before_definition,
    'month_from:=public.long_stay_first_assignment_effective_date_internal(contract_row.started_on,p_service_month)::timestamp at time zone ''Asia/Seoul'';',
    'month_from:=greatest(p_service_month::timestamp at time zone ''Asia/Seoul'',contract_row.started_on::timestamp at time zone ''Asia/Seoul'');');
  after_definition:=replace(after_definition,
    'p_calendar_id,p_schedule_type_id,public.long_stay_first_assignment_effective_date_internal(contract_row.started_on,p_service_month),p_check_in_time,',
    'p_calendar_id,p_schedule_type_id,contract_row.started_on,p_check_in_time,');
  execute after_definition;
end;
$rollback$;

drop function public.long_stay_first_assignment_effective_date_internal(date,date);
commit;
