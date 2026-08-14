import { BedDouble, CalendarDays, ClipboardList, Hotel } from "lucide-react";
import { Button, Modal, cn } from "../components/ui";

export type UnifiedOperationCreateType =
  | "hotel"
  | "daycare"
  | "long-stay"
  | "general";

const CREATE_TYPES: Array<{
  value: UnifiedOperationCreateType;
  label: string;
  description: string;
  icon: typeof Hotel;
}> = [
  {
    value: "hotel",
    label: "호텔 예약",
    description: "입·퇴실 일정과 객실 유형을 함께 등록합니다.",
    icon: Hotel,
  },
  {
    value: "daycare",
    label: "데이케어 예약",
    description: "하루 날짜와 입·퇴실 시간을 등록합니다.",
    icon: CalendarDays,
  },
  {
    value: "long-stay",
    label: "장기호텔",
    description: "계약을 등록하고 월별 객실은 Hotel Operations에서 배정합니다.",
    icon: BedDouble,
  },
  {
    value: "general",
    label: "상담·일반 일정",
    description: "캘린더와 일정 유형을 직접 선택합니다.",
    icon: ClipboardList,
  },
];

export function UnifiedOperationCreateEntryModal({
  open,
  longStayAllowed,
  onSelect,
  onClose,
}: {
  open: boolean;
  longStayAllowed: boolean;
  onSelect: (type: UnifiedOperationCreateType) => void;
  onClose: () => void;
}) {
  return (
    <Modal open={open} title="새 일정" onClose={onClose} wide resetKey="unified-operation-create">
      <div className="space-y-4">
        <div>
          <h3 className="text-sm font-bold text-text-primary">등록 유형</h3>
          <p className="mt-1 text-sm text-text-secondary">등록할 서비스나 일정 종류를 먼저 선택하세요.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {CREATE_TYPES.map(({ value, label, description, icon: Icon }) => {
            const disabled = value === "long-stay" && !longStayAllowed;
            return (
              <button
                key={value}
                type="button"
                disabled={disabled}
                className={cn(
                  "flex min-h-28 items-start gap-3 rounded-2xl border border-border bg-surface p-4 text-left transition hover:border-primary/35 hover:bg-primary-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                  disabled && "cursor-not-allowed opacity-50 hover:border-border hover:bg-surface",
                )}
                onClick={() => onSelect(value)}
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-subtle text-primary">
                  <Icon size={19} aria-hidden="true" />
                </span>
                <span>
                  <strong className="block text-sm text-text-primary">{label}</strong>
                  <span className="mt-1 block text-xs leading-5 text-text-secondary">{description}</span>
                  {disabled ? <span className="mt-1 block text-xs font-semibold text-warning">Owner/Manager만 등록할 수 있습니다.</span> : null}
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex justify-end">
          <Button type="button" variant="secondary" onClick={onClose}>닫기</Button>
        </div>
      </div>
    </Modal>
  );
}
