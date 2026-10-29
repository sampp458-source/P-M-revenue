begin;
do $$
begin
 if (select md5(prosrc) from pg_proc where oid='public.update_daycare_reservation(uuid,integer,uuid,uuid,uuid,uuid,date,time,time,uuid,uuid,uuid[],text,uuid)'::regprocedure) is distinct from 'd4b3be35343749acde33dc881ca6c2bc'
 or (select md5(prosrc) from pg_proc where oid='public.record_verified_daycare_visit_v1(uuid,integer,timestamptz,timestamptz,uuid,boolean)'::regprocedure) is distinct from '9a79ff266f6d068e4ec1cf9e654516a6' then
 raise exception 'STOP_ATOMIC_VISIT_PREDECESSOR'; end if;
end;
$$;
-- Compose the existing commands, without changing their guards or inventing times.
-- Install independently BEFORE the optional pre-entry historical-proof migration.
create function public.reconcile_verified_daycare_visit_v1(
 p_operation_schedule_id uuid,p_expected_version integer,
 p_checked_in_at timestamptz,p_checked_out_at timestamptz,
 p_reason text,p_evidence text,p_request_id uuid,p_confirmed boolean
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
 actor uuid:=auth.uid(); d public.daycare_operation_states%rowtype;
 s public.operation_schedules%rowtype; payload jsonb; booking jsonb; result jsonb;
 assignees uuid[]; service_day date;
begin
 if actor is null or not public.is_admin() or not public.is_active_operation_member()
 or not public.can_operate_hotel() or not public.can_manage_operation_schedule(p_operation_schedule_id) then
 raise exception '관리자 호텔 정합성 복구 권한이 필요합니다.' using errcode='42501'; end if;
 if p_confirmed is distinct from true or p_expected_version is null or p_request_id is null
 or nullif(btrim(p_reason),'') is null or nullif(btrim(p_evidence),'') is null
 or length(p_reason)>1000 or length(p_evidence)>2000
 or p_checked_in_at is null or p_checked_out_at is null
 or not isfinite(p_checked_in_at) or not isfinite(p_checked_out_at)
 or p_checked_in_at>=p_checked_out_at or p_checked_out_at>statement_timestamp() then
 raise exception '확인한 실제 이용 시각, 사유, 근거, 버전과 요청 ID가 필요합니다.' using errcode='22023'; end if;
 payload:=jsonb_build_object('scheduleId',p_operation_schedule_id,'expectedVersion',p_expected_version,
 'checkedInAt',p_checked_in_at,'checkedOutAt',p_checked_out_at,'reason',btrim(p_reason),'evidence',btrim(p_evidence),'confirmed',p_confirmed);
 perform pg_advisory_xact_lock(hashtextextended('daycare-request:'||p_request_id::text,0));
 select * into d from public.daycare_operation_states where operation_schedule_id=p_operation_schedule_id for update;
 if not found then raise exception 'Daycare 예약을 확인할 수 없습니다.' using errcode='P0002'; end if;
 if public.daycare_request_replayed_internal(p_operation_schedule_id,p_request_id,'verified_visit_reconciliation',payload) then
 return public.daycare_reservation_json(p_operation_schedule_id); end if;
 select * into s from public.operation_schedules where id=p_operation_schedule_id for update;
 if not found or s.archived_at is not null then raise exception '활성 Daycare 일정을 확인할 수 없습니다.' using errcode='P0002'; end if;
 if d.version is distinct from p_expected_version then raise exception '다른 사용자가 먼저 Daycare 예약을 변경했습니다.' using errcode='PT409'; end if;
 if d.schedule_version is distinct from s.version then raise exception 'VERSION_DESYNC' using errcode='PT409'; end if;
 if d.lifecycle_status<>'scheduled' or s.status<>'scheduled' or d.checked_in_at is not null or d.checked_out_at is not null then
 raise exception '미처리 예약만 사후 이용 기록이 가능합니다.' using errcode='22023'; end if;
 service_day:=(s.starts_at at time zone 'Asia/Seoul')::date;
 if (p_checked_in_at at time zone 'Asia/Seoul')::date<>service_day
 or (p_checked_out_at at time zone 'Asia/Seoul')::date<>service_day then
 raise exception '기존 서비스 날짜 안의 확인된 이용 구간이 필요합니다.' using errcode='22023'; end if;
 if (select count(*) from public.hotel_capacity_reservations where daycare_schedule_id=s.id and archived_at is null and source_kind='daycare')<>1
 or (select count(*) from public.hotel_room_allocations a join public.hotel_capacity_reservations c on c.id=a.capacity_reservation_id where c.daycare_schedule_id=s.id and c.archived_at is null and a.archived_at is null)<>1 then
 raise exception '단일 활성 Capacity와 객실 배정이 필요합니다.' using errcode='22023'; end if;
 booking:=public.daycare_reservation_json(s.id);
 select coalesce(array_agg((a->>'id')::uuid order by a->>'id'),'{}'::uuid[]) into assignees
 from jsonb_array_elements(booking->'assignees') a;
 result:=public.update_daycare_reservation(s.id,d.version,s.calendar_id,s.schedule_type_id,
 (booking#>>'{customer,id}')::uuid,(booking#>>'{dog,id}')::uuid,service_day,
 (p_checked_in_at at time zone 'Asia/Seoul')::time,(p_checked_out_at at time zone 'Asia/Seoul')::time,
 (booking->>'roomTypeId')::uuid,(booking#>>'{roomAllocation,roomId}')::uuid,assignees,s.description,
 public.daycare_child_request_id_internal(p_request_id,'verified-plan'));
 result:=public.record_verified_daycare_visit_v1(s.id,(result->>'version')::integer,p_checked_in_at,p_checked_out_at,
 public.daycare_child_request_id_internal(p_request_id,'verified-visit'),true);
 -- Preserve root evidence, actor and idempotency through the canonical audit helper.
 perform public.daycare_append_request_internal(s.id,p_request_id,'verified_visit_reconciliation',payload,actor,
 '확인된 이용 구간 정합성 복구: '||btrim(p_reason)||' / 근거: '||btrim(p_evidence));
 return public.daycare_reservation_json(s.id);
end;
$$;
alter function public.reconcile_verified_daycare_visit_v1(uuid,integer,timestamptz,timestamptz,text,text,uuid,boolean) owner to postgres;
revoke all on function public.reconcile_verified_daycare_visit_v1(uuid,integer,timestamptz,timestamptz,text,text,uuid,boolean) from public,anon,service_role;
grant execute on function public.reconcile_verified_daycare_visit_v1(uuid,integer,timestamptz,timestamptz,text,text,uuid,boolean) to authenticated;
commit;
