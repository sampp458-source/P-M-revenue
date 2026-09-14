import { useRef, useState } from "react";
import { ConfirmModal } from "../components/ui";
import { deleteDog } from "./dogDeletionRepository";

export function DogDeleteModal({ dog, onClose, onDeleted }: {
  dog: { id: string; name: string };
  onClose: () => void;
  onDeleted: (id: string) => void;
}) {
  const inFlight = useRef(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");
  const confirm = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setProcessing(true);
    setError("");
    try {
      await deleteDog(dog.id);
      onDeleted(dog.id);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "반려견을 삭제하지 못했습니다.");
    } finally {
      inFlight.current = false;
      setProcessing(false);
    }
  };
  return <ConfirmModal open title="반려견 삭제" confirmLabel="완전 삭제" cancelLabel="취소"
    processing={processing} onClose={() => { if (!inFlight.current) onClose(); }} onConfirm={() => void confirm()}
    description={<><p><strong>{dog.name}</strong>의 정보를 완전히 삭제하시겠습니까?</p><p>삭제한 정보는 복구할 수 없습니다.</p><p>연결된 이용 기록이 있는 반려견은 삭제할 수 없습니다.</p>{error && <p role="alert" className="mt-3 text-error">{error}</p>}</>} />;
}
