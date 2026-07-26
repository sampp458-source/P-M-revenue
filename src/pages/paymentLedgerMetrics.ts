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

export interface PaymentDailyAmount {
  date: string;
  paidAmount: number;
}

export interface RefundDailyAmount {
  date: string;
  refundAmount: number;
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
  const paidAmount = calculatePaymentAggregate(
    sales,
    payments,
    range,
    businessUnitId,
  );
  const refundAmount = calculateRefundAggregate(
    sales,
    refunds,
    range,
    businessUnitId,
  );

  return {
    paidAmount,
    refundAmount,
    netAmount: paidAmount - refundAmount,
  };
}

export function calculatePaymentAggregate(
  sales: LedgerSaleReference[],
  payments: PaymentLedgerEntry[],
  range: LedgerDateRange,
  businessUnitId = "",
) {
  const salesById = saleIndex(sales);
  return payments
    .filter(
      (payment) =>
        payment.voidedAt === null &&
        inRange(payment.paymentDate, range) &&
        belongsToBusinessUnit(salesById, payment.saleId, businessUnitId),
    )
    .reduce((total, payment) => total + payment.amount, 0);
}

export function calculateRefundAggregate(
  sales: LedgerSaleReference[],
  refunds: RefundLedgerEntry[],
  range: LedgerDateRange,
  businessUnitId = "",
) {
  const salesById = saleIndex(sales);
  return refunds
    .filter(
      (refund) =>
        refund.voidedAt === null &&
        inRange(refund.refundDate, range) &&
        belongsToBusinessUnit(salesById, refund.saleId, businessUnitId),
    )
    .reduce((total, refund) => total + refund.amount, 0);
}

export function calculateLedgerDaily(
  sales: LedgerSaleReference[],
  payments: PaymentLedgerEntry[],
  refunds: RefundLedgerEntry[],
  range: LedgerDateRange,
  businessUnitId = "",
) {
  const paymentsByDate = new Map(
    calculatePaymentDaily(sales, payments, range, businessUnitId).map((day) => [
      day.date,
      day.paidAmount,
    ]),
  );
  const refundsByDate = new Map(
    calculateRefundDaily(sales, refunds, range, businessUnitId).map((day) => [
      day.date,
      day.refundAmount,
    ]),
  );

  return dateKeys(range).map((date) => {
    const paidAmount = paymentsByDate.get(date) ?? 0;
    const refundAmount = refundsByDate.get(date) ?? 0;
    return {
      date,
      paidAmount,
      refundAmount,
      netAmount: paidAmount - refundAmount,
    };
  });
}

const dateKeys = (range: LedgerDateRange) => {
  const result: string[] = [];
  const cursor = new Date(`${range.from}T12:00:00`);
  const end = new Date(`${range.to}T12:00:00`);

  while (cursor <= end) {
    result.push(cursor.toLocaleDateString("sv-SE"));
    cursor.setDate(cursor.getDate() + 1);
  }
  return result;
};

export function calculatePaymentDaily(
  sales: LedgerSaleReference[],
  payments: PaymentLedgerEntry[],
  range: LedgerDateRange,
  businessUnitId = "",
) {
  return dateKeys(range).map((date) => ({
    date,
    paidAmount: calculatePaymentAggregate(
      sales,
      payments,
      { from: date, to: date },
      businessUnitId,
    ),
  }));
}

export function calculateRefundDaily(
  sales: LedgerSaleReference[],
  refunds: RefundLedgerEntry[],
  range: LedgerDateRange,
  businessUnitId = "",
) {
  return dateKeys(range).map((date) => ({
    date,
    refundAmount: calculateRefundAggregate(
      sales,
      refunds,
      { from: date, to: date },
      businessUnitId,
    ),
  }));
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

export function mergeAccountingDays<T extends { date: string }>(
  saleDays: T[],
  paymentDays: PaymentDailyAmount[],
  refundDays: RefundDailyAmount[],
) {
  const paymentsByDate = new Map(
    paymentDays.map((day) => [day.date, day.paidAmount]),
  );
  const refundsByDate = new Map(
    refundDays.map((day) => [day.date, day.refundAmount]),
  );

  return saleDays.map((day) => {
    const paidAmount = paymentsByDate.get(day.date) ?? 0;
    const refundAmount = refundsByDate.get(day.date) ?? 0;
    return {
      ...day,
      revenue: paidAmount,
      refund: refundAmount,
      net: paidAmount - refundAmount,
      outstanding: 0,
    };
  });
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
