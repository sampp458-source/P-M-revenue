import { describe, expect, it } from "vitest";
import {
  calculateTodayActivity,
  filterSales,
  findDuplicateWarnings,
  hasOutstanding,
  normalizePhone,
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

  it("하이픈이 다른 연락처로 검색한다", () => expect(filterSales([baseSale], { ...filters, query: "12345678" }, "2026-07-13")).toHaveLength(1));

  it("상태와 미수금을 별도로 필터링한다", () => {
    const outstanding = { ...baseSale, id: "sale-2", outstandingAmount: 50000 };
    const refunded = { ...baseSale, id: "sale-3", status: "partial_refund" as const, refundAmount: 10000, netAmount: 290000 };
    expect(hasOutstanding(outstanding)).toBe(true);
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
});
