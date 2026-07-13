import { describe, expect, it } from "vitest";
import {
  clearAllSaleDrafts,
  parseSaleDraft,
  readSaleDraft,
  saleInputFingerprint,
  saleDraftKey,
  writeSaleDraft,
  type SaleRegistrationFormState,
} from "./saleRegistrationDraft";

const form: SaleRegistrationFormState = {
  saleDate: "2026-07-13",
  businessUnitId: "unit-1",
  customerId: "customer-1",
  dogId: "dog-1",
  categoryId: "",
  productId: "product-1",
  quantity: 3,
  unitPrice: 50000,
  originalAmount: 150000,
  additionalAmount: 10000,
  discountAmount: 20000,
  paidAmount: 120000,
  refundAmount: 0,
  outstandingAmount: 20000,
  adjustmentNote: "현장 조정",
  paymentMethod: "card",
  customerType: "renewal",
  staffId: "staff-1",
  memo: "메모",
};

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

describe("sale registration draft", () => {
  it("사용자별 versioned key에 저장하고 복원한다", () => {
    const storage = memoryStorage();
    writeSaleDraft(storage, "user-1", {
      form,
      saleReference: { customerName: "김철수", phone: "010-1234-5678", dogName: "보리" },
      ui: { customerSectionOpen: true, advancedOpen: true, paidAmountEdited: true },
    });

    const restored = readSaleDraft(storage, "user-1");
    expect(storage.getItem(saleDraftKey("user-2"))).toBeNull();
    expect(restored?.form.productId).toBe("product-1");
    expect(restored?.saleReference.phone).toBe("010-1234-5678");
    expect(restored?.ui.advancedOpen).toBe(true);
  });

  it("수량과 금액을 안전하게 정규화하고 미수금을 다시 계산한다", () => {
    const restored = parseSaleDraft(
      JSON.stringify({
        version: 1,
        updatedAt: "2026-07-13T12:00:00.000Z",
        form: {
          ...form,
          quantity: 0,
          unitPrice: -3,
          additionalAmount: 5000,
          discountAmount: 0,
          paidAmount: 1000,
        },
      }),
      new Date("2026-07-13T13:00:00.000Z").getTime(),
    );
    expect(restored?.form.quantity).toBe(1);
    expect(restored?.form.unitPrice).toBe(0);
    expect(restored?.form.originalAmount).toBe(0);
    expect(restored?.form.outstandingAmount).toBe(4000);
  });

  it("손상되거나 version이 다른 draft는 삭제한다", () => {
    const storage = memoryStorage();
    storage.setItem(saleDraftKey("user-1"), "{broken");
    expect(readSaleDraft(storage, "user-1")).toBeNull();
    expect(storage.getItem(saleDraftKey("user-1"))).toBeNull();

    storage.setItem(saleDraftKey("user-1"), JSON.stringify({ version: 2, form }));
    expect(readSaleDraft(storage, "user-1")).toBeNull();
    expect(storage.getItem(saleDraftKey("user-1"))).toBeNull();
  });

  it("24시간이 지난 draft는 복원하지 않고 입력 기준선은 UI 상태를 제외한다", () => {
    const oldDraft = JSON.stringify({
      version: 1,
      updatedAt: "2026-07-12T00:00:00.000Z",
      form,
      saleReference: { customerName: "", phone: "", dogName: "" },
    });
    expect(
      parseSaleDraft(oldDraft, new Date("2026-07-13T00:00:01.000Z").getTime()),
    ).toBeNull();
    const baseline = saleInputFingerprint(form, {
      customerName: "",
      phone: "",
      dogName: "",
    });
    expect(
      saleInputFingerprint(
        { ...form, paidAmount: form.paidAmount + 1 },
        { customerName: "", phone: "", dogName: "" },
      ),
    ).not.toBe(baseline);
  });

  it("로그아웃 정리는 모든 사용자의 매출 draft만 제거한다", () => {
    const storage = memoryStorage();
    storage.setItem(saleDraftKey("user-1"), "draft");
    storage.setItem(saleDraftKey("user-2"), "draft");
    storage.setItem("other", "keep");
    clearAllSaleDrafts(storage);
    expect(storage.getItem(saleDraftKey("user-1"))).toBeNull();
    expect(storage.getItem(saleDraftKey("user-2"))).toBeNull();
    expect(storage.getItem("other")).toBe("keep");
  });
});
