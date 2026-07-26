import { useCallback, useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, EmptyState, ErrorState, PageHeader, Select, Skeleton, StatusBadge } from "../components/ui";
import { currentMonth, monthLabel, shortWon, won } from "../lib/format";
import { supabase } from "../lib/supabase";
import {
  calculateLedgerCashSummary,
  calculateLedgerDaily,
  calculateLedgerPaymentMethodTotals,
  type PaymentLedgerEntry,
  type RefundLedgerEntry,
} from "./paymentLedgerMetrics";
import { finalSaleAmount } from "./dashboard/dashboardMetrics";
import {
  activeReportSales,
  calculateReportDaily,
  calculateReportMoneySummary,
  calculateReportTrend,
} from "./reportsMetrics";

interface ReportSale {
  id: string; saleDate: string; businessUnitId: string; businessUnitName: string; productId: string; productName: string;
  originalAmount: number; additionalAmount: number; discountAmount: number;
  paidAmount: number; refundAmount: number; outstandingAmount: number; netAmount: number; status: string;
  staffId: string | null; staffName: string | null;
}
interface HistoryEvent { id: string; saleId: string; action: string; changedBy: string; createdAt: string; previousData: unknown; changedData: unknown }
interface Target { year: number; month: number; businessUnitId: string | null; targetAmount: number }
interface NamedRow { id: string; name: string }

const safe = (value: number | null | undefined) => Number.isFinite(value) ? Number(value) : 0;

export function ReportsPage() {
  const [month, setMonth] = useState(currentMonth());
  const [sales, setSales] = useState<ReportSale[]>([]);
  const [history, setHistory] = useState<HistoryEvent[]>([]);
  const [targets, setTargets] = useState<Target[]>([]);
  const [units, setUnits] = useState<NamedRow[]>([]);
  const [profiles, setProfiles] = useState<NamedRow[]>([]);
  const [products, setProducts] = useState<NamedRow[]>([]);
  const [payments, setPayments] = useState<PaymentLedgerEntry[]>([]);
  const [refundLedger, setRefundLedger] = useState<RefundLedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(false);
    const [salesResult, historyResult, targetsResult, unitsResult, productsResult, profilesResult, paymentsResult, refundsResult] = await Promise.all([
      supabase.from("sales").select("id, sale_date, business_unit_id, business_unit_name, product_id, product_name, original_amount, additional_amount, discount_amount, paid_amount, refund_amount, outstanding_amount, net_amount, status, staff_id, staff_name"),
      supabase.from("sale_history").select("id, sale_id, action, changed_by, created_at, previous_data, changed_data").in("action", ["partial_refund", "full_refund", "cancelled"]).order("created_at", { ascending: false }),
      supabase.from("monthly_targets").select("year, month, business_unit_id, target_amount"),
      supabase.from("business_units").select("id, name").eq("is_active", true).order("sort_order"),
      supabase.from("products").select("id, name"),
      supabase.rpc("get_staff_history_directory"),
      supabase.from("sale_payments").select("id, sale_id, payment_method, payment_date, amount, voided_at"),
      supabase.from("sale_refunds").select("id, sale_id, refund_date, amount, voided_at"),
    ]);
    if ([salesResult, historyResult, targetsResult, unitsResult, productsResult, profilesResult, paymentsResult, refundsResult].some((result) => result.error)) {
      setError(true); setLoading(false); return;
    }
    setSales((salesResult.data ?? []).map((row) => ({
      id: row.id, saleDate: row.sale_date, businessUnitId: row.business_unit_id, businessUnitName: row.business_unit_name,
      productId: row.product_id, productName: row.product_name, originalAmount: row.original_amount ?? 0,
      additionalAmount: row.additional_amount ?? 0, discountAmount: row.discount_amount ?? 0,
      paidAmount: row.paid_amount ?? 0, refundAmount: row.refund_amount ?? 0,
      outstandingAmount: row.outstanding_amount ?? 0, netAmount: row.net_amount ?? 0, status: row.status,
      staffId: row.staff_id, staffName: row.staff_name,
    })));
    setHistory((historyResult.data ?? []).map((row) => ({ id: row.id, saleId: row.sale_id, action: row.action, changedBy: row.changed_by, createdAt: row.created_at, previousData: row.previous_data, changedData: row.changed_data })));
    setTargets((targetsResult.data ?? []).map((row) => ({ year: row.year, month: row.month, businessUnitId: row.business_unit_id, targetAmount: row.target_amount ?? 0 })));
    setUnits(unitsResult.data ?? []); setProducts(productsResult.data ?? []); setProfiles(profilesResult.data ?? []);
    setPayments((paymentsResult.data ?? []).map((row) => ({
      id: row.id, saleId: row.sale_id, paymentDate: row.payment_date,
      amount: row.amount, voidedAt: row.voided_at,
      paymentMethod: row.payment_method,
    })));
    setRefundLedger((refundsResult.data ?? []).map((row) => ({
      id: row.id, saleId: row.sale_id, refundDate: row.refund_date,
      amount: row.amount, voidedAt: row.voided_at,
    })));
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const months = useMemo(() => {
    const values = new Set(sales.map((sale) => sale.saleDate.slice(0, 7)));
    payments.forEach((payment) => values.add(payment.paymentDate.slice(0, 7)));
    refundLedger.forEach((refund) => {
      if (refund.refundDate) values.add(refund.refundDate.slice(0, 7));
    });
    values.add(currentMonth());
    return [...values].sort().reverse();
  }, [payments, refundLedger, sales]);
  const report = useMemo(() => {
    const selected = activeReportSales(sales, month);
    const money = calculateReportMoneySummary(sales, month);
    const monthRange = {
      from: `${month}-01`,
      to: `${month}-${String(new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate()).padStart(2, "0")}`,
    };
    const cash = calculateLedgerCashSummary(sales, payments, refundLedger, monthRange);
    const previousMonth = (() => {
      const date = new Date(`${month}-01T12:00:00`);
      date.setMonth(date.getMonth() - 1);
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    })();
    const previousRange = {
      from: `${previousMonth}-01`,
      to: `${previousMonth}-${String(new Date(Number(previousMonth.slice(0, 4)), Number(previousMonth.slice(5, 7)), 0).getDate()).padStart(2, "0")}`,
    };
    const previousCash = calculateLedgerCashSummary(sales, payments, refundLedger, previousRange);
    const [year, monthNumber] = month.split("-").map(Number);
    const targetRows = targets.filter((target) => target.year === year && target.month === monthNumber);
    const overall = targetRows.find((target) => target.businessUnitId === null)?.targetAmount;
    const target = overall ?? targetRows.filter((target) => target.businessUnitId !== null).reduce((total, row) => total + safe(row.targetAmount), 0);
    const unitRows = units.map((unit) => {
      const unitSales = selected.filter((sale) => sale.businessUnitId === unit.id);
      const unitCash = calculateLedgerCashSummary(
        sales,
        payments,
        refundLedger,
        monthRange,
        unit.id,
      );
      return {
        name: unit.name,
        salesAmount: unitSales.reduce(
          (total, sale) => total + finalSaleAmount(sale),
          0,
        ),
        paidAmount: unitCash.paidAmount,
        refundAmount: unitCash.refundAmount,
        value: unitSales.reduce(
          (total, sale) => total + finalSaleAmount(sale),
          0,
        ),
      };
    });
    const saleDaily = calculateReportDaily(sales, month);
    const cashDaily = calculateLedgerDaily(sales, payments, refundLedger, monthRange);
    const cashDailyByDate = new Map(cashDaily.map((day) => [day.date, day.paidAmount]));
    const daily = saleDaily.map((day) => ({ ...day, value: cashDailyByDate.get(day.key) ?? 0 }));
    const productNames = new Map(products.map((product) => [product.id, product.name]));
    const productMap = new Map<string, { name: string; value: number; count: number }>();
    selected.forEach((sale) => { const current = productMap.get(sale.productId) ?? { name: sale.productName || productNames.get(sale.productId) || "알 수 없음", value: 0, count: 0 }; current.value += finalSaleAmount(sale); current.count += 1; productMap.set(sale.productId, current); });
    const profileNames = new Map(profiles.map((profile) => [profile.id, profile.name]));
    const staffMap = new Map<string, { name: string; value: number; count: number }>();
    selected.forEach((sale) => { const key = sale.staffId ?? sale.staffName ?? "unknown"; const current = staffMap.get(key) ?? { name: sale.staffName || (sale.staffId ? profileNames.get(sale.staffId) : undefined) || "담당자 미지정", value: 0, count: 0 }; current.value += finalSaleAmount(sale); current.count += 1; staffMap.set(key, current); });
    const salesById = new Map(sales.map((sale) => [sale.id, sale]));
    const eventRows = history.filter((event) => event.createdAt.slice(0, 7) === month).map((event) => ({ ...event, sale: salesById.get(event.saleId), actor: profileNames.get(event.changedBy) || "-" }));
    const trend = calculateReportTrend(sales, month).map((row) => {
      const year = Number(row.key.slice(0, 4));
      const monthNumber = Number(row.key.slice(5, 7));
      const range = {
        from: `${row.key}-01`,
        to: `${row.key}-${String(new Date(year, monthNumber, 0).getDate()).padStart(2, "0")}`,
      };
      return {
        ...row,
        value: calculateLedgerCashSummary(sales, payments, refundLedger, range).paidAmount,
      };
    });
    const cashDifference = cash.paidAmount - previousCash.paidAmount;
    const currentOutstanding = sales
      .filter((sale) => sale.status !== "cancelled" && sale.outstandingAmount > 0)
      .reduce((total, sale) => total + sale.outstandingAmount, 0);
    const paymentMethods = [...calculateLedgerPaymentMethodTotals(
      sales,
      payments,
      monthRange,
    ).entries()]
      .map(([method, value]) => ({
        method,
        name: paymentMethodName(method),
        value,
      }))
      .sort((left, right) => right.value - left.value);
    return {
      total: money.salesAmount, paid: cash.paidAmount, real: cash.paidAmount, refund: cash.refundAmount, outstanding: currentOutstanding,
      divisions: unitRows, daily, products: [...productMap.values()].sort((a, b) => b.value - a.value).slice(0, 10),
      staff: [...staffMap.values()].sort((a, b) => b.value - a.value),
      paymentMethods,
      refunds: eventRows.filter((event) => event.action === "partial_refund" || event.action === "full_refund").slice(0, 5),
      cancellations: eventRows.filter((event) => event.action === "cancelled").slice(0, 5),
      target, achievement: target > 0 ? (cash.paidAmount / target) * 100 : 0,
      diff: cashDifference,
      rate: previousCash.paidAmount > 0 ? (cashDifference / previousCash.paidAmount) * 100 : null,
      trend,
    };
  }, [history, month, payments, products, profiles, refundLedger, sales, targets, units]);

  if (loading) return <ReportsSkeleton />;
  if (error) return <ErrorState title="월별 보고서 데이터를 불러오지 못했습니다." retry={() => void load()} />;
  return <>
    <PageHeader title="월별 보고서" description="판매금액은 매출일, 실수납액은 결제일 기준으로 분석합니다." action={<label className="block w-48"><span className="mb-1 block text-xs font-medium text-slate-600">조회 월</span><Select aria-label="보고서 조회 월" value={month} onChange={(event) => setMonth(event.target.value)}>{months.map((value) => <option key={value} value={value}>{monthLabel(value)}</option>)}</Select></label>} />
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label="판매금액" value={won(report.total)} detail="매출일 기준 · 기준금액 + 추가금 - 할인" /><Metric label="실수납액" value={won(report.real)} detail="결제일 기준 유효 결제원장 합계" /><Metric label="환불" value={won(report.refund)} detail="환불 처리일 기준 유효 환불" /><Metric label="현재 미수금" value={won(report.outstanding)} detail="조회 월과 관계없는 현재 미수잔액" /></div>
    <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{report.divisions.map((row) => <Metric key={row.name} label={`${row.name} 판매금액`} value={won(row.value)} detail={`실수납 ${won(row.paidAmount)} · 환불 ${won(row.refundAmount)}`} />)}</div>
    <Card className="mt-4 p-5"><h2 className="font-bold">결제수단별 수납</h2><p className="mt-1 text-xs text-slate-500">결제일 기준 유효 결제원장 합계</p>{report.paymentMethods.length ? <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{report.paymentMethods.map((row) => <div key={row.method} className="rounded-xl border border-border bg-surface-secondary p-4"><span className="text-xs text-text-muted">{row.name}</span><strong className="mt-1 block text-lg text-text-primary tabular-nums">{won(row.value)}</strong></div>)}</div> : <EmptyState title="선택 월의 수납 내역이 없습니다." />}</Card>
    <div className="mt-4 grid gap-4 lg:grid-cols-2"><Chart title="일별 실수납"><ResponsiveContainer width="100%" height={280}><BarChart data={report.daily}><CartesianGrid vertical={false} strokeDasharray="3 3" /><XAxis dataKey="day" interval="preserveStartEnd" tick={{ fontSize: 11 }} /><YAxis tickFormatter={shortWon} width={55} /><Tooltip formatter={(value) => [won(Number(value)), "실수납"]} /><Bar dataKey="value" fill="#274c77" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></Chart><Chart title="최근 12개월 실수납 추이"><ResponsiveContainer width="100%" height={280}><LineChart data={report.trend}><CartesianGrid vertical={false} strokeDasharray="3 3" /><XAxis dataKey="month" tick={{ fontSize: 11 }} /><YAxis tickFormatter={shortWon} width={55} /><Tooltip formatter={(value) => [won(Number(value)), "실수납"]} /><Line type="monotone" dataKey="value" stroke="#274c77" strokeWidth={2} dot={{ r: 3 }} /></LineChart></ResponsiveContainer></Chart></div>
    <div className="mt-4 grid gap-4 lg:grid-cols-2"><Rank title="상품별 매출 TOP10" rows={report.products} empty="선택 월의 상품 매출이 없습니다." /><Rank title="직원별 매출" rows={report.staff} empty="선택 월의 직원별 매출이 없습니다." /></div>
    <div className="mt-4 grid gap-4 lg:grid-cols-2"><Summary target={report.target} real={report.real} achievement={report.achievement} diff={report.diff} rate={report.rate} /><Card className="p-5"><h2 className="font-bold">목표 달성률</h2><p className="mt-3 text-3xl font-bold">{report.achievement.toFixed(1)}%</p><div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-label="목표 달성률" aria-valuenow={Math.min(100, report.achievement)} aria-valuemin={0} aria-valuemax={100}><div className="h-full rounded-full bg-[#274c77]" style={{ width: `${Math.min(100, Math.max(0, report.achievement))}%` }} /></div><p className="mt-2 text-sm text-slate-500">{won(report.real)} / {won(report.target)}</p></Card></div>
    <div className="mt-4 grid gap-4 lg:grid-cols-2"><EventList title="최근 환불 내역" rows={report.refunds} /><EventList title="최근 취소 내역" rows={report.cancellations} /></div>
  </>;
}

function Metric({ label, value, detail }: { label: string; value: string; detail?: string }) { return <Card className="p-5"><p className="text-sm font-medium text-slate-500">{label}</p><p className="mt-2 text-2xl font-bold">{value}</p>{detail && <p className="mt-2 text-xs text-slate-500">{detail}</p>}</Card>; }
function paymentMethodName(method: string) { return ({ card: "카드", transfer: "계좌이체", cash: "현금", other: "기타" } as Record<string, string>)[method] || method; }
function Chart({ title, children }: { title: string; children: React.ReactNode }) { return <Card className="p-5"><h2 className="mb-4 font-bold">{title}</h2><div className="min-w-0">{children}</div></Card>; }
function Rank({ title, rows, empty }: { title: string; rows: { name: string; value: number; count: number }[]; empty: string }) { return <Card className="overflow-hidden"><h2 className="border-b px-5 py-4 font-bold">{title}</h2>{rows.length ? <div className="divide-y">{rows.map((row, index) => <div key={`${row.name}-${index}`} className="flex items-center gap-3 px-5 py-3 text-sm"><span className="flex h-7 w-7 items-center justify-center rounded bg-slate-100 text-xs font-bold">{index + 1}</span><span className="min-w-0 flex-1 truncate font-medium">{row.name}</span><span className="text-xs text-slate-500">{row.count}건</span><b>{won(row.value)}</b></div>)}</div> : <EmptyState title={empty} />}</Card>; }
function Summary({ target, real, achievement, diff, rate }: { target: number; real: number; achievement: number; diff: number; rate: number | null }) { return <Card className="p-5"><h2 className="font-bold">성과 요약</h2><dl className="mt-4 space-y-4 text-sm"><div className="flex justify-between gap-4"><dt className="text-slate-500">전월 실수납 대비</dt><dd className="text-right font-bold">{diff >= 0 ? "+" : ""}{won(diff)}<span className="ml-1 text-xs font-normal text-slate-500">{rate === null ? "(전월 수납 없음)" : `(${rate >= 0 ? "+" : ""}${rate.toFixed(1)}%)`}</span></dd></div><div className="flex justify-between"><dt className="text-slate-500">목표 매출</dt><dd className="font-bold">{won(target)}</dd></div><div className="flex justify-between"><dt className="text-slate-500">실수납액</dt><dd className="font-bold">{won(real)}</dd></div><div className="flex justify-between"><dt className="text-slate-500">목표 달성률</dt><dd className="font-bold">{achievement.toFixed(1)}%</dd></div></dl></Card>; }
function refundValue(value: unknown) { if (!value || typeof value !== "object" || !("refund_amount" in value)) return 0; const amount = (value as { refund_amount?: unknown }).refund_amount; return typeof amount === "number" ? amount : 0; }
function EventList({ title, rows }: { title: string; rows: Array<HistoryEvent & { sale: ReportSale | undefined; actor: string }> }) { return <Card className="overflow-hidden"><h2 className="border-b px-5 py-4 font-bold">{title}</h2>{rows.length ? <div className="divide-y">{rows.map((row) => { const refundDelta = Math.max(0, refundValue(row.changedData) - refundValue(row.previousData)); return <div key={row.id} className="p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2"><StatusBadge status={row.action as "partial_refund" | "full_refund" | "cancelled"} /><strong className="text-sm">{row.sale?.productName || "상품 정보 없음"}</strong></div><span className="text-xs text-slate-500">{new Date(row.createdAt).toLocaleString("ko-KR")}</span></div><p className="mt-2 text-sm text-slate-600">{row.sale?.businessUnitName || "-"} · 처리자 {row.actor}{row.action !== "cancelled" ? ` · 환불 ${won(refundDelta)}` : ""}</p></div>; })}</div> : <EmptyState title="표시할 내역이 없습니다." />}</Card>; }
function ReportsSkeleton() { return <div aria-busy="true" aria-label="월별 보고서 로딩 중"><Skeleton className="mb-6 h-16" /><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-32" />)}</div><div className="mt-4 grid gap-4 lg:grid-cols-2"><Skeleton className="h-80" /><Skeleton className="h-80" /></div></div>; }
