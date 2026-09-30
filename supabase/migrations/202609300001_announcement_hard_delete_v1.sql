-- Candidate only. Manual apply after release approval; no migration-history operations.
BEGIN;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.publish_announcement_v1(uuid,text,text,text,boolean,text,uuid[],timestamptz)') AND md5(prosrc)='71866221edcd8d1c02c73e8e5610ea09' AND prosecdef AND pg_get_userbyid(proowner)='postgres') THEN
 RAISE EXCEPTION 'STOP_ANNOUNCEMENT_PUBLISH_PREDECESSOR_MISMATCH';
 END IF;
END $$;

-- Permanent request barrier only; never retain content, audience, or read/ACK history.
CREATE TABLE public.announcement_deleted_requests (
 author_id uuid NOT NULL,
 request_id uuid NOT NULL,
 deleted_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (author_id, request_id)
);
ALTER TABLE public.announcement_deleted_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.announcement_deleted_requests FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.announcement_deleted_requests TO service_role;

-- Durable recipient cursor only; no deleted announcement content or identity.
CREATE TABLE public.notification_inbox_revisions (
 recipient_id uuid PRIMARY KEY REFERENCES public.profiles(id),
 revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.notification_inbox_revisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_inbox_revisions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.notification_inbox_revisions TO authenticated;
GRANT ALL ON public.notification_inbox_revisions TO service_role;
CREATE POLICY notification_inbox_revision_self ON public.notification_inbox_revisions
 FOR SELECT TO authenticated
 USING (recipient_id=auth.uid() AND public.notification_active_user_v1());
ALTER PUBLICATION supabase_realtime ADD TABLE public.notification_inbox_revisions;

CREATE OR REPLACE FUNCTION public.publish_announcement_v1(p_request_id uuid, p_title text, p_body text, p_priority text, p_ack_required boolean, p_target_kind text, p_user_ids uuid[] DEFAULT '{}'::uuid[], p_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_id uuid; v_event uuid; v_users uuid[]; v_payload jsonb; v_existing jsonb;
BEGIN
 IF NOT public.notification_has_capability_v1('ANNOUNCEMENT_PUBLISH') THEN RAISE EXCEPTION 'ANNOUNCEMENT_PUBLISH_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF p_request_id IS NULL OR p_title IS NULL OR length(btrim(p_title)) NOT BETWEEN 1 AND 100 OR p_body IS NULL OR length(btrim(p_body)) NOT BETWEEN 1 AND 4000 OR p_priority IS NULL OR p_priority NOT IN ('NORMAL','IMPORTANT') OR p_ack_required IS NULL OR p_target_kind IS NULL OR p_target_kind NOT IN ('ALL','USER') THEN RAISE EXCEPTION 'INVALID_ANNOUNCEMENT_INPUT' USING ERRCODE='22023'; END IF;
 SELECT coalesce(array_agg(DISTINCT u ORDER BY u),'{}') INTO v_users FROM unnest(p_user_ids) u;
 IF array_position(v_users,NULL) IS NOT NULL OR cardinality(v_users)>500 OR (p_target_kind='ALL' AND cardinality(v_users)>0) OR (p_target_kind='USER' AND cardinality(v_users)=0) THEN RAISE EXCEPTION 'INVALID_ANNOUNCEMENT_TARGET' USING ERRCODE='22023'; END IF;
 v_payload:=jsonb_build_object('title',btrim(p_title),'body',btrim(p_body),'priority',p_priority,'ack',p_ack_required,'kind',p_target_kind,'users',v_users,'expires',p_expires_at);
 PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':'||p_request_id::text,0));
 IF EXISTS(SELECT 1 FROM public.announcement_deleted_requests WHERE author_id=auth.uid() AND request_id=p_request_id) THEN
 RAISE EXCEPTION 'ANNOUNCEMENT_REQUEST_DELETED' USING ERRCODE='P0001';
 END IF;
 SELECT id,request_payload INTO v_id,v_existing FROM public.announcements WHERE author_id=auth.uid() AND request_id=p_request_id;
 IF FOUND THEN
 IF v_existing<>v_payload THEN RAISE EXCEPTION 'REQUEST_ID_PAYLOAD_MISMATCH' USING ERRCODE='22023'; END IF;
 RETURN v_id;
 END IF;
 IF p_expires_at IS NOT NULL AND (NOT isfinite(p_expires_at) OR p_expires_at<=now()) THEN RAISE EXCEPTION 'INVALID_EXPIRY' USING ERRCODE='22023'; END IF;
 IF p_target_kind='USER' AND EXISTS(SELECT 1 FROM unnest(v_users) u WHERE NOT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=u AND p.is_active AND p.account_status='active')) THEN RAISE EXCEPTION 'INACTIVE_OR_UNKNOWN_TARGET' USING ERRCODE='22023'; END IF;
 INSERT INTO public.announcements(title,body,priority,ack_required,author_id,request_id,request_payload,expires_at) VALUES(btrim(p_title),btrim(p_body),p_priority,p_ack_required,auth.uid(),p_request_id,v_payload,p_expires_at) RETURNING id INTO v_id;
 IF p_target_kind='ALL' THEN INSERT INTO public.announcement_targets(announcement_id,target_kind) VALUES(v_id,'ALL');
 ELSE INSERT INTO public.announcement_targets(announcement_id,target_kind,target_user_id) SELECT v_id,'USER',unnest(v_users); END IF;
 INSERT INTO public.notification_events(event_type,source_kind,source_id,dedupe_key,payload,state,processed_at) VALUES('ANNOUNCEMENT_PUBLISHED','announcement',v_id,'announcement:'||v_id::text||':published',jsonb_build_object('announcement_id',v_id),'processed',now()) RETURNING id INTO v_event;
 INSERT INTO public.notifications(event_id,recipient_id,announcement_id,category,title,message,deep_link_type,deep_link_id,expires_at)
 SELECT v_event,p.id,v_id,'ANNOUNCEMENT',btrim(p_title),btrim(p_body),'ANNOUNCEMENT',v_id,p_expires_at FROM public.profiles p WHERE p.is_active AND p.account_status='active' AND ((p_target_kind='ALL' AND p.id<>auth.uid()) OR (p_target_kind='USER' AND p.id=ANY(v_users)));
 RETURN v_id;
END $function$;

CREATE FUNCTION public.delete_announcement_v1(p_announcement_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_author uuid; v_request uuid; v_recipients uuid[];
BEGIN
 IF NOT public.notification_has_capability_v1('ANNOUNCEMENT_PUBLISH') THEN
 RAISE EXCEPTION 'ANNOUNCEMENT_DELETE_FORBIDDEN' USING ERRCODE='42501';
 END IF;
 SELECT author_id,request_id INTO v_author,v_request FROM public.announcements WHERE id=p_announcement_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ANNOUNCEMENT_NOT_FOUND' USING ERRCODE='P0002'; END IF;
 IF v_author<>auth.uid() THEN RAISE EXCEPTION 'ANNOUNCEMENT_DELETE_FORBIDDEN' USING ERRCODE='42501'; END IF;
 -- Serialize with publish before installing the barrier: no retry can cross the cleanup gap.
 PERFORM pg_advisory_xact_lock(hashtextextended(v_author::text||':'||v_request::text,0));
 SELECT coalesce(array_agg(DISTINCT recipient_id ORDER BY recipient_id),'{}'::uuid[]) INTO v_recipients FROM public.notifications WHERE announcement_id=p_announcement_id;
 INSERT INTO public.announcement_deleted_requests(author_id,request_id) VALUES(v_author,v_request);
 DELETE FROM public.notifications WHERE announcement_id=p_announcement_id;
 DELETE FROM public.announcement_targets WHERE announcement_id=p_announcement_id;
 DELETE FROM public.notification_events WHERE source_kind='announcement' AND source_id=p_announcement_id;
 DELETE FROM public.announcements WHERE id=p_announcement_id;
 -- Stable ordering also avoids cross-recipient lock inversion between concurrent deletes.
 INSERT INTO public.notification_inbox_revisions(recipient_id,revision,updated_at)
 SELECT recipient,1,statement_timestamp() FROM unnest(v_recipients) recipient ORDER BY recipient
 ON CONFLICT (recipient_id) DO UPDATE
 SET revision=public.notification_inbox_revisions.revision+1,
     updated_at=statement_timestamp();
END $$;
REVOKE ALL ON FUNCTION public.delete_announcement_v1(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.delete_announcement_v1(uuid) TO authenticated;
COMMIT;
