-- Only the isolated synthetic V2-A database; run before the V2-B migration.
DO $$ BEGIN IF current_database()<>'dog_v2b_fixture' OR inet_server_addr() IS NOT NULL THEN RAISE EXCEPTION 'LOCAL_ONLY'; END IF; END $$;
ALTER TABLE dogs ADD COLUMN birth_date date, ADD COLUMN weight numeric, ADD COLUMN neutered boolean,
 ADD COLUMN memo text, ADD COLUMN photo_url text, ADD COLUMN is_daycare_student boolean DEFAULT false,
 ADD COLUMN created_at timestamptz DEFAULT now(), ADD COLUMN created_by uuid, ADD COLUMN updated_at timestamptz DEFAULT now();
ALTER TABLE dogs ALTER COLUMN id SET DEFAULT gen_random_uuid(), ALTER COLUMN is_active SET DEFAULT true;
ALTER TABLE entity_audit_events ADD COLUMN module_code text, ADD COLUMN action text, ADD COLUMN changed_by uuid, ADD COLUMN change_reason text;
ALTER TABLE entity_audit_events ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE dogs ENABLE ROW LEVEL SECURITY;
CREATE POLICY dogs_select ON dogs FOR SELECT TO authenticated USING(true);
CREATE POLICY dogs_update ON dogs FOR UPDATE TO authenticated USING(is_active_user()) WITH CHECK(is_active_user());
CREATE POLICY dogs_insert ON dogs FOR INSERT TO authenticated WITH CHECK(is_active_user());
GRANT SELECT ON dogs TO authenticated;
-- Supabase auth schema usage supplied by the platform; reproduce it locally.
GRANT USAGE ON SCHEMA auth TO authenticated;
-- READ provenance columns present in the captured current catalog.
ALTER TABLE journal_days ADD COLUMN journal_type text NOT NULL DEFAULT 'daycare_daily';
ALTER TABLE family_booking_members ADD COLUMN hotel_stay_id uuid, ADD COLUMN operation_schedule_id uuid;
ALTER TABLE hotel_physical_occupancy_members ADD COLUMN hotel_stay_id uuid, ADD COLUMN family_booking_member_id uuid;
