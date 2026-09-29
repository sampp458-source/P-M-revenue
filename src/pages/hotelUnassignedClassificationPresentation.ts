import type { HotelOperationsSnapshot, HotelSelectedDateUnassigned, HotelUnassignedClassification } from "./hotelOperationsRepository";

export const hotelUnassignedLabels: Record<HotelUnassignedClassification, string> = {
  ARRIVAL: "입실 · 객실 배정 필요",
  CHECKED_IN_UNRESOLVED: "객실 점유 확인 필요",
  LONG_STAY_RETURN: "복귀 · 객실 배정 필요",
  LATE_ARRIVAL: "입실 확인 필요",
  PLANNED_STAY_UNASSIGNED: "숙박 예정 · 객실 배정 필요",
  OTHER: "객실 배정 확인 필요",
};
export type HotelUnassignedItem = HotelSelectedDateUnassigned["items"][number];

// Group only server classifications. Missing/unknown evidence never implies arrival.
export function hotelUnassignedClassificationPresentation(snapshot: HotelOperationsSnapshot, selectedDate: string) {
  const projection = snapshot.date === selectedDate && snapshot.selectedDateUnassigned?.date === selectedDate
    ? snapshot.selectedDateUnassigned : undefined;
  const items = projection?.items ?? [];
  const unique = new Map(items.map(item => [`${item.kind}:${item.canonicalId}`, item]));
  const consistent = Boolean(projection && projection.count === items.length && unique.size === items.length);
  const groups: Record<HotelUnassignedClassification, HotelUnassignedItem[]> = {
    ARRIVAL: [], CHECKED_IN_UNRESOLVED: [], LONG_STAY_RETURN: [], LATE_ARRIVAL: [], PLANNED_STAY_UNASSIGNED: [], OTHER: [],
  };
  for (const item of unique.values()) {
    const classification = consistent && item.classification && Object.hasOwn(groups, item.classification)
      ? item.classification : "OTHER";
    groups[classification].push(item);
  }
  return {groups, items: [...unique.values()], available: consistent,
    singleIds: new Set(items.filter(item => item.kind === "single").map(item => item.canonicalId)),
    groupIds: new Set(items.filter(item => item.kind === "shared").map(item => item.canonicalId))};
}
