import { useEffect, useRef, useState } from "react";
import { Button, Field, Input, Modal, ModalActions, Select } from "../components/ui";
import { getHotelSingleRoomEligibility, type HotelStay, type SingleRoomEligibility } from "./hotelOperationsRepository";
import { seoulInputParts } from "./hotelOperationsUi";
import { toSeoulInstant } from "./operationsScheduleRepository";

export function HotelSingleActualCheckInModal({ open, stay, processing, onClose, onSubmit }: {
  open: boolean; stay: HotelStay; processing: boolean; onClose: () => void;
  onSubmit: (at: string, roomId: string, stayVersion: number, capacityVersion: number) => Promise<unknown>;
}) {
  const [time, setTime] = useState("");
  const [roomId, setRoomId] = useState("");
  const [query, setQuery] = useState<{ key: string; generation: number; data?: SingleRoomEligibility; error?: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [revision, setRevision] = useState(0);
  const lock = useRef(false);
  const generation = useRef(0);
  const invalidateEligibility = () => {
    generation.current += 1;
    setQuery(null);
    setRoomId("");
  };
  const key = `${stay.id}:${stay.version}:${time}:${revision}`;
  useEffect(() => {
    generation.current += 1; setQuery(null);
    if (!open) { setTime(""); setRoomId(""); return; }
    const now = seoulInputParts(new Date().toISOString());
    setTime(`${now.date}T${now.time}`); setRoomId("");
  }, [open, stay.id]);
  useEffect(() => {
    if (!open || !time) return;
    const requestGeneration = ++generation.current;
    setQuery(null); setRoomId("");
    const [date, clock] = time.split("T");
    if (!date || !clock) return;
    getHotelSingleRoomEligibility(stay.id, "actual_check_in", toSeoulInstant(date, clock))
      .then(data => { if (generation.current === requestGeneration) setQuery({ key, generation: requestGeneration, data }); })
      .catch(() => { if (generation.current === requestGeneration) setQuery({ key, generation: requestGeneration, error: "객실 가능 정보를 불러오지 못했습니다. 다시 조회해 주세요." }); });
    return () => { if (generation.current === requestGeneration) generation.current += 1; };
  }, [open, stay.id, time, key]);
  const currentQuery = open && query?.key === key && query.generation === generation.current ? query : null;
  const data = currentQuery?.data;
  const error = currentQuery?.error;
  const eligible = data?.rooms.some(r => r.roomId === roomId && r.eligible);
  const busy = processing || submitting;
  return <Modal open={open} title="실제 입실 확정" description={stay.dogName} onClose={busy ? () => {} : onClose} resetKey={stay.id}>
    <form onSubmit={async event => {
      event.preventDefault();
      if (lock.current || busy || !eligible || !data?.capacityVersion || currentQuery?.generation !== generation.current) return;
      lock.current = true; setSubmitting(true);
      try { const [date, clock] = time.split("T"); await onSubmit(toSeoulInstant(date, clock), roomId, data.stayVersion, data.capacityVersion); }
      finally { lock.current = false; setSubmitting(false); invalidateEligibility(); setRevision(n => n + 1); }
    }}>
      <p className="mb-3 text-sm text-text-secondary">확인한 실제 입실 시각부터 호실을 사용합니다. 예약 기간과 예정 일정은 유지됩니다.</p>
      <Field label="실제 입실 시각" required><Input type="datetime-local" required value={time} disabled={busy} onChange={e => { invalidateEligibility(); setTime(e.target.value); }} /></Field>
      <Field label="입실 객실" required><Select aria-label="입실 객실" value={roomId} disabled={busy || !data} onChange={e => setRoomId(e.target.value)}>
        <option value="">객실 선택</option>
        {data?.rooms.map(r => <option key={r.roomId} value={r.roomId} disabled={!r.eligible}>{r.roomName}{!r.eligible ? " · 배정 불가" : r.recommended ? " · 추천" : ""}</option>)}
      </Select></Field>
      {!data && !error ? <p role="status">객실 확인 중...</p> : null}
      {error || data?.reasonCode ? <p role="alert">{error ?? "현재 예약 상태로 입실할 수 없습니다. 예약 정보를 확인해 주세요."}</p> : null}
      <ModalActions><Button type="button" variant="secondary" disabled={busy} onClick={() => { invalidateEligibility(); setRevision(n => n + 1); }}>다시 조회</Button><Button type="submit" disabled={busy || !eligible}>{busy ? "처리 중..." : "입실 확정"}</Button></ModalActions>
    </form>
  </Modal>;
}
