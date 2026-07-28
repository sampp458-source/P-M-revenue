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
    expect(appSource).toContain('title="운영"');
    expect(appSource).toContain('title="회계"');
    expect(appSource).toContain('title="고객"');
  });

  it("keeps the existing sign-in and preference behavior", () => {
    expect(appSource).toContain("await signIn(email, password)");
    expect(appSource).toContain("pm-saved-login-email");
    expect(appSource).toContain("pm-auto-login-enabled");
    expect(appSource).toContain('autoComplete="username"');
    expect(appSource).toContain('autoComplete="current-password"');
  });

  it("provides accessible loading and premium focus states", () => {
    expect(appSource).toContain('role="status"');
    expect(appSource).toContain('aria-live="polite"');
    expect(appSource).toContain('aria-busy={submitting}');
    expect(styles).toContain(".login-input:focus");
    expect(styles).toContain(".login-checkbox:focus-visible");
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
  });
});
