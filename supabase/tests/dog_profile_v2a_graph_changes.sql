-- LOCAL SYNTHETIC TEST ONLY: setup changes are rolled back; no Production execution.
BEGIN;
SELECT fixture_assert(current_database()='dog_v2a_fixture' AND inet_server_addr() IS NULL,'local only');
SET LOCAL request.jwt.claim.sub='00000000-0000-4000-8000-000000000900';
DO $$ DECLARE before_hash text; after_hash text; before_json jsonb; BEGIN
 before_json:=preview_dog_profile_removal(fixture_id(6));
 before_hash:=before_json->>'graphFingerprint';
 UPDATE operation_schedules SET status='scheduled' WHERE id=fixture_id(106);
 after_hash:=preview_dog_profile_removal(fixture_id(6))->>'graphFingerprint';
 PERFORM fixture_assert(before_hash<>after_hash,'graph changes invalidate fingerprint');
 PERFORM fixture_assert((preview_dog_profile_removal(fixture_id(6))->>'activeBlockerCount')::integer=1,'reopened schedule detected');
 UPDATE operation_schedules SET status='completed' WHERE id=fixture_id(106);
 PERFORM fixture_assert(before_hash=preview_dog_profile_removal(fixture_id(6))->>'graphFingerprint','restored identical graph hashes identically');
 PERFORM set_config('timezone','Asia/Seoul',true);
 PERFORM fixture_assert(before_hash=preview_dog_profile_removal(fixture_id(6))->>'graphFingerprint','session timezone does not alter hash');
END $$;
-- Unexpected dog reference must never become an eligible unused delete.
CREATE TABLE fixture_unexpected_reference(id uuid,dog_id uuid REFERENCES dogs);
SELECT fixture_assert(preview_dog_profile_removal(fixture_id(1))->'blockingReasonCodes' ? 'REFERENCE_INVENTORY_MISMATCH','unknown FK inventory fail closed');
SELECT fixture_assert(preview_dog_profile_removal(fixture_id(1))->'hardDeleteEligible'='false','unknown FK prevents hard delete');
DROP TABLE fixture_unexpected_reference;
-- New structured receipt cannot silently become a nonblocking unused profile.
INSERT INTO fixture_operation_requests VALUES(fixture_id(960),jsonb_build_object('dog',jsonb_build_object('id',fixture_id(1))));
SELECT fixture_assert(preview_dog_profile_removal(fixture_id(1))->'blockingReasonCodes' ? 'UNRESOLVED_STRUCTURED_IDENTITY','unresolved receipt blocks removal');
SELECT fixture_assert(preview_dog_profile_removal(fixture_id(1))->'proposedMode'='null','no automatic choice for unresolved graph');
ROLLBACK;
