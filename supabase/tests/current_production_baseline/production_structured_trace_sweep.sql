-- Generated from final candidate READ classifier. Aggregate only, no correction installed.
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout='20s';
SET LOCAL jit=off;
WITH RECURSIVE raw_source AS MATERIALIZED (SELECT 'daycare_operation_states'::text source,coalesce(to_jsonb(t)->>'id',to_jsonb(t)->>'request_id',to_jsonb(t)->>'operation_schedule_id') key,to_jsonb(t) body,jsonb_build_array(t.canonical_payload,t.request_history) payload FROM public.daycare_operation_states t UNION ALL SELECT 'entity_audit_events'::text source,coalesce(to_jsonb(t)->>'id',to_jsonb(t)->>'request_id',to_jsonb(t)->>'operation_schedule_id') key,to_jsonb(t) body,jsonb_build_array(t.before_data,t.after_data) payload FROM public.entity_audit_events t WHERE t.entity_type NOT IN ('dogs','dog') UNION ALL SELECT 'family_bookings'::text source,coalesce(to_jsonb(t)->>'id',to_jsonb(t)->>'request_id',to_jsonb(t)->>'operation_schedule_id') key,to_jsonb(t) body,jsonb_build_array(t.canonical_payload) payload FROM public.family_bookings t UNION ALL SELECT 'hotel_atomic_reverse_unassign_requests'::text source,coalesce(to_jsonb(t)->>'id',to_jsonb(t)->>'request_id',to_jsonb(t)->>'operation_schedule_id') key,to_jsonb(t) body,jsonb_build_array(t.request_payload,t.response_payload) payload FROM public.hotel_atomic_reverse_unassign_requests t UNION ALL SELECT 'hotel_missed_check_in_receipts'::text source,coalesce(to_jsonb(t)->>'id',to_jsonb(t)->>'request_id',to_jsonb(t)->>'operation_schedule_id') key,to_jsonb(t) body,jsonb_build_array(t.normalized_input,t.response) payload FROM public.hotel_missed_check_in_receipts t UNION ALL SELECT 'hotel_physical_occupancy_requests'::text source,coalesce(to_jsonb(t)->>'id',to_jsonb(t)->>'request_id',to_jsonb(t)->>'operation_schedule_id') key,to_jsonb(t) body,jsonb_build_array(t.response) payload FROM public.hotel_physical_occupancy_requests t UNION ALL SELECT 'hotel_planned_checkout_requests'::text source,coalesce(to_jsonb(t)->>'id',to_jsonb(t)->>'request_id',to_jsonb(t)->>'operation_schedule_id') key,to_jsonb(t) body,jsonb_build_array(t.response) payload FROM public.hotel_planned_checkout_requests t UNION ALL SELECT 'hotel_single_check_in_receipts'::text source,coalesce(to_jsonb(t)->>'id',to_jsonb(t)->>'request_id',to_jsonb(t)->>'operation_schedule_id') key,to_jsonb(t) body,jsonb_build_array(t.normalized_input,t.response) payload FROM public.hotel_single_check_in_receipts t UNION ALL SELECT 'long_stay_operation_audit_events'::text source,coalesce(to_jsonb(t)->>'id',to_jsonb(t)->>'request_id',to_jsonb(t)->>'operation_schedule_id') key,to_jsonb(t) body,jsonb_build_array(t.canonical_payload,t.before_state,t.after_state) payload FROM public.long_stay_operation_audit_events t UNION ALL SELECT 'sale_history'::text source,coalesce(to_jsonb(t)->>'id',to_jsonb(t)->>'request_id',to_jsonb(t)->>'operation_schedule_id') key,to_jsonb(t) body,jsonb_build_array(t.previous_data,t.changed_data) payload FROM public.sale_history t UNION ALL SELECT 'sale_initial_payment_edit_requests'::text source,coalesce(to_jsonb(t)->>'id',to_jsonb(t)->>'request_id',to_jsonb(t)->>'operation_schedule_id') key,to_jsonb(t) body,jsonb_build_array(t.canonical_payload,t.result) payload FROM public.sale_initial_payment_edit_requests t),
 all_source AS MATERIALIZED (SELECT * FROM raw_source ORDER BY source,key LIMIT 500 OFFSET 0),
 candidate_ids AS MATERIALIZED (
 SELECT DISTINCT a.source,a.key,(m.parts)[1] dog_text FROM all_source a
 CROSS JOIN LATERAL regexp_matches(a.payload::text,'([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})','g') m(parts)
 ), discovered AS MATERIALIZED (
 SELECT c.source,c.key,d.id dog_id FROM candidate_ids c JOIN public.dogs d ON d.id::text=c.dog_text
 JOIN all_source a ON a.source=c.source AND a.key IS NOT DISTINCT FROM c.key
 WHERE public.dog_identity_in_payload_v2a(a.payload,d.id)
 ),  keys(dog_id,key) AS MATERIALIZED (
  SELECT dog_id,id::text FROM public.sales
  UNION SELECT dog_id,schedule_id::text FROM public.operation_schedule_dogs
  UNION SELECT dog_id,id::text FROM public.hotel_stays
  UNION SELECT dog_id,occupancy_id::text FROM public.hotel_physical_occupancy_members
  UNION SELECT dog_id,id::text FROM public.long_stay_contracts
  UNION SELECT dog_id,id::text FROM public.journal_entries
  UNION SELECT best_friend_dog_id,id::text FROM public.journal_entries WHERE best_friend_dog_id IS NOT NULL
  UNION SELECT dog_id,journal_entry_id::text FROM public.journal_entry_best_friend_targets WHERE dog_id IS NOT NULL
  UNION SELECT dog_id,family_booking_id::text FROM public.family_booking_members
  ), direct_parent AS MATERIALIZED (
  SELECT a.source,a.key,s.dog_id FROM all_source a JOIN public.hotel_stays s ON a.body->>'hotel_stay_id'=s.id::text
  UNION SELECT a.source,a.key,m.dog_id FROM all_source a JOIN public.hotel_physical_occupancy_members m ON a.body->>'occupancy_id'=m.occupancy_id::text
  UNION SELECT a.source,a.key,c.dog_id FROM all_source a JOIN public.long_stay_contracts c ON a.body->>'long_stay_contract_id'=c.id::text
  UNION SELECT a.source,a.key,s.dog_id FROM all_source a JOIN public.hotel_stays s ON a.body->>'entity_id'=s.id::text WHERE a.source='entity_audit_events'
  UNION SELECT a.source,a.key,l.dog_id FROM all_source a JOIN public.operation_schedule_dogs l ON a.body->>'entity_id'=l.schedule_id::text WHERE a.source='entity_audit_events'
  ), trace_rows AS MATERIALIZED (
  SELECT a.source,a.key,a.body,d.dog_id FROM all_source a JOIN (SELECT * FROM discovered UNION SELECT * FROM direct_parent) d ON d.source=a.source AND d.key IS NOT DISTINCT FROM a.key
  ), evaluated AS MATERIALIZED (
  SELECT outer_trace.source,outer_trace.body,outer_trace.dog_id,outer_trace.body->>'entity_type' entity_type, coalesce((

   EXISTS(SELECT 1 FROM public.sales sale WHERE sale.id::text=outer_trace.body->>'sale_id' AND outer_trace.source='sale_history'
   AND outer_trace.body->>'action' IN ('created','updated','partial_refund','full_refund','cancelled','reopened')
   AND (
     (sale.dog_id=outer_trace.dog_id AND EXISTS (
       SELECT 1 FROM (VALUES(outer_trace.body->'previous_data'),(outer_trace.body->'changed_data')) snapshot(value)
       WHERE value->>'id'=sale.id::text AND value->>'dog_id'=outer_trace.dog_id::text
     )) OR (
       outer_trace.body->>'action'='updated'
       AND outer_trace.body->'previous_data'->>'id'=sale.id::text
       AND outer_trace.body->'previous_data'->>'dog_id'=outer_trace.dog_id::text
       AND outer_trace.body->'changed_data'=to_jsonb(sale)
     ) OR (
       outer_trace.body->>'action'='created'
       AND outer_trace.body->'changed_data'->>'id'=sale.id::text
       AND outer_trace.body->'changed_data'->>'dog_id'=outer_trace.dog_id::text
       AND EXISTS(SELECT 1 FROM public.sale_history next_history
         WHERE next_history.sale_id::text=sale.id::text AND next_history.action='updated'
           AND next_history.previous_data=outer_trace.body->'changed_data'
           AND next_history.changed_data=to_jsonb(sale))
     )
   )
) OR
   (outer_trace.source='entity_audit_events' AND (
     (outer_trace.body->>'entity_type'='operation_schedule_dogs' AND (WITH sample AS (SELECT outer_trace.body audit, to_jsonb(l) link,
 outer_trace.body->'before_data' prior,outer_trace.body->'after_data' later,outer_trace.dog_id dog_id
 FROM public.operation_schedule_dogs l JOIN public.operation_schedules s ON s.id=l.schedule_id
 WHERE l.id::text=outer_trace.body->>'entity_id') SELECT coalesce((SELECT coalesce(
 audit->>'module_code'='operations' AND audit->>'action' IN ('created','updated','archived','restored')
 AND jsonb_typeof(later)='object'
 AND (CASE WHEN audit->>'action'='created' THEN prior IS NULL OR prior='null'::jsonb ELSE jsonb_typeof(prior)='object' END)
 AND NOT EXISTS(SELECT 1 FROM (VALUES(prior),(later)) snap(v) WHERE v IS NOT NULL AND v<>'null'::jsonb AND NOT coalesce(
   jsonb_typeof(v)='object' AND v ?& ARRAY['id','schedule_id','dog_id','archived_at','archive_reason']
   AND v->>'id'=link->>'id' AND v->>'schedule_id'=link->>'schedule_id'
   AND EXISTS(SELECT 1 FROM public.dogs d WHERE d.id::text=v->>'dog_id')
   AND jsonb_typeof(v->'archived_at') IN ('null','string') AND jsonb_typeof(v->'archive_reason') IN ('null','string'),false))
 AND (prior->>'dog_id'=dog_id::text OR later->>'dog_id'=dog_id::text)
 AND CASE audit->>'action'
   WHEN 'archived' THEN prior->'archived_at'='null'::jsonb AND later->'archived_at'<>'null'::jsonb
   WHEN 'restored' THEN prior->'archived_at'<>'null'::jsonb AND later->'archived_at'='null'::jsonb
   WHEN 'updated' THEN (prior->'archived_at'='null'::jsonb) IS NOT DISTINCT FROM (later->'archived_at'='null'::jsonb)
   ELSE true END
 AND (later->>'dog_id'=link->>'dog_id' OR EXISTS(SELECT 1 FROM public.entity_audit_events a
   WHERE a.module_code='operations' AND a.entity_type='operation_schedule_dogs' AND a.entity_id::text=link->>'id' AND a.action='updated'
    AND a.before_data=later AND a.after_data=link
    AND (a.before_data->'archived_at'='null'::jsonb)=(a.after_data->'archived_at'='null'::jsonb))),false) FROM sample),false))) OR
     (outer_trace.body->>'entity_type' IN ('journal_days','journal_entries') AND (
WITH snapshots(v) AS (
 SELECT v FROM (VALUES(outer_trace.body->'before_data'),(coalesce(outer_trace.body->'after_data'->'entry',outer_trace.body->'after_data'))) x(v)
 WHERE v IS NOT NULL AND v<>'null'::jsonb
), entry AS (
 SELECT e.*,d.business_date FROM public.journal_entries e JOIN public.journal_days d ON d.id=e.journal_day_id
 WHERE e.id=CASE WHEN outer_trace.body->>'entity_id' ~ '^[0-9a-f-]{36}$' AND outer_trace.body->>'entity_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN (outer_trace.body->>'entity_id')::uuid END
), target_snapshots AS (
 SELECT v FROM snapshots WHERE coalesce(v->'dog'->>'id',v->>'dog_id')=outer_trace.dog_id::text
 OR coalesce(v->>'bestFriendDogId',v->>'best_friend_dog_id')=outer_trace.dog_id::text
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v->'bestFriendTargets')='array' THEN v->'bestFriendTargets' ELSE '[]'::jsonb END) t
   WHERE t->>'type'='DOG' AND t->>'dogId'=outer_trace.dog_id::text)
)
SELECT coalesce(outer_trace.body->>'module_code'='journal' AND outer_trace.body->>'action' IN ('created','updated') AND
 CASE outer_trace.body->>'entity_type'
 WHEN 'journal_days' THEN EXISTS(
   SELECT 1 FROM public.journal_days d JOIN public.journal_entries e ON e.journal_day_id=d.id AND e.dog_id=outer_trace.dog_id
   WHERE d.id::text=outer_trace.body->>'entity_id' AND d.journal_type='daycare_daily'
     AND outer_trace.body->>'change_reason'='journal_day_default_activities_register'
     AND outer_trace.body->'after_data'->'request'->>'businessDate'=d.business_date::text
     AND jsonb_typeof(outer_trace.body->'after_data'->'request'->'dogIds')='array'
     AND (outer_trace.body->'after_data'->'request'->'dogIds') @> jsonb_build_array(outer_trace.dog_id::text)
     AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(outer_trace.body->'after_data'->'request'->'dogIds')='array' THEN outer_trace.body->'after_data'->'request'->'dogIds' ELSE '[]'::jsonb END) dog(value)
       WHERE jsonb_typeof(dog.value)<>'string' OR (dog.value #>> '{}') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
     AND (NOT (outer_trace.body->'after_data'->'request' ? 'journalDayId') OR outer_trace.body->'after_data'->'request'->>'journalDayId'=d.id::text)
 )
 WHEN 'journal_entries' THEN EXISTS(
   SELECT 1 FROM entry e WHERE EXISTS(SELECT 1 FROM target_snapshots)
     AND jsonb_typeof(coalesce(outer_trace.body->'after_data'->'entry',outer_trace.body->'after_data'))='object'
     AND (outer_trace.body->>'action'='created' OR jsonb_typeof(outer_trace.body->'before_data')='object')
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
     AND (NOT coalesce(outer_trace.body->'after_data'->'request' ? 'entryId',false) OR outer_trace.body->'after_data'->'request'->>'entryId'=e.id::text)
     AND (NOT coalesce(outer_trace.body->'after_data'->'request' ? 'bestFriendTargets',false) OR outer_trace.body->'after_data'->'request'->'bestFriendTargets'=outer_trace.body->'after_data'->'entry'->'bestFriendTargets')
 )
 ELSE false END,false)
)) OR
     (
WITH member AS (
 SELECT to_jsonb(m) row_value,'family_booking_members' kind FROM public.family_booking_members m
 JOIN public.family_bookings f ON f.id=m.family_booking_id
 WHERE m.id::text=outer_trace.body->>'entity_id' AND m.dog_id=outer_trace.dog_id
 UNION ALL
 SELECT to_jsonb(m),'hotel_physical_occupancy_members' FROM public.hotel_physical_occupancy_members m
 JOIN public.hotel_physical_occupancies o ON o.id=m.occupancy_id
 JOIN public.hotel_stays s ON s.id=m.hotel_stay_id AND s.dog_id=m.dog_id
 JOIN public.family_booking_members f ON f.id=m.family_booking_member_id AND f.dog_id=m.dog_id AND f.hotel_stay_id=m.hotel_stay_id
 WHERE m.id::text=outer_trace.body->>'entity_id' AND m.dog_id=outer_trace.dog_id
), snapshots(v) AS (
 SELECT v FROM (VALUES(outer_trace.body->'before_data'),(outer_trace.body->'after_data')) x(v) WHERE v IS NOT NULL AND v<>'null'::jsonb
)
SELECT coalesce(CASE outer_trace.source
 WHEN 'entity_audit_events' THEN EXISTS(
  SELECT 1 FROM member m WHERE m.kind=outer_trace.body->>'entity_type'
  AND outer_trace.body->>'module_code'=CASE WHEN m.kind='family_booking_members' THEN 'family_booking' ELSE 'hotel_operations' END
  AND outer_trace.body->>'action' IN ('created','updated','archived','restored')
  AND jsonb_typeof(outer_trace.body->'after_data')='object'
  AND (outer_trace.body->>'action'='created' OR jsonb_typeof(outer_trace.body->'before_data')='object')
  AND NOT EXISTS(SELECT 1 FROM snapshots WHERE NOT coalesce(
   v->>'id'=m.row_value->>'id' AND v->>'dog_id'=outer_trace.dog_id::text
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
  SELECT 1 FROM public.sales s WHERE s.id::text=outer_trace.body->>'sale_id' AND s.dog_id=outer_trace.dog_id
    AND outer_trace.body->'canonical_payload'->>'saleId'=s.id::text
    AND outer_trace.body->'result'->>'saleId'=s.id::text
 )
 WHEN 'hotel_atomic_reverse_unassign_requests' THEN outer_trace.body->>'completed_at' IS NOT NULL AND
  CASE outer_trace.body->>'operation_kind'
   WHEN 'single' THEN EXISTS(SELECT 1 FROM public.hotel_stays s WHERE s.id::text=outer_trace.body->>'target_id' AND s.dog_id=outer_trace.dog_id
     AND outer_trace.body->'request_payload'->>'hotelStayId'=s.id::text AND outer_trace.body->'response_payload'->>'id'=s.id::text AND outer_trace.body->'response_payload'->>'dogId'=outer_trace.dog_id::text)
   WHEN 'shared' THEN EXISTS(SELECT 1 FROM public.hotel_physical_occupancies o JOIN public.hotel_physical_occupancy_members m ON m.occupancy_id=o.id
     WHERE o.id::text=outer_trace.body->>'target_id' AND m.dog_id=outer_trace.dog_id
     AND outer_trace.body->'request_payload'->>'occupancyId'=o.id::text
     AND outer_trace.body->'response_payload'->>'physicalOccupancyId'=o.id::text)
   ELSE false END
 ELSE false END,false)
) OR
     (outer_trace.body->>'entity_type' IN ('hotel_stays','operation_schedules','daycare_operation_states','family_bookings','hotel_physical_occupancies','long_stay_contracts','family_shared_room_groups') AND outer_trace.body->>'entity_id' IN (SELECT k.key FROM keys k WHERE k.dog_id=outer_trace.dog_id))
   )) OR
   (outer_trace.source IN ('hotel_atomic_reverse_unassign_requests','sale_initial_payment_edit_requests') AND (
WITH member AS (
 SELECT to_jsonb(m) row_value,'family_booking_members' kind FROM public.family_booking_members m
 JOIN public.family_bookings f ON f.id=m.family_booking_id
 WHERE m.id::text=outer_trace.body->>'entity_id' AND m.dog_id=outer_trace.dog_id
 UNION ALL
 SELECT to_jsonb(m),'hotel_physical_occupancy_members' FROM public.hotel_physical_occupancy_members m
 JOIN public.hotel_physical_occupancies o ON o.id=m.occupancy_id
 JOIN public.hotel_stays s ON s.id=m.hotel_stay_id AND s.dog_id=m.dog_id
 JOIN public.family_booking_members f ON f.id=m.family_booking_member_id AND f.dog_id=m.dog_id AND f.hotel_stay_id=m.hotel_stay_id
 WHERE m.id::text=outer_trace.body->>'entity_id' AND m.dog_id=outer_trace.dog_id
), snapshots(v) AS (
 SELECT v FROM (VALUES(outer_trace.body->'before_data'),(outer_trace.body->'after_data')) x(v) WHERE v IS NOT NULL AND v<>'null'::jsonb
)
SELECT coalesce(CASE outer_trace.source
 WHEN 'entity_audit_events' THEN EXISTS(
  SELECT 1 FROM member m WHERE m.kind=outer_trace.body->>'entity_type'
  AND outer_trace.body->>'module_code'=CASE WHEN m.kind='family_booking_members' THEN 'family_booking' ELSE 'hotel_operations' END
  AND outer_trace.body->>'action' IN ('created','updated','archived','restored')
  AND jsonb_typeof(outer_trace.body->'after_data')='object'
  AND (outer_trace.body->>'action'='created' OR jsonb_typeof(outer_trace.body->'before_data')='object')
  AND NOT EXISTS(SELECT 1 FROM snapshots WHERE NOT coalesce(
   v->>'id'=m.row_value->>'id' AND v->>'dog_id'=outer_trace.dog_id::text
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
  SELECT 1 FROM public.sales s WHERE s.id::text=outer_trace.body->>'sale_id' AND s.dog_id=outer_trace.dog_id
    AND outer_trace.body->'canonical_payload'->>'saleId'=s.id::text
    AND outer_trace.body->'result'->>'saleId'=s.id::text
 )
 WHEN 'hotel_atomic_reverse_unassign_requests' THEN outer_trace.body->>'completed_at' IS NOT NULL AND
  CASE outer_trace.body->>'operation_kind'
   WHEN 'single' THEN EXISTS(SELECT 1 FROM public.hotel_stays s WHERE s.id::text=outer_trace.body->>'target_id' AND s.dog_id=outer_trace.dog_id
     AND outer_trace.body->'request_payload'->>'hotelStayId'=s.id::text AND outer_trace.body->'response_payload'->>'id'=s.id::text AND outer_trace.body->'response_payload'->>'dogId'=outer_trace.dog_id::text)
   WHEN 'shared' THEN EXISTS(SELECT 1 FROM public.hotel_physical_occupancies o JOIN public.hotel_physical_occupancy_members m ON m.occupancy_id=o.id
     WHERE o.id::text=outer_trace.body->>'target_id' AND m.dog_id=outer_trace.dog_id
     AND outer_trace.body->'request_payload'->>'occupancyId'=o.id::text
     AND outer_trace.body->'response_payload'->>'physicalOccupancyId'=o.id::text)
   ELSE false END
 ELSE false END,false)
)) OR
   (outer_trace.source='family_bookings' AND outer_trace.key IN (SELECT family_booking_id::text FROM public.family_booking_members WHERE dog_id=outer_trace.dog_id)) OR
   (outer_trace.source='daycare_operation_states' AND outer_trace.key IN (SELECT schedule_id::text FROM public.operation_schedule_dogs WHERE dog_id=outer_trace.dog_id)) OR
   outer_trace.body->>'hotel_stay_id' IN (SELECT id::text FROM public.hotel_stays WHERE dog_id=outer_trace.dog_id) OR
   outer_trace.body->>'occupancy_id' IN (SELECT occupancy_id::text FROM public.hotel_physical_occupancy_members WHERE dog_id=outer_trace.dog_id) OR
   outer_trace.body->>'long_stay_contract_id' IN (SELECT id::text FROM public.long_stay_contracts WHERE dog_id=outer_trace.dog_id)
),false) resolved FROM trace_rows outer_trace
  ), counts AS (
 SELECT source,coalesce(entity_type,'-') entity_type,count(*) total,
 count(*) FILTER(WHERE resolved) resolved,count(*) FILTER(WHERE NOT resolved) unresolved
 FROM evaluated GROUP BY source,entity_type
 ), reasons AS (
 SELECT source,entity_type,body->>'action' action,body->>'change_reason' reason,
 CASE entity_type WHEN 'journal_entries' THEN EXISTS(SELECT 1 FROM public.journal_entries e WHERE e.id::text=body->>'entity_id')
 WHEN 'journal_days' THEN EXISTS(SELECT 1 FROM public.journal_entries e WHERE e.journal_day_id::text=body->>'entity_id' AND e.dog_id=evaluated.dog_id)
 WHEN 'hotel_stays' THEN EXISTS(SELECT 1 FROM public.hotel_stays h WHERE h.id::text=body->>'entity_id' AND h.dog_id=evaluated.dog_id)
 ELSE EXISTS(SELECT 1 FROM public.sales s WHERE s.id::text=body->>'sale_id') END retained_target_relation,
 count(*) n FROM evaluated WHERE NOT resolved GROUP BY source,entity_type,body,dog_id
 ), grouped_reasons AS (
 SELECT source,entity_type,action,reason,retained_target_relation,sum(n) n FROM reasons GROUP BY source,entity_type,action,reason,retained_target_relation
 ) SELECT jsonb_build_object('readOnly',current_setting('transaction_read_only'),'dogs',(SELECT count(*) FROM public.dogs),
 'population',(SELECT count(*) FROM raw_source),'batchCount',(SELECT count(*) FROM all_source),'offset',0,
 'rows',(SELECT jsonb_agg(to_jsonb(c) ORDER BY source,entity_type) FROM counts c),
 'unresolvedReasons',(SELECT jsonb_agg(to_jsonb(r)) FROM grouped_reasons r),'mutation',0) result;
ROLLBACK;
