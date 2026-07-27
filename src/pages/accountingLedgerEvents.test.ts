import { describe, expect, it } from "vitest";
import {
  buildAccountingEvents,
  filterAccountingEvents,
  type AccountingEventSale,
} from "./accountingLedgerEvents";

const sale = (
  overrides: Partial<AccountingEventSale> = {},
): AccountingEventSale => ({
  id: "sale",
  businessUnitId: "training",
  saleDate: "2026-06-03",
  status: "normal",
  originalAmount: 3000000,
  additionalAmount: 0,
  discountAmount: 0,
  outstandingAmount: 0,
  cancellationType: null,
  ...overrides,
});

describe("accounting ledger events", () => {
  it("판매일과 미수 회수일을 독립 이벤트로 만든다", () => {
    const events = buildAccountingEvents(
      [sale()],
      [
        {
          id: "initial",
          saleId: "sale",
          paymentDate: "2026-06-03",
          amount: 1500000,
          voidedAt: null,
          source: "initial",
        },
        {
          id: "collection",
          saleId: "sale",
          paymentDate: "2026-07-19",
          amount: 1500000,
          voidedAt: null,
          source: "outstanding_collection",
        },
      ],
      [],
    );

    expect(
      filterAccountingEvents(events, {
        from: "2026-07-19",
        to: "2026-07-19",
      }),
    ).toEqual([
      expect.objectContaining({
        kind: "outstanding_collection",
        paidAmount: 1500000,
        eventDate: "2026-07-19",
      }),
    ]);
  });

  it("원 매출일과 다른 환불일에 환불 이벤트를 표시한다", () => {
    const events = buildAccountingEvents(
      [sale()],
      [],
      [
        {
          id: "refund",
          saleId: "sale",
          refundDate: "2026-07-10",
          amount: 500000,
          voidedAt: null,
        },
      ],
    );

    expect(
      filterAccountingEvents(events, {
        from: "2026-07-10",
        to: "2026-07-10",
      }),
    ).toEqual([
      expect.objectContaining({
        kind: "refund",
        refundAmount: 500000,
        eventDate: "2026-07-10",
      }),
    ]);
  });

  it("entry_error의 금액 이벤트를 제외하고 정정 감사 이벤트만 남긴다", () => {
    const events = buildAccountingEvents(
      [
        sale({
          status: "cancelled",
          cancellationType: "entry_error",
          cancelledAt: "2026-07-26T10:00:00Z",
        }),
      ],
      [
        {
          id: "payment",
          saleId: "sale",
          paymentDate: "2026-07-10",
          amount: 1100000,
          voidedAt: null,
          source: "initial",
        },
      ],
      [
        {
          id: "refund",
          saleId: "sale",
          refundDate: "2026-07-10",
          amount: 500000,
          voidedAt: null,
        },
      ],
    );

    expect(events).toEqual([
      expect.objectContaining({
        kind: "entry_error",
        saleAmount: 0,
        paidAmount: 0,
        refundAmount: 0,
      }),
    ]);
  });
});
