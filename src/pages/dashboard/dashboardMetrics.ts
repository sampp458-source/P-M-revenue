export interface DashboardSale {
  id: string;
  saleDate: string;
  businessUnitId: string;
  businessUnitName: string;
  productId: string;
  productName: string;
  dogId: string | null;
  dogName: string;
  customerId: string | null;
  customerName: string | null;
  createdBy: string;
  staffName: string | null;
  paidAmount: number;
  refundAmount: number;
  outstandingAmount: number;
  netAmount: number;
  paymentMethod: string;
  status: string;
  createdAt: string;
}

export interface DashboardTarget {
  year: number;
  month: number;
  businessUnitId: string | null;
  targetAmount: number;
}

export type BusinessUnitCode = "daycare" | "training" | "hotel";
export interface BusinessUnitOption { id: string; name: string; code?: BusinessUnitCode | string }

export type DashboardPeriod = "today" | "yesterday" | "this_week" | "last_week" | "this_month" | "last_month" | "custom";
export interface DashboardDateRange { from: string; to: string }

const safe = (value: number | null | undefined) => Number.isFinite(value) ? Number(value) : 0;
const sum = (rows: DashboardSale[], key: "paidAmount" | "refundAmount" | "outstandingAmount" | "netAmount") =>
  rows.reduce((total, row) => total + safe(row[key]), 0);

const previousMonthOf = (month: string) => {
  const date = new Date(`${month}-01T00:00:00`);
  date.setMonth(date.getMonth() - 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const dateFromKey = (value: string) => new Date(`${value}T12:00:00`);
const dateKey = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
const moveDate = (value: string, days: number) => dateKey(new Date(dateFromKey(value).getTime() + days * DAY_MS));

export const koreanToday = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });

export function dashboardPeriodRange(period: DashboardPeriod, today = koreanToday(), customFrom = "", customTo = ""): DashboardDateRange {
  const base = dateFromKey(today);
  if (period === "today") return { from: today, to: today };
  if (period === "yesterday") { const day = moveDate(today, -1); return { from: day, to: day }; }
  const weekStart = new Date(base.getTime() + (base.getDay() === 0 ? -6 : 1 - base.getDay()) * DAY_MS);
  if (period === "this_week") return { from: dateKey(weekStart), to: dateKey(new Date(weekStart.getTime() + 6 * DAY_MS)) };
  if (period === "last_week") return { from: dateKey(new Date(weekStart.getTime() - 7 * DAY_MS)), to: dateKey(new Date(weekStart.getTime() - DAY_MS)) };
  if (period === "this_month") return { from: dateKey(new Date(base.getFullYear(), base.getMonth(), 1, 12)), to: dateKey(new Date(base.getFullYear(), base.getMonth() + 1, 0, 12)) };
  if (period === "last_month") return { from: dateKey(new Date(base.getFullYear(), base.getMonth() - 1, 1, 12)), to: dateKey(new Date(base.getFullYear(), base.getMonth(), 0, 12)) };
  const from = /^\d{4}-\d{2}-\d{2}$/.test(customFrom) ? customFrom : today;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(customTo) ? customTo : from;
  return from <= to ? { from, to } : { from: to, to: from };
}

export function previousDashboardRange(range: DashboardDateRange): DashboardDateRange {
  const length = Math.round((dateFromKey(range.to).getTime() - dateFromKey(range.from).getTime()) / DAY_MS) + 1;
  return { from: moveDate(range.from, -length), to: moveDate(range.from, -1) };
}

export function dashboardComparisonRange(period: DashboardPeriod, range: DashboardDateRange): DashboardDateRange {
  if (period !== "this_month" && period !== "last_month") return previousDashboardRange(range);
  const start = dateFromKey(range.from);
  return {
    from: dateKey(new Date(start.getFullYear(), start.getMonth() - 1, 1, 12)),
    to: dateKey(new Date(start.getFullYear(), start.getMonth(), 0, 12)),
  };
}

const inRange = (value: string, range: DashboardDateRange) => value >= range.from && value <= range.to;

export const businessUnitOrder = (unit: BusinessUnitOption) => {
  if (unit.code === "daycare") return 0;
  if (unit.code === "training") return 1;
  if (unit.code === "hotel") return 2;
  return 99;
};

export function calculateRangeOverview(sales: DashboardSale[], units: BusinessUnitOption[], range: DashboardDateRange, comparisonRange = previousDashboardRange(range)) {
  const previousRange = comparisonRange;
  const selected = sales.filter((sale) => sale.status !== "cancelled" && inRange(sale.saleDate, range));
  const previous = sales.filter((sale) => sale.status !== "cancelled" && inRange(sale.saleDate, previousRange));
  const orderedUnits = [...units].sort((left, right) => businessUnitOrder(left) - businessUnitOrder(right));
  const divisions = orderedUnits.map((unit) => {
    const rows = selected.filter((sale) => sale.businessUnitId === unit.id);
    const previousRows = previous.filter((sale) => sale.businessUnitId === unit.id);
    const revenue = sum(rows, "paidAmount");
    const previousRevenue = sum(previousRows, "paidAmount");
    return { ...unit, revenue, count: rows.length, average: rows.length ? revenue / rows.length : 0, previousRevenue, rate: previousRevenue > 0 ? ((revenue - previousRevenue) / previousRevenue) * 100 : null };
  });
  const total = sum(selected, "paidAmount");
  return {
    range,
    previousRange,
    divisions,
    total,
    count: selected.length,
    average: selected.length ? total / selected.length : 0,
    net: sum(selected, "netAmount"),
    refund: sum(selected, "refundAmount"),
    outstanding: sum(selected, "outstandingAmount"),
  };
}

export interface DailyRevenue { date: string; revenue: number; net: number; count: number; refund: number; outstanding: number }

export function calculateDailyRevenue(sales: DashboardSale[], range: DashboardDateRange, unitId = "") {
  const rows = sales.filter((sale) => sale.status !== "cancelled" && inRange(sale.saleDate, range) && (!unitId || sale.businessUnitId === unitId));
  const byDate = new Map<string, DashboardSale[]>();
  rows.forEach((sale) => byDate.set(sale.saleDate, [...(byDate.get(sale.saleDate) ?? []), sale]));
  const result: DailyRevenue[] = [];
  for (let cursor = range.from; cursor <= range.to; cursor = moveDate(cursor, 1)) {
    const dayRows = byDate.get(cursor) ?? [];
    result.push({ date: cursor, revenue: sum(dayRows, "paidAmount"), net: sum(dayRows, "netAmount"), count: dayRows.length, refund: sum(dayRows, "refundAmount"), outstanding: sum(dayRows, "outstandingAmount") });
  }
  return result;
}

export function calculateDateDetail(sales: DashboardSale[], units: BusinessUnitOption[], date: string) {
  const rows = sales.filter((sale) => sale.status !== "cancelled" && sale.saleDate === date);
  const divisions = [...units].sort((left, right) => businessUnitOrder(left) - businessUnitOrder(right)).map((unit) => {
    const unitRows = rows.filter((sale) => sale.businessUnitId === unit.id);
    const revenue = sum(unitRows, "paidAmount");
    return { ...unit, revenue, count: unitRows.length, average: unitRows.length ? revenue / unitRows.length : 0 };
  });
  const productMap = new Map<string, { name: string; revenue: number }>();
  const paymentMap = new Map<string, number>();
  rows.forEach((sale) => {
    const product = productMap.get(sale.productId) ?? { name: sale.productName, revenue: 0 };
    product.revenue += sale.paidAmount;
    productMap.set(sale.productId, product);
    paymentMap.set(sale.paymentMethod, (paymentMap.get(sale.paymentMethod) ?? 0) + sale.paidAmount);
  });
  return { divisions, total: sum(rows, "paidAmount"), count: rows.length, outstanding: sum(rows, "outstandingAmount"), refund: sum(rows, "refundAmount"), products: [...productMap.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 3), payments: [...paymentMap.entries()].map(([method, amount]) => ({ method, amount })).sort((a, b) => b.amount - a.amount) };
}

export function calculateTarget(month: string, unitId: string, targets: DashboardTarget[]) {
  const [year, monthNumber] = month.split("-").map(Number);
  const rows = targets.filter((target) => target.year === year && target.month === monthNumber);
  const overall = rows.find((target) => target.businessUnitId === null)?.targetAmount;

  // 운영 기준: 전체 목표를 우선하고, 없을 때 전체 선택은 사업부 목표 합계,
  // 특정 사업부 선택은 해당 사업부 목표를 사용한다.
  if (overall !== undefined) return safe(overall);
  if (unitId) return safe(rows.find((target) => target.businessUnitId === unitId)?.targetAmount);
  return rows.filter((target) => target.businessUnitId !== null).reduce((total, target) => total + safe(target.targetAmount), 0);
}

export function calculateDashboard(
  sales: DashboardSale[], targets: DashboardTarget[], units: BusinessUnitOption[], month: string, unitId: string,
) {
  const byUnit = (sale: DashboardSale) => !unitId || sale.businessUnitId === unitId;
  const active = sales.filter((sale) => sale.status !== "cancelled" && byUnit(sale));
  const selected = active.filter((sale) => sale.saleDate.startsWith(month));
  const previous = active.filter((sale) => sale.saleDate.startsWith(previousMonthOf(month)));
  const allSelected = sales.filter((sale) => sale.saleDate.startsWith(month) && byUnit(sale));
  const real = sum(selected, "netAmount");
  const previousReal = sum(previous, "netAmount");
  const diff = real - previousReal;
  const target = calculateTarget(month, unitId, targets);
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
  const todayRows = selected.filter((sale) => sale.saleDate === today);
  const todayRegistered = allSelected.filter((sale) => new Date(sale.createdAt).toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" }) === today);
  const outstandingRows = selected.filter((sale) => sale.outstandingAmount > 0);
  const refundRows = selected.filter((sale) => sale.refundAmount > 0);
  const cancelledRows = allSelected.filter((sale) => sale.status === "cancelled");

  return {
    total: sum(selected, "paidAmount"),
    real,
    refund: sum(selected, "refundAmount"),
    outstanding: sum(selected, "outstandingAmount"),
    diff,
    rate: previousReal > 0 ? (diff / previousReal) * 100 : null,
    target,
    achievement: target > 0 ? (real / target) * 100 : 0,
    todayNet: sum(todayRows, "netAmount"),
    todayCount: todayRegistered.length,
    divisions: units.map((unit) => ({ id: unit.id, name: unit.name, value: sum(selected.filter((sale) => sale.businessUnitId === unit.id), "netAmount") })),
    recent: [...allSelected].sort((a, b) => b.saleDate.localeCompare(a.saleDate) || b.createdAt.localeCompare(a.createdAt)).slice(0, 5),
    alerts: {
      outstandingCount: outstandingRows.length,
      outstandingTotal: sum(outstandingRows, "outstandingAmount"),
      refundCount: refundRows.length,
      refundTotal: sum(refundRows, "refundAmount"),
      cancelledCount: cancelledRows.length,
      todayCount: todayRegistered.length,
    },
  };
}

export function countDashboardSalesByUnit(
  sales: DashboardSale[],
  month: string,
  unitId: string,
) {
  const counts = new Map<string, number>();
  sales.forEach((sale) => {
    if (
      sale.status === "cancelled" ||
      !sale.saleDate.startsWith(month) ||
      (unitId && sale.businessUnitId !== unitId)
    )
      return;
    counts.set(sale.businessUnitId, (counts.get(sale.businessUnitId) ?? 0) + 1);
  });
  return counts;
}

export function calculateTrend(sales: DashboardSale[], unitId: string) {
  const result: { key: string; month: string; amount: number }[] = [];
  const base = new Date(`${new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" }).slice(0, 7)}-01T00:00:00`);
  for (let offset = 11; offset >= 0; offset -= 1) {
    const date = new Date(base);
    date.setMonth(date.getMonth() - offset);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const rows = sales.filter((sale) => sale.status !== "cancelled" && sale.saleDate.startsWith(key) && (!unitId || sale.businessUnitId === unitId));
    result.push({ key, month: `${date.getMonth() + 1}월`, amount: sum(rows, "netAmount") });
  }
  return result;
}
