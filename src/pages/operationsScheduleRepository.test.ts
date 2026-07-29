import { describe, expect, it } from "vitest";
import {
  calculateOperationTodaySummary,
  compactDogNames,
  compactNames,
  defaultOperationCalendarId,
  defaultOperationScheduleWindow,
  defaultOperationScheduleTypeId,
  mergeOperationTodaySchedule,
  nextSeoulDate,
  seoulDateKey,
  toSeoulInstant,
} from "./operationsScheduleRepository";

describe("Operations schedule date and display helpers", () => {
  it("creates UTC instants from Seoul local date and time", () => {
    expect(toSeoulInstant("2026-07-29", "09:00")).toBe(
      "2026-07-29T00:00:00.000Z",
    );
    expect(toSeoulInstant("2026-07-29", "23:30")).toBe(
      "2026-07-29T14:30:00.000Z",
    );
  });

  it("uses an exclusive next-day boundary for all-day schedules", () => {
    expect(nextSeoulDate("2026-07-29")).toBe("2026-07-30");
    expect(toSeoulInstant(nextSeoulDate("2026-07-29"), "00:00")).toBe(
      "2026-07-29T15:00:00.000Z",
    );
  });

  it("defaults to the next half hour and a one-hour duration in Seoul", () => {
    expect(
      defaultOperationScheduleWindow(
        new Date("2026-07-30T05:10:00.000Z"),
      ),
    ).toEqual({
      date: "2026-07-30",
      startTime: "14:30",
      endDate: "2026-07-30",
      endTime: "15:30",
    });
    expect(
      defaultOperationScheduleWindow(
        new Date("2026-07-30T05:45:00.000Z"),
      ),
    ).toEqual({
      date: "2026-07-30",
      startTime: "15:00",
      endDate: "2026-07-30",
      endTime: "16:00",
    });
    expect(
      defaultOperationScheduleWindow(
        new Date("2026-07-30T05:30:00.000Z"),
      ).startTime,
    ).toBe("15:00");
  });

  it("rolls late-night defaults into the next Seoul date safely", () => {
    expect(
      defaultOperationScheduleWindow(
        new Date("2026-07-30T13:45:00.000Z"),
      ),
    ).toEqual({
      date: "2026-07-30",
      startTime: "23:00",
      endDate: "2026-07-31",
      endTime: "00:00",
    });
    expect(
      defaultOperationScheduleWindow(
        new Date("2026-07-30T14:45:00.000Z"),
      ),
    ).toEqual({
      date: "2026-07-31",
      startTime: "00:00",
      endDate: "2026-07-31",
      endTime: "01:00",
    });
  });

  it("uses the common calendar and 기타 type as the MVP defaults", () => {
    expect(
      defaultOperationCalendarId([
        {
          id: "daycare",
          name: "유치원",
          scopeType: "business_unit",
          color: "#52B8D0",
          sortOrder: 10,
          businessUnitName: "유치원",
        },
        {
          id: "common",
          name: "공통",
          scopeType: "common",
          color: "#5B7FA3",
          sortOrder: 40,
          businessUnitName: null,
        },
      ]),
    ).toBe("common");
    expect(
      defaultOperationScheduleTypeId([
        { id: "class", name: "수업", color: "#4568B2", sortOrder: 10 },
        { id: "other", name: "기타", color: "#8A96A6", sortOrder: 80 },
      ]),
    ).toBe("other");
  });

  it("formats the date key in Asia/Seoul instead of browser local time", () => {
    expect(seoulDateKey(new Date("2026-07-28T15:30:00.000Z"))).toBe(
      "2026-07-29",
    );
  });

  it("compacts multiple dog and person names", () => {
    expect(
      compactDogNames([
        { id: "1", name: "가을", customerId: null },
        { id: "2", name: "초코", customerId: null },
        { id: "3", name: "토비", customerId: null },
      ]),
    ).toBe("가을 외 2마리");
    expect(
      compactNames(
        [
          { name: "이화인" },
          { name: "김직원" },
        ],
        "담당자 미정",
      ),
    ).toBe("이화인 외 1명");
    expect(compactNames([], "담당자 미정")).toBe("담당자 미정");
  });

  it("keeps total and business-calendar counts consistent", () => {
    const base = {
      id: "schedule",
      calendarId: "calendar",
      calendarName: "이름이 바뀐 캘린더",
      calendarColor: "#4568B2",
      calendarScope: "business_unit" as const,
      businessUnitName: "교육센터",
      scheduleTypeId: "type",
      scheduleTypeName: "수업",
      scheduleTypeColor: "#4568B2",
      title: "수업",
      memo: null,
      startsAt: "2026-07-29T00:00:00.000Z",
      endsAt: "2026-07-29T01:00:00.000Z",
      allDay: false,
      status: "scheduled" as const,
      version: 1,
      requestId: "request",
      createdBy: "profile",
      createdByName: "직원",
      createdAt: "2026-07-29T00:00:00.000Z",
      updatedBy: "profile",
      updatedByName: "직원",
      updatedAt: "2026-07-29T00:00:00.000Z",
      archivedAt: null,
      assignees: [],
      dogs: [],
      customers: [],
    };
    const result = calculateOperationTodaySummary([
      { ...base, id: "1", businessUnitCode: "daycare" },
      { ...base, id: "2", businessUnitCode: "training" },
      { ...base, id: "3", businessUnitCode: "hotel" },
      {
        ...base,
        id: "4",
        businessUnitCode: null,
        calendarScope: "common",
      },
    ]);
    expect(result).toEqual({
      total: 4,
      counts: { daycare: 1, training: 1, hotel: 1, common: 1 },
      countSum: 4,
    });
  });

  it("merges RPC results into Today without refetching option data", () => {
    const base = {
      id: "schedule",
      calendarId: "calendar",
      calendarName: "공통",
      calendarColor: "#5B7FA3",
      calendarScope: "common" as const,
      businessUnitCode: null,
      businessUnitName: null,
      scheduleTypeId: "other",
      scheduleTypeName: "기타",
      scheduleTypeColor: "#8A96A6",
      title: "오전 회의",
      memo: null,
      startsAt: "2026-07-29T00:00:00.000Z",
      endsAt: "2026-07-29T01:00:00.000Z",
      allDay: false,
      status: "scheduled" as const,
      version: 1,
      requestId: "request",
      createdBy: "profile",
      createdByName: "직원",
      createdAt: "2026-07-28T23:00:00.000Z",
      updatedBy: "profile",
      updatedByName: "직원",
      updatedAt: "2026-07-28T23:00:00.000Z",
      archivedAt: null,
      assignees: [{ id: "profile", name: "직원" }],
      dogs: [],
      customers: [],
    };

    expect(mergeOperationTodaySchedule([], base, "2026-07-29")).toEqual([
      base,
    ]);
    expect(
      mergeOperationTodaySchedule(
        [base],
        { ...base, status: "cancelled", version: 2 },
        "2026-07-29",
      ),
    ).toEqual([]);
    expect(
      mergeOperationTodaySchedule(
        [base],
        { ...base, archivedAt: "2026-07-29T02:00:00.000Z", version: 2 },
        "2026-07-29",
      ),
    ).toEqual([]);
  });
});
