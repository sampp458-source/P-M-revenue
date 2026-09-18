-- Isolated synthetic mutations roll back. Never run in Production.
BEGIN;
SELECT fixture_assert(current_database()='dog_v2a_fixture' AND inet_server_addr() IS NULL,'local fixture only');
SET LOCAL request.jwt.claim.sub='00000000-0000-4000-8000-000000000900';
INSERT INTO dogs SELECT fixture_id(n),'Sales fixture',fixture_id(800),true,NULL,NULL FROM generate_series(30,39) n;
INSERT INTO sales SELECT fixture_id(1000+n),fixture_id(n),'normal',0,'2026-09-01' FROM generate_series(30,39) n;
INSERT INTO sales VALUES(fixture_id(1100),fixture_id(30),'normal',0,'2026-09-01');
INSERT INTO sale_history SELECT fixture_id(2000+n),fixture_id(1000+n)::text,'created',NULL,to_jsonb(s) FROM generate_series(30,39) n JOIN sales s ON s.id=fixture_id(1000+n);
INSERT INTO sale_history SELECT fixture_id(2100),id::text,'created',NULL,to_jsonb(s) FROM sales s WHERE id=fixture_id(1100);
SELECT fixture_assert((preview_dog_profile_removal(fixture_id(30))->>'profileRemovalEligible')::boolean,'two normal sales resolved');
SELECT fixture_assert((SELECT c->>'userVisibleCount'='2' AND c->>'technicalReferenceCount'='2' FROM jsonb_array_elements(preview_dog_profile_removal(fixture_id(30))->'categories') c WHERE c->>'category'='sales'),'two business records; traces not duplicated visits');
UPDATE sale_history SET sale_id=fixture_id(9999)::text WHERE id=fixture_id(2031);
UPDATE sale_history SET sale_id='malformed' WHERE id=fixture_id(2032);
UPDATE sale_history SET sale_id=NULL WHERE id=fixture_id(2039);
SELECT fixture_assert(preview_dog_profile_removal(fixture_id(n))->'blockingReasonCodes' ? 'UNRESOLVED_STRUCTURED_IDENTITY','orphan/malformed/null blocked '||n) FROM unnest(ARRAY[31,32,39]) n;
-- Trusted OLD -> NEW full row transition proves prior dog identity, without a live dog FK.
DELETE FROM sale_history WHERE id=fixture_id(2033);
INSERT INTO sale_history SELECT fixture_id(2133),id::text,'updated',to_jsonb(s),jsonb_set(to_jsonb(s),'{dog_id}',to_jsonb(fixture_id(38))) FROM sales s WHERE id=fixture_id(1033);
UPDATE sales SET dog_id=fixture_id(38) WHERE id=fixture_id(1033);
SELECT fixture_assert((preview_dog_profile_removal(fixture_id(33))->>'profileRemovalEligible')::boolean AND NOT (preview_dog_profile_removal(fixture_id(33))->>'hardDeleteEligible')::boolean,'proven historical reassignment; trace preserved');
-- Even one changed non-identity field invalidates direct transition proof.
UPDATE sales SET outstanding_amount=1 WHERE id=fixture_id(1033);
SELECT fixture_assert(preview_dog_profile_removal(fixture_id(33))->'blockingReasonCodes' ? 'UNRESOLVED_STRUCTURED_IDENTITY','full snapshot mismatch fails closed');
UPDATE sales SET dog_id=fixture_id(38) WHERE id=fixture_id(1034);
SELECT fixture_assert(preview_dog_profile_removal(fixture_id(34))->'blockingReasonCodes' ? 'UNRESOLVED_STRUCTURED_IDENTITY','unproven changed dog blocked');
UPDATE sale_history SET changed_data=jsonb_build_object('id',fixture_id(1035),'dog_id',fixture_id(38),'nested',jsonb_build_object('dog_id',fixture_id(35))) WHERE id=fixture_id(2035);
SELECT fixture_assert(preview_dog_profile_removal(fixture_id(35))->'blockingReasonCodes' ? 'UNRESOLVED_STRUCTURED_IDENTITY','nested unrelated dog not resolved by sale id');
SELECT fixture_assert(NOT dog_identity_in_payload_v2a(jsonb_build_object('dog_id',fixture_id(38)),fixture_id(35)),'unrelated identity not matched');
UPDATE sales SET outstanding_amount=100 WHERE id=fixture_id(1036);
SELECT fixture_assert((preview_dog_profile_removal(fixture_id(36))->>'profileRemovalEligible')::boolean AND preview_dog_profile_removal(fixture_id(36))->'warnings' ? 'OUTSTANDING_SALES','outstanding warns only');
DO $$ DECLARE state text; BEGIN
 FOREACH state IN ARRAY ARRAY['cancelled','partial_refund','full_refund'] LOOP
 UPDATE sales SET status=state WHERE id=fixture_id(1037);
 UPDATE sale_history SET action=state,changed_data=(SELECT to_jsonb(s) FROM sales s WHERE id=fixture_id(1037)) WHERE id=fixture_id(2037);
 PERFORM fixture_assert((preview_dog_profile_removal(fixture_id(37))->>'profileRemovalEligible')::boolean,'refund/cancel history '||state);
 END LOOP;
END $$;
SELECT fixture_assert(preview_dog_profile_removal(fixture_id(30))->>'graphFingerprint'=preview_dog_profile_removal(fixture_id(30))->>'graphFingerprint','sales fingerprint deterministic');
SELECT fixture_assert(NOT has_function_privilege(r,'dog_structured_traces_v2a(uuid)','EXECUTE') AND NOT has_function_privilege(r,'dog_identity_in_payload_v2a(jsonb,uuid)','EXECUTE'),'private helper denied '||r) FROM unnest(ARRAY['anon','authenticated','service_role']) r;
ROLLBACK;
