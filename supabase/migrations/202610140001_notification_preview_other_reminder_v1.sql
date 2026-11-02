-- Local candidate only: no enable, cron, business data or historical migration replay.
BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s';
DO $guard$ BEGIN
 IF current_user<>'postgres' OR NOT EXISTS(SELECT 1 FROM public.notification_schedule_reminder_config WHERE singleton AND NOT enabled) THEN RAISE EXCEPTION 'PREVIEW_REMINDER_OFF_REQUIRED'; END IF;
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid=to_regprocedure('public.get_notification_push_delivery_v1(uuid,uuid)')) IS DISTINCT FROM '336f41f1734e7dea0dbd2ee409c8519e'
 OR (SELECT md5(prosrc) FROM pg_proc WHERE oid=to_regprocedure('public.schedule_reminder_eligible_v1(uuid)')) IS DISTINCT FROM 'a25ca4484fdc9b91efdf8348d2cd5e10' THEN RAISE EXCEPTION 'PREVIEW_PREDECESSOR_MISMATCH'; END IF;
 IF EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid IN(to_regprocedure('public.get_notification_push_delivery_v1(uuid,uuid)'),to_regprocedure('public.schedule_reminder_eligible_v1(uuid)')) AND (pg_get_userbyid(p.proowner)<>'postgres' OR NOT p.prosecdef OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']::text[])) THEN RAISE EXCEPTION 'PREVIEW_SECURITY_MISMATCH'; END IF;
END $guard$;
DO $pair$ BEGIN IF NOT EXISTS(SELECT 1 FROM public.operation_calendars c JOIN public.operation_calendar_schedule_types m ON m.calendar_id=c.id JOIN public.operation_schedule_types t ON t.id=m.schedule_type_id WHERE c.id='35f8010c-cba0-41aa-9e96-a02c305eb1a0' AND t.id='94738517-e1fd-4f8c-a528-abeaf885932a' AND c.scope_type IN('business_unit','common') AND c.is_active AND t.is_active AND m.is_active AND m.archived_at IS NULL) THEN RAISE EXCEPTION 'OTHER_MAPPING_MISMATCH'; END IF; END $pair$;
INSERT INTO public.notification_schedule_reminder_types VALUES('35f8010c-cba0-41aa-9e96-a02c305eb1a0','94738517-e1fd-4f8c-a528-abeaf885932a','STANDARD') ON CONFLICT DO NOTHING;
DO $pair$ BEGIN IF NOT EXISTS(SELECT 1 FROM public.operation_calendars c JOIN public.operation_calendar_schedule_types m ON m.calendar_id=c.id JOIN public.operation_schedule_types t ON t.id=m.schedule_type_id WHERE c.id='a6e1dcea-478a-4d67-a4b4-1ce92a9c009e' AND t.id='94738517-e1fd-4f8c-a528-abeaf885932a' AND c.scope_type IN('business_unit','common') AND c.is_active AND t.is_active AND m.is_active AND m.archived_at IS NULL) THEN RAISE EXCEPTION 'OTHER_MAPPING_MISMATCH'; END IF; END $pair$;
INSERT INTO public.notification_schedule_reminder_types VALUES('a6e1dcea-478a-4d67-a4b4-1ce92a9c009e','94738517-e1fd-4f8c-a528-abeaf885932a','STANDARD') ON CONFLICT DO NOTHING;
DO $pair$ BEGIN IF NOT EXISTS(SELECT 1 FROM public.operation_calendars c JOIN public.operation_calendar_schedule_types m ON m.calendar_id=c.id JOIN public.operation_schedule_types t ON t.id=m.schedule_type_id WHERE c.id='3b3eb37e-1dcb-4275-9ed2-521040ccd45e' AND t.id='94738517-e1fd-4f8c-a528-abeaf885932a' AND c.scope_type IN('business_unit','common') AND c.is_active AND t.is_active AND m.is_active AND m.archived_at IS NULL) THEN RAISE EXCEPTION 'OTHER_MAPPING_MISMATCH'; END IF; END $pair$;
INSERT INTO public.notification_schedule_reminder_types VALUES('3b3eb37e-1dcb-4275-9ed2-521040ccd45e','94738517-e1fd-4f8c-a528-abeaf885932a','STANDARD') ON CONFLICT DO NOTHING;
DO $pair$ BEGIN IF NOT EXISTS(SELECT 1 FROM public.operation_calendars c JOIN public.operation_calendar_schedule_types m ON m.calendar_id=c.id JOIN public.operation_schedule_types t ON t.id=m.schedule_type_id WHERE c.id='04684630-3eca-4650-ad24-c4defb6c5c7d' AND t.id='94738517-e1fd-4f8c-a528-abeaf885932a' AND c.scope_type IN('business_unit','common') AND c.is_active AND t.is_active AND m.is_active AND m.archived_at IS NULL) THEN RAISE EXCEPTION 'OTHER_MAPPING_MISMATCH'; END IF; END $pair$;
INSERT INTO public.notification_schedule_reminder_types VALUES('04684630-3eca-4650-ad24-c4defb6c5c7d','94738517-e1fd-4f8c-a528-abeaf885932a','STANDARD') ON CONFLICT DO NOTHING;
CREATE OR REPLACE FUNCTION public.schedule_reminder_eligible_v1(p_schedule uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $eligible$
 SELECT EXISTS(SELECT 1 FROM public.operation_schedules s
 JOIN public.notification_schedule_reminder_types r ON r.calendar_id=s.calendar_id AND r.schedule_type_id=s.schedule_type_id
 JOIN public.operation_calendars c ON c.id=s.calendar_id AND c.is_active
 JOIN public.operation_schedule_types t ON t.id=s.schedule_type_id AND t.is_active
 JOIN public.operation_calendar_schedule_types m ON m.calendar_id=s.calendar_id AND m.schedule_type_id=s.schedule_type_id AND m.is_active AND m.archived_at IS NULL
 WHERE (r.schedule_type_id<>'94738517-e1fd-4f8c-a528-abeaf885932a'::uuid OR c.scope_type IN ('business_unit','common')) AND s.id=p_schedule AND s.status='scheduled' AND s.archived_at IS NULL AND NOT s.all_day AND NOT s.time_unspecified
 AND CASE r.mode
 WHEN 'HOTEL' THEN EXISTS(SELECT 1 FROM public.hotel_stay_schedule_events e JOIN public.hotel_stays h ON h.id=e.hotel_stay_id
 WHERE e.operation_schedule_id=s.id AND e.archived_at IS NULL AND h.archived_at IS NULL AND h.checked_out_at IS NULL
 AND ((e.event_kind='check_in' AND h.checked_in_at IS NULL) OR e.event_kind='check_out'))
 WHEN 'DAYCARE' THEN EXISTS(SELECT 1 FROM public.daycare_operation_states d WHERE d.operation_schedule_id=s.id AND d.lifecycle_status='scheduled' AND d.checked_in_at IS NULL)
 ELSE true END)
$eligible$;
CREATE OR REPLACE FUNCTION public.get_notification_push_delivery_v1(p_delivery_id uuid, p_token uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
 SELECT jsonb_build_object('notification_id',n.id,'deep_link_type',n.deep_link_type,'deep_link_id',n.deep_link_id,
 'event_type',e.event_type,'summary_count',CASE WHEN e.event_type='DAILY_SCHEDULE_SUMMARY' THEN e.payload->'count' ELSE NULL END,'category',n.category,'endpoint',s.endpoint,'p256dh',s.p256dh,'auth',s.auth) || CASE WHEN n.category='TASK_REQUEST' THEN jsonb_build_object('task_audience',e.payload->>'audience') ELSE '{}'::jsonb END
 || CASE WHEN e.event_type='SCHEDULE_REMINDER' THEN jsonb_build_object('expires_at',n.expires_at) ELSE '{}'::jsonb END
 || jsonb_build_object('preview_source',jsonb_strip_nulls(jsonb_build_object(
 'title',CASE WHEN n.category='SCHEDULE' AND e.event_type<>'DAILY_SCHEDULE_SUMMARY' THEN (SELECT title FROM public.operation_schedules WHERE id=n.deep_link_id)
 WHEN n.category='TASK_REQUEST' THEN (SELECT title FROM public.task_requests WHERE id=n.deep_link_id) ELSE n.title END,
 'body',CASE WHEN n.category='ANNOUNCEMENT' THEN n.message WHEN n.category='TASK_REQUEST' THEN (SELECT body FROM public.task_requests WHERE id=n.deep_link_id) ELSE n.title END,
 'summary',n.message,
 'ack_required',CASE WHEN n.category='ANNOUNCEMENT' THEN (SELECT ack_required FROM public.announcements WHERE id=n.announcement_id) END,
 'due_at',CASE WHEN n.category='TASK_REQUEST' THEN (SELECT due_at FROM public.task_requests WHERE id=n.deep_link_id) WHEN n.category='PAYMENT_REQUEST' THEN (SELECT due_at FROM public.payment_requests WHERE id=n.deep_link_id) END,
 'sender',CASE WHEN n.category='TASK_REQUEST' THEN (SELECT p.name FROM public.task_requests t JOIN public.profiles p ON p.id=t.requester_id WHERE t.id=n.deep_link_id) END,
 'subject',CASE WHEN n.category='PAYMENT_CONFIRMATION_REQUEST' THEN (SELECT payer_name FROM public.payment_confirmation_requests WHERE id=n.deep_link_id) WHEN n.category='PAYMENT_REQUEST' THEN (SELECT payee_name FROM public.payment_requests WHERE id=n.deep_link_id) END)))
 FROM public.notification_push_deliveries d JOIN public.notifications n ON n.id=d.notification_id JOIN public.notification_events e ON e.id=n.event_id JOIN public.push_subscriptions s ON s.id=d.subscription_id
 WHERE d.id=p_delivery_id AND d.claim_token=p_token AND d.status='PROCESSING' AND d.lease_until>now()+interval '20 seconds'
 AND EXISTS(SELECT 1 FROM public.notification_push_config WHERE enabled) AND public.push_delivery_valid_v1(d.id);
$function$;
COMMIT;
