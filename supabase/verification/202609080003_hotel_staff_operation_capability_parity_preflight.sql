-- READ-ONLY Production preflight. Do not run the migration unless every gate passes.
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
    procedure_row.prosrc,
    procedure_row.prosecdef,
    procedure_row.proconfig
  from allowlist
  left join pg_proc procedure_row on procedure_row.oid = to_regprocedure(allowlist.signature)
), result as (
  select
    to_regprocedure('public.can_operate_hotel()') is null as helper_absent,
    count(*) = 12 and count(oid) = 12 as allowlist_signatures,
    bool_and(prosecdef and coalesce(proconfig, '{}') @> array['search_path=public, pg_temp']) as security_contract,
    bool_and((select count(*) from regexp_matches(prosrc,
      'public\.has_operation_role\s*\(\s*array\s*\[\s*''owner''\s*,\s*''manager''\s*\]\s*\)', 'gi')) = 1)
      as exact_owner_manager_guards,
    coalesce((select settings.prosrc ~
      'public\.has_operation_role\s*\(\s*array\s*\[\s*''owner''\s*,\s*''manager''\s*\]\s*\)'
      from pg_proc settings where settings.oid = to_regprocedure(
        'public.update_hotel_operation_settings(integer,time without time zone,time without time zone,uuid)')), false)
      as settings_restricted,
    coalesce((select member.prosrc ilike '%membership.is_active = true%'
      and member.prosrc ilike '%profile.is_active = true%'
      and member.prosrc ilike '%profile.account_status = ''active''%'
      from pg_proc member where member.oid = to_regprocedure('public.is_active_operation_member()')), false)
      as membership_contract
  from inspected
)
select
  case when helper_absent and allowlist_signatures and security_contract
    and exact_owner_manager_guards and settings_restricted and membership_contract
    then 'HOTEL_STAFF_OPERATION_CAPABILITY_PARITY_PREFLIGHT_PASS' else 'HOTEL_STAFF_OPERATION_CAPABILITY_PARITY_PREFLIGHT_FAIL' end verdict,
  case when helper_absent then 'PASS' else 'FAIL' end helper_collision,
  case when allowlist_signatures then 'PASS' else 'FAIL' end rpc_signatures,
  case when exact_owner_manager_guards then 'PASS' else 'FAIL' end current_auth_guards,
  case when security_contract then 'PASS' else 'FAIL' end security_definer_search_path,
  case when settings_restricted then 'PASS' else 'FAIL' end hotel_settings_restricted,
  case when membership_contract then 'PASS' else 'FAIL' end operation_membership_contract,
  'UNCHANGED_BY_MIGRATION'::text acl_contract,
  'UNCHANGED_BY_MIGRATION'::text rls_contract,
  'ZERO'::text business_data_mutation
from result;

rollback;
