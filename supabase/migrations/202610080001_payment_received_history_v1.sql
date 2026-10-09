-- Append-only read model; no business/config/table mutation.
BEGIN;
DO $guard$ BEGIN
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.get_request_hub_v1(text,text,text,integer)'::regprocedure) IS DISTINCT FROM '58a4c702e51a01f396e5a76bea4f27d2' THEN RAISE EXCEPTION 'PAYMENT_HISTORY_PREDECESSOR_MISMATCH'; END IF;
END $guard$;
CREATE FUNCTION public.get_payment_received_history_v1(p_type text,p_date date,p_offset integer DEFAULT 0,p_limit integer DEFAULT 50,p_open_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $history$
DECLARE result jsonb; start_at timestamptz; end_at timestamptz;
BEGIN
 IF NOT public.is_active_operation_member() THEN RAISE EXCEPTION 'PAYMENT_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF p_type IS NULL OR p_type NOT IN('ALL','PAYMENT_CONFIRMATION_REQUEST','PAYMENT_REQUEST') OR p_date IS NULL OR NOT isfinite(p_date) OR p_offset IS NULL OR p_offset NOT BETWEEN 0 AND 100000 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 OR p_open_offset IS NULL OR p_open_offset NOT BETWEEN 0 AND 100000 THEN RAISE EXCEPTION 'INVALID_PAGE' USING ERRCODE='22023'; END IF;
 start_at:=p_date::timestamp AT TIME ZONE 'Asia/Seoul'; end_at:=(p_date+1)::timestamp AT TIME ZONE 'Asia/Seoul';
 WITH candidates AS MATERIALIZED (
 SELECT r.*,CASE r.request_type
 WHEN 'PAYMENT_CONFIRMATION_REQUEST' THEN CASE r.status WHEN 'CONFIRMED' THEN (r.data->>'resolved_at')::timestamptz WHEN 'CANCELLED' THEN (r.data->>'cancelled_at')::timestamptz END
 WHEN 'PAYMENT_REQUEST' THEN CASE r.status WHEN 'COMPLETED' THEN (r.data->>'completed_at')::timestamptz WHEN 'REJECTED' THEN (r.data->>'rejected_at')::timestamptz WHEN 'CANCELLED' THEN (r.data->>'cancelled_at')::timestamptz END END processed_at
 FROM public.payment_rows_v1() r WHERE r.handler_id=auth.uid() AND (p_type='ALL' OR r.request_type=p_type)
 AND public.payment_can_view_v1(r.request_type,r.id,auth.uid())
 ), projected AS MATERIALIZED (
 SELECT request_type,id,display_title,status,CASE WHEN (request_type='PAYMENT_CONFIRMATION_REQUEST' AND status IN('REQUESTED','NOT_FOUND')) OR (request_type='PAYMENT_REQUEST' AND status IN('REQUESTED','ACKNOWLEDGED')) THEN 'OPEN' ELSE 'CLOSED' END lifecycle,created_at,due_at,processed_at,
 (SELECT name FROM public.profiles WHERE id=requester_id) counterparty,(status IN('REQUESTED','ACKNOWLEDGED') OR (request_type='PAYMENT_CONFIRMATION_REQUEST' AND status='NOT_FOUND')) AND NOT public.payment_has_capability_v1(handler_id,CASE request_type WHEN 'PAYMENT_CONFIRMATION_REQUEST' THEN 'PAYMENT_CONFIRMATION_REVIEW' ELSE 'PAYMENT_REQUEST_PROCESS' END) handler_unavailable,(data->>'administrative_cancelled')::boolean administrative_cancelled
 FROM candidates
 ), queued AS MATERIALIZED (SELECT * FROM projected WHERE lifecycle='OPEN'),
 filtered AS MATERIALIZED (SELECT * FROM projected WHERE lifecycle='CLOSED' AND processed_at>=start_at AND processed_at<end_at)
 SELECT jsonb_build_object('count',(SELECT count(*) FROM filtered),'open',jsonb_build_object('count',(SELECT count(*) FROM queued),'items',coalesce((SELECT jsonb_agg(to_jsonb(q) ORDER BY q.due_at ASC NULLS LAST,q.created_at DESC,q.id) FROM (SELECT * FROM queued ORDER BY due_at ASC NULLS LAST,created_at DESC,id LIMIT 50 OFFSET p_open_offset)q),'[]'::jsonb)),'items',coalesce((SELECT jsonb_agg(to_jsonb(q) ORDER BY q.processed_at DESC,q.id DESC) FROM (SELECT * FROM filtered ORDER BY processed_at DESC,id DESC LIMIT p_limit OFFSET p_offset)q),'[]'::jsonb)) INTO result;
 RETURN result;
END;
$history$;
ALTER FUNCTION public.get_payment_received_history_v1(text,date,integer,integer,integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_payment_received_history_v1(text,date,integer,integer,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_payment_received_history_v1(text,date,integer,integer,integer) TO authenticated;
COMMIT;
