import { AlertCircle, ArrowRight, Building2, CalendarDays, ReceiptText, Target, TrendingUp } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button, Card, EmptyState, Select, Skeleton, StatusBadge, Table, cn } from "../../components/ui";
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
  netAmount,
  previousNetAmount,
  count,
  monthlyTarget,
  outstanding,
  refund,
}: {
  periodLabel: string;
  rangeLabel: string;
  unitName: string;
  compareLabel: string;
  salesAmount: number;
  previousSalesAmount: number;
  netAmount: number;
  previousNetAmount: number;
  count: number;
  monthlyTarget: number | null;
  outstanding: number;
  refund: number;
}) {
  const salesComparison = formatRevenueComparison(
    salesAmount,
    previousSalesAmount,
  );
  const netComparison = formatRevenueComparison(
    netAmount,
    previousNetAmount,
  );
  const achievement =
    monthlyTarget !== null && monthlyTarget > 0
      ? (netAmount / monthlyTarget) * 100
      : 0;
  const items = [
    {
      label: `${periodLabel} 판매금액`,
      value: won(salesAmount),
      description: `${rangeLabel} · ${unitName} · 유효 거래 ${count.toLocaleString("ko-KR")}건`,
      signalLabel: `${compareLabel} 대비`,
      signal: salesComparison,
      className: "bg-[#172f4d] text-white lg:col-span-2",
      labelClass: "text-blue-200",
      valueClass: "text-white text-[clamp(2rem,4vw,3.4rem)]",
      descriptionClass: "text-slate-300",
      signalClass: salesComparison.startsWith("▼")
        ? "text-rose-200"
        : salesComparison.startsWith("—")
          ? "text-slate-300"
          : "text-emerald-200",
    },
    {
      label: `${periodLabel} 실결제액`,
      value: won(netAmount),
      description: "환불 전 결제액에서 누적 환불액을 차감",
      signalLabel: `${compareLabel} 대비`,
      signal: netComparison,
      className: "bg-primary-subtle lg:col-span-2",
      labelClass: "text-primary",
      valueClass: "text-text-primary text-[clamp(1.8rem,3vw,2.75rem)]",
      descriptionClass: "text-text-secondary",
      signalClass: netComparison.startsWith("▼")
        ? "text-error"
        : netComparison.startsWith("—")
          ? "text-text-secondary"
          : "text-primary",
      target: monthlyTarget ?? undefined,
      achievement: monthlyTarget === null ? undefined : achievement,
    },
    {
      label: `${periodLabel} 미수`,
      value: won(outstanding),
      description: "해당 기간 거래에 현재 남은 미수잔액",
      className: "bg-warning-soft/60 lg:col-span-1",
      labelClass: "text-warning",
      valueClass: "text-text-primary text-2xl",
      descriptionClass: "text-text-muted",
      signalLabel: "",
      signal: "",
      signalClass: "",
    },
    {
      label: `${periodLabel} 환불`,
      value: won(refund),
      description: "해당 기간 거래에 누적된 환불액",
      className: "bg-surface-secondary lg:col-span-1",
      labelClass: "text-error",
      valueClass: "text-text-primary text-2xl",
      descriptionClass: "text-text-muted",
      signalLabel: "",
      signal: "",
      signalClass: "",
    },
  ];

  return (
    <Card className="overflow-hidden p-0">
      <div className="grid sm:grid-cols-2 lg:grid-cols-6">
        {items.map((item, index) => (
          <div
            key={item.label}
            className={cn(
              "min-w-0 border-b border-border p-5 sm:p-6 lg:min-h-44 lg:border-b-0 lg:border-r lg:last:border-r-0",
              index === 0 && "border-white/10",
              item.className,
            )}
          >
            <p className={cn("text-xs font-semibold", item.labelClass)}>
              {item.label}
            </p>
            <strong
              className={cn(
                "mt-4 block whitespace-nowrap font-bold tracking-[-0.045em] tabular-nums",
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
            {item.target !== undefined && item.achievement !== undefined && (
              <div className="mt-3">
                <div className="flex items-center justify-between gap-3 text-[11px]">
                  <span className="font-semibold text-text-secondary">
                    목표 대비
                  </span>
                  <strong className="text-primary tabular-nums">
                    {item.target > 0
                      ? `${item.achievement.toFixed(1)}%`
                      : "목표 미설정"}
                  </strong>
                </div>
                <div
                  className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-primary/10"
                  role="progressbar"
                  aria-label={`${periodLabel} 목표 달성률`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.min(100, Math.max(0, item.achievement))}
                >
                  <span
                    className="block h-full rounded-full bg-primary"
                    style={{
                      width: `${Math.min(100, Math.max(0, item.achievement))}%`,
                    }}
                  />
                </div>
              </div>
            )}
            <p className={cn("mt-2 text-xs leading-5", item.descriptionClass)}>
              {item.description}
            </p>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function BusinessUnitCard({ order, name, revenue, previousRevenue, compareLabel, share, count, average, restricted = false, selected = false, onClick }: { order: number; name: string; revenue: number; previousRevenue: number; compareLabel: string; share: number; count: number; average: number; restricted?: boolean; selected?: boolean; onClick?: () => void }) {
  const comparisonText = formatRevenueComparison(revenue, previousRevenue);
  const currentTrendValue = Math.max(0, revenue);
  const previousTrendValue = Math.max(0, previousRevenue);
  const trendMax = Math.max(currentTrendValue, previousTrendValue, 1);
  const accents = [
    "border-t-[#274c77]",
    "border-t-[#5f7f9f]",
    "border-t-[#8aa1b8]",
  ];
  return (
    <Card
      className={cn(
        "group relative min-h-52 overflow-hidden border-t-2 p-0 transition-[transform,box-shadow,border-color] duration-200 ease-out hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[0_12px_28px_rgba(23,36,58,0.07)]",
        accents[(order - 1) % accents.length],
        selected && "border-primary/40 bg-primary-subtle ring-2 ring-primary/10",
      )}
    >
      <button
        type="button"
        className="relative block min-h-52 w-full p-5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary sm:p-6"
        aria-pressed={selected}
        onClick={onClick}
      >
        <span className="relative block">
          <span className="flex items-start justify-between gap-4">
            <span>
              <span className="text-[11px] font-bold tracking-[0.14em] text-primary">
                0{order}
              </span>
              <span className="mt-1 block text-lg font-bold text-text-primary">
                {name}
              </span>
            </span>
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-soft text-primary">
              <Building2 size={18} />
            </span>
          </span>
          <span className="mt-5 block">
            <span className="text-xs font-semibold text-text-secondary">
              {restricted ? "선택 날짜 실매출" : "선택 기간 실매출"}
            </span>
            <strong className="mt-1 block text-[1.75rem] font-bold tracking-[-0.04em] text-text-primary tabular-nums sm:text-[1.95rem]">
              {won(revenue)}
            </strong>
            {!restricted && (
              <>
                <span
                  className={cn(
                    "mt-1.5 block text-xs font-bold",
                    comparisonText.startsWith("▼")
                      ? "text-error"
                      : comparisonText.startsWith("—")
                        ? "text-text-secondary"
                        : "text-primary",
                  )}
                >
                  {compareLabel} 대비 · {comparisonText}
                </span>
                <span className="mt-4 grid grid-cols-[2.5rem_1fr] items-center gap-x-2 gap-y-1.5 text-[10px] text-text-muted">
                  <span>현재</span>
                  <span className="h-1.5 overflow-hidden rounded-full bg-surface-secondary">
                    <span
                      className="block h-full rounded-full bg-primary"
                      style={{ width: `${(currentTrendValue / trendMax) * 100}%` }}
                    />
                  </span>
                  <span>{compareLabel}</span>
                  <span className="h-1.5 overflow-hidden rounded-full bg-surface-secondary">
                    <span
                      className="block h-full rounded-full bg-[#9db1c5]"
                      style={{ width: `${(previousTrendValue / trendMax) * 100}%` }}
                    />
                  </span>
                </span>
              </>
            )}
          </span>
          <span
            className={cn(
              "mt-4 grid gap-2 border-t border-border pt-4",
              restricted ? "grid-cols-2" : "grid-cols-3",
            )}
          >
            <span>
              <span className="block text-[11px] text-text-muted">매출 건수</span>
              <strong className="mt-1 block text-sm text-text-primary tabular-nums">
                {count.toLocaleString("ko-KR")}건
              </strong>
            </span>
            <span>
              <span className="block text-[11px] text-text-muted">평균 객단가</span>
              <strong className="mt-1 block truncate text-sm text-text-primary tabular-nums">
                {won(average)}
              </strong>
            </span>
            {!restricted && (
              <span>
                <span className="block text-[11px] text-text-muted">전체 비중</span>
                <strong className="mt-1 block text-sm text-text-primary tabular-nums">
                  {share.toFixed(1)}%
                </strong>
              </span>
            )}
          </span>
        </span>
      </button>
    </Card>
  );
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
