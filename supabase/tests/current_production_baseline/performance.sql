BEGIN;
DO $$ BEGIN IF current_database()<>'dog_current_baseline' OR inet_server_addr() IS NOT NULL THEN RAISE EXCEPTION 'LOCAL_ONLY'; END IF; END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000900',true);
INSERT INTO dogs(id,name,customer_id) SELECT ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Synthetic scale '||n,'00000000-0000-4000-8000-000000000800' FROM generate_series(10000,11000) n;
ANALYZE dogs;
EXPLAIN (ANALYZE,BUFFERS) SELECT profile_status FROM dogs WHERE id='00000000-0000-4000-8000-000000000007' FOR UPDATE NOWAIT;
ROLLBACK;
