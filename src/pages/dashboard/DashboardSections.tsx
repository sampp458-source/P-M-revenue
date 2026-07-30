import { AlertCircle, ArrowRight, BedDouble, Building2, CalendarDays, GraduationCap, PawPrint, ReceiptText, Target, TrendingUp } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button, Card, EmptyState, Select, Skeleton, StatusBadge, cn } from "../../components/ui";
import { monthLabel, shortWon, won } from "../../lib/format";
import { formatRevenueComparison, type BusinessUnitOption, type DashboardSale } from "./dashboardMetrics";
import {
  dashboardThemeCode,
  dashboardThemeStyle,
} from "./dashboardTheme";

export function DashboardFilters({ month, unitId, months, units, onMonth, onUnit }: { month: string; unitId: string; months: string[]; units: BusinessUnitOption[]; onMonth: (value: string) => void; onUnit: (value: string) => void }) {
  return <Card className="mb-5 overflow-hidden"><div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-end sm:p-5"><div className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary sm:flex"><CalendarDays size={20} /></div><label className="block flex-1"><span className="mb-1.5 block text-xs font-semibold text-text-secondary">조회 월</span><Select aria-label="대시보드 조회 월" value={month} onChange={(event) => onMonth(event.target.value)}>{months.map((value) => <option key={value} value={value}>{monthLabel(value)}</option>)}</Select></label><label className="block flex-1"><span className="mb-1.5 block text-xs font-semibold text-text-secondary">사업부</span><Select aria-label="대시보드 사업부" value={unitId} onChange={(event) => onUnit(event.target.value)}><option value="">전체 사업부</option>{units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</Select></label><div className="rounded-xl border border-primary/10 bg-primary-subtle px-4 py-2.5 text-sm text-text-secondary sm:min-w-44"><span className="block text-[11px] font-medium">현재 조회</span><strong className="text-text-primary">{monthLabel(month)}</strong></div></div></Card>;
}

export function MetricCard({ label, value, description, progress, featured = false, tone = "default" }: { label: string; value: string; description?: string; progress?: number; featured?: boolean; tone?: "default" | "primary" | "progress" }) {
  const icon = tone === "progress" ? <Target size={19} /> : tone === "primary" ? <CalendarDays size={19} /> : <TrendingUp size={17} />;
  return <Card className={cn("group relative overflow-hidden transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 hover:border-primary/20 hover:shadow-[0_14px_34px_rgba(23,36,58,0.08)]", featured ? "min-h-44 p-6" : "min-h-32 p-5", tone === "primary" && "border-primary/15 bg-[linear-gradient(145deg,#274c77,#1e3f65)] text-white", tone === "progress" && "border-primary/15 bg-primary-subtle")}><div className={cn("absolute -right-10 -top-12 h-28 w-28 rounded-full transition-transform duration-200 group-hover:scale-110", tone === "primary" ? "bg-white/[0.06]" : "bg-primary/[0.035]")} /><div className="relative"><div className="flex items-center justify-between gap-3"><p className={cn("font-semibold", featured ? "text-sm" : "text-xs", tone === "primary" ? "text-blue-100/80" : "text-text-secondary")}>{label}</p><span className={cn("flex items-center justify-center rounded-xl", featured ? "h-10 w-10" : "h-8 w-8", tone === "primary" ? "bg-white/10 text-white" : "bg-primary-soft text-primary")}>{icon}</span></div><p className={cn("font-bold tracking-[-0.035em]", featured ? "mt-5 text-[1.8rem] sm:text-[2rem]" : "mt-3 text-[1.35rem]", tone === "primary" ? "text-white" : "text-text-primary")}>{value}</p>{progress !== undefined && <div className="mt-4 h-2 overflow-hidden rounded-full bg-primary/10" role="progressbar" aria-label={`${label} 진행률`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.max(0, progress))}><div className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out" style={{ width: `${Math.min(100, Math.max(0, progress))}%` }} /></div>}{description && <p className={cn("mt-2 text-xs leading-5", tone === "primary" ? "text-blue-100/65" : "text-text-muted")}>{description}</p>}</div></Card>;
}

export function DashboardKpiHero({
  periodLabel,
  compareLabel,
  salesAmount,
  previousSalesAmount,
  paidAmount,
  previousPaidAmount,
  count,
  monthlyTarget,
  outstanding,
  refund,
  onSales,
  onPayments,
  onRefunds,
  onNet,
  onOutstanding,
  showComparison = true,
  outstandingLabel = "현재 전체 미수",
  outstandingDescription = "현재 시점에 남아 있는 미수 잔액",
  outstandingActionLabel = "현재 미수금 목록 열기",
}: {
  periodLabel: string;
  compareLabel: string;
  salesAmount: number;
  previousSalesAmount: number;
  paidAmount: number;
  previousPaidAmount: number;
  count: number;
  monthlyTarget: number | null;
  outstanding: number;
  refund: number;
  onSales: () => void;
  onPayments: () => void;
  onRefunds: () => void;
  onNet: () => void;
  onOutstanding?: () => void;
  showComparison?: boolean;
  outstandingLabel?: string;
  outstandingDescription?: string;
  outstandingActionLabel?: string;
}) {
  const salesComparison = formatRevenueComparison(
    salesAmount,
    previousSalesAmount,
  );
  const netComparison = formatRevenueComparison(
    paidAmount,
    previousPaidAmount,
  );
  const items = [
    {
      label: `${periodLabel} 판매금액`,
      value: won(salesAmount),
      description: `${periodLabel} 발생한 전체 판매 · 미수 포함 · ${count.toLocaleString("ko-KR")}건`,
      signalLabel: showComparison ? `${compareLabel} 대비` : "",
      signal: showComparison ? salesComparison : "",
      className: "bg-white",
      labelClass: "text-primary",
      valueClass: "text-text-primary",
      descriptionClass: "text-text-secondary",
      signalClass: salesComparison.startsWith("▼")
        ? "text-error"
        : salesComparison.startsWith("—")
          ? "text-text-secondary"
          : "text-primary",
      actionLabel: "판매 거래 목록 열기",
      onClick: onSales,
    },
    {
      label: `${periodLabel} 실수납`,
      value: won(paidAmount),
      description: `${periodLabel} 실제 입금 · 이전 미수 회수 포함`,
      signalLabel: showComparison ? `${compareLabel} 대비` : "",
      signal: showComparison ? netComparison : "",
      className: "border-primary/15 bg-primary-subtle",
      labelClass: "text-primary",
      valueClass: "text-text-primary",
      descriptionClass: "text-text-secondary",
      signalClass: netComparison.startsWith("▼")
        ? "text-error"
        : netComparison.startsWith("—")
          ? "text-text-secondary"
          : "text-primary",
      targetText: showComparison
        ? monthlyTarget === null
          ? "목표 미설정"
          : monthlyTarget > 0
            ? `목표 대비 ${((paidAmount / monthlyTarget) * 100).toFixed(1)}%`
            : "목표 미설정"
        : "",
      actionLabel: "결제 원장 열기",
      onClick: onPayments,
    },
    {
      label: `${periodLabel} 환불`,
      value: won(refund),
      description: `${periodLabel} 실제 환불 · 환불일 기준`,
      className: "border-error/15 bg-error-soft/65",
      labelClass: "text-error",
      valueClass: "text-text-primary",
      descriptionClass: "text-text-secondary",
      signalLabel: "",
      signal: "",
      signalClass: "",
      actionLabel: "환불 원장 열기",
      onClick: onRefunds,
    },
    {
      label: outstandingLabel,
      value: won(outstanding),
      description: outstandingDescription,
      className: "border-warning/15 bg-warning-soft/70",
      labelClass: "text-warning",
      valueClass: "text-text-primary",
      descriptionClass: "text-text-secondary",
      signalLabel: "",
      signal: "",
      signalClass: "",
      actionLabel: outstandingActionLabel,
      onClick: onOutstanding,
    },
  ];

  return (
    <div className="space-y-4">
      <Card className="dashboard-surface dashboard-hero-surface relative overflow-hidden p-0 shadow-none">
        <span className="dashboard-hero-accent absolute inset-y-4 left-0 w-1 rounded-r-full" aria-hidden="true" />
        <button
          type="button"
          aria-label="결제·환불 통합 원장 열기"
          onClick={onNet}
          className="absolute inset-0 z-10 rounded-[inherit] transition-colors duration-200 hover:bg-primary/[0.025] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
        />
        <div className="relative flex flex-col gap-4.5 px-6 py-5 sm:px-8 sm:py-6 xl:flex-row xl:items-end xl:justify-between xl:gap-14 xl:px-9">
          <div className="min-w-0">
            <p className="text-[11px] font-bold tracking-[0.04em] text-primary">
              {periodLabel} 순수납
            </p>
            <strong className="dashboard-hero-number mt-2 block whitespace-nowrap font-bold leading-none text-[#234f79]">
              {won(paidAmount - refund)}
            </strong>
            <p className="mt-2.5 text-[13px] leading-5 text-[#66758a]">실제 입금에서 환불을 뺀 순유입</p>
          </div>
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-1 border-t border-primary/[0.08] pt-4 text-sm xl:justify-end xl:border-l xl:border-t-0 xl:py-1.5 xl:pl-9">
            <span className="text-[#66758a]">실수납</span>
            <strong className="whitespace-nowrap text-text-primary tabular-nums">{won(paidAmount)}</strong>
            <span className="text-[#9aa5b3]">−</span>
            <span className="text-[#66758a]">환불</span>
            <strong className="whitespace-nowrap text-error tabular-nums">{won(refund)}</strong>
            <span className="text-[#9aa5b3]">=</span>
            <strong className="whitespace-nowrap text-primary tabular-nums">{won(paidAmount - refund)}</strong>
          </div>
        </div>
      </Card>
      <div className="!mt-4 grid items-stretch gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {items.map((item) => (
          <Card
            key={item.label}
            className={cn(
              "dashboard-surface dashboard-supporting-surface dashboard-kpi-card relative flex h-full min-h-40 min-w-0 flex-col p-5 shadow-none transition-[border-color,background-color,box-shadow,transform] duration-200 hover:-translate-y-px hover:border-primary/20 sm:min-h-44 sm:p-6",
              item.className,
            )}
          >
            {item.onClick && (
              <button
                type="button"
                aria-label={item.actionLabel}
                onClick={item.onClick}
                className="absolute inset-0 z-10 rounded-[inherit] transition-colors duration-200 hover:bg-primary/[0.025] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
              />
            )}
            <p className={cn("min-h-5 text-xs font-semibold leading-5", item.labelClass)}>
              {item.label}
            </p>
            <strong
              className={cn(
                "dashboard-card-number mt-3.5 block whitespace-nowrap font-bold leading-none",
                item.valueClass,
              )}
            >
              {item.value}
            </strong>
            <div className="mt-2 min-h-10">
              {item.signal && (
                <p className="flex flex-wrap items-center gap-x-1.5 text-[11px] font-semibold leading-4">
                  <span className={item.descriptionClass}>{item.signalLabel}</span>
                  <span className={item.signalClass}>{item.signal}</span>
                </p>
              )}
              {item.targetText && (
                <span className="mt-1 block text-[11px] font-semibold leading-4 text-primary">
                  {item.targetText}
                </span>
              )}
            </div>
            <p className={cn("mt-auto pt-3.5 text-[13px] leading-5", item.descriptionClass)}>
              {item.description}
            </p>
          </Card>
        ))}
      </div>
    </div>
  );
}

export function BusinessUnitCard({
  order,
  code,
  name,
  revenue,
  receivedAmount,
  refundAmount,
  outstandingAmount,
  outstandingLabel = "현재 미수",
  restricted = false,
  selected = false,
  muted = false,
  onClick,
}: {
  order: number;
  code: string;
  name: string;
  revenue: number;
  receivedAmount: number;
  refundAmount: number;
  outstandingAmount: number;
  outstandingLabel?: string;
  restricted?: boolean;
  selected?: boolean;
  muted?: boolean;
  onClick?: () => void;
}) {
  const netAmount = receivedAmount - refundAmount;
  const themeCode = dashboardThemeCode(code, name);
  return (
    <div className="h-full" style={dashboardThemeStyle(themeCode)}>
      <Card
        className={cn(
          "dashboard-surface dashboard-business-card group relative h-full min-h-[20rem] overflow-hidden p-0 shadow-none transition-[transform,border-color,background-color,box-shadow,opacity] duration-200 ease-out hover:-translate-y-0.5",
          selected && "dashboard-business-card-selected",
          muted && "dashboard-business-card-muted",
        )}
      >
      <span className="dashboard-unit-accent absolute inset-x-6 top-0 h-1 rounded-b-full opacity-90" aria-hidden="true" />
      <button
        type="button"
        className="relative flex min-h-[20rem] w-full flex-col p-5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary sm:p-6"
        aria-pressed={selected}
        onClick={onClick}
      >
        <span className="flex items-center justify-between gap-3">
          <span className="inline-flex min-w-0 items-center gap-2.5">
            <span className="dashboard-unit-symbol flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border" aria-hidden="true">
              {businessUnitIcon(code)}
            </span>
            <span className="truncate text-base font-bold text-text-primary">{name}</span>
          </span>
          <span className="dashboard-unit-label inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold tracking-[0.08em]">
            <Building2 size={12} />
            0{order}
          </span>
        </span>

        <span className="mt-8 block">
          <span className="text-xs font-semibold text-text-secondary">
            {restricted ? "선택 날짜 순수납" : "선택 기간 순수납"}
          </span>
          <strong className="dashboard-section-number mt-2 block whitespace-nowrap font-bold text-primary">
            {won(netAmount)}
          </strong>
          <span className="mt-2 block text-[11px] leading-5 text-text-muted">
            실수납에서 환불을 뺀 금액
          </span>
        </span>

        <span className="mt-auto grid grid-cols-2 gap-x-4 gap-y-4 border-t border-border/60 pt-4">
          <BusinessMetric label="판매금액" value={revenue} />
          <BusinessMetric label="실수납" value={receivedAmount} />
          <BusinessMetric label="환불" value={refundAmount} danger />
          <BusinessMetric label={outstandingLabel} value={outstandingAmount} warning />
        </span>
      </button>
      </Card>
    </div>
  );
}

function BusinessMetric({
  label,
  value,
  danger = false,
  warning = false,
}: {
  label: string;
  value: number;
  danger?: boolean;
  warning?: boolean;
}) {
  return (
    <span className="min-w-0">
      <span className="block text-[13px] font-medium leading-4 text-[#667085]">{label}</span>
      <strong
        className={cn(
          "mt-1.5 block whitespace-nowrap text-[clamp(0.9375rem,3.5vw,1.0625rem)] font-bold leading-5 tracking-[-0.025em] text-[#475467] tabular-nums",
          danger && value > 0 && "text-error",
          warning && value > 0 && "text-warning",
        )}
      >
        {won(value)}
      </strong>
    </span>
  );
}

function businessUnitIcon(code: string) {
  if (code === "daycare") return <PawPrint size={17} strokeWidth={1.9} />;
  if (code === "training") return <GraduationCap size={17} strokeWidth={1.9} />;
  if (code === "hotel") return <BedDouble size={17} strokeWidth={1.9} />;
  return <Building2 size={17} strokeWidth={1.9} />;
}

export function RecentSales({ rows, onOpen }: { rows: DashboardSale[]; onOpen: () => void }) {
  return <Card className="dashboard-activity-surface overflow-hidden p-0 shadow-none"><div className="flex items-center justify-between gap-4 px-5 pb-2.5 pt-3.5 sm:px-6 sm:pb-3 sm:pt-4"><div><h2 className="dashboard-section-title font-bold text-text-primary">최근 매출</h2><p className="mt-0.5 text-[11px] leading-4 text-[#7b8798]">선택 조건의 최신 등록 5건</p></div><Button aria-label="매출 내역으로 이동" variant="ghost" onClick={onOpen}>전체 거래 보기 <ArrowRight size={16} /></Button></div>{rows.length ? <div className="dashboard-activity-list px-3 pb-3 sm:px-4 sm:pb-4">{rows.map((sale) => { const themeCode = dashboardThemeCode(null, sale.businessUnitName); return <button key={sale.id} type="button" style={dashboardThemeStyle(themeCode)} className="dashboard-activity-row group relative grid min-h-[70px] w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-[background-color] duration-200 focus:outline-none focus-visible:ring-2 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:gap-4 sm:px-4" onClick={onOpen}><span className="dashboard-activity-symbol dashboard-unit-symbol relative z-[1] flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border"><ReceiptText size={16} /><span className="dashboard-theme-dot absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-white" aria-hidden="true" /><span className="sr-only">{sale.businessUnitName}</span></span><span className="min-w-0"><span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1"><strong className="max-w-full truncate text-sm font-bold text-text-primary">{sale.dogName || "(반려견 없음)"}</strong><StatusBadge status={sale.status as "normal" | "partial_refund" | "full_refund" | "cancelled"} tone={sale.status === "cancelled" ? "gray" : undefined} /></span><span className="mt-0.5 block truncate text-xs leading-5 text-text-secondary">{sale.productName}</span><span className="mt-0.5 block truncate text-[11px] leading-4 text-text-muted">{sale.customerName || "보호자 미등록"} · {paymentLabel(sale.paymentMethod)} · {activityDateLabel(sale.saleDate)}</span></span><span className="col-span-2 flex min-w-0 items-center justify-between gap-2 pl-12 sm:col-span-1 sm:block sm:pl-0 sm:text-right"><span className="text-[10px] font-semibold text-text-muted sm:hidden">{sale.businessUnitName}</span><strong className="dashboard-theme-text whitespace-nowrap text-base font-bold tabular-nums">{won(sale.netAmount)}</strong></span></button>; })}</div> : <EmptyState title="등록된 매출이 없습니다." />}</Card>;
}

function paymentLabel(method: string) {
  if (method === "card") return "카드";
  if (method === "transfer") return "계좌이체";
  if (method === "cash") return "현금";
  if (method === "outstanding") return "미수";
  return "기타";
}

function activityDateLabel(date: string) {
  const [, month, day] = date.split("-");
  return `${Number(month)}월 ${Number(day)}일`;
}

export function OperationalAlerts({ alerts, onOpen }: { alerts: { outstandingCount: number; outstandingTotal: number; refundCount: number; refundTotal: number; cancelledCount: number; todayCount: number }; onOpen: () => void }) {
  const items = [
    { label: "미수금", value: `${alerts.outstandingCount}건 · ${won(alerts.outstandingTotal)}` },
    { label: "이번 달 환불", value: `${alerts.refundCount}건 · ${won(alerts.refundTotal)}` },
    { label: "이번 달 취소", value: `${alerts.cancelledCount}건` },
    { label: "오늘 등록", value: `${alerts.todayCount}건` },
  ];
  return <Card className="p-5 sm:p-6"><div className="mb-4 flex items-center gap-2"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-warning-soft text-warning"><AlertCircle size={18} /></span><div><h2 className="font-semibold text-text-primary">확인 필요</h2><p className="text-xs text-text-muted">운영 중 확인할 보조 지표</p></div></div><div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">{items.map((item) => <button key={item.label} type="button" onClick={onOpen} className="rounded-xl border border-border bg-surface-secondary p-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/20 hover:bg-primary-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"><span className="block text-xs text-text-muted">{item.label}</span><strong className="mt-1.5 block text-sm text-text-primary">{item.value}</strong></button>)}</div></Card>;
}

export function RevenueTrend({ data }: { data: { key: string; month: string; amount: number }[] }) {
  return <Card className="p-5"><div className="mb-4"><h2 className="font-semibold">최근 12개월 실매출 추이</h2><p className="mt-1 text-xs text-slate-500">취소 매출 제외 · 매출 없는 월 포함</p></div><div className="h-72 w-full" aria-label="최근 12개월 실매출 막대그래프"><ResponsiveContainer width="100%" height="100%"><BarChart data={data} margin={{ left: 0, right: 4 }}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="month" tick={{ fontSize: 12 }} /><YAxis tickFormatter={shortWon} tick={{ fontSize: 11 }} width={55} /><Tooltip labelFormatter={(_, payload) => payload[0]?.payload.key ?? ""} formatter={(value) => [won(Number(value)), "실매출"]} /><Bar dataKey="amount" name="실매출" fill="#274c77" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div></Card>;
}

export function BusinessUnitBreakdown({ rows, total }: { rows: { id: string; name: string; value: number }[]; total: number }) {
  return <Card className="p-5"><div className="mb-4"><h2 className="font-semibold">사업부별 실매출 구성</h2><p className="mt-1 text-xs text-slate-500">선택 월 전체 실매출 기준</p></div><div className="space-y-4">{rows.map((row) => { const ratio = total > 0 ? (row.value / total) * 100 : 0; return <div key={row.id}><div className="mb-1.5 flex justify-between gap-3 text-sm"><span className="font-medium">{row.name}</span><span className="text-slate-600">{won(row.value)} · {ratio.toFixed(1)}%</span></div><div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-[#6f8eae]" style={{ width: `${Math.min(100, Math.max(0, ratio))}%` }} /></div></div>; })}</div>{total === 0 && <div className="mt-5 flex items-center gap-2 rounded-lg bg-slate-50 p-3 text-sm text-slate-500"><ReceiptText size={16} />선택 월의 실매출이 없습니다.</div>}</Card>;
}

export function DashboardSkeleton() {
  return <div aria-label="대시보드 로딩 중" aria-busy="true"><Skeleton className="mb-6 h-16" /><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 8 }, (_, index) => <Skeleton key={index} className="h-36 border" />)}</div><Skeleton className="mt-4 h-72 border" /></div>;
}
