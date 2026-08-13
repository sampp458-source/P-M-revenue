begin read only;
select hotel_qa.assert_isolated_environment();
do $results$
declare c hotel_qa.hotel_lifecycle_2session_context%rowtype;
begin
  select * into c from hotel_qa.hotel_lifecycle_2session_context where singleton;
  if (select count(*) from hotel_qa.hotel_lifecycle_2session_results)<>2
    or (select count(*) from hotel_qa.hotel_lifecycle_2session_results where succeeded)<>1
    or (select count(*) from hotel_qa.hotel_lifecycle_2session_results where sqlstate='PT409')<>1
    or exists(select 1 from hotel_qa.hotel_lifecycle_2session_results where sqlstate='40P01')
    or (select count(*) from public.hotel_planned_checkout_requests
        where request_id in(c.request_a,c.request_b))<>1
    or (select version from public.hotel_stays where id=c.stay_id)<>c.expected_version+1 then
    raise exception 'STOP_HOTEL_LIFECYCLE_2SESSION_RESULT';
  end if;
end;
$results$;
select 'HOTEL_LIFECYCLE_2SESSION_READY' status,
  (select jsonb_agg(jsonb_build_object(
    'session',session_code,'succeeded',succeeded,'sqlstate',sqlstate
  ) order by session_code) from hotel_qa.hotel_lifecycle_2session_results) sessions,
  1 winner,1 approved_conflict_loser,0 deadlocks;
rollback;
