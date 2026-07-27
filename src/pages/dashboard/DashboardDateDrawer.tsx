import { CalendarDays, ExternalLink, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Badge, Button, EmptyState, StatusBadge, cn } from "../../components/ui";
import { won } from "../../lib/format";
import {
  businessUnitOrder,
  finalSaleAmount,
  type BusinessUnitOption,
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

interface SaleGroup {
  id: string;
  name: string;
  code: string;
  order: number;
  rows: DashboardSale[];
}

export function DashboardDateDrawer({
  open,
  date,
  unitName,
  summary,
  rows,
  payments,
  paymentMethodTotals,
  units,
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
  units: BusinessUnitOption[];
  onClose: () => void;
  onOpenSale: (saleId: string) => void;
  onOpenSales: () => void;
}) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const [selectedUnitId, setSelectedUnitId] = useState("all");
  onCloseRef.current = onClose;
  const saleGroups = useMemo(() => {
    const unitById = new Map(units.map((unit) => [unit.id, unit]));
    const grouped = new Map<string, SaleGroup>();
    units
      .filter((unit) => businessUnitOrder(unit) < 99)
      .forEach((unit) => {
        grouped.set(unit.id, {
          id: unit.id,
          name: unit.name,
          code: unit.code || "other",
          order: businessUnitOrder(unit),
          rows: [],
        });
      });
    rows.forEach((sale) => {
      const unit = unitById.get(sale.businessUnitId);
      const current = grouped.get(sale.businessUnitId) ?? {
        id: sale.businessUnitId,
        name: unit?.name || sale.businessUnitName || "기타",
        code: unit?.code || "other",
        order: unit ? businessUnitOrder(unit) : 99,
        rows: [],
      };
      current.rows.push(sale);
      grouped.set(sale.businessUnitId, current);
    });
    return [...grouped.values()].sort(
      (left, right) =>
        left.order - right.order || left.name.localeCompare(right.name, "ko-KR"),
    );
  }, [rows, units]);
  const selectedGroup = saleGroups.find((group) => group.id === selectedUnitId);

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

  useEffect(() => {
    if (!open) setSelectedUnitId("all");
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
              <p className="mt-1 break-keep text-sm font-semibold leading-5 text-blue-100">
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
                    className="flex min-h-11 w-full flex-col items-stretch gap-2 rounded-xl border border-white/10 bg-white/[0.045] px-3.5 py-3 text-left transition-colors hover:border-blue-300/35 hover:bg-white/[0.075] focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 min-[430px]:flex-row min-[430px]:items-center min-[430px]:justify-between min-[430px]:gap-3"
                  >
                    <span className="min-w-0">
                      <strong className="block break-keep text-sm leading-5 text-white">
                        {sale.dogName || "(반려견 없음)"} · {sale.customerName || "보호자 미등록"}
                      </strong>
                      <span className="mt-1 block break-keep text-xs leading-5 text-slate-300">
                        {sale.productName} · {sale.businessUnitName} · {paymentLabels[payment.paymentMethod || "other"] || payment.paymentMethod}
                        {payment.source === "outstanding_collection" ? " · 미수 수납" : ""}
                      </span>
                    </span>
                    <strong className="shrink-0 self-end whitespace-nowrap text-sm text-blue-100 tabular-nums">
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

          <div>
            <div className="-mx-1 mb-4 overflow-x-auto px-1 pb-1">
              <div className="flex min-w-max gap-1 rounded-xl bg-white/[0.045] p-1" role="tablist" aria-label="날짜 상세 사업부">
                <UnitTab active={selectedUnitId === "all"} onClick={() => setSelectedUnitId("all")}>
                  전체
                </UnitTab>
                {saleGroups.map((group) => (
                  <UnitTab
                    key={group.id}
                    active={selectedUnitId === group.id}
                    onClick={() => setSelectedUnitId(group.id)}
                    dot={businessUnitTone(group.code).dot}
                  >
                    {group.name}
                  </UnitTab>
                ))}
              </div>
            </div>

            {selectedUnitId === "all" ? (
              <div className="space-y-2" role="tabpanel" aria-label="전체 사업부 요약">
                {saleGroups.map((group) => (
                  <BusinessUnitSummaryRow
                    key={group.id}
                    group={group}
                    onClick={() => setSelectedUnitId(group.id)}
                  />
                ))}
                {!rows.length && (
                  <p className="rounded-xl bg-white/[0.045] p-4 text-center text-sm text-slate-300">
                    이 날짜의 매출이 없습니다.
                  </p>
                )}
              </div>
            ) : selectedGroup ? (
              <BusinessUnitTransactions group={selectedGroup} onOpenSale={onOpenSale} />
            ) : (
              <div className="[&_*]:text-slate-300">
                <EmptyState title="사업부 정보를 찾을 수 없습니다" description="전체 탭에서 다시 선택해 주세요." />
              </div>
            )}
          </div>
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

function UnitTab({
  active,
  onClick,
  children,
  dot,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
  dot?: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "inline-flex min-h-10 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300",
        active
          ? "bg-white text-[#173d65]"
          : "text-slate-300 hover:bg-white/[0.07] hover:text-white",
      )}
    >
      {dot && <span className={cn("h-1.5 w-1.5 rounded-full", dot)} aria-hidden="true" />}
      {children}
    </button>
  );
}

function groupStats(group: SaleGroup) {
  const activeRows = group.rows.filter((sale) => sale.status !== "cancelled");
  return {
    activeRows,
    cancelledCount: group.rows.length - activeRows.length,
    total: activeRows.reduce(
      (sum, sale) => sum + finalSaleAmount(sale),
      0,
    ),
  };
}

function BusinessUnitSummaryRow({
  group,
  onClick,
}: {
  group: SaleGroup;
  onClick: () => void;
}) {
  const tone = businessUnitTone(group.code);
  const stats = groupStats(group);
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex min-h-16 w-full items-center justify-between gap-3 rounded-xl border bg-white/[0.035] px-4 py-3 text-left transition-colors hover:bg-white/[0.07] focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300",
        tone.border,
      )}
    >
      <span className="inline-flex min-w-0 items-center gap-2.5">
        <span className={cn("h-2 w-2 shrink-0 rounded-full", tone.dot)} aria-hidden="true" />
        <span className="min-w-0">
          <strong className="block truncate text-sm text-white">{group.name}</strong>
          <span className="mt-1 block text-[11px] text-slate-300">
            {stats.activeRows.length.toLocaleString("ko-KR")}건
            {stats.cancelledCount > 0
              ? ` · 취소 ${stats.cancelledCount.toLocaleString("ko-KR")}건`
              : ""}
          </span>
        </span>
      </span>
      <strong className="shrink-0 whitespace-nowrap text-sm text-white tabular-nums">
        {won(stats.total)}
      </strong>
    </button>
  );
}

function BusinessUnitTransactions({
  group,
  onOpenSale,
}: {
  group: SaleGroup;
  onOpenSale: (saleId: string) => void;
}) {
  const tone = businessUnitTone(group.code);
  const stats = groupStats(group);
  return (
    <section
      aria-labelledby={`dashboard-date-unit-${group.id}`}
      className={cn("overflow-hidden rounded-2xl border", tone.border)}
      role="tabpanel"
    >
      <div className={cn("flex items-center justify-between gap-3 border-b px-4 py-3", tone.header, tone.border)}>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={cn("h-2 w-2 shrink-0 rounded-full", tone.dot)} aria-hidden="true" />
            <h3 id={`dashboard-date-unit-${group.id}`} className="truncate text-sm font-bold text-white">
              {group.name}
            </h3>
          </div>
          <p className="mt-1 text-[11px] text-slate-300">
            유효 {stats.activeRows.length.toLocaleString("ko-KR")}건
            {stats.cancelledCount > 0
              ? ` · 취소 ${stats.cancelledCount.toLocaleString("ko-KR")}건`
              : ""}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <span className="block text-[10px] font-semibold text-slate-300">사업부 판매</span>
          <strong className="mt-1 block whitespace-nowrap text-sm text-white tabular-nums">
            {won(stats.total)}
          </strong>
        </div>
      </div>

      {group.rows.length ? (
        <div className="space-y-2 p-2.5">
          {group.rows.map((sale) => (
            <button
              key={sale.id}
              type="button"
              onClick={() => onOpenSale(sale.id)}
              className="group block min-h-11 w-full rounded-xl border border-white/10 bg-white/[0.045] p-3.5 text-left transition-[transform,border-color,background-color] duration-200 hover:-translate-y-px hover:border-blue-300/35 hover:bg-white/[0.075] focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
            >
              <span className="flex flex-col items-stretch gap-2 min-[430px]:flex-row min-[430px]:items-start min-[430px]:justify-between min-[430px]:gap-3">
                <span className="min-w-0">
                  <strong className="block break-keep text-base leading-6 text-white">
                    {sale.dogName || "(반려견 없음)"}
                  </strong>
                  <span className="mt-1 block break-keep text-sm leading-5 text-slate-200">
                    {sale.customerName || "보호자 미등록"}
                  </span>
                  <span className="mt-1.5 block break-keep text-xs leading-5 text-slate-300">
                    {sale.productName} · {paymentLabels[sale.paymentMethod] || sale.paymentMethod}
                  </span>
                </span>
                <span className="shrink-0 self-end text-right">
                  <strong className="block whitespace-nowrap text-base text-white tabular-nums">
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
        <p className="p-5 text-center text-sm text-slate-300">이 사업부의 매출이 없습니다.</p>
      )}
    </section>
  );
}

function businessUnitTone(code: string) {
  if (code === "daycare") {
    return {
      border: "border-sky-300/20",
      header: "bg-sky-300/[0.08]",
      dot: "bg-sky-300",
    };
  }
  if (code === "training") {
    return {
      border: "border-violet-300/20",
      header: "bg-violet-300/[0.08]",
      dot: "bg-violet-300",
    };
  }
  if (code === "hotel") {
    return {
      border: "border-amber-300/20",
      header: "bg-amber-300/[0.08]",
      dot: "bg-amber-300",
    };
  }
  return {
    border: "border-slate-300/20",
    header: "bg-slate-300/[0.08]",
    dot: "bg-slate-300",
  };
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
