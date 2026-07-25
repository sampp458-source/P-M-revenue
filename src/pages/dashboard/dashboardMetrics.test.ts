import { describe, expect, it } from "vitest";
import {
  calculateDailyRevenue,
  calculateDateDetail,
  calculateRangeOverview,
  calculateTarget,
  countDashboardSalesByUnit,
  dashboardComparisonRange,
  dashboardDefaultCompare,
  dashboardPeriodRange,
  dashboardSalesForDate,
  formatRevenueComparison,
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
  paymentMethod: "card",
  paidAmount: 100000,
  refundAmount: 0,
  outstandingAmount: 0,
  netAmount: 100000,
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
    expect(dashboardComparisonRange("custom", { from: "2026-07-10", to: "2026-07-14" }, "day")).toEqual({ from: "2026-07-09", to: "2026-07-13" });
    expect(dashboardComparisonRange("custom", { from: "2026-07-10", to: "2026-07-14" }, "week")).toEqual({ from: "2026-07-03", to: "2026-07-07" });
    expect(dashboardComparisonRange("custom", { from: "2026-03-31", to: "2026-03-31" }, "month")).toEqual({ from: "2026-02-28", to: "2026-02-28" });
    expect(dashboardDefaultCompare("today")).toBe("day");
    expect(dashboardDefaultCompare("this_week")).toBe("week");
    expect(dashboardDefaultCompare("this_month")).toBe("month");
    expect(dashboardDefaultCompare("custom")).toBe("previous");
  });

  it("비교 증감 문구에서 0·동일·증가·감소를 안전하게 구분한다", () => {
    expect(formatRevenueComparison(100000, 0)).toBe("신규");
    expect(formatRevenueComparison(0, 0)).toBe("— 변화 없음");
    expect(formatRevenueComparison(100000, 100000)).toBe("— 변화 없음");
    expect(formatRevenueComparison(120000, 100000)).toBe("▲ 증가 20.0%");
    expect(formatRevenueComparison(80000, 100000)).toBe("▼ 감소 20.0%");
  });

  it("전체 목표를 우선하고 없으면 사업부 목표 합계를 사용한다", () => {
    const targets = [
      { year: 2026, month: 7, businessUnitId: "daycare", targetAmount: 1000000 },
      { year: 2026, month: 7, businessUnitId: "hotel", targetAmount: 500000 },
    ];

    expect(calculateTarget("2026-07", "", targets)).toBe(1500000);
    expect(
      calculateTarget("2026-07", "", [
        ...targets,
        { year: 2026, month: 7, businessUnitId: null, targetAmount: 2000000 },
      ]),
    ).toBe(2000000);
  });

  it("사업부를 유치원·교육센터·호텔 순으로 집계하고 취소 매출은 제외한다", () => {
    const overview = calculateRangeOverview([
      sale({ id: "daycare", paidAmount: 350000, netAmount: 300000 }),
      sale({ id: "training", businessUnitId: "training", paidAmount: 250000, netAmount: 200000 }),
      sale({ id: "hotel", businessUnitId: "hotel", paidAmount: 150000, netAmount: 100000 }),
      sale({ id: "cancelled", businessUnitId: "hotel", paidAmount: 900000, netAmount: 900000, status: "cancelled" }),
    ], units, { from: "2026-07-14", to: "2026-07-14" });

    expect(overview.divisions.map((division) => division.code)).toEqual(["daycare", "training", "hotel"]);
    expect(overview.total).toBe(600000);
    expect(overview.previousTotal).toBe(0);
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

  it("선택 날짜 상세를 환불 반영 실매출로 집계한다", () => {
    const detail = calculateDateDetail([
      sale({ id: "daycare-1", paidAmount: 300000, netAmount: 300000 }),
      sale({ id: "daycare-2", paidAmount: 250000, netAmount: 200000, refundAmount: 50000 }),
      sale({ id: "training", businessUnitId: "training", paidAmount: 100000, netAmount: 100000 }),
    ], units, "2026-07-14");

    expect(detail.total).toBe(600000);
    expect(detail.divisions[0]).toMatchObject({ code: "daycare", revenue: 500000, count: 2, average: 250000 });
    expect(detail.refund).toBe(50000);
  });

  it("날짜 Drawer 거래를 사업부로 필터링하고 최신 등록순으로 정렬한다", () => {
    const rows = dashboardSalesForDate([
      sale({ id: "older", createdAt: "2026-07-14T01:00:00Z" }),
      sale({ id: "newer", createdAt: "2026-07-14T03:00:00Z" }),
      sale({ id: "cancelled", status: "cancelled", createdAt: "2026-07-14T02:00:00Z" }),
      sale({ id: "hotel", businessUnitId: "hotel" }),
      sale({ id: "other-day", saleDate: "2026-07-13" }),
    ], "2026-07-14", "daycare");

    expect(rows.map((row) => row.id)).toEqual(["newer", "cancelled", "older"]);
  });

  it("고정 사업부에 없는 매출을 선택 날짜의 기타 항목에 포함한다", () => {
    const detail = calculateDateDetail([
      sale({ id: "daycare", netAmount: 100000 }),
      sale({ id: "other", businessUnitId: "other-unit", businessUnitName: "기타", netAmount: 50000 }),
    ], units, "2026-07-14");

    expect(detail.total).toBe(150000);
    expect(detail.other).toEqual({ revenue: 50000, count: 1, average: 50000 });
  });
});
