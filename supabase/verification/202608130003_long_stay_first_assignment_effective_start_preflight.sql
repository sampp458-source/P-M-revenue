begin read only;

with target as (
  select
    to_regprocedure('public.long_stay_first_assignment_effective_date_internal(date,date)') helper,
    (select p.prosrc from pg_proc p where p.oid=to_regprocedure('public.confirm_long_stay_month(uuid,integer,date,uuid,uuid,time without time zone,boolean,uuid,uuid,uuid[],text,uuid)')) confirm_source,
    (select p.prosrc from pg_proc p where p.oid=to_regprocedure('public.get_long_stay_room_availability(uuid,date,time without time zone,boolean)')) availability_source
)
select case when helper is null
  and md5(confirm_source)='64d86aa3e90d8261eaf7f716a9ed5280'
  and position('using errcode=''PT409''' in confirm_source)>0
  and position('contract_row.started_on,p_check_in_time' in confirm_source)>0
  and position('then contract_row.started_on::timestamp at time zone ''Asia/Seoul''' in availability_source)>0
then 'READY_TO_APPLY_LONG_STAY_FIRST_ASSIGNMENT_EFFECTIVE_START'
else 'STOP_LONG_STAY_FIRST_ASSIGNMENT_EFFECTIVE_START_PREFLIGHT' end status
from target;

rollback;
