begin;
-- No business data mutation. Preserve full evidence equality; use the existing Audit PK.
do $$ begin
 if (select md5(prosrc) from pg_proc where oid='public.hotel_transfer_boundary_correction_proven_v1(jsonb,jsonb,jsonb)'::regprocedure) is distinct from 'ca0b1b6aa3f2bbef335697e248a65b94'
 or (select md5(prosrc) from pg_proc where oid='public.correct_dust_transfer_20261107_v1(uuid,boolean)'::regprocedure) is distinct from 'fc2a4d4d1eea2c304609ba0aa88d9d18'
 or (select md5(prosrc) from pg_proc where oid='public.hotel_history_individual_010(jsonb)'::regprocedure) is distinct from '6ae2f0cfdab061858de6294b37d8a8bc'
 or to_regprocedure('public.get_dust_correction_request_state_v1(uuid)') is not null then
 raise exception 'DUST_TIMEOUT_PREDECESSOR_MISMATCH'; end if;
 if not exists(select 1 from pg_constraint where conrelid='public.entity_audit_events'::regclass and contype='p' and conkey=array[(select attnum from pg_attribute where attrelid='public.entity_audit_events'::regclass and attname='id')]) then
 raise exception 'DUST_AUDIT_PRIMARY_KEY_REQUIRED'; end if;
end $$;
create or replace function public.hotel_transfer_boundary_correction_proven_v1(p jsonb,a jsonb,e jsonb)
returns boolean language plpgsql stable security definer set search_path=public,pg_temp as $$
declare r public.hotel_transfer_boundary_correction_receipts_v1%rowtype;
 b jsonb; z jsonb; old_a jsonb; new_a jsonb; original_from timestamptz; corrected timestamptz;
begin
 if auth.uid() is null or not public.is_active_operation_member() or p->>'kind' is distinct from 'single' then return false; end if;
 select * into r from public.hotel_transfer_boundary_correction_receipts_v1
 where hotel_stay_id=(p->'stay'->>'id')::uuid and new_allocation_id=(a->>'id')::uuid;
 if not found then return false; end if;
 b:=r.before_snapshot; z:=r.after_snapshot; old_a:=z->'oldAllocation'; new_a:=z->'newAllocation';
 original_from:=(z#>>'{proof,oldBoundary}')::timestamptz;
 corrected:=(z#>>'{proof,correctedBoundary}')::timestamptz;
 -- Exact server receipt, not a reason string or caller-supplied correction event.
 if z->>'operation' is distinct from 'dust_transfer_20261107_v1'
 or z->>'actor' is distinct from r.actor_id::text
 or r.correction_audit->>'request_id' is distinct from r.request_id::text
 or r.correction_audit->>'changed_by' is distinct from r.actor_id::text
 or r.correction_audit->>'entity_id' is distinct from r.hotel_stay_id::text
 or r.correction_audit->>'entity_type' is distinct from 'hotel_transfer_boundary_correction'
 or r.correction_audit->'before_data' is distinct from b
 or r.correction_audit->'after_data' is distinct from z
 or not exists(select 1 from public.entity_audit_events x where x.id=(r.correction_audit->>'id')::uuid and to_jsonb(x)=r.correction_audit)
 or p->'stay' is distinct from b->'stay'
 or a is distinct from new_a
 or old_a->>'id' is distinct from r.old_allocation_id::text
 or new_a->>'id' is distinct from r.new_allocation_id::text
 or (old_a->>'allocated_until')::timestamptz is distinct from corrected
 or (new_a->>'allocated_from')::timestamptz is distinct from corrected
 or (b#>>'{oldAllocation,allocated_until}')::timestamptz is distinct from original_from
 or (b#>>'{newAllocation,allocated_from}')::timestamptz is distinct from original_from
 or original_from is null or corrected is null or corrected>=original_from
 or not (coalesce(p->'allocations','[]') @> jsonb_build_array(old_a,new_a))
 or jsonb_array_length(p->'allocations')<>2
 or not (coalesce(p->'capacities','[]') @> jsonb_build_array(b->'capacity'))
 or (select to_jsonb(x) from public.hotel_stays x where id=r.hotel_stay_id) is distinct from b->'stay'
 or (select to_jsonb(x) from public.hotel_capacity_reservations x where id=(b#>>'{capacity,id}')::uuid) is distinct from b->'capacity'
 or (select to_jsonb(x) from public.hotel_room_allocations x where id=r.old_allocation_id) is distinct from old_a
 or (select to_jsonb(x) from public.hotel_room_allocations x where id=r.new_allocation_id) is distinct from new_a
 then return false; end if;
 -- Every original audit must remain byte-for-byte JSON-identical in the DB and reader input.
 if jsonb_array_length(r.original_audits)=0
 or not (coalesce(p->'audits','[]') @> r.original_audits)
 or not (r.original_audits @> jsonb_build_array(e))
 or (e#>>'{after_data,allocated_from}')::timestamptz is distinct from original_from
 or exists(select 1 from jsonb_array_elements(r.original_audits) original
 where not exists(select 1 from public.entity_audit_events x where x.id=(original->>'id')::uuid and to_jsonb(x)=original))
 then return false; end if;
 -- Both canonical allocation updates and the original move's three audit links are required.
 if not exists(select 1 from jsonb_array_elements(r.original_audits) x
 where x->>'id'=z#>>'{proof,moveAuditId}' and x->>'entity_id'=r.hotel_stay_id::text
 and x->>'entity_type'='hotel_stays' and x->>'request_id'=z#>>'{proof,moveRequestId}'
 and x->>'created_at'=z#>>'{proof,originalRecordedAt}')
 or not exists(select 1 from jsonb_array_elements(r.original_audits) x
 where x->>'id'=z#>>'{proof,oldAuditId}' and x->>'entity_id'=r.old_allocation_id::text
 and (x#>>'{after_data,allocated_until}')::timestamptz=original_from)
 or not exists(select 1 from jsonb_array_elements(r.original_audits) x
 where x->>'id'=z#>>'{proof,newAuditId}' and x->>'entity_id'=r.new_allocation_id::text
 and (x#>>'{after_data,allocated_from}')::timestamptz=original_from)
 or not exists(select 1 from jsonb_array_elements(p->'audits') x
 where x->>'entity_type'='hotel_room_allocations' and x->>'entity_id'=r.old_allocation_id::text
 and x->'before_data'=b->'oldAllocation' and x->'after_data'=old_a
 and x->>'changed_by'=r.actor_id::text and exists(select 1 from public.entity_audit_events y where y.id=(x->>'id')::uuid and to_jsonb(y)=x))
 or not exists(select 1 from jsonb_array_elements(p->'audits') x
 where x->>'entity_type'='hotel_room_allocations' and x->>'entity_id'=r.new_allocation_id::text
 and x->'before_data'=b->'newAllocation' and x->'after_data'=new_a
 and x->>'changed_by'=r.actor_id::text and exists(select 1 from public.entity_audit_events y where y.id=(x->>'id')::uuid and to_jsonb(y)=x))
 then return false; end if;
 -- A receipt never exempts a later real overlapping allocation or physical occupancy.
 if exists(select 1 from public.hotel_room_allocations x
 join (values(old_a),(new_a)) v(j) on x.room_id=(v.j->>'room_id')::uuid
 where x.id not in(r.old_allocation_id,r.new_allocation_id)
 and x.allocated_from<(v.j->>'allocated_until')::timestamptz
 and x.allocated_until>(v.j->>'allocated_from')::timestamptz)
 or exists(select 1 from public.hotel_physical_occupancies x
 join (values(old_a),(new_a)) v(j) on x.room_id=(v.j->>'room_id')::uuid
 where x.occupied_from<(v.j->>'allocated_until')::timestamptz
 and (case when x.status='active' and x.archived_at is null then 'infinity'::timestamptz
 else x.occupied_until end)>(v.j->>'allocated_from')::timestamptz)
 then return false; end if;
 return true;
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then return false;
end $$;

-- Read-only request outcome, with nonblocking locks shared with the official command.
-- No attempt/receipt is fabricated. Absence alone is NOT enough: all pinned before values
-- and original audit links must remain intact. Never auto-executes the correction.
create function public.get_dust_correction_request_state_v1(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
 actor uuid:=auth.uid();
 s public.hotel_stays%rowtype; c public.hotel_capacity_reservations%rowtype;
 old_a public.hotel_room_allocations%rowtype; new_a public.hotel_room_allocations%rowtype;
 r public.hotel_transfer_boundary_correction_receipts_v1%rowtype;
 stay_id constant uuid:='d8f7de04-4db3-49bb-b9cb-23850e1c283c';
 cap_id constant uuid:='798cbb68-ec89-431d-88de-a8507d11c1c7';
 old_id constant uuid:='d872ca7e-9cc7-4db3-80b7-28385238136b';
 new_id constant uuid:='1486a81c-700b-48db-a356-896174b26bf4';
 root_e public.entity_audit_events%rowtype;
 snapshot_hash text;
begin
 if actor is null or not public.is_admin() or not public.is_active_operation_member() or not public.can_operate_hotel() then
 raise exception '관리자 정정 권한 필요' using errcode='42501'; end if;
 if p_request_id is null then raise exception '요청 ID 필요' using errcode='22023'; end if;
 if not pg_try_advisory_xact_lock(hashtextextended('hotel-request:'||p_request_id::text,0)) then
 return jsonb_build_object('state','in_progress','requestId',p_request_id); end if;
 -- NOWAIT also detects another request touching this event. An unlocked SELECT alone
 -- could otherwise observe pre-commit rows while a correction was still in progress.
 begin
 select * into strict s from public.hotel_stays where id=stay_id for update nowait;
 select * into strict c from public.hotel_capacity_reservations where id=cap_id for update nowait;
 select * into strict old_a from public.hotel_room_allocations where id=old_id for update nowait;
 select * into strict new_a from public.hotel_room_allocations where id=new_id for update nowait;
 exception when lock_not_available then
 return jsonb_build_object('state','in_progress','requestId',p_request_id);
 when no_data_found then return jsonb_build_object('state','unknown','requestId',p_request_id);
 end;
 select * into r from public.hotel_transfer_boundary_correction_receipts_v1 where hotel_stay_id=stay_id;
 if found then
 if r.old_allocation_id=old_id and r.new_allocation_id=new_id
 and r.after_snapshot->>'operation'='dust_transfer_20261107_v1'
 and r.after_snapshot->'oldAllocation'=to_jsonb(old_a) and r.after_snapshot->'newAllocation'=to_jsonb(new_a)
 and r.before_snapshot->'stay'=to_jsonb(s) and r.before_snapshot->'capacity'=to_jsonb(c)
 and r.correction_audit->>'request_id'=r.request_id::text
 and r.correction_audit->'before_data'=r.before_snapshot and r.correction_audit->'after_data'=r.after_snapshot
 and exists(select 1 from public.entity_audit_events e where e.id=(r.correction_audit->>'id')::uuid and to_jsonb(e)=r.correction_audit)
 and old_a.allocated_until=timestamptz '2026-11-07 09:00+09' and new_a.allocated_from=old_a.allocated_until then
 return jsonb_build_object('state','succeeded','requestId',p_request_id,'completedRequestId',r.request_id,'auditId',r.correction_audit->>'id');
 end if;
 return jsonb_build_object('state','unknown','requestId',p_request_id);
 end if;
 if exists(select 1 from public.entity_audit_events where request_id=p_request_id or (entity_type='hotel_transfer_boundary_correction' and entity_id=stay_id)) then
 return jsonb_build_object('state','unknown','requestId',p_request_id); end if;
 if s.version<>6 or s.dog_id<>'505505b5-fc7d-4683-9ce6-cb67ec291b77'::uuid
 or s.checked_in_at is distinct from timestamptz '2026-11-06 21:58+09' or s.checked_out_at is distinct from timestamptz '2026-11-08 16:34+09'
 or s.archived_at is not null or c.version<>3 or c.hotel_stay_id<>stay_id or c.archived_at is not null
 or c.source_kind<>'stay' or c.quantity<>1 or c.shared_room_group_id is not null or c.physical_occupancy_id is not null
 or c.reserved_from is distinct from timestamptz '2026-11-06T10:00:00+00:00' or c.reserved_until is distinct from timestamptz '2026-11-08T09:00:00+00:00'
 or old_a.version<>2 or new_a.version<>3
 or old_a.room_id<>'80b56ae0-1d3d-4a27-80d6-9859bbcf96ae'::uuid or new_a.room_id<>'56bed086-9fb0-46ec-83a0-95dfad265f65'::uuid
 or old_a.capacity_reservation_id<>cap_id or new_a.capacity_reservation_id<>cap_id
 or old_a.archived_at is not null or new_a.archived_at is not null
 or old_a.allocated_from<>s.checked_in_at or new_a.allocated_until<>s.checked_out_at
 or old_a.allocated_until<>timestamptz '2026-11-07 19:35+09' or new_a.allocated_from<>old_a.allocated_until
 or new_a.request_id is distinct from '09fcf996-f224-4b3e-ae20-996f8ea3d94e'::uuid
 or (select count(*) from public.hotel_room_allocations where capacity_reservation_id=cap_id)<>2 then
 return jsonb_build_object('state','unknown','requestId',p_request_id); end if;
 select * into root_e from public.entity_audit_events where id='9dc39c10-d078-4404-b79b-69c7db2008cd';
 if not found or root_e.entity_id<>stay_id or root_e.entity_type<>'hotel_stays'
 or root_e.request_id is distinct from '09fcf996-f224-4b3e-ae20-996f8ea3d94e'::uuid
 or root_e.created_at<>timestamptz '2026-11-07T10:36:00.194645+00:00' or root_e.changed_by is null
 or not exists(select 1 from public.entity_audit_events e where e.id='08825dbd-4d26-4910-b61f-e169d45bfb01' and e.entity_id=old_id and e.entity_type='hotel_room_allocations' and e.action='updated' and e.created_at=root_e.created_at and e.changed_by=root_e.changed_by and (e.after_data->>'allocated_until')::timestamptz=old_a.allocated_until)
 or not exists(select 1 from public.entity_audit_events e where e.id='f7128f44-3703-450b-8182-02c837d8d7d2' and e.entity_id=new_id and e.entity_type='hotel_room_allocations' and e.action='created' and e.created_at=root_e.created_at and e.changed_by=root_e.changed_by and (e.after_data->>'allocated_from')::timestamptz=new_a.allocated_from) then
 return jsonb_build_object('state','unknown','requestId',p_request_id); end if;
 snapshot_hash:=md5(jsonb_build_array(to_jsonb(s),to_jsonb(c),to_jsonb(old_a),to_jsonb(new_a),to_jsonb(root_e))::text);
 return jsonb_build_object('state','not_applied','requestId',p_request_id,'actorId',actor,'snapshotHash',snapshot_hash,
 'operation','dust_transfer_20261107_v1','oldBoundary','2026-11-07T10:35:00Z','correctedBoundary','2026-11-07T00:00:00Z');
end $$;
alter function public.get_dust_correction_request_state_v1(uuid) owner to postgres;
revoke all on function public.get_dust_correction_request_state_v1(uuid) from public,anon,service_role;
grant execute on function public.get_dust_correction_request_state_v1(uuid) to authenticated;
-- Original command, reader, protected receipts, all ACLs and timeouts unchanged.
commit;
