import type { OperationRole } from "./operationsScheduleRepository";

export function canOperateHotel(role: OperationRole | null): boolean {
  return role === "owner" || role === "manager" || role === "staff";
}

export function canManageHotelSettings(role: OperationRole | null): boolean {
  return role === "owner" || role === "manager";
}
