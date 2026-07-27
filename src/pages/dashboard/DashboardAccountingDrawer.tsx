import { ArrowRight, BookOpenText, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef } from "react";
import { Badge, Button, EmptyState, cn } from "../../components/ui";
import { won } from "../../lib/format";
import {
  accountingEventLabel,
  accountingEventsForView,
  type AccountingEvent,
  type AccountingEventView,
} from "../accountingLedgerEvents";
import type { DashboardSale } from "./dashboardMetrics";

const paymentLabels: Record<string, string> = {
  card: "카드",
  transfer: "계좌이체",
  cash: "현금",
  other: "기타",
};

const viewMeta: Record<
  AccountingEventView,
  { title: string; description: string; tone: "blue" | "green" | "red" }
> = {
  sales: {
    title: "판매 거래",
    description: "매출일 기준으로 발생한 유효 판매",
    tone: "green",
  },
  payments: {
    title: "결제 원장",
    description: "결제일 기준 최초 결제와 미수 회수",
    tone: "blue",
  },
  refunds: {
    title: "환불 원장",
    description: "환불일 기준 유효 환불",
    tone: "red",
  },
  net: {
    title: "순수납 원장",
    description: "실수납과 환불을 실제 발생일 순서로 통합",
    tone: "blue",
  },
};

export function DashboardAccountingDrawer({
  open,
  view,
  events,
  sales,
  rangeLabel,
  unitName,
  salesAmount,
  paidAmount,
  refundAmount,
  onClose,
  onOpenSale,
  onOpenLedger,
}: {
  open: boolean;
  view: AccountingEventView;
  events: AccountingEvent[];
  sales: DashboardSale[];
  rangeLabel: string;
  unitName: string;
  salesAmount: number;
  paidAmount: number;
  refundAmount: number;
  onClose: () => void;
  onOpenSale: (saleId: string, eventDate: string) => void;
  onOpenLedger: () => void;
}) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const rows = useMemo(
    () => accountingEventsForView(events, view),
    [events, view],
  );
  const salesById = useMemo(
    () => new Map(sales.map((sale) => [sale.id, sale])),
    [sales],
  );
  const meta = viewMeta[view];

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
      onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      openerRef.current?.focus();
    };
  }, [onClose, open]);

  if (!open) return null;

  return (
    <>
      <button
        type="button"
        aria-label={`${meta.title} 닫기`}
        className="pm-drawer-overlay fixed inset-0 z-30 bg-slate-950/45 backdrop-blur-[1px]"
        onClick={onClose}
      />
      <aside
        aria-labelledby={titleId}
        className="pm-modal-panel fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l border-white/10 bg-[#111e31] text-white shadow-[var(--pm-shadow-modal)] sm:w-[min(680px,58vw)]"
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-white/10 px-5 py-5 sm:px-6">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10 text-blue-100">
              <BookOpenText size={19} />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2
                  id={titleId}
                  className="text-xl font-bold tracking-[-0.025em] text-white"
                >
                  {meta.title}
                </h2>
                <Badge tone={meta.tone}>{rows.length}건</Badge>
              </div>
              <p className="mt-1 break-words text-sm leading-5 text-slate-300">
                {meta.description}
              </p>
              <p className="mt-1 break-words text-xs leading-5 text-slate-300">
                {rangeLabel} · {unitName}
              </p>
            </div>
          </div>
          <button
            ref={closeRef}
            type="button"
            aria-label={`${meta.title} 닫기`}
            onClick={onClose}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-300 transition-colors hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
          >
            <X size={20} />
          </button>
        </div>

        <div className="sticky top-0 z-10 grid shrink-0 grid-cols-2 gap-2 border-b border-white/10 bg-[#111e31]/95 p-4 backdrop-blur sm:grid-cols-4 sm:px-6">
          <Summary label="판매" value={salesAmount} />
          <Summary label="실수납" value={paidAmount} />
          <Summary label="환불" value={refundAmount} danger />
          <Summary label="순수납" value={paidAmount - refundAmount} />
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-6">
          {rows.length ? (
            <div className="space-y-2.5">
              {rows.map((event) => {
                const sale = salesById.get(event.saleId);
                if (!sale) return null;
                const amount =
                  event.saleAmount || event.paidAmount || event.refundAmount;
                const refund = event.refundAmount > 0;
                return (
                  <button
                    key={event.id}
                    type="button"
                    onClick={() => onOpenSale(event.saleId, event.eventDate)}
                    className="group w-full rounded-2xl border border-white/10 bg-white/[0.045] p-4 text-left transition-[transform,border-color,background-color] duration-200 hover:-translate-y-px hover:border-blue-300/35 hover:bg-white/[0.075] focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
                  >
                    <span className="flex items-start justify-between gap-3">
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-2">
                          <Badge
                            tone={
                              refund
                                ? "red"
                                : event.kind === "sale"
                                  ? "green"
                                  : "blue"
                            }
                          >
                            {accountingEventLabel(event.kind)}
                          </Badge>
                          <span className="text-xs text-slate-300 tabular-nums">
                            {event.eventDate}
                          </span>
                        </span>
                        <strong className="mt-2 block break-words text-base leading-6 text-white">
                          {sale.dogName || "(반려견 없음)"} ·{" "}
                          {sale.customerName || "보호자 미등록"}
                        </strong>
                        <span className="mt-1 block break-words text-sm leading-5 text-slate-300">
                          {sale.productName} · {sale.businessUnitName}
                        </span>
                        <span className="mt-1 block break-words text-xs leading-5 text-slate-300">
                          {event.paymentMethod
                            ? paymentLabels[event.paymentMethod] ||
                              event.paymentMethod
                            : sale.staffName || "담당자 미등록"}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <strong
                          className={cn(
                            "block text-lg font-bold tabular-nums",
                            refund ? "text-rose-200" : "text-white",
                          )}
                        >
                          {refund ? "-" : ""}
                          {won(amount)}
                        </strong>
                        <span className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-blue-200">
                          상세 <ArrowRight size={13} />
                        </span>
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="[&_*]:text-slate-300">
              <EmptyState
                title="표시할 원장 내역이 없습니다"
                description={`${rangeLabel}에 해당하는 ${meta.title}이 없습니다.`}
              />
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-white/10 bg-[#111e31] p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6">
          <Button type="button" className="w-full" onClick={onOpenLedger}>
            거래 원장에서 전체 보기 <ArrowRight size={16} />
          </Button>
        </div>
      </aside>
    </>
  );
}

function Summary({
  label,
  value,
  danger = false,
}: {
  label: string;
  value: number;
  danger?: boolean;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.045] p-3">
      <span className="block text-[11px] font-semibold text-slate-300">
        {label}
      </span>
      <strong
        className={cn(
          "mt-1 block whitespace-nowrap text-[clamp(0.76rem,3.7vw,0.9rem)] tracking-[-0.025em] text-white tabular-nums",
          danger && value > 0 && "text-rose-200",
        )}
      >
        {won(value)}
      </strong>
    </div>
  );
}
