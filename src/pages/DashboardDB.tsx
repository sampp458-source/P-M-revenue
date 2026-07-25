import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { Button, ErrorState, PageHeader } from "../components/ui";
import { won } from "../lib/format";
import { supabase } from "../lib/supabase";
import { BusinessUnitCard, DashboardKpiHero, DashboardSkeleton, RecentSales } from "./dashboard/DashboardSections";
import { DailyRevenueTrend, DashboardPeriodFilters, SalesHeatmapCalendar } from "./dashboard/DashboardRangeSections";
import { DashboardDateDrawer } from "./dashboard/DashboardDateDrawer";
import { calculateDailyRevenue, calculateRangeOverview, calculateTarget, dashboardCompareLabel, dashboardComparisonRange, dashboardDefaultCompare, dashboardPeriodLabel, dashboardPeriodRange, dashboardSalesForDate, koreanToday, type BusinessUnitCode, type BusinessUnitOption, type DashboardCompare, type DashboardDateRange, type DashboardPeriod, type DashboardSale, type DashboardTarget } from "./dashboard/dashboardMetrics";

const validPeriods = new Set<DashboardPeriod>(["today", "yesterday", "this_week", "last_week", "this_month", "last_month", "custom"]);
const validComparisons = new Set<DashboardCompare>(["day", "week", "month", "previous"]);
const coreCodes = new Set<BusinessUnitCode>(["daycare", "training", "hotel"]);
const shiftDay = (value: string, days: number) => {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const monthRange = (month: string): DashboardDateRange => {
  const [year, monthNumber] = month.split("-").map(Number);
  return { from: `${month}-01`, to: `${month}-${String(new Date(year, monthNumber, 0).getDate()).padStart(2, "0")}` };
};

export function DashboardPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [sales, setSales] = useState<DashboardSale[]>([]);
  const [units, setUnits] = useState<BusinessUnitOption[]>([]);
  const [targets, setTargets] = useState<DashboardTarget[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [dateDrawerOpen, setDateDrawerOpen] = useState(false);
  const isAdmin = profile?.role === "admin";
  const today = koreanToday();
  const periodParam = searchParams.get("period") as DashboardPeriod | null;
  const period = periodParam && validPeriods.has(periodParam) ? periodParam : "today";
  const compareParam = searchParams.get("compare") as DashboardCompare | null;
  const compare = compareParam && validComparisons.has(compareParam) && (compareParam !== "previous" || period === "custom") ? compareParam : dashboardDefaultCompare(period);
  const range = useMemo(() => dashboardPeriodRange(period, today, searchParams.get("from") ?? "", searchParams.get("to") ?? ""), [period, searchParams, today]);
  const unitId = searchParams.get("unit") ?? "";
  const selectedDate = searchParams.get("day") ?? range.to;
  const [calendarMonth, setCalendarMonth] = useState(selectedDate.slice(0, 7));

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    const [saleResult, unitResult, targetResult] = await Promise.all([
      supabase.from("sales").select("id, sale_date, business_unit_id, business_unit_name, product_id, product_name, dog_id, dog_name, customer_id, customer_name, created_by, staff_name, payment_method, original_amount, additional_amount, discount_amount, paid_amount, refund_amount, outstanding_amount, net_amount, status, created_at").order("sale_date", { ascending: false }).order("created_at", { ascending: false }),
      supabase.from("business_units").select("id, code, name").eq("is_active", true).order("sort_order"),
      isAdmin
        ? supabase.from("monthly_targets").select("year, month, business_unit_id, target_amount")
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (saleResult.error || unitResult.error) {
      setSales([]);
      setUnits([]);
      setError(true);
      setLoading(false);
      return;
    }
    setSales((saleResult.data ?? []).map((row) => ({
      id: row.id,
      saleDate: row.sale_date,
      businessUnitId: row.business_unit_id,
      businessUnitName: row.business_unit_name,
      productId: row.product_id,
      productName: row.product_name,
      dogId: row.dog_id,
      dogName: row.dog_name || "(반려견 없음)",
      customerId: row.customer_id,
      customerName: row.customer_name,
      createdBy: row.created_by,
      staffName: row.staff_name,
      paymentMethod: row.payment_method,
      originalAmount: row.original_amount ?? 0,
      additionalAmount: row.additional_amount ?? 0,
      discountAmount: row.discount_amount ?? 0,
      paidAmount: row.paid_amount ?? 0,
      refundAmount: row.refund_amount ?? 0,
      outstandingAmount: row.outstanding_amount ?? 0,
      netAmount: row.net_amount ?? 0,
      status: row.status,
      createdAt: row.created_at,
    })));
    setUnits((unitResult.data ?? []).map((row) => ({ id: row.id, code: row.code, name: row.name })));
    setTargets((targetResult.data ?? []).map((row) => ({
      year: row.year,
      month: row.month,
      businessUnitId: row.business_unit_id,
      targetAmount: row.target_amount ?? 0,
    })));
    setLoading(false);
  }, [isAdmin]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    let changed = false;
    if (!searchParams.get("period")) { next.set("period", period); changed = true; }
    if (searchParams.get("from") !== range.from) { next.set("from", range.from); changed = true; }
    if (searchParams.get("to") !== range.to) { next.set("to", range.to); changed = true; }
    if (!searchParams.get("day")) { next.set("day", range.to); changed = true; }
    if (!searchParams.get("compare")) { next.set("compare", compare); changed = true; }
    if (changed) setSearchParams(next, { replace: true });
  }, [compare, period, range.from, range.to, searchParams, setSearchParams]);
  useEffect(() => { setCalendarMonth(selectedDate.slice(0, 7)); }, [selectedDate]);

  const updateQuery = useCallback((updates: Record<string, string | null>, replace = false) => {
    const next = new URLSearchParams(searchParams);
    Object.entries(updates).forEach(([key, value]) => value ? next.set(key, value) : next.delete(key));
    setSearchParams(next, { replace });
  }, [searchParams, setSearchParams]);
  const selectPeriod = (nextPeriod: DashboardPeriod) => {
    const nextRange = dashboardPeriodRange(nextPeriod, today, range.from, range.to);
    updateQuery({ period: nextPeriod, from: nextRange.from, to: nextRange.to, day: nextRange.to, compare: dashboardDefaultCompare(nextPeriod) });
  };
  const selectCustomRange = (nextRange: DashboardDateRange) => {
    if (!nextRange.from || !nextRange.to) return;
    const normalized = nextRange.from <= nextRange.to ? nextRange : { from: nextRange.to, to: nextRange.from };
    updateQuery({ period: "custom", from: normalized.from, to: normalized.to, day: normalized.to, compare: "previous" });
  };
  const moveRange = (direction: number) => {
    const start = new Date(`${range.from}T12:00:00`);
    const end = new Date(`${range.to}T12:00:00`);
    const length = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
    const from = shiftDay(range.from, length * direction);
    const to = shiftDay(range.to, length * direction);
    updateQuery({ period: "custom", from, to, day: to, compare });
  };

  const comparisonRange = useMemo(() => dashboardComparisonRange(period, range, compare), [compare, period, range]);
  const visibleRange = useMemo(
    () => isAdmin ? range : { from: selectedDate, to: selectedDate },
    [isAdmin, range, selectedDate],
  );
  const visibleComparisonRange = useMemo(
    () => isAdmin
      ? comparisonRange
      : dashboardComparisonRange("today", visibleRange, "day"),
    [comparisonRange, isAdmin, visibleRange],
  );
  const overview = useMemo(() => calculateRangeOverview(sales, units, visibleRange, visibleComparisonRange), [sales, units, visibleComparisonRange, visibleRange]);
  const selectedSales = useMemo(
    () =>
      unitId
        ? sales.filter((sale) => sale.businessUnitId === unitId)
        : sales,
    [sales, unitId],
  );
  const selectedOverview = useMemo(
    () =>
      calculateRangeOverview(
        selectedSales,
        units,
        visibleRange,
        visibleComparisonRange,
      ),
    [selectedSales, units, visibleComparisonRange, visibleRange],
  );
  const selectedMonth =
    range.from.slice(0, 7) === range.to.slice(0, 7)
      ? range.from.slice(0, 7)
      : null;
  const targetMonth =
    selectedMonth &&
    range.from === monthRange(selectedMonth).from &&
    range.to === monthRange(selectedMonth).to
      ? selectedMonth
      : null;
  const monthlyTarget = useMemo(
    () => targetMonth ? calculateTarget(targetMonth, unitId, targets) : null,
    [targetMonth, targets, unitId],
  );
  const coreDivisions = overview.divisions.filter((division) => coreCodes.has(division.code as BusinessUnitCode));
  const representedTotal = coreDivisions.reduce((total, division) => total + division.revenue, 0);
  const otherRevenue = Math.max(0, overview.total - representedTotal);
  const selectedUnitName = units.find((unit) => unit.id === unitId)?.name ?? "전체 사업부";
  const compareLabel = dashboardCompareLabel(compare);
  const periodLabel = dashboardPeriodLabel(period);
  const rangeLabel =
    range.from === range.to ? range.from : `${range.from} ~ ${range.to}`;
  const daily = useMemo(() => calculateDailyRevenue(sales, range, unitId), [range, sales, unitId]);
  const calendarData = useMemo(() => calculateDailyRevenue(sales, monthRange(calendarMonth), unitId), [calendarMonth, sales, unitId]);
  const calendarTotalData = useMemo(() => calculateDailyRevenue(sales, monthRange(calendarMonth)), [calendarMonth, sales]);
  const selectedDateSales = useMemo(
    () => dashboardSalesForDate(sales, selectedDate, unitId),
    [sales, selectedDate, unitId],
  );
  const selectedDateSummary = useMemo(
    () => calculateDailyRevenue(sales, { from: selectedDate, to: selectedDate }, unitId)[0],
    [sales, selectedDate, unitId],
  );
  const recent = useMemo(() => sales.filter((sale) => sale.saleDate >= range.from && sale.saleDate <= range.to).sort((left, right) => right.saleDate.localeCompare(left.saleDate) || right.createdAt.localeCompare(left.createdAt)).slice(0, 5), [range.from, range.to, sales]);
  const openSales = (date = selectedDate, targetUnit = "") => navigate(`/sales?period=custom&start=${date}&end=${date}${targetUnit ? `&unit=${targetUnit}` : ""}`);
  const selectCalendarDate = (date: string) => {
    updateQuery({ day: date });
    setDateDrawerOpen(true);
  };
  const openSale = (saleId: string) => navigate(`/sales?period=custom&start=${selectedDate}&end=${selectedDate}${unitId ? `&unit=${unitId}` : ""}&detail=${saleId}`);

  if (loading) return <DashboardSkeleton />;
  if (error) return <ErrorState title="대시보드 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요." retry={() => void load()} />;
  return <>
    <PageHeader title="대시보드" description={isAdmin ? "대표가 사업부와 날짜 흐름을 빠르게 읽는 경영 현황" : "오늘과 선택 날짜의 업무 매출을 빠르게 확인합니다."} />
    {isAdmin && <DashboardPeriodFilters period={period} range={range} unitName={selectedUnitName} compare={compare} onPeriod={selectPeriod} onCustom={selectCustomRange} onMovePeriod={moveRange} onCompare={(nextCompare) => updateQuery({ compare: nextCompare })} />}
    {isAdmin && (
      <section className="mb-8" aria-label={`${periodLabel} 핵심 매출 지표`}>
        <DashboardKpiHero
          periodLabel={periodLabel}
          rangeLabel={rangeLabel}
          unitName={selectedUnitName}
          compareLabel={compareLabel}
          salesAmount={selectedOverview.salesAmount}
          previousSalesAmount={selectedOverview.previousSalesAmount}
          netAmount={selectedOverview.net}
          previousNetAmount={selectedOverview.previousTotal}
          count={selectedOverview.count}
          monthlyTarget={monthlyTarget}
          outstanding={selectedOverview.outstanding}
          refund={selectedOverview.refund}
        />
      </section>
    )}
    <section aria-labelledby="business-unit-overview-title">
      <div className="mb-4 flex items-end justify-between gap-3"><div><h2 id="business-unit-overview-title" className="text-lg font-bold text-text-primary">사업부 현황</h2><p className="mt-1 text-xs text-text-muted">{isAdmin ? "카드를 선택하면 아래 추이와 캘린더가 해당 사업부 기준으로 바뀝니다." : `${selectedDate} 기준 · 카드를 선택하면 날짜 상세도 함께 필터링됩니다.`}</p></div>{unitId && <Button type="button" variant="ghost" onClick={() => updateQuery({ unit: null })}>전체 보기</Button>}</div>
      <div className="grid gap-4 lg:grid-cols-3">{coreDivisions.map((division, index) => <BusinessUnitCard key={division.id} order={index + 1} name={division.name} revenue={division.revenue} previousRevenue={division.previousRevenue} compareLabel={compareLabel} share={overview.total > 0 ? (division.revenue / overview.total) * 100 : 0} count={division.count} average={division.average} restricted={!isAdmin} selected={unitId === division.id} onClick={() => updateQuery({ unit: unitId === division.id ? null : division.id })} />)}</div>
      {isAdmin && otherRevenue > 0 && <p className="mt-3 rounded-xl border border-warning/20 bg-warning-soft px-4 py-3 text-sm text-text-secondary">기타·비활성 사업부 매출 {won(otherRevenue)}이 총매출에 포함되어 있습니다.</p>}
    </section>
    <div className="mt-8"><SalesHeatmapCalendar month={calendarMonth} data={calendarData} totalData={calendarTotalData} unitName={selectedUnitName} today={today} selectedDate={selectedDate} hideAmounts={!isAdmin} onMonth={setCalendarMonth} onSelect={selectCalendarDate} /></div>
    {isAdmin && <div className="mt-6"><DailyRevenueTrend data={daily} selectedDate={selectedDate} unitName={selectedUnitName} onSelect={(date) => updateQuery({ day: date })} /></div>}
    {isAdmin && <div className="mt-6"><RecentSales rows={recent} onOpen={() => navigate(`/sales?period=custom&start=${range.from}&end=${range.to}${unitId ? `&unit=${unitId}` : ""}`)} /></div>}
    <DashboardDateDrawer open={dateDrawerOpen} date={selectedDate} unitName={selectedUnitName} summary={selectedDateSummary} rows={selectedDateSales} onClose={() => setDateDrawerOpen(false)} onOpenSale={openSale} onOpenSales={() => openSales(selectedDate, unitId)} />
  </>;
}
