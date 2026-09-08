import { describe, expect, it } from "vitest";
import {
  canManageHotelSettings,
  canOperateHotel,
} from "./hotelOperationCapabilities";

describe("Hotel operation capabilities", () => {
  it.each(["owner", "manager", "staff"] as const)(
    "allows active %s role to operate Hotel",
    (role) => expect(canOperateHotel(role)).toBe(true),
  );

  it("fails closed without an active operation role", () => {
    expect(canOperateHotel(null)).toBe(false);
  });

  it("keeps Hotel settings restricted to Owner and Manager", () => {
    expect(canManageHotelSettings("owner")).toBe(true);
    expect(canManageHotelSettings("manager")).toBe(true);
    expect(canManageHotelSettings("staff")).toBe(false);
    expect(canManageHotelSettings(null)).toBe(false);
  });
});
