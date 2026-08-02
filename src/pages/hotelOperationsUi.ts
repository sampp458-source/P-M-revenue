import type { HotelRoomAllocation, HotelStay } from "./hotelOperationsRepository";

export type HotelStayStatus =
  | "예약"
  | "호실 미배정"
  | "호실 배정"
  | "입실 완료"
  | "사용 중"
  | "객실 이동"
  | "퇴실 완료";

export function activeHotelAllocation(stay: HotelStay) {
  return [...stay.roomAllocations].sort(
    (left, right) =>
      new Date(right.allocatedFrom).getTime() -
      new Date(left.allocatedFrom).getTime(),
  )[0] ?? null;
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
