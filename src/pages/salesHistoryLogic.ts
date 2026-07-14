export type SaleStatus = "normal" | "partial_refund" | "full_refund" | "cancelled";
export type StatusFilter = "" | SaleStatus | "outstanding";
export type PeriodFilter = "today" | "week" | "month" | "last_month" | "custom";

export interface SalesHistoryRecord {
  id: string;
  saleDate: string;
  businessUnitId: string;
  dogId: string | null;
  customerId: string | null;
  productCategoryId: string | null;
  productId: string;
  dogName: string;
  customerName: string | null;
  customerPhone: string | null;
  categoryName: string;
  productName: string;
  paidAmount: number;
  refundAmount: number;
  outstandingAmount: number;
  netAmount: number;
  paymentMethod: string;
  paymentMethods?: string[];
  status: SaleStatus;
  staffId: string | null;
  staffName: string | null;
  createdBy: string;
  registrarName: string | null;
  createdAt: string;
  cancelledAt: string | null;
}

export interface SalesHistoryFilters {
  query: string;
  period: PeriodFilter;
  startDate: string;
  endDate: string;
  unitId: string;
  status: StatusFilter;
  staffId: string;
  createdBy: string;
  paymentMethod: string;
  categoryId: string;
  productId: string;
  minAmount: number | null;
  maxAmount: number | null;
}

export interface DuplicateWarning {
  level: "strong" | "weak";
  relatedSaleId: string;
  description: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export const normalizePhone = (value: string | null | undefined) =>
  (value ?? "").replace(/\D/g, "");

export const koreanDate = (value: string | Date) =>
  new Date(value).toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });

function dateFromKey(value: string) {
  return new Date(`${value}T12:00:00`);
}

function dateKey(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function shiftDateKey(value: string, days: number) {
  const date = dateFromKey(value);
  date.setDate(date.getDate() + days);
  return dateKey(date);
}

export function businessUnitDisplayOrder(name: string) {
  const normalized = name.trim().toLocaleLowerCase("ko");
  if (normalized.includes("유치원") || normalized.includes("daycare")) return 0;
  if (
    normalized.includes("교육") ||
    normalized.includes("training") ||
    normalized.includes("center")
  )
    return 1;
  if (normalized.includes("호텔") || normalized.includes("hotel")) return 2;
  return 99;
}

export function periodRange(period: PeriodFilter, today: string, startDate = "", endDate = "") {
  const base = dateFromKey(today);
  if (period === "today") return { start: today, end: today };
  if (period === "week") {
    const day = base.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const start = new Date(base.getTime() + mondayOffset * DAY_MS);
    const end = new Date(start.getTime() + 6 * DAY_MS);
    return { start: dateKey(start), end: dateKey(end) };
  }
  if (period === "month") {
    const start = new Date(base.getFullYear(), base.getMonth(), 1, 12);
    const end = new Date(base.getFullYear(), base.getMonth() + 1, 0, 12);
    return { start: dateKey(start), end: dateKey(end) };
  }
  if (period === "last_month") {
    const start = new Date(base.getFullYear(), base.getMonth() - 1, 1, 12);
    const end = new Date(base.getFullYear(), base.getMonth(), 0, 12);
    return { start: dateKey(start), end: dateKey(end) };
  }
  return { start: startDate, end: endDate };
}

export function hasOutstanding(sale: Pick<SalesHistoryRecord, "status" | "outstandingAmount">) {
  return sale.status === "normal" && sale.outstandingAmount > 0;
}

function matchesQuery(sale: SalesHistoryRecord, query: string) {
  const keyword = query.trim().toLocaleLowerCase("ko");
  if (!keyword) return true;
  const textMatch = [
    sale.dogName,
    sale.customerName,
    sale.productName,
    sale.categoryName,
    sale.staffName,
    sale.registrarName,
  ].some((value) => value?.toLocaleLowerCase("ko").includes(keyword));
  const phoneKeyword = normalizePhone(query);
  return textMatch || Boolean(phoneKeyword && normalizePhone(sale.customerPhone).includes(phoneKeyword));
}

export function filterSales<T extends SalesHistoryRecord>(sales: T[], filters: SalesHistoryFilters, today: string): T[] {
  const range = periodRange(filters.period, today, filters.startDate, filters.endDate);
  return sales.filter((sale) => {
    const statusMatch = !filters.status
      || (filters.status === "outstanding" ? hasOutstanding(sale) : sale.status === filters.status);
    return matchesQuery(sale, filters.query)
      && (!range.start || sale.saleDate >= range.start)
      && (!range.end || sale.saleDate <= range.end)
      && (!filters.unitId || sale.businessUnitId === filters.unitId)
      && statusMatch
      && (!filters.staffId || sale.staffId === filters.staffId)
      && (!filters.createdBy || sale.createdBy === filters.createdBy)
      && (!filters.paymentMethod || (sale.paymentMethods ?? [sale.paymentMethod]).includes(filters.paymentMethod))
      && (!filters.categoryId || sale.productCategoryId === filters.categoryId)
      && (!filters.productId || sale.productId === filters.productId)
      && (filters.minAmount === null || sale.paidAmount >= filters.minAmount)
      && (filters.maxAmount === null || sale.paidAmount <= filters.maxAmount);
  });
}

export function calculateTodayActivity(sales: SalesHistoryRecord[], today: string) {
  const activeToday = sales.filter((sale) => sale.saleDate === today && sale.status !== "cancelled");
  const registered = sales.filter((sale) => koreanDate(sale.createdAt) === today);
  const cancelled = sales.filter((sale) => sale.cancelledAt && koreanDate(sale.cancelledAt) === today);
  return {
    registeredCount: registered.length,
    netAmount: activeToday.reduce((total, sale) => total + sale.netAmount, 0),
    refundAmount: activeToday.reduce((total, sale) => total + sale.refundAmount, 0),
    outstandingAmount: activeToday.reduce((total, sale) => total + sale.outstandingAmount, 0),
    cancelledCount: cancelled.length,
  };
}

export function calculateSalesSummary(sales: SalesHistoryRecord[]) {
  const active = sales.filter((sale) => sale.status !== "cancelled");
  return {
    count: active.length,
    netAmount: active.reduce((total, sale) => total + sale.netAmount, 0),
    refundAmount: active.reduce((total, sale) => total + sale.refundAmount, 0),
    outstandingAmount: active.reduce(
      (total, sale) => total + sale.outstandingAmount,
      0,
    ),
  };
}

export function refundRemainingAmount(paidAmount: number, refundAmount: number) {
  return Math.max(0, paidAmount - refundAmount);
}

export function isRefundDateAllowed(
  refundDate: string,
  saleDate: string,
  today: string,
) {
  return Boolean(
    refundDate && refundDate >= saleDate && refundDate <= today,
  );
}

export function todayRegisteredSales<T extends SalesHistoryRecord>(sales: T[], today: string, currentUserId: string | null): T[] {
  return sales
    .filter((sale) => koreanDate(sale.createdAt) === today)
    .sort((left, right) => {
      const leftMine = left.createdBy === currentUserId ? 1 : 0;
      const rightMine = right.createdBy === currentUserId ? 1 : 0;
      return rightMine - leftMine || right.createdAt.localeCompare(left.createdAt);
    });
}

function sameParty(left: SalesHistoryRecord, right: SalesHistoryRecord) {
  return Boolean(
    (left.dogId && right.dogId && left.dogId === right.dogId)
    || (left.customerId && right.customerId && left.customerId === right.customerId),
  );
}

export function findDuplicateWarnings(sales: SalesHistoryRecord[]) {
  const warnings = new Map<string, DuplicateWarning>();
  const active = sales
    .filter((sale) => sale.status !== "cancelled")
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));

  for (let index = 0; index < active.length; index += 1) {
    const current = active[index];
    for (let previousIndex = index - 1; previousIndex >= 0; previousIndex -= 1) {
      const previous = active[previousIndex];
      if (!sameParty(current, previous) || current.productId !== previous.productId) continue;
      const timeDifference = Math.abs(new Date(current.createdAt).getTime() - new Date(previous.createdAt).getTime());
      const strong = timeDifference <= 5 * 60 * 1000
        && current.businessUnitId === previous.businessUnitId
        && current.paidAmount === previous.paidAmount;
      if (strong) {
        warnings.set(current.id, {
          level: "strong",
          relatedSaleId: previous.id,
          description: "같은 고객 또는 반려견·사업부·상품·결제금액이 5분 이내에 등록되었습니다.",
        });
        break;
      }
      if (current.saleDate === previous.saleDate && !warnings.has(current.id)) {
        warnings.set(current.id, {
          level: "weak",
          relatedSaleId: previous.id,
          description: "같은 날짜에 같은 고객 또는 반려견과 상품이 등록되었습니다.",
        });
      }
    }
  }
  return warnings;
}
