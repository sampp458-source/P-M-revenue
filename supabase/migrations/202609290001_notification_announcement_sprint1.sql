-- Candidate only: manual SQL release, no migration-history manipulation.
BEGIN;
LOCK TABLE public.profiles, public.operation_memberships IN SHARE MODE;
DO $$ BEGIN
 IF (SELECT count(*) FROM public.operation_memberships m JOIN public.profiles p ON p.id=m.profile_id WHERE m.role='owner' AND m.is_active AND p.is_active AND p.account_status='active')<>1 THEN RAISE EXCEPTION 'STOP_NOTIFICATION_BOOTSTRAP_REQUIRES_ONE_ACTIVE_OWNER'; END IF;
END $$;
CREATE TABLE public.notification_capability_grants (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), profile_id uuid NOT NULL REFERENCES public.profiles(id),
 capability text NOT NULL CHECK(capability IN ('ANNOUNCEMENT_PUBLISH','ANNOUNCEMENT_RECEIPTS_VIEW')),
 active boolean NOT NULL DEFAULT true, granted_by uuid NOT NULL REFERENCES public.profiles(id),
 created_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz, CHECK(active=(revoked_at IS NULL))
);
CREATE UNIQUE INDEX notification_active_capability ON public.notification_capability_grants(profile_id,capability) WHERE active;
CREATE TABLE public.announcements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 100),
 body text NOT NULL CHECK(length(btrim(body)) BETWEEN 1 AND 4000), priority text NOT NULL CHECK(priority IN ('NORMAL','IMPORTANT')), ack_required boolean NOT NULL,
 author_id uuid NOT NULL REFERENCES public.profiles(id), state text NOT NULL DEFAULT 'PUBLISHED' CHECK(state IN ('PUBLISHED','RETRACTED')),
 published_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz, request_id uuid NOT NULL, request_payload jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), retracted_at timestamptz,
 UNIQUE(author_id,request_id), CHECK(expires_at IS NULL OR expires_at>published_at), CHECK((state='RETRACTED')=(retracted_at IS NOT NULL))
);
CREATE INDEX announcement_author_recent ON public.announcements(author_id,created_at DESC);
CREATE TABLE public.announcement_targets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), announcement_id uuid NOT NULL REFERENCES public.announcements(id),
 target_kind text NOT NULL CHECK(target_kind IN ('ALL','USER')), target_user_id uuid REFERENCES public.profiles(id),
 CHECK((target_kind='ALL' AND target_user_id IS NULL) OR (target_kind='USER' AND target_user_id IS NOT NULL))
);
CREATE UNIQUE INDEX announcement_all_once ON public.announcement_targets(announcement_id) WHERE target_kind='ALL';
CREATE UNIQUE INDEX announcement_user_once ON public.announcement_targets(announcement_id,target_user_id) WHERE target_kind='USER';
CREATE TABLE public.notification_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_type text NOT NULL, source_kind text NOT NULL, source_id uuid NOT NULL,
 source_version integer, dedupe_key text NOT NULL UNIQUE, schema_version integer NOT NULL DEFAULT 1 CHECK(schema_version>0),
 payload jsonb NOT NULL DEFAULT '{}', occurred_at timestamptz NOT NULL DEFAULT now(), available_at timestamptz NOT NULL DEFAULT now(),
 state text NOT NULL CHECK(state IN ('pending','processed','failed')), attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
 processed_at timestamptz, last_error text, CHECK((state='processed')=(processed_at IS NOT NULL))
);
CREATE INDEX notification_event_due ON public.notification_events(available_at) WHERE state='pending';
CREATE TABLE public.notifications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid NOT NULL REFERENCES public.notification_events(id),
 recipient_id uuid NOT NULL REFERENCES public.profiles(id), announcement_id uuid REFERENCES public.announcements(id),
 category text NOT NULL, title text NOT NULL, message text NOT NULL,
 deep_link_type text NOT NULL CHECK(deep_link_type='ANNOUNCEMENT'), deep_link_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), read_at timestamptz, acknowledged_at timestamptz,
 popup_presented_at timestamptz, revoked_at timestamptz, expires_at timestamptz,
 UNIQUE(event_id,recipient_id), UNIQUE(announcement_id,recipient_id), CHECK(acknowledged_at IS NULL OR read_at IS NOT NULL)
);
CREATE INDEX notification_inbox_recent ON public.notifications(recipient_id,created_at DESC,id DESC);
CREATE INDEX notification_inbox_unread ON public.notifications(recipient_id,expires_at) WHERE read_at IS NULL AND revoked_at IS NULL;
CREATE FUNCTION public.notification_active_user_v1() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND is_active AND account_status='active');
$$;
CREATE FUNCTION public.notification_has_capability_v1(p_capability text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT public.notification_active_user_v1() AND EXISTS(SELECT 1 FROM public.notification_capability_grants WHERE profile_id=auth.uid() AND capability=p_capability AND active);
$$;
CREATE FUNCTION public.notification_can_read_announcement_v1(p_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT public.notification_active_user_v1() AND EXISTS(SELECT 1 FROM public.announcements a WHERE a.id=p_id AND (
 (a.author_id=auth.uid() AND public.notification_has_capability_v1('ANNOUNCEMENT_PUBLISH')) OR public.notification_has_capability_v1('ANNOUNCEMENT_RECEIPTS_VIEW') OR
 (a.state='PUBLISHED' AND (a.expires_at IS NULL OR a.expires_at>now()) AND EXISTS(SELECT 1 FROM public.notifications n WHERE n.announcement_id=a.id AND n.recipient_id=auth.uid() AND n.revoked_at IS NULL))));
$$;
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcement_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_capability_grants ENABLE ROW LEVEL SECURITY;
-- Own revoked receipts stay selectable for Realtime revocation. Inbox RPC excludes them.
CREATE POLICY notification_self ON public.notifications FOR SELECT TO authenticated USING(recipient_id=auth.uid() AND public.notification_active_user_v1());
CREATE POLICY announcement_read ON public.announcements FOR SELECT TO authenticated USING(public.notification_can_read_announcement_v1(id));
CREATE POLICY announcement_target_manage ON public.announcement_targets FOR SELECT TO authenticated USING(public.notification_has_capability_v1('ANNOUNCEMENT_RECEIPTS_VIEW') OR EXISTS(SELECT 1 FROM public.announcements a WHERE a.id=announcement_id AND a.author_id=auth.uid() AND public.notification_has_capability_v1('ANNOUNCEMENT_PUBLISH')));
CREATE POLICY notification_own_capability ON public.notification_capability_grants FOR SELECT TO authenticated USING(profile_id=auth.uid() AND public.notification_active_user_v1());
REVOKE ALL ON public.announcements,public.announcement_targets,public.notification_events,public.notifications,public.notification_capability_grants FROM PUBLIC,anon,authenticated;
-- The private retry payload contains audience IDs; never expose it through recipient SELECT.
GRANT SELECT(id,title,body,priority,ack_required,author_id,state,published_at,expires_at,created_at,retracted_at) ON public.announcements TO authenticated;
GRANT SELECT ON public.announcement_targets,public.notifications,public.notification_capability_grants TO authenticated;
CREATE FUNCTION public.publish_announcement_v1(p_request_id uuid,p_title text,p_body text,p_priority text,p_ack_required boolean,p_target_kind text,p_user_ids uuid[] DEFAULT '{}',p_expires_at timestamptz DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_id uuid; v_event uuid; v_users uuid[]; v_payload jsonb; v_existing jsonb;
BEGIN
 IF NOT public.notification_has_capability_v1('ANNOUNCEMENT_PUBLISH') THEN RAISE EXCEPTION 'ANNOUNCEMENT_PUBLISH_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF p_request_id IS NULL OR p_title IS NULL OR length(btrim(p_title)) NOT BETWEEN 1 AND 100 OR p_body IS NULL OR length(btrim(p_body)) NOT BETWEEN 1 AND 4000 OR p_priority IS NULL OR p_priority NOT IN ('NORMAL','IMPORTANT') OR p_ack_required IS NULL OR p_target_kind IS NULL OR p_target_kind NOT IN ('ALL','USER') THEN RAISE EXCEPTION 'INVALID_ANNOUNCEMENT_INPUT' USING ERRCODE='22023'; END IF;
 SELECT coalesce(array_agg(DISTINCT u ORDER BY u),'{}') INTO v_users FROM unnest(p_user_ids) u;
 IF array_position(v_users,NULL) IS NOT NULL OR cardinality(v_users)>500 OR (p_target_kind='ALL' AND cardinality(v_users)>0) OR (p_target_kind='USER' AND cardinality(v_users)=0) THEN RAISE EXCEPTION 'INVALID_ANNOUNCEMENT_TARGET' USING ERRCODE='22023'; END IF;
 v_payload:=jsonb_build_object('title',btrim(p_title),'body',btrim(p_body),'priority',p_priority,'ack',p_ack_required,'kind',p_target_kind,'users',v_users,'expires',p_expires_at);
 PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':'||p_request_id::text,0));
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
END $$;
CREATE FUNCTION public.mark_notification_read_v1(p_notification_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NOT public.notification_active_user_v1() THEN RAISE EXCEPTION 'NOTIFICATION_FORBIDDEN' USING ERRCODE='42501'; END IF;
 UPDATE public.notifications SET read_at=coalesce(read_at,now()) WHERE id=p_notification_id AND recipient_id=auth.uid() AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>now());
 IF NOT FOUND THEN RAISE EXCEPTION 'NOTIFICATION_UNAVAILABLE' USING ERRCODE='42501'; END IF;
END $$;
CREATE FUNCTION public.acknowledge_notification_v1(p_notification_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_a uuid;
BEGIN
 IF NOT public.notification_active_user_v1() THEN RAISE EXCEPTION 'NOTIFICATION_FORBIDDEN' USING ERRCODE='42501'; END IF;
 SELECT announcement_id INTO v_a FROM public.notifications WHERE id=p_notification_id AND recipient_id=auth.uid();
 -- Lock order matches retract: announcement, then receipts.
 PERFORM 1 FROM public.announcements WHERE id=v_a AND state='PUBLISHED' AND ack_required AND (expires_at IS NULL OR expires_at>now()) FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ACK_UNAVAILABLE' USING ERRCODE='42501'; END IF;
 UPDATE public.notifications SET read_at=coalesce(read_at,now()),acknowledged_at=coalesce(acknowledged_at,now()) WHERE id=p_notification_id AND recipient_id=auth.uid() AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>now());
 IF NOT FOUND THEN RAISE EXCEPTION 'ACK_UNAVAILABLE' USING ERRCODE='42501'; END IF;
END $$;
CREATE FUNCTION public.mark_notification_popup_presented_v1(p_notification_ids uuid[]) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NOT public.notification_active_user_v1() THEN RAISE EXCEPTION 'NOTIFICATION_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF p_notification_ids IS NULL OR cardinality(p_notification_ids)>100 OR EXISTS(SELECT 1 FROM unnest(p_notification_ids) x WHERE NOT EXISTS(SELECT 1 FROM public.notifications n WHERE n.id=x AND n.recipient_id=auth.uid() AND n.revoked_at IS NULL AND (n.expires_at IS NULL OR n.expires_at>now()))) THEN RAISE EXCEPTION 'INVALID_POPUP_RECEIPTS' USING ERRCODE='42501'; END IF;
 UPDATE public.notifications SET popup_presented_at=coalesce(popup_presented_at,now()) WHERE id=ANY(p_notification_ids) AND recipient_id=auth.uid() AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>now());
END $$;
CREATE FUNCTION public.retract_announcement_v1(p_announcement_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NOT public.notification_has_capability_v1('ANNOUNCEMENT_PUBLISH') THEN RAISE EXCEPTION 'ANNOUNCEMENT_PUBLISH_FORBIDDEN' USING ERRCODE='42501'; END IF;
 -- Own publications only; receipt viewing has its own capability.
 UPDATE public.announcements SET state='RETRACTED',retracted_at=coalesce(retracted_at,now()) WHERE id=p_announcement_id AND author_id=auth.uid();
 IF NOT FOUND THEN RAISE EXCEPTION 'ANNOUNCEMENT_UNAVAILABLE' USING ERRCODE='42501'; END IF;
 UPDATE public.notifications SET revoked_at=coalesce(revoked_at,now()) WHERE announcement_id=p_announcement_id;
END $$;
CREATE FUNCTION public.get_notification_inbox_v1(p_offset integer DEFAULT 0,p_unread_only boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_rows jsonb; v_popup jsonb; v_count integer; v_ack integer;
BEGIN
 IF NOT public.notification_active_user_v1() THEN RAISE EXCEPTION 'NOTIFICATION_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF p_offset IS NULL OR p_offset<0 OR p_offset>100000 OR p_unread_only IS NULL THEN RAISE EXCEPTION 'INVALID_PAGE' USING ERRCODE='22023'; END IF;
 SELECT count(*) FILTER(WHERE n.read_at IS NULL),count(*) FILTER(WHERE a.ack_required AND n.acknowledged_at IS NULL) INTO v_count,v_ack FROM public.notifications n JOIN public.announcements a ON a.id=n.announcement_id WHERE n.recipient_id=auth.uid() AND n.revoked_at IS NULL AND (n.expires_at IS NULL OR n.expires_at>now());
 SELECT coalesce(jsonb_agg(x ORDER BY x.created_at DESC,x.id DESC),'[]') INTO v_rows FROM (
 SELECT n.*,a.ack_required,a.priority FROM public.notifications n JOIN public.announcements a ON a.id=n.announcement_id WHERE n.recipient_id=auth.uid() AND n.revoked_at IS NULL AND (n.expires_at IS NULL OR n.expires_at>now()) AND (NOT p_unread_only OR n.read_at IS NULL) ORDER BY n.created_at DESC,n.id DESC LIMIT 50 OFFSET p_offset) x;
 SELECT coalesce(jsonb_agg(x ORDER BY x.created_at DESC,x.id DESC),'[]') INTO v_popup FROM (
 SELECT n.*,a.ack_required,a.priority FROM public.notifications n JOIN public.announcements a ON a.id=n.announcement_id WHERE n.recipient_id=auth.uid() AND n.revoked_at IS NULL AND (n.expires_at IS NULL OR n.expires_at>now()) AND ((a.ack_required AND n.acknowledged_at IS NULL) OR (NOT a.ack_required AND n.popup_presented_at IS NULL AND n.read_at IS NULL)) ORDER BY n.created_at DESC,n.id DESC LIMIT 20) x;
 RETURN jsonb_build_object('items',v_rows,'popup',v_popup,'unread_count',v_count,'unacknowledged_count',v_ack,'can_publish',public.notification_has_capability_v1('ANNOUNCEMENT_PUBLISH'),'can_view_receipts',public.notification_has_capability_v1('ANNOUNCEMENT_RECEIPTS_VIEW'));
END $$;
CREATE FUNCTION public.get_notification_detail_v1(p_notification_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result jsonb;
BEGIN
 IF NOT public.notification_active_user_v1() THEN RAISE EXCEPTION 'NOTIFICATION_FORBIDDEN' USING ERRCODE='42501'; END IF;
 SELECT to_jsonb(x) INTO result FROM (SELECT n.*,a.ack_required,a.priority FROM public.notifications n JOIN public.announcements a ON a.id=n.announcement_id WHERE n.id=p_notification_id AND n.recipient_id=auth.uid() AND n.revoked_at IS NULL AND (n.expires_at IS NULL OR n.expires_at>now())) x;
 RETURN result;
END $$;
CREATE FUNCTION public.get_announcement_targets_v1() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NOT public.notification_has_capability_v1('ANNOUNCEMENT_PUBLISH') THEN RAISE EXCEPTION 'ANNOUNCEMENT_PUBLISH_FORBIDDEN' USING ERRCODE='42501'; END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'name',name) ORDER BY name,id) FROM public.profiles WHERE is_active AND account_status='active'),'[]');
END $$;
CREATE FUNCTION public.get_sent_announcements_v1(p_offset integer DEFAULT 0) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NOT public.notification_has_capability_v1('ANNOUNCEMENT_PUBLISH') THEN RAISE EXCEPTION 'ANNOUNCEMENT_PUBLISH_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF p_offset IS NULL OR p_offset<0 OR p_offset>100000 THEN RAISE EXCEPTION 'INVALID_PAGE' USING ERRCODE='22023'; END IF;
 RETURN coalesce((SELECT jsonb_agg(x ORDER BY x.created_at DESC,x.id DESC) FROM (SELECT a.id,a.title,a.body,a.priority,a.ack_required,a.state,a.published_at,a.expires_at,a.created_at,
 CASE WHEN public.notification_has_capability_v1('ANNOUNCEMENT_RECEIPTS_VIEW') THEN (SELECT jsonb_build_object('total',count(*),'read',count(*) FILTER(WHERE n.read_at IS NOT NULL),'ack',count(*) FILTER(WHERE n.acknowledged_at IS NOT NULL),'unack',count(*) FILTER(WHERE n.acknowledged_at IS NULL)) FROM public.notifications n WHERE n.announcement_id=a.id) ELSE NULL END AS stats
 FROM public.announcements a WHERE a.author_id=auth.uid() ORDER BY a.created_at DESC,a.id DESC LIMIT 50 OFFSET p_offset) x),'[]');
END $$;
CREATE FUNCTION public.get_announcement_receipts_v1(p_announcement_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NOT public.notification_has_capability_v1('ANNOUNCEMENT_RECEIPTS_VIEW') THEN RAISE EXCEPTION 'ANNOUNCEMENT_RECEIPTS_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.announcements WHERE id=p_announcement_id) THEN RAISE EXCEPTION 'ANNOUNCEMENT_UNAVAILABLE' USING ERRCODE='22023'; END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('recipient_id',n.recipient_id,'name',p.name,'active',p.is_active AND p.account_status='active','read_at',n.read_at,'acknowledged_at',n.acknowledged_at,'revoked_at',n.revoked_at) ORDER BY p.name,p.id) FROM public.notifications n JOIN public.profiles p ON p.id=n.recipient_id WHERE n.announcement_id=p_announcement_id),'[]');
END $$;
INSERT INTO public.notification_capability_grants(profile_id,capability,granted_by)
SELECT m.profile_id,c,m.profile_id FROM public.operation_memberships m JOIN public.profiles p ON p.id=m.profile_id CROSS JOIN unnest(ARRAY['ANNOUNCEMENT_PUBLISH','ANNOUNCEMENT_RECEIPTS_VIEW']) c WHERE m.role='owner' AND m.is_active AND p.is_active AND p.account_status='active';
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT oid::regprocedure AS sig FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('notification_active_user_v1','notification_has_capability_v1','notification_can_read_announcement_v1','publish_announcement_v1','mark_notification_read_v1','acknowledge_notification_v1','mark_notification_popup_presented_v1','retract_announcement_v1','get_notification_inbox_v1','get_notification_detail_v1','get_announcement_targets_v1','get_sent_announcements_v1','get_announcement_receipts_v1') LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.sig);
 EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',f.sig);
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN RAISE EXCEPTION 'STOP_REALTIME_PUBLICATION_MISSING'; END IF;
END $$;
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
COMMIT;
