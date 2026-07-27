import type {
  AccountingSale,
  LedgerDateRange,
  PaymentLedgerEntry,
  RefundLedgerEntry,
} from "./paymentLedgerMetrics";

export type AccountingEventKind =
  | "sale"
  | "initial_payment"
  | "outstanding_collection"
  | "adjustment"
  | "refund"
  | "cancellation"
  | "entry_error";

export interface AccountingEvent {
  id: string;
  saleId: string;
  eventDate: string;
  kind: AccountingEventKind;
  saleAmount: number;
  paidAmount: number;
  refundAmount: number;
  paymentMethod?: string;
  note?: string | null;
}

export interface AccountingEventSale extends AccountingSale {
  cancelledAt?: string | null;
  cancellationReason?: string | null;
}

const dateKey = (value: string | null | undefined, fallback: string) => {
  if (!value) return fallback;
  const matched = value.match(/^\d{4}-\d{2}-\d{2}/);
  return matched?.[0] ?? fallback;
};

const saleAmount = (sale: AccountingEventSale) =>
  Math.max(
    0,
    sale.originalAmount +
      (sale.additionalAmount ?? 0) -
      sale.discountAmount,
  );

export function buildAccountingEvents(
  sales: AccountingEventSale[],
  payments: PaymentLedgerEntry[],
  refunds: RefundLedgerEntry[],
) {
  const events: AccountingEvent[] = [];
  const salesById = new Map(sales.map((sale) => [sale.id, sale]));

  sales.forEach((sale) => {
    const entryError = sale.cancellationType === "entry_error";

    if (sale.status !== "cancelled" && !entryError) {
      events.push({
        id: `sale:${sale.id}`,
        saleId: sale.id,
        eventDate: sale.saleDate,
        kind: "sale",
        saleAmount: saleAmount(sale),
        paidAmount: 0,
        refundAmount: 0,
      });
    }

    if (sale.status === "cancelled" || entryError) {
      events.push({
        id: `${entryError ? "entry-error" : "cancellation"}:${sale.id}`,
        saleId: sale.id,
        eventDate: dateKey(sale.cancelledAt, sale.saleDate),
        kind: entryError ? "entry_error" : "cancellation",
        saleAmount: 0,
        paidAmount: 0,
        refundAmount: 0,
        note: sale.cancellationReason,
      });
    }
  });

  payments.forEach((payment) => {
    const sale = salesById.get(payment.saleId);
    if (
      !sale ||
      payment.voidedAt !== null ||
      sale.cancellationType === "entry_error"
    ) {
      return;
    }

    const kind =
      payment.source === "outstanding_collection"
        ? "outstanding_collection"
        : payment.source === "adjustment"
          ? "adjustment"
          : "initial_payment";
    events.push({
      id: `payment:${payment.id}`,
      saleId: payment.saleId,
      eventDate: payment.paymentDate,
      kind,
      saleAmount: 0,
      paidAmount: payment.amount,
      refundAmount: 0,
      paymentMethod: payment.paymentMethod,
      note: payment.note,
    });
  });

  refunds.forEach((refund) => {
    const sale = salesById.get(refund.saleId);
    if (
      !sale ||
      refund.voidedAt !== null ||
      !refund.refundDate ||
      sale.cancellationType === "entry_error"
    ) {
      return;
    }

    events.push({
      id: `refund:${refund.id}`,
      saleId: refund.saleId,
      eventDate: refund.refundDate,
      kind: "refund",
      saleAmount: 0,
      paidAmount: 0,
      refundAmount: refund.amount,
    });
  });

  return events.sort(
    (left, right) =>
      right.eventDate.localeCompare(left.eventDate) ||
      right.id.localeCompare(left.id),
  );
}

export function filterAccountingEvents(
  events: AccountingEvent[],
  range: LedgerDateRange,
  allowedSaleIds?: Set<string>,
) {
  return events.filter(
    (event) =>
      event.eventDate >= range.from &&
      event.eventDate <= range.to &&
      (!allowedSaleIds || allowedSaleIds.has(event.saleId)),
  );
}

export const accountingEventLabel = (kind: AccountingEventKind) =>
  ({
    sale: "판매",
    initial_payment: "최초 결제",
    outstanding_collection: "미수 회수",
    adjustment: "결제 조정",
    refund: "환불",
    cancellation: "취소",
    entry_error: "오등록 정정",
  })[kind];
