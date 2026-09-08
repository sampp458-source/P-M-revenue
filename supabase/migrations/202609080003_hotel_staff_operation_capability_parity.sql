-- Hotel operation capability parity. Authorization-only append migration.
begin;

do $$
begin
  if to_regprocedure('public.can_operate_hotel()') is not null then
    raise exception 'STOP_HOTEL_CAPABILITY_HELPER_ALREADY_EXISTS';
  end if;
end;
$$;

create function public.can_operate_hotel()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_active_operation_member();
$$;

comment on function public.can_operate_hotel()
is 'Hotel-scoped operational capability for active Operations members; does not grant Hotel settings or cross-business administration.';

revoke all on function public.can_operate_hotel() from public, anon;
grant execute on function public.can_operate_hotel() to authenticated, service_role;

do $$
declare
  target_signatures constant text[] := array[
    'public.change_room_type_before_check_in(uuid,integer,uuid,text,uuid)',
    'public.change_room_type_after_check_in(uuid,integer,uuid,timestamp with time zone,text,uuid)',
    'public.reverse_hotel_completion(uuid,integer,text,text,uuid)',
    'public.reverse_check_in_and_unassign_hotel_room(uuid,integer,text,uuid)',
    'public.reverse_shared_hotel_member_completion(uuid,uuid,integer,integer,text,uuid)',
    'public.reverse_shared_hotel_member_check_in(uuid,uuid,integer,integer,text,uuid)',
    'public.reverse_check_in_and_unassign_shared_hotel_room(uuid,integer,text,uuid)',
    'public.create_long_stay_contract(uuid,uuid,date,date,uuid,uuid,numeric,integer,text,uuid)',
    'public.confirm_long_stay_month(uuid,integer,date,uuid,uuid,time without time zone,boolean,uuid,uuid,uuid[],text,uuid)',
    'public.confirm_long_stay_month_v2(uuid,integer,date,date,uuid,uuid,time without time zone,boolean,uuid,uuid,uuid[],text,uuid)',
    'public.set_long_stay_planned_checkout(uuid,integer,date,uuid,uuid,time without time zone,boolean,uuid[],text,uuid)',
    'public.reverse_long_stay_completion(uuid,integer,integer,text,uuid)'
  ];
  owner_manager_guard constant text := 'public\.has_operation_role\s*\(\s*array\s*\[\s*''owner''\s*,\s*''manager''\s*\]\s*\)';
  target_signature text;
  target_oid regprocedure;
  target_definition text;
  replaced_definition text;
  guard_count integer;
begin
  if cardinality(target_signatures) <> 12 then
    raise exception 'STOP_HOTEL_OPERATION_ALLOWLIST_CARDINALITY';
  end if;

  foreach target_signature in array target_signatures loop
    target_oid := to_regprocedure(target_signature);
    if target_oid is null then
      raise exception 'STOP_HOTEL_OPERATION_RPC_MISSING: %', target_signature;
    end if;

    select count(*) into guard_count
    from regexp_matches(
      (select procedure_row.prosrc from pg_proc procedure_row where procedure_row.oid = target_oid),
      owner_manager_guard,
      'gi'
    );
    if guard_count <> 1 then
      raise exception 'STOP_HOTEL_OPERATION_AUTH_GUARD_DRIFT: % guard_count=%', target_signature, guard_count;
    end if;

    target_definition := pg_get_functiondef(target_oid);
    replaced_definition := regexp_replace(
      target_definition,
      owner_manager_guard,
      'public.can_operate_hotel()',
      'gi'
    );
    if replaced_definition = target_definition then
      raise exception 'STOP_HOTEL_OPERATION_AUTH_REPLACEMENT_FAILED: %', target_signature;
    end if;
    execute replaced_definition;
  end loop;

  foreach target_signature in array target_signatures loop
    target_oid := to_regprocedure(target_signature);
    select count(*) into guard_count
    from regexp_matches(
      (select procedure_row.prosrc from pg_proc procedure_row where procedure_row.oid = target_oid),
      'public\.can_operate_hotel\s*\(\s*\)',
      'gi'
    );
    if guard_count <> 1 then
      raise exception 'STOP_HOTEL_OPERATION_CAPABILITY_GUARD_NOT_INSTALLED: %', target_signature;
    end if;
  end loop;

  if not coalesce((
    select procedure_row.prosrc ~ owner_manager_guard
    from pg_proc procedure_row
    where procedure_row.oid = to_regprocedure(
      'public.update_hotel_operation_settings(integer,time without time zone,time without time zone,uuid)'
    )
  ), false) then
    raise exception 'STOP_HOTEL_SETTINGS_OWNER_MANAGER_GUARD_DRIFT';
  end if;
end;
$$;

commit;
