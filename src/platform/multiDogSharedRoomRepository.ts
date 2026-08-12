import { supabase } from "../lib/supabase";
import type {
  SharedHotelMemberMutationResult,
  SharedHotelOccupancy,
  SharedHotelRoomRepositoryContract,
} from "./multiDogSharedRoomContract";

type RpcError = { code?: string; message?: string };

const rpc = async <T>(name: string, args: Record<string, unknown>): Promise<T> => {
  const result = await supabase.rpc(name, args);
  if (result.error) throw result.error;
  return result.data as T;
};

export const sharedHotelRoomRepository: SharedHotelRoomRepositoryContract = {
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
  move: (occupancyId, roomId, occupancyVersion, reason, requestId) =>
    rpc<SharedHotelOccupancy>("move_shared_hotel_room_occupancy", {
      p_occupancy_id: occupancyId,
      p_new_room_id: roomId,
      p_expected_occupancy_version: occupancyVersion,
      p_reason: reason,
      p_request_id: requestId,
    }),
};

export function sharedHotelRoomErrorMessage(error: unknown) {
  const source = error as RpcError | null;
  const code = source?.code ?? "";
  const message = source?.message ?? "";
  if (code === "PT409" || code === "40001") {
    return "다른 사용자가 먼저 변경했습니다. 최신 객실 상태를 불러왔습니다.";
  }
  if (code === "23P01") return "선택한 호실은 해당 기간에 이미 사용 중입니다.";
  if (code === "23514") {
    if (message.includes("DELUXE")) return "같은 방 사용은 동일 보호자의 DELUXE 예약만 가능합니다.";
    if (message.includes("Family") || message.includes("intent")) return "같은 가족의 Shared Room 예약 정보를 확인해 주세요.";
    return "공유 객실의 기간 또는 Capacity 조건을 확인해 주세요.";
  }
  if (code === "42501") return "공유 객실을 처리할 권한이 없습니다.";
  if (message.includes("request")) return "이미 처리된 요청과 내용이 다릅니다. 다시 시도해 주세요.";
  return message || "공유 객실 요청을 처리하지 못했습니다.";
}
