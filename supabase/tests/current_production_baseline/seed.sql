-- ISOLATED SYNTHETIC DATA ONLY. Never run on a remote connection.
BEGIN;
DO $$ BEGIN IF current_database()<>'dog_current_baseline' OR inet_server_addr() IS NOT NULL THEN RAISE EXCEPTION 'LOCAL_ONLY'; END IF; END $$;
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES('00000000-0000-4000-8000-000000000900','baseline@example.invalid','{"phone":"01000000900","name":"Synthetic Operator"}');
UPDATE profiles SET role='admin',account_status='active' WHERE id='00000000-0000-4000-8000-000000000900';
UPDATE operation_memberships SET role='owner',is_active=true WHERE profile_id='00000000-0000-4000-8000-000000000900';
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000900',true);
INSERT INTO business_units(id,code,name,sort_order) VALUES
('00000000-0000-4000-8000-000000000010','hotel','Synthetic Hotel',1),
('00000000-0000-4000-8000-000000000011','daycare','Synthetic Daycare',2),
('00000000-0000-4000-8000-000000000012','training','Synthetic Training',3);
INSERT INTO customers(id,name) VALUES('00000000-0000-4000-8000-000000000800','Synthetic Customer');
INSERT INTO dogs(id,name,customer_id,is_daycare_student)
SELECT ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Synthetic Dog '||n,'00000000-0000-4000-8000-000000000800',true FROM generate_series(1,9) n;
INSERT INTO operation_calendars(id,name,scope_type,business_unit_id,color,created_by)
SELECT ('00000000-0000-4000-8000-'||lpad((n+10)::text,12,'0'))::uuid,'Synthetic Calendar '||n,'business_unit',('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'#123456',auth.uid() FROM generate_series(10,12) n;
INSERT INTO operation_schedule_types(id,name,color,created_by) VALUES('00000000-0000-4000-8000-000000000030','Synthetic Type','#123456',auth.uid());
INSERT INTO operation_calendar_schedule_types(calendar_id,schedule_type_id,created_by) SELECT id,'00000000-0000-4000-8000-000000000030',auth.uid() FROM operation_calendars;
INSERT INTO hotel_operation_settings(created_by,updated_by) VALUES(auth.uid(),auth.uid());
INSERT INTO hotel_room_types(id,code,name,created_by,updated_by) VALUES('00000000-0000-4000-8000-000000000040','DELUXE','DELUXE',auth.uid(),auth.uid()),('00000000-0000-4000-8000-000000000041','STANDARD','STANDARD',auth.uid(),auth.uid());
INSERT INTO hotel_rooms(id,room_type_id,name,sort_order,created_by,updated_by)
SELECT ('00000000-0000-4000-8000-'||lpad((n+50)::text,12,'0'))::uuid,'00000000-0000-4000-8000-000000000040','Synthetic Room '||n,n,auth.uid(),auth.uid() FROM generate_series(1,10) n;
INSERT INTO products(id,business_unit_id,name,default_price) VALUES('00000000-0000-4000-8000-000000000060','00000000-0000-4000-8000-000000000010','Synthetic Product',100);
-- Pre-V2-B inactive fixture; no post-migration lifecycle bypass.
INSERT INTO dogs(id,name,customer_id,is_active) VALUES('00000000-0000-4000-8000-000000000010','Synthetic Inactive','00000000-0000-4000-8000-000000000800',false);
COMMIT;
