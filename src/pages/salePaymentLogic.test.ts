import { describe, expect, it } from "vitest";
import { isSplitPayment, normalizePaymentRows, paymentRowsTotal } from "./salePaymentLogic";

describe("sale payment logic", () => {
  it("0원 행을 제외하고 같은 수단을 합산한다", () => {
    expect(normalizePaymentRows([
      { method: "cash", amount: 200_000 },
      { method: "cash", amount: 50_000 },
      { method: "card", amount: 0 },
    ])).toEqual([{ method: "cash", amount: 250_000 }]);
  });

  it("분할결제 합계를 계산한다", () => {
    const rows = [
      { method: "cash" as const, amount: 200_000 },
      { method: "transfer" as const, amount: 100_000 },
      { method: "card" as const, amount: 600_000 },
    ];
    expect(paymentRowsTotal(rows)).toBe(900_000);
    expect(isSplitPayment(rows)).toBe(true);
  });
});
