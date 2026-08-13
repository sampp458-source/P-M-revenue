import { supabase } from "../lib/supabase";
import { fetchHotelStay } from "../pages/hotelOperationsRepository";
import type {
  CompleteLongStayAbsenceInput,
  CompleteLongStayCheckInInput,
  CompleteLongStayCheckOutInput,
  ConfirmLongStayMonthInput,
  CreateLongStayContractInput,
  GetLongStayRoomAvailabilityInput,
  LongStayContractProjection,
  LongStayMonthProjection,
  LongStayRoomAvailabilityProjection,
  ReverseLongStayCompletionInput,
  SetLongStayPlannedCheckoutInput,
  StartLongStayAbsenceInput,
} from "./longStayHotelContract";

export type LongStayRepositoryErrorKind =
  | "conflict"
  | "duplicate"
  | "capacity_conflict"
  | "room_conflict"
  | "permission"
  | "not_found"
  | "validation"
  | "unavailable";

export class LongStayRepositoryError extends Error {
  constructor(
    message: string,
    public readonly kind: LongStayRepositoryErrorKind,
    public readonly code?: string,
    public readonly original?: RpcErrorLike | null,
  ) {
    super(message);
    this.name = "LongStayRepositoryError";
  }
}

interface RpcErrorLike {
  code?: string;
  message?: string;
  details?: string;
}

export function toLongStayRepositoryError(error: RpcErrorLike) {
  const code = error.code;
  if (code === "40001" || code === "PT409") {
    return new LongStayRepositoryError(
      "다른 사용자가 먼저 변경했습니다. 최신 상태를 다시 불러왔습니다.",
      "conflict",
      code,
      error,
    );
  }
  if (code === "23P01") {
    return new LongStayRepositoryError(
      "선택한 객실은 이미 사용 중입니다. 다른 객실을 선택해 주세요.",
      "room_conflict",
      code,
      error,
    );
  }
  if (code === "23514") {
    return new LongStayRepositoryError(
      "현재 객실 수용 가능 범위를 초과했습니다. 다른 객실을 확인해 주세요.",
      "capacity_conflict",
      code,
      error,
    );
  }
  if (code === "23505") {
    return new LongStayRepositoryError(
      "이미 처리된 요청이거나 현재 상태와 중복됩니다. 최신 상태를 확인해 주세요.",
      "duplicate",
      code,
      error,
    );
  }
  if (code === "42501") {
    return new LongStayRepositoryError(
      "이 장기호텔 작업을 수행할 권한이 없습니다.",
      "permission",
      code,
      error,
    );
  }
  if (code === "P0002") {
    return new LongStayRepositoryError(
      "장기호텔 정보를 찾을 수 없습니다. 최신 상태를 다시 확인해 주세요.",
      "not_found",
      code,
      error,
    );
  }
  if (code === "22023") {
    return new LongStayRepositoryError(
      "입력값을 확인해 주세요.",
      "validation",
      code,
      error,
    );
  }
  return new LongStayRepositoryError(
    "네트워크 상태를 확인한 뒤 다시 시도해 주세요.",
    "unavailable",
    code,
    error,
  );
}

function throwLongStayError(error: RpcErrorLike | null) {
  if (error) throw toLongStayRepositoryError(error);
}

async function rpc<T>(name: string, args: Record<string, unknown>) {
  const result = await supabase.rpc(name, args);
  throwLongStayError(result.error);
  return result.data as T;
}

export const newLongStayRequestId = (): string => crypto.randomUUID();

export function createLongStayContract(
  input: CreateLongStayContractInput,
  requestId = newLongStayRequestId(),
) {
  return rpc<LongStayContractProjection>("create_long_stay_contract", {
    p_customer_id: input.customerId,
    p_dog_id: input.dogId,
    p_started_on: input.startedOn,
    p_planned_check_out_date: input.plannedCheckOutDate,
    p_preferred_room_type_id: input.preferredRoomTypeId,
    p_preferred_room_id: input.preferredRoomId,
    p_monthly_rate: input.monthlyRate,
    p_billing_anchor_day: input.billingAnchorDay,
    p_memo: input.memo || null,
    p_request_id: requestId,
  });
}

export function confirmLongStayMonth(
  input: ConfirmLongStayMonthInput,
  requestId = newLongStayRequestId(),
) {
  return rpc<LongStayContractProjection>("confirm_long_stay_month", {
    p_contract_id: input.contractId,
    p_expected_contract_version: input.expectedContractVersion,
    p_service_month: input.serviceMonth,
    p_calendar_id: input.calendarId,
    p_schedule_type_id: input.scheduleTypeId,
    p_check_in_time: input.checkInTime,
    p_check_in_time_unspecified: input.checkInTimeUnspecified,
    p_room_type_id: input.roomTypeId,
    p_room_id: input.roomId,
    p_assignee_ids: input.assigneeIds,
    p_reason: input.reason,
    p_request_id: requestId,
  });
}

export function completeLongStayCheckIn(
  input: CompleteLongStayCheckInInput,
  requestId = newLongStayRequestId(),
) {
  return rpc<LongStayContractProjection>("complete_long_stay_check_in", {
    p_contract_id: input.contractId,
    p_expected_contract_version: input.expectedContractVersion,
    p_expected_stay_version: input.expectedStayVersion,
    p_completed_at: input.completedAt,
    p_reason: input.reason,
    p_request_id: requestId,
  });
}

export function startLongStayAbsence(
  input: StartLongStayAbsenceInput,
  requestId = newLongStayRequestId(),
) {
  return rpc<LongStayContractProjection>("start_long_stay_absence", {
    p_contract_id: input.contractId,
    p_expected_contract_version: input.expectedContractVersion,
    p_left_at: input.leftAt,
    p_expected_return_at: input.expectedReturnAt,
    p_memo: input.memo || null,
    p_reason: input.reason,
    p_request_id: requestId,
  });
}

export function completeLongStayAbsence(
  input: CompleteLongStayAbsenceInput,
  requestId = newLongStayRequestId(),
) {
  return rpc<LongStayContractProjection>("complete_long_stay_absence", {
    p_contract_id: input.contractId,
    p_expected_contract_version: input.expectedContractVersion,
    p_returned_at: input.returnedAt,
    p_memo: input.memo || null,
    p_reason: input.reason,
    p_request_id: requestId,
  });
}

export function setLongStayPlannedCheckout(
  input: SetLongStayPlannedCheckoutInput,
  requestId = newLongStayRequestId(),
) {
  return rpc<LongStayContractProjection>("set_long_stay_planned_checkout", {
    p_contract_id: input.contractId,
    p_expected_contract_version: input.expectedContractVersion,
    p_planned_check_out_date: input.plannedCheckOutDate,
    p_calendar_id: input.calendarId,
    p_schedule_type_id: input.scheduleTypeId,
    p_check_out_time: input.checkOutTime,
    p_time_unspecified: input.timeUnspecified,
    p_assignee_ids: input.assigneeIds,
    p_reason: input.reason,
    p_request_id: requestId,
  });
}

export function completeLongStayCheckOut(
  input: CompleteLongStayCheckOutInput,
  requestId = newLongStayRequestId(),
) {
  return rpc<LongStayContractProjection>("complete_long_stay_check_out", {
    p_contract_id: input.contractId,
    p_expected_contract_version: input.expectedContractVersion,
    p_expected_stay_version: input.expectedStayVersion,
    p_completed_at: input.completedAt,
    p_reason: input.reason,
    p_request_id: requestId,
  });
}

export function reverseLongStayCompletion(
  input: ReverseLongStayCompletionInput,
  requestId = newLongStayRequestId(),
) {
  return rpc<LongStayContractProjection>("reverse_long_stay_completion", {
    p_contract_id: input.contractId,
    p_expected_contract_version: input.expectedContractVersion,
    p_expected_stay_version: input.expectedStayVersion,
    p_reason: input.reason,
    p_request_id: requestId,
  });
}

export function getLongStayContract(contractId: string) {
  return rpc<LongStayContractProjection>("get_long_stay_contract", {
    p_contract_id: contractId,
  });
}

export function getCustomerLongStays(customerId: string) {
  return rpc<LongStayContractProjection[]>("get_customer_long_stays", {
    p_customer_id: customerId,
  });
}

export function getLongStayMonth(serviceMonth: string) {
  return rpc<LongStayMonthProjection>("get_long_stay_month", {
    p_service_month: serviceMonth,
  });
}

export function getLongStayRoomAvailability(
  input: GetLongStayRoomAvailabilityInput,
) {
  return rpc<LongStayRoomAvailabilityProjection>("get_long_stay_room_availability", {
    p_contract_id: input.contractId,
    p_service_month: input.serviceMonth,
    p_check_in_time: input.checkInTime,
    p_check_in_time_unspecified: input.checkInTimeUnspecified,
  });
}

export async function getLongStayHotelVersion(
  contract: Pick<LongStayContractProjection, "hotelStayId">,
) {
  if (!contract.hotelStayId) return null;
  const stay = await fetchHotelStay(contract.hotelStayId);
  return stay.version;
}
