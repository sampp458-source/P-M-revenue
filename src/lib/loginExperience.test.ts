import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(
  new URL("../App.tsx", import.meta.url),
  "utf8",
);
const styles = readFileSync(
  new URL("../styles.css", import.meta.url),
  "utf8",
);

describe("P&M OS login experience", () => {
  it("uses the P&M OS brand message instead of a sales template", () => {
    expect(appSource).not.toMatch(/welcome back/i);
    expect(appSource).toContain("회사 운영을");
    expect(appSource).toContain("하나의 시스템으로");
    expect(appSource).toContain("P&amp;M의 모든 업무를 하나에서");
    expect(appSource).toContain("오늘의 업무를 시작하세요");
    expect(appSource).toContain('title="운영"');
    expect(appSource).toContain('title="회계"');
    expect(appSource).toContain('title="고객"');
    expect(appSource).not.toContain("매출을 더 정확하게");
    expect(appSource).not.toContain("3개 사업부 통합");
  });

  it("keeps the existing sign-in and preference behavior", () => {
    expect(appSource).toContain("await signIn(email, password)");
    expect(appSource).toContain("pm-saved-login-email");
    expect(appSource).toContain("pm-auto-login-enabled");
    expect(appSource).toContain('autoComplete="username"');
    expect(appSource).toContain('autoComplete="current-password"');
    expect(appSource).toContain('disabled={submitting}');
  });

  it("provides accessible loading and premium focus states", () => {
    expect(appSource).toContain('role="status"');
    expect(appSource).toContain('aria-live="polite"');
    expect(appSource).toContain('aria-busy={submitting}');
    expect(appSource).toContain('aria-label="계정 도움말"');
    expect(appSource).toContain('className="login-input h-[50px]');
    expect(appSource).toContain('className="login-submit group h-[50px]');
    expect(appSource).toContain("login-mobile-brand");
    expect(appSource).not.toContain("login-submit-arrow");
    expect(styles).toContain(".login-input:focus");
    expect(styles).toContain(".login-input:-webkit-autofill");
    expect(styles).toContain("@media (min-width: 1440px)");
    expect(styles).toContain(".login-checkbox:focus-visible");
    expect(styles).toContain(".login-form-fields > :nth-child(5)");
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
  });
});
