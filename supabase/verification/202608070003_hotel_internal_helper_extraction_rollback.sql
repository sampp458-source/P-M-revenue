-- Restores the three approved public source bodies and removes only the three
-- helpers created by the extraction migration.

begin;

do $rollback$
declare
  create_comment text;
  cross_comment jsonb;
  create_body text;
  before_body text;
  after_body text;
  mismatch text;
begin
  with expected(identity, fingerprint) as (
    values
      ('public.create_flexible_hotel_reservation(uuid,uuid,date,time without time zone,boolean,date,time without time zone,boolean,uuid,uuid,uuid,uuid[],text,uuid)', 'cca668cd6142942eb9af87dcfada05d8'),
      ('public.change_room_type_before_check_in(uuid,integer,uuid,text,uuid)', 'e18904d6698133d3b735af55d3e2209f'),
      ('public.change_room_type_after_check_in(uuid,integer,uuid,timestamp with time zone,text,uuid)', '34804fd6ef82d8ac99cd042816d3e93b'),
      ('public.prepare_hotel_reservation_runtime_input_internal(uuid,uuid,date,time without time zone,boolean,date,time without time zone,boolean,uuid,uuid,uuid,uuid[],text)', '471673afbfe5dfff9fcac28356b07603'),
      ('public.create_hotel_reservation_runtime_internal(uuid,uuid,uuid,uuid,uuid[],text,uuid,uuid,uuid,uuid,jsonb)', '48d9146603c1462a02cb8df65458cc8f'),
      ('public.change_hotel_room_type_and_allocation_internal(text,uuid,integer,uuid,uuid,text,text,timestamp with time zone,text,text,uuid,uuid)', '2a344bee4a21279f1d6a4a7c4dac1445')
  )
  select string_agg(expected.identity, ', ' order by expected.identity)
  into mismatch
  from expected
  left join pg_proc procedure_row
    on procedure_row.oid = to_regprocedure(expected.identity)
  where procedure_row.oid is null
     or md5(procedure_row.prosrc) <> expected.fingerprint;
  if mismatch is not null then
    raise exception 'STOP_HOTEL_HELPER_EXTRACTION_ROLLBACK_SOURCE_DRIFT: %', mismatch;
  end if;

  select obj_description(
    'public.create_hotel_reservation_runtime_internal(uuid,uuid,uuid,uuid,uuid[],text,uuid,uuid,uuid,uuid,jsonb)'::regprocedure,
    'pg_proc'
  ) into create_comment;
  select obj_description(
    'public.change_hotel_room_type_and_allocation_internal(text,uuid,integer,uuid,uuid,text,text,timestamp with time zone,text,text,uuid,uuid)'::regprocedure,
    'pg_proc'
  )::jsonb into cross_comment;

  if create_comment not like 'hotel-helper-rollback:create:%'
    or cross_comment ->> 'contract' <> 'hotel-helper-rollback:cross-type' then
    raise exception 'STOP_HOTEL_HELPER_EXTRACTION_ROLLBACK_BACKUP_MISSING';
  end if;

  create_body := convert_from(
    decode(substr(create_comment, length('hotel-helper-rollback:create:') + 1), 'base64'),
    'UTF8'
  );
  before_body := convert_from(decode(cross_comment ->> 'before', 'base64'), 'UTF8');
  after_body := convert_from(decode(cross_comment ->> 'after', 'base64'), 'UTF8');

  if md5(create_body) <> 'cad788cb79875fab06f0d84470da4698'
    or md5(before_body) <> '39c760d45df40a92cb3b82ceea8a48ea'
    or md5(after_body) <> '7b2a2f0b1c24a3a6d92ac37d400c97d7' then
    raise exception 'STOP_HOTEL_HELPER_EXTRACTION_ROLLBACK_BACKUP_FINGERPRINT';
  end if;

  execute format($ddl$
    create or replace function public.create_flexible_hotel_reservation(
      p_calendar_id uuid, p_schedule_type_id uuid,
      p_check_in_date date, p_check_in_time time,
      p_check_in_time_unspecified boolean,
      p_check_out_date date, p_check_out_time time,
      p_check_out_time_unspecified boolean,
      p_room_type_id uuid, p_dog_id uuid, p_customer_id uuid,
      p_assignee_ids uuid[], p_memo text, p_request_id uuid
    ) returns jsonb language plpgsql security definer
      set search_path = public, pg_temp as %L
  $ddl$, create_body);

  execute format($ddl$
    create or replace function public.change_room_type_before_check_in(
      p_hotel_stay_id uuid, p_expected_version integer,
      p_new_room_id uuid, p_reason text, p_request_id uuid
    ) returns jsonb language plpgsql security definer
      set search_path = public, pg_temp as %L
  $ddl$, before_body);

  execute format($ddl$
    create or replace function public.change_room_type_after_check_in(
      p_hotel_stay_id uuid, p_expected_version integer,
      p_new_room_id uuid, p_effective_at timestamptz,
      p_reason text, p_request_id uuid
    ) returns jsonb language plpgsql security definer
      set search_path = public, pg_temp as %L
  $ddl$, after_body);
end;
$rollback$;

revoke all on function public.create_flexible_hotel_reservation(
  uuid, uuid, date, time, boolean, date, time, boolean,
  uuid, uuid, uuid, uuid[], text, uuid
) from public, anon;
grant execute on function public.create_flexible_hotel_reservation(
  uuid, uuid, date, time, boolean, date, time, boolean,
  uuid, uuid, uuid, uuid[], text, uuid
) to authenticated, service_role;
revoke all on function public.change_room_type_before_check_in(
  uuid, integer, uuid, text, uuid
) from public, anon;
grant execute on function public.change_room_type_before_check_in(
  uuid, integer, uuid, text, uuid
) to authenticated, service_role;
revoke all on function public.change_room_type_after_check_in(
  uuid, integer, uuid, timestamptz, text, uuid
) from public, anon;
grant execute on function public.change_room_type_after_check_in(
  uuid, integer, uuid, timestamptz, text, uuid
) to authenticated, service_role;

drop function public.change_hotel_room_type_and_allocation_internal(
  text, uuid, integer, uuid, uuid, text, text, timestamptz,
  text, text, uuid, uuid
);
drop function public.create_hotel_reservation_runtime_internal(
  uuid, uuid, uuid, uuid, uuid[], text, uuid, uuid, uuid, uuid, jsonb
);
drop function public.prepare_hotel_reservation_runtime_input_internal(
  uuid, uuid, date, time, boolean, date, time, boolean,
  uuid, uuid, uuid, uuid[], text
);

do $verify$
declare
  mismatch text;
  acl_mismatch text;
begin
  with expected(identity, fingerprint) as (
    values
      ('public.create_flexible_hotel_reservation(uuid,uuid,date,time without time zone,boolean,date,time without time zone,boolean,uuid,uuid,uuid,uuid[],text,uuid)', 'cad788cb79875fab06f0d84470da4698'),
      ('public.change_room_type_before_check_in(uuid,integer,uuid,text,uuid)', '39c760d45df40a92cb3b82ceea8a48ea'),
      ('public.change_room_type_after_check_in(uuid,integer,uuid,timestamp with time zone,text,uuid)', '7b2a2f0b1c24a3a6d92ac37d400c97d7'),
      ('public.complete_hotel_check_out(uuid,integer,timestamp with time zone,uuid)', '7744baa7276dcb70676ec593e8ddc0e6'),
      ('public.reverse_hotel_completion(uuid,integer,text,text,uuid)', 'dd4dd04865adfa2dc3ec83097e2b81a3'),
      ('public.get_hotel_operations_snapshot_v2(date)', '7dac53943e2f74f207de1cd36d5023fb')
  )
  select string_agg(expected.identity, ', ' order by expected.identity)
  into mismatch
  from expected
  left join pg_proc procedure_row
    on procedure_row.oid = to_regprocedure(expected.identity)
  where procedure_row.oid is null
     or md5(procedure_row.prosrc) <> expected.fingerprint;
  if mismatch is not null then
    raise exception 'STOP_HOTEL_HELPER_EXTRACTION_ROLLBACK_VERIFY: %', mismatch;
  end if;

  with target(identity) as (
    values
      ('public.create_flexible_hotel_reservation(uuid,uuid,date,time without time zone,boolean,date,time without time zone,boolean,uuid,uuid,uuid,uuid[],text,uuid)'),
      ('public.change_room_type_before_check_in(uuid,integer,uuid,text,uuid)'),
      ('public.change_room_type_after_check_in(uuid,integer,uuid,timestamp with time zone,text,uuid)')
  ), actual_acl as (
    select
      target.identity,
      coalesce(array(
        select distinct pg_get_userbyid(item.grantee)::text
        from aclexplode(coalesce(
          procedure_row.proacl,
          acldefault('f', procedure_row.proowner)
        )) item
        where item.privilege_type = 'EXECUTE'
        order by 1
      ), '{}'::text[]) execute_grantees
    from target
    left join pg_proc procedure_row
      on procedure_row.oid = to_regprocedure(target.identity)
  )
  select string_agg(identity, ', ' order by identity)
  into acl_mismatch
  from actual_acl
  where execute_grantees <>
    array['authenticated', 'postgres', 'service_role']::text[];

  if acl_mismatch is not null then
    raise exception 'STOP_HOTEL_HELPER_EXTRACTION_ROLLBACK_ACL: %', acl_mismatch;
  end if;
end;
$verify$;

commit;
