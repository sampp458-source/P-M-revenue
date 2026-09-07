import type { SharedHotelOccupancy } from "../platform/multiDogSharedRoomContract";
import type { HotelStay } from "./hotelOperationsRepository";
import { activeHotelAllocation } from "./hotelOperationsUi";

export function canUnassignHotelStayBeforeCheckIn(stay: HotelStay) {
  return Boolean(
    activeHotelAllocation(stay) && !stay.checkedInAt && !stay.checkedOutAt,
  );
}

export function canUnassignSharedHotelOccupancyBeforeCheckIn(
  occupancy: SharedHotelOccupancy,
  staysById: ReadonlyMap<string, HotelStay>,
) {
  return occupancy.status === "active"
    && occupancy.members.length > 0
    && occupancy.members.every((member) => {
      const stay = staysById.get(member.hotelStayId);
      return Boolean(stay) && !stay?.checkedInAt && !stay?.checkedOutAt;
    });
}
