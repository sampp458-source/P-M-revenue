import { describe, expect, it } from "vitest";
import { defaultRepeatSettings, duplicateWarningLevel, missingSaleRequirement, nextSaleForm, partySearchScore } from "./saleRegistrationLogic";

describe("sale registration logic", () => {
  it("반려견 완전 일치를 가장 먼저 정렬한다", () => {
    expect(partySearchScore({ query: "보리", phoneQuery: "", dogName: "보리", customerName: "보리 보호자", phone: "" })).toBe(0);
    expect(partySearchScore({ query: "보리", phoneQuery: "", dogName: "왕보리", customerName: "보리 보호자", phone: "" })).toBe(2);
  });

  it("필수 저장 조건을 순서대로 안내한다", () => {
    expect(missingSaleRequirement({ hasParty: false, businessUnitId: "", productId: "", paidAmount: 0, staffId: "" })).toContain("고객");
    expect(missingSaleRequirement({ hasParty: true, businessUnitId: "unit", productId: "product", paidAmount: 30000, staffId: "staff" })).toBe("");
  });

  it("상품 유지 설정이면 다음 등록의 상품과 기본가를 유지한다", () => {
    const current = { saleDate: "2026-07-13", businessUnitId: "unit", customerId: "customer", dogId: "dog", categoryId: "category", productId: "product", originalAmount: 35000, discountAmount: 5000, paidAmount: 30000, refundAmount: 0, outstandingAmount: 0, paymentMethod: "cash", customerType: "renewal", staffId: "staff", memo: "memo" };
    const next = nextSaleForm(current, { ...defaultRepeatSettings, keepProduct: true, keepPaymentMethod: true }, { today: "2026-07-14", defaultStaffId: "me", productDefaultPrice: 35000 });
    expect(next).toMatchObject({ customerId: "", dogId: "", productId: "product", paidAmount: 35000, paymentMethod: "cash", staffId: "staff" });
  });

  it("최근 5분 완전 유사는 강한 경고, 같은 날 같은 상품은 약한 경고다", () => {
    const now = new Date("2026-07-13T10:05:00Z").getTime();
    expect(duplicateWarningLevel({ createdAt: "2026-07-13T10:03:00Z", saleDate: "2026-07-13", businessUnitId: "unit", paidAmount: 30000 }, { now, today: "2026-07-13", businessUnitId: "unit", paidAmount: 30000 })).toBe("strong");
    expect(duplicateWarningLevel({ createdAt: "2026-07-13T01:00:00Z", saleDate: "2026-07-13", businessUnitId: "unit", paidAmount: 20000 }, { now, today: "2026-07-13", businessUnitId: "unit", paidAmount: 30000 })).toBe("weak");
  });
});
