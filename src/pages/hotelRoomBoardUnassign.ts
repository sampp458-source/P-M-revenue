import type { SharedHotelOccupancy } from "../platform/multiDogSharedRoomContract";
import type { HotelStay } from "./hotelOperationsRepository";
import { activeHotelAllocation } from "./hotelOperationsUi";

export type HotelRoomUnassignMode = "pre_check_in" | "reverse_check_in_and_unassign";

export function hotelStayRoomUnassignMode(stay: HotelStay): HotelRoomUnassignMode | null {
  if (!activeHotelAllocation(stay) || stay.checkedOutAt) return null;
  return stay.checkedInAt ? "reverse_check_in_and_unassign" : "pre_check_in";
}

export function sharedHotelOccupancyRoomUnassignMode(
  occupancy: SharedHotelOccupancy,
  staysById: ReadonlyMap<string, HotelStay>,
): HotelRoomUnassignMode | null {
  if (occupancy.status !== "active" || occupancy.members.length === 0) return null;
  const stays = occupancy.members.map((member) =>
    member.status === "active" ? staysById.get(member.hotelStayId) : undefined,
  );
  if (stays.some((stay) => !stay || stay.checkedOutAt)) return null;
  return stays.some((stay) => Boolean(stay?.checkedInAt))
    ? "reverse_check_in_and_unassign"
    : "pre_check_in";
}

export function canUnassignHotelStayBeforeCheckIn(stay: HotelStay) {
  return hotelStayRoomUnassignMode(stay) === "pre_check_in";
}

export function canUnassignSharedHotelOccupancyBeforeCheckIn(
  occupancy: SharedHotelOccupancy,
  staysById: ReadonlyMap<string, HotelStay>,
) {
  return sharedHotelOccupancyRoomUnassignMode(occupancy, staysById) === "pre_check_in";
}
