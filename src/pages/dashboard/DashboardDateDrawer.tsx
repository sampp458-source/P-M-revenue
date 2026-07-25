import { CalendarDays, ExternalLink, X } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import { Badge, Button, EmptyState, StatusBadge, cn } from "../../components/ui";
import { won } from "../../lib/format";
import {
  finalSaleAmount,
  type DailyRevenue,
  type DashboardSale,
} from "./dashboardMetrics";

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
              <h2 id={titleId} className="text-lg font-bold tracking-[-0.02em] text-text-primary tabular-nums">
                {date}
              </h2>
              <p className="mt-0.5 truncate text-xs text-text-muted">
                {unitName} · 날짜별 거래 상세
              </p>
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
          <div className="overflow-hidden rounded-2xl bg-[#172f4d] p-5 text-white shadow-[0_14px_30px_rgba(23,47,77,0.14)] sm:p-6">
            <p className="text-xs font-semibold text-blue-200">판매금액</p>
            <strong className="mt-2 block text-[clamp(2rem,8vw,2.75rem)] font-bold tracking-[-0.045em] text-white tabular-nums">
              {won(summary.salesAmount)}
            </strong>
            <div className="mt-5 grid grid-cols-3 gap-3 border-t border-white/10 pt-4">
              <Summary label="실결제" value={won(summary.net)} />
              <Summary label="미수" value={won(summary.outstanding)} warning={summary.outstanding > 0} />
              <Summary label="환불" value={won(summary.refund)} warning={summary.refund > 0} />
            </div>
          </div>

          <div className="mb-3 mt-7 flex items-end justify-between gap-3">
            <div>
              <h3 className="font-semibold text-text-primary">거래 목록</h3>
            </div>
            <div className="text-right">
              <Badge tone="blue">{rows.length.toLocaleString("ko-KR")}건</Badge>
              {summary.cancelledCount > 0 && (
                <p className="mt-1 text-[10px] text-text-muted">
                  유효 {summary.count.toLocaleString("ko-KR")}건 · 취소{" "}
                  {summary.cancelledCount.toLocaleString("ko-KR")}건
                </p>
              )}
            </div>
          </div>

          {rows.length ? (
            <div className="space-y-2">
              {rows.map((sale) => (
                <button
                  key={sale.id}
                  type="button"
                  onClick={() => onOpenSale(sale.id)}
                  className="group block min-h-11 w-full rounded-xl border border-border bg-surface p-3.5 text-left transition-[transform,border-color,box-shadow,background-color] duration-200 hover:-translate-y-px hover:border-primary/25 hover:bg-primary-subtle hover:shadow-[0_8px_20px_rgba(23,36,58,0.06)] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <span className="flex items-start justify-between gap-3">
                    <span className="min-w-0">
                      <strong className="block truncate text-sm text-text-primary">
                        {sale.productName}
                      </strong>
                      <span className="mt-1 block text-xs text-text-secondary">
                        {sale.dogName || "(반려견 없음)"} · {sale.customerName || "보호자 미등록"}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <strong className="block text-sm text-text-primary tabular-nums">
                        {won(finalSaleAmount(sale))}
                      </strong>
                      <span className="mt-1 block text-[11px] font-semibold text-text-muted tabular-nums">
                        {timeLabel(sale.createdAt)}
                      </span>
                    </span>
                  </span>
                  <span className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border pt-3">
                    <Badge>{sale.businessUnitName}</Badge>
                    <StatusBadge
                      status={sale.status as
                        | "normal"
                        | "partial_refund"
                        | "full_refund"
                        | "cancelled"}
                    />
                    <span className="ml-auto text-[11px] text-text-muted">
                      {paymentLabels[sale.paymentMethod] || sale.paymentMethod} · {sale.staffName || "담당자 미등록"}
                    </span>
                    {sale.refundAmount > 0 && (
                      <span className="w-full text-right text-[11px] font-semibold text-error tabular-nums">
                        환불 -{won(sale.refundAmount)}
                      </span>
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
  warning = false,
}: {
  label: string;
  value: string;
  warning?: boolean;
}) {
  return (
    <div className="min-w-0">
      <span className="block text-[10px] font-semibold text-slate-300">{label}</span>
      <strong className={cn(
        "mt-1 block truncate text-sm text-white tabular-nums",
        warning && "text-amber-200",
      )}>
        {value}
      </strong>
    </div>
  );
}
