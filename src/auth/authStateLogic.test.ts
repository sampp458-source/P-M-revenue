import { describe, expect, it } from "vitest";
import {
  hasAuthIdentityChanged,
  safeReturnTo,
  shouldIgnoreInitialEmptySession,
} from "./authStateLogic";

describe("auth state logic", () => {
  it("같은 사용자의 토큰 갱신은 인증 화면을 다시 로딩하지 않는다", () => {
    expect(hasAuthIdentityChanged("user-1", "user-1")).toBe(false);
  });

  it("로그인·로그아웃 또는 사용자 교체는 인증 정보를 다시 확인한다", () => {
    expect(hasAuthIdentityChanged(null, "user-1")).toBe(true);
    expect(hasAuthIdentityChanged("user-1", null)).toBe(true);
    expect(hasAuthIdentityChanged("user-1", "user-2")).toBe(true);
  });

  it("초기 세션 조회 전의 빈 인증 이벤트는 경로를 잃지 않도록 무시한다", () => {
    expect(shouldIgnoreInitialEmptySession(false, null)).toBe(true);
    expect(shouldIgnoreInitialEmptySession(false, "user-1")).toBe(false);
    expect(shouldIgnoreInitialEmptySession(true, null)).toBe(false);
  });

  it("보호 경로와 query는 유지하고 외부 및 인증 경로는 기본 화면으로 제한한다", () => {
    expect(safeReturnTo("/products")).toBe("/products");
    expect(safeReturnTo("/sales?detail=sale-1&page=2")).toBe("/sales?detail=sale-1&page=2");
    expect(safeReturnTo("https://example.com")).toBe("/dashboard");
    expect(safeReturnTo("//example.com")).toBe("/dashboard");
    expect(safeReturnTo("/login")).toBe("/dashboard");
  });
});
