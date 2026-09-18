-- Run AFTER the synthetic fixture and new migration, on a local Unix socket only.
BEGIN READ ONLY;
SELECT fixture_assert(current_database()='dog_v2a_fixture' AND inet_server_addr() IS NULL,'local fixture only');
SET LOCAL request.jwt.claim.sub='00000000-0000-4000-8000-000000000900';
SET LOCAL ROLE authenticated;
SELECT public.fixture_assert(current_setting('transaction_read_only')='on','READ ONLY');
SELECT fixture_assert(jsonb_array_length(get_historical_dog_identities(ARRAY[fixture_id(1),fixture_id(2),fixture_id(2)]))=2,'batch distinct active/inactive');
SELECT fixture_assert(get_historical_dog_identities(ARRAY[fixture_id(2)])->0->>'profileStatus'='inactive','inactive identity retained');
SELECT fixture_assert(get_historical_dog_identities(ARRAY[]::uuid[])='[]','empty batch');
SELECT fixture_assert((preview_dog_profile_removal(fixture_id(1))->>'hardDeleteEligible')::boolean,'A unused; master audit nonblocking');
SELECT fixture_assert((preview_dog_profile_removal(fixture_id(n))->>'profileRemovalEligible')::boolean AND NOT (preview_dog_profile_removal(fixture_id(n))->>'hardDeleteEligible')::boolean,'historical allowance '||n) FROM unnest(ARRAY[2,3,6,7,8,11]) n;
SELECT fixture_assert((preview_dog_profile_removal(fixture_id(n))->>'activeBlockerCount')::integer>0 AND NOT (preview_dog_profile_removal(fixture_id(n))->>'profileRemovalEligible')::boolean,'active blocker '||n) FROM unnest(ARRAY[4,5,9,10,12,16,17,18,19,20]) n;
SELECT fixture_assert((SELECT (c->>'userVisibleCount')::integer=1 FROM jsonb_array_elements(preview_dog_profile_removal(fixture_id(19))->'categories') c WHERE c->>'category'='shared'),'requested shared group shown before occupancy');
SELECT fixture_assert(preview_dog_profile_removal(fixture_id(8))->'warnings' ? 'OUTSTANDING_SALES','H outstanding warning');
SELECT fixture_assert((SELECT (c->>'userVisibleCount')::integer=1 AND (c->>'technicalReferenceCount')::integer=1 FROM jsonb_array_elements(preview_dog_profile_removal(fixture_id(3))->'categories') c WHERE c->>'category'='hotel'),'hotel children not extra business records');
SELECT fixture_assert((SELECT (c->>'userVisibleCount')::integer=1 AND (c->>'technicalReferenceCount')::integer=2 FROM jsonb_array_elements(preview_dog_profile_removal(fixture_id(15))->'categories') c WHERE c->>'category'='journal'),'journal two FK edges deduplicated');
SELECT fixture_assert(NOT (preview_dog_profile_removal(fixture_id(13))->>'hardDeleteEligible')::boolean,'structured legacy request blocks hard delete');
SELECT fixture_assert(preview_dog_profile_removal(fixture_id(2))->>'graphFingerprint'=preview_dog_profile_removal(fixture_id(2))->>'graphFingerprint','fingerprint deterministic');
SELECT fixture_assert(preview_dog_profile_removal(fixture_id(n))->'version'='null' AND preview_dog_profile_removal(fixture_id(n))->'commandAvailable'='false','no write token '||n) FROM generate_series(1,20) n;
DO $$ BEGIN
 BEGIN PERFORM dog_identity_in_payload_v2a('{}',fixture_id(1)); RAISE EXCEPTION 'PRIVATE_HELPER_ACCESS'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM dog_structured_traces_v2a(fixture_id(1)); RAISE EXCEPTION 'PRIVATE_TRACE_ACCESS'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT fixture_assert(dog_identity_in_payload_v2a(jsonb_build_object('dog',jsonb_build_object('id',fixture_id(1))),fixture_id(1)),'nested identity');
SELECT fixture_assert(NOT dog_identity_in_payload_v2a(jsonb_build_object('memo',fixture_id(1)),fixture_id(1)),'free text not identity');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='00000000-0000-4000-8000-000000000901';
DO $$ BEGIN
 BEGIN PERFORM preview_dog_profile_removal(fixture_id(1)); RAISE EXCEPTION 'INACTIVE_AUTH_ALLOWED'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM get_historical_dog_identities(ARRAY[fixture_id(1)]); RAISE EXCEPTION 'INACTIVE_READ_ALLOWED'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SET LOCAL request.jwt.claim.sub='00000000-0000-4000-8000-000000000902';
DO $$ BEGIN
 BEGIN PERFORM preview_dog_profile_removal(fixture_id(1)); RAISE EXCEPTION 'PENDING_AUTH_ALLOWED'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SET LOCAL request.jwt.claim.sub='';
DO $$ BEGIN
 BEGIN PERFORM preview_dog_profile_removal(fixture_id(1)); RAISE EXCEPTION 'NULL_AUTH_ALLOWED'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$ BEGIN
 BEGIN PERFORM preview_dog_profile_removal(fixture_id(1)); RAISE EXCEPTION 'ANON_ALLOWED'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
ROLLBACK;
