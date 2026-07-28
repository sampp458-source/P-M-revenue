import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appUi = readFileSync(
  new URL("../../App.tsx", import.meta.url),
  "utf8",
);
const dashboardUi = readFileSync(
  new URL("./DashboardSections.tsx", import.meta.url),
  "utf8",
);

describe("Dashboard final UI polish", () => {
  it("keeps the sidebar logo compact and section labels readable", () => {
    expect(appUi).toContain('imageClassName="h-32 w-32"');
    expect(appUi).toContain("text-blue-100/55");
    expect(appUi).toContain("app-sidebar-profile mb-4");
  });

  it("starts with the KPI hero without the duplicated criteria summary", () => {
    expect(dashboardUi).not.toContain("현재 적용 기준");
    expect(dashboardUi).not.toContain("rangeLabel:");
    expect(dashboardUi).not.toContain("unitName:");
    expect(dashboardUi).toContain("text-sm xl:justify-end");
  });
});
