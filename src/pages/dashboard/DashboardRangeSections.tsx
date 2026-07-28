import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { Badge, Button, Card, Input, cn } from "../../components/ui";
import { shortWon, won } from "../../lib/format";
import type { BusinessUnitOption, DailyRevenue, DashboardCompare, DashboardDateRange, DashboardPeriod } from "./dashboardMetrics";

const periodOptions: Array<{ value: DashboardPeriod; label: string }> = [
  { value: "this_month", label: "이번 달" },
  { value: "last_month", label: "지난달" },
  { value: "today", label: "오늘" },
  { value: "yesterday", label: "어제" },
  { value: "this_week", label: "이번 주" },
  { value: "last_week", label: "지난주" },
  { value: "custom", label: "직접 선택" },
];

export function DashboardPeriodFilters({ period, range, unitName, compare, onPeriod, onCustom, onMovePeriod, onCompare }: { period: DashboardPeriod; range: DashboardDateRange; unitName: string; compare: DashboardCompare; onPeriod: (period: DashboardPeriod) => void; onCustom: (range: DashboardDateRange) => void; onMovePeriod: (direction: number) => void; onCompare: (compare: DashboardCompare) => void }) {
  return (
    <Card className="dashboard-surface mb-4 overflow-hidden bg-white/80 p-2.5 shadow-none sm:p-3">
      <div className="flex flex-col gap-2 xl:flex-row xl:items-center">
        <div className="flex min-w-0 gap-1 overflow-x-auto pb-0.5" aria-label="빠른 조회 기간">
          {periodOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => onPeriod(option.value)}
              className={cn(
                "min-h-11 shrink-0 rounded-lg border px-2.5 text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:min-h-9 sm:px-3",
                period === option.value
                  ? "border-primary bg-primary text-white"
                  : "border-transparent bg-transparent text-text-secondary hover:border-primary/15 hover:bg-primary-subtle",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="flex min-w-0 items-center gap-1 sm:min-w-[310px] xl:ml-auto">
          <Button type="button" variant="ghost" className="h-9 min-h-9 shrink-0 px-2" aria-label="이전 기간" onClick={() => onMovePeriod(-1)}>
            <ChevronLeft size={16} />
          </Button>
          <div className="flex min-h-9 min-w-0 flex-1 items-center justify-center gap-2 rounded-lg bg-surface-secondary px-2.5">
            <strong className="truncate text-xs text-text-primary tabular-nums sm:text-sm">
              {range.from === range.to ? range.from : `${range.from} ~ ${range.to}`}
            </strong>
            <span className="hidden shrink-0 min-[430px]:inline">
              <Badge tone="blue">{unitName}</Badge>
            </span>
          </div>
          <Button type="button" variant="ghost" className="h-9 min-h-9 shrink-0 px-2" aria-label="다음 기간" onClick={() => onMovePeriod(1)}>
            <ChevronRight size={16} />
          </Button>
        </div>
      </div>

      <div className="mt-2 flex flex-col gap-2 border-t border-border/60 pt-2 lg:flex-row lg:items-center">
        {period === "custom" && (
          <div className="grid gap-2 sm:grid-cols-2 lg:min-w-[340px]">
            <label className="sr-only" htmlFor="dashboard-period-from">시작일</label>
            <Input id="dashboard-period-from" className="h-9 min-h-9" aria-label="직접 선택 시작일" type="date" value={range.from} onChange={(event) => onCustom({ from: event.target.value, to: range.to })} />
            <label className="sr-only" htmlFor="dashboard-period-to">종료일</label>
            <Input id="dashboard-period-to" className="h-9 min-h-9" aria-label="직접 선택 종료일" type="date" min={range.from} value={range.to} onChange={(event) => onCustom({ from: range.from, to: event.target.value })} />
          </div>
        )}
        <div className="flex min-w-0 items-center gap-2 lg:ml-auto">
          <span className="shrink-0 text-[11px] font-semibold text-text-muted">비교</span>
          <div className="flex min-w-0 gap-1 overflow-x-auto" aria-label="대시보드 비교 기준">
            {period === "custom" && <CompareButton active={compare === "previous"} onClick={() => onCompare("previous")}>직전 기간</CompareButton>}
            {compareOptions.map((option) => <CompareButton key={option.value} active={compare === option.value} onClick={() => onCompare(option.value)}>{option.label}</CompareButton>)}
          </div>
        </div>
      </div>
    </Card>
  );
}

const compareOptions: Array<{ value: Exclude<DashboardCompare, "previous">; label: string }> = [
  { value: "day", label: "전일" },
  { value: "week", label: "전주" },
  { value: "month", label: "전월" },
];

function CompareButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" onClick={onClick} className={cn("min-h-8 shrink-0 rounded-md border px-2.5 text-[11px] font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary", active ? "border-primary/20 bg-primary-subtle text-primary" : "border-transparent bg-transparent text-text-muted hover:bg-surface-secondary hover:text-text-secondary")}>{children}</button>;
}

export function DailyRevenueTrend({ data, selectedDate, unitName, onSelect }: { data: DailyRevenue[]; selectedDate: string; unitName: string; onSelect: (date: string) => void }) {
  const max = Math.max(0, ...data.map((row) => Math.max(0, row.revenue)));
  return <Card className="p-5 sm:p-6"><div className="mb-5"><h2 className="font-bold text-text-primary">날짜별 실수납 추이</h2><p className="mt-1 text-xs text-text-muted">{unitName} · 결제일 기준 유효 결제원장 합계입니다.</p></div>{data.length ? <div className="overflow-x-auto pb-2"><div className="flex h-64 min-w-full items-end gap-2" style={{ width: `${Math.max(100, data.length * 52)}px` }}>{data.map((row) => { const height = max > 0 ? Math.max(4, Math.sqrt(Math.max(0, row.revenue) / max) * 172) : 4; return <button key={row.date} type="button" onClick={() => onSelect(row.date)} className={cn("group relative flex h-full min-w-10 flex-1 flex-col items-center justify-end rounded-lg px-1 pt-8 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary", selectedDate === row.date && "bg-primary-subtle")} aria-label={`${row.date} 실수납 ${won(row.revenue)}`}><span className="pointer-events-none absolute left-1/2 top-1 z-10 hidden w-36 -translate-x-1/2 rounded-lg bg-[#17243a] px-3 py-2 text-left text-[11px] leading-5 text-white shadow-lg group-hover:block group-focus-visible:block"><strong className="block">{Number(row.date.slice(5, 7))}월 {Number(row.date.slice(8))}일</strong><span className="block text-blue-100">실수납 {won(row.revenue)}</span><span className="block text-rose-200">환불 {won(row.refund)}</span></span><span className="mb-2 hidden text-[10px] font-semibold text-text-secondary group-hover:block sm:block">{shortWon(row.revenue)}</span><span className={cn("w-full max-w-8 rounded-t-md transition-all duration-200", selectedDate === row.date ? "bg-primary" : "bg-[#7f9dbb] group-hover:bg-primary")} style={{ height }} /><span className="mt-2 text-[10px] text-text-muted">{Number(row.date.slice(8))}일</span></button>; })}</div></div> : <p className="rounded-xl bg-surface-secondary p-5 text-center text-sm text-text-muted">선택 기간에 표시할 수납 내역이 없습니다.</p>}</Card>;
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

export function SalesHeatmapCalendar({ month, activeRange, data, totalData, unitName, today, selectedDate, hideAmounts = false, onMonth, onSelect }: { month: string; activeRange: DashboardDateRange; data: DailyRevenue[]; totalData: DailyRevenue[]; unitName: string; today: string; selectedDate: string; hideAmounts?: boolean; onMonth: (month: string) => void; onSelect: (date: string) => void }) {
  const byDate = new Map(data.map((row) => [row.date, row]));
  const totalsByDate = new Map(totalData.map((row) => [row.date, row]));
  const filtered = unitName !== "전체 사업부";
  const max = Math.max(0, ...data.map((row) => Math.max(0, row.revenue)));
  const intensity = (amount: number) => max <= 0 ? 0 : Math.min(4, Math.max(1, Math.ceil(Math.sqrt(Math.max(0, amount) / max) * 4)));
  const tones = [
    "bg-white",
    "bg-sky-50/45",
    "bg-sky-50/80",
    "bg-sky-100/75",
    "bg-[#deebf6]",
  ];
  const [year, monthNumber] = month.split("-").map(Number);
  const monthTitle = `${year}년 ${monthNumber}월 전체`;
  const activeRangeLabel = activeRange.from === activeRange.to
    ? activeRange.from
    : `${activeRange.from} ~ ${activeRange.to}`;
  return (
    <Card className="dashboard-surface dashboard-calendar-surface p-3.5 shadow-none sm:p-7">
      <div className="mb-5 flex flex-col gap-4 sm:mb-6 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="dashboard-section-title font-bold text-text-primary">{monthTitle}</h2>
            <Badge>월 전체 캘린더</Badge>
          </div>
          <p className="mt-1 text-[13px] leading-5 text-text-muted">
            {hideAmounts
              ? "날짜를 선택하면 해당 날짜의 사업부별 거래를 확인합니다."
              : `${unitName} 판매일·결제일 분리 기준 · KPI 적용 기간 ${activeRangeLabel}`}
          </p>
          <p className="mt-1 text-[11px] leading-4 text-text-muted">
            선택 기간 밖 날짜도 월 전체 흐름을 확인할 수 있도록 흐리게 표시합니다.
          </p>
          <div className="mt-3 flex flex-wrap gap-x-3.5 gap-y-2 text-[11px] text-[#7e8998]" aria-label="캘린더 표시 기준">
            <CalendarIndicator color="border-primary bg-primary-subtle" label="선택 기간" square />
            <CalendarIndicator color="border-primary bg-white" label="선택일" square />
            <CalendarIndicator color="border-primary border-dashed bg-white" label="오늘" square />
            <CalendarIndicator color="bg-slate-500" label="판매" />
            <CalendarIndicator color="bg-primary" label="수납" />
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
      <div className="grid grid-cols-7 gap-0.5 border-b border-border/55 pb-1.5 text-center text-[11px] font-semibold text-[#7e8998] sm:gap-1">
        {["일", "월", "화", "수", "목", "금", "토"].map((day) => (
          <span key={day} className="py-1.5">{day}</span>
        ))}
      </div>
      <div className="mt-2 grid grid-cols-7 gap-0.5 sm:mt-2.5 sm:gap-1.5">
        {monthDays(month).map((date, index) => {
          if (!date) {
            return <span key={`empty-${index}`} className="min-h-16 rounded-md bg-surface-secondary/45 sm:min-h-24 sm:rounded-lg" />;
          }
          const row = byDate.get(date);
          const totalRow = totalsByDate.get(date);
          const amount = row?.revenue ?? 0;
          const hasSales = (row?.count ?? 0) > 0;
          const hasReceipt = (row?.revenue ?? 0) > 0;
          const hasRefund = (row?.refund ?? 0) > 0;
          const inActiveRange = date >= activeRange.from && date <= activeRange.to;
          const indicatorLabel = [
            hasSales ? "판매 있음" : "",
            hasReceipt ? "수납 있음" : "",
            hasRefund ? "환불 있음" : "",
          ].filter(Boolean).join(", ");
          return (
            <button
              key={date}
              type="button"
              onClick={() => onSelect(date)}
              className={cn(
                "relative min-h-16 overflow-hidden rounded-md border p-1.5 text-left transition-[transform,border-color,background-color,opacity] duration-200 ease-out hover:-translate-y-px hover:border-primary/30 hover:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:min-h-24 sm:rounded-[10px] sm:p-2.5",
                hideAmounts
                  ? inActiveRange
                    ? "bg-surface-secondary/80 hover:bg-primary-subtle"
                    : "bg-slate-50/55"
                  : inActiveRange
                    ? tones[intensity(amount)]
                    : "bg-slate-50/55",
                inActiveRange ? "border-primary/15" : "border-border/70 opacity-50",
                selectedDate === date ? "border-primary bg-primary-subtle ring-1 ring-primary/25" : "border-border/70",
                selectedDate === date && "opacity-100",
                today === date && selectedDate !== date && "border-dashed border-primary/70",
                !hasSales && !hasReceipt && !hasRefund && "bg-surface-secondary/45 text-text-muted",
              )}
              title={`${date} · ${unitName} 실수납 ${won(amount)} · 판매금액 ${won(row?.salesAmount ?? 0)} · 판매 ${row?.count ?? 0}건${inActiveRange ? " · KPI 선택 기간 포함" : " · KPI 선택 기간 밖"}`}
              aria-label={`${hideAmounts ? `${date} 거래 상세 열기` : `${date} ${unitName} 실수납 ${won(amount)} 판매금액 ${won(row?.salesAmount ?? 0)} 판매 ${row?.count ?? 0}건${filtered ? ` 전체 실수납 ${won(totalRow?.revenue ?? 0)}` : ""}`}${indicatorLabel ? `, ${indicatorLabel}` : ""}`}
            >
              <span className="flex min-w-0 items-center justify-between gap-1">
                <span className="text-xs font-bold text-text-primary sm:text-sm">
                  {Number(date.slice(8))}
                </span>
                {today === date && (
                  <span className="absolute right-0.5 top-0.5 rounded-full bg-primary px-1 py-0.5 text-[7px] font-bold leading-none text-white min-[430px]:static min-[430px]:px-1.5 min-[430px]:text-[9px]">
                    오늘
                  </span>
                )}
              </span>
              <span className="mt-1.5 flex min-h-2 items-center gap-1" aria-hidden="true">
                {hasSales && <span className="h-1.5 w-1.5 rounded-full bg-slate-500" />}
                {hasReceipt && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
                {hasRefund && <span className="h-1.5 w-1.5 rounded-full bg-error" />}
              </span>
              {hideAmounts ? (
                <span className="mt-1 block text-[9px] font-semibold text-primary sm:text-[10px]">내역 보기</span>
              ) : (
                <>
                  <strong className={cn(
                    "mt-1 block whitespace-nowrap text-[clamp(0.48rem,2.45vw,0.68rem)] font-bold tracking-[-0.035em] tabular-nums sm:text-xs",
                    hasReceipt ? "text-primary" : "text-text-muted",
                  )}>
                    {hasReceipt ? shortWon(amount) : "0원"}
                  </strong>
                  <span className="mt-0.5 block truncate text-[8px] leading-3 text-text-muted min-[430px]:text-[9px] sm:text-[10px]">
                    판매 {shortWon(row?.salesAmount ?? 0)} · {row?.count ?? 0}건
                  </span>
                  {filtered && (
                    <span className="mt-0.5 hidden truncate text-[9px] text-text-secondary sm:block">
                      전체 수납 {shortWon(totalRow?.revenue ?? 0)}
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

function CalendarIndicator({ color, label, square = false }: { color: string; label: string; square?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn(square ? "h-3 w-3 rounded border" : "h-1.5 w-1.5 rounded-full", color)} aria-hidden="true" />
      {label}
    </span>
  );
}

export function SelectedDateDetail({ date, detail, unitId, onOpenSales }: { date: string; detail: { divisions: Array<BusinessUnitOption & { revenue: number; count: number; average: number }>; other: { revenue: number; count: number; average: number }; total: number; count: number; outstanding: number; refund: number }; unitId: string; onOpenSales: (unitId?: string) => void }) {
  return <Card className="overflow-hidden"><div className="flex flex-col gap-3 border-b border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6"><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-soft text-primary"><CalendarDays size={18} /></span><div><h2 className="font-bold text-text-primary">{date} 상세</h2><p className="text-xs text-text-muted">사업부별 실매출과 당일 확인 항목</p></div></div><Button type="button" variant="secondary" onClick={() => onOpenSales()}>이 날짜 전체 매출 보기</Button></div><div className="p-5 sm:p-6"><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">{detail.divisions.map((division) => <div key={division.id} className={cn("rounded-xl border p-4", unitId === division.id ? "border-primary/30 bg-primary-subtle" : "border-border bg-surface-secondary")}><div className="flex items-center justify-between gap-2"><strong className="text-sm text-text-primary">{division.name}</strong><button type="button" className="min-h-11 rounded-lg px-2 text-xs font-semibold text-primary hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-primary" onClick={() => onOpenSales(division.id)}>매출 보기</button></div><p className="mt-3 text-xl font-bold text-text-primary tabular-nums">{won(division.revenue)}</p><p className="mt-1 text-xs text-text-muted">{division.count}건 · 평균 {won(division.average)}</p><p className="mt-1 text-xs font-semibold text-text-secondary">전체 대비 {detail.total > 0 ? ((division.revenue / detail.total) * 100).toFixed(1) : "0.0"}%</p></div>)}<div className="rounded-xl border border-warning/25 bg-warning-soft p-4"><strong className="text-sm text-text-primary">기타</strong><p className="mt-3 text-xl font-bold text-text-primary tabular-nums">{won(detail.other.revenue)}</p><p className="mt-1 text-xs text-text-muted">{detail.other.count}건 · 평균 {won(detail.other.average)}</p><p className="mt-1 text-xs font-semibold text-text-secondary">전체 대비 {detail.total > 0 ? ((detail.other.revenue / detail.total) * 100).toFixed(1) : "0.0"}%</p></div></div><div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><Summary label="총 실매출" value={won(detail.total)} /><Summary label="총 건수" value={`${detail.count}건`} /><Summary label="평균 객단가" value={won(detail.count ? detail.total / detail.count : 0)} /><Summary label="미수금" value={won(detail.outstanding)} /><Summary label="환불" value={won(detail.refund)} /></div></div></Card>;
}

function Summary({ label, value }: { label: string; value: string }) { return <div className="rounded-xl border border-border bg-white p-4"><span className="text-xs text-text-muted">{label}</span><strong className="mt-1 block text-base text-text-primary tabular-nums">{value}</strong></div>; }
