import { supabase } from "../lib/supabase";
import type {
  SharedHotelMemberMutationResult,
  SharedHotelCancellationResult,
  SharedHotelOccupancy,
  SharedHotelRoomRepositoryContract,
  SharedHotelUnassignResult,
  UnassignedSharedRoomGroup,
} from "./multiDogSharedRoomContract";

type RpcError = { code?: string; message?: string };

const rpc = async <T>(name: string, args: Record<string, unknown>): Promise<T> => {
  const result = await supabase.rpc(name, args);
  if (result.error) throw result.error;
  return result.data as T;
};

export const sharedHotelRoomRepository: SharedHotelRoomRepositoryContract = {
  listUnassigned: (date) =>
    rpc<UnassignedSharedRoomGroup[]>(
      "get_unassigned_shared_hotel_room_groups",
      { p_date: date },
    ),
  listForDate: (date) =>
    rpc<SharedHotelOccupancy[]>("get_hotel_shared_room_occupancies", {
      p_date: date,
    }),
  get: (occupancyId) =>
    rpc<SharedHotelOccupancy>("get_shared_hotel_room_occupancy", {
      p_occupancy_id: occupancyId,
    }),
  create: (sharedRoomGroupId, roomId, requestId) =>
    rpc<SharedHotelOccupancy>("create_shared_hotel_room_occupancy", {
      p_shared_room_group_id: sharedRoomGroupId,
      p_room_id: roomId,
      p_request_id: requestId,
    }),
  mergeExistingStays: (hotelStayIds, expectedVersions, requestId) =>
    rpc<SharedHotelOccupancy>("merge_existing_hotel_stays_into_shared_room", {
      p_hotel_stay_ids: hotelStayIds,
      p_expected_versions: expectedVersions,
      p_shared_room_intent: true,
      p_request_id: requestId,
    }),
  checkIn: (occupancyId, hotelStayId, occupancyVersion, stayVersion, completedAt, requestId) =>
    rpc<SharedHotelMemberMutationResult>("complete_shared_hotel_check_in", {
      p_occupancy_id: occupancyId,
      p_hotel_stay_id: hotelStayId,
      p_expected_occupancy_version: occupancyVersion,
      p_expected_stay_version: stayVersion,
      p_completed_at: completedAt,
      p_request_id: requestId,
    }),
  checkOut: (occupancyId, hotelStayId, occupancyVersion, stayVersion, completedAt, requestId) =>
    rpc<SharedHotelMemberMutationResult>("complete_shared_hotel_member_check_out", {
      p_occupancy_id: occupancyId,
      p_hotel_stay_id: hotelStayId,
      p_expected_occupancy_version: occupancyVersion,
      p_expected_stay_version: stayVersion,
      p_completed_at: completedAt,
      p_request_id: requestId,
    }),
  reverseCompletion: (occupancyId, hotelStayId, occupancyVersion, stayVersion, reason, requestId) =>
    rpc<SharedHotelMemberMutationResult>("reverse_shared_hotel_member_completion", {
      p_occupancy_id: occupancyId,
      p_hotel_stay_id: hotelStayId,
      p_expected_occupancy_version: occupancyVersion,
      p_expected_stay_version: stayVersion,
      p_reason: reason,
      p_request_id: requestId,
    }),
  reverseCheckIn: (occupancyId, hotelStayId, occupancyVersion, stayVersion, reason, requestId) =>
    rpc<SharedHotelMemberMutationResult>("reverse_shared_hotel_member_check_in", {
      p_occupancy_id: occupancyId,
      p_hotel_stay_id: hotelStayId,
      p_expected_occupancy_version: occupancyVersion,
      p_expected_stay_version: stayVersion,
      p_reason: reason.trim(),
      p_request_id: requestId,
    }),
  move: (occupancyId, roomId, occupancyVersion, reason, requestId) =>
    rpc<SharedHotelOccupancy>("move_shared_hotel_room_occupancy", {
      p_occupancy_id: occupancyId,
      p_new_room_id: roomId,
      p_expected_occupancy_version: occupancyVersion,
      p_reason: reason,
      p_request_id: requestId,
    }),
  unassign: (occupancyId, occupancyVersion, reason, requestId) =>
    rpc<SharedHotelUnassignResult>("unassign_shared_hotel_room_before_check_in", {
      p_occupancy_id: occupancyId,
      p_expected_version: occupancyVersion,
      p_reason: reason,
      p_request_id: requestId,
    }),
  cancel: (sharedRoomGroupId, sharedRoomGroupVersion, reason, requestId) =>
    rpc<SharedHotelCancellationResult>("cancel_shared_hotel_room_family_booking", {
      p_shared_room_group_id: sharedRoomGroupId,
      p_expected_version: sharedRoomGroupVersion,
      p_reason: reason,
      p_request_id: requestId,
    }),
};

export function sharedHotelRoomErrorMessage(error: unknown) {
  const source = error as RpcError | null;
  const code = source?.code ?? "";
  const message = source?.message ?? "";
  if (message.includes("입실 전") || message.includes("미배정 상태") || message.includes("객실 배정 상태")) {
    return message;
  }
  if (message.includes("다른 사용자가 먼저")) {
    return "다른 사용자가 먼저 함께 투숙 예약을 변경했습니다. 새로고침 후 다시 확인해 주세요.";
  }
  if (code === "PT409" || code === "40001") {
    return "선택한 객실을 다른 예약이 먼저 사용했습니다. 다른 객실을 선택해 주세요.";
  }
  if (code === "23P01") return "선택한 객실을 다른 예약이 먼저 사용했습니다. 다른 객실을 선택해 주세요.";
  if (code === "23514") {
    if (message.includes("DELUXE")) return "같은 객실 투숙은 디럭스 객실에만 배정할 수 있습니다.";
    if (message.includes("Family") || message.includes("intent")) return "함께 투숙할 반려견과 보호자 정보를 확인해 주세요.";
    return "함께 투숙할 기간과 객실 조건을 확인해 주세요.";
  }
  if (code === "42501") return "객실을 배정할 권한이 없습니다.";
  if (message.includes("request")) return "이미 처리된 요청과 내용이 다릅니다. 다시 시도해 주세요.";
  return "함께 투숙 요청을 처리하지 못했습니다. 다시 시도해 주세요.";
}
