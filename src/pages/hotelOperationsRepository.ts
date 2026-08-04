import { supabase } from "../lib/supabase";

export interface HotelRoomTypeSnapshot {
  id: string;
  code: string;
  name: string;
  activeRooms: number;
  reservedPeak: number;
  checkedInNow: number;
  allocatedNow: number;
  reservedNow: number;
  unassignedNow: number;
  physicallyEmpty: number;
  confirmedReservationCount?: number;
  confirmedReservedPeak?: number;
  confirmedRemaining?: number;
  conservativeRemaining?: number;
  affectedByUnspecifiedCount?: number;
}

export interface HotelRoomSnapshot {
  id: string;
  name: string;
  roomTypeId: string;
  roomTypeCode: string;
  roomTypeName: string;
  isActive: boolean;
  sortOrder: number;
}

export interface HotelOperationSettingsSnapshot {
  id: string;
  version: number;
  defaultCheckInTime: string;
  defaultCheckOutTime: string;
  timezone: string;
}

export interface HotelScheduleEvent {
  eventKind: "check_in" | "check_out";
  schedule: {
    id: string;
    title: string;
    memo: string | null;
    startsAt: string;
    endsAt: string;
    timeUnspecified: boolean;
    status: "scheduled" | "completed" | "cancelled";
    calendarId: string;
    scheduleTypeId: string;
    assignees: Array<{ id: string; name: string | null }>;
  };
}

export interface HotelRoomAllocation {
  id: string;
  roomId: string;
  roomName: string;
  roomTypeId: string;
  allocatedFrom: string;
  allocatedUntil: string;
  assignmentReason: string | null;
  version: number;
  archivedAt?: string | null;
}

export interface HotelCapacityReservation {
  id: string;
  roomTypeId: string | null;
  roomTypeCode: string | null;
  roomTypeName: string | null;
  reservedFrom: string;
  reservedUntil: string;
  quantity: number;
}

export interface HotelStay {
  id: string;
  dogId: string;
  dogName: string;
  customerId: string | null;
  customerName: string | null;
  customerPhone: string | null;
  version: number;
  requestId: string;
  checkedInAt: string | null;
  checkedInBy: string | null;
  checkedOutAt: string | null;
  checkedOutBy: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  capacityReservation: HotelCapacityReservation | null;
  scheduleEvents: HotelScheduleEvent[];
  roomAllocations: HotelRoomAllocation[];
}

export interface HotelOperationsSnapshot {
  date: string;
  roomTypes: HotelRoomTypeSnapshot[];
  rooms: HotelRoomSnapshot[];
  settings: HotelOperationSettingsSnapshot | null;
  stays: HotelStay[];
  unassignedFuture: HotelStay[];
  confirmedRemainingByType?: Record<string, number>;
  unassignedRoomTypeCount?: number;
  overallSafeRemaining?: number;
  individualTypeAvailabilityWarning?: boolean;
  roomTypeUnspecified?: {
    reservationCount: number;
    reservedPeak: number;
    reservedNow: number;
    label: string;
  };
}

export interface HotelReservationInput {
  calendarId: string;
  scheduleTypeId: string;
  checkInDate: string;
  checkInTime: string | null;
  checkInTimeUnspecified: boolean;
  checkOutDate: string;
  checkOutTime: string | null;
  checkOutTimeUnspecified: boolean;
  roomTypeId: string | null;
  dogId: string;
  customerId: string | null;
  assigneeIds: string[];
  memo: string;
}

export interface LegacyHotelConversionInput {
  checkInScheduleId: string;
  checkOutScheduleId: string;
  dogId: string;
  customerId: string;
  roomTypeId: string;
  assigneeIds: string[];
  notes: string;
}

export type HotelRepositoryErrorKind =
  | "permission"
  | "conflict"
  | "room_conflict"
  | "capacity_conflict"
  | "validation"
  | "not_found"
  | "unavailable";

export class HotelOperationsRepositoryError extends Error {
  constructor(
    message: string,
    public readonly kind: HotelRepositoryErrorKind,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "HotelOperationsRepositoryError";
  }
}

interface SupabaseErrorLike {
  code?: string;
  message?: string;
  details?: string;
}

function throwHotelError(error: SupabaseErrorLike | null) {
  if (!error) return;
  const raw = `${error.message ?? ""} ${error.details ?? ""}`.trim();
  const code = error.code;
  if (code === "42501" || /permission|권한/i.test(raw)) {
    throw new HotelOperationsRepositoryError(
      "이 작업을 수행할 권한이 없습니다.",
      "permission",
      code,
    );
  }
  if (
    code === "23P01" ||
    /room.*conflict|room.*overlap|호실.*충돌|allocation.*overlap/i.test(raw)
  ) {
    throw new HotelOperationsRepositoryError(
      "선택한 호실은 예약 기간과 충돌합니다. 다른 호실을 선택해 주세요.",
      "room_conflict",
      code,
    );
  }
  if (code === "40001" || /version|concurrent|동시|충돌/i.test(raw)) {
    throw new HotelOperationsRepositoryError(
      "다른 사용자가 먼저 변경했습니다. 최신 정보를 다시 확인해 주세요.",
      "conflict",
      code,
    );
  }
  if (/capacity|객실.*부족|잔여.*부족|만실/i.test(raw)) {
    throw new HotelOperationsRepositoryError(
      error.message || "예약 가능한 객실 수가 부족합니다.",
      "capacity_conflict",
      code,
    );
  }
  if (code === "P0002" || /not found|찾을 수/i.test(raw)) {
    throw new HotelOperationsRepositoryError(
      "호텔 예약 정보를 찾을 수 없습니다.",
      "not_found",
      code,
    );
  }
  if (code === "22023" || code === "23514" || code === "P0001") {
    throw new HotelOperationsRepositoryError(
      error.message || "입력값을 확인해 주세요.",
      "validation",
      code,
    );
  }
  throw new HotelOperationsRepositoryError(
    error.message || "호텔 운영 요청을 처리하지 못했습니다.",
    "unavailable",
    code,
  );
}

async function rpc<T>(name: string, args: Record<string, unknown>) {
  const result = await supabase.rpc(name, args);
  throwHotelError(result.error);
  return result.data as T;
}

export function fetchHotelOperationsSnapshot(localDate: string) {
  return rpc<HotelOperationsSnapshot>("get_hotel_operations_snapshot_v2", {
    p_local_date: localDate,
  });
}

export function fetchHotelStay(hotelStayId: string) {
  return rpc<HotelStay>("hotel_stay_json", {
    p_hotel_stay_id: hotelStayId,
  });
}

const reservationArgs = (input: HotelReservationInput, requestId: string) => ({
  p_calendar_id: input.calendarId,
  p_schedule_type_id: input.scheduleTypeId,
  p_check_in_date: input.checkInDate,
  p_check_in_time: input.checkInTime,
  p_check_in_time_unspecified: input.checkInTimeUnspecified,
  p_check_out_date: input.checkOutDate,
  p_check_out_time: input.checkOutTime,
  p_check_out_time_unspecified: input.checkOutTimeUnspecified,
  p_room_type_id: input.roomTypeId,
  p_dog_id: input.dogId,
  p_customer_id: input.customerId,
  p_assignee_ids: input.assigneeIds,
  p_memo: input.memo || null,
  p_request_id: requestId,
});

export function createHotelReservation(
  input: HotelReservationInput,
  requestId: string,
) {
  return rpc<HotelStay>(
    "create_flexible_hotel_reservation",
    reservationArgs(input, requestId),
  );
}

export function convertLegacyHotelSchedulesToReservation(
  input: LegacyHotelConversionInput,
  requestId: string,
) {
  return rpc<HotelStay>("convert_legacy_hotel_schedules_to_reservation", {
    p_check_in_schedule_id: input.checkInScheduleId,
    p_check_out_schedule_id: input.checkOutScheduleId,
    p_dog_id: input.dogId,
    p_customer_id: input.customerId,
    p_room_type_id: input.roomTypeId,
    p_assignee_ids: input.assigneeIds,
    p_notes: input.notes || null,
    p_request_id: requestId,
  });
}

export function updateHotelReservation(
  hotelStayId: string,
  expectedVersion: number,
  input: HotelReservationInput,
  requestId: string,
) {
  return rpc<HotelStay>("update_flexible_hotel_reservation", {
    p_hotel_stay_id: hotelStayId,
    p_expected_version: expectedVersion,
    ...reservationArgs(input, requestId),
  });
}

export function cancelHotelReservation(
  hotelStayId: string,
  expectedVersion: number,
  reason: string,
  requestId: string,
) {
  return rpc<HotelStay>("cancel_hotel_reservation", {
    p_hotel_stay_id: hotelStayId,
    p_expected_version: expectedVersion,
    p_reason: reason || null,
    p_request_id: requestId,
  });
}

export function assignHotelRoom(
  hotelStayId: string,
  expectedVersion: number,
  roomId: string,
  reason: string,
  requestId: string,
) {
  return rpc<HotelStay>("assign_hotel_room", {
    p_hotel_stay_id: hotelStayId,
    p_expected_version: expectedVersion,
    p_room_id: roomId,
    p_reason: reason || null,
    p_request_id: requestId,
  });
}

export function reassignHotelRoomBeforeCheckIn(
  hotelStayId: string,
  expectedVersion: number,
  newRoomId: string,
  reason: string,
  requestId: string,
) {
  return rpc<HotelStay>("reassign_hotel_room_before_check_in", {
    p_hotel_stay_id: hotelStayId,
    p_expected_version: expectedVersion,
    p_new_room_id: newRoomId,
    p_reason: reason || null,
    p_request_id: requestId,
  });
}

export function moveHotelRoomSameType(
  hotelStayId: string,
  expectedVersion: number,
  newRoomId: string,
  moveAt: string,
  reason: string,
  requestId: string,
) {
  return rpc<HotelStay>("move_hotel_room_same_type", {
    p_hotel_stay_id: hotelStayId,
    p_expected_version: expectedVersion,
    p_new_room_id: newRoomId,
    p_move_at: moveAt,
    p_reason: reason || null,
    p_request_id: requestId,
  });
}

export function completeHotelCheckIn(
  hotelStayId: string,
  expectedVersion: number,
  completedAt: string,
  requestId: string,
) {
  return rpc<HotelStay>("complete_hotel_check_in", {
    p_hotel_stay_id: hotelStayId,
    p_expected_version: expectedVersion,
    p_completed_at: completedAt,
    p_request_id: requestId,
  });
}

export function completeHotelCheckOut(
  hotelStayId: string,
  expectedVersion: number,
  completedAt: string,
  requestId: string,
) {
  return rpc<HotelStay>("complete_hotel_check_out", {
    p_hotel_stay_id: hotelStayId,
    p_expected_version: expectedVersion,
    p_completed_at: completedAt,
    p_request_id: requestId,
  });
}

export function finalizeAndCompleteHotelCheckIn(
  hotelStayId: string,
  expectedVersion: number,
  completedAt: string,
  roomTypeId: string,
  roomId: string,
  requestId: string,
) {
  return rpc<HotelStay>("finalize_and_complete_hotel_check_in", {
    p_hotel_stay_id: hotelStayId,
    p_expected_version: expectedVersion,
    p_completed_at: completedAt,
    p_room_type_id: roomTypeId,
    p_room_id: roomId,
    p_request_id: requestId,
  });
}

export function finalizeAndCompleteHotelCheckOut(
  hotelStayId: string,
  expectedVersion: number,
  completedAt: string,
  requestId: string,
) {
  return rpc<HotelStay>("finalize_and_complete_hotel_check_out", {
    p_hotel_stay_id: hotelStayId,
    p_expected_version: expectedVersion,
    p_completed_at: completedAt,
    p_request_id: requestId,
  });
}

export function updateHotelOperationSettings(
  expectedVersion: number,
  defaultCheckInTime: string,
  defaultCheckOutTime: string,
  requestId: string,
) {
  return rpc<HotelOperationSettingsSnapshot>("update_hotel_operation_settings", {
    p_expected_version: expectedVersion,
    p_default_check_in_time: defaultCheckInTime,
    p_default_check_out_time: defaultCheckOutTime,
    p_request_id: requestId,
  });
}
