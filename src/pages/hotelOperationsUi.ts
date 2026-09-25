import { operationScheduleHotelRoomLabel } from "./operationsScheduleRepository";
import type { HotelEventRoomProjections, HotelRoomAllocation, HotelStay } from "./hotelOperationsRepository";

export type HotelStayStatus =
  | "예약"
  | "호실 미배정"
  | "호실 배정"
  | "입실 완료"
  | "사용 중"
  | "객실 이동"
  | "퇴실 완료";

export type HotelStayDayPhase = "입실" | "이용중" | "퇴실" | "입실·퇴실";
export type HotelQuickFilter = "all" | "check_in" | "in_house" | "check_out";

export function activeHotelAllocation(
  stay: HotelStay,
  selectedInstant?: string,
) {
  if (!selectedInstant) {
    return [...stay.roomAllocations].sort(
      (left, right) =>
        new Date(right.allocatedFrom).getTime() -
        new Date(left.allocatedFrom).getTime(),
    )[0] ?? null;
  }
  const instant = new Date(selectedInstant).getTime();
  return stay.roomAllocations.filter((allocation) => {
    const from = new Date(allocation.allocatedFrom).getTime();
    const until = allocation.allocatedUntil === "infinity"
      ? Number.POSITIVE_INFINITY
      : new Date(allocation.allocatedUntil).getTime();
    return from <= instant && instant < until;
  }).sort(
    (left, right) =>
      new Date(right.allocatedFrom).getTime() -
      new Date(left.allocatedFrom).getTime(),
  )[0] ?? null;
}

/** New physical holds begin with actual entry at this instant; no legacy backfill. */
export const HOTEL_PHYSICAL_CUTOVER = "2026-09-25T00:00:00+09:00";

export function hotelStayHasPhysicalHold(stay: HotelStay, instant = new Date().toISOString()) {
  return Boolean(!stay.archivedAt && !stay.checkedOutAt && stay.checkedInAt
    && new Date(stay.checkedInAt).getTime() >= new Date(HOTEL_PHYSICAL_CUTOVER).getTime()
    && new Date(stay.checkedInAt).getTime() <= new Date(instant).getTime());
}

/** Legacy departure access is separate from room occupancy and never locks a room. */
export function hotelStayNeedsCheckoutReview(stay: HotelStay, instant: string) {
  const checkout = hotelStayScheduleEvent(stay, "check_out");
  if (stay.archivedAt || !stay.checkedInAt || stay.checkedOutAt || !checkout
    || new Date(stay.checkedInAt).getTime() >= new Date(HOTEL_PHYSICAL_CUTOVER).getTime()
    || new Date(checkout.startsAt).getTime() < new Date(HOTEL_PHYSICAL_CUTOVER).getTime()) return false;
  return checkout.timeUnspecified
    ? seoulInputParts(checkout.startsAt).date < seoulInputParts(instant).date
    : new Date(checkout.startsAt).getTime() <= new Date(instant).getTime();
}

/** Current operational allocation; planned intervals remain unchanged for history/planning.
 * roomAllocations belongs to the active capacity segment (released Long Stay segments
 * are absent from hotel_stay_json). Never revive an older room after a room move.
 */
export function currentHotelAllocation(stay: HotelStay, selectedInstant?: string) {
  if (!selectedInstant) return activeHotelAllocation(stay);
  const instant = new Date(selectedInstant).getTime();
  if (stay.archivedAt || stay.checkedOutAt) return null;
  if (!hotelStayHasPhysicalHold(stay, selectedInstant)) {
    return activeHotelAllocation(stay, selectedInstant);
  }
  return [...stay.roomAllocations]
    .filter(allocation => new Date(allocation.allocatedFrom).getTime() <= instant)
    .sort((left, right) =>
      new Date(right.allocatedFrom).getTime() - new Date(left.allocatedFrom).getTime()
      || right.id.localeCompare(left.id))[0] ?? null;
}

export function hotelStayCheckoutOverdue(stay: HotelStay, instant = new Date().toISOString()) {
  const checkout = hotelStayScheduleEvent(stay, "check_out");
  return Boolean(hotelStayHasPhysicalHold(stay, instant)
    && checkout && !checkout.timeUnspecified
    && new Date(checkout.startsAt).getTime() < new Date(instant).getTime());
}

export function hotelOverdueCheckoutLabel(stay: HotelStay, instant = new Date().toISOString()) {
  if (!hotelStayCheckoutOverdue(stay, instant)) return null;
  const checkout = hotelStayScheduleEvent(stay, "check_out")!;
  const { date, time } = seoulInputParts(checkout.startsAt);
  return `${date === seoulInputParts(instant).date ? "" : `${date} `}${time} 퇴실 예정`;
}

export function hotelStayStatus(stay: HotelStay): HotelStayStatus {
  if (stay.checkedOutAt) return "퇴실 완료";
  if (stay.checkedInAt) {
    return stay.roomAllocations.length > 1 ? "객실 이동" : "사용 중";
  }
  if (stay.roomAllocations.length > 0) return "호실 배정";
  if (stay.capacityReservation) return "호실 미배정";
  return "예약";
}

export function hotelStayTitle(stay: HotelStay) {
  return (
    stay.scheduleEvents.find((event) => event.eventKind === "check_in")
      ?.schedule.title || `${stay.dogName} 호텔 예약`
  );
}

export function hotelStayMemo(stay: HotelStay) {
  const schedule = stay.scheduleEvents.find(
    (event) => event.eventKind === "check_in",
  )?.schedule;
  return schedule?.memo ?? "";
}

export function hotelStayAssigneeIds(stay: HotelStay) {
  return (
    stay.scheduleEvents.find((event) => event.eventKind === "check_in")
      ?.schedule.assignees ?? []
  ).map((assignee) => assignee.id);
}

export function hotelStayCalendarContract(stay: HotelStay) {
  const schedule = stay.scheduleEvents.find(
    (event) => event.eventKind === "check_in",
  )?.schedule;
  return {
    calendarId: schedule?.calendarId ?? "",
    scheduleTypeId: schedule?.scheduleTypeId ?? "",
  };
}

export function hotelStayScheduleEvent(
  stay: HotelStay,
  eventKind: "check_in" | "check_out",
) {
  return stay.scheduleEvents.find((event) => event.eventKind === eventKind)
    ?.schedule ?? null;
}

export function hotelStayScheduleDate(
  stay: HotelStay,
  eventKind: "check_in" | "check_out",
) {
  const schedule = hotelStayScheduleEvent(stay, eventKind);
  return schedule ? seoulInputParts(schedule.startsAt).date : null;
}

export function isValidHotelSnapshotDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

export function hotelStayDayPhase(
  stay: HotelStay,
  selectedDate: string,
): HotelStayDayPhase | null {
  const checkInDate = hotelStayScheduleDate(stay, "check_in");
  const checkOutDate = hotelStayScheduleDate(stay, "check_out");
  if (!checkInDate || !checkOutDate) return null;
  if (checkInDate === selectedDate && checkOutDate === selectedDate) {
    return "입실·퇴실";
  }
  if (checkInDate === selectedDate) return "입실";
  if (checkOutDate === selectedDate) return "퇴실";
  if (checkInDate < selectedDate && selectedDate < checkOutDate) return "이용중";
  return null;
}

export function hotelStayDayTitle(stay: HotelStay, selectedDate: string) {
  const phase = hotelStayDayPhase(stay, selectedDate);
  if (!phase) return hotelStayTitle(stay);
  const roomType =
    stay.capacityReservation?.roomTypeCode ??
    stay.capacityReservation?.roomTypeName ??
    "객실 미정";
  return [stay.dogName, "호텔링", phase, roomType].join(" · ");
}

export function matchesHotelQuickFilter(
  stay: HotelStay,
  selectedDate: string,
  filter: HotelQuickFilter,
) {
  if (filter === "all") return true;
  const phase = hotelStayDayPhase(stay, selectedDate);
  if (filter === "check_in") return phase === "입실" || phase === "입실·퇴실";
  if (filter === "check_out") return phase === "퇴실" || phase === "입실·퇴실";
  return phase === "이용중";
}

export function hotelStayUnspecifiedState(stay: HotelStay) {
  return {
    checkInTime: Boolean(
      hotelStayScheduleEvent(stay, "check_in")?.timeUnspecified,
    ),
    checkOutTime: Boolean(
      hotelStayScheduleEvent(stay, "check_out")?.timeUnspecified,
    ),
    roomType: !stay.capacityReservation?.roomTypeId,
  };
}

export function hotelStayNeedsCheckInFinalization(stay: HotelStay) {
  const unspecified = hotelStayUnspecifiedState(stay);
  return (
    unspecified.checkInTime ||
    unspecified.roomType ||
    activeHotelAllocation(stay) === null
  );
}

export function formatHotelScheduleTime(
  stay: HotelStay,
  eventKind: "check_in" | "check_out",
) {
  const schedule = hotelStayScheduleEvent(stay, eventKind);
  if (!schedule) return "-";
  if (schedule.timeUnspecified) return "시간 미정";
  return formatHotelDateTime(schedule.startsAt);
}

export function seoulInputParts(value: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    time: `${part("hour")}:${part("minute")}`,
  };
}

export function formatHotelDateTime(value: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "long",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));
}

export function isSameRoomType(
  allocation: HotelRoomAllocation | null,
  roomTypeId: string,
) {
  return !allocation || allocation.roomTypeId === roomTypeId;
}

export function currentAllocatedRoomName(stay: HotelStay) {
  return activeHotelAllocation(stay)?.roomName ?? "미배정";
}

/** Missing/ambiguous event identities stay unavailable, independent of current occupancy. */
export function hotelEventRoomLabel(
  stay: { id: string; scheduleEvents: readonly { eventKind: string; schedule: { id: string } }[] },
  eventKind: "check_in" | "check_out",
  projections?: HotelEventRoomProjections,
) {
  const events = stay.scheduleEvents.filter((event) => event.eventKind === eventKind);
  const projection = events.length === 1 ? projections?.get(events[0].schedule.id) : undefined;
  if (!projection || projection.hotelStayId !== stay.id || projection.hotelEventKind !== eventKind) {
    return "객실 정보 확인 필요";
  }
  return operationScheduleHotelRoomLabel({
    hotelRoomName: projection.hotelRoomName,
    hotelRoomTypeName: projection.hotelRoomTypeName,
    hotelRoomResolutionStatus: projection.roomResolutionStatus,
  });
}

export function hotelStayEventRoomSummary(
  stay: HotelStay,
  selectedDate: string,
  projections?: HotelEventRoomProjections,
) {
  const phase = hotelStayDayPhase(stay, selectedDate);
  const labels: string[] = [];
  if (phase === "입실" || phase === "입실·퇴실") labels.push(`입실 객실: ${hotelEventRoomLabel(stay, "check_in", projections)}`);
  if (phase === "퇴실" || phase === "입실·퇴실") labels.push(`퇴실 객실: ${hotelEventRoomLabel(stay, "check_out", projections)}`);
  return labels.length ? labels.join(" / ") : null;
}
