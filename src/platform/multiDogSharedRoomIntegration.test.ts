import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { sharedHotelRoomErrorMessage } from "./multiDogSharedRoomRepository";

const source = (path: string) => readFileSync(resolve(import.meta.dirname, path), "utf8");

describe("Multi-Dog Shared Room frontend contract", () => {
  it("uses only approved RPCs and never accesses shared tables directly", () => {
    const repository = source("./multiDogSharedRoomRepository.ts");
    [
      "get_hotel_shared_room_occupancies",
      "get_shared_hotel_room_occupancy",
      "create_shared_hotel_room_occupancy",
      "merge_existing_hotel_stays_into_shared_room",
      "complete_shared_hotel_check_in",
      "complete_shared_hotel_member_check_out",
      "reverse_shared_hotel_member_completion",
      "move_shared_hotel_room_occupancy",
    ].forEach((rpc) => expect(repository).toContain(`"${rpc}"`));
    expect(repository).not.toContain('.from("hotel_physical_occupancies")');
    expect(repository).not.toContain('.from("hotel_physical_occupancy_members")');
    expect(repository).not.toContain('.from("hotel_physical_occupancy_requests")');
  });

  it("sends explicit intent and existing Stay identities to one atomic merge RPC", () => {
    const repository = source("./multiDogSharedRoomRepository.ts");
    expect(repository).toContain("p_hotel_stay_ids: hotelStayIds");
    expect(repository).toContain("p_expected_versions: expectedVersions");
    expect(repository).toContain("p_shared_room_intent: true");
    expect(repository).not.toContain("assignHotelRoom(");
  });

  it("preserves one physical room and one capacity for multiple active Dogs", () => {
    const board = source("../pages/HotelRoomBoard.tsx");
    expect(board).toContain("sharedByRoom");
    expect(board).toContain("sharedMemberStayIds");
    expect(board).toContain("객실 1 · Capacity");
    expect(board).toContain("Shared Room · {activeMembers.length}마리");
    expect(board).toContain("sharedByRoom.has(room.id)");
  });

  it("exposes existing-Stay merge and both-Dog reservation detail without internal terminology", () => {
    const operations = source("../pages/HotelOperations.tsx");
    const modal = source("../pages/SharedHotelRoomModal.tsx");
    expect(operations).toContain("existingStaySharedRoomCandidates");
    expect(operations).toContain("같은 방 투숙");
    expect(operations).toContain('sharedOccupancy.members.map((member) => member.dogName)');
    expect(modal).toContain("함께 투숙할 반려견");
    expect(modal).toContain("같은 방으로 배정");
    expect(modal).not.toContain("Physical Occupancy / Membership / Root");
  });

  it("maps policy, room, capacity and replay conflicts to staff-safe messages", () => {
    expect(sharedHotelRoomErrorMessage({ code: "23P01" })).toContain("이미 사용 중");
    expect(sharedHotelRoomErrorMessage({ code: "23514", message: "DELUXE" })).toContain("DELUXE");
    expect(sharedHotelRoomErrorMessage({ code: "PT409" })).toContain("최신 객실 상태");
    expect(sharedHotelRoomErrorMessage({ code: "42501" })).toContain("권한");
  });

  it("keeps unsupported split and STANDARD moves out of the shared room UI", () => {
    const modal = source("../pages/SharedHotelRoomModal.tsx");
    expect(modal).toContain("개별 Dog 분리와 STANDARD 이동은 지원하지 않습니다.");
    expect(modal).toContain('room.roomTypeCode === "DELUXE"');
  });
});
