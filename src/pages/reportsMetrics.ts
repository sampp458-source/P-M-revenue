export interface ReportMetricSale {
  id: string;
  saleDate: string;
  businessUnitId: string;
  productId: string;
  staffId: string | null;
  staffName: string | null;
  originalAmount: number;
  additionalAmount: number;
  discountAmount: number;
  paidAmount: number;
  refundAmount: number;
  outstandingAmount: number;
  netAmount: number;
  status: string;
}

const safe = (value: number | null | undefined) =>
  Number.isFinite(value) ? Number(value) : 0;

const sum = (
  rows: ReportMetricSale[],
  key: "paidAmount" | "refundAmount" | "outstandingAmount" | "netAmount",
) => rows.reduce((total, row) => total + safe(row[key]), 0);

export const reportFinalSaleAmount = (
  sale: Pick<
    ReportMetricSale,
    "originalAmount" | "additionalAmount" | "discountAmount"
  >,
) =>
  Math.max(
    0,
    safe(sale.originalAmount) +
      safe(sale.additionalAmount) -
      safe(sale.discountAmount),
  );

const sumFinalSaleAmount = (rows: ReportMetricSale[]) =>
  rows.reduce((total, row) => total + reportFinalSaleAmount(row), 0);

export const previousReportMonth = (month: string) => {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(year, monthNumber - 2, 1, 12);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
};

export const daysInReportMonth = (month: string) => {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(year, monthNumber, 0, 12).getDate();
};

export function activeReportSales<T extends ReportMetricSale>(
  sales: T[],
  month: string,
) {
  return sales.filter(
    (sale) =>
      sale.status !== "cancelled" && sale.saleDate.startsWith(month),
  );
}

export function calculateReportMoneySummary(
  sales: ReportMetricSale[],
  month: string,
) {
  const selected = activeReportSales(sales, month);
  const previous = activeReportSales(sales, previousReportMonth(month));
  const netAmount = sum(selected, "netAmount");
  const previousNetAmount = sum(previous, "netAmount");
  const difference = netAmount - previousNetAmount;

  return {
    salesAmount: sumFinalSaleAmount(selected),
    paidAmount: sum(selected, "paidAmount"),
    netAmount,
    refundAmount: sum(selected, "refundAmount"),
    outstandingAmount: sum(selected, "outstandingAmount"),
    previousNetAmount,
    difference,
    rate:
      previousNetAmount > 0
        ? (difference / previousNetAmount) * 100
        : null,
  };
}

export function calculateReportDaily(
  sales: ReportMetricSale[],
  month: string,
) {
  const selected = activeReportSales(sales, month);
  return Array.from({ length: daysInReportMonth(month) }, (_, index) => {
    const day = index + 1;
    const key = `${month}-${String(day).padStart(2, "0")}`;
    return {
      key,
      day: `${day}일`,
      value: sum(
        selected.filter((sale) => sale.saleDate === key),
        "netAmount",
      ),
    };
  });
}

export function reportTrendMonths(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  return Array.from({ length: 12 }, (_, index) => {
    const offset = index - 11;
    const date = new Date(year, monthNumber - 1 + offset, 1, 12);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  });
}

export function calculateReportTrend(
  sales: ReportMetricSale[],
  month: string,
) {
  return reportTrendMonths(month).map((key) => ({
    key,
    month: key.slice(2).replace("-", "."),
    value: sum(activeReportSales(sales, key), "netAmount"),
  }));
}

export function calculateReportUnitTotals(
  sales: ReportMetricSale[],
  month: string,
  unitIds: string[],
) {
  const selected = activeReportSales(sales, month);
  return new Map(
    unitIds.map((unitId) => [
      unitId,
      sum(
        selected.filter((sale) => sale.businessUnitId === unitId),
        "netAmount",
      ),
    ]),
  );
}
