import { describe, expect, it } from "vitest";
import { canManageOperationSchedule, type OperationRole } from "./operationsScheduleRepository";
import { canOperateHotel } from "./hotelOperationCapabilities";

const ordinary = { createdBy: "staff-a", assignees: [] };
const hotel = { ...ordinary, businessUnitCode: "hotel" as const, hotelStayId: "stay", hotelEventKind: "check_in" as const };

describe("canonical Hotel cross-staff permission", () => {
  it.each<OperationRole>(["owner", "manager", "staff"])("permits %s without creator or assignee ownership", role => {
    expect(canManageOperationSchedule(hotel, "staff-b", role)).toBe(true);
    expect(canManageOperationSchedule({ ...hotel, hotelEventKind: "check_out" }, "staff-b", role)).toBe(true);
    expect(canOperateHotel(role)).toBe(true);
  });
  it("does not open ordinary Calendar or unlinked Hotel events", () => {
    for (const schedule of [ordinary, { ...hotel, hotelStayId: null }, { ...hotel, hotelEventKind: null },
      { ...hotel, businessUnitCode: "training" as const }, { ...hotel, archivedAt: "2026-09-01" }]) {
      expect(canManageOperationSchedule(schedule, "staff-b", "staff")).toBe(false);
    }
  });
  it("requires an active Operations role for the Hotel exception", () => {
    expect(canManageOperationSchedule(hotel, "staff-b", null)).toBe(false);
    expect(canManageOperationSchedule(hotel, null, "staff")).toBe(false);
  });
  it("retains ordinary creator, assignee and manager authority", () => {
    expect(canManageOperationSchedule(ordinary, "staff-a", "staff")).toBe(true);
    expect(canManageOperationSchedule({ ...ordinary, assignees: [{ id: "staff-b", name: null }] }, "staff-b", "staff")).toBe(true);
    expect(canManageOperationSchedule(ordinary, "staff-b", "manager")).toBe(true);
  });
});
