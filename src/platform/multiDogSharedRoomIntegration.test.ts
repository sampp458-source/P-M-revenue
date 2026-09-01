import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { sharedHotelRoomErrorMessage } from "./multiDogSharedRoomRepository";
import { resolveSharedRoomAssignmentAttempt } from "./multiDogSharedRoomContract";

const source = (path: string) => readFileSync(resolve(import.meta.dirname, path), "utf8");

describe("Multi-Dog Shared Room frontend contract", () => {
  it("reuses one assignment request ID only for a retry to the same room", () => {
    const ids = ["assignment-1", "assignment-2"];
    const createId = () => ids.shift()!;
    const first = resolveSharedRoomAssignmentAttempt(undefined, "room-1", createId);
    const retry = resolveSharedRoomAssignmentAttempt(first, "room-1", createId);
    const differentRoom = resolveSharedRoomAssignmentAttempt(retry, "room-2", createId);
    expect(retry.requestId).toBe("assignment-1");
    expect(differentRoom.requestId).toBe("assignment-2");
  });
  it("uses approved mutation RPCs and never queries physical mutation tables directly", () => {
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

  it("reads requested shared groups once and keeps their member Stay identities for suppression", () => {
    const repository = source("./multiDogSharedRoomRepository.ts");
    expect(repository).toContain('.from("family_shared_room_groups")');
    expect(repository).toContain('.eq("status", "requested")');
    expect(repository).toContain('.eq("source_kind", "shared_group")');
    expect(repository).toContain('.lt("normalized_starts_at", selectedNextDayStart.toISOString())');
    expect(repository).toContain('.gt("normalized_ends_at", selectedDayStart.toISOString())');
    expect(repository).toContain("hotelStayId: member.hotel_stay_id");
    expect(repository).toContain("group.requested_capacity !== dogMembers.length");
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
    expect(board).not.toContain("객실 1 · Capacity");
    expect(board).toContain("함께 투숙 · {activeMembers.length}마리 · 객실 1실");
    expect(board).toContain("...sharedByRoom.keys()");
    expect(board).toContain("occupiedRoomIds.has(room.id)");
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
    expect(sharedHotelRoomErrorMessage({ code: "23P01" })).toContain("다른 예약이 먼저 사용");
    expect(sharedHotelRoomErrorMessage({ code: "23514", message: "DELUXE" })).toContain("디럭스 객실에만");
    expect(sharedHotelRoomErrorMessage({ code: "PT409" })).toContain("다른 객실을 선택");
    expect(sharedHotelRoomErrorMessage({ code: "42501" })).toContain("권한");
  });

  it("keeps unsupported split and STANDARD moves out of the shared room UI", () => {
    const modal = source("../pages/SharedHotelRoomModal.tsx");
    expect(modal).toContain("개별 Dog 분리와 STANDARD 이동은 지원하지 않습니다.");
    expect(modal).toContain('room.roomTypeCode === "DELUXE"');
  });
});
