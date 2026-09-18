-- Append-only V2-A READ correction. Order: 170001 -> 170002 -> 170003 -> unshipped V2-B.
BEGIN;
-- Fail before any DDL: the preview below calls the private 170002 resolver.
DO $$ BEGIN
 IF NOT EXISTS (
   SELECT 1 FROM pg_catalog.pg_proc p
   WHERE p.oid=pg_catalog.to_regprocedure('public.dog_schedule_audit_resolved_v2a(jsonb,uuid)')
     AND p.prokind='f' AND p.prorettype='pg_catalog.bool'::regtype
     AND NOT p.proretset AND p.prosecdef AND p.provolatile='s'
     AND p.proconfig=ARRAY['search_path=public, pg_temp']::text[]
 ) THEN
   RAISE EXCEPTION 'STOP_DOG_STRUCTURED_TRACE_PROVENANCE_CLOSURE_MISSING_170002_DEPENDENCY'
     USING ERRCODE='P0001',
       DETAIL='Requires public.dog_schedule_audit_resolved_v2a(jsonb,uuid) RETURNS boolean, STABLE SECURITY DEFINER, search_path=public, pg_temp.';
 END IF;
END $$;
-- Journal provenance is independent of draft/completed lifecycle blocking.
CREATE FUNCTION public.dog_journal_audit_resolved_v2a(p_body jsonb,p_dog_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
WITH snapshots(v) AS (
 SELECT v FROM (VALUES(p_body->'before_data'),(coalesce(p_body->'after_data'->'entry',p_body->'after_data'))) x(v)
 WHERE v IS NOT NULL AND v<>'null'::jsonb
), entry AS (
 SELECT e.*,d.business_date FROM public.journal_entries e JOIN public.journal_days d ON d.id=e.journal_day_id
 WHERE e.id=CASE WHEN p_body->>'entity_id' ~ '^[0-9a-f-]{36}$' AND p_body->>'entity_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN (p_body->>'entity_id')::uuid END
), target_snapshots AS (
 SELECT v FROM snapshots WHERE coalesce(v->'dog'->>'id',v->>'dog_id')=p_dog_id::text
 OR coalesce(v->>'bestFriendDogId',v->>'best_friend_dog_id')=p_dog_id::text
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v->'bestFriendTargets')='array' THEN v->'bestFriendTargets' ELSE '[]'::jsonb END) t
   WHERE t->>'type'='DOG' AND t->>'dogId'=p_dog_id::text)
)
SELECT coalesce(p_body->>'module_code'='journal' AND p_body->>'action' IN ('created','updated') AND
 CASE p_body->>'entity_type'
 WHEN 'journal_days' THEN EXISTS(
   SELECT 1 FROM public.journal_days d JOIN public.journal_entries e ON e.journal_day_id=d.id AND e.dog_id=p_dog_id
   WHERE d.id::text=p_body->>'entity_id' AND d.journal_type='daycare_daily'
     AND p_body->>'change_reason'='journal_day_default_activities_register'
     AND p_body->'after_data'->'request'->>'businessDate'=d.business_date::text
     AND jsonb_typeof(p_body->'after_data'->'request'->'dogIds')='array'
     AND (p_body->'after_data'->'request'->'dogIds') @> jsonb_build_array(p_dog_id::text)
     AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_body->'after_data'->'request'->'dogIds')='array' THEN p_body->'after_data'->'request'->'dogIds' ELSE '[]'::jsonb END) dog(value)
       WHERE jsonb_typeof(dog.value)<>'string' OR (dog.value #>> '{}') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
     AND (NOT (p_body->'after_data'->'request' ? 'journalDayId') OR p_body->'after_data'->'request'->>'journalDayId'=d.id::text)
 )
 WHEN 'journal_entries' THEN EXISTS(
   SELECT 1 FROM entry e WHERE EXISTS(SELECT 1 FROM target_snapshots)
     AND jsonb_typeof(coalesce(p_body->'after_data'->'entry',p_body->'after_data'))='object'
     AND (p_body->>'action'='created' OR jsonb_typeof(p_body->'before_data')='object')
     AND NOT EXISTS(SELECT 1 FROM snapshots s WHERE NOT coalesce(
       jsonb_typeof(v)='object' AND v->>'id'=e.id::text
       AND coalesce(v->>'journalDayId',v->>'journal_day_id')=e.journal_day_id::text
       AND coalesce(v->'dog'->>'id',v->>'dog_id')=e.dog_id::text
       AND (NOT (v ? 'journalDayId' AND v ? 'journal_day_id') OR v->>'journalDayId'=v->>'journal_day_id')
       AND (NOT (v ? 'dog' AND v ? 'dog_id') OR v->'dog'->>'id'=v->>'dog_id')
       AND (NOT (v ? 'businessDate') OR v->>'businessDate'=e.business_date::text)
       AND (coalesce(v->>'bestFriendDogId',v->>'best_friend_dog_id') IS NULL OR EXISTS(SELECT 1 FROM public.dogs friend WHERE friend.id::text=coalesce(v->>'bestFriendDogId',v->>'best_friend_dog_id')))
       AND (NOT (v ? 'bestFriendTargets') OR (jsonb_typeof(v->'bestFriendTargets')='array' AND NOT EXISTS(
         SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v->'bestFriendTargets')='array' THEN v->'bestFriendTargets' ELSE '[]'::jsonb END) t
         WHERE NOT coalesce((t->>'type'='TEACHER' AND t->'dogId'='null'::jsonb) OR
           (t->>'type'='DOG' AND EXISTS(SELECT 1 FROM public.dogs friend WHERE friend.id::text=t->>'dogId')),false)
       ))),false))
     AND (NOT coalesce(p_body->'after_data'->'request' ? 'entryId',false) OR p_body->'after_data'->'request'->>'entryId'=e.id::text)
     AND (NOT coalesce(p_body->'after_data'->'request' ? 'bestFriendTargets',false) OR p_body->'after_data'->'request'->'bestFriendTargets'=p_body->'after_data'->'entry'->'bestFriendTargets')
 )
 ELSE false END,false)
$$;
REVOKE ALL ON FUNCTION public.dog_journal_audit_resolved_v2a(jsonb,uuid) FROM PUBLIC,anon,authenticated,service_role;

-- Additional typed child provenance. Unknown source/entity types are not accepted.
CREATE FUNCTION public.dog_remaining_trace_resolved_v2a(p_source text,p_body jsonb,p_dog_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
WITH member AS (
 SELECT to_jsonb(m) row_value,'family_booking_members' kind FROM public.family_booking_members m
 JOIN public.family_bookings f ON f.id=m.family_booking_id
 WHERE m.id::text=p_body->>'entity_id' AND m.dog_id=p_dog_id
 UNION ALL
 SELECT to_jsonb(m),'hotel_physical_occupancy_members' FROM public.hotel_physical_occupancy_members m
 JOIN public.hotel_physical_occupancies o ON o.id=m.occupancy_id
 JOIN public.hotel_stays s ON s.id=m.hotel_stay_id AND s.dog_id=m.dog_id
 JOIN public.family_booking_members f ON f.id=m.family_booking_member_id AND f.dog_id=m.dog_id AND f.hotel_stay_id=m.hotel_stay_id
 WHERE m.id::text=p_body->>'entity_id' AND m.dog_id=p_dog_id
), snapshots(v) AS (
 SELECT v FROM (VALUES(p_body->'before_data'),(p_body->'after_data')) x(v) WHERE v IS NOT NULL AND v<>'null'::jsonb
)
SELECT coalesce(CASE p_source
 WHEN 'entity_audit_events' THEN EXISTS(
  SELECT 1 FROM member m WHERE m.kind=p_body->>'entity_type'
  AND p_body->>'module_code'=CASE WHEN m.kind='family_booking_members' THEN 'family_booking' ELSE 'hotel_operations' END
  AND p_body->>'action' IN ('created','updated','archived','restored')
  AND jsonb_typeof(p_body->'after_data')='object'
  AND (p_body->>'action'='created' OR jsonb_typeof(p_body->'before_data')='object')
  AND NOT EXISTS(SELECT 1 FROM snapshots WHERE NOT coalesce(
   v->>'id'=m.row_value->>'id' AND v->>'dog_id'=p_dog_id::text
   AND CASE m.kind WHEN 'family_booking_members' THEN v->>'family_booking_id'=m.row_value->>'family_booking_id'
     ELSE v->>'occupancy_id'=m.row_value->>'occupancy_id' AND v->>'hotel_stay_id'=m.row_value->>'hotel_stay_id'
       AND v->>'family_booking_member_id'=m.row_value->>'family_booking_member_id' END
   AND (m.kind<>'family_booking_members' OR (
      (v->>'hotel_stay_id' IS NULL OR v->>'hotel_stay_id'=m.row_value->>'hotel_stay_id') AND
      (v->>'operation_schedule_id' IS NULL OR v->>'operation_schedule_id'=m.row_value->>'operation_schedule_id') AND
      (v->>'shared_room_group_id' IS NULL OR v->>'shared_room_group_id'=m.row_value->>'shared_room_group_id')
   )),false))
 )
 WHEN 'sale_initial_payment_edit_requests' THEN EXISTS(
  SELECT 1 FROM public.sales s WHERE s.id::text=p_body->>'sale_id' AND s.dog_id=p_dog_id
    AND p_body->'canonical_payload'->>'saleId'=s.id::text
    AND p_body->'result'->>'saleId'=s.id::text
 )
 WHEN 'hotel_atomic_reverse_unassign_requests' THEN p_body->>'completed_at' IS NOT NULL AND
  CASE p_body->>'operation_kind'
   WHEN 'single' THEN EXISTS(SELECT 1 FROM public.hotel_stays s WHERE s.id::text=p_body->>'target_id' AND s.dog_id=p_dog_id
     AND p_body->'request_payload'->>'hotelStayId'=s.id::text AND p_body->'response_payload'->>'id'=s.id::text AND p_body->'response_payload'->>'dogId'=p_dog_id::text)
   WHEN 'shared' THEN EXISTS(SELECT 1 FROM public.hotel_physical_occupancies o JOIN public.hotel_physical_occupancy_members m ON m.occupancy_id=o.id
     WHERE o.id::text=p_body->>'target_id' AND m.dog_id=p_dog_id
     AND p_body->'request_payload'->>'occupancyId'=o.id::text
     AND p_body->'response_payload'->>'physicalOccupancyId'=o.id::text)
   ELSE false END
 ELSE false END,false)
$$;
REVOKE ALL ON FUNCTION public.dog_remaining_trace_resolved_v2a(text,jsonb,uuid) FROM PUBLIC,anon,authenticated,service_role;

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
 SELECT count(*)=9 AND bool_and(
   c.confdeltype IN ('a','r') AND cardinality(c.conkey)=1 AND
   (c.conrelid::regclass::text,a.attname) IN (
    ('sales','dog_id'),('operation_schedule_dogs','dog_id'),('hotel_stays','dog_id'),
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
      'profileStatus',CASE WHEN (dog_json->>'is_active')::boolean THEN 'active' ELSE 'inactive' END),
   'version',NULL,'commandAvailable',false,'contractVersion','dog-profile-preview-v2a-1',
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
   'graphFingerprint',md5(jsonb_build_object('contract','dog-profile-preview-v2a-1','dog',dog_json,'inventoryValid',fk_ok,
     'records',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY category,key) FROM records r),'[]'::jsonb),
     'traces',coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY source,key,body::text) FROM traces t),'[]'::jsonb))::text),
   'evaluatedAt',statement_timestamp(),'fingerprintUsage','READ_ONLY_NOT_A_WRITE_TOKEN'
 ) INTO result FROM summary s;
 RETURN result;
END $$;

COMMIT;
