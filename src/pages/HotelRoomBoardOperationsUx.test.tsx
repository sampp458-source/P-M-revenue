// @vitest-environment jsdom

import { readFileSync } from "node:fs";
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

afterEach(() => {
  cleanup();
  document.querySelectorAll('[style*="left: -1000px"]').forEach((node) => node.remove());
});

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
  dateMode: "FUTURE" as const, selectedDateIsToday: false,
  processing: false,
  allowCrossTypeChange: true,
  onOpenStay: vi.fn(),
  onDropStay: vi.fn(),
  onUnassignStay: vi.fn(),
  onUnassignSharedOccupancy: vi.fn(),
});

const sharedOccupancy = (
  overrides: Partial<SharedHotelOccupancy> = {},
): SharedHotelOccupancy => ({
  id: "occupancy-1",
  familyBookingId: "family-1",
  sharedRoomGroupId: "group-1",
  customerId: "customer-1",
  roomTypeId: "deluxe",
  roomTypeCode: "DELUXE",
  roomId: "room-1",
  roomName: "DELUXE 1",
  occupiedFrom: "2026-08-13T06:00:00Z",
  occupiedUntil: "2026-08-15T02:00:00Z",
  status: "active",
  version: 4,
  capacityReservationId: "shared-capacity-1",
  roomAllocationId: "shared-allocation-1",
  capacityUsed: 1,
  dogCount: 2,
  members: [
    { id: "member-1", familyBookingMemberId: "family-member-1", hotelStayId: "stay-1", dogId: "dog-1", dogName: "감자", status: "active", joinedAt: "2026-08-13T06:00:00Z", leftAt: null },
    { id: "member-2", familyBookingMemberId: "family-member-2", hotelStayId: "stay-2", dogId: "dog-2", dogName: "먼지", status: "active", joinedAt: "2026-08-13T06:00:00Z", leftAt: null },
  ],
  ...overrides,
});

function dragTransfer() {
  const values = new Map<string, string>();
  return {
    effectAllowed: "none",
    dropEffect: "none",
    setData: vi.fn((type: string, value: string) => values.set(type, value)),
    getData: vi.fn((type: string) => values.get(type) ?? ""),
    setDragImage: vi.fn(),
  } as unknown as DataTransfer;
}

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

  it("routes requested Shared Room cancellation as one group-level action", () => {
    const cancel = vi.fn();
    render(
      <HotelRoomBoard
        {...boardProps(snapshot([]), "2026-08-13")}
        unassignedSharedGroups={[unassignedSharedGroup()]}
        onCancelSharedGroup={cancel}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "예약 취소" }));
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledWith("shared-group-1");
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

  it("distinguishes a failed Shared Group read from a real zero result and retries only that read", () => {
    const retry = vi.fn();
    const { rerender } = render(
      <HotelRoomBoard
        {...boardProps(snapshot([]), "2026-08-13")}
        unassignedSharedGroupsError="함께 투숙 미배정 예약을 불러오지 못했습니다."
        onRetryUnassignedSharedGroups={retry}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "함께 투숙 미배정 예약을 불러오지 못했습니다.",
    );
    expect(screen.getByText("다른 관련 기록은 계속 확인할 수 있습니다. 함께 투숙 예약만 다시 확인해 주세요.")).toBeVisible();
    expect(screen.queryByText("현재 미배정 예약이 없습니다.")).toBeNull();
    expect(screen.getAllByText("확인 필요").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("heading", { name: "선택일 예약·배정 계획" })).toBeVisible();

    rerender(
      <HotelRoomBoard
        {...boardProps(snapshot([]), "2026-08-13")}
        unassignedSharedGroups={[unassignedSharedGroup()]}
        onRetryUnassignedSharedGroups={retry}
      />,
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(
      screen.getByTestId("hotel-room-board-unassigned-shared-shared-group-1"),
    ).toBeVisible();
  });

  it("keeps the canonical empty state when the Shared Group read succeeds with zero rows", () => {
    render(
      <HotelRoomBoard
        {...boardProps(snapshot([]), "2026-08-13")}
        unassignedSharedGroups={[]}
      />,
    );

    expect(screen.getByText("현재 미배정 예약이 없습니다.")).toBeVisible();
    expect(screen.queryByRole("alert")).toBeNull();
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

  it("routes a pre-check-in Single card drop on the unassigned zone through one unassign request", () => {
    const hotelStay = allocatedStay({ checkedInAt: null, checkedInBy: null });
    const onUnassignStay = vi.fn();
    render(
      <HotelRoomBoard
        {...boardProps(snapshot([hotelStay]), "2026-08-13")}
        onUnassignStay={onUnassignStay}
      />,
    );
    const transfer = dragTransfer();
    const card = screen.getByTestId("hotel-room-board-stay-stay-1");
    fireEvent.dragStart(card, {
      dataTransfer: transfer,
    });
    const zone = screen.getByTestId("hotel-room-board-unassigned-drop-zone");
    fireEvent.dragOver(zone, { dataTransfer: transfer });
    expect(zone).toHaveTextContent("여기에 놓으면 객실 배정이 해제됩니다");
    fireEvent.drop(zone, { dataTransfer: transfer });
    fireEvent.dragEnd(card, {
      dataTransfer: transfer,
    });
    expect(onUnassignStay).toHaveBeenCalledTimes(1);
    expect(onUnassignStay).toHaveBeenCalledWith("stay-1");
  });

  it("routes a pre-check-in Shared card drop through one atomic shared unassign request", () => {
    const memberA = stay();
    const memberB = stay({ id: "stay-2", dogId: "dog-2", dogName: "먼지" });
    const onUnassignSharedOccupancy = vi.fn();
    render(
      <HotelRoomBoard
        {...boardProps(snapshot([]), "2026-08-13")}
        sharedOccupancies={[sharedOccupancy()]}
        sharedMemberStays={[memberA, memberB]}
        onUnassignSharedOccupancy={onUnassignSharedOccupancy}
      />,
    );
    const transfer = dragTransfer();
    const card = screen.getByTestId("shared-room-card-occupancy-1");
    const draggableCard = card.parentElement;
    expect(draggableCard).toHaveAttribute("draggable", "true");
    fireEvent.dragStart(draggableCard!, { dataTransfer: transfer });
    const zone = screen.getByTestId("hotel-room-board-unassigned-drop-zone");
    fireEvent.dragOver(zone, { dataTransfer: transfer });
    expect(zone).toHaveTextContent("여기에 놓으면 객실 배정이 해제됩니다");
    fireEvent.drop(zone, { dataTransfer: transfer });
    fireEvent.dragEnd(draggableCard!, { dataTransfer: transfer });
    expect(onUnassignSharedOccupancy).toHaveBeenCalledTimes(1);
    expect(onUnassignSharedOccupancy).toHaveBeenCalledWith("occupancy-1", 4);
  });

  it("rejects checked-in Single and Shared cards from reverse unassignment", () => {
    const checkedInSingle = allocatedStay();
    const onUnassignStay = vi.fn();
    const singleRender = render(
      <HotelRoomBoard
        {...boardProps(snapshot([checkedInSingle]), "2026-08-13")}
        onUnassignStay={onUnassignStay}
      />,
    );
    const singleTransfer = dragTransfer();
    const checkedInCard = screen.getByTestId("hotel-room-board-stay-stay-1");
    fireEvent.dragStart(checkedInCard, {
      dataTransfer: singleTransfer,
    });
    fireEvent.drop(screen.getByTestId("hotel-room-board-unassigned-drop-zone"), {
      dataTransfer: singleTransfer,
    });
    fireEvent.dragEnd(checkedInCard, {
      dataTransfer: singleTransfer,
    });
    expect(onUnassignStay).not.toHaveBeenCalled();
    singleRender.unmount();

    const checkedInMember = allocatedStay({
      id: "stay-2",
      dogId: "dog-2",
      dogName: "먼지",
    });
    const onUnassignSharedOccupancy = vi.fn();
    render(
      <HotelRoomBoard
        {...boardProps(snapshot([]), "2026-08-13")}
        sharedOccupancies={[sharedOccupancy()]}
        sharedMemberStays={[stay(), checkedInMember]}
        onUnassignSharedOccupancy={onUnassignSharedOccupancy}
      />,
    );
    expect(screen.getByTestId("shared-room-card-occupancy-1").parentElement).toHaveAttribute(
      "draggable",
      "false",
    );
    expect(onUnassignSharedOccupancy).not.toHaveBeenCalled();
  });

  it("routes manager-authorized checked-in Single and Shared drops through one atomic intent each", () => {
    const checkedInSingle = allocatedStay();
    const onUnassignStay = vi.fn();
    const singleRender = render(
      <HotelRoomBoard
        {...boardProps(snapshot([checkedInSingle]), "2026-08-13")}
        allowCheckInReversal
        onUnassignStay={onUnassignStay}
      />,
    );
    const singleTransfer = dragTransfer();
    const checkedInCard = screen.getByTestId("hotel-room-board-stay-stay-1");
    fireEvent.dragStart(checkedInCard, { dataTransfer: singleTransfer });
    fireEvent.drop(screen.getByTestId("hotel-room-board-unassigned-drop-zone"), {
      dataTransfer: singleTransfer,
    });
    fireEvent.dragEnd(checkedInCard, { dataTransfer: singleTransfer });
    expect(onUnassignStay).toHaveBeenCalledTimes(1);
    expect(onUnassignStay).toHaveBeenCalledWith("stay-1");
    singleRender.unmount();

    const checkedInMember = allocatedStay({
      id: "stay-2",
      dogId: "dog-2",
      dogName: "먼지",
    });
    const onUnassignSharedOccupancy = vi.fn();
    render(
      <HotelRoomBoard
        {...boardProps(snapshot([]), "2026-08-13")}
        allowCheckInReversal
        sharedOccupancies={[sharedOccupancy()]}
        sharedMemberStays={[stay(), checkedInMember]}
        onUnassignSharedOccupancy={onUnassignSharedOccupancy}
      />,
    );
    const sharedTransfer = dragTransfer();
    const sharedCard = screen.getByTestId("shared-room-card-occupancy-1").parentElement!;
    expect(sharedCard).toHaveAttribute("draggable", "true");
    fireEvent.dragStart(sharedCard, { dataTransfer: sharedTransfer });
    fireEvent.drop(screen.getByTestId("hotel-room-board-unassigned-drop-zone"), {
      dataTransfer: sharedTransfer,
    });
    fireEvent.dragEnd(sharedCard, { dataTransfer: sharedTransfer });
    expect(onUnassignSharedOccupancy).toHaveBeenCalledTimes(1);
    expect(onUnassignSharedOccupancy).toHaveBeenCalledWith("occupancy-1", 4);
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

    render(<HotelRoomBoard {...boardProps(snapshot([completed]), "2026-08-15")} eventRoomProjections={new Map([[completed.scheduleEvents[1].schedule.id, {
      operationScheduleId: completed.scheduleEvents[1].schedule.id, hotelStayId: completed.id, hotelEventKind: "check_out",
      hotelRoomTypeName: "STANDARD", hotelRoomName: "Historical checkout room", hotelSharedRoom: false, roomResolutionStatus: "resolved",
    }]])} />);
    expect(screen.getByTestId("hotel-room-board-completed-checkouts")).toHaveTextContent("퇴실견");
    expect(screen.getByTestId("hotel-room-board-completed-checkouts")).toHaveTextContent("Historical checkout room");
    expect(screen.getByTestId("hotel-room-board-completed-checkouts")).not.toHaveTextContent("DELUXE 1");
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
    expect(screen.getByTestId("hotel-room-board-room-room-1")).toHaveTextContent("DELUXE 1");
    expect(screen.getByTestId("hotel-room-board-completed-checkouts")).toHaveTextContent("객실 정보 확인 필요");
    expect(screen.getByTestId("hotel-room-board-completed-checkouts")).not.toHaveTextContent("DELUXE 1");
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


describe("007 date mode safety", () => {
  it("past is read-only while detail and canonical checkout remain readable", () => {
    const active = allocatedStay();
    const completed = allocatedStay({ id: "completed", dogName: "완료견", checkedOutAt: "2026-08-15T03:32:00Z" });
    const props = boardProps(snapshot([active, completed]), "2026-08-15");
    const onDropStay = vi.fn(); const onUnassignStay = vi.fn(); const onOpenStay = vi.fn();
    render(<HotelRoomBoard {...props} dateMode="PAST" onDropStay={onDropStay} onUnassignStay={onUnassignStay} onOpenStay={onOpenStay}
      historicalBoard={{selectedDate:"2026-07-31",timezone:"Asia/Seoul",evidenceAsOf:"2026-08-02T00:00:00Z",readOnly:true,coverageStatus:"PARTIAL",rooms:[],unavailable:[{stayId:active.id,dogId:"dog",dogName:active.dogName,lifecycleKind:"single",reasonCode:"UNPROVEN",affectedFrom:"2026-07-30T15:00:00Z",affectedUntil:"2026-07-31T15:00:00Z",coverageClassification:"unavailable"}]}}
      eventRoomProjections={new Map([[completed.scheduleEvents[1].schedule.id, { operationScheduleId: completed.scheduleEvents[1].schedule.id, hotelStayId: completed.id, hotelEventKind: "check_out", hotelRoomTypeName: "OLD", hotelRoomName: "Canonical checkout", hotelSharedRoom: false, roomResolutionStatus: "resolved" }]])} />);
    expect(screen.getByRole("heading", { name: "객실 운영 현황" })).toBeVisible();
    expect(screen.getByRole("note")).toBeVisible();
    expect(screen.queryByRole("heading", { name: /객실 현황|당시 객실 배치|실제 점유 현황/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "감자 호실 이동 시작" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByText(/확인 필요 · 1건/));
    fireEvent.click(screen.getByRole("button", {name:"감자"}));
    expect(onOpenStay).toHaveBeenCalledWith(active.id);
    expect(screen.queryByTestId("hotel-room-board-unassigned-drop-zone")).not.toBeInTheDocument();
    expect(onDropStay).not.toHaveBeenCalled(); expect(onUnassignStay).not.toHaveBeenCalled();
    expect(screen.getByTestId("hotel-room-board-completed-checkouts")).toHaveTextContent("Canonical checkout");
  });
  it.each(["TODAY", "FUTURE"] as const)("%s preserves pre-assignment", dateMode => {
    const value = stay(); const onDropStay = vi.fn();
    render(<HotelRoomBoard {...boardProps(snapshot([value]), "2026-08-13")} dateMode={dateMode} onDropStay={onDropStay} />);
    expect(screen.getByRole("heading", { name: dateMode === "TODAY" ? "현재 객실 운영 현황" : "선택일 예약·배정 계획" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "감자 호실 이동 시작" }));
    fireEvent.pointerDown(screen.getByTestId("hotel-room-board-room-room-1"));
    expect(onDropStay).toHaveBeenCalledWith(value.id, "room-1", false);
  });
  it("past Shared detail remains accessible but mutation drop is blocked", () => {
    const occupancy = sharedOccupancy(); const open = vi.fn(); const unassign = vi.fn();
    render(<HotelRoomBoard {...boardProps(snapshot([]), "2026-08-13")} dateMode="PAST" sharedOccupancies={[occupancy]} onOpenStay={open} onUnassignSharedOccupancy={unassign}
      historicalBoard={{selectedDate:"2026-07-31",timezone:"Asia/Seoul",evidenceAsOf:"2026-08-02T00:00:00Z",readOnly:true,coverageStatus:"PARTIAL",rooms:[],unavailable:[{stayId:"past-member",dogId:"dog",dogName:"과거견",lifecycleKind:"shared",reasonCode:"UNPROVEN",affectedFrom:"2026-07-30T15:00:00Z",affectedUntil:"2026-07-31T15:00:00Z",coverageClassification:"unavailable"}]}} />);
    expect(screen.queryByTestId(`shared-room-card-${occupancy.id}`)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText(/확인 필요 · 1건/));
    fireEvent.click(screen.getByRole("button",{name:/과거견/}));
    expect(open).toHaveBeenCalledWith("past-member");
    expect(screen.queryByTestId("hotel-room-board-unassigned-drop-zone")).not.toBeInTheDocument();
    expect(unassign).not.toHaveBeenCalled();
  });
});

describe("008 completed Shared collection", () => {
  it.each(["resolved", "unavailable"] as const)("keeps a %s completed DTO without any current occupancy", status => {
    const onOpenStay = vi.fn();
    const completed = {id:"synthetic-completed-member",dogName:"Synthetic completed dog",checkedOutAt:"2091-02-02T04:00:00Z",scheduleEvents:[{eventKind:"check_out" as const,schedule:{id:"synthetic-checkout"}}]};
    render(<HotelRoomBoard {...boardProps(snapshot([]), "2091-02-02")} dateMode="TODAY" completedSharedStays={[completed]} onOpenStay={onOpenStay}
      eventRoomProjections={new Map([["synthetic-checkout",{operationScheduleId:"synthetic-checkout",hotelStayId:completed.id,hotelEventKind:"check_out",hotelRoomTypeName:"Synthetic type",hotelRoomName:status === "resolved" ? "Synthetic historical room" : null,hotelSharedRoom:true,roomResolutionStatus:status}]])} />);
    const panel = screen.getByTestId("hotel-room-board-completed-checkouts");
    expect(panel).toHaveTextContent(completed.dogName);
    expect(panel).toHaveTextContent(status === "resolved" ? "Synthetic historical room" : "객실 정보 확인 필요");
    fireEvent.click(within(panel).getByRole("button",{name:/Synthetic completed dog/}));
    expect(onOpenStay).toHaveBeenCalledWith(completed.id);
    expect(screen.queryByTestId(`hotel-room-board-stay-${completed.id}`)).not.toBeInTheDocument();
  });
});

it.each([false,true])('012 retains the same room node across TODAY/PAST/FUTURE (mobile=%s)', mobile=>{
  const media=vi.spyOn(window,'matchMedia').mockImplementation(query=>({matches:query.includes('max-width')&&mobile,media:query,onchange:null,addListener:vi.fn(),removeListener:vi.fn(),addEventListener:vi.fn(),removeEventListener:vi.fn(),dispatchEvent:()=>false}));
  const value=snapshot([stay()]);const props=boardProps(value,'2032-01-03');
  const history:import('./hotelHistoricalBoardRepository').HistoricalBoard={selectedDate:'2032-01-01',timezone:'Asia/Seoul',evidenceAsOf:'2032-01-05T00:00:00Z',readOnly:true,coverageStatus:'PARTIAL',unavailable:[],rooms:[{roomId:'room-1',roomName:'DELUXE 1',roomTypeId:'deluxe',roomType:'DELUXE',segments:[{segmentId:'synthetic-history',stayId:'past-stay',dogId:'past-dog',dogName:'이전 투숙견',roomId:'room-1',lifecycleKind:'single',usedFrom:'2032-01-01T00:00:00Z',usedUntil:'2032-01-01T08:00:00Z',displayFrom:'2032-01-01T00:00:00Z',displayUntil:'2032-01-01T08:00:00Z',selectedDayEvents:['check_out'],provenanceStatus:'verified',coverageClassification:'verified_supported_path'}]}]};
  const {rerender}=render(<HotelRoomBoard {...props} dateMode="TODAY"/>);
  const room=screen.getByTestId('hotel-room-board-room-room-1');const shell=screen.getByTestId('hotel-room-board');
  rerender(<HotelRoomBoard {...props} selectedDate="2032-01-01" dateMode="PAST" historicalBoard={history}/>);
  expect(screen.getByTestId('hotel-room-board-room-room-1')).toBe(room);expect(screen.getByTestId('hotel-room-board')).toBe(shell);
  expect(room).toHaveTextContent('이전 투숙견');expect(room).not.toHaveTextContent('감자');
  expect(screen.queryByText(/실 잔여|빈방/)).not.toBeInTheDocument();expect(room.querySelector('[draggable="true"]')).toBeNull();
  fireEvent.pointerDown(room);fireEvent.pointerUp(room);fireEvent.drop(room);expect(props.onDropStay).not.toHaveBeenCalled();
  fireEvent.click(within(room).getByRole('button',{name:/이전 투숙견 당일 퇴실/}));expect(props.onOpenStay).toHaveBeenCalledWith('past-stay');
  rerender(<HotelRoomBoard {...props} dateMode="FUTURE" selectedDate="2032-01-04"/>);
  expect(screen.getByTestId('hotel-room-board-room-room-1')).toBe(room);expect(room).not.toHaveTextContent('이전 투숙견');
  media.mockRestore();
});

describe("013 operational presentation", () => {
  it("keeps one connected metric strip with the original labels and values", () => {
    render(<HotelRoomBoard {...boardProps(snapshot([allocatedStay()]), "2026-08-14")} />);
    const strip = screen.getByLabelText("객실 운영 요약");
    expect(strip).toHaveClass("hotel-board-summary");
    expect(strip.querySelectorAll("dt")).toHaveLength(5);
    expect(within(strip).getByText("이용중").nextElementSibling).toHaveTextContent("1");
    const room = screen.getByTestId("hotel-room-board-room-room-1");
    expect(within(room).getByText("감자")).toHaveClass("hotel-dog-name");
    expect(within(room).getByText("이용중")).toHaveClass("hotel-status");
  });

  it("keeps three full Shared names, individual statuses and one physical room card", () => {
    const base = sharedOccupancy();
    const occupancy = sharedOccupancy({members: [...base.members, { ...base.members[0], id: "member-3", hotelStayId: "stay-3", dogId: "dog-3", dogName: "아주긴이름의장기투숙견" }]});
    const members = occupancy.members.map(m => allocatedStay({id:m.hotelStayId,dogId:m.dogId,dogName:m.dogName}));
    render(<HotelRoomBoard {...boardProps(snapshot([]), "2026-08-14")} sharedOccupancies={[occupancy]} sharedMemberStays={members} />);
    const card = screen.getByTestId("shared-room-card-occupancy-1");
    for (const member of members) expect(within(card).getByText(member.dogName)).toHaveClass("hotel-dog-name");
    expect(card.querySelectorAll(".hotel-shared-member")).toHaveLength(3);
    expect(card.querySelectorAll(".hotel-status")).toHaveLength(3);
    expect(screen.getAllByTestId("hotel-room-board-room-room-1")).toHaveLength(1);
    expect(card).toHaveTextContent("함께 투숙 · 3마리 · 객실 1실");
  });

  it("retains the neutral empty shell and compact zero-unassigned message", () => {
    render(<HotelRoomBoard {...boardProps(snapshot([]), "2026-08-14")} />);
    const room = screen.getByTestId("hotel-room-board-room-room-1");
    expect(room).toHaveAttribute("data-room-phase", "empty");
    expect(room.querySelector(".hotel-dog-name")).toBeNull();
    const unassigned = screen.getByTestId("hotel-room-board-unassigned-drop-zone");
    expect(unassigned).toHaveClass("hotel-board-unassigned");
    expect(unassigned).toHaveTextContent("현재 미배정 예약이 없습니다.");
  });
});


describe("013 interaction paint priority", () => {
  const presentationCss = readFileSync("src/styles.css", "utf8");
  const idleSelector = presentationCss.match(/^(\.hotel-room-cell\[data-room-phase="empty"\]:not[^\n{]+)\s*\{/m)![1].trim();

  it.each(["DELUXE", "STANDARD"] as const)("leaves %s candidate and hovered target paint to existing command classes", (type) => {
    const value = snapshot([allocatedStay()]);
    value.rooms = [...value.rooms, { ...value.rooms[0], id: "recommended", sortOrder: 2 }, { ...value.rooms[0], id: "target", sortOrder: 3, roomTypeId: type.toLowerCase(), roomTypeCode: type, roomTypeName: type }];
    render(<HotelRoomBoard {...boardProps(value, "2026-08-14")} />);
    const room = screen.getByTestId("hotel-room-board-room-target");
    expect(room.matches(idleSelector)).toBe(true);
    fireEvent.click(screen.getByLabelText("감자 호실 이동 시작"));
    expect(room.matches(idleSelector)).toBe(false);
    expect(room).toHaveClass("border-dashed");
    expect(room).toHaveClass(type === "STANDARD" ? "border-amber-500/70" : "border-primary/55");
    const candidateSelector = presentationCss.match(/^(\.hotel-room-cell[^\n{]+\[class~="border-primary\/55"\])\s*\{/m)![1].trim();
    if (type === "DELUXE") expect(room.matches(candidateSelector)).toBe(true);
    fireEvent.pointerEnter(room);
    expect(room.matches(idleSelector)).toBe(false);
    expect(room).toHaveClass(type === "STANDARD" ? "border-amber-600" : "border-primary");
    expect(room.className).toContain("shadow-[0_14px");
    // Candidate classes remain on the real RoomCell during hover.
    expect(room).toHaveClass(type === "STANDARD" ? "border-amber-500/70" : "border-primary/55");
    expect(room.matches(candidateSelector)).toBe(false);
  });

  it("keeps recommended and settled RoomCell states out of idle paint", () => {
    const hotelStay = allocatedStay();
    const value = snapshot([hotelStay]);
    value.rooms = [...value.rooms, {...value.rooms[0], id: "target", sortOrder: 2}];
    const {rerender} = render(<HotelRoomBoard {...boardProps(value, "2026-08-14")} />);
    fireEvent.click(screen.getByLabelText("감자 호실 이동 시작"));
    const room = screen.getByTestId("hotel-room-board-room-target");
    expect(room).toHaveClass("ring-emerald-300/45");
    expect(room.matches(idleSelector)).toBe(false);
    const moved = {...hotelStay, roomAllocations: [{...hotelStay.roomAllocations[0],roomId:"target"}]};
    rerender(<HotelRoomBoard {...boardProps({...value,stays:[moved]}, "2026-08-14")} />);
    expect(room).toHaveClass("hotel-room-drop-settle");
    expect(room.matches(idleSelector)).toBe(false);
  });

  it("does not repaint recommended, settling or unavailable empty targets", () => {
    const cell = document.createElement("div");
    cell.dataset.roomPhase = "empty";
    for (const state of ["ring-2", "hotel-room-drop-settle", "opacity-55"]) {
      cell.className = `hotel-room-cell ${state}`;
      expect(cell.matches(idleSelector)).toBe(false);
    }
  });

  it.each([".hotel-date-controls input", ".hotel-board-completed > div > button"])("provides an independent keyboard outline for %s", (selector) => {
    const rule = presentationCss.match(/\/\* Keyboard indication[\s\S]*$/)![0];
    expect(rule).toContain(`${selector}:focus-visible`);
    expect(rule).toContain("outline: 2px solid var(--color-primary)");
    expect(rule).toContain("outline-offset: 3px");
    expect(rule).not.toContain("outline: none");
  });
});
