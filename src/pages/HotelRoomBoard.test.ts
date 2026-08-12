import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import type { SharedHotelOccupancy } from "../platform/multiDogSharedRoomContract";
import type {
  HotelRoomSnapshot,
  HotelStay,
} from "./hotelOperationsRepository";
import {
  canDropHotelStayToUnassigned,
  hotelRoomBoardCheckInTime,
  hotelRoomBoardDogStatus,
  hotelRoomBoardDropAction,
  hotelRoomBoardOccupiesRoom,
  hotelRoomBoardRoomTarget,
  hotelRoomBoardRecommendedRoom,
  hotelRoomBoardStage,
  hotelRoomBoardUnassigned,
  isHotelRoomBoardDragGesture,
  SharedRoomCard,
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
  it("uses compact canonical labels for single-Dog lifecycle states", () => {
    expect(hotelRoomBoardDogStatus(stay(), "2026-08-05")).toEqual({ label: "입실", stage: "check_in" });
    expect(hotelRoomBoardDogStatus(stay({ checkedInAt: "2026-08-05T06:05:00Z" }), "2026-08-06")).toEqual({ label: "이용중", stage: "in_house" });
    expect(hotelRoomBoardDogStatus(stay({ checkedInAt: "2026-08-05T06:05:00Z" }), "2026-08-08")).toEqual({ label: "퇴실", stage: "check_out" });
    expect(hotelRoomBoardDogStatus(stay({ checkedInAt: "2026-08-05T06:05:00Z", checkedOutAt: "2026-08-08T02:05:00Z" }), "2026-08-08")).toEqual({ label: "완료", stage: "check_out" });
  });

  it("renders each active Shared Room Dog with its own mixed lifecycle badge", () => {
    const occupancy: SharedHotelOccupancy = {
      id: "shared-1", familyBookingId: "family-1", sharedRoomGroupId: "group-1",
      customerId: "customer-1", roomTypeId: "deluxe", roomTypeCode: "DELUXE",
      roomId: "deluxe-2", roomName: "DELUXE 2", occupiedFrom: "2026-08-05T06:00:00Z",
      occupiedUntil: "2026-08-08T02:00:00Z", status: "active", version: 1,
      capacityReservationId: "capacity-1", roomAllocationId: "allocation-1",
      capacityUsed: 1, dogCount: 3,
      members: [
        { id: "member-a", familyBookingMemberId: "family-a", hotelStayId: "stay-a", dogId: "dog-a", dogName: "망치", status: "active", joinedAt: "2026-08-05T06:00:00Z", leftAt: null },
        { id: "member-b", familyBookingMemberId: "family-b", hotelStayId: "stay-b", dogId: "dog-b", dogName: "몽치", status: "active", joinedAt: "2026-08-05T06:00:00Z", leftAt: null },
        { id: "member-c", familyBookingMemberId: "family-c", hotelStayId: "stay-c", dogId: "dog-c", dogName: "아주긴이름의반려견세번째", status: "active", joinedAt: "2026-08-05T06:00:00Z", leftAt: null },
      ],
    };
    const staysById = new Map([
      ["stay-a", stay({ id: "stay-a", dogName: "망치", checkedInAt: "2026-08-05T06:05:00Z" })],
      ["stay-b", stay({ id: "stay-b", dogName: "몽치", scheduleEvents: stay().scheduleEvents.map((event) => event.eventKind === "check_in" ? { ...event, schedule: { ...event.schedule, startsAt: "2026-08-06T06:00:00Z" } } : event) })],
      ["stay-c", stay({ id: "stay-c", dogName: "아주긴이름의반려견세번째", checkedInAt: "2026-08-05T06:05:00Z" })],
    ]);
    const markup = renderToStaticMarkup(createElement(SharedRoomCard, { occupancy, staysById, selectedDate: "2026-08-06", onOpen: () => undefined }));
    expect(markup).toContain("망치");
    expect(markup).toContain("몽치");
    expect(markup).toContain("아주긴이름의반려견세번째");
    expect(markup).toContain("이용중");
    expect(markup).toContain("입실");
    expect(markup).toContain("Shared Room · 3마리");
    expect(markup).toContain("truncate");
  });

  it("keeps a partial-checkout member out while preserving the remaining Dog status", () => {
    const active = { id: "member-a", familyBookingMemberId: "family-a", hotelStayId: "stay-a", dogId: "dog-a", dogName: "망치", status: "active" as const, joinedAt: "2026-08-05T06:00:00Z", leftAt: null };
    const occupancy = {
      id: "shared-2", familyBookingId: "family-1", sharedRoomGroupId: "group-1", customerId: "customer-1",
      roomTypeId: "deluxe", roomTypeCode: "DELUXE" as const, roomId: "deluxe-2", roomName: "DELUXE 2",
      occupiedFrom: "2026-08-05T06:00:00Z", occupiedUntil: "2026-08-08T02:00:00Z", status: "active" as const,
      version: 2, capacityReservationId: "capacity-1", roomAllocationId: "allocation-1", capacityUsed: 1 as const,
      dogCount: 2, members: [active, { ...active, id: "member-b", hotelStayId: "stay-b", dogId: "dog-b", dogName: "몽치", status: "completed" as const, leftAt: "2026-08-07T02:00:00Z" }],
    };
    const markup = renderToStaticMarkup(createElement(SharedRoomCard, { occupancy, staysById: new Map([["stay-a", stay({ id: "stay-a", checkedInAt: "2026-08-05T06:05:00Z" })]]), selectedDate: "2026-08-07", onOpen: () => undefined }));
    expect(markup).toContain("망치");
    expect(markup).toContain("이용중");
    expect(markup).not.toContain("몽치");
    expect(markup).toContain("Shared Room · 1마리");
  });
  it("separates a short card click from an intentional drag gesture", () => {
    expect(isHotelRoomBoardDragGesture(2, 3)).toBe(false);
    expect(isHotelRoomBoardDragGesture(6, 2)).toBe(false);
    expect(isHotelRoomBoardDragGesture(7, 0)).toBe(true);
    expect(isHotelRoomBoardDragGesture(5, 5)).toBe(true);
  });

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
    expect(hotelRoomBoardOccupiesRoom(checkedIn)).toBe(true);
    expect(hotelRoomBoardOccupiesRoom(checkedOut)).toBe(false);
    expect(hotelRoomBoardOccupiesRoom({ ...checkedOut, checkedOutAt: null })).toBe(true);
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

  it("allows pre-check-in unassignment and blocks it after check-in", () => {
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
    expect(canDropHotelStayToUnassigned(assigned)).toBe(true);
    expect(
      canDropHotelStayToUnassigned({
        ...assigned,
        checkedInAt: "2026-08-05T06:05:00Z",
      }),
    ).toBe(false);
  });

  it("distinguishes same-type and cross-type room targets", () => {
    const assigned = stay({
      roomAllocations: [{
        id: "allocation-1",
        roomId: "standard-1",
        roomName: "STANDARD-1",
        roomTypeId: "standard",
        allocatedFrom: "2026-08-05T06:00:00Z",
        allocatedUntil: "2026-08-08T02:00:00Z",
        assignmentReason: null,
        version: 1,
      }],
    });
    const baseRoom = {
      id: "standard-2",
      name: "STANDARD-2",
      roomTypeId: "standard",
      roomTypeCode: "STANDARD",
      roomTypeName: "STANDARD",
      isActive: true,
      sortOrder: 2,
    };
    expect(hotelRoomBoardRoomTarget(assigned, baseRoom, false)).toBe("same_type");
    expect(
      hotelRoomBoardRoomTarget(
        assigned,
        {
          ...baseRoom,
          id: "deluxe-1",
          name: "DELUXE-1",
          roomTypeId: "deluxe",
          roomTypeCode: "DELUXE",
          roomTypeName: "DELUXE",
        },
        false,
      ),
    ).toBe("change_type");
    expect(hotelRoomBoardRoomTarget(assigned, baseRoom, true)).toBe("blocked");
  });

  it("recommends the closest empty room in the existing room type", () => {
    const rooms: HotelRoomSnapshot[] = [1, 2, 3, 4].map((sortOrder) => ({
      id: `standard-${sortOrder}`,
      name: `STANDARD-${sortOrder}`,
      roomTypeId: "standard",
      roomTypeCode: "STANDARD",
      roomTypeName: "STANDARD",
      isActive: true,
      sortOrder,
    }));
    const assigned = stay({
      roomAllocations: [{
        id: "allocation-1",
        roomId: "standard-3",
        roomName: "STANDARD-3",
        roomTypeId: "standard",
        allocatedFrom: "2026-08-05T06:00:00Z",
        allocatedUntil: "2026-08-08T02:00:00Z",
        assignmentReason: null,
        version: 1,
      }],
    });
    expect(
      hotelRoomBoardRecommendedRoom(
        assigned,
        rooms,
        new Set(["standard-2", "standard-3"]),
      )?.id,
    ).toBe("standard-4");
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

  it("routes same-type and cross-type drops only through Hotel RPC repository functions", () => {
    const page = readFileSync(resolve(import.meta.dirname, "./HotelOperations.tsx"), "utf8");
    expect(page).toContain("assignHotelRoom(stay.id");
    expect(page).toContain("reassignHotelRoomBeforeCheckIn(stay.id");
    expect(page).toContain("moveHotelRoomSameType(stay.id");
    expect(page).toContain("unassignHotelRoomBeforeCheckIn(");
    expect(page).toContain("changeRoomTypeBeforeCheckIn(");
    expect(page).toContain("changeRoomTypeAfterCheckIn(");
    expect(page).not.toContain("from(\"hotel_room_allocations\")");
    expect(page).toContain("호실을 변경할 수 없습니다");
    expect(page).toContain("해당 기간에 다른 예약이 있습니다.");
    expect(page).toContain("카드 위치는 변경되지 않았습니다.");
    expect(page).toContain("호실 배정을 해제할까요?");
    expect(page).toContain("객실 유형을 변경할까요?");
    expect(page).toContain("이전 유형");
    expect(page).toContain("새 유형");
    expect(page).toContain("이전 호실");
    expect(page).toContain("새 호실");
    expect(page).toContain("allowCrossTypeChange={isSettingsManager}");
  });

  it("keeps the physical room order in one fixed row per room type", () => {
    const board = readFileSync(resolve(import.meta.dirname, "./HotelRoomBoard.tsx"), "utf8");
    expect(board).toContain('"min-w-[720px] grid-cols-6"');
    expect(board).toContain('"min-w-[600px] grid-cols-5"');
    expect(board).not.toContain("2xl:grid-cols-6");
    expect(board).toContain('className="mb-6 overflow-hidden"');
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
    expect(board).toContain('targetState !== "change_type" || allowCrossTypeChange');
    expect(board).toContain("hotelRoomBoardRecommendedRoom");
    expect(board).toContain("같은 유형에서 가장 가까운 빈 호실");
    expect(board).toContain("ring-emerald-300/45");
    expect(board).toContain("scale-[1.04]");
    expect(board).toContain("rotate-[1.25deg]");
    expect(board).toContain("hotel-room-drop-settle");
    expect(board).toContain("hotel-room-card-return");
    expect(board).toContain("hotel-room-card-absorb");
    expect(board).toContain("data-room-phase");
    expect(board).toContain("stageBadgeClass");
    expect(board).toContain("min-h-[5.5rem]");
    expect(board).toContain("setDragImage(preview, offsetX, offsetY)");
    expect(board).toContain("같은 유형에서 가장 가까운 빈 호실");
  });

  it("offers a five-second undo using only existing Hotel room RPCs", () => {
    const page = readFileSync(resolve(import.meta.dirname, "./HotelOperations.tsx"), "utf8");
    expect(page).toContain("offerRoomBoardUndo");
    expect(page).toContain("}, 5000)");
    expect(page).toContain("배정 취소");
    expect(page).toContain("Room Board 직전 배정 취소");
    expect(page).toContain("Room Board 재배정 되돌리기");
    expect(page).toContain("Room Board 객실 유형 이동 되돌리기");
    expect(page).not.toContain("from(\"hotel_room_allocations\")");
  });

  it("finishes a first room assignment without opening a second check-in modal", () => {
    const page = readFileSync(resolve(import.meta.dirname, "./HotelOperations.tsx"), "utf8");
    expect(page).not.toContain('hotelStayDayPhase(latestStay, selectedDate) === "입실"');
    expect(page).toContain('message: allocation ? "호실을 변경했습니다." : "호실을 배정했습니다."');
  });

  it("keeps Room Board versions fresh and blocks duplicate in-flight mutations", () => {
    const page = readFileSync(resolve(import.meta.dirname, "./HotelOperations.tsx"), "utf8");
    expect(page).toContain("latestRoomBoardStayRef");
    expect(page).toContain("rememberLatestRoomBoardStay(returnedStay)");
    expect(page).toContain("roomBoardInFlightRef.current.has(stay.id)");
    expect(page).toContain("roomBoardInFlightRef.current.add(stay.id)");
    expect(page).toContain("roomBoardInFlightRef.current.delete(stay.id)");
    expect(page).toContain("refreshRoomBoardAfterFailure(stay.id)");
    expect(page).toContain("const operationRequestId = requestId()");
  });

  it("keeps cross-type moves to one confirmation and makes in-house reason optional", () => {
    const page = readFileSync(resolve(import.meta.dirname, "./HotelOperations.tsx"), "utf8");
    expect(page).toContain('title="객실 유형을 변경할까요?"');
    expect(page).toContain('label="이동 사유 (선택)"');
    expect(page).toContain("useCurrentTime: Boolean(stay.checkedInAt)");
    expect(page).toContain("pendingRoomBoardAction.useCurrentTime");
    expect(page).toContain("new Date().toISOString()");
    expect(page).toContain("입력하지 않으면 기본 사유로 기록됩니다.");
  });

  it("promotes the Room Board summary and keeps the reservation list collapsed", () => {
    const board = readFileSync(resolve(import.meta.dirname, "./HotelRoomBoard.tsx"), "utf8");
    const page = readFileSync(resolve(import.meta.dirname, "./HotelOperations.tsx"), "utf8");
    expect(board).toContain("객실 현황");
    expect(board).toContain('["빈방", boardSummary.empty');
    expect(board).toContain('["이용중", boardSummary.inHouse');
    expect(board).toContain('["미배정", boardSummary.unassigned');
    expect(board).toContain('selectedDateIsToday ? "오늘 입실" : "입실"');
    expect(board).toContain('selectedDateIsToday ? "오늘 퇴실" : "퇴실"');
    expect(page).toContain("useState(false)");
    expect(page).toContain("예약 목록");
    expect(page).not.toContain("상세 현황 및 예약 목록");
    expect(page).toContain("showSupportDetails ? (");
  });
});
