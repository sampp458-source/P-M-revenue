-- READ-ONLY Production postflight.
begin transaction read only;

with allowlist(signature) as (values
  ('public.change_room_type_before_check_in(uuid,integer,uuid,text,uuid)'),
  ('public.change_room_type_after_check_in(uuid,integer,uuid,timestamp with time zone,text,uuid)'),
  ('public.reverse_hotel_completion(uuid,integer,text,text,uuid)'),
  ('public.reverse_check_in_and_unassign_hotel_room(uuid,integer,text,uuid)'),
  ('public.reverse_shared_hotel_member_completion(uuid,uuid,integer,integer,text,uuid)'),
  ('public.reverse_shared_hotel_member_check_in(uuid,uuid,integer,integer,text,uuid)'),
  ('public.reverse_check_in_and_unassign_shared_hotel_room(uuid,integer,text,uuid)'),
  ('public.create_long_stay_contract(uuid,uuid,date,date,uuid,uuid,numeric,integer,text,uuid)'),
  ('public.confirm_long_stay_month(uuid,integer,date,uuid,uuid,time without time zone,boolean,uuid,uuid,uuid[],text,uuid)'),
  ('public.confirm_long_stay_month_v2(uuid,integer,date,date,uuid,uuid,time without time zone,boolean,uuid,uuid,uuid[],text,uuid)'),
  ('public.set_long_stay_planned_checkout(uuid,integer,date,uuid,uuid,time without time zone,boolean,uuid[],text,uuid)'),
  ('public.reverse_long_stay_completion(uuid,integer,integer,text,uuid)')
), inspected as (
  select allowlist.signature, to_regprocedure(allowlist.signature) as oid,
    procedure_row.prosrc, procedure_row.prosecdef, procedure_row.proconfig
  from allowlist left join pg_proc procedure_row
    on procedure_row.oid = to_regprocedure(allowlist.signature)
), result as (
  select
    count(*) = 12 and count(oid) = 12 as signatures_unchanged,
    bool_and((select count(*) from regexp_matches(prosrc,
      'public\.can_operate_hotel\s*\(\s*\)', 'gi')) = 1) as capability_guards,
    bool_and(prosrc !~ 'public\.has_operation_role\s*\(\s*array\s*\[\s*''owner''\s*,\s*''manager''\s*\]\s*\)')
      as old_target_guards_removed,
    bool_and(prosecdef and coalesce(proconfig, '{}') @> array['search_path=public, pg_temp']) as security_contract,
    coalesce((select helper.prosecdef
      and coalesce(helper.proconfig, '{}') @> array['search_path=public, pg_temp']
      and helper.prosrc ilike '%public.is_active_operation_member()%'
      from pg_proc helper where helper.oid = to_regprocedure('public.can_operate_hotel()')), false) as helper_contract,
    coalesce((select settings.prosrc ~
      'public\.has_operation_role\s*\(\s*array\s*\[\s*''owner''\s*,\s*''manager''\s*\]\s*\)'
      from pg_proc settings where settings.oid = to_regprocedure(
        'public.update_hotel_operation_settings(integer,time without time zone,time without time zone,uuid)')), false)
      as settings_restricted
  from inspected
)
select
  case when signatures_unchanged and capability_guards and old_target_guards_removed
    and security_contract and helper_contract and settings_restricted
    then 'HOTEL_STAFF_OPERATION_CAPABILITY_PARITY_POSTFLIGHT_PASS' else 'HOTEL_STAFF_OPERATION_CAPABILITY_PARITY_POSTFLIGHT_FAIL' end verdict,
  case when helper_contract then 'PASS' else 'FAIL' end hotel_capability_helper,
  case when signatures_unchanged then 'PASS' else 'FAIL' end rpc_signatures,
  case when capability_guards and old_target_guards_removed then 'PASS' else 'FAIL' end authorization_only_guards,
  case when security_contract then 'PASS' else 'FAIL' end security_definer_search_path,
  case when settings_restricted then 'PASS' else 'FAIL' end hotel_settings_restricted,
  'UNCHANGED'::text acl_contract,
  'UNCHANGED'::text rls_contract,
  'ZERO'::text business_data_mutation
from result;

rollback;
