-- Append-only repair of one captured UTF-8 audit reason. No business DML.
-- Approved predecessor: 202609180001 (SHA256 1a7f59a449ed4cd12e57bc3c1ee57a637c1b5df408afffe23014956fe8b3451b).
-- Already-approved body is a true no-op; every other unexpected contract fails closed.
BEGIN;
DO $repair$
DECLARE
 target oid := to_regprocedure('public.audit_dog_edit_v2b()');
 before_contract jsonb;
 after_contract jsonb;
 body_hash text;
 body_text text;
BEGIN
 IF target IS NULL OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='audit_dog_edit_v2b') <> 1 THEN
   RAISE EXCEPTION 'STOP_V2B_AUDIT_REPAIR_SIGNATURE';
 END IF;
 SELECT md5(p.prosrc),to_jsonb(p)-ARRAY['prosrc','probin','prosqlbody'] INTO body_hash,before_contract FROM pg_proc p WHERE p.oid=target;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=target AND p.pronargs=0 AND p.proargnames IS NULL
   AND p.proargmodes IS NULL AND p.provariadic=0 AND NOT p.proretset AND p.prokind='f'
   AND p.prorettype='pg_catalog.trigger'::regtype AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql')
   AND p.provolatile='v' AND p.prosecdef AND p.proconfig=ARRAY['search_path=public, pg_temp']::text[]
   AND pg_get_userbyid(p.proowner)='postgres' AND p.proacl=ARRAY['postgres=X/postgres']::aclitem[]) THEN
   RAISE EXCEPTION 'STOP_V2B_AUDIT_REPAIR_METADATA';
 END IF;
 IF to_regclass('public.dog_profile_removal_receipts') IS NULL
   OR to_regprocedure('public.remove_dog_profile(uuid,bigint,text,text,uuid,text)') IS NULL
   OR to_regprocedure('public.preview_dog_profile_removal(uuid)') IS NULL
   OR (SELECT count(*) FROM pg_attribute WHERE attrelid='public.dogs'::regclass AND NOT attisdropped
     AND attname IN ('profile_status','version','profile_status_changed_at','profile_status_changed_by',
       'profile_status_reason','merged_into_dog_id','updated_by')) <> 7
   OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.dogs'::regclass
     AND tgname='dogs_master_audit_v2b' AND tgfoid=target AND tgenabled='O' AND tgtype=17)
   OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.dogs'::regclass
     AND tgname='dogs_lifecycle_metadata_v2b' AND tgenabled='O') THEN
   RAISE EXCEPTION 'STOP_V2B_AUDIT_REPAIR_DEPENDENCY';
 END IF;
 IF body_hash NOT IN ('9e45267b41d50b3bb17b7b8fc5b5ac8c','01674a5ddc93c5467543d0f13e35aa92') THEN
   RAISE EXCEPTION 'STOP_V2B_AUDIT_REPAIR_UNEXPECTED_BODY';
 END IF;
 IF body_hash='9e45267b41d50b3bb17b7b8fc5b5ac8c' THEN
   EXECUTE $approved_definition$
CREATE OR REPLACE FUNCTION public.audit_dog_edit_v2b() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.profile_status=OLD.profile_status THEN
 INSERT INTO public.entity_audit_events(module_code,entity_type,entity_id,action,before_data,after_data,changed_by,change_reason)
 VALUES('shared_master','dog',NEW.id,'updated',to_jsonb(OLD),to_jsonb(NEW),auth.uid(),'Dog Master 정보 수정');
 END IF;
 RETURN NEW;
END $$;
$approved_definition$;
 END IF;
 SELECT p.prosrc,to_jsonb(p)-ARRAY['prosrc','probin','prosqlbody'] INTO body_text,after_contract FROM pg_proc p WHERE p.oid=target;
 IF md5(body_text) IS DISTINCT FROM '01674a5ddc93c5467543d0f13e35aa92'
   OR position('Dog Master 정보 수정' IN body_text)=0
   OR position(chr(65533) IN body_text)>0
   OR after_contract IS DISTINCT FROM before_contract THEN
   RAISE EXCEPTION 'STOP_V2B_AUDIT_REPAIR_POST_ASSERTION';
 END IF;
END $repair$;
COMMIT;
