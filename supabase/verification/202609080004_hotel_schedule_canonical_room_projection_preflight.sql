BEGIN;
SET TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

-- Approved migration SHA-256 (file verified locally; this SQL does not apply it):
-- 72957025e671738979d95c1ac7edad400b19ad2bbb47395ea00396e341a5460c
-- Catalog differences/current relation anomalies => STOP and review, never repair.
-- Business distributions are INFORMATIONAL_ONLY; unavailable is not corruption.
WITH
required_columns(table_name,column_name,type_name,not_null) AS (
  VALUES
    ('dogs','customer_id','uuid',false),
    ('dogs','id','uuid',true),
    ('family_booking_members','archived_at','timestamp with time zone',false),
    ('family_booking_members','dog_id','uuid',true),
    ('family_booking_members','family_booking_id','uuid',true),
    ('family_booking_members','hotel_stay_id','uuid',false),
    ('family_booking_members','id','uuid',true),
    ('family_booking_members','service_type','text',true),
    ('family_booking_members','shared_room_group_id','uuid',false),
    ('family_shared_room_groups','archived_at','timestamp with time zone',false),
    ('family_shared_room_groups','id','uuid',true),
    ('family_shared_room_groups','room_type_id','uuid',true),
    ('family_shared_room_groups','status','text',true),
    ('hotel_capacity_reservations','archive_reason','text',false),
    ('hotel_capacity_reservations','archived_at','timestamp with time zone',false),
    ('hotel_capacity_reservations','hotel_stay_id','uuid',false),
    ('hotel_capacity_reservations','id','uuid',true),
    ('hotel_capacity_reservations','physical_occupancy_id','uuid',false),
    ('hotel_capacity_reservations','quantity','smallint',true),
    ('hotel_capacity_reservations','reserved_from','timestamp with time zone',true),
    ('hotel_capacity_reservations','reserved_until','timestamp with time zone',true),
    ('hotel_capacity_reservations','room_type_id','uuid',false),
    ('hotel_capacity_reservations','source_kind','text',true),
    ('hotel_physical_occupancies','archived_at','timestamp with time zone',false),
    ('hotel_physical_occupancies','capacity_reservation_id','uuid',false),
    ('hotel_physical_occupancies','customer_id','uuid',true),
    ('hotel_physical_occupancies','family_booking_id','uuid',true),
    ('hotel_physical_occupancies','id','uuid',true),
    ('hotel_physical_occupancies','occupied_from','timestamp with time zone',true),
    ('hotel_physical_occupancies','occupied_until','timestamp with time zone',true),
    ('hotel_physical_occupancies','room_allocation_id','uuid',false),
    ('hotel_physical_occupancies','room_id','uuid',true),
    ('hotel_physical_occupancies','room_type_id','uuid',true),
    ('hotel_physical_occupancies','shared_room_group_id','uuid',true),
    ('hotel_physical_occupancies','status','text',true),
    ('hotel_physical_occupancy_members','archived_at','timestamp with time zone',false),
    ('hotel_physical_occupancy_members','dog_id','uuid',true),
    ('hotel_physical_occupancy_members','family_booking_member_id','uuid',true),
    ('hotel_physical_occupancy_members','hotel_stay_id','uuid',true),
    ('hotel_physical_occupancy_members','id','uuid',true),
    ('hotel_physical_occupancy_members','occupancy_id','uuid',true),
    ('hotel_physical_occupancy_members','status','text',true),
    ('hotel_room_allocations','allocated_from','timestamp with time zone',true),
    ('hotel_room_allocations','allocated_until','timestamp with time zone',true),
    ('hotel_room_allocations','archived_at','timestamp with time zone',false),
    ('hotel_room_allocations','capacity_reservation_id','uuid',true),
    ('hotel_room_allocations','id','uuid',true),
    ('hotel_room_allocations','room_id','uuid',true),
    ('hotel_room_allocations','updated_at','timestamp with time zone',true),
    ('hotel_room_allocations','version','integer',true),
    ('hotel_room_types','id','uuid',true),
    ('hotel_room_types','name','text',true),
    ('hotel_rooms','id','uuid',true),
    ('hotel_rooms','name','text',true),
    ('hotel_rooms','room_type_id','uuid',true),
    ('hotel_stay_schedule_events','archived_at','timestamp with time zone',false),
    ('hotel_stay_schedule_events','event_kind','text',true),
    ('hotel_stay_schedule_events','hotel_stay_id','uuid',true),
    ('hotel_stay_schedule_events','operation_schedule_id','uuid',true),
    ('hotel_stays','archived_at','timestamp with time zone',false),
    ('hotel_stays','checked_in_at','timestamp with time zone',false),
    ('hotel_stays','checked_out_at','timestamp with time zone',false),
    ('hotel_stays','dog_id','uuid',true),
    ('hotel_stays','id','uuid',true),
    ('long_stay_absence_events','event_type','text',true),
    ('long_stay_absence_events','guarantee_from','timestamp with time zone',false),
    ('long_stay_absence_events','hotel_stay_id','uuid',true),
    ('long_stay_absence_events','id','uuid',true),
    ('long_stay_absence_events','inventory_mode','text',true),
    ('long_stay_absence_events','inventory_transition_status','text',true),
    ('long_stay_absence_events','occurred_at','timestamp with time zone',true),
    ('long_stay_absence_events','released_allocation_id','uuid',false),
    ('long_stay_absence_events','released_capacity_id','uuid',false),
    ('operation_memberships','is_active','boolean',true),
    ('operation_memberships','profile_id','uuid',true),
    ('operation_memberships','role','text',true),
    ('operation_schedules','id','uuid',true),
    ('operation_schedules','starts_at','timestamp with time zone',null),
    ('profiles','account_status','text',true),
    ('profiles','id','uuid',true),
    ('profiles','is_active','boolean',true)
),
required_tables AS (
  SELECT DISTINCT table_name, to_regclass('public.'||table_name) AS oid
  FROM required_columns
),
column_checks AS (
  SELECT 'COLUMN '||r.table_name||'.'||r.column_name AS object_name,
    coalesce(a.atttypid=to_regtype(r.type_name)
      AND (r.not_null IS NULL OR a.attnotnull=r.not_null),false) AS ok,
    jsonb_build_object('expected_type',r.type_name,'expected_not_null',r.not_null,
      'actual_type',format_type(a.atttypid,a.atttypmod),
      'actual_not_null',a.attnotnull) AS detail
  FROM required_columns r
  LEFT JOIN pg_attribute a ON a.attrelid=to_regclass('public.'||r.table_name)
    AND a.attname=r.column_name AND a.attnum>0 AND NOT a.attisdropped
),
required_fks(table_name,column_name,target_table,target_column,delete_action) AS (
  VALUES
    ('family_booking_members','dog_id','dogs','id','r'),
    ('family_booking_members','hotel_stay_id','hotel_stays','id','r'),
    ('family_shared_room_groups','room_type_id','hotel_room_types','id','r'),
    ('hotel_capacity_reservations','hotel_stay_id','hotel_stays','id','r'),
    ('hotel_capacity_reservations','physical_occupancy_id','hotel_physical_occupancies','id','r'),
    ('hotel_capacity_reservations','room_type_id','hotel_room_types','id','r'),
    ('hotel_physical_occupancies','capacity_reservation_id','hotel_capacity_reservations','id','r'),
    ('hotel_physical_occupancies','room_allocation_id','hotel_room_allocations','id','r'),
    ('hotel_physical_occupancies','room_id','hotel_rooms','id','r'),
    ('hotel_physical_occupancies','room_type_id','hotel_room_types','id','r'),
    ('hotel_physical_occupancies','shared_room_group_id','family_shared_room_groups','id','r'),
    ('hotel_physical_occupancy_members','dog_id','dogs','id','r'),
    ('hotel_physical_occupancy_members','family_booking_member_id','family_booking_members','id','r'),
    ('hotel_physical_occupancy_members','hotel_stay_id','hotel_stays','id','r'),
    ('hotel_physical_occupancy_members','occupancy_id','hotel_physical_occupancies','id','r'),
    ('hotel_room_allocations','capacity_reservation_id','hotel_capacity_reservations','id','r'),
    ('hotel_room_allocations','room_id','hotel_rooms','id','r'),
    ('hotel_rooms','room_type_id','hotel_room_types','id','r'),
    ('hotel_stay_schedule_events','hotel_stay_id','hotel_stays','id','r'),
    ('hotel_stay_schedule_events','operation_schedule_id','operation_schedules','id','r'),
    ('hotel_stays','dog_id','dogs','id','r'),
    ('long_stay_absence_events','hotel_stay_id','hotel_stays','id','r'),
    ('long_stay_absence_events','released_allocation_id','hotel_room_allocations','id','r'),
    ('long_stay_absence_events','released_capacity_id','hotel_capacity_reservations','id','r'),
    ('operation_memberships','profile_id','profiles','id','r'),
    ('family_booking_members','shared_room_group_id','family_shared_room_groups','id','r')
),
fk_checks AS (
  SELECT 'FK '||r.table_name||'.'||r.column_name AS object_name,
    EXISTS (
      SELECT 1 FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=c.conkey[1]
      JOIN pg_attribute b ON b.attrelid=c.confrelid AND b.attnum=c.confkey[1]
      WHERE c.contype='f' AND c.convalidated
        AND c.conrelid=to_regclass('public.'||r.table_name)
        AND c.confrelid=to_regclass('public.'||r.target_table)
        AND cardinality(c.conkey)=1 AND cardinality(c.confkey)=1
        AND a.attname=r.column_name AND b.attname=r.target_column
        AND c.confdeltype::text=r.delete_action
    ) AS ok, to_jsonb(r) AS detail
  FROM required_fks r
),
pk_checks AS (
  SELECT 'PK '||r.table_name AS object_name,
    EXISTS (
      SELECT 1 FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=c.conkey[1]
      JOIN pg_index i ON i.indexrelid=c.conindid
      WHERE c.conrelid=r.oid AND c.contype='p' AND c.convalidated
        AND cardinality(c.conkey)=1 AND i.indisvalid AND i.indisunique
        AND a.attname=CASE WHEN r.table_name='operation_memberships'
          THEN 'profile_id' ELSE 'id' END
    ) AS ok, jsonb_build_object('table',r.table_name) AS detail
  FROM required_tables r
),
required_checks(table_name,constraint_name,definition) AS (
  VALUES
    ('hotel_capacity_reservations','hotel_capacity_reservations_time_check','CHECK ((reserved_until > reserved_from))'),
    ('hotel_physical_occupancies','hotel_physical_occupancies_archive_check','CHECK ((((archived_at IS NULL) AND (archived_by IS NULL) AND (archive_reason IS NULL)) OR ((archived_at IS NOT NULL) AND (archived_by IS NOT NULL) AND (NULLIF(btrim(archive_reason), ''''::text) IS NOT NULL))))'),
    ('hotel_physical_occupancies','hotel_physical_occupancies_completion_check','CHECK ((((status = ''active''::text) AND (completed_at IS NULL) AND (restore_occupied_until IS NULL)) OR ((status = ANY (ARRAY[''completed''::text, ''released''::text])) AND (completed_at IS NOT NULL) AND (restore_occupied_until IS NOT NULL))))'),
    ('hotel_physical_occupancies','hotel_physical_occupancies_time_check','CHECK ((occupied_until > occupied_from))'),
    ('hotel_physical_occupancy_members','hotel_physical_occupancy_members_archive_check','CHECK ((((archived_at IS NULL) AND (archived_by IS NULL) AND (archive_reason IS NULL)) OR ((archived_at IS NOT NULL) AND (archived_by IS NOT NULL) AND (NULLIF(btrim(archive_reason), ''''::text) IS NOT NULL))))'),
    ('hotel_physical_occupancy_members','hotel_physical_occupancy_members_lifecycle_check','CHECK ((((status = ''active''::text) AND (left_at IS NULL)) OR ((status = ANY (ARRAY[''completed''::text, ''left''::text])) AND (left_at IS NOT NULL))))'),
    ('hotel_room_allocations','hotel_room_allocations_archive_check','CHECK ((((archived_at IS NULL) AND (archived_by IS NULL) AND (archive_reason IS NULL)) OR ((archived_at IS NOT NULL) AND (archived_by IS NOT NULL) AND (NULLIF(btrim(archive_reason), ''''::text) IS NOT NULL))))'),
    ('hotel_room_allocations','hotel_room_allocations_time_check','CHECK ((allocated_until > allocated_from))'),
    ('hotel_room_allocations','hotel_room_allocations_version_check','CHECK ((version > 0))'),
    ('hotel_stay_schedule_events','hotel_stay_schedule_events_event_kind_check','CHECK ((event_kind = ANY (ARRAY[''check_in''::text, ''check_out''::text])))'),
    ('long_stay_absence_events','long_stay_absence_inventory_mode_chk','CHECK ((inventory_mode = ANY (ARRAY[''keep_room''::text, ''release_room''::text])))'),
    ('long_stay_absence_events','long_stay_absence_inventory_semantics_chk','CHECK (((event_type = ''return''::text) OR ((inventory_mode = ''keep_room''::text) AND (inventory_transition_status = ''room_retained''::text) AND (previous_room_id IS NULL) AND (released_allocation_id IS NULL) AND (released_capacity_id IS NULL) AND (return_capacity_id IS NULL) AND (guarantee_from IS NULL) AND (returned_room_id IS NULL) AND (returned_allocation_id IS NULL)) OR ((inventory_mode = ''release_room''::text) AND (expected_return_date IS NOT NULL) AND (guarantee_from IS NOT NULL) AND (previous_room_id IS NOT NULL) AND (released_allocation_id IS NOT NULL) AND (released_capacity_id IS NOT NULL) AND (return_capacity_id IS NOT NULL) AND (((inventory_transition_status = ''room_released''::text) AND (returned_room_id IS NULL) AND (returned_allocation_id IS NULL)) OR ((inventory_transition_status = ''room_returned''::text) AND (returned_room_id IS NOT NULL) AND (returned_allocation_id IS NOT NULL))))))'),
    ('long_stay_absence_events','long_stay_absence_inventory_status_chk','CHECK ((inventory_transition_status = ANY (ARRAY[''room_retained''::text, ''room_released''::text, ''room_returned''::text])))'),
    ('operation_memberships','operation_memberships_role_check','CHECK ((role = ANY (ARRAY[''staff''::text, ''manager''::text, ''owner''::text])))'),
    ('profiles','profiles_account_status_check','CHECK ((account_status = ANY (ARRAY[''pending''::text, ''active''::text, ''rejected''::text, ''inactive''::text])))')
),
check_checks AS (
  SELECT 'CHECK '||r.constraint_name AS object_name,
    coalesce(c.convalidated AND c.contype='c'
      AND regexp_replace(pg_get_constraintdef(c.oid),'[[:space:]]','','g')
        =regexp_replace(r.definition,'[[:space:]]','','g'),false) AS ok,
    jsonb_build_object('expected',r.definition,
      'actual',pg_get_constraintdef(c.oid),'validated',c.convalidated) AS detail
  FROM required_checks r
  LEFT JOIN pg_constraint c ON c.conrelid=to_regclass('public.'||r.table_name)
    AND c.conname=r.constraint_name
),
required_indexes(index_name,table_name,column_name,predicate) AS (
  VALUES
    ('hotel_physical_occupancies_active_shared_room_group_uidx',
      'hotel_physical_occupancies','shared_room_group_id','archived_at IS NULL'),
    ('hotel_physical_occupancy_members_stay_uidx',
      'hotel_physical_occupancy_members','hotel_stay_id','archived_at IS NULL'),
    ('hotel_physical_occupancy_members_family_member_uidx',
      'hotel_physical_occupancy_members','family_booking_member_id','archived_at IS NULL'),
    ('family_booking_members_hotel_stay_uidx',
      'family_booking_members','hotel_stay_id',
      'hotel_stay_id IS NOT NULL AND archived_at IS NULL'),
    ('hotel_capacity_reservations_physical_occupancy_uidx',
      'hotel_capacity_reservations','physical_occupancy_id',
      'source_kind = ''shared_occupancy''::text AND archived_at IS NULL')
),
index_checks AS (
  SELECT 'INDEX '||r.index_name AS object_name,
    coalesce(i.indisunique AND i.indisvalid AND i.indisready
      AND i.indrelid=to_regclass('public.'||r.table_name)
      AND i.indnkeyatts=1 AND a.attname=r.column_name
      AND regexp_replace(pg_get_expr(i.indpred,i.indrelid),'[[:space:]()]','','g')
        =regexp_replace(r.predicate,'[[:space:]()]','','g'),false) AS ok,
    jsonb_build_object('expected',to_jsonb(r),
      'actual',pg_get_indexdef(i.indexrelid)) AS detail
  FROM required_indexes r
  LEFT JOIN pg_index i ON i.indexrelid=to_regclass('public.'||r.index_name)
  LEFT JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=i.indkey[0]
),
required_functions(signature,result_type,argument_names,security_definer) AS (
  VALUES
    ('public.protect_hotel_entity_metadata()','trigger',array[]::text[],false),
    ('public.is_active_operation_member()','boolean',array[]::text[],true),
    ('public.assign_hotel_room(uuid,integer,uuid,text,uuid)','jsonb',array['p_hotel_stay_id','p_expected_version','p_room_id','p_reason','p_request_id']::text[],true),
    ('public.reassign_hotel_room_before_check_in(uuid,integer,uuid,text,uuid)','jsonb',array['p_hotel_stay_id','p_expected_version','p_new_room_id','p_reason','p_request_id']::text[],true),
    ('public.move_hotel_room_same_type(uuid,integer,uuid,timestamptz,text,uuid)','jsonb',array['p_hotel_stay_id','p_expected_version','p_new_room_id','p_move_at','p_reason','p_request_id']::text[],true),
    ('public.complete_hotel_check_in(uuid,integer,timestamptz,uuid)','jsonb',array['p_hotel_stay_id','p_expected_version','p_completed_at','p_request_id']::text[],true),
    ('public.complete_hotel_check_out(uuid,integer,timestamptz,uuid)','jsonb',array['p_hotel_stay_id','p_expected_version','p_completed_at','p_request_id']::text[],true),
    ('public.reverse_hotel_completion(uuid,integer,text,text,uuid)','jsonb',array['p_hotel_stay_id','p_expected_version','p_completion_kind','p_reason','p_request_id']::text[],true),
    ('public.get_hotel_operations_snapshot_v2(date)','jsonb',array['p_local_date']::text[],true),
    ('public.unassign_hotel_room_before_check_in(uuid,integer,text,uuid)','jsonb',array['p_hotel_stay_id','p_expected_version','p_reason','p_request_id']::text[],true),
    ('public.change_room_type_before_check_in(uuid,integer,uuid,text,uuid)','jsonb',array['p_hotel_stay_id','p_expected_version','p_new_room_id','p_reason','p_request_id']::text[],true),
    ('public.change_room_type_after_check_in(uuid,integer,uuid,timestamptz,text,uuid)','jsonb',array['p_hotel_stay_id','p_expected_version','p_new_room_id','p_effective_at','p_reason','p_request_id']::text[],true),
    ('public.complete_long_stay_absence(uuid,integer,timestamptz,text,text,uuid)','jsonb',array['p_contract_id','p_expected_contract_version','p_returned_at','p_memo','p_reason','p_request_id']::text[],true),
    ('public.reverse_long_stay_completion(uuid,integer,integer,text,uuid)','jsonb',array['p_contract_id','p_expected_contract_version','p_expected_stay_version','p_reason','p_request_id']::text[],true),
    ('public.create_shared_hotel_room_occupancy(uuid,uuid,uuid)','jsonb',array['p_shared_room_group_id','p_room_id','p_request_id']::text[],true),
    ('public.reverse_shared_hotel_member_completion(uuid,uuid,integer,integer,text,uuid)','jsonb',array['p_occupancy_id','p_hotel_stay_id','p_expected_occupancy_version','p_expected_stay_version','p_reason','p_request_id']::text[],true),
    ('public.confirm_long_stay_month_v2(uuid,integer,date,date,uuid,uuid,time,boolean,uuid,uuid,uuid[],text,uuid)','jsonb',array['p_contract_id','p_expected_contract_version','p_service_month','p_physical_start_date','p_calendar_id','p_schedule_type_id','p_check_in_time','p_check_in_time_unspecified','p_room_type_id','p_room_id','p_assignee_ids','p_reason','p_request_id']::text[],true),
    ('public.start_long_stay_absence_v3(uuid,integer,timestamptz,date,time,boolean,text,text,text,uuid)','jsonb',array['p_contract_id','p_expected_contract_version','p_left_at','p_expected_return_date','p_expected_return_time','p_expected_return_time_unspecified','p_inventory_mode','p_memo','p_reason','p_request_id']::text[],true),
    ('public.release_long_stay_room_during_absence(uuid,integer,text,uuid)','jsonb',array['p_contract_id','p_expected_contract_version','p_reason','p_request_id']::text[],true),
    ('public.unassign_shared_hotel_room_before_check_in(uuid,integer,text,uuid)','jsonb',array['p_occupancy_id','p_expected_version','p_reason','p_request_id']::text[],true),
    ('public.reverse_shared_hotel_member_check_in(uuid,uuid,integer,integer,text,uuid)','jsonb',array['p_occupancy_id','p_hotel_stay_id','p_expected_occupancy_version','p_expected_stay_version','p_reason','p_request_id']::text[],true),
    ('public.reverse_check_in_and_unassign_hotel_room(uuid,integer,text,uuid)','jsonb',array['p_hotel_stay_id','p_expected_version','p_reason','p_request_id']::text[],true),
    ('public.reverse_check_in_and_unassign_shared_hotel_room(uuid,integer,text,uuid)','jsonb',array['p_occupancy_id','p_expected_version','p_reason','p_request_id']::text[],true),
    ('public.can_operate_hotel()','boolean',array[]::text[],true),
    ('auth.uid()','uuid',array[]::text[],false)
),
function_checks AS (
  SELECT 'FUNCTION '||r.signature AS object_name,
    coalesce(p.prorettype=to_regtype(r.result_type)
      AND p.prokind='f' AND NOT p.proretset
      AND coalesce(p.proargnames,array[]::text[])=r.argument_names
      AND p.prosecdef=r.security_definer
      AND (r.signature='auth.uid()'
        OR p.proconfig @> array['search_path=public, pg_temp']),false) AS ok,
    jsonb_build_object('expected',to_jsonb(r),
      'actual_arguments',pg_get_function_arguments(p.oid),
      'actual_result',pg_get_function_result(p.oid),
      'actual_definer',p.prosecdef,'actual_settings',p.proconfig) AS detail
  FROM required_functions r
  LEFT JOIN pg_proc p ON p.oid=to_regprocedure(r.signature)
),
helper_checks AS (
  SELECT 'ACTIVE_MEMBER_BODY' AS object_name,
    coalesce(p.provolatile='s' AND p.prosecdef
      AND regexp_replace(p.prosrc,'[[:space:]]','','g')='selectexists(select1frompublic.operation_membershipsmembershipjoinpublic.profilesprofileonprofile.id=membership.profile_idwheremembership.profile_id=auth.uid()andmembership.is_active=trueandprofile.is_active=trueandprofile.account_status=''active'');',false) AS ok,
    jsonb_build_object('definition',pg_get_functiondef(p.oid)) AS detail
  FROM (VALUES(1)) seed(n)
  LEFT JOIN pg_proc p ON p.oid=to_regprocedure('public.is_active_operation_member()')
  UNION ALL
  SELECT 'HOTEL_CAPABILITY_BODY',
    coalesce(p.provolatile='s' AND p.prosecdef
      AND regexp_replace(p.prosrc,'[[:space:]]','','g')=
        'selectpublic.is_active_operation_member();',false),
    jsonb_build_object('definition',pg_get_functiondef(p.oid))
  FROM (VALUES(1)) seed(n)
  LEFT JOIN pg_proc p ON p.oid=to_regprocedure('public.can_operate_hotel()')
  UNION ALL
  SELECT 'ALLOCATION_VERSION_TRIGGER', EXISTS (
    SELECT 1 FROM pg_trigger t
    WHERE t.tgrelid=to_regclass('public.hotel_room_allocations')
      AND t.tgfoid=to_regprocedure('public.protect_hotel_entity_metadata()')
      AND t.tgenabled IN ('O','A') AND (t.tgtype::integer & 19)=19
      AND t.tgqual IS NULL
  ) AND EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid=to_regprocedure('public.protect_hotel_entity_metadata()')
      AND regexp_replace(p.prosrc,'[[:space:]]','','g')='beginnew.id:=old.id;new.created_by:=old.created_by;new.created_at:=old.created_at;ifto_jsonb(new)?''version''thennew.version:=old.version+1;endif;returnnew;end;'
  ), jsonb_build_object('contract','source metadata/version trigger, no RPC invoked')
),
-- 202608060002_family_booking_read_contract revoked authenticated direct SELECT.
-- Family tables retain their guarded RLS policies; access is through definer RPCs.
-- Do not grant direct SELECT to satisfy this preflight.
security_baseline(table_name,authenticated_select,service_all,select_policy) AS (
  VALUES
    ('hotel_stay_schedule_events',true,false,true),
    ('hotel_stays',true,false,true),
    ('operation_schedules',true,false,true),
    ('hotel_capacity_reservations',true,false,true),
    ('hotel_room_allocations',true,false,true),
    ('hotel_rooms',true,false,true),
    ('hotel_room_types',true,false,true),
    ('family_booking_members',false,false,true),
    ('family_shared_room_groups',false,false,true),
    ('hotel_physical_occupancies',false,true,false),
    ('hotel_physical_occupancy_members',false,true,false),
    ('long_stay_absence_events',false,false,false)
),
security_checks AS (
  SELECT 'SECURITY '||b.table_name AS object_name,
    coalesce(c.oid IS NOT NULL AND c.relrowsecurity
      AND (b.table_name NOT IN ('family_booking_members','family_shared_room_groups')
        OR (NOT c.relforcerowsecurity AND NOT EXISTS (
          SELECT 1 FROM pg_attribute column_acl
          WHERE column_acl.attrelid=c.oid AND column_acl.attnum>0
            AND NOT column_acl.attisdropped AND column_acl.attacl IS NOT NULL
        )))
      AND has_table_privilege('authenticated',c.oid,'SELECT')=b.authenticated_select
      AND NOT has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      AND NOT has_table_privilege('authenticated',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      AND NOT EXISTS (
        SELECT 1 FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
        WHERE a.grantee=0
      )
      AND NOT EXISTS (
        SELECT 1 FROM pg_attribute a
        WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
          AND (has_column_privilege('anon',c.oid,a.attnum,'SELECT,INSERT,UPDATE,REFERENCES')
            OR has_column_privilege('authenticated',c.oid,a.attnum,'INSERT,UPDATE,REFERENCES')
            OR (NOT b.authenticated_select
              AND has_column_privilege('authenticated',c.oid,a.attnum,'SELECT')))
      )
      AND (NOT b.service_all OR NOT EXISTS (
        SELECT 1 FROM unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) privilege
        WHERE NOT has_table_privilege('service_role',c.oid,privilege)
      ))
      AND (b.table_name<>'long_stay_absence_events'
        OR NOT has_table_privilege('service_role',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
      AND (CASE WHEN b.select_policy THEN
        (SELECT count(*)=1 AND bool_and(p.polcmd='r' AND p.polpermissive
          AND p.polroles=array[(SELECT oid FROM pg_roles WHERE rolname='authenticated')]
          AND regexp_replace(pg_get_expr(p.polqual,p.polrelid),'[[:space:]]','','g')
            IN ('is_active_operation_member()','public.is_active_operation_member()')
          AND p.polwithcheck IS NULL)
         FROM pg_policy p WHERE p.polrelid=c.oid)
      ELSE NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid=c.oid) END),false) AS ok,
    jsonb_build_object('rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,
      'acl',c.relacl,'policies',(SELECT jsonb_agg(jsonb_build_object(
        'name',p.polname,'command',p.polcmd,'roles',p.polroles,
        'qual',pg_get_expr(p.polqual,p.polrelid),
        'with_check',pg_get_expr(p.polwithcheck,p.polrelid)))
        FROM pg_policy p WHERE p.polrelid=c.oid)) AS detail
  FROM security_baseline b LEFT JOIN pg_class c ON c.oid=to_regclass('public.'||b.table_name)
),
catalog_checks AS (
  SELECT 'APPEND_OBJECT_ABSENT' AS object_name,
    to_regprocedure('public.get_operation_hotel_room_projections(uuid[])') IS NULL
      AND NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname='get_operation_hotel_room_projections') AS ok,
    jsonb_build_object('signature','public.get_operation_hotel_room_projections(uuid[])') AS detail
  UNION ALL SELECT * FROM column_checks
  UNION ALL SELECT * FROM fk_checks
  UNION ALL SELECT * FROM pk_checks
  UNION ALL SELECT * FROM check_checks
  UNION ALL SELECT * FROM index_checks
  UNION ALL SELECT * FROM function_checks
  UNION ALL SELECT * FROM helper_checks
  UNION ALL SELECT * FROM security_checks
),
-- Current Shared structural integrity, not historical provenance classification.
shared_findings AS (
  SELECT 'DUPLICATE_UNARCHIVED_OCCUPANCY' AS kind,count(*) AS n FROM (
    SELECT shared_room_group_id FROM public.hotel_physical_occupancies
    WHERE archived_at IS NULL GROUP BY shared_room_group_id HAVING count(*)>1
  ) duplicates
  UNION ALL
  SELECT 'DUPLICATE_UNARCHIVED_MEMBER',count(*) FROM (
    SELECT hotel_stay_id FROM public.hotel_physical_occupancy_members
    WHERE archived_at IS NULL GROUP BY hotel_stay_id HAVING count(*)>1
  ) duplicates
  UNION ALL
  SELECT 'CURRENT_MALFORMED_MEMBER_RELATION',count(*)
  FROM public.hotel_physical_occupancy_members m
  LEFT JOIN public.hotel_physical_occupancies o ON o.id=m.occupancy_id
  WHERE m.archived_at IS NULL AND m.status='active'
    AND (o.id IS NULL OR o.archived_at IS NOT NULL OR o.status<>'active' OR NOT EXISTS (
      SELECT 1 FROM public.family_booking_members fm
      JOIN public.hotel_stays s ON s.id=fm.hotel_stay_id
      JOIN public.dogs d ON d.id=fm.dog_id
      WHERE fm.id=m.family_booking_member_id AND fm.archived_at IS NULL
        AND fm.service_type='hotel' AND fm.family_booking_id=o.family_booking_id
        AND fm.shared_room_group_id=o.shared_room_group_id
        AND fm.hotel_stay_id=m.hotel_stay_id AND fm.dog_id=m.dog_id
        AND s.dog_id=m.dog_id AND s.archived_at IS NULL AND d.customer_id=o.customer_id
    ))
  UNION ALL
  SELECT 'CURRENT_MALFORMED_ALLOCATION_RELATION',count(*)
  FROM public.hotel_physical_occupancies o
  WHERE o.archived_at IS NULL AND o.status='active' AND NOT EXISTS (
    SELECT 1 FROM public.hotel_capacity_reservations c
    JOIN public.hotel_room_allocations a ON a.id=o.room_allocation_id
      AND a.capacity_reservation_id=c.id
    JOIN public.hotel_rooms r ON r.id=o.room_id
    WHERE c.id=o.capacity_reservation_id AND c.physical_occupancy_id=o.id
      AND c.source_kind='shared_occupancy' AND c.archived_at IS NULL
      AND a.archived_at IS NULL AND c.quantity=1
      AND c.room_type_id=o.room_type_id AND a.room_id=o.room_id
      AND r.room_type_id=o.room_type_id
      AND c.reserved_from=o.occupied_from AND c.reserved_until=o.occupied_until
      AND a.allocated_from=o.occupied_from AND a.allocated_until=o.occupied_until
  )
  UNION ALL
  SELECT 'CURRENT_OCCUPANCY_WITHOUT_ACTIVE_MEMBER',count(*)
  FROM public.hotel_physical_occupancies o
  WHERE o.archived_at IS NULL AND o.status='active' AND NOT EXISTS (
    SELECT 1 FROM public.hotel_physical_occupancy_members m
    WHERE m.occupancy_id=o.id AND m.archived_at IS NULL AND m.status='active'
  )
),
requested_schedule_ids AS (
  SELECT DISTINCT operation_schedule_id
  FROM public.hotel_stay_schedule_events WHERE archived_at IS NULL
),
  -- BEGIN CANONICAL PROJECTION CORE
  schedule_context as (
    select
      schedule.id as operation_schedule_id,
      schedule.starts_at,
      event.hotel_stay_id,
      event.event_kind,
      stay.checked_in_at,
      stay.checked_out_at,
      case event.event_kind
        when 'check_in' then stay.checked_in_at is not null
        when 'check_out' then stay.checked_out_at is not null
      end as completed_event,
      count(*) over (partition by schedule.id) as event_link_count,
      case event.event_kind
        when 'check_in' then coalesce(stay.checked_in_at, schedule.starts_at)
        when 'check_out' then coalesce(stay.checked_out_at, schedule.starts_at)
      end as event_at
    from requested_schedule_ids requested
    join public.operation_schedules schedule
      on schedule.id = requested.operation_schedule_id
    join public.hotel_stay_schedule_events event
      on event.operation_schedule_id = schedule.id
     and event.archived_at is null
     and event.event_kind in ('check_in', 'check_out')
    join public.hotel_stays stay on stay.id = event.hotel_stay_id
  ),
  candidate_summary as (
    select
      context.*,
      family.shared_group_count,
      family.shared_group_id,
      family.shared_group_status,
      family.shared_group_room_type_name,
      shared.current_candidate_count,
      shared.current_room_name,
      shared.current_room_type_name,
      single.candidate_count as single_candidate_count,
      single.raw_candidate_count,
      single.invalid_provenance_count as single_invalid_provenance_count,
      single.room_name as single_room_name,
      single.room_type_name as single_room_type_name,
      capacity.candidate_count as capacity_candidate_count,
      capacity.room_type_name as capacity_room_type_name
    from schedule_context context
    left join lateral (
      select
        greatest(count(distinct room_group.id),
          count(distinct member.shared_room_group_id))::integer as shared_group_count,
        case when count(distinct room_group.id) = 1
          then (array_agg(distinct room_group.id))[1]
        end as shared_group_id,
        case when count(distinct room_group.id) = 1
          then (array_agg(distinct room_group.status))[1]
        end as shared_group_status,
        case when count(distinct room_group.id) = 1
          then (array_agg(distinct room_type.name))[1]
        end as shared_group_room_type_name
      from public.family_booking_members member
      left join public.family_shared_room_groups room_group
        on room_group.id = member.shared_room_group_id
      left join public.hotel_room_types room_type
        on room_type.id = room_group.room_type_id
      where member.hotel_stay_id = context.hotel_stay_id
        and member.service_type = 'hotel'
        and member.shared_room_group_id is not null
    ) family on true
    left join lateral (
      select
        count(distinct occupancy.id)::integer as current_candidate_count,
        case when count(distinct occupancy.id) = 1
          then (array_agg(distinct room.name))[1]
        end as current_room_name,
        case when count(distinct occupancy.id) = 1
          then (array_agg(distinct room_type.name))[1]
        end as current_room_type_name
      from public.family_booking_members family_member
      join public.hotel_physical_occupancy_members physical_member
        on physical_member.family_booking_member_id = family_member.id
       and physical_member.hotel_stay_id = context.hotel_stay_id
       and physical_member.archived_at is null
       and physical_member.status = 'active'
      join public.hotel_physical_occupancies occupancy
        on occupancy.id = physical_member.occupancy_id
       and occupancy.shared_room_group_id = family.shared_group_id
       and occupancy.archived_at is null
       and occupancy.status = 'active'
      join public.hotel_room_allocations allocation
        on allocation.id = occupancy.room_allocation_id
       and allocation.archived_at is null
       and allocation.room_id = occupancy.room_id
      join public.hotel_rooms room
        on room.id = occupancy.room_id
       and room.room_type_id = occupancy.room_type_id
      join public.hotel_room_types room_type
        on room_type.id = occupancy.room_type_id
      where family_member.hotel_stay_id = context.hotel_stay_id
        and family_member.shared_room_group_id = family.shared_group_id
        and family_member.archived_at is null
        -- Shared room_id is mutable in place: no historical current-room fallback.
        and context.checked_out_at is null
        and allocation.updated_at <= context.event_at
        and (allocation.version = 1
          or (not context.completed_event and context.event_at >= statement_timestamp()))
        and (
          (context.event_kind = 'check_in'
            and allocation.allocated_from <= context.event_at
            and allocation.allocated_until > context.event_at)
          or (context.event_kind = 'check_out'
            and allocation.allocated_from < context.event_at
            and allocation.allocated_until >= context.event_at)
        )
    ) shared on true
    left join lateral (
      select
        count(*)::integer as raw_candidate_count,
        count(*) filter (where allocation_candidate.retained)::integer as candidate_count,
        count(*) filter (where allocation_candidate.retained
          and not allocation_candidate.provenance_ok)::integer
          as invalid_provenance_count,
        case when count(*) filter (where allocation_candidate.retained) = 1
          and bool_and(allocation_candidate.provenance_ok) filter (where allocation_candidate.retained)
          then (array_agg(allocation_candidate.room_name) filter (where allocation_candidate.retained))[1]
        end as room_name,
        case when count(*) filter (where allocation_candidate.retained) = 1
          and bool_and(allocation_candidate.provenance_ok) filter (where allocation_candidate.retained)
          then (array_agg(allocation_candidate.room_type_name) filter (where allocation_candidate.retained))[1]
        end as room_type_name
      from (
        select
          allocation.id,
          allocation.archived_at is null as retained,
          room.name as room_name,
          room_type.name as room_type_name,
          coalesce(room.id is not null and room_type.id is not null
          and (
            (context.event_kind = 'check_in'
              and capacity.reserved_from <= context.event_at
              and capacity.reserved_until > context.event_at)
            or (context.event_kind = 'check_out'
              and capacity.reserved_from < context.event_at
              and capacity.reserved_until >= context.event_at)
          ) and case
            when capacity.archive_reason is distinct from
              'long_stay_outing_inventory_segment_closed' then capacity.archived_at is null
            else capacity.archived_at is not null
              and isfinite(allocation.allocated_until) and exists (
              select 1
              from public.long_stay_absence_events leave_event
              where leave_event.event_type = 'leave'
                and leave_event.hotel_stay_id = context.hotel_stay_id
                and leave_event.released_allocation_id = allocation.id
                and leave_event.released_capacity_id = capacity.id
                and leave_event.inventory_mode = 'release_room'
                and leave_event.inventory_transition_status in ('room_released', 'room_returned')
                and allocation.allocated_until = capacity.reserved_until
                and allocation.allocated_until >= leave_event.occurred_at
                and allocation.allocated_until <= leave_event.guarantee_from
            )
          end, false) as provenance_ok
        from public.hotel_capacity_reservations capacity
        join public.hotel_room_allocations allocation
          on allocation.capacity_reservation_id = capacity.id
        left join public.hotel_rooms room on room.id = allocation.room_id
        left join public.hotel_room_types room_type on room_type.id = room.room_type_id
        where coalesce(family.shared_group_count, 0) = 0
          and capacity.source_kind = 'stay'
          and capacity.hotel_stay_id = context.hotel_stay_id
          and (
            (context.event_kind = 'check_in'
              and allocation.allocated_from <= context.event_at
              and allocation.allocated_until > context.event_at)
            or
            (context.event_kind = 'check_out'
              and allocation.allocated_from < context.event_at
              and allocation.allocated_until >= context.event_at)
          )
      ) allocation_candidate
    ) single on true
    left join lateral (
      select
        count(*)::integer as candidate_count,
        case when count(*) = 1 then (array_agg(room_type.name))[1] end
          as room_type_name
      from public.hotel_capacity_reservations stay_capacity
      join public.hotel_room_types room_type
        on room_type.id = stay_capacity.room_type_id
      where coalesce(family.shared_group_count, 0) = 0
        and stay_capacity.source_kind = 'stay'
        and stay_capacity.hotel_stay_id = context.hotel_stay_id
        and stay_capacity.archived_at is null
        and (
          (context.event_kind = 'check_in'
            and stay_capacity.reserved_from <= context.event_at
            and stay_capacity.reserved_until > context.event_at)
          or
          (context.event_kind = 'check_out'
            and stay_capacity.reserved_from < context.event_at
            and stay_capacity.reserved_until >= context.event_at)
        )
    ) capacity on true
  ),
  resolved as (
    select
      candidate_summary.*,
      case
        when event_link_count <> 1 then 'unavailable'
        when shared_group_count > 1 then 'unavailable'
        when shared_group_count = 1 and current_candidate_count > 1 then 'unavailable'
        when shared_group_count = 1 and current_candidate_count = 1 then 'resolved'
        when shared_group_count = 1 and shared_group_status = 'requested'
          and not completed_event and checked_out_at is null then 'unassigned'
        when shared_group_count = 1 then 'unavailable'
        when single_candidate_count > 1 then 'unavailable'
        when single_candidate_count = 1 and single_invalid_provenance_count > 0
          then 'unavailable'
        when single_candidate_count = 1 then 'resolved'
        when completed_event then 'unavailable'
        when capacity_candidate_count > 1 then 'unavailable'
        when capacity_candidate_count = 1 then 'unassigned'
        when raw_candidate_count > 0 then 'unavailable'
        else 'unknown'
      end as room_resolution_status
    from candidate_summary
  )
  -- END CANONICAL PROJECTION CORE
,
output_rows AS (
  SELECT 0 AS sort_key,'FINAL_VERDICT'::text AS object_name,
    CASE WHEN NOT (SELECT bool_and(ok) FROM catalog_checks) THEN 'STOP_CATALOG_CONTRACT_REVIEW_REQUIRED'
      WHEN EXISTS (SELECT 1 FROM shared_findings WHERE n>0) THEN 'STOP_CURRENT_SHARED_RELATION_REVIEW_REQUIRED'
      ELSE 'PRODUCTION_PREFLIGHT_PASS' END AS status,
    jsonb_build_object('business_counts','INFORMATIONAL_ONLY',
      'historical_unavailable_is_corruption',false,
      'migration_executed',false,'repair_authorized',false,
      'expected_migration_sha','72957025e671738979d95c1ac7edad400b19ad2bbb47395ea00396e341a5460c') AS detail
  UNION ALL
  SELECT 1,object_name,CASE WHEN ok THEN 'PASS' ELSE 'STOP_REVIEW_REQUIRED' END,detail
  FROM catalog_checks
  UNION ALL
  SELECT 2,kind,CASE WHEN n=0 THEN 'PASS' ELSE 'REVIEW_REQUIRED_NOT_CORRUPTION_VERDICT' END,
    jsonb_build_object('count',n,'business_counts','INFORMATIONAL_ONLY') FROM shared_findings
  UNION ALL
  SELECT 3,'PROJECTION_STATUS_COUNTS','INFORMATIONAL_ONLY',
    coalesce(jsonb_object_agg(room_resolution_status,n),'{}'::jsonb)
  FROM (SELECT room_resolution_status,count(*) n FROM resolved GROUP BY room_resolution_status) counts
  UNION ALL
  SELECT 3,'LIFECYCLE_COUNTS','INFORMATIONAL_ONLY',jsonb_build_object(
    'retained_single_ambiguous',(SELECT count(*) FROM resolved WHERE single_candidate_count>1),
    'single_unproven',(SELECT count(*) FROM resolved WHERE single_invalid_provenance_count>0),
    'shared_unavailable',(SELECT count(*) FROM resolved WHERE shared_group_count>0 AND room_resolution_status='unavailable'),
    'long_stay_linked_finite_closed_inventory_segments',(
      SELECT count(*) FROM public.long_stay_absence_events e
      JOIN public.hotel_room_allocations a ON a.id=e.released_allocation_id
      JOIN public.hotel_capacity_reservations c ON c.id=e.released_capacity_id
      WHERE e.event_type='leave' AND e.inventory_mode='release_room'
        AND e.inventory_transition_status IN ('room_released','room_returned')
        AND a.capacity_reservation_id=c.id AND c.hotel_stay_id=e.hotel_stay_id
        AND a.archived_at IS NULL AND c.archived_at IS NOT NULL
        AND c.archive_reason='long_stay_outing_inventory_segment_closed'
        AND isfinite(a.allocated_until) AND a.allocated_until=c.reserved_until
        AND e.occurred_at<=a.allocated_until AND a.allocated_until<=e.guarantee_from))
  UNION ALL
  SELECT 4,'CATALOG_SNAPSHOT '||t.table_name,'INFORMATIONAL_ONLY',jsonb_build_object(
    'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,'acl',c.relacl,
    'constraints',(SELECT jsonb_agg(jsonb_build_object('name',x.conname,
      'validated',x.convalidated,'definition',pg_get_constraintdef(x.oid)))
      FROM pg_constraint x WHERE x.conrelid=t.oid),
    'indexes',(SELECT jsonb_agg(pg_get_indexdef(i.indexrelid)) FROM pg_index i WHERE i.indrelid=t.oid),
    'policies',(SELECT jsonb_agg(jsonb_build_object('name',p.polname,'roles',p.polroles,
      'command',p.polcmd,'permissive',p.polpermissive,
      'qual',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid)))
      FROM pg_policy p WHERE p.polrelid=t.oid))
  FROM required_tables t LEFT JOIN pg_class c ON c.oid=t.oid
)
SELECT object_name,status,detail FROM output_rows ORDER BY sort_key,object_name;

ROLLBACK;
