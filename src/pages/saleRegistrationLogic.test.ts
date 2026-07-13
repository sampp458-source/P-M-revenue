import { describe, expect, it } from "vitest";
import {
  buildQuickPartyRpcPayload,
  calculateFinalSaleAmount,
  calculateGrossAmount,
  calculateOutstandingAmount,
  calculatePricingChange,
  defaultRepeatSettings,
  duplicateWarningLevel,
  hasCategoryNameDuplicate,
  hasProductNameDuplicate,
  isBalancedPaymentPlan,
  isProductScopeValid,
  isValidPaymentPlan,
  missingSaleRequirement,
  nextSaleForm,
  normalizeProductName,
  normalizeQuantity,
  normalizeSaleReference,
  parseCurrencyInput,
  recentProductIdsForUser,
  partySearchScore,
  suggestUnitLabel,
} from "./saleRegistrationLogic";

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
    expect(hasProductNameDuplicate(products, "daycare", "퍼피  클래스")).toBe(
      true,
    );
    expect(hasProductNameDuplicate(products, "hotel", "퍼피 클래스")).toBe(
      false,
    );
  });

  it("같은 사업부의 분류명은 공백과 대소문자 차이를 무시해 중복을 찾는다", () => {
    const categories = [{ businessUnitId: "hotel", name: "장기 호텔" }];

    expect(hasCategoryNameDuplicate(categories, "hotel", " 장기   호텔 ")).toBe(
      true,
    );
    expect(hasCategoryNameDuplicate(categories, "daycare", "장기 호텔")).toBe(
      false,
    );
  });

  it("사업부와 상품 특성에 따라 단위를 제안한다", () => {
    expect(
      suggestUnitLabel({ businessUnitName: "호텔", productName: "호텔 1박" }),
    ).toBe("박");
    expect(
      suggestUnitLabel({ businessUnitName: "유치원", productName: "월권" }),
    ).toBe("회");
    expect(
      suggestUnitLabel({ businessUnitName: "호텔", productName: "배변 패드" }),
    ).toBe("개");
  });

  it("분류 없는 상품도 사업부가 일치하면 매출 선택을 허용한다", () => {
    expect(
      isProductScopeValid(
        { businessUnitId: "hotel", categoryId: null },
        "hotel",
        "",
      ),
    ).toBe(true);
    expect(
      isProductScopeValid(
        { businessUnitId: "hotel", categoryId: "category" },
        "hotel",
        "category",
      ),
    ).toBe(true);
    expect(
      isProductScopeValid(
        { businessUnitId: "hotel", categoryId: null },
        "daycare",
        "",
      ),
    ).toBe(false);
  });

  it("고객 참고 정보는 빈 값을 null로 두고 연락처는 숫자로만 보존한다", () => {
    expect(
      normalizeSaleReference({
        customerName: " 김철수 ",
        phone: "010-1234 5678",
        dogName: " ",
      }),
    ).toEqual({
      customerName: "김철수",
      customerPhone: "01012345678",
      dogName: null,
    });
  });

  it("반려견 완전 일치를 가장 먼저 정렬한다", () => {
    expect(
      partySearchScore({
        query: "보리",
        phoneQuery: "",
        dogName: "보리",
        customerName: "보리 보호자",
        phone: "",
      }),
    ).toBe(0);
    expect(
      partySearchScore({
        query: "보리",
        phoneQuery: "",
        dogName: "왕보리",
        customerName: "보리 보호자",
        phone: "",
      }),
    ).toBe(2);
  });

  it("필수 저장 조건을 순서대로 안내한다", () => {
    expect(
      missingSaleRequirement({
        businessUnitId: "",
        productId: "",
        originalAmount: 0,
        paidAmount: 0,
        outstandingAmount: 0,
        staffId: "",
      }),
    ).toContain("사업부");
    expect(
      missingSaleRequirement({
        businessUnitId: "unit",
        productId: "product",
        originalAmount: 30000,
        paidAmount: 0,
        outstandingAmount: 30000,
        staffId: "staff",
      }),
    ).toBe("");
  });

  it("상품 유지 설정이면 다음 등록의 상품과 기본가를 유지한다", () => {
    const current = {
      saleDate: "2026-07-13",
      businessUnitId: "unit",
      customerId: "customer",
      dogId: "dog",
      categoryId: "category",
      productId: "product",
      quantity: 5,
      unitPrice: 7000,
      originalAmount: 35000,
      additionalAmount: 0,
      discountAmount: 5000,
      paidAmount: 30000,
      refundAmount: 0,
      outstandingAmount: 0,
      adjustmentNote: "",
      paymentMethod: "cash",
      customerType: "renewal",
      staffId: "staff",
      memo: "memo",
    };
    const next = nextSaleForm(
      current,
      { ...defaultRepeatSettings, keepProduct: true, keepPaymentMethod: true },
      { today: "2026-07-14", defaultStaffId: "me", productDefaultPrice: 35000 },
    );
    expect(next).toMatchObject({
      customerId: "",
      dogId: "",
      productId: "product",
      quantity: 1,
      unitPrice: 35000,
      originalAmount: 35000,
      paidAmount: 35000,
      paymentMethod: "cash",
      staffId: "staff",
    });
  });

  it("수량은 1 이상 정수로 정규화하고 단가와 곱해 기준금액을 계산한다", () => {
    expect(normalizeQuantity(0)).toBe(1);
    expect(normalizeQuantity(3.8)).toBe(3);
    expect(calculateGrossAmount(50000, 3)).toBe(150000);
  });

  it("금액 입력은 붙여넣은 문자와 음수 기호를 제거하고 상한을 지킨다", () => {
    expect(parseCurrencyInput("50,000원")).toBe(50000);
    expect(parseCurrencyInput("-12 345")).toBe(12345);
    expect(parseCurrencyInput("abc")).toBe(0);
    expect(parseCurrencyInput("99999", 50000)).toBe(50000);
  });

  it("현재 사용자의 최근 상품은 취소를 제외하고 중복 없이 최신순으로 고른다", () => {
    expect(
      recentProductIdsForUser(
        [
          { productId: "hotel", createdBy: "me", status: "normal" },
          { productId: "hotel", createdBy: "me", status: "normal" },
          { productId: "cancelled", createdBy: "me", status: "cancelled" },
          { productId: "daycare", createdBy: "other", status: "normal" },
          { productId: "training", createdBy: "me", status: "normal" },
        ],
        "me",
      ),
    ).toEqual(["hotel", "training"]);
  });

  it("직접 수정한 결제금액은 수량 변경 후에도 덮어쓰지 않는다", () => {
    expect(
      calculatePricingChange({
        unitPrice: 50000,
        quantity: 3,
        paidAmount: 140000,
        paidAmountEdited: true,
      }),
    ).toEqual({
      quantity: 3,
      unitPrice: 50000,
      originalAmount: 150000,
      paidAmount: 140000,
      outstandingAmount: 10000,
    });
    expect(
      calculatePricingChange({
        unitPrice: 50000,
        quantity: 3,
        paidAmount: 50000,
        paidAmountEdited: false,
      }),
    ).toMatchObject({ paidAmount: 150000, outstandingAmount: 0 });
  });

  it("추가금액과 할인을 반영하고 미수금을 자동 계산한다", () => {
    expect(calculateFinalSaleAmount(150000, 12500, 5000)).toBe(157500);
    expect(calculateOutstandingAmount(157500, 100000)).toBe(57500);
    expect(
      isBalancedPaymentPlan({
        originalAmount: 150000,
        additionalAmount: 12500,
        discountAmount: 5000,
        paidAmount: 100000,
        outstandingAmount: 57500,
      }),
    ).toBe(true);
    expect(
      isBalancedPaymentPlan({
        originalAmount: 150000,
        additionalAmount: 0,
        discountAmount: 0,
        paidAmount: 160000,
        outstandingAmount: 0,
      }),
    ).toBe(false);
    expect(
      isValidPaymentPlan({
        originalAmount: 150000,
        discountAmount: 0,
        paidAmount: 100000,
        outstandingAmount: 0,
      }),
    ).toBe(true);
  });

  it.each([500, 7000, 12500, 23400])(
    "추가금액 %d원을 원 단위로 계산한다",
    (additionalAmount) => {
      expect(calculateFinalSaleAmount(150000, additionalAmount, 5000)).toBe(
        145000 + additionalAmount,
      );
    },
  );

  it("최근 5분 완전 유사는 강한 경고, 같은 날 같은 상품은 약한 경고다", () => {
    const now = new Date("2026-07-13T10:05:00Z").getTime();
    expect(
      duplicateWarningLevel(
        {
          createdAt: "2026-07-13T10:03:00Z",
          saleDate: "2026-07-13",
          businessUnitId: "unit",
          paidAmount: 30000,
        },
        { now, today: "2026-07-13", businessUnitId: "unit", paidAmount: 30000 },
      ),
    ).toBe("strong");
    expect(
      duplicateWarningLevel(
        {
          createdAt: "2026-07-13T01:00:00Z",
          saleDate: "2026-07-13",
          businessUnitId: "unit",
          paidAmount: 20000,
        },
        { now, today: "2026-07-13", businessUnitId: "unit", paidAmount: 30000 },
      ),
    ).toBe("weak");
  });
});
