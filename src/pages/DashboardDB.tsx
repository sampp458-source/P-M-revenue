import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Banknote } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { Badge, Button, Card, ErrorState, PageHeader } from "../components/ui";
import { won } from "../lib/format";
import { supabase } from "../lib/supabase";
import { BusinessUnitCard, DashboardKpiHero, DashboardSkeleton, RecentSales } from "./dashboard/DashboardSections";
import { DailyRevenueTrend, DashboardPeriodFilters, SalesHeatmapCalendar } from "./dashboard/DashboardRangeSections";
import { DashboardDateDrawer } from "./dashboard/DashboardDateDrawer";
import { OutstandingPaymentsDrawer } from "./dashboard/OutstandingPaymentsDrawer";
import { calculateDailyRevenue, calculateRangeOverview, calculateTarget, dashboardCompareLabel, dashboardComparisonRange, dashboardDefaultCompare, dashboardPeriodLabel, dashboardPeriodRange, dashboardSalesForDate, koreanToday, type BusinessUnitCode, type BusinessUnitOption, type DashboardCompare, type DashboardDateRange, type DashboardPeriod, type DashboardSale, type DashboardTarget } from "./dashboard/dashboardMetrics";
import { calculateLedgerCashSummary, calculateLedgerDaily, type PaymentLedgerEntry, type RefundLedgerEntry } from "./paymentLedgerMetrics";

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
  const [payments, setPayments] = useState<PaymentLedgerEntry[]>([]);
  const [refunds, setRefunds] = useState<RefundLedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [dateDrawerOpen, setDateDrawerOpen] = useState(false);
  const [outstandingDrawerOpen, setOutstandingDrawerOpen] = useState(false);
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

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(false);
    const [saleResult, unitResult, targetResult, paymentResult, refundResult] = await Promise.all([
      supabase.from("sales").select("id, sale_date, business_unit_id, business_unit_name, product_id, product_name, dog_id, dog_name, customer_id, customer_name, customer_phone, memo, created_by, staff_name, payment_method, original_amount, additional_amount, discount_amount, paid_amount, refund_amount, outstanding_amount, net_amount, status, created_at").order("sale_date", { ascending: false }).order("created_at", { ascending: false }),
      supabase.from("business_units").select("id, code, name").eq("is_active", true).order("sort_order"),
      isAdmin
        ? supabase.from("monthly_targets").select("year, month, business_unit_id, target_amount")
        : Promise.resolve({ data: [], error: null }),
      supabase.from("sale_payments").select("id, sale_id, payment_date, amount, voided_at"),
      supabase.from("sale_refunds").select("id, sale_id, refund_date, amount, voided_at"),
    ]);
    if (saleResult.error || unitResult.error || paymentResult.error || refundResult.error) {
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
      customerPhone: row.customer_phone,
      memo: row.memo,
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
    setPayments((paymentResult.data ?? []).map((row) => ({
      id: row.id,
      saleId: row.sale_id,
      paymentDate: row.payment_date,
      amount: row.amount,
      voidedAt: row.voided_at,
    })));
    setRefunds((refundResult.data ?? []).map((row) => ({
      id: row.id,
      saleId: row.sale_id,
      refundDate: row.refund_date,
      amount: row.amount,
      voidedAt: row.voided_at,
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
  const selectedCash = useMemo(
    () => calculateLedgerCashSummary(sales, payments, refunds, visibleRange, unitId),
    [payments, refunds, sales, unitId, visibleRange],
  );
  const previousCash = useMemo(
    () => calculateLedgerCashSummary(sales, payments, refunds, visibleComparisonRange, unitId),
    [payments, refunds, sales, unitId, visibleComparisonRange],
  );
  const currentOutstanding = useMemo(
    () =>
      selectedSales
        .filter((sale) => sale.status !== "cancelled" && sale.outstandingAmount > 0)
        .reduce((total, sale) => total + sale.outstandingAmount, 0),
    [selectedSales],
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
  const daily = useMemo(() => {
    const saleDays = calculateDailyRevenue(sales, range, unitId);
    const cashDays = calculateLedgerDaily(sales, payments, refunds, range, unitId);
    const cashByDate = new Map(cashDays.map((day) => [day.date, day]));
    return saleDays.map((day) => ({
      ...day,
      revenue: cashByDate.get(day.date)?.paidAmount ?? 0,
      net: cashByDate.get(day.date)?.netAmount ?? 0,
      refund: cashByDate.get(day.date)?.refundAmount ?? 0,
    }));
  }, [payments, range, refunds, sales, unitId]);
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
    {!isAdmin && (
      <Card className="mb-6 overflow-hidden border-warning/20 bg-warning-soft/45 p-0">
        <button
          type="button"
          onClick={() => setOutstandingDrawerOpen(true)}
          className="flex min-h-24 w-full items-center gap-4 p-5 text-left transition-colors hover:bg-warning-soft focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-warning"
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-surface text-warning">
            <Banknote size={20} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-semibold text-warning">현재 전체 미수</span>
            <strong className="mt-1 block text-2xl text-text-primary tabular-nums">{won(currentOutstanding)}</strong>
            <span className="mt-1 block text-xs text-text-muted">발생일과 관계없이 수납이 필요한 거래 보기</span>
          </span>
          <span className="shrink-0 text-sm font-semibold text-warning">수납하기</span>
        </button>
      </Card>
    )}
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
          netAmount={selectedCash.netAmount}
          previousNetAmount={previousCash.netAmount}
          count={selectedOverview.count}
          monthlyTarget={monthlyTarget}
          outstanding={currentOutstanding}
          refund={selectedCash.refundAmount}
          onOutstanding={() => setOutstandingDrawerOpen(true)}
        />
      </section>
    )}
    <section aria-labelledby="business-unit-overview-title">
      <div className="mb-4 flex items-end justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><h2 id="business-unit-overview-title" className="text-lg font-bold text-text-primary">사업부 비교 · 전체 기준</h2>{unitId && <Badge tone="blue">KPI는 {selectedUnitName} 기준</Badge>}</div><p className="mt-1 text-[13px] leading-5 text-text-muted">{isAdmin ? "세 카드는 전체 사업부를 같은 기간으로 비교합니다. 선택한 사업부는 KPI·추이·캘린더에 적용됩니다." : `${selectedDate} 기준 · 카드를 선택하면 날짜 상세도 함께 필터링됩니다.`}</p></div>{unitId && <Button type="button" variant="ghost" onClick={() => updateQuery({ unit: null })}>전체 보기</Button>}</div>
      <div className="grid gap-4 lg:grid-cols-3">{coreDivisions.map((division, index) => <BusinessUnitCard key={division.id} order={index + 1} name={division.name} revenue={division.revenue} previousRevenue={division.previousRevenue} compareLabel={compareLabel} share={overview.total > 0 ? (division.revenue / overview.total) * 100 : 0} count={division.count} average={division.average} restricted={!isAdmin} selected={unitId === division.id} muted={Boolean(unitId && unitId !== division.id)} onClick={() => updateQuery({ unit: unitId === division.id ? null : division.id })} />)}</div>
      {isAdmin && otherRevenue > 0 && <p className="mt-3 rounded-xl border border-warning/20 bg-warning-soft px-4 py-3 text-sm text-text-secondary">기타·비활성 사업부 매출 {won(otherRevenue)}이 총매출에 포함되어 있습니다.</p>}
    </section>
    <div className="mt-8"><SalesHeatmapCalendar month={calendarMonth} activeRange={range} data={calendarData} totalData={calendarTotalData} unitName={selectedUnitName} today={today} selectedDate={selectedDate} hideAmounts={!isAdmin} onMonth={setCalendarMonth} onSelect={selectCalendarDate} /></div>
    {isAdmin && <div className="mt-6"><DailyRevenueTrend data={daily} selectedDate={selectedDate} unitName={selectedUnitName} onSelect={(date) => updateQuery({ day: date })} /></div>}
    {isAdmin && <div className="mt-6"><RecentSales rows={recent} onOpen={() => navigate(`/sales?period=custom&start=${range.from}&end=${range.to}${unitId ? `&unit=${unitId}` : ""}`)} /></div>}
    <DashboardDateDrawer open={dateDrawerOpen} date={selectedDate} unitName={selectedUnitName} summary={selectedDateSummary} rows={selectedDateSales} onClose={() => setDateDrawerOpen(false)} onOpenSale={openSale} onOpenSales={() => openSales(selectedDate, unitId)} />
    <OutstandingPaymentsDrawer
      open={outstandingDrawerOpen}
      unitId={unitId}
      unitName={selectedUnitName}
      units={units}
      sales={sales}
      onClose={() => setOutstandingDrawerOpen(false)}
      onChanged={() => load(true)}
    />
  </>;
}
