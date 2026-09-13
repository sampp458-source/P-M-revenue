-- 016B catalog-only gate. On any FAIL stop; never repair/grant to pass.
BEGIN TRANSACTION READ ONLY;
WITH old016(sig,hash,names,private,volatility,defaults) AS (VALUES ('hotel_single_room_eligibility_internal(uuid,text,timestamptz)','8e1ec0b36c21013a40cd60b58d61569b',ARRAY['p_stay_id','p_purpose','p_effective_at']::text[],true,'s',0),
('get_hotel_single_room_eligibility(uuid,text,timestamptz)','849bf44f236af98b3969877f7b039d67',ARRAY['p_hotel_stay_id','p_purpose','p_effective_at']::text[],false,'s',1),
('check_in_unassigned_hotel_stay(uuid,integer,integer,uuid,timestamptz,uuid)','e5ab0f930b01743c6ec63552ff1df0aa',ARRAY['p_hotel_stay_id','p_expected_version','p_expected_capacity_version','p_room_id','p_checked_in_at','p_request_id']::text[],false,'v',0)), new016b(sig,hash,names,private,volatility,defaults) AS (VALUES ('hotel_missed_check_in_eligibility_internal(uuid,timestamptz)','017fbc818e7b87474050d61ba7349545',ARRAY['p_stay_id','p_checked_in_at']::text[],true,'s',0),
('get_hotel_missed_check_in_eligibility(uuid,timestamptz)','e85c2b21ddf3dbde4d077fe322a91e89',ARRAY['p_hotel_stay_id','p_checked_in_at']::text[],false,'s',0),
('recover_missed_hotel_check_in(uuid,integer,integer,uuid,timestamptz,uuid)','112ac0b9cff4e1004bc785e91ebcb21a',ARRAY['p_hotel_stay_id','p_expected_version','p_expected_capacity_version','p_room_id','p_checked_in_at','p_request_id']::text[],false,'v',0)), checks AS (
 SELECT '016_FUNCTION_PRESERVED '||e.sig check_name,coalesce(
 md5(p.prosrc)=e.hash AND p.prokind='f' AND p.prosecdef AND NOT p.proretset
 AND p.prorettype='jsonb'::regtype AND p.proargnames=e.names AND p.pronargdefaults=e.defaults
 AND p.provolatile::text=e.volatility AND p.proconfig=ARRAY['search_path=public, pg_temp']::text[]
 AND pg_get_userbyid(p.proowner)='postgres'
 AND (SELECT array_agg(a ORDER BY a) FROM unnest(p.proacl::text[]) a)
  =CASE WHEN e.private THEN ARRAY['postgres=X/postgres']::text[] ELSE ARRAY['authenticated=X/postgres','postgres=X/postgres']::text[] END,false) ok
 FROM old016 e LEFT JOIN pg_proc p ON p.oid=to_regprocedure('public.'||e.sig)
 UNION ALL SELECT 'DEPENDENCY_TABLE '||name,to_regclass('public.'||name) IS NOT NULL
 FROM (VALUES ('hotel_stays'),('hotel_capacity_reservations'),('hotel_room_allocations'),('hotel_rooms'),('hotel_room_types'),('profiles'),('hotel_stay_schedule_events'),('operation_schedules'),('entity_audit_events'),('hotel_single_check_in_receipts'))d(name)
 UNION ALL SELECT 'AUTH_UID',to_regprocedure('auth.uid()') IS NOT NULL
 UNION ALL SELECT 'EXISTING_AUDIT_VERSION_TRIGGER '||e.tab,EXISTS(SELECT 1 FROM pg_trigger t
 WHERE t.tgrelid=to_regclass('public.'||e.tab) AND t.tgfoid=to_regprocedure('public.record_hotel_operation_audit_event()') AND t.tgenabled IN ('O','A'))
 AND EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid=to_regclass('public.'||e.tab)
 AND t.tgfoid=to_regprocedure('public.protect_hotel_entity_metadata()') AND t.tgenabled IN ('O','A'))
 FROM (VALUES('hotel_stays'),('hotel_capacity_reservations'),('hotel_room_allocations')) e(tab)
UNION ALL SELECT 'SOURCE_FUNCTION '||e.sig,coalesce(
 md5(btrim(replace(p.prosrc,E'\r\n',E'\n'),E' \t\r\n'))=e.hash
 AND p.prokind='f' AND p.prosecdef=e.definer AND p.prorettype=to_regtype(e.result)
 AND coalesce(p.proargnames,ARRAY[]::text[])=e.names
 AND coalesce(p.proconfig,ARRAY[]::text[]) @> e.settings
 AND (NOT (e.sig=ANY(ARRAY['public.assert_hotel_room_allocation_available(uuid,uuid,timestamptz,timestamptz,uuid)','public.hotel_stay_json(uuid)','public.assign_hotel_room(uuid,integer,uuid,text,uuid)','public.reassign_hotel_room_before_check_in(uuid,integer,uuid,text,uuid)','public.move_hotel_room_same_type(uuid,integer,uuid,timestamptz,text,uuid)','public.complete_hotel_check_in(uuid,integer,timestamptz,uuid)','public.complete_hotel_check_out(uuid,integer,timestamptz,uuid)','public.change_room_type_before_check_in(uuid,integer,uuid,text,uuid)','public.change_room_type_after_check_in(uuid,integer,uuid,timestamptz,text,uuid)','public.reverse_hotel_completion(uuid,integer,text,text,uuid)','public.reverse_check_in_and_unassign_hotel_room(uuid,integer,text,uuid)']::text[])) OR (
   pg_get_userbyid(p.proowner)='postgres'
   AND p.prosecdef AND NOT p.proretset
   AND p.proconfig=ARRAY['search_path=public, pg_temp']::text[]
   AND (SELECT array_agg(a ORDER BY a) FROM unnest(p.proacl::text[]) a)
       =ARRAY['authenticated=X/postgres','postgres=X/postgres','service_role=X/postgres']::text[]
 )),false)
FROM (VALUES ('public.set_updated_at()','9c5cb25d02a3ae26735e199261d0c60e',false,'trigger',ARRAY[]::text[],ARRAY['search_path=public']::text[]),
('public.is_active_operation_member()','e979b4f7d479e103668b4be7663a93a5',true,'boolean',ARRAY[]::text[],ARRAY['search_path=public, pg_temp']::text[]),
('public.assert_hotel_room_allocation_available(uuid,uuid,timestamptz,timestamptz,uuid)','e7be62e54677361909e626dac52a0f0f',true,'void',ARRAY['p_room_id','p_capacity_reservation_id','p_allocated_from','p_allocated_until','p_exclude_allocation_id']::text[],ARRAY['search_path=public, pg_temp']::text[]),
('public.hotel_stay_json(uuid)','8f11789ab9e07d6db0e4b005b7aa22be',true,'jsonb',ARRAY['p_hotel_stay_id']::text[],ARRAY['search_path=public, pg_temp']::text[]),
('public.assign_hotel_room(uuid,integer,uuid,text,uuid)','a3a9f406e93bf551804bc96ba7eff427',true,'jsonb',ARRAY['p_hotel_stay_id','p_expected_version','p_room_id','p_reason','p_request_id']::text[],ARRAY['search_path=public, pg_temp']::text[]),
('public.reassign_hotel_room_before_check_in(uuid,integer,uuid,text,uuid)','7a4af43b7c5392c65f25e5955b4134d6',true,'jsonb',ARRAY['p_hotel_stay_id','p_expected_version','p_new_room_id','p_reason','p_request_id']::text[],ARRAY['search_path=public, pg_temp']::text[]),
('public.move_hotel_room_same_type(uuid,integer,uuid,timestamptz,text,uuid)','ef18c598d463852363d9a9feaf0245e1',true,'jsonb',ARRAY['p_hotel_stay_id','p_expected_version','p_new_room_id','p_move_at','p_reason','p_request_id']::text[],ARRAY['search_path=public, pg_temp']::text[]),
('public.complete_hotel_check_in(uuid,integer,timestamptz,uuid)','93457a694ffd6481c06be76edf3b9ac4',true,'jsonb',ARRAY['p_hotel_stay_id','p_expected_version','p_completed_at','p_request_id']::text[],ARRAY['search_path=public, pg_temp']::text[]),
('public.complete_hotel_check_out(uuid,integer,timestamptz,uuid)','f992843f4a89106aac8adc2cd21fc119',true,'jsonb',ARRAY['p_hotel_stay_id','p_expected_version','p_completed_at','p_request_id']::text[],ARRAY['search_path=public, pg_temp']::text[]),
('public.reverse_hotel_completion(uuid,integer,text,text,uuid)','376aeb7f6c32481403c4676c5811e008',true,'jsonb',ARRAY['p_hotel_stay_id','p_expected_version','p_completion_kind','p_reason','p_request_id']::text[],ARRAY['search_path=public, pg_temp']::text[]),
('public.assert_hotel_total_capacity_available(timestamptz,timestamptz,integer,uuid)','ccefc4c24e6b0123551e9aabc5cc73f0',true,'void',ARRAY['p_reserved_from','p_reserved_until','p_quantity','p_exclude_reservation_id']::text[],ARRAY['search_path=public, pg_temp']::text[]),
('public.enforce_hotel_total_capacity()','0d5fc980fb0239d1477c4b72c079007c',true,'trigger',ARRAY[]::text[],ARRAY['search_path=public, pg_temp']::text[]),
('public.enforce_hotel_allocation_room_type()','cc61ecd7ce66251b76187b4e71b831ab',true,'trigger',ARRAY[]::text[],ARRAY['search_path=public, pg_temp']::text[]),
('public.finalize_and_complete_hotel_check_in(uuid,integer,timestamptz,uuid,uuid,uuid)','b1b0e88777b7c291ce059e85300bb904',true,'jsonb',ARRAY['p_hotel_stay_id','p_expected_version','p_completed_at','p_room_type_id','p_room_id','p_request_id']::text[],ARRAY['search_path=public, pg_temp']::text[]),
('public.finalize_and_complete_hotel_check_out(uuid,integer,timestamptz,uuid)','e2dd1bffdd5d652db7f15a86590d415b',true,'jsonb',ARRAY['p_hotel_stay_id','p_expected_version','p_completed_at','p_request_id']::text[],ARRAY['search_path=public, pg_temp']::text[]),
('public.unassign_hotel_room_before_check_in(uuid,integer,text,uuid)','bfc1850fa6535c4bedf204da4a8c24bf',true,'jsonb',ARRAY['p_hotel_stay_id','p_expected_version','p_reason','p_request_id']::text[],ARRAY['search_path=public, pg_temp']::text[]),
('public.change_room_type_before_check_in(uuid,integer,uuid,text,uuid)','01bbcdaafcb3965f9462c2d43625b10f',true,'jsonb',ARRAY['p_hotel_stay_id','p_expected_version','p_new_room_id','p_reason','p_request_id']::text[],ARRAY['search_path=public, pg_temp']::text[]),
('public.change_room_type_after_check_in(uuid,integer,uuid,timestamptz,text,uuid)','907736bc62a8585b538515327b4fa843',true,'jsonb',ARRAY['p_hotel_stay_id','p_expected_version','p_new_room_id','p_effective_at','p_reason','p_request_id']::text[],ARRAY['search_path=public, pg_temp']::text[]),
('public.long_stay_deferred_invariant_trigger()','916144b51304995295d7911dc361b85b',true,'trigger',ARRAY[]::text[],ARRAY['search_path=public, pg_temp']::text[]),
('public.enforce_shared_capacity_deferred()','76e4b39304a3636526bd5f8e94be25f7',true,'trigger',ARRAY[]::text[],ARRAY['search_path=public, pg_temp']::text[]),
('public.enforce_shared_allocation_deferred()','6f34cb8c2bcd21a6b1bd7ea0592b1489',true,'trigger',ARRAY[]::text[],ARRAY['search_path=public, pg_temp']::text[]),
('public.sync_hotel_lifecycle_schedule_status_internal()','47957c5ea801c228e3fdb49bb2dc1078',true,'trigger',ARRAY[]::text[],ARRAY['search_path=public, pg_temp']::text[]),
('public.guard_long_stay_outing_released_checkout()','b5e5d66019e63a08d327ad695e4205cf',true,'trigger',ARRAY[]::text[],ARRAY['search_path=public, pg_temp']::text[]),
('public.enforce_requested_shared_room_capacity_deferred()','2c8680f800633f392d53e3d89e97e9de',true,'trigger',ARRAY[]::text[],ARRAY['search_path=public, pg_temp']::text[]),
('public.guard_requested_shared_room_member_mutation()','428951fc8841c54379282dd8835370dd',true,'trigger',ARRAY[]::text[],ARRAY['search_path=public, pg_temp']::text[]),
('public.reverse_check_in_and_unassign_hotel_room(uuid,integer,text,uuid)','e807f3ba0c05ec8ecdab8243cfe5d4ba',true,'jsonb',ARRAY['p_hotel_stay_id','p_expected_version','p_reason','p_request_id']::text[],ARRAY['search_path=public, pg_temp']::text[]),
('public.can_operate_hotel()','85d6ee000f01016385da400a0d1879a5',true,'boolean',ARRAY[]::text[],ARRAY['search_path=public, pg_temp']::text[]),
('public.get_operation_hotel_room_projections(uuid[])','27cd8bbdd8231acab0fa631727652c0d',true,'jsonb',ARRAY['p_operation_schedule_ids']::text[],ARRAY['search_path=public, pg_temp']::text[]),
('public.get_completed_shared_hotel_stays(date)','8a1a48e8956ea5530a7a37858d08400d',true,'jsonb',ARRAY['p_local_date']::text[],ARRAY['search_path=public, pg_temp']::text[]),
('public.get_operation_hotel_room_projections_v2(uuid[])','02fb77fc5a08c30eaae2f1d9cce5f18f',true,'jsonb',ARRAY['p_operation_schedule_ids']::text[],ARRAY['search_path=public, pg_temp']::text[]),
('public.get_hotel_shared_room_history(date)','560ee0f917e1673026bc4d3c7e98f535',true,'jsonb',ARRAY['p_local_date']::text[],ARRAY['search_path=public, pg_temp']::text[]),
('public.hotel_history_individual_010(jsonb)','819c9ccfa6fd0c266b8101436050ab18',false,'jsonb',ARRAY['p']::text[],ARRAY['search_path=public, pg_temp']::text[]),
('public.get_hotel_historical_room_board(date)','e08300442d7b8b4c2ae41cd33917c230',true,'jsonb',ARRAY['p_local_date']::text[],ARRAY['search_path=public, pg_temp']::text[])) e(sig,hash,definer,result,names,settings)
LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.sig)
 UNION ALL SELECT '016B_FUNCTION '||e.sig,coalesce(md5(p.prosrc)=e.hash AND p.prokind='f'
 AND p.prosecdef AND NOT p.proretset AND p.prorettype='jsonb'::regtype AND p.proargnames=e.names
 AND p.pronargdefaults=0 AND p.provolatile::text=e.volatility AND p.proconfig=ARRAY['search_path=public, pg_temp']::text[]
 AND pg_get_userbyid(p.proowner)='postgres'
 AND (SELECT array_agg(a ORDER BY a) FROM unnest(p.proacl::text[]) a)
  =CASE WHEN e.private THEN ARRAY['postgres=X/postgres']::text[] ELSE ARRAY['authenticated=X/postgres','postgres=X/postgres']::text[] END
 AND NOT has_function_privilege('anon',p.oid,'EXECUTE') AND NOT has_function_privilege('service_role',p.oid,'EXECUTE')
 AND has_function_privilege('authenticated',p.oid,'EXECUTE')=NOT e.private,false)
 FROM new016b e LEFT JOIN pg_proc p ON p.oid=to_regprocedure('public.'||e.sig)
 UNION ALL SELECT '016B_NO_EXTRA_OVERLOAD',count(*)=3 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname IN (SELECT split_part(sig,'(',1) FROM new016b)
 UNION ALL SELECT '016B_RECEIPT_SECURITY',coalesce((SELECT c.relkind='r' AND c.relrowsecurity AND NOT c.relforcerowsecurity
 AND pg_get_userbyid(c.relowner)='postgres'
 AND NOT has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
 AND NOT has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
 AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE a.grantee=0)
 AND NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=c.oid AND attacl IS NOT NULL)
 AND NOT EXISTS(SELECT 1 FROM pg_policy WHERE polrelid=c.oid)
 AND NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=c.oid AND NOT tgisinternal)
 FROM pg_class c WHERE c.oid=to_regclass('public.hotel_missed_check_in_receipts')),false)
 UNION ALL SELECT '016B_COLUMN '||e.name,coalesce(a.attnum=e.pos AND format_type(a.atttypid,a.atttypmod)=e.typ
 AND a.attnotnull AND a.attidentity='' AND a.attgenerated=''
 AND pg_get_expr(d.adbin,d.adrelid) IS NOT DISTINCT FROM e.def,false)
 FROM (VALUES (1,'request_id','uuid',NULL::text),(2,'actor_user_id','uuid',NULL::text),(3,'hotel_stay_id','uuid',NULL::text),(4,'normalized_input','jsonb',NULL::text),(5,'checked_in_at','timestamp with time zone',NULL::text),(6,'room_id','uuid',NULL::text),(7,'expected_stay_version','integer',NULL::text),(8,'expected_capacity_version','integer',NULL::text),(9,'capacity_reservation_id','uuid',NULL::text),(10,'resulting_stay_version','integer',NULL::text),(11,'resulting_allocation_id','uuid',NULL::text),(12,'resulting_allocation_version','integer',NULL::text),(13,'response','jsonb',NULL::text),(14,'created_at','timestamp with time zone','clock_timestamp()'))e(pos,name,typ,def)
 LEFT JOIN pg_attribute a ON a.attrelid=to_regclass('public.hotel_missed_check_in_receipts') AND a.attname=e.name AND NOT a.attisdropped
 LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
 UNION ALL SELECT '016B_COLUMNS_EXACT',count(*)=14 FROM pg_attribute WHERE attrelid=to_regclass('public.hotel_missed_check_in_receipts') AND attnum>0 AND NOT attisdropped
 UNION ALL SELECT '016B_CONSTRAINT '||e.def,EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conrelid=to_regclass('public.hotel_missed_check_in_receipts') AND pg_get_constraintdef(c.oid)=e.def AND c.convalidated AND NOT c.condeferrable AND NOT c.condeferred)
 FROM (VALUES ('PRIMARY KEY (request_id)'),('CHECK ((expected_stay_version > 0))'),('CHECK ((expected_capacity_version > 0))'),('FOREIGN KEY (actor_user_id) REFERENCES profiles(id)'),('FOREIGN KEY (hotel_stay_id) REFERENCES hotel_stays(id)'),('FOREIGN KEY (room_id) REFERENCES hotel_rooms(id)'),('FOREIGN KEY (capacity_reservation_id) REFERENCES hotel_capacity_reservations(id)'),('FOREIGN KEY (resulting_allocation_id) REFERENCES hotel_room_allocations(id)'))e(def)
 UNION ALL SELECT '016B_CONSTRAINTS_EXACT',count(*)=8 FROM pg_constraint WHERE conrelid=to_regclass('public.hotel_missed_check_in_receipts') AND contype<>'n'
 UNION ALL SELECT '016B_PRIMARY_INDEX',count(*)=1 AND bool_and(indisprimary AND indisunique AND indisvalid AND indisready) FROM pg_index WHERE indrelid=to_regclass('public.hotel_missed_check_in_receipts')
 ) SELECT check_name,CASE WHEN ok IS TRUE THEN 'PASS' ELSE 'FAIL' END status,
 jsonb_build_object('matched',ok IS TRUE,'on_failure','STOP_NO_REPAIR') detail FROM checks
 UNION ALL SELECT '00_OVERALL',CASE WHEN bool_and(ok IS TRUE) THEN 'PASS' ELSE 'FAIL' END,
 jsonb_build_object('gate','016B_POSTFLIGHT','failed_checks',count(*) FILTER(WHERE ok IS NOT TRUE),
 'failed_items',coalesce(jsonb_agg(check_name) FILTER(WHERE ok IS NOT TRUE),'[]'::jsonb)) FROM checks
 UNION ALL SELECT '99_SCOPE','INFORMATIONAL_ONLY',jsonb_build_object('read_only',current_setting('transaction_read_only'),
 'business_rows_queried',false,'mutation',0,'limits','catalog validation only; no Production command test') ORDER BY check_name;
ROLLBACK;
