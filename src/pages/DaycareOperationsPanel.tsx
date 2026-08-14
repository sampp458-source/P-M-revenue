import { useState } from "react";
import { CalendarDays, CheckCircle2, LogIn, LogOut, Pencil, X } from "lucide-react";
import { Badge, Button, Card, EmptyState, Field, Input, Modal, ModalActions, Select } from "../components/ui";
import type { HotelOperationsSnapshot } from "./hotelOperationsRepository";
import { DaycareReservationModal } from "./DaycareReservationModal";
import {
  assignDaycareRoom,
  cancelDaycareReservation,
  completeDaycareCheckIn,
  completeDaycareCheckOut,
  unassignDaycareRoom,
  type DaycareReservation,
} from "./daycareOperationsRepository";

const lifecycleLabel: Record<DaycareReservation["lifecycleStatus"], string> = {
  scheduled: "예약",
  checked_in: "이용중",
  completed: "완료",
  cancelled: "취소",
};

const localDateTimeValue = (value = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
};

const toIso = (local: string) => new Date(`${local}:00+09:00`).toISOString();

export function DaycareOperationsPanel({
  reservations,
  snapshot,
  onChanged,
}: {
  reservations: readonly DaycareReservation[];
  snapshot: HotelOperationsSnapshot;
  onChanged: (reservation?: DaycareReservation) => void | Promise<void>;
}) {
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<DaycareReservation | null>(null);
  const [cancelTarget, setCancelTarget] = useState<DaycareReservation | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [actionTime, setActionTime] = useState(localDateTimeValue());

  const run = async (
    reservation: DaycareReservation,
    action: () => Promise<DaycareReservation>,
  ) => {
    setProcessingId(reservation.operationScheduleId);
    setError("");
    try {
      await onChanged(await action());
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Daycare 작업을 처리하지 못했습니다.");
      await onChanged();
    } finally {
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
          const processing = processingId === reservation.operationScheduleId;
          return (
            <article key={reservation.operationScheduleId} className="rounded-2xl border border-cyan-200 bg-cyan-50/45 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><strong className="text-base text-text-primary">{reservation.dog.name} · 데이케어 · {reservation.roomTypeCode}</strong><p className="mt-1 text-sm text-text-secondary">{new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(reservation.startsAt))}–{new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(reservation.endsAt))} · {reservation.roomAllocation?.roomName ?? "호실 미배정"}</p></div>
                <Badge tone={reservation.lifecycleStatus === "completed" ? "green" : reservation.lifecycleStatus === "cancelled" ? "gray" : "blue"}>{lifecycleLabel[reservation.lifecycleStatus]}</Badge>
              </div>
              {reservation.lifecycleStatus === "scheduled" ? <div className="mt-4 flex flex-wrap items-end gap-2">
                <Field label="호실"><Select aria-label={`${reservation.dog.name} Daycare 호실`} disabled={processing} value={reservation.roomAllocation?.roomId ?? ""} onChange={(event) => {
                  const roomId = event.target.value;
                  void run(reservation, () => roomId
                    ? assignDaycareRoom(reservation.operationScheduleId, reservation.version, roomId)
                    : unassignDaycareRoom(reservation.operationScheduleId, reservation.version));
                }}><option value="">미배정</option>{rooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}</Select></Field>
                <Button variant="secondary" disabled={processing} onClick={() => setEditing(reservation)}><Pencil size={15} /> 수정</Button>
                <Button disabled={processing || !reservation.roomAllocation} onClick={() => void run(reservation, () => completeDaycareCheckIn(reservation.operationScheduleId, reservation.version, toIso(actionTime)))}><LogIn size={15} /> 입실 완료</Button>
                <Button variant="danger" disabled={processing} onClick={() => { setCancelTarget(reservation); setCancelReason(""); }}><X size={15} /> 취소</Button>
              </div> : null}
              {reservation.lifecycleStatus === "checked_in" ? <div className="mt-4 flex flex-wrap items-end gap-2"><Field label="실제 퇴실 시간"><Input type="datetime-local" value={actionTime} onChange={(event) => setActionTime(event.target.value)} /></Field><Button disabled={processing} onClick={() => void run(reservation, () => completeDaycareCheckOut(reservation.operationScheduleId, reservation.version, toIso(actionTime)))}><LogOut size={15} /> 퇴실 완료</Button></div> : null}
              {reservation.lifecycleStatus === "completed" ? <p className="mt-3 flex items-center gap-1.5 text-sm font-semibold text-success"><CheckCircle2 size={16} /> Daycare 이용을 완료했습니다.</p> : null}
            </article>
          );
        })}
      </div>

      <DaycareReservationModal open={editing !== null} reservation={editing} onClose={() => setEditing(null)} onSaved={onChanged} />
      <Modal open={cancelTarget !== null} title="Daycare 예약 취소" onClose={() => setCancelTarget(null)}>
        <Field label="취소 사유" required><Input value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} /></Field>
        <ModalActions><Button variant="secondary" onClick={() => setCancelTarget(null)}>돌아가기</Button><Button variant="danger" disabled={!cancelReason.trim() || processingId !== null} onClick={() => {
          if (!cancelTarget) return;
          void run(cancelTarget, () => cancelDaycareReservation(cancelTarget.operationScheduleId, cancelTarget.version, cancelReason)).then(() => setCancelTarget(null));
        }}>예약 취소</Button></ModalActions>
      </Modal>
    </Card>
  );
}
