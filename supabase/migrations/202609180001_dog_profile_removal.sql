-- V2-B local implementation. Apply only after an independently approved release gate.
BEGIN;
-- Required append-only V2-A provenance correction must precede this candidate.
DO $$ BEGIN
 IF to_regprocedure('public.dog_schedule_audit_resolved_v2a(jsonb,uuid)') IS NULL
 OR to_regprocedure('public.dog_journal_audit_resolved_v2a(jsonb,uuid)') IS NULL
 OR to_regprocedure('public.dog_remaining_trace_resolved_v2a(text,jsonb,uuid)') IS NULL THEN
  RAISE EXCEPTION 'MISSING_SCHEDULE_AUDIT_PROVENANCE_CORRECTION';
 END IF;
END $$;
ALTER TABLE public.dogs
 ADD COLUMN profile_status text NOT NULL DEFAULT 'active',
 ADD COLUMN version bigint NOT NULL DEFAULT 1,
 ADD COLUMN profile_status_changed_at timestamptz,
 ADD COLUMN profile_status_changed_by uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
 ADD COLUMN profile_status_reason text,
 ADD COLUMN merged_into_dog_id uuid REFERENCES public.dogs(id) ON DELETE RESTRICT,
 ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES public.profiles(id) ON DELETE RESTRICT;
DROP TRIGGER IF EXISTS protect_dog_active_status ON public.dogs;
DROP TRIGGER IF EXISTS dogs_master_metadata ON public.dogs;
DROP TRIGGER IF EXISTS dogs_master_audit ON public.dogs;
-- Active rows already have the correct default; initialize only inactive identities.
UPDATE public.dogs SET profile_status='inactive' WHERE is_active=false;
ALTER TABLE public.dogs
 ADD CONSTRAINT dogs_profile_status_v2b CHECK(profile_status IN ('active','inactive','removed','merged')),
 ADD CONSTRAINT dogs_active_compatibility_v2b CHECK(is_active IS NOT NULL AND is_active=(profile_status='active')),
 ADD CONSTRAINT dogs_merge_identity_v2b CHECK((profile_status='merged')=(merged_into_dog_id IS NOT NULL) AND merged_into_dog_id IS DISTINCT FROM id),
 ADD CONSTRAINT dogs_version_v2b CHECK(version>=1);
CREATE INDEX dogs_merged_into_v2b_idx ON public.dogs(merged_into_dog_id) WHERE merged_into_dog_id IS NOT NULL;

CREATE TABLE public.dog_profile_removal_receipts (
 request_id uuid PRIMARY KEY,
 actor_user_id uuid NOT NULL,
 dog_id uuid NOT NULL,
 normalized_input jsonb NOT NULL,
 requested_mode text NOT NULL CHECK(requested_mode IN ('hard_delete','profile_remove')),
 before_snapshot jsonb NOT NULL,
 after_snapshot jsonb,
 expected_version bigint NOT NULL,
 graph_fingerprint text NOT NULL,
 reason text,
 response jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.dog_profile_removal_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dog_profile_removal_receipts FROM PUBLIC,anon,authenticated,service_role;

-- Lifecycle columns are not client-writable. This trigger is deliberately INVOKER:
-- an authenticated direct UPDATE cannot gain the command owner's rights here.
CREATE FUNCTION public.stamp_dog_lifecycle_v2b() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='INSERT' THEN
   IF NEW.profile_status<>'active' OR NEW.is_active IS DISTINCT FROM true OR NEW.version<>1
     OR NEW.merged_into_dog_id IS NOT NULL OR NEW.profile_status_changed_at IS NOT NULL
     OR NEW.profile_status_changed_by IS NOT NULL OR NEW.profile_status_reason IS NOT NULL THEN
     RAISE EXCEPTION 'INVALID_PROFILE_STATE' USING ERRCODE='42501'; END IF;
 ELSE
   IF OLD.profile_status IN ('removed','merged') THEN
     RAISE EXCEPTION 'INVALID_PROFILE_STATE' USING ERRCODE='42501'; END IF;
   IF NEW.version IS DISTINCT FROM OLD.version THEN RAISE EXCEPTION 'STALE_VERSION' USING ERRCODE='42501'; END IF;
   IF (to_jsonb(NEW)-ARRAY['profile_status','is_active','profile_status_changed_at','profile_status_changed_by','profile_status_reason','updated_at','updated_by'])
      IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['profile_status','is_active','profile_status_changed_at','profile_status_changed_by','profile_status_reason','updated_at','updated_by'])
      AND NEW.profile_status IS DISTINCT FROM OLD.profile_status THEN
      RAISE EXCEPTION 'INVALID_PROFILE_STATE'; END IF;
   IF ROW(NEW.profile_status,NEW.is_active,NEW.profile_status_changed_at,NEW.profile_status_changed_by,NEW.profile_status_reason,NEW.merged_into_dog_id)
      IS DISTINCT FROM ROW(OLD.profile_status,OLD.is_active,OLD.profile_status_changed_at,OLD.profile_status_changed_by,OLD.profile_status_reason,OLD.merged_into_dog_id)
      AND (current_user IS DISTINCT FROM (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid='public.remove_dog_profile(uuid,bigint,text,text,uuid,text)'::regprocedure) OR NEW.profile_status<>'removed' OR NEW.is_active IS DISTINCT FROM false) THEN
      RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE='42501'; END IF;
   IF NEW.id IS DISTINCT FROM OLD.id OR (to_jsonb(NEW)->'created_at') IS DISTINCT FROM (to_jsonb(OLD)->'created_at') OR (to_jsonb(NEW)->'created_by') IS DISTINCT FROM (to_jsonb(OLD)->'created_by') THEN RAISE EXCEPTION 'INVALID_PROFILE_STATE'; END IF;
   NEW.version:=OLD.version+1;
 END IF;
 NEW.updated_by:=auth.uid();
 RETURN NEW;
END $$;
-- Replace the three drifted master triggers with a single target metadata guard.
-- Existing general edit auditing is retained; lifecycle proof belongs only to the receipt.
DROP TRIGGER IF EXISTS protect_dog_active_status ON public.dogs;
DROP TRIGGER IF EXISTS dogs_master_metadata ON public.dogs;
DROP TRIGGER IF EXISTS dogs_master_audit ON public.dogs;
CREATE TRIGGER dogs_lifecycle_metadata_v2b BEFORE INSERT OR UPDATE ON public.dogs
 FOR EACH ROW EXECUTE FUNCTION public.stamp_dog_lifecycle_v2b();

CREATE FUNCTION public.audit_dog_edit_v2b() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.profile_status=OLD.profile_status THEN
 INSERT INTO public.entity_audit_events(module_code,entity_type,entity_id,action,before_data,after_data,changed_by,change_reason)
 VALUES('shared_master','dog',NEW.id,'updated',to_jsonb(OLD),to_jsonb(NEW),auth.uid(),'Dog Master 정보 수정');
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER dogs_master_audit_v2b AFTER UPDATE ON public.dogs
 FOR EACH ROW EXECUTE FUNCTION public.audit_dog_edit_v2b();

REVOKE DELETE,UPDATE,INSERT ON public.dogs FROM PUBLIC,anon,authenticated;
-- Remove prior column grants as well: table REVOKE alone would not remove them.
DO $$ DECLARE cols text; BEGIN
 SELECT string_agg(quote_ident(attname),',') INTO cols FROM pg_attribute WHERE attrelid='public.dogs'::regclass AND attnum>0 AND NOT attisdropped;
 EXECUTE 'REVOKE UPDATE ('||cols||'), INSERT ('||cols||') ON public.dogs FROM PUBLIC, anon, authenticated';
END $$;
GRANT INSERT(customer_id,name,breed,sex,birth_date,weight,neutered,memo,photo_url,is_daycare_student,is_active) ON public.dogs TO authenticated;
GRANT UPDATE(customer_id,name,breed,sex,birth_date,weight,neutered,memo,photo_url,is_daycare_student) ON public.dogs TO authenticated;

CREATE OR REPLACE FUNCTION public.get_historical_dog_identities(p_dog_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE='42501';
  END IF;
  IF p_dog_ids IS NULL OR cardinality(p_dog_ids)>5000 THEN
    RAISE EXCEPTION 'INVALID_DOG_IDS' USING ERRCODE='22023';
  END IF;
  RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object(
    'recordDogId',d.id,'displayName',d.name,'nameSource','dog_master',
    'profileStatus',d.profile_status,
    'canonicalDogId',d.merged_into_dog_id,'profileReadable',true,
    'customerId',d.customer_id,'breed',d.breed,'sex',d.sex
  ) ORDER BY d.id),'[]'::jsonb) FROM public.dogs d WHERE d.id=ANY(p_dog_ids));
END $$;


CREATE OR REPLACE FUNCTION public.preview_dog_profile_removal(p_dog_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=public,pg_temp SET timezone='UTC' AS $$
DECLARE dog_json jsonb; result jsonb; fk_ok boolean;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
   RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE='42501'; END IF;
 SELECT to_jsonb(d) INTO dog_json FROM public.dogs d WHERE id=p_dog_id;
 IF dog_json IS NULL THEN RAISE EXCEPTION 'DOG_NOT_FOUND' USING ERRCODE='P0002'; END IF;
 -- Fail closed if the reference inventory changes; never silently omit a new FK.
 SELECT count(*)=10 AND bool_and(
   c.confdeltype IN ('a','r') AND cardinality(c.conkey)=1 AND
   (c.conrelid::regclass::text,a.attname) IN (
    ('dogs','merged_into_dog_id'),('sales','dog_id'),('operation_schedule_dogs','dog_id'),('hotel_stays','dog_id'),
    ('family_booking_members','dog_id'),('hotel_physical_occupancy_members','dog_id'),
    ('long_stay_contracts','dog_id'),('journal_entries','dog_id'),
    ('journal_entries','best_friend_dog_id'),('journal_entry_best_friend_targets','dog_id')))
 INTO fk_ok FROM pg_catalog.pg_constraint c
 JOIN pg_catalog.pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=c.conkey[1]
 WHERE c.contype='f' AND c.confrelid='public.dogs'::regclass;

 WITH
 stays AS MATERIALIZED (SELECT * FROM public.hotel_stays WHERE dog_id=p_dog_id),
 links AS MATERIALIZED (SELECT * FROM public.operation_schedule_dogs WHERE dog_id=p_dog_id),
 members AS MATERIALIZED (SELECT * FROM public.family_booking_members WHERE dog_id=p_dog_id),
 shared AS MATERIALIZED (SELECT * FROM public.hotel_physical_occupancy_members WHERE dog_id=p_dog_id),
 contracts AS MATERIALIZED (SELECT * FROM public.long_stay_contracts WHERE dog_id=p_dog_id),
 entries AS MATERIALIZED (
   SELECT e.* FROM public.journal_entries e WHERE e.dog_id=p_dog_id OR e.best_friend_dog_id=p_dog_id
     OR EXISTS(SELECT 1 FROM public.journal_entry_best_friend_targets t WHERE t.journal_entry_id=e.id AND t.dog_id=p_dog_id)
 ),
 -- One row per business unit; technical count is direct dog FK edges, not joined child rows.
 records(category,key,technical,classification,dates,evidence) AS (
 SELECT 'sales',s.id::text,1,
   CASE WHEN s.status NOT IN ('normal','partial_refund','full_refund','cancelled') THEN 'UNKNOWN'
        WHEN s.outstanding_amount>0 THEN 'WARN' ELSE 'ALLOW' END,
   jsonb_build_object('saleDate',s.sale_date),to_jsonb(s)
 FROM public.sales s WHERE s.dog_id=p_dog_id
 UNION ALL
 SELECT CASE WHEN dc.operation_schedule_id IS NULL THEN 'schedules' ELSE 'daycare' END,
   l.schedule_id::text,count(*)::integer,
   CASE WHEN bool_and(l.archived_at IS NOT NULL) THEN 'ALLOW'
     WHEN s.id IS NULL OR s.status NOT IN ('scheduled','completed','cancelled') THEN 'UNKNOWN'
     WHEN s.archived_at IS NOT NULL AND s.status='scheduled' THEN 'UNKNOWN'
     WHEN dc.operation_schedule_id IS NOT NULL AND (
       dc.lifecycle_status NOT IN ('scheduled','checked_in','completed','cancelled') OR
       (s.status IN ('completed','cancelled') AND dc.lifecycle_status IN ('scheduled','checked_in')) OR
       (s.status='scheduled' AND dc.lifecycle_status IN ('completed','cancelled'))) THEN 'UNKNOWN'
     WHEN s.status='scheduled' OR dc.lifecycle_status IN ('scheduled','checked_in') THEN 'BLOCK'
     ELSE 'ALLOW' END,
   jsonb_build_object('startsAt',s.starts_at,'endsAt',s.ends_at),
   jsonb_build_object('schedule',to_jsonb(s),'daycare',to_jsonb(dc),'links',jsonb_agg(to_jsonb(l) ORDER BY l.id))
 FROM links l LEFT JOIN public.operation_schedules s ON s.id=l.schedule_id
 LEFT JOIN public.daycare_operation_states dc ON dc.operation_schedule_id=s.id
 GROUP BY l.schedule_id,s.id,dc.operation_schedule_id
 UNION ALL
 SELECT 'hotel',s.id::text,1,
   CASE WHEN s.checked_out_at IS NOT NULL AND (s.checked_in_at IS NULL OR s.checked_out_at<s.checked_in_at) THEN 'UNKNOWN'
     WHEN s.archived_at IS NOT NULL AND s.checked_in_at IS NOT NULL AND s.checked_out_at IS NULL THEN 'UNKNOWN'
     WHEN s.archived_at IS NULL AND s.checked_out_at IS NULL THEN 'BLOCK'
     ELSE 'ALLOW' END,
   jsonb_build_object('checkedInAt',s.checked_in_at,'checkedOutAt',s.checked_out_at,
     'reservedIntervals',coalesce((SELECT jsonb_agg(jsonb_build_object('from',c.reserved_from,'until',c.reserved_until) ORDER BY c.id)
       FROM public.hotel_capacity_reservations c WHERE c.hotel_stay_id=s.id),'[]'::jsonb)),
   jsonb_build_object('stay',to_jsonb(s),
     'capacity',coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM public.hotel_capacity_reservations c WHERE c.hotel_stay_id=s.id),'[]'::jsonb),
     'allocations',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.hotel_room_allocations a
       JOIN public.hotel_capacity_reservations c ON c.id=a.capacity_reservation_id WHERE c.hotel_stay_id=s.id),'[]'::jsonb))
 FROM stays s
 UNION ALL
 SELECT 'shared',m.occupancy_id::text,count(*)::integer,
   CASE WHEN o.id IS NULL OR o.status NOT IN ('active','completed','released')
      OR bool_or(m.status NOT IN ('active','completed','left')) THEN 'UNKNOWN'
     WHEN bool_or(m.archived_at IS NULL AND m.status='active') THEN
       CASE WHEN o.status='active' AND o.archived_at IS NULL THEN 'BLOCK' ELSE 'UNKNOWN' END
     ELSE 'ALLOW' END,
   jsonb_build_object('from',o.occupied_from,'until',o.occupied_until),
   jsonb_build_object('occupancy',to_jsonb(o),'members',jsonb_agg(to_jsonb(m) ORDER BY m.id))
 FROM shared m LEFT JOIN public.hotel_physical_occupancies o ON o.id=m.occupancy_id GROUP BY m.occupancy_id,o.id
 UNION ALL
 SELECT 'shared','group:'||g.id::text,0,
   CASE WHEN g.status NOT IN ('requested','allocated','released','cancelled') THEN 'UNKNOWN'
     WHEN g.status IN ('requested','allocated') THEN CASE WHEN g.archived_at IS NULL THEN 'BLOCK' ELSE 'UNKNOWN' END
     ELSE 'ALLOW' END,
   jsonb_build_object('from',g.normalized_starts_at,'until',g.normalized_ends_at),to_jsonb(g)
 FROM public.family_shared_room_groups g WHERE g.id IN (SELECT shared_room_group_id FROM members)
   AND NOT EXISTS(SELECT 1 FROM shared m JOIN public.hotel_physical_occupancies o ON o.id=m.occupancy_id WHERE o.shared_room_group_id=g.id)
 UNION ALL
 SELECT 'long_stay',c.id::text,1,
   CASE WHEN c.status NOT IN ('pending','active','completed','cancelled') THEN 'UNKNOWN'
     WHEN c.status IN ('pending','active') THEN CASE WHEN c.archived_at IS NULL THEN 'BLOCK' ELSE 'UNKNOWN' END
     WHEN EXISTS(SELECT 1 FROM public.long_stay_absence_events a WHERE a.long_stay_contract_id=c.id AND a.is_open AND a.archived_at IS NULL) THEN 'UNKNOWN'
     ELSE 'ALLOW' END,
   jsonb_build_object('startedOn',c.started_on,'plannedCheckOutDate',c.planned_check_out_date),
   jsonb_build_object('contract',to_jsonb(c),
    'absence',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.long_stay_absence_events a WHERE a.long_stay_contract_id=c.id),'[]'::jsonb),
    'months',coalesce((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.id) FROM public.long_stay_monthly_occupancies m WHERE m.long_stay_contract_id=c.id),'[]'::jsonb))
 FROM contracts c
 UNION ALL
 SELECT 'journal',e.id::text,
   (CASE WHEN e.dog_id=p_dog_id THEN 1 ELSE 0 END)+(CASE WHEN e.best_friend_dog_id=p_dog_id THEN 1 ELSE 0 END)
    +(SELECT count(*)::integer FROM public.journal_entry_best_friend_targets t WHERE t.journal_entry_id=e.id AND t.dog_id=p_dog_id),
   CASE WHEN e.status='completed' THEN 'ALLOW' WHEN e.status IN ('not_started','in_progress') THEN 'BLOCK' ELSE 'UNKNOWN' END,
   jsonb_build_object('businessDate',d.business_date),jsonb_build_object('entry',to_jsonb(e),
     'targets',coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM public.journal_entry_best_friend_targets t WHERE t.journal_entry_id=e.id),'[]'::jsonb))
 FROM entries e LEFT JOIN public.journal_days d ON d.id=e.journal_day_id
 UNION ALL
 SELECT 'family_booking',m.family_booking_id::text,count(*)::integer,
   CASE WHEN f.id IS NULL OR f.status NOT IN ('draft','pending','active','partially_completed','completed','partially_cancelled','cancelled')
       OR bool_or(m.status NOT IN ('pending','confirmed','checked_in','completed','cancelled')) THEN 'UNKNOWN'
     WHEN bool_or(m.archived_at IS NULL AND m.status IN ('pending','confirmed','checked_in'))
       OR (f.archived_at IS NULL AND f.status IN ('draft','pending','active','partially_completed','partially_cancelled'))
       OR bool_or(g.archived_at IS NULL AND g.status IN ('requested','allocated')) THEN 'BLOCK'
     ELSE 'ALLOW' END,
   jsonb_build_object('serviceIntervals',jsonb_agg(jsonb_build_object('from',coalesce(g.normalized_starts_at,os.starts_at),'until',coalesce(g.normalized_ends_at,os.ends_at),'hotelStayId',to_jsonb(m)->>'hotel_stay_id',
     'reservedIntervals',coalesce((SELECT jsonb_agg(jsonb_build_object('from',hc.reserved_from,'until',hc.reserved_until) ORDER BY hc.id)
       FROM public.hotel_capacity_reservations hc WHERE hc.hotel_stay_id=(to_jsonb(m)->>'hotel_stay_id')::uuid),'[]'::jsonb)) ORDER BY m.id)),
   jsonb_build_object('booking',to_jsonb(f),'members',jsonb_agg(to_jsonb(m) ORDER BY m.id),'groups',jsonb_agg(to_jsonb(g) ORDER BY m.id))
 FROM members m LEFT JOIN public.family_bookings f ON f.id=m.family_booking_id
 LEFT JOIN public.family_shared_room_groups g ON g.id=m.shared_room_group_id
 LEFT JOIN public.operation_schedules os ON os.id::text=to_jsonb(m)->>'operation_schedule_id' GROUP BY m.family_booking_id,f.id
 ),
 -- Known non-FK structured sources. Master create/edit audits do not block unused deletion.
 known_traces(source,key,body) AS (
 SELECT 'entity_audit_events',a.id::text,to_jsonb(a) FROM public.entity_audit_events a
 WHERE a.entity_type NOT IN ('dogs','dog') AND
   (public.dog_identity_in_payload_v2a(a.before_data,p_dog_id) OR public.dog_identity_in_payload_v2a(a.after_data,p_dog_id)
    OR a.entity_id IN (SELECT id FROM stays UNION SELECT schedule_id FROM links))
 UNION ALL
 SELECT 'family_bookings',f.id::text,to_jsonb(f) FROM public.family_bookings f WHERE public.dog_identity_in_payload_v2a(f.canonical_payload,p_dog_id)
 UNION ALL
 SELECT 'hotel_physical_occupancy_requests',r.request_id::text,to_jsonb(r) FROM public.hotel_physical_occupancy_requests r
 WHERE public.dog_identity_in_payload_v2a(r.response,p_dog_id) OR r.occupancy_id IN (SELECT occupancy_id FROM shared)
 UNION ALL
 SELECT 'long_stay_operation_audit_events',a.id::text,to_jsonb(a) FROM public.long_stay_operation_audit_events a
 WHERE a.long_stay_contract_id IN (SELECT id FROM contracts) OR public.dog_identity_in_payload_v2a(a.canonical_payload,p_dog_id)
 UNION ALL
 SELECT 'hotel_single_check_in_receipts',r.request_id::text,to_jsonb(r) FROM public.hotel_single_check_in_receipts r
 WHERE r.hotel_stay_id IN (SELECT id FROM stays) OR public.dog_identity_in_payload_v2a(r.response,p_dog_id)
 UNION ALL
 SELECT 'hotel_missed_check_in_receipts',r.request_id::text,to_jsonb(r) FROM public.hotel_missed_check_in_receipts r
 WHERE r.hotel_stay_id IN (SELECT id FROM stays) OR public.dog_identity_in_payload_v2a(r.response,p_dog_id)
 UNION ALL
 SELECT 'daycare_operation_states',d.operation_schedule_id::text,to_jsonb(d) FROM public.daycare_operation_states d
 WHERE public.dog_identity_in_payload_v2a(d.canonical_payload,p_dog_id)
 ),
 traces AS (
 SELECT * FROM known_traces UNION SELECT * FROM public.dog_structured_traces_v2a(p_dog_id)
 ),
 -- Exact sale snapshots only. Nested unrelated identities and missing parents stay unresolved.
 -- One-hop reassignment proof is deliberately bounded: changed_data must equal the
 -- complete retained sale. No timestamps, names, or partial payloads prove continuity.
 resolved_sales_history AS MATERIALIZED (
 SELECT t.source,t.key FROM traces t
 JOIN public.sales s ON s.id::text=t.body->>'sale_id'
 WHERE t.source='sale_history'
   AND t.body->>'action' IN ('created','updated','partial_refund','full_refund','cancelled','reopened')
   AND (
     (s.dog_id=p_dog_id AND EXISTS (
       SELECT 1 FROM (VALUES(t.body->'previous_data'),(t.body->'changed_data')) snapshot(value)
       WHERE value->>'id'=s.id::text AND value->>'dog_id'=p_dog_id::text
     )) OR (
       t.body->>'action'='updated'
       AND t.body->'previous_data'->>'id'=s.id::text
       AND t.body->'previous_data'->>'dog_id'=p_dog_id::text
       AND t.body->'changed_data'=to_jsonb(s)
     ) OR (
       t.body->>'action'='created'
       AND t.body->'changed_data'->>'id'=s.id::text
       AND t.body->'changed_data'->>'dog_id'=p_dog_id::text
       AND EXISTS(SELECT 1 FROM public.sale_history next_history
         WHERE next_history.sale_id::text=s.id::text AND next_history.action='updated'
           AND next_history.previous_data=t.body->'changed_data'
           AND next_history.changed_data=to_jsonb(s))
     )
   )
 ),
 unresolved_traces AS (
 SELECT t.* FROM traces t WHERE NOT (
   EXISTS(SELECT 1 FROM resolved_sales_history r WHERE r.source=t.source AND r.key=t.key) OR
   (t.source='entity_audit_events' AND (
     (t.body->>'entity_type'='operation_schedule_dogs' AND public.dog_schedule_audit_resolved_v2a(t.body,p_dog_id)) OR
     (t.body->>'entity_type' IN ('journal_days','journal_entries') AND public.dog_journal_audit_resolved_v2a(t.body,p_dog_id)) OR
     public.dog_remaining_trace_resolved_v2a(t.source,t.body,p_dog_id) OR
     (t.body->>'entity_type' IN ('hotel_stays','operation_schedules','daycare_operation_states','family_bookings','hotel_physical_occupancies','long_stay_contracts','family_shared_room_groups') AND t.body->>'entity_id' IN (SELECT key FROM records))
   )) OR
   (t.source IN ('hotel_atomic_reverse_unassign_requests','sale_initial_payment_edit_requests') AND public.dog_remaining_trace_resolved_v2a(t.source,t.body,p_dog_id)) OR
   (t.source='family_bookings' AND t.key IN (SELECT family_booking_id::text FROM members)) OR
   (t.source='daycare_operation_states' AND t.key IN (SELECT schedule_id::text FROM links)) OR
   t.body->>'hotel_stay_id' IN (SELECT id::text FROM stays) OR
   t.body->>'occupancy_id' IN (SELECT occupancy_id::text FROM shared) OR
   t.body->>'long_stay_contract_id' IN (SELECT id::text FROM contracts)
 ) IS TRUE
 ),
 categories AS (
 SELECT kind AS category, count(r.key)::integer AS user_count,coalesce(sum(r.technical),0)::integer AS technical_count,
   coalesce(jsonb_agg(jsonb_build_object('recordId',r.key,'dates',r.dates,'classification',r.classification) ORDER BY r.key) FILTER (WHERE r.key IS NOT NULL),'[]'::jsonb) AS items
 FROM unnest(ARRAY['sales','schedules','hotel','shared','long_stay','daycare','journal','family_booking']) kind
 LEFT JOIN records r ON r.category=kind GROUP BY kind
 ), summary AS (
 SELECT count(*) FILTER(WHERE classification IN ('BLOCK','UNKNOWN'))::integer AS blockers,
   count(*)::integer AS business_count,coalesce(sum(technical),0)::integer AS fk_count,
   coalesce(jsonb_agg(DISTINCT category||CASE WHEN classification='UNKNOWN' THEN '_UNKNOWN_LIFECYCLE' ELSE '_ACTIVE_OPERATION' END ORDER BY category||CASE WHEN classification='UNKNOWN' THEN '_UNKNOWN_LIFECYCLE' ELSE '_ACTIVE_OPERATION' END)
     FILTER(WHERE classification IN ('BLOCK','UNKNOWN')),'[]'::jsonb) AS reasons,
   coalesce(jsonb_agg(DISTINCT 'OUTSTANDING_SALES'::text) FILTER(WHERE classification='WARN'),'[]'::jsonb) AS warnings
 FROM records
 )
 SELECT jsonb_build_object(
   'dog',jsonb_build_object('recordDogId',p_dog_id,'displayName',dog_json->>'name','customerId',dog_json->'customer_id',
      'profileStatus',dog_json->>'profile_status'),
   'version',(dog_json->>'version')::bigint,'commandAvailable',false,'contractVersion','dog-profile-preview-v2b-1',
   'categories',(SELECT jsonb_agg(jsonb_build_object('category',category,'userVisibleCount',user_count,
       'technicalReferenceCount',technical_count,'records',items) ORDER BY category) FROM categories)||jsonb_build_array(jsonb_build_object(
     'category','structured_identity','userVisibleCount',0,'technicalReferenceCount',0,
     'traceCount',(SELECT count(*) FROM traces),
     'records',coalesce((SELECT jsonb_agg(jsonb_build_object('recordId',t.source||':'||t.key,
       'dates','{}'::jsonb,'classification',CASE WHEN EXISTS(SELECT 1 FROM unresolved_traces u WHERE u.source=t.source AND u.key IS NOT DISTINCT FROM t.key) THEN 'UNKNOWN' ELSE 'ALLOW' END)
       ORDER BY t.source,t.key,t.body::text) FROM traces t),'[]'::jsonb))),
   'structuredIdentityTraceCount',(SELECT count(*) FROM traces),
   'technicalReferenceCount',s.fk_count,'activeBlockerCount',s.blockers+(SELECT count(*) FROM unresolved_traces)+CASE WHEN fk_ok THEN 0 ELSE 1 END,
   'blockingReasonCodes',s.reasons||CASE WHEN EXISTS(SELECT 1 FROM unresolved_traces) THEN '["UNRESOLVED_STRUCTURED_IDENTITY"]'::jsonb ELSE '[]'::jsonb END||CASE WHEN fk_ok THEN '[]'::jsonb ELSE '["REFERENCE_INVENTORY_MISMATCH"]'::jsonb END,
   'warnings',s.warnings,'hardDeleteEligible',fk_ok AND s.fk_count=0 AND NOT EXISTS(SELECT 1 FROM traces),
   'profileRemovalEligible',fk_ok AND s.blockers=0 AND NOT EXISTS(SELECT 1 FROM unresolved_traces),
   'proposedMode',CASE WHEN NOT fk_ok OR s.blockers>0 OR EXISTS(SELECT 1 FROM unresolved_traces) THEN NULL WHEN s.fk_count=0 AND NOT EXISTS(SELECT 1 FROM traces)
      THEN 'hard_delete' ELSE 'profile_remove' END,
   'graphFingerprint',md5(jsonb_build_object('contract','dog-profile-preview-v2b-1','dog',dog_json,'inventoryValid',fk_ok,
     'records',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY category,key) FROM records r),'[]'::jsonb),
     'traces',coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY source,key,body::text) FROM traces t),'[]'::jsonb))::text),
   'evaluatedAt',statement_timestamp(),'fingerprintUsage','READ_ONLY_NOT_A_WRITE_TOKEN'
 ) INTO result FROM summary s;
 IF dog_json->>'profile_status' NOT IN ('active','inactive') OR
   EXISTS(SELECT 1 FROM public.dogs WHERE merged_into_dog_id=p_dog_id) THEN
   result := result || jsonb_build_object('hardDeleteEligible',false,'profileRemovalEligible',false,
     'proposedMode',NULL,'activeBlockerCount',(result->>'activeBlockerCount')::integer+1,
     'blockingReasonCodes',(result->'blockingReasonCodes')||'["INVALID_PROFILE_STATE"]'::jsonb);
 END IF;
 -- A read preview is not a reservation. The command repeats this under the write barrier.
 result := result || jsonb_build_object('commandAvailable',
   result->>'proposedMode' IS NOT NULL AND (result->>'activeBlockerCount')::integer=0,
   'fingerprintUsage','REVALIDATE_UNDER_LOCK');
 RETURN result;
END $$;


-- Dog UUIDs, never a global graph key. Try-locks avoid waiting behind domain locks.
CREATE FUNCTION public.dog_payload_ids_v2b(p_value jsonb) RETURNS uuid[]
LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $$
WITH RECURSIVE nodes(value,identity_context) AS (
 SELECT p_value,false
 UNION ALL
 SELECT child.value, CASE WHEN jsonb_typeof(n.value)='array' THEN n.identity_context
 ELSE lower(replace(child.key,'_','')) IN ('dogid','dogids','bestfrienddogid','recorddogid','sourcedogid','targetdogid')
 OR (n.identity_context AND child.key='id') OR lower(child.key) IN ('dog','dogs') END
 FROM nodes n CROSS JOIN LATERAL (
 SELECT e.key,e.value FROM jsonb_each(CASE WHEN jsonb_typeof(n.value)='object' THEN n.value ELSE '{}'::jsonb END) e
 UNION ALL SELECT NULL,a.value FROM jsonb_array_elements(CASE WHEN jsonb_typeof(n.value)='array' THEN n.value ELSE '[]'::jsonb END) a
 ) child
)
SELECT coalesce(array_agg(DISTINCT (value#>>'{}')::uuid ORDER BY (value#>>'{}')::uuid),'{}'::uuid[])
 FROM nodes WHERE identity_context AND jsonb_typeof(value)='string'
 AND value#>>'{}' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
$$;

-- Resolve direct and parent lifecycle identities from retained FK relationships.
-- Only approved reverse edges (aggregate -> dog children) are traversed.
CREATE FUNCTION public.dog_relation_identities_v2b(p_table regclass,p_row jsonb,p_seen oid[] DEFAULT '{}')
RETURNS uuid[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE ids uuid[]:='{}'; edge record; parent jsonb; child jsonb; value text;
BEGIN
 IF p_row IS NULL OR p_table::oid=ANY(p_seen) THEN RETURN ids; END IF;
 IF p_table='public.dogs'::regclass THEN RETURN ARRAY[(p_row->>'id')::uuid]; END IF;
 p_seen:=p_seen||p_table::oid;
 FOR edge IN SELECT c.confrelid,a.attname AS source_col,b.attname AS target_col
   FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=c.conkey[1]
   JOIN pg_attribute b ON b.attrelid=c.confrelid AND b.attnum=c.confkey[1]
   WHERE c.contype='f' AND c.conrelid=p_table AND cardinality(c.conkey)=1
     AND c.confrelid IN (SELECT * FROM public.dog_graph_tables_v2b())
     AND b.atttypid='uuid'::regtype
 LOOP
   value:=p_row->>edge.source_col;
   IF value IS NULL THEN CONTINUE; END IF;
   EXECUTE format('SELECT to_jsonb(t) FROM %s t WHERE %I=$1::uuid',edge.confrelid::regclass,edge.target_col) INTO parent USING value;
   ids:=ids||public.dog_relation_identities_v2b(edge.confrelid::regclass,parent,p_seen);
 END LOOP;
 FOR edge IN SELECT c.conrelid,a.attname AS source_col,b.attname AS target_col
   FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=c.conkey[1]
   JOIN pg_attribute b ON b.attrelid=c.confrelid AND b.attnum=c.confkey[1]
   WHERE (cardinality(p_seen)=1 OR EXISTS(SELECT 1 FROM pg_class WHERE oid=p_seen[1] AND relname~'(audit|request|receipt|history)')) AND c.contype='f' AND c.confrelid=p_table AND cardinality(c.conkey)=1 AND
     (p_table::text,c.conrelid::regclass::text) IN (
       ('operation_schedules','operation_schedule_dogs'),('family_bookings','family_booking_members'),
       ('family_shared_room_groups','family_booking_members'),('hotel_physical_occupancies','hotel_physical_occupancy_members'),
       ('journal_days','journal_entries'),('journal_entries','journal_entry_best_friend_targets'))
 LOOP
   FOR child IN EXECUTE format('SELECT to_jsonb(t) FROM %s t WHERE %I=$1::uuid',edge.conrelid::regclass,edge.source_col) USING p_row->>edge.target_col
   LOOP ids:=ids||public.dog_relation_identities_v2b(edge.conrelid::regclass,child,p_seen); END LOOP;
 END LOOP;
 -- Known preview evidence joins that may have no FK (legacy receipts/audits).
 FOR edge IN SELECT * FROM (VALUES
   ('hotel_physical_occupancy_requests','occupancy_id','hotel_physical_occupancies'),
   ('long_stay_operation_audit_events','long_stay_contract_id','long_stay_contracts'),
   ('hotel_single_check_in_receipts','hotel_stay_id','hotel_stays'),
   ('hotel_missed_check_in_receipts','hotel_stay_id','hotel_stays'),
   ('sale_history','sale_id','sales'),
   ('daycare_operation_states','operation_schedule_id','operation_schedules'),
   ('entity_audit_events','entity_id','hotel_stays'),
   ('entity_audit_events','entity_id','operation_schedules')
 ) edges(source_table,source_col,target_table) WHERE source_table=p_table::text LOOP
   value:=p_row->>edge.source_col;
   IF value IS NULL OR value !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN CONTINUE; END IF;
   EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE id=$1::uuid',edge.target_table) INTO parent USING value;
   ids:=ids||public.dog_relation_identities_v2b(to_regclass('public.'||edge.target_table),parent,p_seen);
 END LOOP;
 -- Structured identity keys, never free-text names. Covers legacy requests without FK.
 ids:=ids||public.dog_payload_ids_v2b(p_row);
 IF p_table='public.entity_audit_events'::regclass AND p_row->>'entity_type'='dog'
    AND p_row->>'entity_id' IS NOT NULL THEN ids:=ids||ARRAY[(p_row->>'entity_id')::uuid]; END IF;
 RETURN ARRAY(SELECT DISTINCT x FROM unnest(ids) x WHERE x IS NOT NULL ORDER BY x);
END $$;

CREATE FUNCTION public.guard_dog_relation_v2b() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE ids uuid[]; old_ids uuid[]; dog_id uuid; state text; n jsonb; o jsonb; require_active boolean;
BEGIN
 n:=CASE WHEN TG_OP<>'DELETE' THEN to_jsonb(NEW) END; o:=CASE WHEN TG_OP<>'INSERT' THEN to_jsonb(OLD) END;
 ids:=public.dog_relation_identities_v2b(TG_RELID,n);
 old_ids:=public.dog_relation_identities_v2b(TG_RELID,o);
 require_active:=TG_TABLE_NAME IN ('sales','operation_schedules','operation_schedule_dogs','hotel_stays',
 'hotel_capacity_reservations','hotel_room_allocations','family_bookings','family_booking_members',
 'family_shared_room_groups','hotel_physical_occupancies','hotel_physical_occupancy_members',
 'long_stay_contracts','long_stay_absence_events','long_stay_monthly_occupancies','journal_entries',
 'journal_days','journal_entry_best_friend_targets','daycare_operation_states') AND TG_OP<>'DELETE' AND (TG_OP='INSERT' OR ids IS DISTINCT FROM old_ids
   OR (o->>'archived_at' IS NOT NULL AND n->>'archived_at' IS NULL)
   OR (o->>'checked_out_at' IS NOT NULL AND n->>'checked_out_at' IS NULL)
   OR (TG_TABLE_NAME<>'sales' AND o->>'status' IN ('completed','cancelled','released','left') AND coalesce(n->>'status','') NOT IN ('completed','cancelled','released','left'))
   OR (o->>'lifecycle_status' IN ('completed','cancelled') AND coalesce(n->>'lifecycle_status','') NOT IN ('completed','cancelled'))
   OR (o->>'is_open'='false' AND n->>'is_open'='true'));
 FOR dog_id IN SELECT DISTINCT x FROM unnest(ids||old_ids) x ORDER BY x LOOP
   IF NOT pg_try_advisory_xact_lock_shared(hashtextextended('dog-profile-v2b:'||dog_id::text,0)) THEN
     RAISE EXCEPTION 'DOG_BUSY' USING ERRCODE='55P03'; END IF;
   BEGIN
     SELECT profile_status INTO state FROM public.dogs WHERE id=dog_id FOR KEY SHARE NOWAIT;
   EXCEPTION WHEN lock_not_available THEN RAISE EXCEPTION 'DOG_BUSY' USING ERRCODE='55P03'; END;
   IF require_active AND dog_id=ANY(ids) AND state IS DISTINCT FROM 'active' THEN
     RAISE EXCEPTION 'INVALID_PROFILE_STATE' USING ERRCODE='23514'; END IF;
 END LOOP;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;

-- Explicit graph inventory plus catalog-discovered structured traces. No business row rewrite.
CREATE FUNCTION public.dog_graph_tables_v2b() RETURNS SETOF regclass
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT c.oid::regclass FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relname<>'dog_profile_removal_receipts' AND (
 c.relname IN ('dogs','sales','operation_schedules','operation_schedule_dogs','hotel_stays',
 'hotel_capacity_reservations','hotel_room_allocations','family_bookings','family_booking_members',
 'family_shared_room_groups','hotel_physical_occupancies','hotel_physical_occupancy_members',
 'long_stay_contracts','long_stay_absence_events','long_stay_monthly_occupancies','journal_entries',
 'journal_days','journal_entry_best_friend_targets','daycare_operation_states')
 OR (c.relname~'(audit|request|receipt|history)' AND EXISTS(SELECT 1 FROM pg_attribute a
 WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped AND a.atttypid IN ('json'::regtype,'jsonb'::regtype))))
 ORDER BY c.oid
$$;
DO $$ DECLARE t regclass; BEGIN
 FOR t IN SELECT * FROM public.dog_graph_tables_v2b() LOOP
   EXECUTE format('CREATE TRIGGER a_dog_relation_guard_v2b BEFORE INSERT OR UPDATE OR DELETE ON %s FOR EACH ROW EXECUTE FUNCTION public.guard_dog_relation_v2b()',t);
 END LOOP;
END $$;

CREATE FUNCTION public.remove_dog_profile(p_dog_id uuid,p_expected_version bigint,
 p_expected_graph_fingerprint text,p_requested_mode text,p_request_id uuid,p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET timezone='UTC' AS $$
DECLARE actor uuid:=auth.uid(); input jsonb; receipt public.dog_profile_removal_receipts%ROWTYPE;
 d public.dogs%ROWTYPE; before_row jsonb; after_row jsonb; preview jsonb; response jsonb; affected integer;
BEGIN
 IF actor IS NULL OR NOT public.is_active_user() THEN RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE='42501'; END IF;
 IF p_request_id IS NULL OR p_dog_id IS NULL OR p_expected_version IS NULL OR p_expected_version<1
   OR nullif(p_expected_graph_fingerprint,'') IS NULL OR p_requested_mode IS NULL
   OR p_requested_mode NOT IN ('hard_delete','profile_remove') THEN RAISE EXCEPTION 'INVALID_PROFILE_STATE'; END IF;
 input:=jsonb_build_object('dogId',p_dog_id,'expectedVersion',p_expected_version,'fingerprint',p_expected_graph_fingerprint,
   'mode',p_requested_mode,'reason',nullif(btrim(p_reason),''));
 PERFORM pg_advisory_xact_lock(hashtextextended('dog-removal-request:'||p_request_id::text,0));
 SELECT * INTO receipt FROM public.dog_profile_removal_receipts WHERE request_id=p_request_id;
 IF FOUND THEN
   IF receipt.actor_user_id<>actor OR receipt.normalized_input<>input THEN RAISE EXCEPTION 'REQUEST_ID_CONFLICT'; END IF;
   RETURN receipt.response;
 END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('dog-profile-v2b:'||p_dog_id::text,0)) THEN RAISE EXCEPTION 'DOG_BUSY' USING ERRCODE='55P03'; END IF;
 BEGIN SELECT * INTO d FROM public.dogs WHERE id=p_dog_id FOR UPDATE NOWAIT;
 EXCEPTION WHEN lock_not_available THEN RAISE EXCEPTION 'DOG_BUSY' USING ERRCODE='55P03'; END;
 IF NOT FOUND THEN RAISE EXCEPTION 'DOG_NOT_FOUND' USING ERRCODE='P0002'; END IF;
 IF d.version<>p_expected_version THEN RAISE EXCEPTION 'STALE_VERSION'; END IF;
 IF d.profile_status NOT IN ('active','inactive') THEN RAISE EXCEPTION 'INVALID_PROFILE_STATE'; END IF;
 IF EXISTS(SELECT 1 FROM public.dog_graph_tables_v2b() t WHERE NOT EXISTS(
   SELECT 1 FROM pg_trigger WHERE tgrelid=t AND tgname='a_dog_relation_guard_v2b' AND tgenabled='O')) THEN
   RAISE EXCEPTION 'REFERENCE_CHECK_UNAVAILABLE'; END IF;
 preview:=public.preview_dog_profile_removal(p_dog_id);
 IF preview->>'graphFingerprint' IS DISTINCT FROM p_expected_graph_fingerprint THEN RAISE EXCEPTION 'STALE_PREVIEW'; END IF;
 IF (preview->>'activeBlockerCount')::integer>0 THEN RAISE EXCEPTION 'ACTIVE_OPERATION_EXISTS'; END IF;
 before_row:=to_jsonb(d);
 IF p_requested_mode='hard_delete' THEN
   IF NOT (preview->>'hardDeleteEligible')::boolean THEN RAISE EXCEPTION 'HARD_DELETE_NOT_ELIGIBLE'; END IF;
   DELETE FROM public.dogs WHERE id=p_dog_id;
 ELSE
   IF NOT (preview->>'profileRemovalEligible')::boolean OR preview->>'proposedMode'<>'profile_remove' THEN
     RAISE EXCEPTION 'PROFILE_REMOVAL_NOT_ELIGIBLE'; END IF;
   UPDATE public.dogs SET profile_status='removed',is_active=false,profile_status_changed_at=clock_timestamp(),
     profile_status_changed_by=actor,profile_status_reason=nullif(btrim(p_reason),'') WHERE id=p_dog_id RETURNING to_jsonb(dogs) INTO after_row;
 END IF;
 GET DIAGNOSTICS affected=ROW_COUNT;
 IF affected<>1 THEN RAISE EXCEPTION 'DOG_NOT_FOUND'; END IF;
 response:=jsonb_build_object('dogId',p_dog_id,'mode',p_requested_mode,'profileStatus',CASE WHEN p_requested_mode='profile_remove' THEN 'removed' ELSE NULL END,
   'resultingVersion',after_row->'version','requestId',p_request_id);
 INSERT INTO public.dog_profile_removal_receipts(request_id,actor_user_id,dog_id,normalized_input,requested_mode,before_snapshot,after_snapshot,expected_version,graph_fingerprint,reason,response)
 VALUES(p_request_id,actor,p_dog_id,input,p_requested_mode,before_row,after_row,p_expected_version,p_expected_graph_fingerprint,nullif(btrim(p_reason),''),response);
 RETURN response;
END $$;

REVOKE ALL ON FUNCTION public.stamp_dog_lifecycle_v2b(),public.audit_dog_edit_v2b(),public.dog_payload_ids_v2b(jsonb),
 public.dog_relation_identities_v2b(regclass,jsonb,oid[]),public.guard_dog_relation_v2b(),public.dog_graph_tables_v2b()
 FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.remove_dog_profile(uuid,bigint,text,text,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.remove_dog_profile(uuid,bigint,text,text,uuid,text) TO authenticated;
COMMIT;
