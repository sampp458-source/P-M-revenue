import { AlertCircle, ArrowRight, ReceiptText } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button, Card, EmptyState, Select, Skeleton, StatusBadge, Table } from "../../components/ui";
import { monthLabel, shortWon, won } from "../../lib/format";
import type { BusinessUnitOption, DashboardSale } from "./dashboardMetrics";

export function DashboardFilters({ month, unitId, months, units, onMonth, onUnit }: { month: string; unitId: string; months: string[]; units: BusinessUnitOption[]; onMonth: (value: string) => void; onUnit: (value: string) => void }) {
  return <Card className="mb-5 p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-end"><label className="block flex-1"><span className="mb-1.5 block text-sm font-medium text-slate-700">조회 월</span><Select aria-label="대시보드 조회 월" value={month} onChange={(event) => onMonth(event.target.value)}>{months.map((value) => <option key={value} value={value}>{monthLabel(value)}</option>)}</Select></label><label className="block flex-1"><span className="mb-1.5 block text-sm font-medium text-slate-700">사업부</span><Select aria-label="대시보드 사업부" value={unitId} onChange={(event) => onUnit(event.target.value)}><option value="">전체 사업부</option>{units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</Select></label><div className="rounded-lg bg-slate-50 px-4 py-2.5 text-sm text-slate-600 sm:min-w-40"><span className="block text-xs">현재 조회</span><strong className="text-slate-900">{monthLabel(month)}</strong></div></div></Card>;
}

export function MetricCard({ label, value, description, progress }: { label: string; value: string; description?: string; progress?: number }) {
  return <Card className="min-h-36 p-5"><p className="text-sm font-semibold text-slate-600">{label}</p><p className="mt-3 text-2xl font-bold tracking-tight text-slate-950">{value}</p>{progress !== undefined && <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-label={`${label} 진행률`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.max(0, progress))}><div className="h-full rounded-full bg-[#274c77]" style={{ width: `${Math.min(100, Math.max(0, progress))}%` }} /></div>}{description && <p className="mt-2 text-xs leading-5 text-slate-500">{description}</p>}</Card>;
}

export function RecentSales({ rows, onOpen }: { rows: DashboardSale[]; onOpen: () => void }) {
  return <Card className="overflow-hidden"><div className="flex items-center justify-between border-b p-4"><div><h2 className="font-semibold text-slate-900">최근 매출</h2><p className="mt-1 text-xs text-slate-500">선택 조건의 최신 등록 5건</p></div><Button aria-label="매출 내역으로 이동" variant="ghost" onClick={onOpen}>전체 보기 <ArrowRight size={16} /></Button></div>{rows.length ? <Table className="min-w-[1000px]"><thead><tr><th>매출일</th><th>사업부</th><th>반려견</th><th>보호자</th><th>상품</th><th>결제액</th><th>실매출</th><th>상태</th><th>담당자</th></tr></thead><tbody>{rows.map((sale) => <tr key={sale.id} tabIndex={0} role="link" className="cursor-pointer focus:bg-blue-50 focus:outline-none" onClick={onOpen} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onOpen(); }}><td>{sale.saleDate}</td><td>{sale.businessUnitName}</td><td className="font-semibold">{sale.dogName}</td><td>{sale.customerName || "미등록"}</td><td>{sale.productName}</td><td>{won(sale.paidAmount)}</td><td className="font-semibold">{won(sale.netAmount)}</td><td><StatusBadge status={sale.status as "normal" | "partial_refund" | "full_refund" | "cancelled"} tone={sale.status === "cancelled" ? "gray" : undefined} /></td><td>{sale.staffName || "-"}</td></tr>)}</tbody></Table> : <EmptyState title="등록된 매출이 없습니다." />}</Card>;
}

export function OperationalAlerts({ alerts, onOpen }: { alerts: { outstandingCount: number; outstandingTotal: number; refundCount: number; refundTotal: number; cancelledCount: number; todayCount: number }; onOpen: () => void }) {
  const items = [
    { label: "미수금", value: `${alerts.outstandingCount}건 · ${won(alerts.outstandingTotal)}` },
    { label: "이번 달 환불", value: `${alerts.refundCount}건 · ${won(alerts.refundTotal)}` },
    { label: "이번 달 취소", value: `${alerts.cancelledCount}건` },
    { label: "오늘 등록", value: `${alerts.todayCount}건` },
  ];
  return <Card className="p-5"><div className="mb-4 flex items-center gap-2"><AlertCircle size={18} className="text-[#274c77]" /><h2 className="font-semibold">확인 필요</h2></div><div className="grid gap-2 sm:grid-cols-2">{items.map((item) => <button key={item.label} type="button" onClick={onOpen} className="rounded-lg border border-slate-200 p-3 text-left transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-700"><span className="block text-xs text-slate-500">{item.label}</span><strong className="mt-1 block text-sm text-slate-900">{item.value}</strong></button>)}</div></Card>;
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
