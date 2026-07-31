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
    expect(todaySource).toContain("fetchOperationSchedulesForDay");
    expect(todaySource).toContain("TodaySummary");
    expect(todaySource).toContain("TodayAlerts");
    expect(todaySource).toContain("ScheduleFormModal");
    expect(todaySource).toContain("ScheduleDetailModal");
    expect(todaySource).toContain("md:grid-cols-");
    expect(todaySource).toContain("dogId=");
    expect(todaySource).toContain("customerId=");
    expect(todaySource).not.toContain("supabase");
    expect(todaySource).not.toContain("previewSchedules");
    expect(todaySource).not.toContain("sale_payments");
    expect(todaySource).not.toContain("sale_refunds");
  });

  it("keeps the single schedule form focused on MVP fields", () => {
    expect(todaySource).toContain('<Field label="제목" required>');
    expect(todaySource).toContain('<Field label="날짜" required>');
    expect(todaySource).toContain('<SearchSelect');
    expect(todaySource).toContain('label="담당자"');
    expect(todaySource).toContain('label="반려견"');
    expect(todaySource).toContain('label="보호자"');
    expect(todaySource).toContain("formatPhoneForDisplay(customer?.phone)");
    expect(todaySource).not.toContain("phoneLast4");
    expect(todaySource).toContain('<Field label="일정 유형">');
    expect(todaySource).toContain("선택 안 함 · 기타로 저장");
    expect(todaySource).not.toContain('label="사업부 Calendar"');
  });

  it("disables but preserves manual times while all-day is selected", () => {
    expect(todaySource).toContain("disabled={form.allDay}");
    expect(todaySource).toContain("required={!form.allDay}");
    expect(todaySource).not.toContain("{!form.allDay && (");
  });

  it("auto-generates a new schedule title without overriding manual edits", () => {
    expect(todaySource).toContain("defaultOperationScheduleTitle");
    expect(todaySource).toContain('editing === "new" && !titleManuallyEdited');
    expect(todaySource).toContain("onTitleManuallyEdited(true)");
  });

  it("keeps Today cards focused on color, time, title, and assignees", () => {
    const scheduleRow = todaySource.slice(
      todaySource.indexOf("function ScheduleRow"),
      todaySource.indexOf("function TodaySummary"),
    );
    expect(scheduleRow).toContain("schedule.calendarColor");
    expect(scheduleRow).toContain("schedulePrimaryAssignee");
    expect(scheduleRow).toContain("schedule.title");
    expect(scheduleRow).toContain("schedule.assignees");
    expect(scheduleRow).not.toContain("schedule.calendarName");
    expect(scheduleRow).not.toContain("schedule.scheduleTypeName");
    expect(scheduleRow).not.toContain("schedule.customers");
    expect(scheduleRow).not.toContain("schedule.dogs");
  });
});
