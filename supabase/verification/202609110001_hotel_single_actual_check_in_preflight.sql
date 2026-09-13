BEGIN TRANSACTION READ ONLY;
WITH checks AS (
 SELECT 'APPEND_OBJECTS_ABSENT' name,
 to_regclass('public.hotel_single_check_in_receipts') IS NULL
 AND to_regprocedure('public.hotel_single_room_eligibility_internal(uuid,text,timestamptz)') IS NULL
 AND to_regprocedure('public.get_hotel_single_room_eligibility(uuid,text,timestamptz)') IS NULL
 AND to_regprocedure('public.check_in_unassigned_hotel_stay(uuid,integer,integer,uuid,timestamptz,uuid)') IS NULL ok
 UNION ALL SELECT 'DEPENDENCIES',bool_and(to_regprocedure(signature) IS NOT NULL) FROM (VALUES
 ('public.assert_hotel_room_allocation_available(uuid,uuid,timestamptz,timestamptz,uuid)'),
 ('public.hotel_stay_json(uuid)'),('public.is_active_operation_member()'),
 ('public.protect_hotel_entity_metadata()'),('public.record_hotel_operation_audit_event()')) x(signature)
 UNION ALL SELECT 'TABLES',bool_and(to_regclass('public.'||name) IS NOT NULL) FROM (VALUES
 ('profiles'),('hotel_stays'),('hotel_capacity_reservations'),('hotel_room_allocations'),('hotel_rooms'),
 ('hotel_room_types'),('hotel_stay_schedule_events'),('operation_schedules'),('entity_audit_events'),
 ('hotel_physical_occupancy_members'),('family_booking_members'),('long_stay_contracts'),('long_stay_monthly_occupancies'),('long_stay_absence_events')) x(name)
 UNION ALL SELECT 'VERSION_AND_OWNERSHIP_COLUMNS',bool_and(EXISTS(SELECT 1 FROM information_schema.columns c WHERE c.table_schema='public' AND c.table_name=x.tab AND c.column_name=x.col)) FROM (VALUES
 ('hotel_stays','version'),('hotel_capacity_reservations','version'),('hotel_room_allocations','version'),
 ('hotel_capacity_reservations','shared_room_group_id'),('hotel_capacity_reservations','physical_occupancy_id'),
 ('hotel_capacity_reservations','quantity'),('hotel_stays','checked_in_at')) x(tab,col)
 UNION ALL SELECT 'AUDIT_VERSION_TRIGGERS',bool_and(
 EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid=to_regclass('public.'||tab) AND NOT t.tgisinternal AND t.tgenabled IN ('O','A') AND t.tgfoid=to_regprocedure('public.record_hotel_operation_audit_event()'))
 AND EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid=to_regclass('public.'||tab) AND NOT t.tgisinternal AND t.tgenabled IN ('O','A') AND t.tgfoid=to_regprocedure('public.protect_hotel_entity_metadata()')))
 FROM (VALUES('hotel_stays'),('hotel_capacity_reservations'),('hotel_room_allocations')) x(tab)
)
SELECT name AS check_name,CASE WHEN ok IS TRUE THEN 'PASS' ELSE 'FAIL' END status FROM checks
UNION ALL SELECT 'OVERALL',CASE WHEN bool_and(ok IS TRUE) THEN 'PASS' ELSE 'FAIL' END FROM checks;
ROLLBACK;
