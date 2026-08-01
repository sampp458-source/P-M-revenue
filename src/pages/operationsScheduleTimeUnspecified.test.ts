import { describe, expect, it } from "vitest";
import {
  emptyForm,
  scheduleInputFromForm,
} from "./OperationsToday";
import type { OperationScheduleOptions } from "./operationsScheduleRepository";

const options: OperationScheduleOptions = {
  calendars: [
    {
      id: "common",
      name: "공통",
      scopeType: "common",
      color: "#274C77",
      sortOrder: 1,
      businessUnitName: null,
    },
  ],
  scheduleTypes: [
    {
      id: "other",
      name: "기타",
      color: "#274C77",
      sortOrder: 1,
      calendarIds: ["common"],
    },
  ],
  assignees: [{ id: "staff", name: "직원" }],
  customers: [],
  dogs: [],
};

describe("Operations schedule time-unspecified form", () => {
  it("accepts a date without visible start/end times and stores a separate state", () => {
    const result = scheduleInputFromForm(
      {
        ...emptyForm(),
        calendarId: "common",
        scheduleTypeId: "other",
        date: "2026-08-01",
        startTime: "",
        endDate: "",
        endTime: "",
        title: "보호자 방문",
        assigneeIds: ["staff"],
        timeUnspecified: true,
      },
      options,
    );

    expect(result.error).toBe("");
    expect(result.input).toMatchObject({
      timeUnspecified: true,
      allDay: false,
      startsAt: "2026-08-01T03:00:00.000Z",
      endsAt: "2026-08-01T04:00:00.000Z",
    });
    expect(result.input?.startsAt).not.toContain("T15:00:00.000Z");
  });

  it("requires both times again after switching back to a confirmed time", () => {
    const result = scheduleInputFromForm(
      {
        ...emptyForm(),
        calendarId: "common",
        scheduleTypeId: "other",
        date: "2026-08-01",
        startTime: "",
        endDate: "2026-08-01",
        endTime: "",
        title: "보호자 방문",
        assigneeIds: ["staff"],
        timeUnspecified: false,
      },
      options,
    );

    expect(result.input).toBeNull();
    expect(result.error).toContain("시간");
  });

  it("rejects all-day and time-unspecified at the same time", () => {
    const result = scheduleInputFromForm(
      {
        ...emptyForm(),
        calendarId: "common",
        scheduleTypeId: "other",
        date: "2026-08-01",
        title: "호텔 퇴실",
        assigneeIds: ["staff"],
        allDay: true,
        timeUnspecified: true,
      },
      options,
    );

    expect(result.input).toBeNull();
    expect(result.error).toBe(
      "종일 일정과 시간 미정은 동시에 선택할 수 없습니다.",
    );
  });
});
