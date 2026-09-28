import type { HotelStay } from "./hotelOperationsRepository";
import type { UnassignedSharedRoomGroup } from "../platform/multiDogSharedRoomContract";
import { activeHotelAllocation, hotelStayScheduleDate, seoulInputParts } from "./hotelOperationsUi";

/** Presentation partition only. Never decides room availability or command eligibility. */
export function hotelFutureUnassignedPresentation(
  stays: readonly HotelStay[],
  groups: readonly UnassignedSharedRoomGroup[],
  selectedDate: string,
) {
  const uniqueGroups = [...new Map(groups.map(group => [group.sharedRoomGroupId, group])).values()];
  const sharedStayIds = new Set(uniqueGroups.flatMap(group => group.dogMembers.map(member => member.hotelStayId)));
  const futureStays = [...new Map(stays.map(stay => [stay.id, stay])).values()].filter(stay =>
    !sharedStayIds.has(stay.id) && !stay.archivedAt && !stay.checkedInAt && !stay.checkedOutAt
    && !activeHotelAllocation(stay)
    && (hotelStayScheduleDate(stay, "check_in") ?? "") > selectedDate,
  );
  const futureGroups = uniqueGroups.filter(group => group.dogMembers.length > 0
    && seoulInputParts(group.reservedFrom).date > selectedDate);
  return {
    stays: futureStays,
    groups: futureGroups,
    stayIds: new Set(futureStays.map(stay => stay.id)),
    groupIds: new Set(futureGroups.map(group => group.sharedRoomGroupId)),
  };
}
