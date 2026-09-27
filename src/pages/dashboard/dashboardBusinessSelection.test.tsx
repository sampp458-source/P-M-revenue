// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BusinessUnitCard } from "./DashboardSections";
import { dashboardThemeMap } from "./dashboardTheme";

afterEach(cleanup);

describe("Dashboard business selection presentation", () => {
  it.each(["daycare", "training", "hotel"] as const)("preserves %s semantics, values and click contract", (code) => {
    const onClick = vi.fn();
    const props = { order: 1, code, name: dashboardThemeMap[code].label, revenue: 120000, receivedAmount: 110000, refundAmount: 10000, outstandingAmount: 10000, onClick };
    const { rerender } = render(<BusinessUnitCard {...props} selected={false} />);
    const button = screen.getByRole("button");
    const content = button.textContent;
    expect(button.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
    rerender(<BusinessUnitCard {...props} selected />);
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.textContent).toBe(content);
    expect(button.closest("section")?.parentElement?.style.getPropertyValue("--pm-theme-accent")).toBe(dashboardThemeMap[code].accent);
  });

  it("scopes the cobalt override to the nested Dashboard button and keeps independent keyboard focus", () => {
    const css = readFileSync("src/finance-design-v2.css", "utf8");
    const block = css.split("/* Dashboard selection belongs")[1];
    const rules = block.match(/[^{}]+\{[^{}]+\}/g) || [];
    expect(rules).toHaveLength(4);
    for (const rule of rules) expect(rule).toContain(".pm-finance-v1.pm-finance-v2.pm-design-d.pm-d-page.pm-dashboard-v1 .pm-d-business-comparison");
    expect(block).toContain(">button[aria-pressed]{background:transparent!important");
    expect(block).toContain("border-color:var(--pm-theme-accent)!important");
    expect(block).toContain(":active{box-shadow:inset 0 0 0 1px var(--pm-theme-accent)!important");
    expect(block).toContain(":focus-visible{outline:2px solid var(--pm-d-brand-cobalt)!important");
    expect(block).toContain("outline-offset:-5px!important");
    expect(block).not.toMatch(/gradient|glow|translate|opacity/);
  });
});
