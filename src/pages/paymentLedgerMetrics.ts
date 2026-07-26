export interface PaymentLedgerEntry {
  id: string;
  saleId: string;
  paymentDate: string;
  amount: number;
  voidedAt: string | null;
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

const inRange = (date: string | null, range: LedgerDateRange) =>
  Boolean(date && date >= range.from && date <= range.to);

export function calculateLedgerCashSummary(
  sales: LedgerSaleReference[],
  payments: PaymentLedgerEntry[],
  refunds: RefundLedgerEntry[],
  range: LedgerDateRange,
  businessUnitId = "",
) {
  const salesById = new Map(sales.map((sale) => [sale.id, sale]));
  const belongsToSelection = (saleId: string) => {
    const sale = salesById.get(saleId);
    return Boolean(
      sale && (!businessUnitId || sale.businessUnitId === businessUnitId),
    );
  };
  const paidAmount = payments
    .filter(
      (payment) =>
        payment.voidedAt === null &&
        inRange(payment.paymentDate, range) &&
        belongsToSelection(payment.saleId),
    )
    .reduce((total, payment) => total + payment.amount, 0);
  const refundAmount = refunds
    .filter(
      (refund) =>
        refund.voidedAt === null &&
        inRange(refund.refundDate, range) &&
        belongsToSelection(refund.saleId),
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
  const result: Array<{
    date: string;
    paidAmount: number;
    refundAmount: number;
    netAmount: number;
  }> = [];
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
