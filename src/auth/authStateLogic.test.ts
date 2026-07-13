import { describe, expect, it } from "vitest";
import { hasAuthIdentityChanged } from "./authStateLogic";

describe("auth state logic", () => {
  it("같은 사용자의 토큰 갱신은 인증 화면을 다시 로딩하지 않는다", () => {
    expect(hasAuthIdentityChanged("user-1", "user-1")).toBe(false);
  });

  it("로그인·로그아웃 또는 사용자 교체는 인증 정보를 다시 확인한다", () => {
    expect(hasAuthIdentityChanged(null, "user-1")).toBe(true);
    expect(hasAuthIdentityChanged("user-1", null)).toBe(true);
    expect(hasAuthIdentityChanged("user-1", "user-2")).toBe(true);
  });
});
