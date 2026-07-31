import { describe, expect, it } from "vitest";
import { signupFailureMessage } from "./AuthContext";

describe("signup failure messages", () => {
  it("maps common Auth failures to safe Korean guidance", () => {
    expect(
      signupFailureMessage({ status: 429, message: "rate limit" }),
    ).toContain("요청이 너무 많습니다");
    expect(
      signupFailureMessage({ code: "user_already_exists" }),
    ).toContain("이미 가입");
    expect(
      signupFailureMessage({ message: "이미 사용 중인 휴대폰 번호입니다." }),
    ).toContain("휴대전화 번호");
    expect(
      signupFailureMessage({ message: "Database error saving new user" }),
    ).toContain("계정 정보 저장");
  });

  it("keeps an unknown server error actionable without exposing details", () => {
    expect(signupFailureMessage({ code: "server_error" })).toBe(
      "계정 신청을 처리하지 못했습니다. 관리자에게 문의해 주세요. (오류 코드: server_error)",
    );
  });
});
