begin;
select hotel_qa.assert_isolated_environment();
do $session$
declare c hotel_qa.hotel_lifecycle_2session_context%rowtype; started timestamptz; result jsonb;
begin
  select * into c from hotel_qa.hotel_lifecycle_2session_context where singleton;
  perform set_config('request.jwt.claim.sub',c.actor_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',c.actor_id,'role','authenticated')::text,true);
  perform pg_sleep(greatest(0,extract(epoch from c.start_at-clock_timestamp())));
  started:=clock_timestamp();
  begin
    result:=public.update_checked_in_hotel_planned_checkout(
      c.stay_id,c.expected_version,date '2099-12-04',time '11:00',false,c.request_a
    );
    insert into hotel_qa.hotel_lifecycle_2session_results
      values('A',true,null,(result->>'version')::integer,started,clock_timestamp());
  exception when others then
    insert into hotel_qa.hotel_lifecycle_2session_results
      values('A',false,sqlstate,null,started,clock_timestamp());
  end;
end;
$session$;
commit;
select 'HOTEL_LIFECYCLE_2SESSION_A_DONE' status;
