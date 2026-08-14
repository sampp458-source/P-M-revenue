import { supabase } from "../lib/supabase";

export type DaycareLifecycleStatus =
  | "scheduled"
  | "checked_in"
  | "completed"
  | "cancelled";

export interface DaycareReservation {
  operationScheduleId: string;
  calendarId: string;
  scheduleTypeId: string;
  title: string;
  memo: string | null;
  startsAt: string;
  endsAt: string;
  scheduleStatus: "scheduled" | "completed" | "cancelled";
  scheduleVersion: number;
  version: number;
  lifecycleStatus: DaycareLifecycleStatus;
  roomTypeId: string;
  roomTypeCode: string;
  roomTypeName: string;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  cancelledAt: string | null;
  dog: { id: string; name: string; customerId: string | null };
  customer: { id: string; name: string | null; phone: string | null };
  assignees: Array<{ id: string; name: string | null }>;
  capacityReservation: {
    id: string;
    reservedFrom: string;
    reservedUntil: string;
    archivedAt: string | null;
  };
  roomAllocation: {
    id: string;
    roomId: string;
    roomName: string;
    allocatedFrom: string;
    allocatedUntil: string;
    version: number;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface DaycareReservationInput {
  calendarId: string;
  scheduleTypeId: string;
  customerId: string;
  dogId: string;
  serviceDate: string;
  checkInTime: string;
  checkOutTime: string;
  roomTypeId: string;
  roomId: string | null;
  assigneeIds: string[];
  memo: string;
}

export type DaycareErrorKind =
  | "permission"
  | "conflict"
  | "room_conflict"
  | "capacity_conflict"
  | "validation"
  | "not_found"
  | "unavailable";

export class DaycareRepositoryError extends Error {
  constructor(
    message: string,
    readonly kind: DaycareErrorKind,
    readonly code?: string,
  ) {
    super(message);
    this.name = "DaycareRepositoryError";
  }
}

const throwDaycareError = (error: {
  code?: string;
  message?: string;
  details?: string;
} | null) => {
  if (!error) return;
  const raw = `${error.message ?? ""} ${error.details ?? ""}`.trim();
  if (error.code === "PT409" || error.code === "40001") {
    throw new DaycareRepositoryError(
      "다른 사용자가 먼저 변경했습니다. 최신 상태를 불러왔습니다.",
      "conflict",
      error.code,
    );
  }
  if (error.code === "23P01") {
    throw new DaycareRepositoryError(
      "선택한 시간에 이미 사용 중인 호실입니다.",
      "room_conflict",
      error.code,
    );
  }
  if (error.code === "23514" || /capacity|객실.*부족/i.test(raw)) {
    throw new DaycareRepositoryError(
      "선택한 시간의 객실 유형 Capacity가 부족합니다.",
      "capacity_conflict",
      error.code,
    );
  }
  if (error.code === "42501") {
    throw new DaycareRepositoryError(
      "Daycare 예약을 처리할 권한이 없습니다.",
      "permission",
      error.code,
    );
  }
  if (error.code === "P0002") {
    throw new DaycareRepositoryError(
      "Daycare 예약 정보를 찾을 수 없습니다.",
      "not_found",
      error.code,
    );
  }
  if (error.code === "22023" || error.code === "23505" || error.code === "P0001") {
    throw new DaycareRepositoryError(
      error.message || "Daycare 예약 입력을 확인해 주세요.",
      "validation",
      error.code,
    );
  }
  throw new DaycareRepositoryError(
    "Daycare 예약 요청을 처리하지 못했습니다.",
    "unavailable",
    error.code,
  );
};

async function rpc<T>(name: string, args: Record<string, unknown>) {
  const result = await supabase.rpc(name, args);
  throwDaycareError(result.error);
  return result.data as T;
}

const inputArgs = (input: DaycareReservationInput) => ({
  p_calendar_id: input.calendarId,
  p_schedule_type_id: input.scheduleTypeId,
  p_customer_id: input.customerId,
  p_dog_id: input.dogId,
  p_service_date: input.serviceDate,
  p_check_in_time: input.checkInTime,
  p_check_out_time: input.checkOutTime,
  p_room_type_id: input.roomTypeId,
  p_room_id: input.roomId,
  p_assignee_ids: input.assigneeIds,
  p_memo: input.memo || null,
});

export function createDaycareReservation(
  input: DaycareReservationInput,
  requestId = crypto.randomUUID(),
) {
  return rpc<DaycareReservation>("create_daycare_reservation", {
    ...inputArgs(input),
    p_request_id: requestId,
  });
}

export function updateDaycareReservation(
  scheduleId: string,
  expectedVersion: number,
  input: DaycareReservationInput,
  requestId = crypto.randomUUID(),
) {
  return rpc<DaycareReservation>("update_daycare_reservation", {
    p_operation_schedule_id: scheduleId,
    p_expected_version: expectedVersion,
    ...inputArgs(input),
    p_request_id: requestId,
  });
}

export function cancelDaycareReservation(
  scheduleId: string,
  expectedVersion: number,
  reason: string,
  requestId = crypto.randomUUID(),
) {
  return rpc<DaycareReservation>("cancel_daycare_reservation", {
    p_operation_schedule_id: scheduleId,
    p_expected_version: expectedVersion,
    p_reason: reason,
    p_request_id: requestId,
  });
}

export function assignDaycareRoom(
  scheduleId: string,
  expectedVersion: number,
  roomId: string,
  reason = "Daycare 호실 배정",
  requestId = crypto.randomUUID(),
) {
  return rpc<DaycareReservation>("assign_daycare_room", {
    p_operation_schedule_id: scheduleId,
    p_expected_version: expectedVersion,
    p_room_id: roomId,
    p_reason: reason,
    p_request_id: requestId,
  });
}

export function unassignDaycareRoom(
  scheduleId: string,
  expectedVersion: number,
  reason = "Daycare 호실 배정 해제",
  requestId = crypto.randomUUID(),
) {
  return rpc<DaycareReservation>("unassign_daycare_room", {
    p_operation_schedule_id: scheduleId,
    p_expected_version: expectedVersion,
    p_reason: reason,
    p_request_id: requestId,
  });
}

export function completeDaycareCheckIn(
  scheduleId: string,
  expectedVersion: number,
  checkedInAt: string,
  requestId = crypto.randomUUID(),
) {
  return rpc<DaycareReservation>("complete_daycare_check_in", {
    p_operation_schedule_id: scheduleId,
    p_expected_version: expectedVersion,
    p_checked_in_at: checkedInAt,
    p_request_id: requestId,
  });
}

export function completeDaycareCheckOut(
  scheduleId: string,
  expectedVersion: number,
  checkedOutAt: string,
  requestId = crypto.randomUUID(),
) {
  return rpc<DaycareReservation>("complete_daycare_check_out", {
    p_operation_schedule_id: scheduleId,
    p_expected_version: expectedVersion,
    p_checked_out_at: checkedOutAt,
    p_request_id: requestId,
  });
}

export function fetchDaycareReservation(scheduleId: string) {
  return rpc<DaycareReservation>("daycare_reservation_json", {
    p_schedule_id: scheduleId,
  });
}

export function fetchDaycareOperationsForDate(localDate: string) {
  return rpc<DaycareReservation[]>("get_daycare_operations_for_date", {
    p_local_date: localDate,
  });
}
