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
const scheduleRepositorySource = readFileSync(
  resolve(import.meta.dirname, "./operationsScheduleRepository.ts"),
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

  it("provides the Operations month calendar and day drawer", () => {
    expect(calendarSource).toContain("fetchOperationSchedulesForRange");
    expect(calendarSource).toContain("<CalendarCell");
    expect(calendarSource).toContain("<DayDrawer");
    expect(calendarSource).toContain('aria-label="이전 달"');
    expect(calendarSource).toContain('aria-label="다음 달"');
    expect(calendarSource).toContain("ScheduleFormModal");
    expect(calendarSource).toContain("ScheduleDetailModal");
    expect(calendarSource).toContain("minimalCalendarMode");
    expect(calendarSource).toContain('archiveLabel="삭제"');
    expect(calendarSource).toContain("schedulePrimaryAssignee");
    expect(calendarSource).toContain("schedules.slice(0, 2)");
    expect(calendarSource).toContain("schedule.memo");
    expect(todaySource).toContain("oneHourScheduleEnd");
    expect(todaySource).toContain("sticky -bottom-5");
    expect(todaySource).toContain("multiple={!minimalCalendarMode}");
    expect(calendarSource).toContain("archiveOperationSchedule");
    expect(calendarSource).not.toContain("supabase");
    expect(calendarSource).not.toContain("useQuery");
    expect(calendarSource).not.toContain("sale_payments");
    expect(calendarSource).not.toContain("sale_refunds");
  });

  it("renders the production Calendar for every Operations member", () => {
    expect(appSource).toContain(
      'path="calendar"\n          element={<OperationsCalendarFoundationPage />}',
    );
    expect(calendarSource).not.toContain("월 보기 기반 준비 완료");
    expect(calendarSource).not.toContain(
      "실제 일정 조회와 캘린더 인터랙션은 다음 Sprint에서 연결됩니다.",
    );
    expect(calendarSource).not.toContain("profile?.role");
    expect(calendarSource).not.toContain("featureFlag");
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
    expect(todaySource).toContain("showAllOnEmpty");
    expect(todaySource).toContain("· 자동 기록");
    expect(todaySource).toContain('Detail label="담당자"');
    expect(todaySource).toContain('Detail label="생성자"');
    expect(todaySource).toContain('label="반려견"');
    expect(todaySource).toContain('label="보호자"');
    expect(todaySource).toContain("formatPhoneForDisplay(customer?.phone)");
    expect(todaySource).not.toContain("phoneLast4");
    expect(todaySource).toContain('<Field label="일정 유형">');
    expect(todaySource).toContain("선택 안 함 · 기타로 저장");
    expect(todaySource).not.toContain('label="사업부 Calendar"');
  });

  it("uses the shared active-staff directory when the optional assignee RPC is unavailable", () => {
    expect(scheduleRepositorySource).toContain(
      'supabase.rpc("get_active_operation_assignees")',
    );
    expect(scheduleRepositorySource).toContain(
      'supabase.rpc("get_active_staff_directory")',
    );
    const fallbackSection = scheduleRepositorySource.slice(
      scheduleRepositorySource.indexOf("if (assigneesResult.error)"),
      scheduleRepositorySource.indexOf(
        "} else {",
        scheduleRepositorySource.indexOf("if (assigneesResult.error)"),
      ),
    );
    expect(fallbackSection).not.toContain('.from("profiles")');
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
