import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { Badge, Button, Card, Input, cn } from "../../components/ui";
import { shortWon, won } from "../../lib/format";
import type { BusinessUnitOption, DailyRevenue, DashboardCompare, DashboardDateRange, DashboardPeriod } from "./dashboardMetrics";

const periodOptions: Array<{ value: DashboardPeriod; label: string }> = [
  { value: "today", label: "오늘" },
  { value: "yesterday", label: "어제" },
  { value: "this_week", label: "이번 주" },
  { value: "last_week", label: "지난주" },
  { value: "this_month", label: "이번 달" },
  { value: "last_month", label: "지난달" },
  { value: "custom", label: "직접 선택" },
];

export function DashboardPeriodFilters({ period, range, unitName, compare, onPeriod, onCustom, onMovePeriod, onCompare }: { period: DashboardPeriod; range: DashboardDateRange; unitName: string; compare: DashboardCompare; onPeriod: (period: DashboardPeriod) => void; onCustom: (range: DashboardDateRange) => void; onMovePeriod: (direction: number) => void; onCompare: (compare: DashboardCompare) => void }) {
  return <Card className="mb-4 overflow-hidden p-3 sm:p-4"><div className="flex gap-1.5 overflow-x-auto pb-1" aria-label="빠른 조회 기간">{periodOptions.map((option) => <button key={option.value} type="button" onClick={() => onPeriod(option.value)} className={cn("min-h-11 shrink-0 rounded-lg border px-3 text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:text-sm", period === option.value ? "border-primary bg-primary text-white" : "border-border bg-white text-text-secondary hover:border-primary/25 hover:bg-primary-subtle")}>{option.label}</button>)}</div><div className="mt-3 flex flex-col gap-2 border-t border-border pt-3 xl:flex-row xl:items-center"><div className="flex min-w-0 items-center gap-1.5"><Button type="button" variant="secondary" className="shrink-0 px-3" aria-label="이전 기간" onClick={() => onMovePeriod(-1)}><ChevronLeft size={17} /></Button><div className="flex min-h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-lg border border-primary/10 bg-primary-subtle px-3"><strong className="truncate text-sm text-text-primary tabular-nums">{range.from === range.to ? range.from : `${range.from} ~ ${range.to}`}</strong><span className="shrink-0"><Badge tone="blue">{unitName}</Badge></span></div><Button type="button" variant="secondary" className="shrink-0 px-3" aria-label="다음 기간" onClick={() => onMovePeriod(1)}><ChevronRight size={17} /></Button></div>{period === "custom" && <div className="grid gap-2 sm:grid-cols-2 xl:min-w-[340px]"><label className="sr-only" htmlFor="dashboard-period-from">시작일</label><Input id="dashboard-period-from" aria-label="직접 선택 시작일" type="date" value={range.from} onChange={(event) => onCustom({ from: event.target.value, to: range.to })} /><label className="sr-only" htmlFor="dashboard-period-to">종료일</label><Input id="dashboard-period-to" aria-label="직접 선택 종료일" type="date" min={range.from} value={range.to} onChange={(event) => onCustom({ from: range.from, to: event.target.value })} /></div>}<div className="flex items-center gap-2 xl:ml-auto"><span className="shrink-0 text-xs font-semibold text-text-secondary">비교</span><div className="flex min-w-0 gap-1.5 overflow-x-auto" aria-label="대시보드 비교 기준">{period === "custom" && <CompareButton active={compare === "previous"} onClick={() => onCompare("previous")}>직전 기간</CompareButton>}{compareOptions.map((option) => <CompareButton key={option.value} active={compare === option.value} onClick={() => onCompare(option.value)}>{option.label}</CompareButton>)}</div></div></div></Card>;
}

const compareOptions: Array<{ value: Exclude<DashboardCompare, "previous">; label: string }> = [
  { value: "day", label: "전일" },
  { value: "week", label: "전주" },
  { value: "month", label: "전월" },
];

function CompareButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" onClick={onClick} className={cn("min-h-11 shrink-0 rounded-lg border px-3 text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary", active ? "border-primary bg-primary text-white" : "border-border bg-white text-text-secondary hover:border-primary/25")}>{children}</button>;
}

export function DailyRevenueTrend({ data, selectedDate, unitName, onSelect }: { data: DailyRevenue[]; selectedDate: string; unitName: string; onSelect: (date: string) => void }) {
  const max = Math.max(0, ...data.map((row) => Math.max(0, row.net)));
  return <Card className="p-5 sm:p-6"><div className="mb-5"><h2 className="font-bold text-text-primary">날짜별 실매출 추이</h2><p className="mt-1 text-xs text-text-muted">{unitName} · 날짜를 선택하면 상세와 캘린더가 함께 바뀝니다.</p></div>{data.length ? <div className="overflow-x-auto pb-2"><div className="flex h-64 min-w-full items-end gap-2" style={{ width: `${Math.max(100, data.length * 52)}px` }}>{data.map((row) => { const height = max > 0 ? Math.max(4, Math.sqrt(Math.max(0, row.net) / max) * 172) : 4; return <button key={row.date} type="button" onClick={() => onSelect(row.date)} className={cn("group relative flex h-full min-w-10 flex-1 flex-col items-center justify-end rounded-lg px-1 pt-8 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary", selectedDate === row.date && "bg-primary-subtle")} aria-label={`${row.date} 실매출 ${won(row.net)} ${row.count}건`}><span className="pointer-events-none absolute left-1/2 top-1 z-10 hidden w-36 -translate-x-1/2 rounded-lg bg-[#17243a] px-3 py-2 text-left text-[11px] leading-5 text-white shadow-lg group-hover:block group-focus-visible:block"><strong className="block">{Number(row.date.slice(5, 7))}월 {Number(row.date.slice(8))}일</strong><span className="block text-blue-100">실매출 {won(row.net)}</span><span className="block text-blue-100">{row.count}건</span></span><span className="mb-2 hidden text-[10px] font-semibold text-text-secondary group-hover:block sm:block">{shortWon(row.net)}</span><span className={cn("w-full max-w-8 rounded-t-md transition-all duration-200", selectedDate === row.date ? "bg-primary" : "bg-[#7f9dbb] group-hover:bg-primary")} style={{ height }} /><span className="mt-2 text-[10px] text-text-muted">{Number(row.date.slice(8))}일</span></button>; })}</div></div> : <p className="rounded-xl bg-surface-secondary p-5 text-center text-sm text-text-muted">선택 기간에 표시할 매출이 없습니다.</p>}</Card>;
}

const monthDays = (month: string) => {
  const [year, monthNumber] = month.split("-").map(Number);
  const firstDay = new Date(year, monthNumber - 1, 1).getDay();
  const lastDate = new Date(year, monthNumber, 0).getDate();
  return Array.from({ length: 42 }, (_, index) => {
    const day = index - firstDay + 1;
    return day >= 1 && day <= lastDate ? `${month}-${String(day).padStart(2, "0")}` : null;
  });
};

const moveMonth = (month: string, offset: number) => {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(year, monthNumber - 1 + offset, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
};

export function SalesHeatmapCalendar({ month, data, totalData, unitName, today, selectedDate, hideAmounts = false, onMonth, onSelect }: { month: string; data: DailyRevenue[]; totalData: DailyRevenue[]; unitName: string; today: string; selectedDate: string; hideAmounts?: boolean; onMonth: (month: string) => void; onSelect: (date: string) => void }) {
  const byDate = new Map(data.map((row) => [row.date, row]));
  const totalsByDate = new Map(totalData.map((row) => [row.date, row]));
  const filtered = unitName !== "전체 사업부";
  const max = Math.max(0, ...data.map((row) => Math.max(0, row.net)));
  const intensity = (amount: number) => max <= 0 ? 0 : Math.min(4, Math.max(1, Math.ceil(Math.sqrt(Math.max(0, amount) / max) * 4)));
  const tones = ["bg-white", "bg-blue-50", "bg-blue-100", "bg-blue-200", "bg-[#b7cbe0]"];
  return (
    <Card className="p-3 sm:p-6">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-bold text-text-primary">매출 캘린더</h2>
          <p className="mt-1 text-xs text-text-muted">
            {hideAmounts
              ? "날짜를 선택하면 해당 날짜의 사업부별 거래를 확인합니다."
              : `${unitName} 실매출 기준 · 진한 셀일수록 매출이 큽니다.`}
          </p>
          <div className="mt-2 flex flex-wrap gap-3 text-[10px] text-text-muted" aria-label="캘린더 표시 기준">
            <CalendarIndicator color="bg-primary" label="매출" />
            <CalendarIndicator color="bg-warning" label="미수" />
            <CalendarIndicator color="bg-error" label="환불" />
          </div>
        </div>
        <div className="flex items-center justify-between gap-1 sm:justify-start">
          <Button type="button" variant="ghost" aria-label="이전 달" onClick={() => onMonth(moveMonth(month, -1))}>
            <ChevronLeft size={17} />
          </Button>
          <strong className="min-w-24 text-center text-sm tabular-nums">
            {month.replace("-", ".")}
          </strong>
          <Button type="button" variant="ghost" aria-label="다음 달" onClick={() => onMonth(moveMonth(month, 1))}>
            <ChevronRight size={17} />
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center text-[11px] font-semibold text-text-muted sm:gap-1">
        {["일", "월", "화", "수", "목", "금", "토"].map((day) => (
          <span key={day} className="py-1">{day}</span>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-0.5 sm:gap-1">
        {monthDays(month).map((date, index) => {
          if (!date) {
            return <span key={`empty-${index}`} className="min-h-16 rounded-md bg-surface-secondary/60 sm:min-h-24 sm:rounded-lg" />;
          }
          const row = byDate.get(date);
          const totalRow = totalsByDate.get(date);
          const amount = row?.net ?? 0;
          const hasRevenue = (row?.count ?? 0) > 0;
          const hasRefund = (row?.refund ?? 0) > 0;
          const hasOutstandingAmount = (row?.outstanding ?? 0) > 0;
          const indicatorLabel = [
            hasRevenue ? "매출 있음" : "",
            hasOutstandingAmount ? "미수 있음" : "",
            hasRefund ? "환불 있음" : "",
          ].filter(Boolean).join(", ");
          return (
            <button
              key={date}
              type="button"
              onClick={() => onSelect(date)}
              className={cn(
                "relative min-h-16 rounded-md border p-1 text-left transition-[transform,border-color,box-shadow,background-color] duration-200 ease-out hover:-translate-y-px hover:border-primary/35 hover:shadow-[0_6px_16px_rgba(23,36,58,0.08)] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:min-h-24 sm:rounded-lg sm:p-2",
                hideAmounts ? "bg-surface-secondary hover:bg-primary-subtle" : tones[intensity(amount)],
                selectedDate === date ? "border-primary ring-2 ring-primary/20" : "border-border",
                today === date && selectedDate !== date && "border-dashed border-primary/60",
              )}
              aria-label={`${hideAmounts ? `${date} 거래 상세 열기` : `${date} ${unitName} 실매출 ${won(amount)} ${row?.count ?? 0}건${filtered ? ` 전체 실매출 ${won(totalRow?.net ?? 0)}` : ""}`}${indicatorLabel ? `, ${indicatorLabel}` : ""}`}
            >
              <span className="flex items-center justify-between gap-1">
                <span className="text-[11px] font-bold text-text-primary sm:text-xs">
                  {Number(date.slice(8))}
                </span>
                {today === date && (
                  <span className="rounded-full bg-primary px-1.5 py-0.5 text-[8px] font-bold text-white sm:text-[9px]">
                    오늘
                  </span>
                )}
              </span>
              <span className="mt-1.5 flex min-h-2 items-center gap-1" aria-hidden="true">
                {hasRevenue && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
                {hasOutstandingAmount && <span className="h-1.5 w-1.5 rounded-full bg-warning" />}
                {hasRefund && <span className="h-1.5 w-1.5 rounded-full bg-error" />}
              </span>
              {hideAmounts ? (
                <span className="mt-1 block text-[9px] font-semibold text-primary sm:text-[10px]">내역 보기</span>
              ) : (
                <>
                  <strong className="mt-1 block truncate text-[9px] text-text-primary tabular-nums sm:text-xs">
                    {shortWon(amount)}
                  </strong>
                  <span className="mt-0.5 block text-[9px] text-text-muted sm:text-[10px]">
                    {row?.count ?? 0}건
                  </span>
                  {filtered && (
                    <span className="mt-0.5 hidden truncate text-[9px] text-text-secondary sm:block">
                      전체 {shortWon(totalRow?.net ?? 0)}
                    </span>
                  )}
                </>
              )}
            </button>
          );
        })}
      </div>
    </Card>
  );
}

function CalendarIndicator({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("h-1.5 w-1.5 rounded-full", color)} aria-hidden="true" />
      {label}
    </span>
  );
}

export function SelectedDateDetail({ date, detail, unitId, onOpenSales }: { date: string; detail: { divisions: Array<BusinessUnitOption & { revenue: number; count: number; average: number }>; other: { revenue: number; count: number; average: number }; total: number; count: number; outstanding: number; refund: number }; unitId: string; onOpenSales: (unitId?: string) => void }) {
  return <Card className="overflow-hidden"><div className="flex flex-col gap-3 border-b border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6"><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-soft text-primary"><CalendarDays size={18} /></span><div><h2 className="font-bold text-text-primary">{date} 상세</h2><p className="text-xs text-text-muted">사업부별 실매출과 당일 확인 항목</p></div></div><Button type="button" variant="secondary" onClick={() => onOpenSales()}>이 날짜 전체 매출 보기</Button></div><div className="p-5 sm:p-6"><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">{detail.divisions.map((division) => <div key={division.id} className={cn("rounded-xl border p-4", unitId === division.id ? "border-primary/30 bg-primary-subtle" : "border-border bg-surface-secondary")}><div className="flex items-center justify-between gap-2"><strong className="text-sm text-text-primary">{division.name}</strong><button type="button" className="min-h-11 rounded-lg px-2 text-xs font-semibold text-primary hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-primary" onClick={() => onOpenSales(division.id)}>매출 보기</button></div><p className="mt-3 text-xl font-bold text-text-primary tabular-nums">{won(division.revenue)}</p><p className="mt-1 text-xs text-text-muted">{division.count}건 · 평균 {won(division.average)}</p><p className="mt-1 text-xs font-semibold text-text-secondary">전체 대비 {detail.total > 0 ? ((division.revenue / detail.total) * 100).toFixed(1) : "0.0"}%</p></div>)}<div className="rounded-xl border border-warning/25 bg-warning-soft p-4"><strong className="text-sm text-text-primary">기타</strong><p className="mt-3 text-xl font-bold text-text-primary tabular-nums">{won(detail.other.revenue)}</p><p className="mt-1 text-xs text-text-muted">{detail.other.count}건 · 평균 {won(detail.other.average)}</p><p className="mt-1 text-xs font-semibold text-text-secondary">전체 대비 {detail.total > 0 ? ((detail.other.revenue / detail.total) * 100).toFixed(1) : "0.0"}%</p></div></div><div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><Summary label="총 실매출" value={won(detail.total)} /><Summary label="총 건수" value={`${detail.count}건`} /><Summary label="평균 객단가" value={won(detail.count ? detail.total / detail.count : 0)} /><Summary label="미수금" value={won(detail.outstanding)} /><Summary label="환불" value={won(detail.refund)} /></div></div></Card>;
}

function Summary({ label, value }: { label: string; value: string }) { return <div className="rounded-xl border border-border bg-white p-4"><span className="text-xs text-text-muted">{label}</span><strong className="mt-1 block text-base text-text-primary tabular-nums">{value}</strong></div>; }
