-- Local synthetic only: real roster/draft/complete RPCs and adversarial audit values.
BEGIN;
DO $$ BEGIN IF current_database()<>'dog_current_baseline' OR inet_server_addr() IS NOT NULL THEN RAISE EXCEPTION 'LOCAL_ONLY'; END IF; END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000900',true);
CREATE FUNCTION pg_temp.f(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
CREATE FUNCTION pg_temp.ok(b boolean,label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF b IS DISTINCT FROM true THEN RAISE EXCEPTION 'ASSERTION: %',label; END IF; END $$;
DO $$ DECLARE role_name text; fn regprocedure; BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  FOREACH fn IN ARRAY ARRAY['dog_journal_audit_resolved_v2a(jsonb,uuid)'::regprocedure,'dog_remaining_trace_resolved_v2a(text,jsonb,uuid)'::regprocedure] LOOP
   PERFORM pg_temp.ok(NOT has_function_privilege(role_name,fn,'EXECUTE'),'private helper execute denied '||role_name);
  END LOOP;
 END LOOP;
END $$;
DO $$ DECLARE day_a jsonb; entry_a jsonb; bad jsonb; p jsonb; eid uuid; v integer; dayid uuid; before_entry jsonb; before_audits jsonb; d date:=(now() AT TIME ZONE 'Asia/Seoul')::date-3; BEGIN
 PERFORM register_journal_roster(d,ARRAY[pg_temp.f(9),pg_temp.f(2),pg_temp.f(3),pg_temp.f(4)],gen_random_uuid());
 SELECT id,version,journal_day_id INTO eid,v,dayid FROM journal_entries WHERE dog_id=pg_temp.f(9);
 SELECT to_jsonb(a) INTO day_a FROM entity_audit_events a WHERE entity_type='journal_days' AND entity_id=dayid AND change_reason='journal_day_default_activities_register';
 PERFORM pg_temp.ok(dog_journal_audit_resolved_v2a(day_a,pg_temp.f(9)),'normal day audit resolved');
 PERFORM pg_temp.ok(dog_journal_audit_resolved_v2a(day_a,pg_temp.f(2)),'same day second exact dog resolved');
 PERFORM pg_temp.ok(NOT dog_journal_audit_resolved_v2a(day_a,pg_temp.f(5)),'same day unrelated dog denied');
 -- Another historical roster member may no longer have an entry; it cannot invalidate this exact retained dog/day.
 bad:=jsonb_set(day_a,'{after_data,request,dogIds}',(day_a->'after_data'->'request'->'dogIds')||jsonb_build_array(pg_temp.f(5)));
 PERFORM pg_temp.ok(dog_journal_audit_resolved_v2a(bad,pg_temp.f(9)),'missing other roster entry does not block retained target');
 PERFORM pg_temp.ok(NOT dog_journal_audit_resolved_v2a(bad,pg_temp.f(5)),'missing target roster entry fail closed');
 p:=preview_dog_profile_removal(pg_temp.f(9));
 PERFORM pg_temp.ok(p->'blockingReasonCodes' ? 'journal_ACTIVE_OPERATION','draft remains active blocker');
 PERFORM pg_temp.ok(NOT(p->'blockingReasonCodes' ? 'UNRESOLVED_STRUCTURED_IDENTITY'),'draft provenance not unknown');
 PERFORM update_journal_entry_draft_v2(eid,v,ARRAY['active'],true,false,NULL,ARRAY['daycare_food'],'loves_teacher','loves_friends',jsonb_build_array(jsonb_build_object('type','DOG','dogId',pg_temp.f(3))),NULL,NULL,NULL,NULL,'Synthetic journal',gen_random_uuid());
 SELECT to_jsonb(a) INTO entry_a FROM entity_audit_events a WHERE entity_type='journal_entries' AND entity_id=eid AND after_data ? 'entry' ORDER BY created_at DESC,id DESC LIMIT 1;
 PERFORM pg_temp.ok(dog_journal_audit_resolved_v2a(entry_a,pg_temp.f(9)),'main dog entry provenance');
 PERFORM pg_temp.ok(dog_journal_audit_resolved_v2a(entry_a,pg_temp.f(3)),'best friend target exact identity');
 -- Legacy best_friend_dog_id retained relation, separate from array targets.
 UPDATE journal_entries SET best_friend_dog_id=pg_temp.f(4) WHERE id=eid;
 bad:=jsonb_build_object('module_code','journal','entity_type','journal_entries','entity_id',eid,'action','created','after_data',to_jsonb((SELECT e FROM journal_entries e WHERE id=eid)));
 PERFORM pg_temp.ok(dog_journal_audit_resolved_v2a(bad,pg_temp.f(4)),'legacy friend FK snapshot');
 bad:=jsonb_set(entry_a,'{after_data,entry,journalDayId}',to_jsonb(gen_random_uuid()));
 PERFORM pg_temp.ok(NOT dog_journal_audit_resolved_v2a(bad,pg_temp.f(9)),'wrong day fail closed');
 bad:=jsonb_set(entry_a,'{after_data,entry,id}',to_jsonb(gen_random_uuid()));
 PERFORM pg_temp.ok(NOT dog_journal_audit_resolved_v2a(bad,pg_temp.f(9)),'wrong entry fail closed');
 bad:=jsonb_set(entry_a,'{after_data,entry,dog,id}',to_jsonb(pg_temp.f(2)));
 PERFORM pg_temp.ok(NOT dog_journal_audit_resolved_v2a(bad,pg_temp.f(9)),'wrong dog fail closed');
 bad:=jsonb_set(entry_a,'{after_data,entry,unrelated}',jsonb_build_object('dogId',pg_temp.f(5)));
 PERFORM pg_temp.ok(NOT dog_journal_audit_resolved_v2a(bad,pg_temp.f(5)),'nested UUID does not prove identity');
 bad:=jsonb_set(entry_a,'{entity_id}',to_jsonb(gen_random_uuid()));
 PERFORM pg_temp.ok(NOT dog_journal_audit_resolved_v2a(bad,pg_temp.f(9)),'missing parent fail closed');
 bad:=jsonb_set(entry_a,'{after_data,entry}',jsonb_build_object('id',eid,'dog',jsonb_build_object('id',pg_temp.f(9))));
 PERFORM pg_temp.ok(NOT dog_journal_audit_resolved_v2a(bad,pg_temp.f(9)),'incomplete snapshot fail closed');
 bad:=jsonb_set(day_a,'{after_data,request,businessDate}',to_jsonb((d-1)::text));
 PERFORM pg_temp.ok(NOT dog_journal_audit_resolved_v2a(bad,pg_temp.f(9)),'wrong day request fail closed');
 SELECT version INTO v FROM journal_entries WHERE id=eid;
 PERFORM complete_journal_entry(eid,v,gen_random_uuid());
 p:=preview_dog_profile_removal(pg_temp.f(9));
 PERFORM pg_temp.ok(p->>'proposedMode'='profile_remove','completed journal allows removal '||p::text);
 SELECT to_jsonb(e) INTO before_entry FROM journal_entries e WHERE id=eid;
 SELECT jsonb_agg(to_jsonb(a) ORDER BY id) INTO before_audits FROM entity_audit_events a;
 PERFORM remove_dog_profile(pg_temp.f(9),(p->>'version')::bigint,p->>'graphFingerprint','profile_remove',gen_random_uuid(),'Synthetic journal preservation');
 PERFORM pg_temp.ok((SELECT to_jsonb(e)=before_entry FROM journal_entries e WHERE id=eid),'journal original row retained');
 PERFORM pg_temp.ok((SELECT jsonb_agg(to_jsonb(a) ORDER BY id)=before_audits FROM entity_audit_events a),'original audit retained');
 PERFORM pg_temp.ok(get_journal_entry(eid)::text LIKE '%Synthetic Dog 9%','removed profile name retained');
 PERFORM pg_temp.ok(get_historical_dog_identities(ARRAY[pg_temp.f(9)])->0->>'profileStatus'='removed','removed identity accessible');
 RAISE NOTICE 'JOURNAL_PROVENANCE_10_REQUIRED_SCENARIOS_PASS';
END $$;
ROLLBACK;
