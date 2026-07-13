export type SalePaymentMethod = "card" | "transfer" | "cash" | "other";

export interface SalePaymentRow {
  method: SalePaymentMethod;
  amount: number;
}

export const paymentMethodLabels: Record<SalePaymentMethod, string> = {
  card: "카드",
  transfer: "계좌이체",
  cash: "현금",
  other: "기타",
};

export const defaultSplitPaymentRows = (): SalePaymentRow[] => [
  { method: "cash", amount: 0 },
  { method: "card", amount: 0 },
  { method: "transfer", amount: 0 },
];

export function normalizePaymentRows(rows: SalePaymentRow[]) {
  const totals = new Map<SalePaymentMethod, number>();
  rows.forEach(({ method, amount }) => {
    const normalized = Math.max(0, Math.trunc(Number(amount) || 0));
    if (normalized > 0)
      totals.set(method, (totals.get(method) ?? 0) + normalized);
  });
  return [...totals.entries()].map(([method, amount]) => ({ method, amount }));
}

export const paymentRowsTotal = (rows: SalePaymentRow[]) =>
  normalizePaymentRows(rows).reduce((total, row) => total + row.amount, 0);

export const isSplitPayment = (rows: SalePaymentRow[]) =>
  normalizePaymentRows(rows).length > 1;

export function paymentSummary(rows: SalePaymentRow[], fallbackMethod: string, paidAmount: number) {
  const normalized = normalizePaymentRows(rows);
  if (normalized.length > 1) return `분할결제 · ${paidAmount.toLocaleString("ko-KR")}원`;
  const method = normalized[0]?.method ?? fallbackMethod;
  return `${paymentMethodLabels[method as SalePaymentMethod] ?? method} · ${paidAmount.toLocaleString("ko-KR")}원`;
}
