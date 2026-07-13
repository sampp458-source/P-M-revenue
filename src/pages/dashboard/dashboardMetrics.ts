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
  status: string;
  createdAt: string;
}

export interface DashboardTarget {
  year: number;
  month: number;
  businessUnitId: string | null;
  targetAmount: number;
}

export interface BusinessUnitOption { id: string; name: string }

const safe = (value: number | null | undefined) => Number.isFinite(value) ? Number(value) : 0;
const sum = (rows: DashboardSale[], key: "paidAmount" | "refundAmount" | "outstandingAmount" | "netAmount") =>
  rows.reduce((total, row) => total + safe(row[key]), 0);

const previousMonthOf = (month: string) => {
  const date = new Date(`${month}-01T00:00:00`);
  date.setMonth(date.getMonth() - 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
};

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
