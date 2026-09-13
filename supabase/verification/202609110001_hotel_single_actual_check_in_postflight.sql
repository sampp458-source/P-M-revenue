BEGIN TRANSACTION READ ONLY;
WITH expected(signature,body_md5,private) AS (VALUES ('hotel_single_room_eligibility_internal(uuid,text,timestamptz)','8e1ec0b36c21013a40cd60b58d61569b',true),
('get_hotel_single_room_eligibility(uuid,text,timestamptz)','849bf44f236af98b3969877f7b039d67',false),
('check_in_unassigned_hotel_stay(uuid,integer,integer,uuid,timestamptz,uuid)','e5ab0f930b01743c6ec63552ff1df0aa',false)), checks AS (
 SELECT signature AS name, coalesce(p.prosecdef AND p.proconfig @> ARRAY['search_path=public, pg_temp']
 AND md5(p.prosrc)=e.body_md5
 AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
 AND has_function_privilege('authenticated',p.oid,'EXECUTE')=NOT e.private,false) AS ok
 FROM expected e LEFT JOIN pg_proc p ON p.oid=to_regprocedure('public.'||e.signature)
 UNION ALL SELECT 'RECEIPT_SECURITY',coalesce((SELECT relrowsecurity FROM pg_class WHERE oid=to_regclass('public.hotel_single_check_in_receipts')),false)
 AND NOT has_table_privilege('authenticated','public.hotel_single_check_in_receipts','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
 AND NOT has_table_privilege('anon','public.hotel_single_check_in_receipts','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
 UNION ALL SELECT 'REQUEST_ID_SINGLE_PRIMARY_KEY',EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conrelid=to_regclass('public.hotel_single_check_in_receipts') AND c.contype='p' AND pg_get_constraintdef(c.oid)='PRIMARY KEY (request_id)')
)
SELECT name check_name,CASE WHEN ok IS TRUE THEN 'PASS' ELSE 'FAIL' END status FROM checks
UNION ALL SELECT 'OVERALL',CASE WHEN bool_and(ok IS TRUE) THEN 'PASS' ELSE 'FAIL' END FROM checks;
ROLLBACK;
