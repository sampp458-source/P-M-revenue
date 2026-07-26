import { describe, expect, it } from "vitest";
import {
  calculateLedgerCashSummary,
  calculateLedgerDaily,
  type PaymentLedgerEntry,
  type RefundLedgerEntry,
} from "./paymentLedgerMetrics";

const sales = [
  { id: "daycare-sale", businessUnitId: "daycare" },
  { id: "hotel-sale", businessUnitId: "hotel" },
];

const payment = (
  overrides: Partial<PaymentLedgerEntry> = {},
): PaymentLedgerEntry => ({
  id: "payment",
  saleId: "daycare-sale",
  paymentDate: "2026-07-26",
  amount: 100000,
  voidedAt: null,
  ...overrides,
});

const refund = (
  overrides: Partial<RefundLedgerEntry> = {},
): RefundLedgerEntry => ({
  id: "refund",
  saleId: "daycare-sale",
  refundDate: "2026-07-26",
  amount: 20000,
  voidedAt: null,
  ...overrides,
});

describe("payment ledger metrics", () => {
  it("수납은 payment_date, 환불은 refund_date 기준으로 계산한다", () => {
    const summary = calculateLedgerCashSummary(
      sales,
      [
        payment({ id: "current" }),
        payment({ id: "past", paymentDate: "2026-06-30", amount: 50000 }),
      ],
      [refund()],
      { from: "2026-07-01", to: "2026-07-31" },
    );

    expect(summary).toEqual({
      paidAmount: 100000,
      refundAmount: 20000,
      netAmount: 80000,
    });
  });

  it("무효화 원장과 다른 사업부를 제외한다", () => {
    const summary = calculateLedgerCashSummary(
      sales,
      [
        payment(),
        payment({ id: "voided", amount: 900000, voidedAt: "2026-07-26T01:00:00Z" }),
        payment({ id: "hotel", saleId: "hotel-sale", amount: 300000 }),
      ],
      [refund({ voidedAt: "2026-07-26T02:00:00Z" })],
      { from: "2026-07-26", to: "2026-07-26" },
      "daycare",
    );

    expect(summary).toEqual({
      paidAmount: 100000,
      refundAmount: 0,
      netAmount: 100000,
    });
  });

  it("거래가 없는 날짜도 포함한 일별 실수납을 만든다", () => {
    const daily = calculateLedgerDaily(
      sales,
      [payment({ paymentDate: "2026-07-25" })],
      [refund({ refundDate: "2026-07-26" })],
      { from: "2026-07-25", to: "2026-07-27" },
    );

    expect(daily).toEqual([
      { date: "2026-07-25", paidAmount: 100000, refundAmount: 0, netAmount: 100000 },
      { date: "2026-07-26", paidAmount: 0, refundAmount: 20000, netAmount: -20000 },
      { date: "2026-07-27", paidAmount: 0, refundAmount: 0, netAmount: 0 },
    ]);
  });
});
