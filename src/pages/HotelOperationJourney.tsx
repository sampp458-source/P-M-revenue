import { Check, Clock3, DoorOpen, ShieldCheck } from "lucide-react";

// Presentation only: completion comes from the caller's current eligibility state.
export function HotelOperationJourney({ timeReady, roomReady, recovery = false }: {
  timeReady: boolean; roomReady: boolean; recovery?: boolean;
}) {
  const current = !timeReady ? 0 : !roomReady ? 1 : 2;
  const steps = ["실제 시각", "객실 확인", "최종 확정"];
  const icons = [Clock3, DoorOpen, ShieldCheck];
  return <div className="hotel-operation-journey">
    <p className="hotel-operation-eyebrow">{recovery ? "누락 기록 확인" : "도착 · 입실 처리"}</p>
    <ol aria-label="입실 처리 단계">
      {steps.map((label, index) => {
        const Icon = index < current ? Check : icons[index];
        return <li key={label} aria-current={index === current ? "step" : undefined} data-complete={index < current || undefined}>
          <span aria-hidden="true"><Icon size={16} /></span><b>{label}</b>
        </li>;
      })}
    </ol>
    <p>예정은 그대로, 실제 기록은 정확하게</p>
  </div>;
}
