import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ErrorState, PageHeader } from "../components/ui";
import { won } from "../lib/format";
import { supabase } from "../lib/supabase";
import { BusinessUnitCard, DashboardSkeleton, MetricCard, RecentSales } from "./dashboard/DashboardSections";
import { DailyRevenueTrend, DashboardPeriodFilters, SalesHeatmapCalendar, SelectedDateDetail } from "./dashboard/DashboardRangeSections";
import { calculateDailyRevenue, calculateDateDetail, calculateRangeOverview, dashboardComparisonRange, dashboardPeriodRange, koreanToday, type BusinessUnitCode, type BusinessUnitOption, type DashboardDateRange, type DashboardPeriod, type DashboardSale } from "./dashboard/dashboardMetrics";

const validPeriods = new Set<DashboardPeriod>(["today", "yesterday", "this_week", "last_week", "this_month", "last_month", "custom"]);
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
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [sales, setSales] = useState<DashboardSale[]>([]);
  const [units, setUnits] = useState<BusinessUnitOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const today = koreanToday();
  const periodParam = searchParams.get("period") as DashboardPeriod | null;
  const period = periodParam && validPeriods.has(periodParam) ? periodParam : "today";
  const range = useMemo(() => dashboardPeriodRange(period, today, searchParams.get("from") ?? "", searchParams.get("to") ?? ""), [period, searchParams, today]);
  const unitId = searchParams.get("unit") ?? "";
  const selectedDate = searchParams.get("day") ?? range.to;
  const [calendarMonth, setCalendarMonth] = useState(selectedDate.slice(0, 7));

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    const [saleResult, unitResult] = await Promise.all([
      supabase.from("sales").select("id, sale_date, business_unit_id, business_unit_name, product_id, product_name, dog_id, dog_name, customer_id, customer_name, created_by, staff_name, paid_amount, refund_amount, outstanding_amount, net_amount, status, created_at").order("sale_date", { ascending: false }).order("created_at", { ascending: false }),
      supabase.from("business_units").select("id, code, name").eq("is_active", true).order("sort_order"),
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
      paidAmount: row.paid_amount ?? 0,
      refundAmount: row.refund_amount ?? 0,
      outstandingAmount: row.outstanding_amount ?? 0,
      netAmount: row.net_amount ?? 0,
      status: row.status,
      createdAt: row.created_at,
    })));
    setUnits((unitResult.data ?? []).map((row) => ({ id: row.id, code: row.code, name: row.name })));
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    let changed = false;
    if (!searchParams.get("period")) { next.set("period", period); changed = true; }
    if (searchParams.get("from") !== range.from) { next.set("from", range.from); changed = true; }
    if (searchParams.get("to") !== range.to) { next.set("to", range.to); changed = true; }
    if (!searchParams.get("day")) { next.set("day", range.to); changed = true; }
    if (changed) setSearchParams(next, { replace: true });
  }, [period, range.from, range.to, searchParams, setSearchParams]);
  useEffect(() => { setCalendarMonth(selectedDate.slice(0, 7)); }, [selectedDate]);

  const updateQuery = useCallback((updates: Record<string, string | null>, replace = false) => {
    const next = new URLSearchParams(searchParams);
    Object.entries(updates).forEach(([key, value]) => value ? next.set(key, value) : next.delete(key));
    setSearchParams(next, { replace });
  }, [searchParams, setSearchParams]);
  const selectPeriod = (nextPeriod: DashboardPeriod) => {
    const nextRange = dashboardPeriodRange(nextPeriod, today, range.from, range.to);
    updateQuery({ period: nextPeriod, from: nextRange.from, to: nextRange.to, day: nextRange.to });
  };
  const selectCustomRange = (nextRange: DashboardDateRange) => {
    if (!nextRange.from || !nextRange.to) return;
    const normalized = nextRange.from <= nextRange.to ? nextRange : { from: nextRange.to, to: nextRange.from };
    updateQuery({ period: "custom", from: normalized.from, to: normalized.to, day: normalized.to });
  };
  const moveSingleDay = (days: number) => {
    const date = shiftDay(range.from, days);
    updateQuery({ period: "custom", from: date, to: date, day: date });
  };

  const comparisonRange = useMemo(() => dashboardComparisonRange(period, range), [period, range]);
  const overview = useMemo(() => calculateRangeOverview(sales, units, range, comparisonRange), [comparisonRange, range, sales, units]);
  const coreDivisions = overview.divisions.filter((division) => coreCodes.has(division.code as BusinessUnitCode));
  const representedTotal = coreDivisions.reduce((total, division) => total + division.revenue, 0);
  const otherRevenue = Math.max(0, overview.total - representedTotal);
  const selectedUnitName = units.find((unit) => unit.id === unitId)?.name ?? "전체 사업부";
  const daily = useMemo(() => calculateDailyRevenue(sales, range, unitId), [range, sales, unitId]);
  const calendarData = useMemo(() => calculateDailyRevenue(sales, monthRange(calendarMonth), unitId), [calendarMonth, sales, unitId]);
  const dateDetail = useMemo(() => calculateDateDetail(sales, units, selectedDate), [sales, selectedDate, units]);
  const recent = useMemo(() => sales.filter((sale) => sale.saleDate >= range.from && sale.saleDate <= range.to).sort((left, right) => right.saleDate.localeCompare(left.saleDate) || right.createdAt.localeCompare(left.createdAt)).slice(0, 5), [range.from, range.to, sales]);
  const openSales = (date = selectedDate, targetUnit = "") => navigate(`/sales?period=custom&start=${date}&end=${date}${targetUnit ? `&unit=${targetUnit}` : ""}`);

  if (loading) return <DashboardSkeleton />;
  if (error) return <ErrorState title="대시보드 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요." retry={() => void load()} />;
  return <>
    <PageHeader title="대시보드" description="대표가 사업부와 날짜 흐름을 빠르게 읽는 경영 현황" />
    <DashboardPeriodFilters period={period} range={range} unitName={selectedUnitName} onPeriod={selectPeriod} onCustom={selectCustomRange} onMoveDay={moveSingleDay} />
    <section aria-labelledby="business-unit-overview-title">
      <div className="mb-3"><h2 id="business-unit-overview-title" className="text-lg font-bold text-text-primary">사업부 현황</h2><p className="mt-1 text-xs text-text-muted">카드를 선택하면 아래 추이와 캘린더가 해당 사업부 기준으로 바뀝니다.</p></div>
      <div className="grid gap-4 lg:grid-cols-3">{coreDivisions.map((division, index) => <BusinessUnitCard key={division.id} order={index + 1} name={division.name} revenue={division.revenue} comparison={{ rate: division.rate, previousRevenue: division.previousRevenue }} kpis={[{ label: "매출 건수", value: `${division.count.toLocaleString("ko-KR")}건` }, { label: "객단가", value: won(division.average) }, { label: "비교 기간", value: `${overview.previousRange.from.slice(5)}~${overview.previousRange.to.slice(5)}` }]} selected={unitId === division.id} onClick={() => updateQuery({ unit: unitId === division.id ? null : division.id })} />)}</div>
    </section>
    <section className="mt-7" aria-labelledby="company-summary-title">
      <div className="mb-3"><h2 id="company-summary-title" className="text-lg font-bold text-text-primary">총매출</h2><p className="mt-1 text-xs text-text-muted">유치원·교육·호텔과 기타 사업부의 실매출을 모두 합산합니다.</p></div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><MetricCard label="총 실매출" value={won(overview.total)} description="결제액 - 환불액 · 취소 제외" /><MetricCard label="총 건수" value={`${overview.count.toLocaleString("ko-KR")}건`} description="선택 기간 기준" /><MetricCard label="평균 객단가" value={won(overview.average)} description="실매출 ÷ 총 건수" /><MetricCard label="미수금" value={won(overview.outstanding)} description="실매출에서 중복 차감하지 않음" /><MetricCard label="환불" value={won(overview.refund)} description="선택 기간 환불액" /></div>
      {otherRevenue > 0 && <p className="mt-3 rounded-xl border border-warning/20 bg-warning-soft px-4 py-3 text-sm text-text-secondary">기타·비활성 사업부 매출 {won(otherRevenue)}이 총매출에 포함되어 있습니다.</p>}
    </section>
    <div className="mt-7"><DailyRevenueTrend data={daily} selectedDate={selectedDate} unitName={selectedUnitName} onSelect={(date) => updateQuery({ day: date })} /></div>
    <div className="mt-4"><SalesHeatmapCalendar month={calendarMonth} data={calendarData} today={today} selectedDate={selectedDate} onMonth={setCalendarMonth} onSelect={(date) => updateQuery({ day: date })} /></div>
    <div className="mt-4"><SelectedDateDetail date={selectedDate} detail={dateDetail} unitId={unitId} onOpenSales={(targetUnit) => openSales(selectedDate, targetUnit)} /></div>
    <div className="mt-4"><RecentSales rows={recent} onOpen={() => navigate(`/sales?period=custom&start=${range.from}&end=${range.to}${unitId ? `&unit=${unitId}` : ""}`)} /></div>
  </>;
}
