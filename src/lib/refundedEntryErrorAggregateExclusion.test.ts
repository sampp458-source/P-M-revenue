import { describe, expect, it } from "vitest";
import {
  calculateDailySales,
  calculateSalesRangeOverview,
  type DashboardSale,
} from "../pages/dashboard/dashboardMetrics";
import {
  calculatePaymentAggregate,
  calculateRefundAggregate,
  type PaymentLedgerEntry,
  type RefundLedgerEntry,
} from "../pages/paymentLedgerMetrics";
import { activeReportSales } from "../pages/reportsMetrics";
import { hasOutstanding } from "../pages/salesHistoryLogic";

const range = { from: "2026-07-01", to: "2026-07-31" };
const sale: DashboardSale = {
  id: "7830a874-f8c2-487c-820b-b9d12338ab65",
  saleDate: "2026-07-10",
  businessUnitId: "training",
  businessUnitName: "교육센터",
  productId: "product-1",
  productName: "테스트 상품",
  dogId: null,
  dogName: "(반려견 없음)",
  customerId: null,
  customerName: null,
  createdBy: "admin",
  staffName: "관리자",
  paymentMethod: "transfer",
  originalAmount: 1100000,
  additionalAmount: 0,
  discountAmount: 0,
  paidAmount: 1100000,
  refundAmount: 1100000,
  outstandingAmount: 0,
  netAmount: 0,
  status: "full_refund",
  createdAt: "2026-07-10T01:00:00.000Z",
};
const payment: PaymentLedgerEntry = {
  id: "9d1657bb-2438-4f9b-ba18-6e44ac75982a",
  saleId: sale.id,
  paymentDate: "2026-07-10",
  amount: 1100000,
  paymentMethod: "transfer",
  source: "initial",
  voidedAt: null,
};
const refunds: RefundLedgerEntry[] = [
  {
    id: "b6d7e747-c064-4f46-88ae-be3d4e14a95c",
    saleId: sale.id,
    refundDate: null,
    amount: 500000,
    voidedAt: null,
  },
  {
    id: "d50f8e82-61c4-4251-8aa2-c590fc0122d6",
    saleId: sale.id,
    refundDate: "2026-07-27",
    amount: 600000,
    voidedAt: null,
  },
];

describe("refunded entry-error aggregate exclusion", () => {
  it("removes the corrected sale from Dashboard, Reports, Calendar and ledgers", () => {
    const beforeOverview = calculateSalesRangeOverview(
      [sale],
      [],
      range,
      range,
    );
    expect(beforeOverview.salesAmount).toBe(1100000);
    expect(calculatePaymentAggregate([sale], [payment], range)).toBe(1100000);
    expect(calculateRefundAggregate([sale], refunds, range)).toBe(600000);

    const corrected = {
      ...sale,
      status: "cancelled" as const,
      staffId: null,
      paidAmount: 0,
      refundAmount: 0,
      outstandingAmount: 0,
      netAmount: 0,
    };
    const voidedPayment = {
      ...payment,
      voidedAt: "2026-07-27T08:00:00.000Z",
    };
    const voidedRefunds = refunds.map((refund) => ({
      ...refund,
      voidedAt: "2026-07-27T08:00:00.000Z",
    }));

    expect(
      calculateSalesRangeOverview([corrected], [], range, range).salesAmount,
    ).toBe(0);
    expect(
      calculatePaymentAggregate([corrected], [voidedPayment], range),
    ).toBe(0);
    expect(
      calculateRefundAggregate([corrected], voidedRefunds, range),
    ).toBe(0);
    expect(
      calculateDailySales([corrected], range).find(
        (day) => day.date === "2026-07-10",
      ),
    ).toMatchObject({ salesAmount: 0, count: 0, cancelledCount: 1 });
    expect(activeReportSales([corrected], "2026-07")).toHaveLength(0);
    expect(hasOutstanding(corrected)).toBe(false);
  });
});
