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
import {
  dashboardThemeCode,
  dashboardThemeMap,
  dashboardThemeStyle,
  type DashboardThemeCode,
} from "./dashboardTheme";

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
  themeCode,
  summary,
  rows,
  payments,
  refunds,
  paymentMethodTotals,
  units,
  onClose,
  onOpenSale,
  onOpenSales,
}: {
  open: boolean;
  date: string;
  unitName: string;
  themeCode: DashboardThemeCode;
  summary: DailyRevenue;
  rows: DashboardSale[];
  payments: Array<{
    payment: PaymentLedgerEntry;
    sale: DashboardSale;
  }>;
  refunds: Array<{
    id: string;
    amount: number;
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
  const visiblePayments = useMemo(
    () =>
      selectedUnitId === "all"
        ? payments
        : payments.filter(
            ({ sale }) => sale.businessUnitId === selectedUnitId,
          ),
    [payments, selectedUnitId],
  );
  const visibleRefunds = useMemo(
    () =>
      selectedUnitId === "all"
        ? refunds
        : refunds.filter(({ sale }) => sale.businessUnitId === selectedUnitId),
    [refunds, selectedUnitId],
  );
  const visiblePaymentMethodTotals = useMemo(() => {
    if (selectedUnitId === "all") return paymentMethodTotals;
    const totals = new Map<string, number>();
    visiblePayments.forEach(({ payment }) => {
      const method = payment.paymentMethod || "other";
      totals.set(method, (totals.get(method) ?? 0) + payment.amount);
    });
    return totals;
  }, [paymentMethodTotals, selectedUnitId, visiblePayments]);

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
        data-dashboard-theme={themeCode}
        style={dashboardThemeStyle(themeCode)}
        className="dashboard-date-drawer pm-modal-panel fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l text-white shadow-[var(--pm-shadow-modal)] sm:w-[min(480px,44vw)]"
      >
        <div className="dashboard-drawer-header flex shrink-0 items-start justify-between gap-3 border-b px-4 py-[7px] sm:px-5">
          <div className="flex min-w-0 items-start gap-3">
            <span className="dashboard-drawer-icon flex h-8 w-8 shrink-0 items-center justify-center rounded-lg">
              <CalendarDays size={17} />
            </span>
            <div className="min-w-0">
              <h2 id={titleId} className="text-lg font-bold tracking-[-0.025em] text-white tabular-nums">
                {date}
              </h2>
              <p className="dashboard-drawer-accent-text mt-0.5 break-keep text-sm font-semibold leading-5">
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
            className="dashboard-drawer-control flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-300 transition-colors hover:text-white focus:outline-none focus-visible:ring-2"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain">
          <div className="dashboard-drawer-summary sticky top-0 z-10 border-b p-2 backdrop-blur sm:px-5 sm:py-2.5">
          <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.035] p-2 text-white sm:p-2.5">
            <p className="dashboard-drawer-accent-text text-xs font-semibold">판매금액</p>
            <strong className="mt-0.5 block whitespace-nowrap text-[clamp(1.6rem,7vw,2.3rem)] font-bold tracking-[-0.045em] text-white tabular-nums">
              {won(summary.salesAmount)}
            </strong>
            <div className="mt-1.5 grid grid-cols-1 gap-1 border-t border-white/[0.08] pt-1.5 min-[430px]:grid-cols-3 min-[430px]:gap-2">
              <Summary label="실수납" value={won(summary.revenue)} />
              <Summary label="현재 미수" value={won(summary.outstanding)} warning={summary.outstanding > 0} />
              <Summary label="환불" value={won(summary.refund)} warning={summary.refund > 0} />
            </div>
          </div>
          </div>

          <div className="p-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))] sm:p-5">
          <div>
            <div className="-mx-1 mb-2 overflow-x-auto px-1 pb-1">
              <div className="flex min-w-max gap-1 rounded-xl bg-white/[0.045] p-0.5" role="tablist" aria-label="날짜 상세 사업부">
                <UnitTab active={selectedUnitId === "all"} onClick={() => setSelectedUnitId("all")}>
                  전체
                </UnitTab>
                {saleGroups.map((group) => (
                  <UnitTab
                    key={group.id}
                    active={selectedUnitId === group.id}
                    onClick={() => setSelectedUnitId(group.id)}
                    dotColor={dashboardThemeMap[dashboardThemeCode(group.code, group.name)].accent}
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
              <div className="space-y-5">
                <UnitLedgerSections
                  payments={visiblePayments}
                  refunds={visibleRefunds}
                  paymentMethodTotals={visiblePaymentMethodTotals}
                  onOpenSale={onOpenSale}
                />
                <BusinessUnitTransactions group={selectedGroup} onOpenSale={onOpenSale} />
              </div>
            ) : (
              <div className="[&_*]:text-slate-300">
                <EmptyState title="사업부 정보를 찾을 수 없습니다" description="전체 탭에서 다시 선택해 주세요." />
              </div>
            )}
          </div>
          </div>
        </div>

        <div className="shrink-0 border-t border-white/[0.08] bg-[#142b46] p-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] sm:px-5">
          <Button type="button" variant="secondary" className="h-[34px] min-h-[34px] w-full border-white/10 bg-white/[0.055] py-1 text-slate-200 hover:bg-white/[0.09] hover:text-white" onClick={onOpenSales}>
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
  dotColor,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
  dotColor?: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "dashboard-drawer-tab inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2",
        active
          ? "dashboard-drawer-tab-active bg-white"
          : "text-slate-300 hover:bg-white/[0.07] hover:text-white",
      )}
    >
      {dotColor && <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: dotColor }} aria-hidden="true" />}
      {children}
    </button>
  );
}

function UnitLedgerSections({
  payments,
  refunds,
  paymentMethodTotals,
  onOpenSale,
}: {
  payments: Array<{
    payment: PaymentLedgerEntry;
    sale: DashboardSale;
  }>;
  refunds: Array<{
    id: string;
    amount: number;
    sale: DashboardSale;
  }>;
  paymentMethodTotals: Map<string, number>;
  onOpenSale: (saleId: string) => void;
}) {
  return (
    <>
      <section aria-labelledby="dashboard-date-payments-title">
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <h3 id="dashboard-date-payments-title" className="font-semibold text-white">수납 내역</h3>
            <p className="mt-1 text-xs text-slate-300">결제일 기준 유효 결제원장</p>
          </div>
          <span className="text-xs font-semibold text-blue-100">
            {payments.length.toLocaleString("ko-KR")}건
          </span>
        </div>
        {paymentMethodTotals.size > 0 && (
          <dl className="mb-3 flex flex-wrap gap-x-4 gap-y-2 border-y border-white/10 py-3">
            {[...paymentMethodTotals.entries()].map(([method, amount]) => (
              <div key={method} className="min-w-0">
                <dt className="text-[10px] text-slate-300">{paymentLabels[method] || method}</dt>
                <dd className="mt-0.5 whitespace-nowrap text-xs font-semibold text-white tabular-nums">{won(amount)}</dd>
              </div>
            ))}
          </dl>
        )}
        {payments.length > 0 ? (
          <div className="space-y-2">
            {payments.map(({ payment, sale }) => (
              <button
                key={payment.id}
                type="button"
                onClick={() => onOpenSale(sale.id)}
                className="flex min-h-10 w-full flex-col items-stretch gap-1 rounded-xl border border-white/10 bg-white/[0.045] px-3 py-2 text-left transition-colors hover:border-blue-300/35 hover:bg-white/[0.075] focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 min-[430px]:flex-row min-[430px]:items-center min-[430px]:justify-between min-[430px]:gap-3"
              >
                <span className="min-w-0">
                  <strong className="block break-keep text-sm leading-5 text-white">
                    {sale.dogName || "(반려견 없음)"} · {sale.customerName || "보호자 미등록"}
                  </strong>
                  <span className="mt-1 line-clamp-2 text-xs leading-5 text-slate-300">
                    {sale.productName} · {paymentLabels[payment.paymentMethod || "other"] || payment.paymentMethod}
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
          <p className="rounded-xl bg-white/[0.04] p-4 text-center text-sm text-slate-300">
            이 사업부의 수납 내역이 없습니다.
          </p>
        )}
      </section>

      <section aria-labelledby="dashboard-date-refunds-title">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 id="dashboard-date-refunds-title" className="font-semibold text-white">환불 내역</h3>
          <span className="text-xs font-semibold text-rose-200">
            {refunds.length.toLocaleString("ko-KR")}건
          </span>
        </div>
        {refunds.length > 0 ? (
          <div className="space-y-2">
            {refunds.map(({ id, amount, sale }) => (
              <button
                key={id}
                type="button"
                onClick={() => onOpenSale(sale.id)}
                className="flex min-h-10 w-full items-center justify-between gap-3 rounded-xl border border-rose-200/15 bg-rose-100/[0.045] px-3 py-2 text-left transition-colors hover:border-rose-200/30 hover:bg-rose-100/[0.075] focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-200"
              >
                <span className="min-w-0">
                  <strong className="block truncate text-sm text-white">
                    {sale.dogName || "(반려견 없음)"} · {sale.customerName || "보호자 미등록"}
                  </strong>
                  <span className="mt-1 block line-clamp-2 text-xs leading-5 text-slate-300">
                    {sale.productName}
                  </span>
                </span>
                <strong className="shrink-0 whitespace-nowrap text-sm text-rose-200 tabular-nums">
                  -{won(amount)}
                </strong>
              </button>
            ))}
          </div>
        ) : (
          <p className="rounded-xl bg-white/[0.04] p-4 text-center text-sm text-slate-300">
            이 사업부의 환불 내역이 없습니다.
          </p>
        )}
      </section>
    </>
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
  const stats = groupStats(group);
  const themeCode = dashboardThemeCode(group.code, group.name);
  return (
    <button
      type="button"
      onClick={onClick}
      style={dashboardThemeStyle(themeCode)}
      className="dashboard-drawer-unit-row flex min-h-14 w-full items-center justify-between gap-3 rounded-xl border bg-white/[0.035] px-3.5 py-[0.5625rem] text-left transition-colors focus:outline-none focus-visible:ring-2"
    >
      <span className="inline-flex min-w-0 items-center gap-2.5">
        <span className="dashboard-theme-dot h-2 w-2 shrink-0 rounded-full" aria-hidden="true" />
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
  const stats = groupStats(group);
  const themeCode = dashboardThemeCode(group.code, group.name);
  return (
    <section
      aria-labelledby={`dashboard-date-unit-${group.id}`}
      style={dashboardThemeStyle(themeCode)}
      className="dashboard-drawer-unit-section overflow-hidden rounded-2xl border"
      role="tabpanel"
    >
      <div className="dashboard-drawer-unit-header flex items-center justify-between gap-3 border-b px-3.5 py-2.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="dashboard-theme-dot h-2 w-2 shrink-0 rounded-full" aria-hidden="true" />
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
        <div className="space-y-1 p-1.5">
          {group.rows.map((sale) => (
            <button
              key={sale.id}
              type="button"
              onClick={() => onOpenSale(sale.id)}
              className="group block min-h-10 w-full rounded-xl border border-white/10 bg-white/[0.045] p-2 text-left transition-[transform,border-color,background-color] duration-200 hover:-translate-y-px hover:border-blue-300/35 hover:bg-white/[0.075] focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
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
              <span className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-white/10 pt-2">
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
