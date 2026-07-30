import { describe, expect, it } from "vitest";
import { phoneLast4 } from "./phone";

describe("phoneLast4", () => {
  it("returns only the final four digits without exposing the full number", () => {
    expect(phoneLast4("010-8609-6029")).toBe("6029");
    expect(phoneLast4("01086096029")).toBe("6029");
    expect(phoneLast4("123")).toBe("123");
  });
});
