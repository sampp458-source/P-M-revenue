// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SharedHotelOccupancy } from "../platform/multiDogSharedRoomContract";
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
  it("resolves phase-aware times without substituting the opposite schedule", () => {
    const hotelStay = stay();
    expect(hotelRoomBoardPhaseTime(hotelStay, "2026-08-13")).toBe("입실 15:00");
    expect(hotelRoomBoardPhaseTime(hotelStay, "2026-08-14")).toBe("퇴실 11:00");
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
  });

  it("renders the selected-date phase time through the actual room card", () => {
    const hotelStay = allocatedStay();
    const { rerender } = render(<HotelRoomBoard {...boardProps(snapshot([hotelStay]), "2026-08-13")} />);
    expect(screen.getByTestId("hotel-room-board-stay-stay-1")).toHaveTextContent("입실 15:00");

    rerender(<HotelRoomBoard {...boardProps(snapshot([hotelStay]), "2026-08-14")} />);
    expect(screen.getByTestId("hotel-room-board-stay-stay-1")).toHaveTextContent("퇴실 11:00");

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
