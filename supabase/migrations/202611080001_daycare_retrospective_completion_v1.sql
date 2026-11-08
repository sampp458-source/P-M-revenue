begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $$ begin
 if (select md5(prosrc) from pg_proc where oid=to_regprocedure('public.record_verified_daycare_visit_v1(uuid,integer,timestamptz,timestamptz,uuid,boolean)')) is distinct from '3b06ec2a111a19c44cecc48e6ed31eae' then raise exception 'STOP_RETROSPECTIVE_PREDECESSOR_record_verified_daycare_visit_v1'; end if;
 if (select md5(prosrc) from pg_proc where oid=to_regprocedure('public.update_daycare_reservation(uuid,integer,uuid,uuid,uuid,uuid,date,time,time,uuid,uuid,uuid[],text,uuid)')) is distinct from 'd4b3be35343749acde33dc881ca6c2bc' then raise exception 'STOP_RETROSPECTIVE_PREDECESSOR_update_daycare_reservation'; end if;
 if to_regprocedure('public.complete_retrospective_daycare_visit_v1(uuid,integer,uuid,timestamptz,timestamptz,text,text,uuid,boolean)') is not null then raise exception 'STOP_RETROSPECTIVE_ALREADY_INSTALLED'; end if;
end $$;
-- One new administrator command; existing RPCs/guards are not replaced.
-- Compose the existing commands, without changing their guards or inventing times.
-- Existing commands retain their ACLs and safety checks.
create function public.complete_retrospective_daycare_visit_v1(
 p_operation_schedule_id uuid,p_expected_version integer,p_room_id uuid,
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
 if p_room_id is null or p_confirmed is distinct from true or p_expected_version is null or p_request_id is null
 or nullif(btrim(p_reason),'') is null or nullif(btrim(p_evidence),'') is null
 or length(p_reason)>1000 or length(p_evidence)>2000
 or p_checked_in_at is null or p_checked_out_at is null
 or not isfinite(p_checked_in_at) or not isfinite(p_checked_out_at)
 or p_checked_in_at>=p_checked_out_at or p_checked_out_at>statement_timestamp() then
 raise exception '확인한 실제 이용 시각, 사유, 근거, 버전과 요청 ID가 필요합니다.' using errcode='22023'; end if;
 payload:=jsonb_build_object('scheduleId',p_operation_schedule_id,'expectedVersion',p_expected_version,
 'roomId',p_room_id,'checkedInAt',p_checked_in_at,'checkedOutAt',p_checked_out_at,'reason',btrim(p_reason),'evidence',btrim(p_evidence),'confirmed',p_confirmed);
 perform pg_advisory_xact_lock(hashtextextended('daycare-request:'||p_request_id::text,0));
 select * into d from public.daycare_operation_states where operation_schedule_id=p_operation_schedule_id for update;
 if not found then raise exception 'Daycare 예약을 확인할 수 없습니다.' using errcode='P0002'; end if;
 if public.daycare_request_replayed_internal(p_operation_schedule_id,p_request_id,'retrospective_completion_v1',payload) then
 return public.daycare_reservation_json(p_operation_schedule_id); end if;
 select * into s from public.operation_schedules where id=p_operation_schedule_id for update;
 if not found or s.archived_at is not null then raise exception '활성 Daycare 일정을 확인할 수 없습니다.' using errcode='P0002'; end if;
 if d.version is distinct from p_expected_version then raise exception '다른 사용자가 먼저 Daycare 예약을 변경했습니다.' using errcode='PT409'; end if;
 if d.schedule_version is distinct from s.version then raise exception 'VERSION_DESYNC' using errcode='PT409'; end if;
 if d.lifecycle_status<>'scheduled' or s.status<>'scheduled' or d.checked_in_at is not null or d.checked_out_at is not null then
 raise exception '미처리 예약만 사후 이용 기록이 가능합니다.' using errcode='22023'; end if;
 service_day:=(s.starts_at at time zone 'Asia/Seoul')::date;
 if service_day >= (statement_timestamp() at time zone 'Asia/Seoul')::date then
 raise exception '과거 서비스 날짜만 사후 이용 처리할 수 있습니다.' using errcode='22023'; end if;
 if not exists(select 1 from public.hotel_rooms where id=p_room_id and is_active and room_type_id=d.room_type_id) then
 raise exception '실제 사용한 동일 객실 유형의 호실을 확인해 주세요.' using errcode='22023'; end if;
 if (p_checked_in_at at time zone 'Asia/Seoul')::date<>service_day
 or (p_checked_out_at at time zone 'Asia/Seoul')::date<>service_day then
 raise exception '기존 서비스 날짜 안의 확인된 이용 구간이 필요합니다.' using errcode='22023'; end if;
 if (select count(*) from public.hotel_capacity_reservations where daycare_schedule_id=s.id and archived_at is null and source_kind='daycare')<>1
 or (select count(*) from public.hotel_room_allocations a join public.hotel_capacity_reservations c on c.id=a.capacity_reservation_id where c.daycare_schedule_id=s.id and c.archived_at is null and a.archived_at is null)>1 then
 raise exception '단일 활성 Capacity와 최대 한 개의 유효 배정이 필요합니다.' using errcode='22023'; end if;
 booking:=public.daycare_reservation_json(s.id);
 select coalesce(array_agg((a->>'id')::uuid order by a->>'id'),'{}'::uuid[]) into assignees
 from jsonb_array_elements(booking->'assignees') a;
 result:=public.update_daycare_reservation(s.id,d.version,s.calendar_id,s.schedule_type_id,
 (booking#>>'{customer,id}')::uuid,(booking#>>'{dog,id}')::uuid,service_day,
 (p_checked_in_at at time zone 'Asia/Seoul')::time,(p_checked_out_at at time zone 'Asia/Seoul')::time,
 (booking->>'roomTypeId')::uuid,p_room_id,assignees,s.description,
 public.daycare_child_request_id_internal(p_request_id,'verified-plan'));
 result:=public.record_verified_daycare_visit_v1(s.id,(result->>'version')::integer,p_checked_in_at,p_checked_out_at,
 public.daycare_child_request_id_internal(p_request_id,'verified-visit'),true);
 -- Preserve root evidence, actor and idempotency through the canonical audit helper.
 perform public.daycare_append_request_internal(s.id,p_request_id,'retrospective_completion_v1',payload,actor,
 '확인된 이용 구간 정합성 복구: '||btrim(p_reason)||' / 근거: '||btrim(p_evidence));
 return public.daycare_reservation_json(s.id);
end;
$$;
alter function public.complete_retrospective_daycare_visit_v1(uuid,integer,uuid,timestamptz,timestamptz,text,text,uuid,boolean) owner to postgres;
revoke all on function public.complete_retrospective_daycare_visit_v1(uuid,integer,uuid,timestamptz,timestamptz,text,text,uuid,boolean) from public,anon,service_role;
grant execute on function public.complete_retrospective_daycare_visit_v1(uuid,integer,uuid,timestamptz,timestamptz,text,text,uuid,boolean) to authenticated;
-- Enforce administrator-only historical confirmation even through legacy RPCs.
-- No existing RPC body or occupancy trigger is replaced/disabled.
create function public.guard_retrospective_daycare_admin_v1()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if (new.checked_in_at is distinct from old.checked_in_at
     or new.checked_out_at is distinct from old.checked_out_at
     or (new.lifecycle_status is distinct from old.lifecycle_status and new.lifecycle_status in ('checked_in','completed')))
 and exists(select 1 from public.operation_schedules s where s.id=new.operation_schedule_id
     and (s.starts_at at time zone 'Asia/Seoul')::date<(statement_timestamp() at time zone 'Asia/Seoul')::date)
 and (auth.uid() is null or not public.is_admin() or not public.is_active_operation_member()
     or not public.can_operate_hotel() or not public.can_manage_operation_schedule(new.operation_schedule_id)) then
 raise exception '과거 Daycare 실제 이용 확정에는 관리자 권한이 필요합니다.' using errcode='42501';
 end if;
 return new;
end $$;
alter function public.guard_retrospective_daycare_admin_v1() owner to postgres;
revoke all on function public.guard_retrospective_daycare_admin_v1() from public,anon,authenticated,service_role;
create trigger guard_retrospective_daycare_admin_v1 before update on public.daycare_operation_states
 for each row execute function public.guard_retrospective_daycare_admin_v1();
commit;
