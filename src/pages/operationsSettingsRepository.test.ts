import { describe, expect, it } from "vitest";
import { mapOperationCalendar } from "./operationsSettingsRepository";

describe("Operations settings repository", () => {
  it("maps a business calendar without mixing its scope with schedule type", () => {
    expect(
      mapOperationCalendar({
        id: "calendar-1",
        name: "유치원",
        scope_type: "business_unit",
        color: "#52B8D0",
        sort_order: 10,
        business_units: { code: "daycare", name: "유치원" },
      }),
    ).toEqual({
      id: "calendar-1",
      name: "유치원",
      scopeType: "business_unit",
      color: "#52B8D0",
      sortOrder: 10,
      businessUnitCode: "daycare",
      businessUnitName: "유치원",
    });
  });

  it("handles Supabase relation arrays and shared calendars", () => {
    expect(
      mapOperationCalendar({
        id: "calendar-2",
        name: "공통",
        scope_type: "common",
        color: "#5B7FA3",
        sort_order: 40,
        business_units: [],
      }).businessUnitName,
    ).toBeNull();
  });
});
