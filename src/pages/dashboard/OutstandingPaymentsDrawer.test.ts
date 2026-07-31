import { describe, expect, it } from "vitest";
import {
  maskedCollectionPhone,
  outstandingAgeLabel,
  outstandingElapsedDays,
} from "./OutstandingPaymentsDrawer";

describe("수금 대기 표시", () => {
  it("전체 전화번호를 노출하지 않고 뒤 4자리만 표시한다", () => {
    expect(maskedCollectionPhone("01086095678")).toBe("010-****-5678");
    expect(maskedCollectionPhone("010-8609-6029")).toBe("010-****-6029");
    expect(maskedCollectionPhone("12345")).toBeNull();
  });

  it("미수 발생일을 기준으로 경과일을 계산한다", () => {
    expect(outstandingElapsedDays("2026-07-01", "2026-07-31")).toBe(30);
    expect(outstandingElapsedDays("2026-07-31", "2026-07-31")).toBe(0);
  });

  it("경과일 단계는 텍스트만으로도 구분된다", () => {
    expect(outstandingAgeLabel(3)).toBe("D+3");
    expect(outstandingAgeLabel(4)).toBe("D+4 · 주의");
    expect(outstandingAgeLabel(8)).toBe("D+8 · 장기 대기");
  });
});
