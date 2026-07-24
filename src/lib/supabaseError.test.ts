import { describe, expect, it } from "vitest";
import { partyMutationError } from "./supabaseError";

describe("partyMutationError", () => {
  it("활성 계정, 타 직원, 마감 월 오류를 업무 문구로 구분한다", () => {
    expect(
      partyMutationError(
        { message: "승인된 활성 계정만 고객 정보를 연결할 수 있습니다." },
        "fallback",
      ),
    ).toBe("승인되지 않았거나 비활성 처리된 계정입니다.");
    expect(
      partyMutationError(
        { message: "다른 직원이 등록한 매출은 수정할 수 없습니다." },
        "fallback",
      ),
    ).toBe("다른 직원이 등록한 매출은 수정할 수 없습니다.");
    expect(
      partyMutationError(
        { message: "마감된 월의 매출은 변경할 수 없습니다." },
        "fallback",
      ),
    ).toBe("마감된 월의 매출은 수정할 수 없습니다.");
  });

  it("일반 RLS 오류는 원문 대신 계정 상태 확인 문구를 표시한다", () => {
    expect(
      partyMutationError(
        {
          code: "42501",
          message: "new row violates row-level security policy",
        },
        "fallback",
      ),
    ).toBe(
      "현재 계정의 업무 권한을 확인할 수 없습니다. 계정 상태를 확인해 주세요.",
    );
  });
});
