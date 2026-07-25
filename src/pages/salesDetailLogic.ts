import {
  normalizePaymentRows,
  type SalePaymentMethod,
  type SalePaymentRow,
} from "./salePaymentLogic";

export type RefundDetailKind = "partial" | "full" | "voided";

export interface RefundDetailRecord {
  id: string;
  voidedAt: string | null;
}

export function formatQuantityWithUnit(
  quantity: number,
  unitLabel: string | null,
) {
  const unit = (unitLabel ?? "").trim().replace(/^1\s*(?=[^0-9])/, "");
  return `${quantity}${unit}`;
}

export function detailPaymentRows(
  rows: SalePaymentRow[],
  fallbackMethod: string,
  paidAmount: number,
) {
  const normalized = normalizePaymentRows(rows);
  if (normalized.length > 0) return normalized;
  if (paidAmount <= 0) return [];
  const allowedMethods = new Set<SalePaymentMethod>([
    "card",
    "transfer",
    "cash",
    "other",
  ]);
  const method = allowedMethods.has(fallbackMethod as SalePaymentMethod)
    ? (fallbackMethod as SalePaymentMethod)
    : "other";
  return [{ method, amount: paidAmount }];
}

export function refundDetailKinds(
  refunds: RefundDetailRecord[],
  saleStatus: string,
) {
  const active = refunds.filter((refund) => !refund.voidedAt);
  const finalActiveId = active.at(-1)?.id;
  return new Map(
    refunds.map((refund) => {
      const kind: RefundDetailKind = refund.voidedAt
        ? "voided"
        : saleStatus === "full_refund" && refund.id === finalActiveId
          ? "full"
          : "partial";
      return [refund.id, kind];
    }),
  );
}
