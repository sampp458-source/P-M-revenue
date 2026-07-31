import { describe, expect, it } from "vitest";
import { formatPhoneForDisplay, phoneLast4 } from "./phone";

describe("phoneLast4", () => {
  it("returns only the final four digits without exposing the full number", () => {
    expect(phoneLast4("010-8609-6029")).toBe("6029");
    expect(phoneLast4("01086096029")).toBe("6029");
    expect(phoneLast4("123")).toBe("123");
  });
});

describe("formatPhoneForDisplay", () => {
  it("formats valid stored numbers without forcing malformed values", () => {
    expect(formatPhoneForDisplay("01012345678")).toBe("010-1234-5678");
    expect(formatPhoneForDisplay("010-1234-5678")).toBe("010-1234-5678");
    expect(formatPhoneForDisplay("12345")).toBe("12345");
    expect(formatPhoneForDisplay("02123456789")).toBe("02123456789");
    expect(formatPhoneForDisplay(null)).toBe("");
  });
});
