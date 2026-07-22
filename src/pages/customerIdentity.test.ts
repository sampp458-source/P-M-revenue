import { describe, expect, it } from "vitest";
import { hasCustomerIdentity } from "./customerIdentity";

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
});
