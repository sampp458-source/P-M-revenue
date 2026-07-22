import { CalendarDays, ExternalLink, X } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import { Badge, Button, EmptyState, StatusBadge, cn } from "../../components/ui";
import { won } from "../../lib/format";
import type { DailyRevenue, DashboardSale } from "./dashboardMetrics";

const paymentLabels: Record<string, string> = {
  card: "카드",
  transfer: "계좌이체",
  cash: "현금",
  other: "기타",
  outstanding: "미수",
};

const timeLabel = (value: string) =>
  new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));

export function DashboardDateDrawer({
  open,
  date,
  unitName,
  summary,
  rows,
  onClose,
  onOpenSale,
  onOpenSales,
}: {
  open: boolean;
  date: string;
  unitName: string;
  summary: DailyRevenue;
  rows: DashboardSale[];
  onClose: () => void;
  onOpenSale: (saleId: string) => void;
  onOpenSales: () => void;
}) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    openerRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    requestAnimationFrame(() => closeRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onCloseRef.current();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      openerRef.current?.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <>
      <button
        type="button"
        aria-label="날짜 상세 닫기"
        className="pm-drawer-overlay fixed inset-0 z-30 bg-slate-950/35 backdrop-blur-[1px] sm:hidden"
        onClick={onClose}
      />
      <aside
        aria-labelledby={titleId}
        className="pm-modal-panel fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l border-border bg-surface shadow-[var(--pm-shadow-modal)] sm:w-[min(480px,42vw)]"
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border px-5 py-4 sm:px-6">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
              <CalendarDays size={18} />
            </span>
            <div className="min-w-0">
              <h2 id={titleId} className="font-bold text-text-primary">
                {date} 매출
              </h2>
              <p className="mt-1 truncate text-xs text-text-muted">{unitName}</p>
            </div>
          </div>
          <button
            ref={closeRef}
            type="button"
            aria-label="날짜 상세 닫기"
            onClick={onClose}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-text-secondary transition-colors hover:bg-primary-soft hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-6">
          <div className="grid grid-cols-2 gap-2">
            <Summary label="총 매출" value={won(summary.revenue)} />
            <Summary label="실매출" value={won(summary.net)} featured />
            <Summary label="환불" value={won(summary.refund)} />
            <Summary label="거래 건수" value={`${summary.count}건`} />
          </div>

          <div className="mb-3 mt-6 flex items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold text-text-primary">거래 목록</h3>
              <p className="mt-1 text-xs text-text-muted">
                취소 매출은 목록에 표시하고 합계에서는 제외합니다.
              </p>
            </div>
            <Badge tone="blue">{rows.length}건</Badge>
          </div>

          {rows.length ? (
            <div className="space-y-2">
              {rows.map((sale) => (
                <button
                  key={sale.id}
                  type="button"
                  onClick={() => onOpenSale(sale.id)}
                  className="block min-h-11 w-full rounded-xl border border-border bg-surface-secondary p-4 text-left transition-colors hover:border-primary/25 hover:bg-primary-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <span className="flex items-start justify-between gap-3">
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2">
                        <strong className="text-sm text-text-primary">
                          {sale.productName}
                        </strong>
                        <Badge>{sale.businessUnitName}</Badge>
                        <StatusBadge
                          status={sale.status as
                            | "normal"
                            | "partial_refund"
                            | "full_refund"
                            | "cancelled"}
                        />
                      </span>
                      <span className="mt-1 block text-xs text-text-secondary">
                        {sale.customerName || "보호자 미등록"} · {sale.dogName}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs font-semibold text-text-muted tabular-nums">
                      {timeLabel(sale.createdAt)}
                    </span>
                  </span>
                  <span className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-border pt-3 text-xs sm:grid-cols-3">
                    <Item label="결제" value={won(sale.paidAmount)} />
                    <Item
                      label="결제수단"
                      value={paymentLabels[sale.paymentMethod] || sale.paymentMethod}
                    />
                    <Item label="담당자" value={sale.staffName || "미등록"} />
                    {sale.refundAmount > 0 && (
                      <Item label="환불" value={`-${won(sale.refundAmount)}`} warning />
                    )}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <EmptyState
              title="이 날짜의 매출이 없습니다"
              description="다른 날짜나 사업부를 선택해 주세요."
            />
          )}
        </div>

        <div className="shrink-0 border-t border-border bg-surface p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6">
          <Button type="button" className="w-full" onClick={onOpenSales}>
            전체 매출 내역 보기 <ExternalLink size={16} />
          </Button>
        </div>
      </aside>
    </>
  );
}

function Summary({
  label,
  value,
  featured = false,
}: {
  label: string;
  value: string;
  featured?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border p-3.5",
        featured
          ? "border-primary/20 bg-primary-subtle"
          : "border-border bg-surface-secondary",
      )}
    >
      <span className="block text-xs text-text-muted">{label}</span>
      <strong className="mt-1 block text-base text-text-primary tabular-nums">
        {value}
      </strong>
    </div>
  );
}

function Item({
  label,
  value,
  warning = false,
}: {
  label: string;
  value: string;
  warning?: boolean;
}) {
  return (
    <span>
      <span className="block text-text-muted">{label}</span>
      <strong
        className={cn(
          "mt-0.5 block truncate text-text-primary tabular-nums",
          warning && "text-error",
        )}
      >
        {value}
      </strong>
    </span>
  );
}
