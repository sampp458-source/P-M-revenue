import { describe, expect, it } from "vitest";
import type { LongStayRoomAvailability } from "../platform/longStayHotelContract";
import { roomAvailabilityLabel } from "./LongStayOperationsPanel";

const room = (
  overrides: Partial<LongStayRoomAvailability>,
): LongStayRoomAvailability => ({
  roomId: "room-1",
  roomName: "DELUXE 1",
  roomTypeId: "deluxe",
  roomTypeCode: "DELUXE",
  roomTypeName: "DELUXE",
  assignable: false,
  nextConflictFrom: null,
  nextConflictUntil: null,
  conflictSource: "hotel",
  conflictPhase: "current",
  reason: "현재 사용 중",
  ...overrides,
});

describe("Long Stay room availability presentation", () => {
  it("shows a friendly source for current Hotel occupancy", () => {
    expect(roomAvailabilityLabel(room({}))).toBe("현재 사용 중 · 일반 호텔 예약");
  });

  it("shows the future boundary and Shared Room source", () => {
    expect(roomAvailabilityLabel(room({
      conflictPhase: "future",
      conflictSource: "shared_room",
      nextConflictFrom: "2026-08-20T06:00:00Z",
      reason: "미래 예약 있음",
    }))).toBe("2026. 08. 20.부터 예약 있음 · 같은 방 투숙");
  });

  it("distinguishes an effective-start overlap from generic history", () => {
    expect(roomAvailabilityLabel(room({
      conflictPhase: "effective_start_overlap",
      conflictSource: "long_stay",
      reason: "배정 시작 구간과 겹침",
    }))).toBe("배정 시작 구간과 겹침 · 장기호텔");
  });

  it("keeps assignable rooms concise", () => {
    expect(roomAvailabilityLabel(room({
      assignable: true,
      conflictSource: null,
      conflictPhase: null,
      reason: "사용 가능",
    }))).toBe("사용 가능");
  });
});
