import { afterEach, describe, expect, it, vi } from "vitest";
import { canManageOperationSchedule } from "./operationsScheduleRepository";

const openDaycare = {
  createdBy: "creator",
  assignees: [],
  businessUnitCode: "hotel" as const,
  status: "scheduled" as const,
  startsAt: "2026-11-27T00:00:00+09:00",
  daycareReservation: true,
  daycareOperation: { lifecycleStatus: "scheduled" as const, checkedInAt: null, checkedOutAt: null },
};

afterEach(() => vi.useRealTimers());

describe("hotel daycare handoff on the calendar", () => {
  it("allows active hotel operations roles for linked open daycare, including legacy daycare calendars", () => {
    vi.useFakeTimers().setSystemTime(new Date("2026-11-26T15:00:00Z"));
    for (const calendar of ["hotel", "daycare"] as const) {
      for (const lifecycle of ["scheduled", "checked_in"] as const) {
        for (const role of ["staff", "manager", "owner"] as const) {
          expect(canManageOperationSchedule({
            ...openDaycare,
            businessUnitCode: calendar,
            daycareOperation: { ...openDaycare.daycareOperation, lifecycleStatus: lifecycle },
          }, "relief-staff", role)).toBe(true);
        }
      }
    }
  });

  it("does not extend staff visibility of edit controls for generic, invalid, historical, or closed entries", () => {
    vi.useFakeTimers().setSystemTime(new Date("2026-11-26T15:00:00Z"));
    for (const schedule of [
      { ...openDaycare, daycareReservation: false },
      { ...openDaycare, businessUnitCode: "training" as const },
      { ...openDaycare, daycareOperation: null },
      { ...openDaycare, startsAt: "2026-11-26T23:59:00+09:00" },
      { ...openDaycare, startsAt: "invalid" },
      { ...openDaycare, archivedAt: "2026-11-27" },
      { ...openDaycare, status: "cancelled" as const },
      { ...openDaycare, daycareOperation: { ...openDaycare.daycareOperation, lifecycleStatus: "completed" as const } },
    ]) expect(canManageOperationSchedule(schedule, "relief-staff", "staff")).toBe(false);
    expect(canManageOperationSchedule(openDaycare, "relief-staff", null)).toBe(false);
    expect(canManageOperationSchedule(openDaycare, null, "staff")).toBe(false);
  });
});
