import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { HotelStay } from "./hotelOperationsRepository";
import {
  hotelRoomBoardCheckInTime,
  hotelRoomBoardDropAction,
  hotelRoomBoardStage,
  hotelRoomBoardUnassigned,
} from "./HotelRoomBoard";

const stay = (overrides: Partial<HotelStay> = {}): HotelStay => ({
  id: "stay-1",
  dogId: "dog-1",
  dogName: "토리",
  customerId: null,
  customerName: null,
  customerPhone: null,
  version: 1,
  requestId: "request-1",
  checkedInAt: null,
  checkedInBy: null,
  checkedOutAt: null,
  checkedOutBy: null,
  createdBy: "profile-1",
  createdAt: "2026-08-05T00:00:00Z",
  updatedAt: "2026-08-05T00:00:00Z",
  archivedAt: null,
  capacityReservation: {
    id: "capacity-1",
    roomTypeId: "standard",
    roomTypeCode: "STANDARD",
    roomTypeName: "STANDARD",
    reservedFrom: "2026-08-05T06:00:00Z",
    reservedUntil: "2026-08-08T02:00:00Z",
    quantity: 1,
  },
  scheduleEvents: [
    {
      eventKind: "check_in",
      schedule: {
        id: "check-in",
        title: "토리 · 호텔링 · STANDARD · 입실",
        memo: null,
        startsAt: "2026-08-05T06:00:00Z",
        endsAt: "2026-08-05T07:00:00Z",
        timeUnspecified: false,
        status: "scheduled",
        calendarId: "hotel-calendar",
        scheduleTypeId: "hotel-stay",
        assignees: [],
      },
    },
    {
      eventKind: "check_out",
      schedule: {
        id: "check-out",
        title: "토리 · 호텔링 · STANDARD · 퇴실",
        memo: null,
        startsAt: "2026-08-08T02:00:00Z",
        endsAt: "2026-08-08T03:00:00Z",
        timeUnspecified: false,
        status: "scheduled",
        calendarId: "hotel-calendar",
        scheduleTypeId: "hotel-stay",
        assignees: [],
      },
    },
  ],
  roomAllocations: [],
  ...overrides,
});

describe("Hotel Room Board", () => {
  it("derives assign, reassign, and move from the existing Stay state", () => {
    const unassigned = stay();
    const assigned = stay({
      roomAllocations: [{
        id: "allocation-1",
        roomId: "room-1",
        roomName: "STANDARD-1",
        roomTypeId: "standard",
        allocatedFrom: "2026-08-05T06:00:00Z",
        allocatedUntil: "2026-08-08T02:00:00Z",
        assignmentReason: null,
        version: 1,
      }],
    });
    const checkedIn = stay({ ...assigned, checkedInAt: "2026-08-05T06:05:00Z" });
    const checkedOut = stay({ ...checkedIn, checkedOutAt: "2026-08-08T02:05:00Z" });

    expect(hotelRoomBoardDropAction(unassigned)).toBe("assign");
    expect(hotelRoomBoardDropAction(assigned)).toBe("reassign");
    expect(hotelRoomBoardDropAction(checkedIn)).toBe("move");
    expect(hotelRoomBoardDropAction(checkedOut)).toBeNull();
  });

  it("keeps only active unassigned reservations in the drag source", () => {
    const unassigned = stay({ id: "unassigned" });
    const assigned = stay({
      id: "assigned",
      roomAllocations: [{
        id: "allocation-1",
        roomId: "room-1",
        roomName: "STANDARD-1",
        roomTypeId: "standard",
        allocatedFrom: "2026-08-05T06:00:00Z",
        allocatedUntil: "2026-08-08T02:00:00Z",
        assignmentReason: null,
        version: 1,
      }],
    });
    expect(hotelRoomBoardUnassigned([unassigned, assigned])).toEqual([unassigned]);
  });

  it("uses the selected KST work date for board colors", () => {
    const reservation = stay();
    expect(hotelRoomBoardStage(reservation, "2026-08-05")).toBe("check_in");
    expect(hotelRoomBoardStage(reservation, "2026-08-06")).toBe("in_house");
    expect(hotelRoomBoardStage(reservation, "2026-08-08")).toBe("check_out");
  });

  it("shows the actual KST check-in time and hides technical time for unspecified schedules", () => {
    expect(hotelRoomBoardCheckInTime(stay())).toBe("15:00");
    const unspecified = stay({
      scheduleEvents: stay().scheduleEvents.map((event) =>
        event.eventKind === "check_in"
          ? {
              ...event,
              schedule: { ...event.schedule, timeUnspecified: true },
            }
          : event,
      ),
    });
    expect(hotelRoomBoardCheckInTime(unspecified)).toBe("시간 미정");
  });

  it("routes drops only through existing Hotel RPC repository functions", () => {
    const page = readFileSync(resolve(import.meta.dirname, "./HotelOperations.tsx"), "utf8");
    expect(page).toContain("assignHotelRoom(stay.id");
    expect(page).toContain("reassignHotelRoomBeforeCheckIn(stay.id");
    expect(page).toContain("moveHotelRoomSameType(stay.id");
    expect(page).not.toContain("from(\"hotel_room_allocations\")");
    expect(page).toContain("호실을 변경할 수 없습니다");
    expect(page).toContain("해당 기간에 다른 예약이 있습니다.");
    expect(page).toContain("카드 위치는 변경되지 않았습니다.");
  });

  it("keeps the physical room order in one fixed row per room type", () => {
    const board = readFileSync(resolve(import.meta.dirname, "./HotelRoomBoard.tsx"), "utf8");
    expect(board).toContain('"min-w-[720px] grid-cols-6"');
    expect(board).toContain('"min-w-[600px] grid-cols-5"');
    expect(board).not.toContain("2xl:grid-cols-6");
  });

  it("places the unassigned queue above the room rows as a horizontal strip", () => {
    const board = readFileSync(resolve(import.meta.dirname, "./HotelRoomBoard.tsx"), "utf8");
    expect(board).toContain("flex gap-3 overflow-x-auto");
    expect(board).toContain("flex-[0_0_260px]");
    expect(board).not.toContain("md:grid-cols-[minmax(260px,32%)");
  });

  it("separates eligible rooms, the active hover target, and duplicate drop protection", () => {
    const board = readFileSync(resolve(import.meta.dirname, "./HotelRoomBoard.tsx"), "utf8");
    expect(board).toContain("border-dashed border-primary/55");
    expect(board).toContain("isHoveredDropTarget");
    expect(board).toContain("border-2 border-solid border-primary");
    expect(board).toContain("if (dropCommittedRef.current) return");
  });

  it("keeps the legacy detail list available but collapsed by default", () => {
    const page = readFileSync(resolve(import.meta.dirname, "./HotelOperations.tsx"), "utf8");
    expect(page).toContain("useState(false)");
    expect(page).toContain("상세 현황 및 예약 목록");
    expect(page).toContain("showSupportDetails ? <>");
  });
});
