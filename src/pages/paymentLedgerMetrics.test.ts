import { describe, expect, it } from "vitest";
import {
  calculateAccountingDaily,
  calculateCurrentOutstanding,
  calculateLedgerCashSummary,
  calculateLedgerDaily,
  calculateLedgerPaymentMethodTotals,
  calculatePaymentAggregate,
  calculatePaymentDaily,
  calculateRefundAggregate,
  calculateRefundDaily,
  calculateSalesAggregate,
  ledgerPaymentsForDate,
  mergeAccountingDays,
  mergeSaleAndCashDays,
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
  paymentMethod: "card",
  source: "initial",
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
  it("판매·수납·환불·현재 미수를 Dashboard 회계 기준으로 분리한다", () => {
    const accountingSales = [
      {
        id: "daycare-sale",
        businessUnitId: "daycare",
        saleDate: "2026-06-15",
        status: "normal",
        originalAmount: 3000000,
        additionalAmount: 0,
        discountAmount: 0,
        outstandingAmount: 0,
        cancellationType: null,
      },
    ];
    const accountingPayments = [
      payment({
        id: "initial",
        paymentDate: "2026-06-15",
        amount: 1500000,
      }),
      payment({
        id: "collection",
        paymentDate: "2026-07-19",
        amount: 1500000,
        source: "outstanding_collection",
      }),
    ];
    const accountingRefunds = [
      refund({ id: "refund", refundDate: "2026-07-10", amount: 500000 }),
    ];
    const july = { from: "2026-07-01", to: "2026-07-31" };

    expect(calculateSalesAggregate(accountingSales, july)).toBe(0);
    expect(
      calculatePaymentAggregate(accountingSales, accountingPayments, july),
    ).toBe(1500000);
    expect(
      calculateRefundAggregate(accountingSales, accountingRefunds, july),
    ).toBe(500000);
    expect(calculateCurrentOutstanding(accountingSales)).toBe(0);
  });

  it("오등록 정정 거래는 모든 공통 회계 합계에서 제외한다", () => {
    const entryErrorSales = [
      {
        id: "daycare-sale",
        businessUnitId: "daycare",
        saleDate: "2026-07-10",
        status: "cancelled",
        originalAmount: 1100000,
        additionalAmount: 0,
        discountAmount: 0,
        outstandingAmount: 0,
        cancellationType: "entry_error",
      },
    ];
    const range = { from: "2026-07-01", to: "2026-07-31" };

    expect(calculateSalesAggregate(entryErrorSales, range)).toBe(0);
    expect(
      calculatePaymentAggregate(entryErrorSales, [payment({ amount: 1100000 })], range),
    ).toBe(0);
    expect(
      calculateRefundAggregate(entryErrorSales, [refund({ amount: 500000 })], range),
    ).toBe(0);
    expect(calculateCurrentOutstanding(entryErrorSales)).toBe(0);
  });

  it("공통 일별 회계 Selector가 7월 19일 미수 회수와 7월 10일 환불을 분리한다", () => {
    const accountingSales = [
      {
        id: "daycare-sale",
        businessUnitId: "daycare",
        saleDate: "2026-06-15",
        status: "normal",
        originalAmount: 3000000,
        additionalAmount: 0,
        discountAmount: 0,
        outstandingAmount: 0,
      },
    ];
    const daily = calculateAccountingDaily(
      accountingSales,
      [
        payment({
          paymentDate: "2026-07-19",
          amount: 1500000,
          source: "outstanding_collection",
        }),
      ],
      [refund({ refundDate: "2026-07-10", amount: 500000 })],
      { from: "2026-07-10", to: "2026-07-19" },
    );

    expect(daily.find((day) => day.date === "2026-07-10")).toEqual({
      date: "2026-07-10",
      salesAmount: 0,
      paidAmount: 0,
      refundAmount: 500000,
      netAmount: -500000,
    });
    expect(daily.find((day) => day.date === "2026-07-19")).toEqual({
      date: "2026-07-19",
      salesAmount: 0,
      paidAmount: 1500000,
      refundAmount: 0,
      netAmount: 1500000,
    });
  });

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

  it("오등록 취소로 무효화된 최초 결제를 실수납에서 제외한다", () => {
    const summary = calculateLedgerCashSummary(
      sales,
      [
        payment({
          id: "entry-error-initial",
          amount: 1500000,
          source: "initial",
          voidedAt: "2026-07-26T03:00:00Z",
        }),
        payment({
          id: "actual-payment",
          saleId: "hotel-sale",
          amount: 500000,
          source: "initial",
        }),
      ],
      [
        refund({
          id: "actual-refund",
          saleId: "hotel-sale",
          amount: 100000,
        }),
      ],
      { from: "2026-07-26", to: "2026-07-26" },
    );

    expect(summary).toEqual({
      paidAmount: 500000,
      refundAmount: 100000,
      netAmount: 400000,
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

  it("이월 미수 수납은 결제일에만 반영하고 원 매출일로 이동시키지 않는다", () => {
    const ledger = [
      payment({
        id: "initial",
        paymentDate: "2026-06-15",
        amount: 1500000,
      }),
      payment({
        id: "collection",
        paymentDate: "2026-07-19",
        amount: 1500000,
        source: "outstanding_collection",
      }),
    ];

    expect(
      calculateLedgerCashSummary(
        sales,
        ledger,
        [],
        { from: "2026-06-15", to: "2026-06-15" },
      ).paidAmount,
    ).toBe(1500000);
    expect(
      calculateLedgerCashSummary(
        sales,
        ledger,
        [],
        { from: "2026-07-19", to: "2026-07-19" },
      ).paidAmount,
    ).toBe(1500000);

    const merged = mergeSaleAndCashDays(
      [
        { date: "2026-06-15", salesAmount: 3000000 },
        { date: "2026-07-19", salesAmount: 0 },
      ],
      [
        {
          date: "2026-06-15",
          paidAmount: 1500000,
          refundAmount: 0,
          netAmount: 1500000,
        },
        {
          date: "2026-07-19",
          paidAmount: 1500000,
          refundAmount: 0,
          netAmount: 1500000,
        },
      ],
    );

    expect(merged).toEqual([
      {
        date: "2026-06-15",
        salesAmount: 3000000,
        revenue: 1500000,
        refund: 0,
        net: 1500000,
      },
      {
        date: "2026-07-19",
        salesAmount: 0,
        revenue: 1500000,
        refund: 0,
        net: 1500000,
      },
    ]);
  });

  it("최초 결제 0원인 전체 미수는 완납일에만 전액 수납으로 반영한다", () => {
    const collectionDate = "2026-07-19";
    const ledger = [
      payment({
        id: "full-outstanding-collection",
        paymentDate: collectionDate,
        amount: 3000000,
        paymentMethod: "transfer",
        source: "outstanding_collection",
      }),
    ];

    const originalDateCash = calculateLedgerCashSummary(
      sales,
      ledger,
      [],
      { from: "2026-06-15", to: "2026-06-15" },
    );
    const collectionDateCash = calculateLedgerCashSummary(
      sales,
      ledger,
      [],
      { from: collectionDate, to: collectionDate },
    );
    const paymentMethods = calculateLedgerPaymentMethodTotals(
      sales,
      ledger,
      { from: collectionDate, to: collectionDate },
    );

    expect(originalDateCash).toEqual({
      paidAmount: 0,
      refundAmount: 0,
      netAmount: 0,
    });
    expect(collectionDateCash).toEqual({
      paidAmount: 3000000,
      refundAmount: 0,
      netAmount: 3000000,
    });
    expect(Object.fromEntries(paymentMethods)).toEqual({
      transfer: 3000000,
    });
    expect(
      mergeSaleAndCashDays(
        [
          { date: "2026-06-15", salesAmount: 3000000 },
          { date: collectionDate, salesAmount: 0 },
        ],
        [
          { date: "2026-06-15", ...originalDateCash },
          { date: collectionDate, ...collectionDateCash },
        ],
      ),
    ).toEqual([
      {
        date: "2026-06-15",
        salesAmount: 3000000,
        revenue: 0,
        refund: 0,
        net: 0,
      },
      {
        date: collectionDate,
        salesAmount: 0,
        revenue: 3000000,
        refund: 0,
        net: 3000000,
      },
    ]);
  });

  it("같은 날 복수 수납을 결제수단별로 합산하고 무효 결제를 제외한다", () => {
    const ledger = [
      payment({ id: "card-1", amount: 300000, paymentMethod: "card" }),
      payment({ id: "card-2", amount: 200000, paymentMethod: "card" }),
      payment({ id: "cash", amount: 500000, paymentMethod: "cash" }),
      payment({
        id: "voided",
        amount: 900000,
        paymentMethod: "transfer",
        voidedAt: "2026-07-26T01:00:00Z",
      }),
    ];

    expect(
      Object.fromEntries(
        calculateLedgerPaymentMethodTotals(
          sales,
          ledger,
          { from: "2026-07-26", to: "2026-07-26" },
        ),
      ),
    ).toEqual({ card: 500000, cash: 500000 });
    expect(
      ledgerPaymentsForDate(sales, ledger, "2026-07-26"),
    ).toHaveLength(3);
  });
});

describe("Dashboard와 Reports 정산 기준 A-G", () => {
  const cashOn = (payments: PaymentLedgerEntry[], date: string) =>
    calculatePaymentAggregate(
      sales,
      payments,
      { from: date, to: date },
    );

  it("A. 당일 전액 결제는 판매일과 수납일에 각각 한 번 집계한다", () => {
    const ledger = [
      payment({ paymentDate: "2026-07-10", amount: 3000000 }),
    ];
    expect(cashOn(ledger, "2026-07-10")).toBe(3000000);
    expect(
      mergeAccountingDays(
        [{ date: "2026-07-10", salesAmount: 3000000 }],
        calculatePaymentDaily(
          sales,
          ledger,
          { from: "2026-07-10", to: "2026-07-10" },
        ),
        calculateRefundDaily(
          sales,
          [],
          { from: "2026-07-10", to: "2026-07-10" },
        ),
      )[0],
    ).toMatchObject({ salesAmount: 3000000, revenue: 3000000 });
  });

  it("B. 당일 부분 미수는 실제 당일 수납액만 집계한다", () => {
    const ledger = [
      payment({ paymentDate: "2026-07-10", amount: 1500000 }),
    ];
    expect(cashOn(ledger, "2026-07-10")).toBe(1500000);
  });

  it("C. 다음날 완납은 잔액을 다음날 수납으로 집계한다", () => {
    const ledger = [
      payment({ id: "initial", paymentDate: "2026-07-10", amount: 1500000 }),
      payment({
        id: "collection",
        paymentDate: "2026-07-11",
        amount: 1500000,
        source: "outstanding_collection",
      }),
    ];
    expect(cashOn(ledger, "2026-07-10")).toBe(1500000);
    expect(cashOn(ledger, "2026-07-11")).toBe(1500000);
  });

  it("D. 다음달 완납은 원 매출월이 아닌 결제월 수납으로 집계한다", () => {
    const ledger = [
      payment({ id: "initial", paymentDate: "2026-06-30", amount: 1000000 }),
      payment({
        id: "collection",
        paymentDate: "2026-07-19",
        amount: 2000000,
        source: "outstanding_collection",
      }),
    ];
    expect(cashOn(ledger, "2026-06-30")).toBe(1000000);
    expect(cashOn(ledger, "2026-07-19")).toBe(2000000);
  });

  it("E. 전체 미수 후 완납은 원 매출일 수납을 0원으로 유지한다", () => {
    const ledger = [
      payment({
        paymentDate: "2026-07-19",
        amount: 3000000,
        source: "outstanding_collection",
      }),
    ];
    expect(cashOn(ledger, "2026-06-30")).toBe(0);
    expect(cashOn(ledger, "2026-07-19")).toBe(3000000);
  });

  it("F. 부분 수납 여러 번은 각 payment_date에 나누어 집계한다", () => {
    const ledger = [
      payment({ id: "part-1", paymentDate: "2026-07-10", amount: 500000 }),
      payment({ id: "part-2", paymentDate: "2026-07-11", amount: 1000000 }),
      payment({ id: "part-3", paymentDate: "2026-07-19", amount: 1500000 }),
    ];
    expect(cashOn(ledger, "2026-07-10")).toBe(500000);
    expect(cashOn(ledger, "2026-07-11")).toBe(1000000);
    expect(cashOn(ledger, "2026-07-19")).toBe(1500000);
  });

  it("G. 수납 무효화는 해당 payment_date와 결제수단 합계에서 제외한다", () => {
    const ledger = [
      payment({
        id: "valid",
        paymentDate: "2026-07-19",
        amount: 1000000,
        paymentMethod: "card",
      }),
      payment({
        id: "voided",
        paymentDate: "2026-07-19",
        amount: 2000000,
        paymentMethod: "cash",
        voidedAt: "2026-07-20T01:00:00Z",
      }),
    ];
    expect(cashOn(ledger, "2026-07-19")).toBe(1000000);
    expect(
      Object.fromEntries(
        calculateLedgerPaymentMethodTotals(
          sales,
          ledger,
          { from: "2026-07-19", to: "2026-07-19" },
        ),
      ),
    ).toEqual({ card: 1000000 });
  });

  it("환불은 실수납과 별도로 집계한다", () => {
    const merged = mergeAccountingDays(
      [{ date: "2026-07-10", salesAmount: 3000000 }],
      [{
        date: "2026-07-10",
        paidAmount: 1500000,
      }],
      [{
        date: "2026-07-10",
        refundAmount: 200000,
      }],
    )[0];
    expect(merged).toMatchObject({
      salesAmount: 3000000,
      revenue: 1500000,
      refund: 200000,
    });
  });

  it("이월 수납월에는 연결된 판매금액과 과거 환불액이 유입되지 않는다", () => {
    const ledger = [
      payment({
        id: "initial",
        paymentDate: "2026-06-10",
        amount: 1500000,
      }),
      payment({
        id: "collection",
        paymentDate: "2026-07-19",
        amount: 1500000,
        source: "outstanding_collection",
      }),
    ];
    const refundLedger = [
      refund({
        refundDate: "2026-06-20",
        amount: 500000,
      }),
    ];

    const previousMonth = mergeAccountingDays(
      [{ date: "2026-06-10", salesAmount: 3000000 }],
      [{ date: "2026-06-10", paidAmount: cashOn(ledger, "2026-06-10") }],
      [{
        date: "2026-06-10",
        refundAmount: calculateRefundAggregate(
          sales,
          refundLedger,
          { from: "2026-06-01", to: "2026-06-30" },
        ),
      }],
    )[0];
    const currentMonth = mergeAccountingDays(
      [{ date: "2026-07-19", salesAmount: 0 }],
      [{ date: "2026-07-19", paidAmount: cashOn(ledger, "2026-07-19") }],
      [{
        date: "2026-07-19",
        refundAmount: calculateRefundAggregate(
          sales,
          refundLedger,
          { from: "2026-07-01", to: "2026-07-31" },
        ),
      }],
    )[0];

    expect(previousMonth).toMatchObject({
      salesAmount: 3000000,
      revenue: 1500000,
      refund: 500000,
    });
    expect(currentMonth).toMatchObject({
      salesAmount: 0,
      revenue: 1500000,
      refund: 0,
    });
  });
});
