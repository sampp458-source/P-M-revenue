import { CalendarDays, ExternalLink, X } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import { Badge, Button, EmptyState, StatusBadge, cn } from "../../components/ui";
import { won } from "../../lib/format";
import {
  finalSaleAmount,
  type DailyRevenue,
  type DashboardSale,
} from "./dashboardMetrics";
import type { PaymentLedgerEntry } from "../paymentLedgerMetrics";

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
  payments,
  paymentMethodTotals,
  onClose,
  onOpenSale,
  onOpenSales,
}: {
  open: boolean;
  date: string;
  unitName: string;
  summary: DailyRevenue;
  rows: DashboardSale[];
  payments: Array<{
    payment: PaymentLedgerEntry;
    sale: DashboardSale;
  }>;
  paymentMethodTotals: Map<string, number>;
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
        className="pm-modal-panel fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l border-white/10 bg-[#111e31] text-white shadow-[var(--pm-shadow-modal)] sm:w-[min(460px,42vw)]"
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-white/10 px-5 py-4 sm:px-6">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10 text-blue-100">
              <CalendarDays size={18} />
            </span>
            <div className="min-w-0">
              <h2 id={titleId} className="text-xl font-bold tracking-[-0.025em] text-white tabular-nums">
                {date}
              </h2>
              <p className="mt-1 break-words text-sm font-semibold leading-5 text-blue-100">
                {unitName}
                <span className="ml-1.5 font-normal text-slate-300">· 날짜별 거래 상세</span>
              </p>
            </div>
          </div>
          <button
            ref={closeRef}
            type="button"
            aria-label="날짜 상세 닫기"
            onClick={onClose}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-300 transition-colors hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain">
          <div className="sticky top-0 z-10 border-b border-white/10 bg-[#111e31]/95 p-4 backdrop-blur sm:p-6">
          <div className="overflow-hidden rounded-2xl bg-[#172f4d] p-5 text-white shadow-[0_14px_30px_rgba(23,47,77,0.14)] sm:p-6">
            <p className="text-xs font-semibold text-blue-200">판매금액</p>
            <strong className="mt-2 block whitespace-nowrap text-[clamp(1.75rem,8vw,2.75rem)] font-bold tracking-[-0.045em] text-white tabular-nums">
              {won(summary.salesAmount)}
            </strong>
            <div className="mt-5 grid grid-cols-1 gap-2 border-t border-white/10 pt-4 min-[430px]:grid-cols-3 min-[430px]:gap-3">
              <Summary label="실수납" value={won(summary.revenue)} />
              <Summary label="현재 미수" value={won(summary.outstanding)} warning={summary.outstanding > 0} />
              <Summary label="환불" value={won(summary.refund)} warning={summary.refund > 0} />
            </div>
          </div>
          </div>

          <div className="p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-6">
          <div className="mb-6">
            <div className="mb-3 flex items-end justify-between gap-3">
              <div>
                <h3 className="font-semibold text-white">수납 내역</h3>
                <p className="mt-1 text-xs text-slate-300">결제일 기준 유효 결제원장</p>
              </div>
              <Badge tone="blue">{payments.length.toLocaleString("ko-KR")}건</Badge>
            </div>
            {paymentMethodTotals.size > 0 && (
              <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[...paymentMethodTotals.entries()].map(([method, amount]) => (
                  <div key={method} className="rounded-xl border border-white/10 bg-white/[0.045] p-3">
                    <span className="block text-[11px] text-slate-300">
                      {paymentLabels[method] || method}
                    </span>
                    <strong className="mt-1 block text-sm text-white tabular-nums">
                      {won(amount)}
                    </strong>
                  </div>
                ))}
              </div>
            )}
            {payments.length > 0 ? (
              <div className="space-y-2">
                {payments.map(({ payment, sale }) => (
                  <button
                    key={payment.id}
                    type="button"
                    onClick={() => onOpenSale(sale.id)}
                    className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.045] px-3.5 py-3 text-left transition-colors hover:border-blue-300/35 hover:bg-white/[0.075] focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
                  >
                    <span className="min-w-0">
                      <strong className="block break-words text-sm leading-5 text-white">
                        {sale.dogName || "(반려견 없음)"} · {sale.customerName || "보호자 미등록"}
                      </strong>
                      <span className="mt-1 block break-words text-xs leading-5 text-slate-300">
                        {sale.productName} · {sale.businessUnitName} · {paymentLabels[payment.paymentMethod || "other"] || payment.paymentMethod}
                        {payment.source === "outstanding_collection" ? " · 미수 수납" : ""}
                      </span>
                    </span>
                    <strong className="shrink-0 text-sm text-blue-100 tabular-nums">
                      {won(payment.amount)}
                    </strong>
                  </button>
                ))}
              </div>
            ) : (
              <p className="rounded-xl bg-white/[0.045] p-4 text-center text-sm text-slate-300">
                이 날짜의 수납 내역이 없습니다.
              </p>
            )}
          </div>

          <div className="mb-3 flex items-end justify-between gap-3">
            <div>
                <h3 className="font-semibold text-white">거래 목록</h3>
            </div>
            <div className="text-right">
              <Badge tone="blue">{rows.length.toLocaleString("ko-KR")}건</Badge>
              {summary.cancelledCount > 0 && (
                <p className="mt-1 text-[10px] text-slate-300">
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
                  className="group block min-h-11 w-full rounded-xl border border-white/10 bg-white/[0.045] p-3.5 text-left transition-[transform,border-color,box-shadow,background-color] duration-200 hover:-translate-y-px hover:border-blue-300/35 hover:bg-white/[0.075] focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
                >
                  <span className="flex items-start justify-between gap-3">
                    <span className="min-w-0">
                      <strong className="block break-words text-base leading-6 text-white">
                        {sale.dogName || "(반려견 없음)"}
                      </strong>
                      <span className="mt-1 block break-words text-sm leading-5 text-slate-200">
                        {sale.customerName || "보호자 미등록"}
                      </span>
                      <span className="mt-1.5 block break-words text-xs leading-5 text-slate-300">
                        {sale.productName} · {paymentLabels[sale.paymentMethod] || sale.paymentMethod}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <strong className="block text-base text-white tabular-nums">
                        {won(finalSaleAmount(sale))}
                      </strong>
                      <span className="mt-1 block text-[11px] font-semibold text-slate-300 tabular-nums">
                        {timeLabel(sale.createdAt)}
                      </span>
                    </span>
                  </span>
                  <span className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-white/10 pt-3">
                    <StatusBadge
                      status={sale.status as
                        | "normal"
                        | "partial_refund"
                        | "full_refund"
                        | "cancelled"}
                    />
                    <Badge>{sale.businessUnitName}</Badge>
                    <span className="w-full text-[12px] leading-5 text-slate-300 sm:ml-auto sm:w-auto">
                      보호자 {sale.customerName || "미등록"}
                      <span className="mx-1.5 text-slate-500">·</span>
                      담당자 {sale.staffName || "미등록"}
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
            <div className="[&_*]:text-slate-300">
              <EmptyState
                title="이 날짜의 매출이 없습니다"
                description="다른 날짜나 사업부를 선택해 주세요."
              />
            </div>
          )}
          </div>
        </div>

        <div className="shrink-0 border-t border-white/10 bg-[#111e31] p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6">
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
        "mt-1 block whitespace-nowrap text-[clamp(0.78rem,3.8vw,0.9rem)] text-white tabular-nums",
        warning && "text-amber-200",
      )}>
        {value}
      </strong>
    </div>
  );
}
