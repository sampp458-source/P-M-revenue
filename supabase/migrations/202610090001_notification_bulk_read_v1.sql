BEGIN;

-- The same recipient, feature/access and validity scope as get_notification_inbox_v1.
-- No pagination/cutoff: one statement snapshot fixes the complete target set.
CREATE FUNCTION public.mark_all_notifications_read_v1()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $bulk_read$
DECLARE v_count integer;
BEGIN
 IF NOT public.notification_active_user_v1() THEN
  RAISE EXCEPTION 'NOTIFICATION_FORBIDDEN' USING ERRCODE = '42501';
 END IF;
 WITH targets AS MATERIALIZED (
  SELECT n.id FROM public.notifications n
  WHERE n.recipient_id = auth.uid() AND n.read_at IS NULL
   AND (n.category <> 'TASK_REQUEST' OR (public.is_active_operation_member()
    AND EXISTS (SELECT 1 FROM public.notification_task_config WHERE singleton AND task_request_enabled)))
   AND (n.category NOT IN ('PAYMENT_CONFIRMATION_REQUEST','PAYMENT_REQUEST')
    OR public.payment_can_view_v1(n.category,n.deep_link_id,auth.uid()))
   AND n.revoked_at IS NULL AND (n.expires_at IS NULL OR n.expires_at > now())
 ), changed AS (
  UPDATE public.notifications n SET read_at = statement_timestamp()
  FROM targets t WHERE n.id = t.id AND n.recipient_id = auth.uid()
   AND n.read_at IS NULL AND n.revoked_at IS NULL
   AND (n.expires_at IS NULL OR n.expires_at > now())
  RETURNING n.id
 ) SELECT count(*)::integer INTO v_count FROM changed;
 RETURN v_count;
END $bulk_read$;

REVOKE ALL ON FUNCTION public.mark_all_notifications_read_v1() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_all_notifications_read_v1() TO authenticated;
COMMIT;
