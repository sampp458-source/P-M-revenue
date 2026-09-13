import type { HotelStay } from "./hotelOperationsRepository";
import { activeHotelAllocation, hotelStayScheduleDate } from "./hotelOperationsUi";
import { seoulDateKey } from "./operationsScheduleRepository";

// Routing only, never eligibility. The server validates lifecycle, capacity and the clock.
export function needsMissedCheckInRecovery(stay: HotelStay, today = seoulDateKey()) {
  const planned = hotelStayScheduleDate(stay, "check_in");
  return Boolean(planned && planned < today && !stay.archivedAt && !stay.checkedInAt
    && !stay.checkedOutAt && stay.capacityReservation?.roomTypeId && !activeHotelAllocation(stay));
}
