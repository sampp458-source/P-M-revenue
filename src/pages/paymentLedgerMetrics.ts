export interface PaymentLedgerEntry {
  id: string;
  saleId: string;
  paymentDate: string;
  amount: number;
  voidedAt: string | null;
  paymentMethod?: string;
  source?: string;
  note?: string | null;
  createdBy?: string;
  createdAt?: string;
}

export interface RefundLedgerEntry {
  id: string;
  saleId: string;
  refundDate: string | null;
  amount: number;
  voidedAt: string | null;
}

export interface LedgerSaleReference {
  id: string;
  businessUnitId: string;
}

export interface LedgerDateRange {
  from: string;
  to: string;
}

export interface LedgerDailyAmount {
  date: string;
  paidAmount: number;
  refundAmount: number;
  netAmount: number;
}

const inRange = (date: string | null, range: LedgerDateRange) =>
  Boolean(date && date >= range.from && date <= range.to);

const saleIndex = (sales: LedgerSaleReference[]) =>
  new Map(sales.map((sale) => [sale.id, sale]));

const belongsToBusinessUnit = (
  salesById: Map<string, LedgerSaleReference>,
  saleId: string,
  businessUnitId: string,
) => {
  const sale = salesById.get(saleId);
  return Boolean(
    sale && (!businessUnitId || sale.businessUnitId === businessUnitId),
  );
};

export function calculateLedgerCashSummary(
  sales: LedgerSaleReference[],
  payments: PaymentLedgerEntry[],
  refunds: RefundLedgerEntry[],
  range: LedgerDateRange,
  businessUnitId = "",
) {
  const salesById = saleIndex(sales);
  const paidAmount = payments
    .filter(
      (payment) =>
        payment.voidedAt === null &&
        inRange(payment.paymentDate, range) &&
        belongsToBusinessUnit(salesById, payment.saleId, businessUnitId),
    )
    .reduce((total, payment) => total + payment.amount, 0);
  const refundAmount = refunds
    .filter(
      (refund) =>
        refund.voidedAt === null &&
        inRange(refund.refundDate, range) &&
        belongsToBusinessUnit(salesById, refund.saleId, businessUnitId),
    )
    .reduce((total, refund) => total + refund.amount, 0);

  return {
    paidAmount,
    refundAmount,
    netAmount: paidAmount - refundAmount,
  };
}

export function calculateLedgerDaily(
  sales: LedgerSaleReference[],
  payments: PaymentLedgerEntry[],
  refunds: RefundLedgerEntry[],
  range: LedgerDateRange,
  businessUnitId = "",
) {
  const result: LedgerDailyAmount[] = [];
  const cursor = new Date(`${range.from}T12:00:00`);
  const end = new Date(`${range.to}T12:00:00`);

  while (cursor <= end) {
    const date = cursor.toLocaleDateString("sv-SE");
    const summary = calculateLedgerCashSummary(
      sales,
      payments,
      refunds,
      { from: date, to: date },
      businessUnitId,
    );
    result.push({ date, ...summary });
    cursor.setDate(cursor.getDate() + 1);
  }

  return result;
}

export function mergeSaleAndCashDays<T extends { date: string }>(
  saleDays: T[],
  cashDays: LedgerDailyAmount[],
) {
  const cashByDate = new Map(cashDays.map((day) => [day.date, day]));
  return saleDays.map((day) => ({
    ...day,
    revenue: cashByDate.get(day.date)?.paidAmount ?? 0,
    net: cashByDate.get(day.date)?.netAmount ?? 0,
    refund: cashByDate.get(day.date)?.refundAmount ?? 0,
  }));
}

export function calculateLedgerPaymentMethodTotals(
  sales: LedgerSaleReference[],
  payments: PaymentLedgerEntry[],
  range: LedgerDateRange,
  businessUnitId = "",
) {
  const salesById = saleIndex(sales);
  const totals = new Map<string, number>();

  payments
    .filter(
      (payment) =>
        payment.voidedAt === null &&
        inRange(payment.paymentDate, range) &&
        belongsToBusinessUnit(salesById, payment.saleId, businessUnitId),
    )
    .forEach((payment) => {
      const method = payment.paymentMethod || "other";
      totals.set(method, (totals.get(method) ?? 0) + payment.amount);
    });

  return totals;
}

export function ledgerPaymentsForDate<T extends LedgerSaleReference>(
  sales: T[],
  payments: PaymentLedgerEntry[],
  date: string,
  businessUnitId = "",
) {
  const salesById = new Map(sales.map((sale) => [sale.id, sale]));

  return payments
    .filter(
      (payment) =>
        payment.voidedAt === null &&
        payment.paymentDate === date &&
        belongsToBusinessUnit(salesById, payment.saleId, businessUnitId),
    )
    .map((payment) => ({
      payment,
      sale: salesById.get(payment.saleId) as T,
    }))
    .sort((left, right) =>
      (right.payment.createdAt ?? "").localeCompare(
        left.payment.createdAt ?? "",
      ),
    );
}
