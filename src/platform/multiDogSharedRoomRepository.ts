import { supabase } from "../lib/supabase";
import type {
  SharedHotelMemberMutationResult,
  SharedHotelOccupancy,
  SharedHotelRoomRepositoryContract,
  UnassignedSharedRoomGroup,
} from "./multiDogSharedRoomContract";

type RpcError = { code?: string; message?: string };

const rpc = async <T>(name: string, args: Record<string, unknown>): Promise<T> => {
  const result = await supabase.rpc(name, args);
  if (result.error) throw result.error;
  return result.data as T;
};

export const sharedHotelRoomRepository: SharedHotelRoomRepositoryContract = {
  async listUnassigned(date) {
    const selectedDayStart = new Date(`${date}T00:00:00+09:00`);
    if (Number.isNaN(selectedDayStart.getTime())) {
      throw new Error("호텔 운영 날짜를 확인해 주세요.");
    }
    const selectedNextDayStart = new Date(selectedDayStart.getTime() + 86_400_000);
    const groupsResult = await supabase
      .from("family_shared_room_groups")
      .select("id, family_booking_id, room_type_id, normalized_starts_at, normalized_ends_at, requested_capacity, status, version")
      .eq("status", "requested")
      .is("archived_at", null)
      .lt("normalized_starts_at", selectedNextDayStart.toISOString())
      .gt("normalized_ends_at", selectedDayStart.toISOString())
      .order("normalized_starts_at", { ascending: true });
    if (groupsResult.error) throw groupsResult.error;
    const groups = (groupsResult.data ?? []) as Array<{
      id: string;
      family_booking_id: string;
      room_type_id: string;
      normalized_starts_at: string;
      normalized_ends_at: string;
      requested_capacity: number;
      status: string;
      version: number;
    }>;
    if (!groups.length) return [];

    const groupIds = groups.map((group) => group.id);
    const familyBookingIds = [...new Set(groups.map((group) => group.family_booking_id))];
    const roomTypeIds = [...new Set(groups.map((group) => group.room_type_id))];
    const [bookingsResult, membersResult, capacitiesResult, roomTypesResult] = await Promise.all([
      supabase
        .from("family_bookings")
        .select("id, customer_id")
        .in("id", familyBookingIds)
        .is("archived_at", null),
      supabase
        .from("family_booking_members")
        .select("id, family_booking_id, shared_room_group_id, hotel_stay_id, dog_id, status")
        .in("shared_room_group_id", groupIds)
        .eq("service_type", "hotel")
        .is("archived_at", null),
      supabase
        .from("hotel_capacity_reservations")
        .select("id, shared_room_group_id, quantity, source_kind")
        .in("shared_room_group_id", groupIds)
        .eq("source_kind", "shared_group")
        .is("archived_at", null),
      supabase
        .from("hotel_room_types")
        .select("id, code")
        .in("id", roomTypeIds)
        .eq("is_active", true)
        .is("archived_at", null),
    ]);
    for (const result of [bookingsResult, membersResult, capacitiesResult, roomTypesResult]) {
      if (result.error) throw result.error;
    }

    const bookings = (bookingsResult.data ?? []) as Array<{ id: string; customer_id: string }>;
    const members = (membersResult.data ?? []) as Array<{
      id: string;
      family_booking_id: string;
      shared_room_group_id: string;
      hotel_stay_id: string;
      dog_id: string;
      status: string;
    }>;
    const customerIds = [...new Set(bookings.map((booking) => booking.customer_id))];
    const dogIds = [...new Set(members.map((member) => member.dog_id))];
    const [customersResult, dogsResult] = await Promise.all([
      supabase.from("customers").select("id, name").in("id", customerIds),
      supabase.from("dogs").select("id, name").in("id", dogIds),
    ]);
    if (customersResult.error) throw customersResult.error;
    if (dogsResult.error) throw dogsResult.error;

    const customerNameById = new Map(
      ((customersResult.data ?? []) as Array<{ id: string; name: string }>).map((row) => [row.id, row.name]),
    );
    const dogNameById = new Map(
      ((dogsResult.data ?? []) as Array<{ id: string; name: string }>).map((row) => [row.id, row.name]),
    );
    const bookingById = new Map(bookings.map((row) => [row.id, row]));
    const roomTypeById = new Map(
      ((roomTypesResult.data ?? []) as Array<{ id: string; code: string }>).map((row) => [row.id, row]),
    );
    const capacityByGroupId = new Map(
      ((capacitiesResult.data ?? []) as Array<{
        id: string;
        shared_room_group_id: string;
        quantity: number;
        source_kind: string;
      }>).map((row) => [row.shared_room_group_id, row]),
    );

    return groups.map((group): UnassignedSharedRoomGroup => {
      const booking = bookingById.get(group.family_booking_id);
      const roomType = roomTypeById.get(group.room_type_id);
      const capacity = capacityByGroupId.get(group.id);
      const dogMembers = members
        .filter((member) => member.shared_room_group_id === group.id)
        .map((member) => ({
          familyBookingMemberId: member.id,
          hotelStayId: member.hotel_stay_id,
          dogId: member.dog_id,
          dogName: dogNameById.get(member.dog_id) ?? "이름 확인",
        }));
      if (
        !booking ||
        roomType?.code.trim().toUpperCase() !== "DELUXE" ||
        !capacity ||
        capacity.quantity !== 1 ||
        dogMembers.length < 2 ||
        group.requested_capacity !== dogMembers.length
      ) {
        throw new Error("미배정 함께 투숙 예약의 DELUXE Capacity 계약을 확인해 주세요.");
      }
      return {
        sharedRoomGroupId: group.id,
        familyBookingId: group.family_booking_id,
        customerId: booking.customer_id,
        customerName: customerNameById.get(booking.customer_id) ?? "보호자 확인",
        dogMembers,
        dogCount: dogMembers.length,
        roomTypeId: group.room_type_id,
        roomTypeCode: "DELUXE",
        reservedFrom: group.normalized_starts_at,
        reservedUntil: group.normalized_ends_at,
        capacityReservationId: capacity.id,
        requestedCapacity: 1,
        status: "requested",
        version: group.version,
      };
    });
  },
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
  return "객실 배정을 완료하지 못했습니다. 다시 시도해 주세요.";
}
