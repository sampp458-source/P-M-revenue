import { describe, expect, it } from "vitest";
import { toLongStayRepositoryError } from "./longStayHotelRepository";

describe("Long Stay repository error presentation", () => {
  it.each([
    ["40001", "다른 사용자가 먼저 변경했습니다. 최신 상태를 다시 불러왔습니다."],
    ["PT409", "다른 사용자가 먼저 변경했습니다. 최신 상태를 다시 불러왔습니다."],
    ["23514", "현재 객실 수용 가능 범위를 초과했습니다. 다른 객실을 확인해 주세요."],
    ["23P01", "선택한 객실은 이미 사용 중입니다. 다른 객실을 선택해 주세요."],
  ])("maps %s to an actionable message", (code, expected) => {
    expect(toLongStayRepositoryError({ code, message: "raw database error" }).message).toBe(expected);
  });

  it("keeps raw diagnostics internal for unexpected failures", () => {
    const error = toLongStayRepositoryError({
      code: "57014",
      message: "canceling statement due to user request",
      details: "technical detail",
    });

    expect(error.message).toBe("네트워크 상태를 확인한 뒤 다시 시도해 주세요.");
    expect(error.message).not.toContain("canceling statement");
    expect(error.original?.message).toContain("canceling statement");
  });
});
