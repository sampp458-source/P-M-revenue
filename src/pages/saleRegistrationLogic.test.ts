import { describe, expect, it } from "vitest";
import { buildQuickPartyRpcPayload, calculateGrossAmount, calculatePricingChange, defaultRepeatSettings, duplicateWarningLevel, hasProductNameDuplicate, isValidPaymentPlan, missingSaleRequirement, nextSaleForm, normalizeProductName, normalizeQuantity, normalizeSaleReference, partySearchScore } from "./saleRegistrationLogic";

describe("sale registration logic", () => {
  it("간편 등록 RPC payload를 운영 함수의 네 인자와 정확히 맞춘다", () => {
    const payload = buildQuickPartyRpcPayload({
      customerName: " 김철수 ",
      phone: "010-1234 5678",
      dogName: " 보리 ",
      breed: " ",
    });

    expect(payload).toEqual({
      p_customer_name: "김철수",
      p_phone: "01012345678",
      p_dog_name: "보리",
      p_breed: null,
    });
    expect(Object.keys(payload)).toEqual([
      "p_customer_name",
      "p_phone",
      "p_dog_name",
      "p_breed",
    ]);
  });

  it("같은 사업부의 상품명은 공백과 대소문자 차이를 무시해 중복을 찾는다", () => {
    const products = [{ businessUnitId: "daycare", name: "퍼피 클래스" }];

    expect(normalizeProductName("  퍼피   클래스 ")).toBe("퍼피 클래스");
    expect(hasProductNameDuplicate(products, "daycare", "퍼피  클래스")).toBe(true);
    expect(hasProductNameDuplicate(products, "hotel", "퍼피 클래스")).toBe(false);
  });

  it("고객 참고 정보는 빈 값을 null로 두고 연락처는 숫자로만 보존한다", () => {
    expect(normalizeSaleReference({ customerName: " 김철수 ", phone: "010-1234 5678", dogName: " " })).toEqual({
      customerName: "김철수",
      customerPhone: "01012345678",
      dogName: null,
    });
  });

  it("반려견 완전 일치를 가장 먼저 정렬한다", () => {
    expect(partySearchScore({ query: "보리", phoneQuery: "", dogName: "보리", customerName: "보리 보호자", phone: "" })).toBe(0);
    expect(partySearchScore({ query: "보리", phoneQuery: "", dogName: "왕보리", customerName: "보리 보호자", phone: "" })).toBe(2);
  });

  it("필수 저장 조건을 순서대로 안내한다", () => {
    expect(missingSaleRequirement({ businessUnitId: "", productId: "", originalAmount: 0, paidAmount: 0, outstandingAmount: 0, staffId: "" })).toContain("사업부");
    expect(missingSaleRequirement({ businessUnitId: "unit", productId: "product", originalAmount: 30000, paidAmount: 0, outstandingAmount: 30000, staffId: "staff" })).toBe("");
  });

  it("상품 유지 설정이면 다음 등록의 상품과 기본가를 유지한다", () => {
    const current = { saleDate: "2026-07-13", businessUnitId: "unit", customerId: "customer", dogId: "dog", categoryId: "category", productId: "product", quantity: 5, unitPrice: 7000, originalAmount: 35000, discountAmount: 5000, paidAmount: 30000, refundAmount: 0, outstandingAmount: 0, paymentMethod: "cash", customerType: "renewal", staffId: "staff", memo: "memo" };
    const next = nextSaleForm(current, { ...defaultRepeatSettings, keepProduct: true, keepPaymentMethod: true }, { today: "2026-07-14", defaultStaffId: "me", productDefaultPrice: 35000 });
    expect(next).toMatchObject({ customerId: "", dogId: "", productId: "product", quantity: 1, unitPrice: 35000, originalAmount: 35000, paidAmount: 35000, paymentMethod: "cash", staffId: "staff" });
  });

  it("수량은 1 이상 정수로 정규화하고 단가와 곱해 기준금액을 계산한다", () => {
    expect(normalizeQuantity(0)).toBe(1);
    expect(normalizeQuantity(3.8)).toBe(3);
    expect(calculateGrossAmount(50000, 3)).toBe(150000);
  });

  it("직접 수정한 결제금액은 수량 변경 후에도 덮어쓰지 않는다", () => {
    expect(calculatePricingChange({ unitPrice: 50000, quantity: 3, paidAmount: 140000, paidAmountEdited: true })).toEqual({ quantity: 3, unitPrice: 50000, originalAmount: 150000, paidAmount: 140000 });
    expect(calculatePricingChange({ unitPrice: 50000, quantity: 3, paidAmount: 50000, paidAmountEdited: false }).paidAmount).toBe(150000);
  });

  it("할인 관계는 유지하면서 할인 없는 추가요금을 허용한다", () => {
    expect(isValidPaymentPlan({ originalAmount: 150000, discountAmount: 10000, paidAmount: 140000, outstandingAmount: 0 })).toBe(true);
    expect(isValidPaymentPlan({ originalAmount: 150000, discountAmount: 0, paidAmount: 160000, outstandingAmount: 0 })).toBe(true);
    expect(isValidPaymentPlan({ originalAmount: 150000, discountAmount: 10000, paidAmount: 150000, outstandingAmount: 0 })).toBe(false);
  });

  it("최근 5분 완전 유사는 강한 경고, 같은 날 같은 상품은 약한 경고다", () => {
    const now = new Date("2026-07-13T10:05:00Z").getTime();
    expect(duplicateWarningLevel({ createdAt: "2026-07-13T10:03:00Z", saleDate: "2026-07-13", businessUnitId: "unit", paidAmount: 30000 }, { now, today: "2026-07-13", businessUnitId: "unit", paidAmount: 30000 })).toBe("strong");
    expect(duplicateWarningLevel({ createdAt: "2026-07-13T01:00:00Z", saleDate: "2026-07-13", businessUnitId: "unit", paidAmount: 20000 }, { now, today: "2026-07-13", businessUnitId: "unit", paidAmount: 30000 })).toBe("weak");
  });
});
