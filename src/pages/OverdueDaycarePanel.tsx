import { useEffect, useRef, useState } from "react";
import { Badge, Button, Card, Field, Input } from "../components/ui";
import { completeVerifiedDaycareCheckOut, fetchOverdueDaycareOperations, type OverdueDaycareReservation } from "./daycareOperationsRepository";

const seoulDate = (value: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
const entryLabel = (value: string) => new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value));

function OverdueEntry({ reservation, onChanged }: { reservation: OverdueDaycareReservation; onChanged: () => Promise<void> }) {
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const attemptRef = useRef<{ value: string; version: number; requestId: string } | null>(null);
  const [verified, setVerified] = useState(false);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [error, setError] = useState("");
  const actualValue = `${date}T${time}`;
  const actualAt = new Date(`${actualValue}:00+09:00`).valueOf();
  const validTime = /^\d{4}-\d{2}-\d{2}$/.test(date) && /^\d{2}:\d{2}$/.test(time)
    && Number.isFinite(actualAt) && actualAt > new Date(reservation.checkedInAt).valueOf() && actualAt <= Date.now();
  const checkout = async () => {
    if (pendingRef.current || !verified || !validTime) return;
    pendingRef.current = true;
    setPending(true);
    setError("");
    try {
      if (!attemptRef.current || attemptRef.current.value !== actualValue || attemptRef.current.version !== reservation.version) {
        attemptRef.current = { value: actualValue, version: reservation.version, requestId: crypto.randomUUID() };
      }
      await completeVerifiedDaycareCheckOut(reservation.operationScheduleId, reservation.version,
        new Date(actualAt).toISOString(), true, attemptRef.current.requestId);
      await onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "퇴실 결과를 확인하지 못했습니다. 최신 상태를 확인해 주세요.");
      setVerified(false);
      // Refresh version and physical hold; never automatically retry a command.
      await onChanged().catch(() => undefined);
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };
  return <article className="min-w-0 rounded-xl border border-border p-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><strong>{reservation.dog.name} · {reservation.roomAllocation?.roomName ?? "호실 확인 필요"}</strong><Badge tone="amber">미퇴실 · 점유 확인 필요</Badge></div>
    <p className="mt-2 text-sm text-text-secondary">입실 {entryLabel(reservation.checkedInAt!)} · 이용중 · 실제 퇴실 기록 없음</p>
    <p className="mt-2 text-sm text-text-secondary">실제 점유와 퇴실 날짜·시간을 확인해 주세요. 입력 시각을 실제 퇴실로 기록하며, 직원의 처리 시각과 처리자는 별도 감사 기록에 남습니다. 시각을 모르면 처리하지 말고 확인 필요 상태로 유지해 주세요.</p>
    <div className="mt-3 grid max-w-lg grid-cols-1 gap-3 sm:grid-cols-2">
      <Field label={`${reservation.dog.name} 실제 퇴실 날짜`}><Input type="date" min={seoulDate(reservation.checkedInAt)} max={seoulDate(new Date().toISOString())} disabled={pending} value={date} onChange={event => { setDate(event.target.value); setVerified(false); }} /></Field>
      <Field label={`${reservation.dog.name} 실제 퇴실 시간`}><Input type="time" step={60} disabled={pending} value={time} onChange={event => { setTime(event.target.value); setVerified(false); }} /></Field>
    </div>
    <label className="mt-3 flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" disabled={pending} checked={verified} onChange={event => setVerified(event.target.checked)} />실제 퇴실과 입력한 시각을 확인했습니다.</label>
    {verified && validTime ? <p role="status" className="mt-3 rounded-xl bg-surface-secondary p-3 text-sm">{reservation.dog.name} · {reservation.roomAllocation?.roomName ?? "호실 확인 필요"}<br />실제 퇴실: {date} {time} KST<br />지금은 이 퇴실 기록을 등록하는 시각입니다. 다른 배정·점유 이력과 충돌하면 저장하지 않습니다.</p> : null}
    <Button className="mt-3" disabled={pending || !verified || !validTime} onClick={() => void checkout()}>{pending ? "처리 중…" : "확인한 퇴실 기록"}</Button>
    {error ? <p role="alert" className="mt-2 text-sm text-error">{error}</p> : null}
  </article>;
}

/** Separate visibility list: never contributes to snapshot capacity or room counts. */
export function OverdueDaycarePanel({ refreshKey, onChanged }: { refreshKey: unknown; onChanged: () => Promise<void> }) {
  const [rows, setRows] = useState<OverdueDaycareReservation[]>([]);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let current = true;
    void fetchOverdueDaycareOperations().then(value => { if (current) { setRows(value); setError(""); } }).catch(() => { if (current) setError("미퇴실 기록을 조회하지 못했습니다. 객실을 비어 있다고 판단하지 말고 다시 조회해 주세요."); });
    return () => { current = false; };
  }, [refreshKey, revision]);
  const refresh = async () => {
    try { await onChanged(); } finally { setRevision(value => value + 1); }
  };
  if (!rows.length && !error) return null;
  return <Card className="mb-4 min-w-0 p-4 sm:p-5">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-extrabold">이전 날짜 미퇴실 확인</h2><Button variant="secondary" onClick={() => setRevision(value => value + 1)}>다시 조회</Button></div>
    <p className="mt-2 text-sm text-text-secondary">실제 퇴실 기록이 없는 데이케어입니다. 오늘 예약 건수에 중복 합산하지 않습니다.</p>
    {error ? <p role="alert" className="mt-2 text-sm text-error">{error}</p> : null}
    <div className="mt-3 space-y-3">{rows.map(row => <OverdueEntry key={`${row.operationScheduleId}:${row.version}`} reservation={row} onChanged={refresh} />)}</div>
  </Card>;
}
