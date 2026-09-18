import { useEffect, useRef, useState } from "react";
import { Button, Modal } from "../components/ui";
import { previewDogProfileRemoval, type DogRemovalPreview } from "./dogHistoricalIdentityRepository";
import { DogRemovalFailure, removeDogProfile } from "./dogDeletionRepository";

const categories: Record<string, string> = { sales: "매출", schedules: "일정", hotel: "호텔", shared: "함께 투숙", long_stay: "장기 투숙", daycare: "데이케어", journal: "일지", family_booking: "가족 예약", structured_identity: "기록 확인" };
function dates(value: Record<string, unknown>): string {
  return Object.values(value).filter((v): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)).map(v => v.slice(0, 10)).join(" ~ ");
}
export function DogDeleteModal({ dog, onClose, onDeleted }: {
  dog: { id: string; name: string }; onClose: () => void; onDeleted: (id: string, mode?: "hard_delete" | "profile_remove") => void;
}) {
  const generation = useRef(0);
  const inFlight = useRef(false);
  const request = useRef<{ preview: DogRemovalPreview; id: string } | null>(null);
  const [preview, setPreview] = useState<DogRemovalPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const current = ++generation.current;
    let active = true;
    setLoading(true); setPreview(null); setError(""); request.current = null;
    void previewDogProfileRemoval(dog.id).then(value => {
      if (active && current === generation.current) { setPreview(value); request.current = { preview: value, id: crypto.randomUUID() }; }
    }).catch(failure => { if (active && current === generation.current) setError(failure instanceof Error ? failure.message : "연결 기록을 확인하지 못했습니다."); })
      .finally(() => { if (active && current === generation.current) setLoading(false); });
    return () => { active = false; };
  }, [dog.id, retry]);
  const current = !loading && preview?.dog.recordDogId === dog.id ? preview : null;
  const confirm = async () => {
    if (inFlight.current || !current?.commandAvailable || !request.current) return;
    inFlight.current = true; setProcessing(true); setError("");
    try {
      const result = await removeDogProfile(request.current.preview, request.current.id);
      onDeleted(result.dogId, result.mode);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "처리하지 못했습니다."); if (failure instanceof DogRemovalFailure && failure.requiresRefresh) { setPreview(null); request.current = null; } }
    finally { inFlight.current = false; setProcessing(false); }
  };
  const blocked = current && current.activeBlockerCount > 0;
  return <Modal open title="반려견 정보 삭제" onClose={() => { if (!inFlight.current) onClose(); }}>
    <div className="min-w-0 space-y-4 break-words">
      <p className="font-semibold">{dog.name}</p>
      {loading && <p role="status">연결된 기록을 확인하고 있습니다.</p>}
      {current && <>
        <h3 className="font-semibold">{blocked ? "현재 진행 중이거나 확인이 필요한 업무가 있습니다" : current.proposedMode === "hard_delete" ? "반려견 정보를 완전히 삭제하시겠습니까?" : "연결된 기록이 있습니다"}</h3>
        {current.categories.filter(c => c.userVisibleCount > 0 || c.records.some(r => r.classification === "UNKNOWN")).map(c =>
          <section key={c.category} className="rounded-lg border border-border p-3">
            <p className="font-medium">{categories[c.category] ?? "기타 기록"} {c.userVisibleCount > 0 && `${c.userVisibleCount}건`}</p>
            {c.records.slice(0, 5).map((r, i) => <p key={i} className="text-sm text-text-secondary">{dates(r.dates)} {r.classification === "BLOCK" ? "진행 중 또는 미완료" : r.classification === "UNKNOWN" ? "기록 확인 필요" : "이용 기록"}</p>)}
          </section>)}
        {current.warnings.includes("OUTSTANDING_SALES") && <p className="rounded-lg bg-warning-soft p-3">미수금이 있습니다. 프로필 삭제 후에도 매출·수납 기록은 유지됩니다.</p>}
        {blocked ? <p>진행 중인 업무가 완료되거나 기록 확인이 끝난 후 다시 시도해 주세요.</p>
          : current.proposedMode === "hard_delete" ? <p>연결된 이용 기록이 없습니다. 삭제하면 복구할 수 없습니다.</p>
          : <p>프로필을 삭제해도 기존 기록은 유지됩니다. 기존 기록에서는 “{dog.name} · 프로필 삭제됨”으로 표시됩니다.</p>}
        {!current.commandAvailable && !blocked && <p>현재는 조회만 가능합니다. 삭제 기능을 사용할 수 없습니다.</p>}
      </>}
      {error && <p role="alert" className="text-error">{error}</p>}
      <div className="flex flex-wrap justify-end gap-3">
        <Button variant="secondary" disabled={processing} onClick={onClose}>{blocked ? "확인" : "취소"}</Button>
        {error && <Button variant="secondary" disabled={processing || loading} onClick={() => { ++generation.current; setPreview(null); setLoading(true); setRetry(v => v + 1); }}>다시 확인</Button>}
        {current?.commandAvailable && <Button variant="danger" disabled={processing} onClick={() => void confirm()}>{processing ? "처리 중…" : current.proposedMode === "hard_delete" ? "완전 삭제" : "반려견 프로필 삭제"}</Button>}
      </div>
    </div>
  </Modal>;
}
