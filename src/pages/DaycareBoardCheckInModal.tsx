import { useRef, useState } from "react";
import { Button, Field, Input, Modal, ModalActions } from "../components/ui";
import type { DaycareReservation } from "./daycareOperationsRepository";
import { daycareDogNames } from "./daycareReservationPresentation";

export function DaycareBoardCheckInModal({ reservation, date, onClose, onSubmit }: {
  reservation: DaycareReservation;
  date: string;
  onClose: () => void;
  onSubmit: (checkedInAt: string, requestId: ReturnType<typeof crypto.randomUUID>) => Promise<void>;
}) {
  const [clock, setClock] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const saving = useRef(false);
  const attempt = useRef<{ key: string; id: ReturnType<typeof crypto.randomUUID> } | null>(null);
  const at = /^\d{2}:\d{2}$/.test(clock) ? Date.parse(`${date}T${clock}:00+09:00`) : NaN;
  const valid = Number.isFinite(at) && at <= Date.now() && at < Date.parse(reservation.endsAt);
  const label = reservation.dogs?.length === 2 ? "두 마리 입실 완료" : "입실 완료";

  return <Modal open title="데이케어 실제 입실" description={daycareDogNames(reservation)} size="small"
    onClose={() => { if (!saving.current) onClose(); }}>
    <form className="space-y-4" onSubmit={async event => {
      event.preventDefault();
      if (saving.current || !confirmed || !valid || at > Date.now() || !reservation.roomAllocation) return;
      const key = `${reservation.version}:${at}`;
      if (attempt.current?.key !== key) attempt.current = { key, id: crypto.randomUUID() };
      saving.current = true;
      setBusy(true);
      setError("");
      try { await onSubmit(new Date(at).toISOString(), attempt.current.id); }
      catch (cause) { setError(cause instanceof Error ? cause.message : "입실을 저장하지 못했습니다."); }
      finally { saving.current = false; setBusy(false); }
    }}>
      <p className="text-sm text-text-primary"><strong>{reservation.roomAllocation?.roomName}</strong>에 배정되었습니다. 실제로 도착한 시각을 입력해 주세요.</p>
      <Field label="실제 입실 시각" required>
        <Input aria-label="실제 입실 시각" type="time" required disabled={busy} value={clock} onChange={event => { setClock(event.target.value); setConfirmed(false); setError(""); }} />
      </Field>
      <p className="text-xs text-text-secondary">{date} · 한국시간</p>
      {clock && !valid ? <p role="status" className="text-sm text-error">지금까지의 시각 중 예약 종료 전 시각을 입력해 주세요.</p> : null}
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} />
        실제 이용 및 입력한 시각을 확인했습니다.
      </label>
      {error ? <p role="alert" className="rounded-xl bg-error-soft p-3 text-sm text-error">{error}</p> : null}
      <ModalActions>
        <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>나중에</Button>
        <Button type="submit" disabled={busy || !confirmed || !valid}>{busy ? "저장 중…" : label}</Button>
      </ModalActions>
    </form>
  </Modal>;
}
