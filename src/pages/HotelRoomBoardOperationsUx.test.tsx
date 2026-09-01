// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  SharedHotelOccupancy,
  UnassignedSharedRoomGroup,
} from "../platform/multiDogSharedRoomContract";
import type {
  HotelOperationsSnapshot,
  HotelStay,
} from "./hotelOperationsRepository";
import {
  HotelRoomBoard,
  hotelRoomBoardCompletedCheckouts,
  hotelRoomBoardPhaseTime,
  hotelRoomBoardUnassignedGroups,
} from "./HotelRoomBoard";

afterEach(cleanup);

const schedule = (
  eventKind: "check_in" | "check_out",
  startsAt: string,
  timeUnspecified = false,
) => ({
  eventKind,
  schedule: {
    id: `${eventKind}-${startsAt}`,
    title: eventKind,
    memo: null,
    startsAt,
    endsAt: startsAt,
    timeUnspecified,
    status: "scheduled" as const,
    calendarId: "calendar-1",
    scheduleTypeId: "type-1",
    assignees: [],
  },
});

const stay = (overrides: Partial<HotelStay> = {}): HotelStay => ({
  id: "stay-1",
  dogId: "dog-1",
  dogName: "감자",
  customerId: "customer-1",
  customerName: "보호자",
  customerPhone: null,
  version: 1,
  requestId: "request-1",
  checkedInAt: null,
  checkedInBy: null,
  checkedOutAt: null,
  checkedOutBy: null,
  createdBy: "owner-1",
  createdAt: "2026-08-12T00:00:00Z",
  updatedAt: "2026-08-12T00:00:00Z",
  archivedAt: null,
  capacityReservation: {
    id: "capacity-1",
    roomTypeId: "deluxe",
    roomTypeCode: "DELUXE",
    roomTypeName: "DELUXE",
    reservedFrom: "2026-08-13T06:00:00Z",
    reservedUntil: "2026-08-15T02:00:00Z",
    quantity: 1,
  },
  scheduleEvents: [
    schedule("check_in", "2026-08-13T06:00:00Z"),
    schedule("check_out", "2026-08-15T02:00:00Z"),
  ],
  roomAllocations: [],
  ...overrides,
});

const allocatedStay = (overrides: Partial<HotelStay> = {}) => stay({
  checkedInAt: "2026-08-13T06:05:00Z",
  roomAllocations: [{
    id: "allocation-1",
    roomId: "room-1",
    roomName: "DELUXE 1",
    roomTypeId: "deluxe",
    allocatedFrom: "2026-08-13T06:00:00Z",
    allocatedUntil: "2026-08-15T02:00:00Z",
    assignmentReason: null,
    version: 1,
  }],
  ...overrides,
});

const snapshot = (
  stays: HotelStay[] = [],
  unassignedFuture: HotelStay[] = [],
): HotelOperationsSnapshot => ({
  date: "2026-08-13",
  roomTypes: [{
    id: "deluxe",
    code: "DELUXE",
    name: "DELUXE",
    activeRooms: 1,
    reservedPeak: 1,
    checkedInNow: 0,
    allocatedNow: 0,
    reservedNow: 1,
    unassignedNow: unassignedFuture.length,
    physicallyEmpty: 1,
  }],
  rooms: [{
    id: "room-1",
    name: "DELUXE 1",
    roomTypeId: "deluxe",
    roomTypeCode: "DELUXE",
    roomTypeName: "DELUXE",
    isActive: true,
    sortOrder: 1,
  }],
  settings: null,
  stays,
  unassignedFuture,
});

const boardProps = (value: HotelOperationsSnapshot, selectedDate: string) => ({
  snapshot: value,
  selectedDate,
  selectedDateIsToday: false,
  processing: false,
  allowCrossTypeChange: true,
  onOpenStay: vi.fn(),
  onDropStay: vi.fn(),
  onUnassignStay: vi.fn(),
});

describe("Hotel Room Board operations UX", () => {
  const unassignedSharedGroup = (members = [
    { familyBookingMemberId: "member-1", hotelStayId: "stay-1", dogId: "dog-1", dogName: "감자" },
    { familyBookingMemberId: "member-2", hotelStayId: "stay-2", dogId: "dog-2", dogName: "먼지" },
  ]): UnassignedSharedRoomGroup => ({
    sharedRoomGroupId: "shared-group-1",
    familyBookingId: "family-1",
    customerId: "customer-1",
    customerName: "보호자",
    dogMembers: members,
    dogCount: members.length,
    roomTypeId: "deluxe",
    roomTypeCode: "DELUXE",
    reservedFrom: "2026-08-13T06:00:00Z",
    reservedUntil: "2026-08-15T02:00:00Z",
    capacityReservationId: "shared-capacity-1",
    requestedCapacity: 1,
    status: "requested",
    version: 1,
  });

  it("renders one unassigned shared card and suppresses every member Stay card", () => {
    const dogA = stay();
    const dogB = stay({ id: "stay-2", dogId: "dog-2", dogName: "먼지" });
    render(
      <HotelRoomBoard
        {...boardProps(snapshot([dogA, dogB]), "2026-08-13")}
        unassignedSharedGroups={[unassignedSharedGroup()]}
      />,
    );
    const sharedCard = screen.getByTestId("hotel-room-board-unassigned-shared-shared-group-1");
    expect(sharedCard).toHaveTextContent("감자 · 먼지");
    expect(sharedCard).toHaveTextContent("함께 투숙");
    expect(sharedCard).toHaveTextContent("2마리 · 객실 1실");
    expect(screen.queryByTestId("hotel-room-board-stay-stay-1")).toBeNull();
    expect(screen.queryByTestId("hotel-room-board-stay-stay-2")).toBeNull();
    expect(screen.getByText("함께 투숙 예약은 객실 배정 전 개별 수정할 수 없습니다.")).toBeVisible();
  });

  it("keeps all three Dog names readable on one shared-group card", () => {
    const members = [
      { familyBookingMemberId: "member-1", hotelStayId: "stay-1", dogId: "dog-1", dogName: "감자" },
      { familyBookingMemberId: "member-2", hotelStayId: "stay-2", dogId: "dog-2", dogName: "먼지" },
      { familyBookingMemberId: "member-3", hotelStayId: "stay-3", dogId: "dog-3", dogName: "가을" },
    ];
    render(
      <HotelRoomBoard
        {...boardProps(snapshot([]), "2026-08-13")}
        unassignedSharedGroups={[unassignedSharedGroup(members)]}
      />,
    );
    const sharedCard = screen.getByTestId("hotel-room-board-unassigned-shared-shared-group-1");
    expect(sharedCard).toHaveTextContent("감자 · 먼지 · 가을");
    expect(sharedCard).toHaveTextContent("3마리 · 객실 1실");
  });

  it("keeps shared-only identity off single and independent unassigned Stay cards", () => {
    const dogA = stay();
    const dogB = stay({ id: "stay-2", dogId: "dog-2", dogName: "먼지" });
    render(<HotelRoomBoard {...boardProps(snapshot([dogA, dogB]), "2026-08-13")} />);
    ["stay-1", "stay-2"].forEach((stayId) => {
      const card = screen.getByTestId(`hotel-room-board-stay-${stayId}`);
      expect(card).not.toHaveTextContent("함께 투숙");
      expect(card).not.toHaveTextContent("객실 1실");
    });
  });

  it("routes a shared group only to an empty DELUXE room", () => {
    const value = snapshot([]);
    value.rooms = [
      ...value.rooms,
      {
        id: "standard-1",
        name: "STANDARD 1",
        roomTypeId: "standard",
        roomTypeCode: "STANDARD",
        roomTypeName: "STANDARD",
        isActive: true,
        sortOrder: 2,
      },
    ];
    const onDropSharedGroup = vi.fn();
    render(
      <HotelRoomBoard
        {...boardProps(value, "2026-08-13")}
        unassignedSharedGroups={[unassignedSharedGroup()]}
        onDropSharedGroup={onDropSharedGroup}
      />,
    );
    fireEvent.click(screen.getByLabelText("감자 · 먼지 객실 배정 시작"));
    expect(screen.getByRole("status")).toHaveTextContent("디럭스 객실에만");
    fireEvent.pointerDown(screen.getByTestId("hotel-room-board-room-standard-1"));
    expect(onDropSharedGroup).not.toHaveBeenCalled();
    fireEvent.pointerDown(screen.getByTestId("hotel-room-board-room-room-1"));
    expect(onDropSharedGroup).toHaveBeenCalledTimes(1);
    expect(onDropSharedGroup).toHaveBeenCalledWith("shared-group-1", "room-1");
  });

  it("resolves phase-aware times without substituting the opposite schedule", () => {
    const hotelStay = stay();
    expect(hotelRoomBoardPhaseTime(hotelStay, "2026-08-13")).toBe("입실 15:00");
    expect(hotelRoomBoardPhaseTime(hotelStay, "2026-08-14")).toBe("퇴실 8/15 11:00");
    expect(hotelRoomBoardPhaseTime(hotelStay, "2026-08-15")).toBe("퇴실 11:00");

    const checkInUnknown = stay({
      scheduleEvents: [
        schedule("check_in", "2026-08-13T06:00:00Z", true),
        schedule("check_out", "2026-08-15T02:00:00Z"),
      ],
    });
    expect(hotelRoomBoardPhaseTime(checkInUnknown, "2026-08-13")).toBe("입실 시간 미정");

    const checkOutUnknown = stay({
      scheduleEvents: [
        schedule("check_in", "2026-08-13T06:00:00Z"),
        schedule("check_out", "2026-08-15T02:00:00Z", true),
      ],
    });
    expect(hotelRoomBoardPhaseTime(checkOutUnknown, "2026-08-15")).toBe("퇴실 시간 미정");
    expect(hotelRoomBoardPhaseTime(checkOutUnknown, "2026-08-14")).toBe("퇴실 8/15 · 시간 미정");
  });

  it("uses the compact same-day contract and omits fabricated Long Stay checkout time", () => {
    const sameDay = stay({
      scheduleEvents: [
        schedule("check_in", "2026-08-13T06:00:00Z"),
        schedule("check_out", "2026-08-13T10:00:00Z"),
      ],
    });
    expect(hotelRoomBoardPhaseTime(sameDay, "2026-08-13")).toBe("15:00 → 19:00");

    const openEnded = allocatedStay({
      capacityReservation: {
        ...stay().capacityReservation!,
        reservedUntil: "infinity",
      },
      scheduleEvents: [schedule("check_in", "2026-08-13T06:00:00Z")],
    });
    expect(hotelRoomBoardPhaseTime(openEnded, "2026-08-14")).toBeNull();

    const plannedLongStay = allocatedStay({ dogName: "장기호텔견" });
    expect(hotelRoomBoardPhaseTime(plannedLongStay, "2026-08-14")).toBe("퇴실 8/15 11:00");

    const nextYear = stay({
      scheduleEvents: [
        schedule("check_in", "2026-12-30T06:00:00Z"),
        schedule("check_out", "2027-01-02T02:00:00Z"),
      ],
    });
    expect(hotelRoomBoardPhaseTime(nextYear, "2026-12-31")).toBe("퇴실 2027. 1. 2. 11:00");
  });

  it("renders the selected-date phase time through the actual room card", () => {
    const hotelStay = allocatedStay();
    const { rerender } = render(<HotelRoomBoard {...boardProps(snapshot([hotelStay]), "2026-08-13")} />);
    expect(screen.getByTestId("hotel-room-board-stay-stay-1")).toHaveTextContent("입실 15:00");

    rerender(<HotelRoomBoard {...boardProps(snapshot([hotelStay]), "2026-08-14")} />);
    expect(screen.getByTestId("hotel-room-board-stay-stay-1")).toHaveTextContent("퇴실 8/15 11:00");

    rerender(<HotelRoomBoard {...boardProps(snapshot([hotelStay]), "2026-08-15")} />);
    expect(screen.getByTestId("hotel-room-board-stay-stay-1")).toHaveTextContent("퇴실 11:00");
  });

  it("groups and sorts unassigned stays by the selected business date", () => {
    const overdue = stay({ id: "overdue", dogName: "어제", scheduleEvents: [schedule("check_in", "2026-08-12T06:00:00Z"), schedule("check_out", "2026-08-16T02:00:00Z")] });
    const todayEarly = stay({ id: "today-early", dogName: "오늘오전", scheduleEvents: [schedule("check_in", "2026-08-13T01:00:00Z"), schedule("check_out", "2026-08-16T02:00:00Z")] });
    const todayUnknown = stay({ id: "today-unknown", dogName: "오늘미정", scheduleEvents: [schedule("check_in", "2026-08-13T00:00:00Z", true), schedule("check_out", "2026-08-16T02:00:00Z")] });
    const future = stay({ id: "future", dogName: "내일", scheduleEvents: [schedule("check_in", "2026-08-14T06:00:00Z"), schedule("check_out", "2026-08-16T02:00:00Z")] });
    const groups = hotelRoomBoardUnassignedGroups([future, todayUnknown, overdue, todayEarly], "2026-08-13");

    expect(groups.overdue.map((item) => item.id)).toEqual(["overdue"]);
    expect(groups.today.map((item) => item.id)).toEqual(["today-early", "today-unknown"]);
    expect(groups.future.map((item) => item.id)).toEqual(["future"]);
    expect(hotelRoomBoardUnassignedGroups([future], "2026-08-14").today[0]?.id).toBe("future");
  });

  it("renders overdue and today separately while keeping future reservations collapsed", () => {
    const overdue = stay({ id: "overdue", dogName: "미처리견", scheduleEvents: [schedule("check_in", "2026-08-12T06:00:00Z"), schedule("check_out", "2026-08-16T02:00:00Z")] });
    const today = stay({ id: "today", dogName: "오늘견" });
    const future = stay({ id: "future", dogName: "미래견", scheduleEvents: [schedule("check_in", "2026-08-14T06:00:00Z"), schedule("check_out", "2026-08-16T02:00:00Z")] });
    render(<HotelRoomBoard {...boardProps(snapshot([], [future, overdue, today]), "2026-08-13")} />);

    expect(within(screen.getByRole("region", { name: "오늘 입실 미배정" })).getByText("오늘견")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "미처리 미배정" })).getByText("미처리견")).toBeInTheDocument();
    expect(screen.queryByText("미래견")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "1건 펼쳐보기" }));
    expect(screen.getByText("미래견")).toBeInTheDocument();
  });

  it("renders every unassigned section before the DELUXE and STANDARD room grids", () => {
    const today = stay({ id: "today", dogName: "오늘견" });
    const future = stay({ id: "future", dogName: "미래견", scheduleEvents: [schedule("check_in", "2026-08-14T06:00:00Z"), schedule("check_out", "2026-08-16T02:00:00Z")] });
    render(<HotelRoomBoard {...boardProps(snapshot([], [today, future]), "2026-08-13")} />);

    const unassigned = screen.getByTestId("hotel-room-board-unassigned-drop-zone");
    const futureSection = screen.getByRole("region", { name: "향후 입실 미배정" });
    const deluxe = screen.getByRole("region", { name: "DELUXE Room Board" });
    const standard = screen.getByRole("region", { name: "STANDARD Room Board" });
    expect(unassigned.compareDocumentPosition(deluxe) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(futureSection.compareDocumentPosition(deluxe) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(unassigned.compareDocumentPosition(standard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("provides a mobile-sized move handle and preserves the tap-select room target flow", () => {
    const hotelStay = allocatedStay();
    const value = snapshot([hotelStay]);
    value.roomTypes[0] = { ...value.roomTypes[0], activeRooms: 2 };
    value.rooms.push({
      id: "room-2",
      name: "DELUXE 2",
      roomTypeId: "deluxe",
      roomTypeCode: "DELUXE",
      roomTypeName: "DELUXE",
      isActive: true,
      sortOrder: 2,
    });
    const onDropStay = vi.fn();
    render(<HotelRoomBoard {...boardProps(value, "2026-08-14")} onDropStay={onDropStay} />);

    const handle = screen.getByRole("button", { name: "감자 호실 이동 시작" });
    expect(handle).toHaveClass("h-11", "w-11", "sm:h-8", "sm:w-8");
    fireEvent.click(handle);
    fireEvent.pointerDown(screen.getByTestId("hotel-room-board-room-room-2"));

    expect(onDropStay).toHaveBeenCalledWith("stay-1", "room-2", false);
    expect(screen.getByText("이동 아이콘을 누른 뒤 대상 호실을 누르세요")).toHaveClass("sm:hidden");
  });

  it("moves a future reservation into today when the selected date changes", () => {
    const future = stay({ id: "future", dogName: "날짜이동견", scheduleEvents: [schedule("check_in", "2026-08-14T06:00:00Z"), schedule("check_out", "2026-08-16T02:00:00Z")] });
    const value = snapshot([], [future]);
    const { rerender } = render(<HotelRoomBoard {...boardProps(value, "2026-08-13")} />);
    expect(screen.getByRole("region", { name: "향후 입실 미배정" })).toBeInTheDocument();

    rerender(<HotelRoomBoard {...boardProps(value, "2026-08-14")} />);
    expect(within(screen.getByRole("region", { name: "오늘 입실 미배정" })).getByText("날짜이동견")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "향후 입실 미배정" })).not.toBeInTheDocument();
  });

  it("projects completed checkouts by actual KST checkout date and time", () => {
    const completed = allocatedStay({
      id: "completed",
      dogName: "퇴실견",
      checkedOutAt: "2026-08-15T03:32:00Z",
      checkedOutBy: "owner-1",
    });
    expect(hotelRoomBoardCompletedCheckouts([completed], "2026-08-15")).toHaveLength(1);
    expect(hotelRoomBoardCompletedCheckouts([completed], "2026-08-14")).toHaveLength(0);

    render(<HotelRoomBoard {...boardProps(snapshot([completed]), "2026-08-15")} />);
    expect(screen.getByTestId("hotel-room-board-completed-checkouts")).toHaveTextContent("퇴실견");
    expect(screen.getByTestId("hotel-room-board-completed-checkouts")).toHaveTextContent("DELUXE 1");
    expect(screen.getByTestId("hotel-room-board-completed-checkouts")).toHaveTextContent("12:32");
    expect(screen.queryByTestId("hotel-room-board-stay-completed")).not.toBeInTheDocument();
  });

  it("keeps an active shared-room dog on the room card and only lists the completed dog", () => {
    const completed = allocatedStay({ id: "stay-a", dogId: "dog-a", dogName: "몽이", checkedOutAt: "2026-08-15T02:10:00Z", checkedOutBy: "owner-1" });
    const active = allocatedStay({ id: "stay-b", dogId: "dog-b", dogName: "보리" });
    const occupancy: SharedHotelOccupancy = {
      id: "occupancy-1",
      familyBookingId: "family-1",
      sharedRoomGroupId: "group-1",
      customerId: "customer-1",
      roomTypeId: "deluxe",
      roomTypeCode: "DELUXE",
      roomId: "room-1",
      roomName: "DELUXE 1",
      occupiedFrom: "2026-08-13T06:00:00Z",
      occupiedUntil: "2026-08-16T02:00:00Z",
      status: "active",
      version: 2,
      capacityReservationId: "shared-capacity",
      roomAllocationId: "shared-allocation",
      capacityUsed: 1,
      dogCount: 2,
      members: [
        { id: "member-a", familyBookingMemberId: "family-member-a", hotelStayId: "stay-a", dogId: "dog-a", dogName: "몽이", status: "completed", joinedAt: "2026-08-13T06:00:00Z", leftAt: "2026-08-15T02:10:00Z" },
        { id: "member-b", familyBookingMemberId: "family-member-b", hotelStayId: "stay-b", dogId: "dog-b", dogName: "보리", status: "active", joinedAt: "2026-08-13T06:00:00Z", leftAt: null },
      ],
    };
    render(<HotelRoomBoard {...boardProps(snapshot([]), "2026-08-15")} sharedOccupancies={[occupancy]} sharedMemberStays={[completed, active]} />);

    expect(screen.getByTestId("shared-room-card-occupancy-1")).toHaveTextContent("보리");
    expect(screen.getByTestId("shared-room-card-occupancy-1")).not.toHaveTextContent("몽이");
    expect(screen.getByTestId("hotel-room-board-completed-checkouts")).toHaveTextContent("몽이");
    expect(screen.getByTestId("hotel-room-board-completed-checkouts")).not.toHaveTextContent("보리");
  });

  it("renders each dog-specific checkout date in a compact three-dog Shared Room card", () => {
    const dogA = allocatedStay({ id: "stay-a", dogId: "dog-a", dogName: "아주긴이름의망치", scheduleEvents: [schedule("check_in", "2026-08-13T06:00:00Z"), schedule("check_out", "2026-08-15T10:00:00Z")] });
    const dogB = allocatedStay({ id: "stay-b", dogId: "dog-b", dogName: "펀치", scheduleEvents: [schedule("check_in", "2026-08-13T06:00:00Z"), schedule("check_out", "2026-08-16T02:00:00Z")] });
    const dogC = allocatedStay({ id: "stay-c", dogId: "dog-c", dogName: "콩이", capacityReservation: { ...allocatedStay().capacityReservation!, reservedUntil: "infinity" }, scheduleEvents: [schedule("check_in", "2026-08-13T06:00:00Z")] });
    const members = [dogA, dogB, dogC].map((memberStay, index) => ({
      id: `member-${index}`,
      familyBookingMemberId: `family-member-${index}`,
      hotelStayId: memberStay.id,
      dogId: memberStay.dogId,
      dogName: memberStay.dogName,
      status: "active" as const,
      joinedAt: "2026-08-13T06:00:00Z",
      leftAt: null,
    }));
    const occupancy: SharedHotelOccupancy = {
      id: "occupancy-three",
      familyBookingId: "family-1",
      sharedRoomGroupId: "group-1",
      customerId: "customer-1",
      roomTypeId: "deluxe",
      roomTypeCode: "DELUXE",
      roomId: "room-1",
      roomName: "DELUXE 1",
      occupiedFrom: "2026-08-13T06:00:00Z",
      occupiedUntil: "infinity",
      status: "active",
      version: 1,
      capacityReservationId: "shared-capacity",
      roomAllocationId: "shared-allocation",
      capacityUsed: 1,
      dogCount: 3,
      members,
    };
    render(<HotelRoomBoard {...boardProps(snapshot([]), "2026-08-14")} sharedOccupancies={[occupancy]} sharedMemberStays={[dogA, dogB, dogC]} />);

    const card = screen.getByTestId("shared-room-card-occupancy-three");
    expect(card).toHaveTextContent("퇴실 8/15 19:00");
    expect(card).toHaveTextContent("퇴실 8/16 11:00");
    expect(card).not.toHaveTextContent("infinity");
    expect(screen.getByText("아주긴이름의망치")).toHaveClass("truncate");
    expect(card).toHaveTextContent("함께 투숙 · 3마리");
    expect(card).toHaveTextContent("3마리 · 객실 1실");
  });

  it("includes a completed Long Stay naturally without inventing a separate color system", () => {
    const longStay = allocatedStay({
      id: "long-stay",
      dogName: "장기견",
      checkedOutAt: "2026-08-15T01:00:00Z",
      checkedOutBy: "owner-1",
    });
    render(<HotelRoomBoard {...boardProps(snapshot([longStay]), "2026-08-15")} />);
    expect(screen.getByTestId("hotel-room-board-completed-checkouts")).toHaveTextContent("장기견");
  });
});
