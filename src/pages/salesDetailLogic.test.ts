import { describe, expect, it } from "vitest";
import {
  detailProductName,
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

  it("단위의 기준 수량 1을 실제 수량과 중복 표시하지 않는다", () => {
    expect(formatQuantityWithUnit(9, "1박")).toBe("9박");
    expect(formatQuantityWithUnit(1, "1박")).toBe("1박");
    expect(formatQuantityWithUnit(4, "1회")).toBe("4회");
    expect(formatQuantityWithUnit(2, "1일")).toBe("2일");
    expect(formatQuantityWithUnit(6, "1개월")).toBe("6개월");
    expect(formatQuantityWithUnit(3, "1건")).toBe("3건");
  });

  it("상품명 끝의 기준 단위를 판매 항목 제목에서 한 번만 제거한다", () => {
    expect(detailProductName("스탠다드 1박", "1박")).toBe("스탠다드");
    expect(detailProductName("유치원 1회", "회")).toBe("유치원");
    expect(detailProductName("호텔 패키지", "박")).toBe("호텔 패키지");
    expect(detailProductName("행동상담회", "회")).toBe("행동상담회");
    expect(detailProductName("1박", "1박")).toBe("1박");
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
