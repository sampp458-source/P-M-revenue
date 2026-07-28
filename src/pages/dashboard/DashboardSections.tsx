import { AlertCircle, ArrowRight, Building2, CalendarDays, ReceiptText, Target, TrendingUp } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Badge, Button, Card, EmptyState, Select, Skeleton, StatusBadge, Table, cn } from "../../components/ui";
import { monthLabel, shortWon, won } from "../../lib/format";
import { formatRevenueComparison, type BusinessUnitOption, type DashboardSale } from "./dashboardMetrics";

export function DashboardFilters({ month, unitId, months, units, onMonth, onUnit }: { month: string; unitId: string; months: string[]; units: BusinessUnitOption[]; onMonth: (value: string) => void; onUnit: (value: string) => void }) {
  return <Card className="mb-5 overflow-hidden"><div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-end sm:p-5"><div className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary sm:flex"><CalendarDays size={20} /></div><label className="block flex-1"><span className="mb-1.5 block text-xs font-semibold text-text-secondary">조회 월</span><Select aria-label="대시보드 조회 월" value={month} onChange={(event) => onMonth(event.target.value)}>{months.map((value) => <option key={value} value={value}>{monthLabel(value)}</option>)}</Select></label><label className="block flex-1"><span className="mb-1.5 block text-xs font-semibold text-text-secondary">사업부</span><Select aria-label="대시보드 사업부" value={unitId} onChange={(event) => onUnit(event.target.value)}><option value="">전체 사업부</option>{units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</Select></label><div className="rounded-xl border border-primary/10 bg-primary-subtle px-4 py-2.5 text-sm text-text-secondary sm:min-w-44"><span className="block text-[11px] font-medium">현재 조회</span><strong className="text-text-primary">{monthLabel(month)}</strong></div></div></Card>;
}

export function MetricCard({ label, value, description, progress, featured = false, tone = "default" }: { label: string; value: string; description?: string; progress?: number; featured?: boolean; tone?: "default" | "primary" | "progress" }) {
  const icon = tone === "progress" ? <Target size={19} /> : tone === "primary" ? <CalendarDays size={19} /> : <TrendingUp size={17} />;
  return <Card className={cn("group relative overflow-hidden transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 hover:border-primary/20 hover:shadow-[0_14px_34px_rgba(23,36,58,0.08)]", featured ? "min-h-44 p-6" : "min-h-32 p-5", tone === "primary" && "border-primary/15 bg-[linear-gradient(145deg,#274c77,#1e3f65)] text-white", tone === "progress" && "border-primary/15 bg-primary-subtle")}><div className={cn("absolute -right-10 -top-12 h-28 w-28 rounded-full transition-transform duration-200 group-hover:scale-110", tone === "primary" ? "bg-white/[0.06]" : "bg-primary/[0.035]")} /><div className="relative"><div className="flex items-center justify-between gap-3"><p className={cn("font-semibold", featured ? "text-sm" : "text-xs", tone === "primary" ? "text-blue-100/80" : "text-text-secondary")}>{label}</p><span className={cn("flex items-center justify-center rounded-xl", featured ? "h-10 w-10" : "h-8 w-8", tone === "primary" ? "bg-white/10 text-white" : "bg-primary-soft text-primary")}>{icon}</span></div><p className={cn("font-bold tracking-[-0.035em]", featured ? "mt-5 text-[1.8rem] sm:text-[2rem]" : "mt-3 text-[1.35rem]", tone === "primary" ? "text-white" : "text-text-primary")}>{value}</p>{progress !== undefined && <div className="mt-4 h-2 overflow-hidden rounded-full bg-primary/10" role="progressbar" aria-label={`${label} 진행률`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.max(0, progress))}><div className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out" style={{ width: `${Math.min(100, Math.max(0, progress))}%` }} /></div>}{description && <p className={cn("mt-2 text-xs leading-5", tone === "primary" ? "text-blue-100/65" : "text-text-muted")}>{description}</p>}</div></Card>;
}

export function DashboardKpiHero({
  periodLabel,
  rangeLabel,
  unitName,
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
}: {
  periodLabel: string;
  rangeLabel: string;
  unitName: string;
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
      signalLabel: `${compareLabel} 대비`,
      signal: salesComparison,
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
      signalLabel: `${compareLabel} 대비`,
      signal: netComparison,
      className: "border-primary/15 bg-primary-subtle",
      labelClass: "text-primary",
      valueClass: "text-text-primary",
      descriptionClass: "text-text-secondary",
      signalClass: netComparison.startsWith("▼")
        ? "text-error"
        : netComparison.startsWith("—")
          ? "text-text-secondary"
          : "text-primary",
      targetText:
        monthlyTarget === null
          ? "목표 미설정"
          : monthlyTarget > 0
            ? `목표 대비 ${((paidAmount / monthlyTarget) * 100).toFixed(1)}%`
            : "목표 미설정",
      actionLabel: "결제 원장 열기",
      onClick: onPayments,
    },
    {
      label: `${periodLabel} 환불`,
      value: won(refund),
      description: `${periodLabel} 실제 환불 · 환불일 기준`,
      className: "bg-error-soft/50",
      labelClass: "text-error",
      valueClass: "text-text-primary",
      descriptionClass: "text-text-muted",
      signalLabel: "",
      signal: "",
      signalClass: "",
      actionLabel: "환불 원장 열기",
      onClick: onRefunds,
    },
    {
      label: "현재 전체 미수",
      value: won(outstanding),
      description: "현재 시점에 남아 있는 미수 잔액",
      className: "bg-warning-soft/55",
      labelClass: "text-warning",
      valueClass: "text-text-primary",
      descriptionClass: "text-text-muted",
      signalLabel: "",
      signal: "",
      signalClass: "",
      actionLabel: "현재 미수금 목록 열기",
      onClick: onOutstanding,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 px-1.5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="dashboard-eyebrow text-[10px] font-bold uppercase text-primary">현재 적용 기준</p>
          <strong className="mt-1 block text-sm text-text-primary tabular-nums">{rangeLabel}</strong>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="blue">{periodLabel}</Badge>
          <Badge>{unitName}</Badge>
          <span className="text-xs text-text-muted">{compareLabel} 비교</span>
        </div>
      </div>
      <Card className="dashboard-surface dashboard-hero-surface relative overflow-hidden p-0 shadow-none">
        <button
          type="button"
          aria-label="결제·환불 통합 원장 열기"
          onClick={onNet}
          className="absolute inset-0 z-10 rounded-[inherit] transition-colors duration-200 hover:bg-primary/[0.025] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
        />
        <div className="relative flex flex-col gap-6 p-6 sm:p-8 lg:flex-row lg:items-end lg:justify-between lg:gap-12 lg:px-9 lg:py-8">
          <div className="min-w-0">
            <p className="text-[11px] font-bold tracking-[0.04em] text-primary">
              {periodLabel} 순수납
            </p>
            <strong className="dashboard-hero-number mt-2.5 block whitespace-nowrap font-bold text-[#234f79]">
              {won(paidAmount - refund)}
            </strong>
            <p className="mt-2.5 text-[13px] leading-5 text-[#778395]">실제 입금에서 환불을 뺀 순유입</p>
          </div>
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-1.5 border-t border-primary/[0.08] pt-5 text-[13px] lg:justify-end lg:border-l lg:border-t-0 lg:py-2.5 lg:pl-9">
            <span className="text-[#778395]">실수납</span>
            <strong className="whitespace-nowrap text-text-primary tabular-nums">{won(paidAmount)}</strong>
            <span className="text-[#9aa5b3]">−</span>
            <span className="text-[#778395]">환불</span>
            <strong className="whitespace-nowrap text-error tabular-nums">{won(refund)}</strong>
            <span className="text-[#9aa5b3]">=</span>
            <strong className="whitespace-nowrap text-primary tabular-nums">{won(paidAmount - refund)}</strong>
          </div>
        </div>
      </Card>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {items.map((item) => (
          <Card
            key={item.label}
            className={cn(
              "dashboard-surface dashboard-supporting-surface relative flex min-h-40 min-w-0 flex-col p-5 shadow-none transition-[border-color,background-color,transform] duration-200 hover:-translate-y-px hover:border-primary/20 sm:p-5",
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
            <p className={cn("text-xs font-semibold", item.labelClass)}>
              {item.label}
            </p>
            <strong
              className={cn(
                "dashboard-card-number mt-3 block whitespace-nowrap font-bold",
                item.valueClass,
              )}
            >
              {item.value}
            </strong>
            {item.signal && (
              <p className="mt-2 flex flex-wrap items-center gap-x-1.5 text-[11px] font-semibold">
                <span className={item.descriptionClass}>{item.signalLabel}</span>
                <span className={item.signalClass}>{item.signal}</span>
              </p>
            )}
            {item.targetText && (
              <span className="mt-2 text-[11px] font-semibold text-primary">
                {item.targetText}
              </span>
            )}
            <p className={cn("mt-auto pt-3 text-xs leading-5", item.descriptionClass)}>
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
  restricted?: boolean;
  selected?: boolean;
  muted?: boolean;
  onClick?: () => void;
}) {
  const netAmount = receivedAmount - refundAmount;
  const tone = businessUnitCardTone(code);
  return (
    <Card
      className={cn(
        "dashboard-surface dashboard-business-card group relative h-full min-h-[20rem] overflow-hidden p-0 shadow-none transition-[transform,border-color,background-color] duration-200 ease-out hover:-translate-y-0.5 hover:border-primary/25",
        tone.card,
        selected && "border-primary/30 bg-primary-subtle/60 ring-2 ring-primary/10",
        muted && "opacity-60 hover:opacity-100",
      )}
    >
      <span className="dashboard-unit-accent absolute inset-x-6 top-0 h-[3px] rounded-b-full opacity-80" aria-hidden="true" />
      <button
        type="button"
        className="relative flex min-h-[20rem] w-full flex-col p-5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary sm:p-6"
        aria-pressed={selected}
        onClick={onClick}
      >
        <span className="flex items-center justify-between gap-3">
          <span className="inline-flex min-w-0 items-center gap-2.5">
            <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", tone.dot)} aria-hidden="true" />
            <span className="truncate text-base font-bold text-text-primary">{name}</span>
          </span>
          <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold tracking-[0.08em]", tone.label)}>
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

        <span className="mt-auto grid grid-cols-2 gap-x-5 gap-y-4 border-t border-border/60 pt-5">
          <BusinessMetric label="판매금액" value={revenue} />
          <BusinessMetric label="실수납" value={receivedAmount} />
          <BusinessMetric label="환불" value={refundAmount} danger />
          <BusinessMetric label="현재 미수" value={outstandingAmount} warning />
        </span>
      </button>
    </Card>
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
      <span className="block text-[11px] text-text-muted">{label}</span>
      <strong
        className={cn(
          "mt-1 block whitespace-nowrap text-[clamp(0.8rem,3.4vw,0.95rem)] font-semibold tracking-[-0.025em] text-text-secondary tabular-nums sm:text-sm",
          danger && value > 0 && "text-error",
          warning && value > 0 && "text-warning",
        )}
      >
        {won(value)}
      </strong>
    </span>
  );
}

function businessUnitCardTone(code: string) {
  if (code === "daycare") {
    return { dot: "bg-sky-500", label: "bg-sky-50/80 text-sky-700", card: "dashboard-unit-daycare" };
  }
  if (code === "training") {
    return { dot: "bg-violet-500", label: "bg-violet-50/80 text-violet-700", card: "dashboard-unit-training" };
  }
  if (code === "hotel") {
    return { dot: "bg-amber-500", label: "bg-amber-50/80 text-amber-700", card: "dashboard-unit-hotel" };
  }
  return { dot: "bg-slate-400", label: "bg-slate-100 text-slate-600", card: "" };
}

export function RecentSales({ rows, onOpen }: { rows: DashboardSale[]; onOpen: () => void }) {
  return <Card className="overflow-hidden"><div className="flex items-center justify-between gap-4 border-b border-border px-5 py-4 sm:px-6"><div><h2 className="font-semibold text-text-primary">최근 매출</h2><p className="mt-1 text-xs text-text-muted">선택 조건의 최신 등록 5건</p></div><Button aria-label="매출 내역으로 이동" variant="ghost" onClick={onOpen}>전체 보기 <ArrowRight size={16} /></Button></div>{rows.length ? <Table className="min-w-[1000px]"><thead><tr><th>매출일</th><th>사업부</th><th>반려견</th><th>보호자</th><th>상품</th><th>결제액</th><th>실매출</th><th>상태</th><th>담당자</th></tr></thead><tbody>{rows.map((sale) => <tr key={sale.id} tabIndex={0} role="link" className="cursor-pointer focus:bg-blue-50 focus:outline-none" onClick={onOpen} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onOpen(); }}><td>{sale.saleDate}</td><td>{sale.businessUnitName}</td><td className="font-semibold">{sale.dogName}</td><td>{sale.customerName || "미등록"}</td><td>{sale.productName}</td><td>{won(sale.paidAmount)}</td><td className="font-semibold text-primary">{won(sale.netAmount)}</td><td><StatusBadge status={sale.status as "normal" | "partial_refund" | "full_refund" | "cancelled"} tone={sale.status === "cancelled" ? "gray" : undefined} /></td><td>{sale.staffName || "-"}</td></tr>)}</tbody></Table> : <EmptyState title="등록된 매출이 없습니다." />}</Card>;
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
