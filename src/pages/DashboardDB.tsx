import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ErrorState, PageHeader } from "../components/ui";
import { currentMonth, monthLabel, won } from "../lib/format";
import { supabase } from "../lib/supabase";
import { BusinessUnitBreakdown, DashboardFilters, DashboardSkeleton, MetricCard, OperationalAlerts, RecentSales, RevenueTrend } from "./dashboard/DashboardSections";
import { calculateDashboard, calculateTrend, type BusinessUnitOption, type DashboardSale, type DashboardTarget } from "./dashboard/dashboardMetrics";

export function DashboardPage() {
  const navigate = useNavigate();
  const [month, setMonth] = useState(currentMonth());
  const [unitId, setUnitId] = useState("");
  const [sales, setSales] = useState<DashboardSale[]>([]);
  const [targets, setTargets] = useState<DashboardTarget[]>([]);
  const [units, setUnits] = useState<BusinessUnitOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(false);
    const [saleResult, targetResult, unitResult] = await Promise.all([
      supabase.from("sales").select("id, sale_date, business_unit_id, business_unit_name, product_id, product_name, dog_id, dog_name, customer_id, customer_name, created_by, staff_name, paid_amount, refund_amount, outstanding_amount, net_amount, status, created_at").order("sale_date", { ascending: false }).order("created_at", { ascending: false }),
      supabase.from("monthly_targets").select("year, month, business_unit_id, target_amount"),
      supabase.from("business_units").select("id, name").eq("is_active", true).order("sort_order"),
    ]);
    if (saleResult.error || targetResult.error || unitResult.error) { setSales([]); setTargets([]); setUnits([]); setError(true); setLoading(false); return; }
    setSales((saleResult.data ?? []).map((row) => ({
      id: row.id, saleDate: row.sale_date, businessUnitId: row.business_unit_id, businessUnitName: row.business_unit_name,
      productId: row.product_id, productName: row.product_name, dogId: row.dog_id, dogName: row.dog_name,
      customerId: row.customer_id, customerName: row.customer_name, createdBy: row.created_by, staffName: row.staff_name,
      paidAmount: row.paid_amount ?? 0, refundAmount: row.refund_amount ?? 0, outstandingAmount: row.outstanding_amount ?? 0,
      netAmount: row.net_amount ?? 0, status: row.status, createdAt: row.created_at,
    })));
    setTargets((targetResult.data ?? []).map((row) => ({ year: row.year, month: row.month, businessUnitId: row.business_unit_id, targetAmount: row.target_amount ?? 0 })));
    setUnits((unitResult.data ?? []).map((row) => ({ id: row.id, name: row.name })));
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const months = useMemo(() => {
    const values = new Set(sales.map((sale) => sale.saleDate.slice(0, 7))); values.add(currentMonth());
    return [...values].sort().reverse();
  }, [sales]);
  const metrics = useMemo(() => calculateDashboard(sales, targets, units, month, unitId), [month, sales, targets, unitId, units]);
  const trend = useMemo(() => calculateTrend(sales, unitId), [sales, unitId]);
  const selectedUnit = units.find((unit) => unit.id === unitId)?.name ?? "전체 사업부";
  const openSales = () => navigate("/sales");

  if (loading) return <DashboardSkeleton />;
  if (error) return <ErrorState title="대시보드 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요." retry={() => void load()} />;
  return <>
    <PageHeader title="대시보드" description={`${monthLabel(month)} · ${selectedUnit} 운영 현황`} />
    <DashboardFilters month={month} unitId={unitId} months={months} units={units} onMonth={setMonth} onUnit={setUnitId} />
    <div className="grid gap-4 lg:grid-cols-3">
      <MetricCard featured tone="primary" label="오늘 매출" value={won(metrics.todayNet)} description={`오늘 등록 ${metrics.todayCount}건 · 선택 사업부 기준`} />
      <MetricCard featured label="이번 달 실매출" value={won(metrics.real)} description="결제액 - 환불액 · 취소 매출 제외" />
      <MetricCard featured tone="progress" label="목표 달성률" value={`${metrics.achievement.toFixed(1)}%`} description={`${won(metrics.real)} / 목표 ${won(metrics.target)}`} progress={metrics.achievement} />
    </div>
    <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <MetricCard label="총매출" value={won(metrics.total)} description="취소 제외 결제액" />
      <MetricCard label="환불액" value={won(metrics.refund)} description={`${metrics.alerts.refundCount}건 누적`} />
      <MetricCard label="미수금" value={won(metrics.outstanding)} description={`${metrics.alerts.outstandingCount}건 확인 필요`} />
      <MetricCard label="전월 대비" value={`${metrics.diff >= 0 ? "+" : ""}${won(metrics.diff)}`} description={metrics.rate === null ? "전월 실매출 없음" : `${metrics.rate >= 0 ? "+" : ""}${metrics.rate.toFixed(1)}%`} />
      <MetricCard label="오늘 등록" value={`${metrics.todayCount}건`} description="한국 시간 기준" />
    </div>
    <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {metrics.divisions.map((division) => <MetricCard key={division.id} label={`${division.name} 매출`} value={won(division.value)} description={unitId && division.id !== unitId ? "현재 선택 조건 외 사업부" : "선택 월 실매출"} />)}
    </div>
    <div className={`mt-4 grid gap-4 ${unitId ? "" : "xl:grid-cols-2"}`}><RevenueTrend data={trend} />{!unitId && <BusinessUnitBreakdown rows={metrics.divisions} total={metrics.real} />}</div>
    <div className="mt-4"><OperationalAlerts alerts={metrics.alerts} onOpen={openSales} /></div>
    <div className="mt-4"><RecentSales rows={metrics.recent} onOpen={openSales} /></div>
  </>;
}
