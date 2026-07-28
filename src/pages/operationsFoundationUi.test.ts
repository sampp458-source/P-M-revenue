import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(resolve(import.meta.dirname, "../App.tsx"), "utf8");
const calendarSource = readFileSync(
  resolve(import.meta.dirname, "./OperationsCalendarFoundation.tsx"),
  "utf8",
);

describe("Operations foundation UI", () => {
  it("exposes Today, Calendar, Schedules, and Settings without changing Finance routes", () => {
    expect(appSource).toContain('to: "/operations/today"');
    expect(appSource).toContain('to: "/operations/calendar"');
    expect(appSource).toContain('to: "/operations/schedules"');
    expect(appSource).toContain('to: "/operations/settings"');
    expect(appSource).toContain('path="schedules"');
    expect(appSource).toContain("OperationsCalendarFoundationPage");
  });

  it("provides accessible month, week, and day placeholder tabs only", () => {
    expect(calendarSource).toContain('id: "month"');
    expect(calendarSource).toContain('id: "week"');
    expect(calendarSource).toContain('id: "day"');
    expect(calendarSource).toContain('role="tablist"');
    expect(calendarSource).toContain('aria-selected={view === id}');
    expect(calendarSource).not.toContain("supabase");
    expect(calendarSource).not.toContain("useQuery");
  });
});
