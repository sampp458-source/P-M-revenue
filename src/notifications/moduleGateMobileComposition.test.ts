import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./notifications.css", import.meta.url), "utf8");
const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const mobile = css.slice(css.indexOf("/* Module Gate only:"));

describe("Module Gate mobile composition boundary", () => {
  it("keeps the compact grid and safe-area spacing below 640px", () => {
    expect(mobile).toContain("@media (max-width: 639px)");
    expect(mobile).toContain("env(safe-area-inset-top, 0px) + 12px");
    expect(mobile).toContain("column-gap: 14px");
    expect(mobile).toContain("grid-template-columns: 44px minmax(0, 1fr) 44px");
    expect(mobile).toContain("width: 44px");
    expect(mobile).toContain("height: 44px");
    expect(mobile).not.toMatch(/position:\s*absolute|margin[^;]*-\d/);
  });
  it("scopes every new rule to the Module Gate, leaving cards and internal headers intact", () => {
    const selectors = [...mobile.matchAll(/([^{}]+)\{/g)].map(match => match[1].trim()).filter(value => !value.includes("@media"));
    expect(selectors.length).toBeGreaterThan(0);
    selectors.forEach(selector => expect(selector).toContain(".pm-module-gate"));
    expect(mobile).not.toMatch(/pn-header-tools|module-gate-card|pn-bell-count/);
  });
  it("preserves one live Bell and the existing brand and module actions", () => {
    const gate = app.slice(app.indexOf("function ModuleGatePage()"), app.indexOf("function JournalAppLayout()"));
    expect(gate.match(/<NotificationBell\s*\/>/g)).toHaveLength(1);
    expect(gate).toContain('className="mb-8 text-center sm:mb-11"');
    expect(gate).toContain("chooseModule(module.id, moduleHome[module.id])");
    expect(mobile).not.toContain(":has(> .pn-gate-bell:empty)");
  });
});
