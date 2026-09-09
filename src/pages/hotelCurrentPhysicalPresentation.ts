import type { SharedHotelOccupancy } from "../platform/multiDogSharedRoomContract";
import { sharedHotelRoomRepository } from "../platform/multiDogSharedRoomRepository";
import { fetchHotelStay, type HotelStay } from "./hotelOperationsRepository";
import { seoulDateKey } from "./operationsScheduleRepository";

export const CURRENT_ROOM_UNAVAILABLE = "현재 객실 확인 필요";

function containsInstant(from: string, until: string, now: number) {
  return Date.parse(from) <= now && now < (until === "infinity" ? Infinity : Date.parse(until));
}

export function sharedCurrentRelations(
  occupancies: readonly SharedHotelOccupancy[],
  stayId: string,
) {
  return occupancies.flatMap(occupancy => occupancy.members
    .filter(member => member.hotelStayId === stayId)
    .map(member => ({ occupancy, member })));
}

export function validCurrentSharedRelation(
  relation: ReturnType<typeof sharedCurrentRelations>[number],
  now: number,
) {
  const { occupancy, member } = relation;
  return occupancy.status === "active" && occupancy.capacityUsed === 1
    && Boolean(occupancy.roomId && occupancy.roomName && occupancy.capacityReservationId && occupancy.roomAllocationId)
    && containsInstant(occupancy.occupiedFrom, occupancy.occupiedUntil, now)
    && member.status === "active" && member.leftAt === null
    && Date.parse(member.joinedAt) <= now;
}

/** Presentation only. Never used to select an allocation for a command. */
export function currentHotelRoomLabel(
  stay: HotelStay,
  shared: readonly SharedHotelOccupancy[] | null,
  now: number,
) {
  if (stay.checkedOutAt || stay.archivedAt) return "이용 종료 · 현재 호실 없음";
  if (!stay.checkedInAt) return "입실 전 · 현재 점유 없음";
  if (shared === null) return CURRENT_ROOM_UNAVAILABLE;
  const relations = sharedCurrentRelations(shared, stay.id);
  if (relations.length) {
    return relations.length === 1 && relations[0].member.dogId === stay.dogId
      && validCurrentSharedRelation(relations[0], now)
      ? relations[0].occupancy.roomName : CURRENT_ROOM_UNAVAILABLE;
  }
  const capacity = stay.capacityReservation;
  if (!capacity?.id || !containsInstant(capacity.reservedFrom, capacity.reservedUntil, now)) return CURRENT_ROOM_UNAVAILABLE;
  const allocations = stay.roomAllocations.filter(row => !row.archivedAt
    && containsInstant(row.allocatedFrom, row.allocatedUntil, now));
  return allocations.length === 1 && allocations[0].roomId && allocations[0].roomName
    ? allocations[0].roomName : CURRENT_ROOM_UNAVAILABLE;
}

export async function fetchCurrentSharedOccupancies(date = seoulDateKey()) {
  try {
    const rows = await sharedHotelRoomRepository.listForDate(date);
    return Array.isArray(rows) ? rows : null;
  } catch {
    return null;
  }
}

/** Independent current read: no selected-date list, command snapshot, or event projection. */
export async function fetchCurrentHotelRoomLabel(stayId: string): Promise<string> {
  try {
    const [stay, shared] = await Promise.all([
      fetchHotelStay(stayId),
      fetchCurrentSharedOccupancies(),
    ]);
    if (!stay || stay.id !== stayId || !Array.isArray(shared)) return CURRENT_ROOM_UNAVAILABLE;
    return currentHotelRoomLabel(stay, shared, Date.now());
  } catch {
    return CURRENT_ROOM_UNAVAILABLE;
  }
}
