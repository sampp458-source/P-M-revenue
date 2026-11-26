import type { DaycareReservation } from "./daycareOperationsRepository";
import type { HotelRoomSnapshot, HotelStay } from "./hotelOperationsRepository";
import type { SharedHotelOccupancy } from "../platform/multiDogSharedRoomContract";
import { hotelStayHasPhysicalHold, seoulInputParts } from "./hotelOperationsUi";

export const daycareBoardKey = (id: string) => `daycare:${id}`;

export const daycareNeedsBoardAssignment = (reservation: DaycareReservation, selectedDate: string) =>
  reservation.lifecycleStatus === "scheduled" && reservation.scheduleStatus === "scheduled"
  && !reservation.roomAllocation && !reservation.capacityReservation.archivedAt
  && Number.isFinite(Date.parse(reservation.startsAt))
  && Number.isFinite(Date.parse(reservation.endsAt))
  && Date.parse(reservation.startsAt) < Date.parse(reservation.endsAt)
  && seoulInputParts(reservation.startsAt).date === selectedDate;

export function daycareCanDropOnRoom(
  reservation: DaycareReservation,
  room: HotelRoomSnapshot,
  stays: readonly HotelStay[],
  shared: readonly SharedHotelOccupancy[],
  daycare: readonly DaycareReservation[],
  boardInstant?: string,
) {
  if (!room.isActive || room.roomTypeId !== reservation.roomTypeId ||
    (reservation.dogs?.length === 2 && room.roomTypeCode.trim().toUpperCase() !== "DELUXE")) return false;
  const start = Date.parse(reservation.startsAt), end = Date.parse(reservation.endsAt);
  const overlaps = (from: string, until: string) => {
    const left=Date.parse(from), right=Date.parse(until);
    return !Number.isFinite(left) || !Number.isFinite(right) || (left < end && start < right);
  };
  return !stays.some(stay => !stay.archivedAt && stay.roomAllocations.some(a =>
    a.roomId === room.id && !a.archivedAt && (
      overlaps(a.allocatedFrom, a.allocatedUntil)
      || (boardInstant && Date.parse(a.allocatedFrom) <= Date.parse(boardInstant)
        && hotelStayHasPhysicalHold(stay, boardInstant)
        && !stay.roomAllocations.some(later => !later.archivedAt && Date.parse(later.allocatedFrom) > Date.parse(a.allocatedFrom)
          && Date.parse(later.allocatedFrom) <= Date.parse(boardInstant)))
    )))
    && !shared.some(item => item.roomId === room.id && item.status === "active" &&
      overlaps(item.occupiedFrom, item.occupiedUntil))
    && !daycare.some(item => item.operationScheduleId !== reservation.operationScheduleId
      && item.roomAllocation?.roomId === room.id
      && (item.lifecycleStatus === "scheduled" || item.lifecycleStatus === "checked_in")
      && ((boardInstant && item.lifecycleStatus === "checked_in")
        || overlaps(item.roomAllocation.allocatedFrom, item.roomAllocation.allocatedUntil)));
}
