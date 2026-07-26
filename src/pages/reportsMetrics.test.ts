import { describe, expect, it } from "vitest";
import {
  calculateReportDaily,
  calculateReportMoneySummary,
  calculateReportTrend,
  calculateReportUnitTotals,
  daysInReportMonth,
  previousReportMonth,
  reportTrendMonths,
  type ReportMetricSale,
} from "./reportsMetrics";

const sale = (
  overrides: Partial<ReportMetricSale> = {},
): ReportMetricSale => ({
  id: "sale",
  saleDate: "2026-07-14",
  businessUnitId: "daycare",
  productId: "product",
  staffId: "staff",
  staffName: "직원",
  originalAmount: 100000,
  additionalAmount: 0,
  discountAmount: 0,
  paidAmount: 100000,
  refundAmount: 0,
  outstandingAmount: 0,
  netAmount: 100000,
  status: "normal",
  ...overrides,
});

describe("monthly report metrics", () => {
  it("판매금액과 환불 반영 실결제액을 분리한다", () => {
    const summary = calculateReportMoneySummary(
      [
        sale({
          id: "partial-refund",
          originalAmount: 500000,
          additionalAmount: 50000,
          discountAmount: 100000,
          paidAmount: 400000,
          outstandingAmount: 50000,
          refundAmount: 100000,
          netAmount: 300000,
          status: "partial_refund",
        }),
        sale({
          id: "cancelled",
          originalAmount: 900000,
          paidAmount: 900000,
          outstandingAmount: 900000,
          netAmount: 900000,
          status: "cancelled",
        }),
      ],
      "2026-07",
    );

    expect(summary).toMatchObject({
      salesAmount: 450000,
      paidAmount: 400000,
      netAmount: 300000,
      refundAmount: 100000,
      outstandingAmount: 50000,
    });
  });

  it("일별 합계가 월 합계와 같고 빈 날짜와 종료일을 포함한다", () => {
    const rows = [
      sale({ id: "first", saleDate: "2026-07-01", netAmount: 70000 }),
      sale({ id: "last", saleDate: "2026-07-31", netAmount: 30000 }),
      sale({
        id: "cancelled",
        saleDate: "2026-07-31",
        netAmount: 50000,
        status: "cancelled",
      }),
    ];
    const daily = calculateReportDaily(rows, "2026-07");
    const monthly = calculateReportMoneySummary(rows, "2026-07");

    expect(daily).toHaveLength(31);
    expect(daily[0]).toMatchObject({ key: "2026-07-01", value: 70000 });
    expect(daily[30]).toMatchObject({ key: "2026-07-31", value: 30000 });
    expect(daily.reduce((total, day) => total + day.value, 0)).toBe(
      monthly.netAmount,
    );
  });

  it("윤년과 연말 이전 월을 안전하게 계산한다", () => {
    expect(daysInReportMonth("2028-02")).toBe(29);
    expect(previousReportMonth("2026-01")).toBe("2025-12");
    expect(reportTrendMonths("2026-01")).toEqual([
      "2025-02",
      "2025-03",
      "2025-04",
      "2025-05",
      "2025-06",
      "2025-07",
      "2025-08",
      "2025-09",
      "2025-10",
      "2025-11",
      "2025-12",
      "2026-01",
    ]);
  });

  it("최근 12개월을 시간순으로 유지하고 매출 없는 월을 0으로 채운다", () => {
    const trend = calculateReportTrend(
      [
        sale({ saleDate: "2025-02-10", netAmount: 10000 }),
        sale({ saleDate: "2026-01-10", netAmount: 90000 }),
      ],
      "2026-01",
    );

    expect(trend).toHaveLength(12);
    expect(trend[0]).toMatchObject({ key: "2025-02", value: 10000 });
    expect(trend[1]).toMatchObject({ key: "2025-03", value: 0 });
    expect(trend[11]).toMatchObject({ key: "2026-01", value: 90000 });
  });

  it("사업부 합계가 회사 전체 실결제액과 일치한다", () => {
    const rows = [
      sale({ id: "daycare", businessUnitId: "daycare", netAmount: 100000 }),
      sale({ id: "training", businessUnitId: "training", netAmount: 200000 }),
      sale({ id: "hotel", businessUnitId: "hotel", netAmount: 300000 }),
    ];
    const units = calculateReportUnitTotals(
      rows,
      "2026-07",
      ["daycare", "training", "hotel"],
    );
    const summary = calculateReportMoneySummary(rows, "2026-07");

    expect([...units.values()].reduce((total, value) => total + value, 0)).toBe(
      summary.netAmount,
    );
  });
});
