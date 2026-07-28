import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(resolve(import.meta.dirname, "../App.tsx"), "utf8");
const calendarSource = readFileSync(
  resolve(import.meta.dirname, "./OperationsCalendarFoundation.tsx"),
  "utf8",
);
const todaySource = readFileSync(
  resolve(import.meta.dirname, "./OperationsToday.tsx"),
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

  it("provides a responsive Today layout without querying Finance or Supabase", () => {
    expect(appSource).toContain("OperationsTodayPage");
    expect(todaySource).toContain("TodayScheduleSection");
    expect(todaySource).toContain("TodaySummary");
    expect(todaySource).toContain("TodayChecklist");
    expect(todaySource).toContain("TodayEmptyState");
    expect(todaySource).toContain("md:grid-cols-");
    expect(todaySource).toContain("onOpenDogProfile");
    expect(todaySource).not.toContain("supabase");
    expect(todaySource).not.toContain("sale_payments");
    expect(todaySource).not.toContain("sale_refunds");
  });
});
