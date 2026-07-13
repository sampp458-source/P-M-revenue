import { describe, expect, it } from "vitest";
import {
  calculateDailyRevenue,
  calculateDateDetail,
  calculateRangeOverview,
  countDashboardSalesByUnit,
  dashboardComparisonRange,
  dashboardPeriodRange,
  previousDashboardRange,
  type BusinessUnitOption,
  type DashboardSale,
} from "./dashboardMetrics";

const sale = (overrides: Partial<DashboardSale>): DashboardSale => ({
  id: "sale",
  saleDate: "2026-07-14",
  businessUnitId: "daycare",
  businessUnitName: "유치원",
  productId: "product",
  productName: "월권",
  dogId: null,
  dogName: "(반려견 없음)",
  customerId: null,
  customerName: null,
  createdBy: "staff",
  staffName: "직원",
  paidAmount: 100000,
  refundAmount: 0,
  outstandingAmount: 0,
  netAmount: 100000,
  paymentMethod: "card",
  status: "normal",
  createdAt: "2026-07-14T01:00:00Z",
  ...overrides,
});

const units: BusinessUnitOption[] = [
  { id: "hotel", name: "호텔", code: "hotel" },
  { id: "daycare", name: "유치원", code: "daycare" },
  { id: "training", name: "교육센터", code: "training" },
];

describe("dashboard presentation metrics", () => {
  it("선택 월의 취소되지 않은 사업부별 매출 건수를 계산한다", () => {
    const counts = countDashboardSalesByUnit([
      sale({ id: "daycare-1" }),
      sale({ id: "daycare-2" }),
      sale({ id: "training", businessUnitId: "training" }),
      sale({ id: "cancelled", status: "cancelled" }),
      sale({ id: "previous", saleDate: "2026-06-30" }),
    ], "2026-07", "");

    expect(counts.get("daycare")).toBe(2);
    expect(counts.get("training")).toBe(1);
  });

  it("사업부 필터를 매출 건수에도 동일하게 적용한다", () => {
    const counts = countDashboardSalesByUnit([
      sale({ id: "daycare" }),
      sale({ id: "hotel", businessUnitId: "hotel" }),
    ], "2026-07", "hotel");

    expect(counts.has("daycare")).toBe(false);
    expect(counts.get("hotel")).toBe(1);
  });

  it("빠른 기간과 동일 길이 비교 기간을 계산한다", () => {
    expect(dashboardPeriodRange("this_week", "2026-07-14")).toEqual({ from: "2026-07-13", to: "2026-07-19" });
    expect(dashboardPeriodRange("last_month", "2026-07-14")).toEqual({ from: "2026-06-01", to: "2026-06-30" });
    expect(previousDashboardRange({ from: "2026-07-10", to: "2026-07-14" })).toEqual({ from: "2026-07-05", to: "2026-07-09" });
    expect(dashboardComparisonRange("this_month", { from: "2026-07-01", to: "2026-07-31" })).toEqual({ from: "2026-06-01", to: "2026-06-30" });
  });

  it("사업부를 유치원·교육센터·호텔 순으로 집계하고 취소 매출은 제외한다", () => {
    const overview = calculateRangeOverview([
      sale({ id: "daycare", paidAmount: 300000 }),
      sale({ id: "training", businessUnitId: "training", paidAmount: 200000 }),
      sale({ id: "hotel", businessUnitId: "hotel", paidAmount: 100000 }),
      sale({ id: "cancelled", businessUnitId: "hotel", paidAmount: 900000, status: "cancelled" }),
    ], units, { from: "2026-07-14", to: "2026-07-14" });

    expect(overview.divisions.map((division) => division.code)).toEqual(["daycare", "training", "hotel"]);
    expect(overview.total).toBe(600000);
    expect(overview.count).toBe(3);
  });

  it("매출이 없는 날짜도 0원으로 포함한 일별 추이를 만든다", () => {
    const daily = calculateDailyRevenue([
      sale({ id: "first", saleDate: "2026-07-13", netAmount: 80000 }),
      sale({ id: "cancelled", saleDate: "2026-07-14", netAmount: 50000, status: "cancelled" }),
    ], { from: "2026-07-13", to: "2026-07-15" });

    expect(daily.map((day) => [day.date, day.net, day.count])).toEqual([
      ["2026-07-13", 80000, 1],
      ["2026-07-14", 0, 0],
      ["2026-07-15", 0, 0],
    ]);
  });

  it("선택 날짜 상세에서 결제수단과 상품을 합산한다", () => {
    const detail = calculateDateDetail([
      sale({ id: "card-1", paidAmount: 300000, productId: "hotel-product", productName: "호텔", paymentMethod: "card" }),
      sale({ id: "card-2", paidAmount: 200000, productId: "hotel-product", productName: "호텔", paymentMethod: "card" }),
      sale({ id: "cash", paidAmount: 100000, productId: "training-product", productName: "교육", paymentMethod: "cash" }),
    ], units, "2026-07-14");

    expect(detail.total).toBe(600000);
    expect(detail.products[0]).toEqual({ name: "호텔", revenue: 500000 });
    expect(detail.payments).toEqual([{ method: "card", amount: 500000 }, { method: "cash", amount: 100000 }]);
  });
});
