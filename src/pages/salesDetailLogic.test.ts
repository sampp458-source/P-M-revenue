import { describe, expect, it } from "vitest";
import {
  detailPaymentRows,
  formatQuantityWithUnit,
  refundDetailKinds,
} from "./salesDetailLogic";

describe("salesDetailLogic", () => {
  it("수량과 단위를 한 번만 결합한다", () => {
    expect(formatQuantityWithUnit(3, "박")).toBe("3박");
    expect(formatQuantityWithUnit(5, "회")).toBe("5회");
    expect(formatQuantityWithUnit(2, null)).toBe("2");
  });

  it("결제 원장이 없으면 기존 단일결제 값을 한 행으로 표시한다", () => {
    expect(detailPaymentRows([], "card", 270_000)).toEqual([
      { method: "card", amount: 270_000 },
    ]);
  });

  it("분할결제는 수단별 정규화 행을 유지한다", () => {
    expect(
      detailPaymentRows(
        [
          { method: "card", amount: 600_000 },
          { method: "transfer", amount: 100_000 },
          { method: "cash", amount: 200_000 },
        ],
        "card",
        900_000,
      ),
    ).toEqual([
      { method: "card", amount: 600_000 },
      { method: "transfer", amount: 100_000 },
      { method: "cash", amount: 200_000 },
    ]);
  });

  it("전체환불 거래의 마지막 유효 환불만 전체환불로 표시한다", () => {
    const kinds = refundDetailKinds(
      [
        { id: "refund-1", voidedAt: null },
        { id: "refund-2", voidedAt: null },
        { id: "refund-3", voidedAt: "2026-07-20T00:00:00Z" },
      ],
      "full_refund",
    );
    expect(kinds.get("refund-1")).toBe("partial");
    expect(kinds.get("refund-2")).toBe("full");
    expect(kinds.get("refund-3")).toBe("voided");
  });
});
