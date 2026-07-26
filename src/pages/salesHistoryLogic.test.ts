import { describe, expect, it } from "vitest";
import {
  calculateTodayActivity,
  calculateSalesSummary,
  businessUnitDisplayOrder,
  filterSales,
  findDuplicateWarnings,
  hasOutstanding,
  isRefundDateAllowed,
  normalizePhone,
  refundRemainingAmount,
  shiftDateKey,
  type SalesHistoryFilters,
  type SalesHistoryRecord,
} from "./salesHistoryLogic";

const baseSale: SalesHistoryRecord = {
  id: "sale-1", saleDate: "2026-07-13", businessUnitId: "daycare", dogId: "dog-1", customerId: "customer-1",
  productCategoryId: "category-1", productId: "product-1", dogName: "보리", customerName: "김철수", customerPhone: "010-1234-5678",
  categoryName: "월권", productName: "주 3회", paidAmount: 300000, refundAmount: 0, outstandingAmount: 0, netAmount: 300000,
  paymentMethod: "card", status: "normal", staffId: "staff-1", staffName: "홍길동", createdBy: "staff-1", registrarName: "홍길동",
  createdAt: "2026-07-13T01:00:00.000Z", cancelledAt: null,
};

const filters: SalesHistoryFilters = {
  query: "", period: "custom", startDate: "", endDate: "", unitId: "", status: "", staffId: "", createdBy: "",
  paymentMethod: "", categoryId: "", productId: "", minAmount: null, maxAmount: null,
};

describe("salesHistoryLogic", () => {
  it("연락처를 숫자로 정규화한다", () => expect(normalizePhone("010-1234 5678")).toBe("01012345678"));

  it("반려견명으로 검색한다", () => expect(filterSales([baseSale], { ...filters, query: "보리" }, "2026-07-13")).toHaveLength(1));

  it("보호자명으로 검색한다", () => expect(filterSales([baseSale], { ...filters, query: "김철" }, "2026-07-13")).toHaveLength(1));

  it("분류 없는 과거 매출도 상품명으로 검색한다", () => {
    const uncategorized = { ...baseSale, productCategoryId: null, categoryName: "미분류", productName: "투약 추가비" };
    expect(filterSales([uncategorized], { ...filters, query: "투약" }, "2026-07-13")).toEqual([uncategorized]);
  });

  it("하이픈이 다른 연락처로 검색한다", () => expect(filterSales([baseSale], { ...filters, query: "12345678" }, "2026-07-13")).toHaveLength(1));

  it("상태와 미수금을 별도로 필터링한다", () => {
    const outstanding = { ...baseSale, id: "sale-2", outstandingAmount: 50000 };
    const refunded = { ...baseSale, id: "sale-3", status: "partial_refund" as const, refundAmount: 10000, outstandingAmount: 50000, netAmount: 290000 };
    const cancelled = { ...outstanding, id: "sale-4", status: "cancelled" as const };
    expect(hasOutstanding(outstanding)).toBe(true);
    expect(hasOutstanding(refunded)).toBe(true);
    expect(hasOutstanding(cancelled)).toBe(false);
    expect(filterSales([baseSale, outstanding], { ...filters, status: "outstanding" }, "2026-07-13")).toEqual([outstanding]);
    expect(filterSales([baseSale, refunded], { ...filters, status: "partial_refund" }, "2026-07-13")).toEqual([refunded]);
  });

  it("직접 선택한 날짜 범위를 적용한다", () => {
    expect(filterSales([baseSale], { ...filters, startDate: "2026-07-12", endDate: "2026-07-13" }, "2026-07-13")).toHaveLength(1);
    expect(filterSales([baseSale], { ...filters, startDate: "2026-07-01", endDate: "2026-07-12" }, "2026-07-13")).toHaveLength(0);
  });

  it("결제금액 최소·최대 범위를 적용한다", () => {
    expect(filterSales([baseSale], { ...filters, minAmount: 299999, maxAmount: 300001 }, "2026-07-13")).toHaveLength(1);
    expect(filterSales([baseSale], { ...filters, minAmount: 300001 }, "2026-07-13")).toHaveLength(0);
  });

  it("분할결제에 포함된 결제수단으로 필터링한다", () => {
    const split = { ...baseSale, paymentMethods: ["cash", "card"] };
    expect(filterSales([split], { ...filters, paymentMethod: "cash" }, "2026-07-13")).toEqual([split]);
    expect(filterSales([split], { ...filters, paymentMethod: "transfer" }, "2026-07-13")).toHaveLength(0);
  });

  it("5분 이내 동일 결제를 강한 중복으로 표시한다", () => {
    const duplicate = { ...baseSale, id: "sale-2", createdAt: "2026-07-13T01:04:00.000Z" };
    expect(findDuplicateWarnings([baseSale, duplicate]).get("sale-2")?.level).toBe("strong");
  });

  it("같은 날짜의 동일 고객·상품을 약한 중복으로 표시한다", () => {
    const duplicate = { ...baseSale, id: "sale-2", paidAmount: 250000, createdAt: "2026-07-13T10:00:00.000Z" };
    expect(findDuplicateWarnings([baseSale, duplicate]).get("sale-2")?.level).toBe("weak");
  });

  it("취소 매출은 중복 비교에서 제외한다", () => {
    const cancelled = { ...baseSale, id: "sale-2", status: "cancelled" as const, createdAt: "2026-07-13T01:01:00.000Z" };
    expect(findDuplicateWarnings([baseSale, cancelled]).size).toBe(0);
  });

  it("오늘 활동은 취소 매출을 금액에서 제외한다", () => {
    const refunded = { ...baseSale, id: "sale-2", refundAmount: 50000, netAmount: 250000, createdAt: "2026-07-13T02:00:00.000Z" };
    const cancelled = { ...baseSale, id: "sale-3", status: "cancelled" as const, netAmount: 300000, cancelledAt: "2026-07-13T03:00:00.000Z" };
    expect(calculateTodayActivity([refunded, cancelled], "2026-07-13")).toEqual({
      registeredCount: 2, netAmount: 250000, refundAmount: 50000, outstandingAmount: 0, cancelledCount: 1,
    });
  });

  it("조회 요약은 취소 매출을 건수와 금액에서 제외한다", () => {
    const cancelled = {
      ...baseSale,
      id: "sale-2",
      status: "cancelled" as const,
      netAmount: 300000,
      refundAmount: 10000,
      outstandingAmount: 50000,
    };
    expect(calculateSalesSummary([baseSale, cancelled])).toEqual({
      count: 1,
      netAmount: 300000,
      refundAmount: 0,
      outstandingAmount: 0,
    });
  });

  it("사업부를 유치원, 교육, 호텔 순서로 정렬할 수 있다", () => {
    expect(
      ["호텔", "유치원", "교육센터"].sort(
        (left, right) =>
          businessUnitDisplayOrder(left) - businessUnitDisplayOrder(right),
      ),
    ).toEqual(["유치원", "교육센터", "호텔"]);
  });

  it("단일 조회 날짜를 하루씩 이동한다", () => {
    expect(shiftDateKey("2026-07-01", -1)).toBe("2026-06-30");
    expect(shiftDateKey("2026-07-31", 1)).toBe("2026-08-01");
  });

  it("누적 환불액을 제외한 남은 환불 가능액을 계산한다", () => {
    expect(refundRemainingAmount(1000000, 200000)).toBe(800000);
    expect(refundRemainingAmount(1000000, 1200000)).toBe(0);
  });

  it("환불 처리일은 매출일 이후부터 오늘까지만 허용한다", () => {
    expect(
      isRefundDateAllowed("2026-07-14", "2026-06-20", "2026-07-14"),
    ).toBe(true);
    expect(
      isRefundDateAllowed("2026-06-19", "2026-06-20", "2026-07-14"),
    ).toBe(false);
    expect(
      isRefundDateAllowed("2026-07-15", "2026-06-20", "2026-07-14"),
    ).toBe(false);
  });
});
