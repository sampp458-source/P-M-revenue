import { describe, expect, it } from "vitest";
import {
  buildSalePartyUpdate,
  findCustomerPhoneDuplicate,
  findDogNameDuplicate,
  hasCustomerIdentity,
  normalizeCustomerPhone,
} from "./customerIdentity";

describe("customer identity", () => {
  it("이름만 있어도 보호자 등록 조건을 충족한다", () => {
    expect(hasCustomerIdentity("김철수", "")).toBe(true);
  });

  it("연락처만 있어도 보호자 등록 조건을 충족한다", () => {
    expect(hasCustomerIdentity("", "010-1234-5678")).toBe(true);
  });

  it("이름과 연락처가 모두 있으면 등록 조건을 충족한다", () => {
    expect(hasCustomerIdentity("김철수", "010-1234-5678")).toBe(true);
  });

  it("공백만 있거나 둘 다 비어 있으면 등록을 차단한다", () => {
    expect(hasCustomerIdentity("", "")).toBe(false);
    expect(hasCustomerIdentity("  ", "  ")).toBe(false);
  });

  it("연락처의 숫자만 비교해 중복 보호자를 찾는다", () => {
    const customers = [
      { id: "customer-1", name: "김철수", phone: "010-1234-5678" },
    ];
    expect(normalizeCustomerPhone("010 1234 5678")).toBe("01012345678");
    expect(findCustomerPhoneDuplicate(customers, "01012345678")?.id).toBe(
      "customer-1",
    );
  });

  it("같은 보호자 아래 같은 반려견명만 중복으로 본다", () => {
    const dogs = [
      { id: "dog-1", customerId: "customer-1", name: "보리" },
    ];
    expect(findDogNameDuplicate(dogs, "customer-1", " 보리 ")?.id).toBe(
      "dog-1",
    );
    expect(findDogNameDuplicate(dogs, "customer-2", "보리")).toBeNull();
  });

  it("고객 연결 UPDATE에는 금액과 결제 필드를 포함하지 않는다", () => {
    expect(buildSalePartyUpdate("customer-1", "dog-1")).toEqual({
      customer_id: "customer-1",
      dog_id: "dog-1",
      customer_name: null,
      customer_phone: null,
      dog_name: null,
    });
    expect(Object.keys(buildSalePartyUpdate("", ""))).not.toContain(
      "paid_amount",
    );
  });
});
