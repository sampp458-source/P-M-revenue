import {daycareOperationalStatus} from './daycareOperationalStatus';
import { useRef, useState } from "react";
import { CalendarDays, CheckCircle2, LogIn, LogOut, Pencil, X } from "lucide-react";
import { Badge, Button, Card, EmptyState, Field, Input, Modal, ModalActions, ResponsiveActionGroup, Select } from "../components/ui";
import type { HotelOperationsSnapshot } from "./hotelOperationsRepository";
import { DaycareReservationModal } from "./DaycareReservationModal";
import {
  assignDaycareRoom,
  cancelDaycareReservation,
  completeDaycareCheckIn,
  completeDaycareCheckOut,
  recordVerifiedDaycareVisit,
  administrativelyReleaseDaycareOccupancy,
  unassignDaycareRoom,
  type DaycareReservation,
} from "./daycareOperationsRepository";


const displayActualTime = (value: string | null | undefined) => value && Number.isFinite(Date.parse(value))
  ? `${new Intl.DateTimeFormat("ko-KR", {timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(new Date(value))} KST` : "미확인";
const toIso = (local: string) => new Date(`${local}:00+09:00`).toISOString();

export function DaycareOperationsPanel({
  reservations,
  snapshot,
  onChanged,
  historicalOnly = false,
  canAdminReconcile = false,
}: {
  historicalOnly?: boolean;
  canAdminReconcile?: boolean;
  reservations: readonly DaycareReservation[];
  snapshot: HotelOperationsSnapshot;
  onChanged: (reservation?: DaycareReservation) => void | Promise<void>;
}) {
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<DaycareReservation | null>(null);
  const [cancelTarget, setCancelTarget] = useState<DaycareReservation | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [times, setTimes] = useState<Record<string, { entry: string; exit: string; confirmed: boolean }>>({});
  const [reconciliation, setReconciliation] = useState<Record<string, {reason:string;evidence:string;approval:string;confirmed:boolean}>>({});
  const reconcileInput = (id:string, patch:Partial<{reason:string;evidence:string;approval:string;confirmed:boolean}>) => setReconciliation(previous=>({...previous,[id]:{...(previous[id] ?? {reason:"",evidence:"",approval:"",confirmed:false}),...patch}}));
  const pendingRef = useRef(false);
  const attempts = useRef<Record<string, { payload: string; requestId: string }>>({});
  const changeTime = (id: string, patch: Partial<{entry:string;exit:string;confirmed:boolean}>) => setTimes(previous => ({...previous,[id]:{...(previous[id] ?? {entry:"",exit:"",confirmed:false}),...patch}}));

  const run = async (
    reservation: DaycareReservation,
    action: () => Promise<DaycareReservation>,
  ) => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setProcessingId(reservation.operationScheduleId);
    setError("");
    try {
      await onChanged(await action());
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Daycare 작업을 처리하지 못했습니다.");
      await onChanged();
    } finally {
      pendingRef.current = false;
      setProcessingId(null);
    }
  };

  return (
    <Card className="mb-4 overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-4 sm:px-5">
        <div>
          <div className="flex items-center gap-2"><CalendarDays size={18} className="text-cyan-700" /><h2 className="font-extrabold text-text-primary">오늘 Daycare</h2></div>
          <p className="mt-1 text-xs text-text-muted">예약·호실 배정·입실·퇴실을 한 곳에서 처리합니다.</p>
        </div>
        <Badge tone="blue">{reservations.filter((item) => item.lifecycleStatus !== "cancelled").length}건</Badge>
      </div>
      <div className="space-y-3 p-4 sm:p-5">
        {error ? <p role="alert" className="rounded-xl bg-error-soft px-3 py-2 text-sm font-medium text-error">{error}</p> : null}
        {!reservations.length ? <EmptyState compact title="선택한 날짜의 Daycare 예약이 없습니다." /> : reservations.map((reservation) => {
          const rooms = snapshot.rooms.filter((room) => room.isActive && room.roomTypeId === reservation.roomTypeId);
          const processing = processingId !== null;
          const actual = times[reservation.operationScheduleId] ?? {entry:"",exit:"",confirmed:false};
          const entry = actual.entry ? Date.parse(`${actual.entry}:00+09:00`) : NaN;
          const exit = actual.exit ? Date.parse(`${actual.exit}:00+09:00`) : NaN;
          const validEntry = Number.isFinite(entry) && entry <= Date.now() && actual.entry.slice(0,10) === new Intl.DateTimeFormat("en-CA", {timeZone:"Asia/Seoul"}).format(new Date(reservation.startsAt)) && entry < Date.parse(reservation.endsAt);
          const repair = reconciliation[reservation.operationScheduleId] ?? {reason:"",evidence:"",approval:"",confirmed:false};
          const validExit = Number.isFinite(exit) && exit <= Date.now() && exit > (reservation.checkedInAt ? Date.parse(reservation.checkedInAt) : entry);
          return (
            <article key={reservation.operationScheduleId} className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><div className="flex flex-wrap items-center gap-2"><strong className="text-base text-text-primary">{reservation.dog.name}</strong><Badge tone="blue">데이케어</Badge></div><p className="mt-1 text-sm text-text-secondary">{reservation.roomTypeCode} · {new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(reservation.startsAt))}–{new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(reservation.endsAt))} · {reservation.roomAllocation?.roomName ?? "호실 미배정"}</p></div>
                <Badge tone={reservation.lifecycleStatus === "completed" ? "gray" : reservation.lifecycleStatus === "cancelled" ? "red" : reservation.lifecycleStatus === "checked_in" ? "green" : "blue"}>{daycareOperationalStatus(reservation)?.label ?? '입퇴실 확인 필요'}</Badge>
              </div>
              {reservation.lifecycleStatus === "administratively_released" ? <p className="mt-3 text-sm text-text-secondary">원본 입실 {displayActualTime(reservation.checkedInAt)} · 실제 퇴실시각 미확정 · 행정 해제 {displayActualTime(reservation.administrativeRelease?.releasedAt)}. 일정 업무 완료와 별개입니다.</p> : null}
              {reservation.lifecycleStatus === "scheduled" ? <div className="mt-4 space-y-3">
                <p className="text-sm text-text-secondary">확인된 실제 시각만 입력하세요. 예정·현재 시각으로 자동 대체하지 않습니다. 시각을 모르면 확인 필요 상태로 유지하세요.</p>
                <Field label={`${reservation.dog.name} 실제 입실 시각`}><Input type="datetime-local" disabled={processing} value={actual.entry} onChange={e=>changeTime(reservation.operationScheduleId,{entry:e.target.value,confirmed:false})}/></Field>
                <Field label={`${reservation.dog.name} 실제 퇴실 시각 (사후 기록)`}><Input type="datetime-local" disabled={processing} value={actual.exit} onChange={e=>changeTime(reservation.operationScheduleId,{exit:e.target.value,confirmed:false})}/></Field>
                <label className="flex gap-2 text-sm"><input type="checkbox" disabled={processing} checked={actual.confirmed} onChange={e=>changeTime(reservation.operationScheduleId,{confirmed:e.target.checked})}/>실제 이용 및 입력한 시각을 확인했습니다.</label>
                {actual.confirmed && validEntry && validExit ? <p role="status">{reservation.dog.name} · {reservation.roomAllocation?.roomName} · 실제 이용 {actual.entry} → {actual.exit} KST. 직원 처리 시각은 서버에 별도로 기록됩니다.</p> : null}
                <Button disabled={processing || !actual.confirmed || !validEntry || !validExit || !reservation.roomAllocation} onClick={()=>void run(reservation,()=>{
                  const payload=JSON.stringify([reservation.version,actual.entry,actual.exit]);
                  const key=reservation.operationScheduleId;
                  if(attempts.current[key]?.payload!==payload) attempts.current[key]={payload,requestId:crypto.randomUUID()};
                  return recordVerifiedDaycareVisit(key,reservation.version,toIso(actual.entry),toIso(actual.exit),actual.confirmed,attempts.current[key].requestId);
                })}>확인한 이용 기록 등록</Button>
                {!historicalOnly ? <><div className="max-w-sm"><Field label="호실"><Select aria-label={`${reservation.dog.name} Daycare 호실`} disabled={processing} value={reservation.roomAllocation?.roomId ?? ""} onChange={(event) => {
                  const roomId = event.target.value;
                  void run(reservation, () => roomId
                    ? assignDaycareRoom(reservation.operationScheduleId, reservation.version, roomId)
                    : unassignDaycareRoom(reservation.operationScheduleId, reservation.version));
                }}><option value="">미배정</option>{rooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}</Select></Field></div>
                <ResponsiveActionGroup
                  primary={reservation.roomAllocation ? <Button disabled={processing || !actual.confirmed || !validEntry || Boolean(actual.exit)} onClick={() => void run(reservation, () => completeDaycareCheckIn(reservation.operationScheduleId, reservation.version, toIso(actual.entry)))}><LogIn size={15} /> 입실 완료</Button> : undefined}
                  secondary={<Button variant="secondary" disabled={processing} onClick={() => setEditing(reservation)}><Pencil size={15} /> 수정</Button>}
                  destructive={<Button variant="danger" disabled={processing} onClick={() => { setCancelTarget(reservation); setCancelReason(""); }}><X size={15} /> 예약 취소</Button>}
                /></> : null}
              </div> : null}
              {reservation.lifecycleStatus === "checked_in" && !historicalOnly ? <div className="mt-4 space-y-3"><div className="max-w-sm"><Field label={`${reservation.dog.name} 실제 퇴실 시간`}><Input type="datetime-local" value={actual.exit} onChange={(event) => changeTime(reservation.operationScheduleId,{exit:event.target.value,confirmed:false})} /></Field><label><input type="checkbox" checked={actual.confirmed} onChange={e=>changeTime(reservation.operationScheduleId,{confirmed:e.target.checked})}/>실제 퇴실 시각을 확인했습니다.</label></div><ResponsiveActionGroup primary={<Button disabled={processing || !actual.confirmed || !validExit} onClick={() => void run(reservation, () => completeDaycareCheckOut(reservation.operationScheduleId, reservation.version, toIso(actual.exit)))}><LogOut size={15} /> 퇴실 완료</Button>} /></div> : null}
              {reservation.lifecycleStatus === "checked_in" && historicalOnly ? <p className="mt-3 text-sm">실제 퇴실 시각을 확인한 후 현재 운영 화면의 미퇴실 목록에서 처리하세요. 시각 미확인은 그대로 보존합니다.</p> : null}
              {canAdminReconcile && historicalOnly && reservation.lifecycleStatus === "checked_in" ? <section className="mt-4 rounded-xl border border-border p-3" aria-label={`${reservation.dog.name} 관리자 정합성 복구`}>
                <h3 className="font-bold">관리자 행정 점유 해제</h3>
                <p className="mt-2 text-sm">{reservation.dog.name} · {reservation.roomAllocation?.roomName ?? "호실 확인 필요"} · 예약 ID {reservation.operationScheduleId}<br/>원본 입실 {displayActualTime(reservation.checkedInAt)} 보존. 실제 퇴실시각은 미확정으로 남기며, 행정 처리 시각을 실제 퇴실로 저장하지 않습니다.</p>
                <Field label={`${reservation.dog.name} 정정 사유`}><Input disabled={processing} value={repair.reason} onChange={e=>reconcileInput(reservation.operationScheduleId,{reason:e.target.value,confirmed:false})}/></Field>
                <Field label={`${reservation.dog.name} 실제 퇴실 및 현재 공실 확인 근거`}><Input disabled={processing} value={repair.evidence} onChange={e=>reconcileInput(reservation.operationScheduleId,{evidence:e.target.value,confirmed:false})}/></Field>
                <Field label={`${reservation.dog.name} 승인 참조`}><Input disabled={processing} value={repair.approval} onChange={e=>reconcileInput(reservation.operationScheduleId,{approval:e.target.value,confirmed:false})}/></Field>
                <label className="mt-2 flex gap-2 text-sm"><input type="checkbox" disabled={processing} checked={repair.confirmed} onChange={e=>reconcileInput(reservation.operationScheduleId,{confirmed:e.target.checked})}/>대상 반려견의 실제 퇴실과 현재 공실을 확인했으며, 실제 퇴실시각은 미확정임을 승인합니다.</label>
                {repair.confirmed ? <p role="status">{reservation.dog.name} · {reservation.roomAllocation?.roomName} · 행정 해제만 실행합니다. 실제 퇴실시각을 생성하지 않습니다. 실행 후 임의 복구할 수 없습니다.</p> : null}
                <Button className="mt-3" disabled={processing || !repair.confirmed || !repair.reason.trim() || !repair.evidence.trim() || !repair.approval.trim() || !reservation.roomAllocation} onClick={()=>void run(reservation,()=>{
                  const payload=JSON.stringify([reservation.version,reservation.dog.id,repair.reason,repair.evidence,repair.approval]);
                  const key=`admin:${reservation.operationScheduleId}`;
                  if(attempts.current[key]?.payload!==payload) attempts.current[key]={payload,requestId:crypto.randomUUID()};
                  return administrativelyReleaseDaycareOccupancy(reservation.operationScheduleId,reservation.dog.id,reservation.version,repair.reason,repair.evidence,repair.approval,repair.confirmed,attempts.current[key].requestId);
                })}>승인한 행정 점유 해제</Button>
              </section> : null}
              {reservation.lifecycleStatus === "completed" ? <p className="mt-3 flex items-center gap-1.5 text-sm font-semibold text-success"><CheckCircle2 size={16} /> Daycare 이용을 완료했습니다.</p> : null}
            </article>
          );
        })}
      </div>

      <DaycareReservationModal open={editing !== null} reservation={editing} onClose={() => setEditing(null)} onSaved={onChanged} />
      <Modal open={cancelTarget !== null} title="데이케어 예약 취소" description={cancelTarget ? `${cancelTarget.dog.name} · 취소 후 일정은 기록에 남습니다.` : undefined} size="small" onClose={() => setCancelTarget(null)}>
        <Field label="취소 사유" required><Input value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} /></Field>
        <ModalActions><Button variant="secondary" onClick={() => setCancelTarget(null)}>돌아가기</Button><Button variant="danger" disabled={!cancelReason.trim() || processingId !== null} onClick={() => {
          if (!cancelTarget) return;
          void run(cancelTarget, () => cancelDaycareReservation(cancelTarget.operationScheduleId, cancelTarget.version, cancelReason)).then(() => setCancelTarget(null));
        }}>예약 취소</Button></ModalActions>
      </Modal>
    </Card>
  );
}
