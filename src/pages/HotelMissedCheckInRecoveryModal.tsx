import { HotelEligibleRoomSurface } from "./HotelEligibleRoomSurface";
import { HotelOperationJourney } from "./HotelOperationJourney";
import { useEffect, useRef, useState } from "react";
import { Button, Field, Input, Modal, ModalActions, Select } from "../components/ui";
import { getHotelMissedCheckInEligibility, type HotelStay, type MissedCheckInEligibility } from "./hotelOperationsRepository";
import { formatHotelScheduleTime } from "./hotelOperationsUi";
import { toSeoulInstant } from "./operationsScheduleRepository";

const reasonMessages: Record<string, string> = {
  RECOVERY_WINDOW_CLOSED: "예약의 객실 확보 기간이 종료되어 이 화면에서 복구할 수 없습니다.",
  INVALID_EFFECTIVE_TIME: "예약 기간 안의 실제 입실 시각을 확인해 주세요. 미래 시각은 사용할 수 없습니다.",
  BEFORE_PLANNED_CHECK_IN: "예정 입실보다 이른 시각은 이 복구 기능에서 지원하지 않습니다.",
  PRIOR_COMPLETION_NOT_RECOVERABLE: "이전에 입·퇴실 처리된 기록이 있어 누락 입실 복구 대상이 아닙니다.",
  DEDICATED_LIFECYCLE_REQUIRED: "Shared Room과 Long Stay는 전용 운영 절차를 사용해 주세요.",
};

export function HotelMissedCheckInRecoveryModal({ open, stay, processing, onClose, onSubmit }: {
  open: boolean; stay: HotelStay; processing: boolean; onClose: () => void;
  onSubmit: (at: string, roomId: string, stayVersion: number, capacityVersion: number, requestId: string) => Promise<unknown>;
}) {
  const [time, setTime] = useState("");
  const [roomId, setRoomId] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [revision, setRevision] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [query, setQuery] = useState<{ key: string; generation: number; data?: MissedCheckInEligibility; error?: string } | null>(null);
  const generation = useRef(0);
  const lock = useRef(false);
  const intent = useRef<{ key: string; id: string } | null>(null);
  const key = JSON.stringify([stay.id, stay.version, stay.capacityReservation, time, revision]);
  const invalidate = () => { generation.current += 1; setQuery(null); setRoomId(""); setConfirmed(false); };
  useEffect(() => {
    generation.current += 1; setQuery(null); setTime(""); setRoomId(""); setConfirmed(false); intent.current = null; setSubmitError(null);
  }, [open, stay.id]);
  useEffect(() => {
    const currentGeneration = ++generation.current;
    setQuery(null); setRoomId(""); setConfirmed(false);
    if (!open || !time) return;
    const [date, clock] = time.split("T");
    if (!date || !clock) return;
    getHotelMissedCheckInEligibility(stay.id, toSeoulInstant(date, clock))
      .then(data => { if (generation.current === currentGeneration) setQuery({ key, generation: currentGeneration, data }); })
      .catch(() => { if (generation.current === currentGeneration) setQuery({ key, generation: currentGeneration, error: "객실 가능 정보를 불러오지 못했습니다. 다시 조회해 주세요." }); });
    return () => { if (generation.current === currentGeneration) generation.current += 1; };
  }, [open, stay.id, time, key]);
  const current = open && query?.key === key && query.generation === generation.current ? query : null;
  const data = current?.data?.stayId === stay.id && current.data.stayVersion === stay.version ? current.data : undefined;
  const selected = data?.rooms.find(room => room.roomId === roomId && room.eligible);
  const busy = processing || submitting;
  const allowed = selected && data?.reasonCode == null && data?.capacityVersion && confirmed;
  const queryError = current?.error ?? (current?.data && !data ? "예약이 변경되었습니다. 상세를 다시 열어 최신 상태를 확인해 주세요." : null);
  return <Modal size="medium" open={open} title="누락된 입실 기록 복구" description={stay.dogName} onClose={busy ? () => {} : onClose} resetKey={stay.id}>
    <form className="hotel-operation-form" onSubmit={async event => {
      event.preventDefault();
      if (lock.current || busy || !allowed || !data?.capacityVersion || current?.generation !== generation.current) return;
      const [date, clock] = time.split("T");
      const at = toSeoulInstant(date, clock);
      const intentKey = JSON.stringify([stay.id, data.stayVersion, data.capacityVersion, roomId, at]);
      if (intent.current?.key !== intentKey) intent.current = { key: intentKey, id: crypto.randomUUID() };
      lock.current = true; setSubmitting(true); setSubmitError(null);
      try { await onSubmit(at, roomId, data.stayVersion, data.capacityVersion, intent.current.id); }
      catch { setSubmitError("복구 결과를 확인하지 못했습니다. 상태를 다시 조회해 주세요."); }
      finally { lock.current = false; setSubmitting(false); invalidate(); setRevision(n => n + 1); }
    }}>
      <HotelOperationJourney timeReady={Boolean(time)} roomReady={Boolean(selected && data?.reasonCode == null)} recovery />
      <p className="mb-3 text-sm text-text-secondary">입실 예정: {formatHotelScheduleTime(stay, "check_in")} · 참고 정보이며 실제 입실 시각으로 자동 기록하지 않습니다.</p>
      <p className="mb-3 text-sm text-text-secondary">실제로 도착한 시각을 입력해 주세요. 예약 기간과 예정 일정은 유지됩니다. 기존 객실 확보 기간이 끝나기 전까지만 복구할 수 있습니다.</p>
      <div className="hotel-confirmed-time"><span className="hotel-operation-eyebrow">01 / ACTUAL TIME</span><Field label="실제 입실 일시" required><Input aria-label="실제 입실 일시" type="datetime-local" required value={time} disabled={busy} onChange={e => { invalidate(); setTime(e.target.value); }} /></Field><small>한국시간 · 실제 도착 시각을 확인해 주세요.</small></div>
      <HotelEligibleRoomSurface rooms={data?.rooms ?? []} selectedId={roomId} disabled={busy || !data || data.reasonCode != null} onSelect={(id) => { setRoomId(id); setConfirmed(false); }}>
      <Field label="입실 객실" required><Select aria-label="입실 객실" value={roomId} disabled={busy || !data || data.reasonCode != null} onChange={e => { setRoomId(e.target.value); setConfirmed(false); }}>
        <option value="">객실 선택</option>
        {data?.rooms.map(room => <option key={room.roomId} value={room.roomId} disabled={!room.eligible}>{room.roomName}{!room.eligible ? " · 배정 불가" : room.recommended ? " · 추천" : ""}</option>)}
      </Select></Field>
      </HotelEligibleRoomSurface>
      {!time ? <p role="status">실제 입실 일시를 직접 입력해 주세요.</p> : !current ? <p role="status">객실 확인 중...</p> : null}
      {submitError ? <p role="alert">{submitError}</p> : null}
      {queryError || data?.reasonCode ? <p role="alert">{queryError ?? reasonMessages[data!.reasonCode!] ?? "현재 예약 상태로 복구할 수 없습니다. 예약 정보를 확인해 주세요."}</p> : null}
      {selected && data?.reasonCode == null ? <label className="my-3 flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)} />
        <span>{time.replace("T", " ")} (한국시간)부터 {selected.roomName} 객실로 실제 입실 기록을 복구함을 확인합니다.</span>
      </label> : null}
      <ModalActions><Button type="button" variant="secondary" disabled={busy || !time} onClick={() => { invalidate(); setRevision(n => n + 1); }}>다시 조회</Button>
        <Button type="submit" disabled={busy || !allowed}>{busy ? "처리 중..." : "입실 기록 복구"}</Button></ModalActions>
    </form>
  </Modal>;
}
