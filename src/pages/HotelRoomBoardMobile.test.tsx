// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SharedHotelOccupancy } from "../platform/multiDogSharedRoomContract";
import type { DaycareReservation } from "./daycareOperationsRepository";
import { HotelRoomBoard } from "./HotelRoomBoard";
import type { HotelOperationsSnapshot, HotelStay } from "./hotelOperationsRepository";

const matchMedia = (matches: boolean) => vi.fn().mockImplementation((query: string) => ({
  matches: query === "(max-width: 767px)" ? matches : false,
  media: query,
  onchange: null,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  addListener: vi.fn(),
  removeListener: vi.fn(),
  dispatchEvent: vi.fn(),
}));

const schedule = (eventKind: "check_in" | "check_out", startsAt: string) => ({
  eventKind,
  schedule: {
    id: `${eventKind}-${startsAt}`,
    title: eventKind,
    memo: null,
    startsAt,
    endsAt: startsAt,
    timeUnspecified: false,
    status: "scheduled" as const,
    calendarId: "calendar-1",
    scheduleTypeId: "hotel",
    assignees: [],
  },
});

const hotelStay = (overrides: Partial<HotelStay> = {}): HotelStay => ({
  id: "stay-1",
  dogId: "dog-1",
  dogName: "아주긴이름의장기호텔반려견",
  customerId: "customer-1",
  customerName: "보호자",
  customerPhone: null,
  version: 1,
  requestId: "request-1",
  checkedInAt: "2026-08-13T06:05:00Z",
  checkedInBy: "owner-1",
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
    reservedUntil: "2026-08-16T02:00:00Z",
    quantity: 1,
  },
  scheduleEvents: [
    schedule("check_in", "2026-08-13T06:00:00Z"),
    schedule("check_out", "2026-08-16T02:00:00Z"),
  ],
  roomAllocations: [{
    id: "allocation-1",
    roomId: "deluxe-1",
    roomName: "DELUXE 1",
    roomTypeId: "deluxe",
    allocatedFrom: "2026-08-13T06:00:00Z",
    allocatedUntil: "2026-08-16T02:00:00Z",
    assignmentReason: null,
    version: 1,
  }],
  ...overrides,
});

const waitingStay = (id: string, dogName: string, startsAt: string) => hotelStay({
  id,
  dogId: `dog-${id}`,
  dogName,
  checkedInAt: null,
  checkedInBy: null,
  roomAllocations: [],
  scheduleEvents: [
    schedule("check_in", startsAt),
    schedule("check_out", "2026-08-18T02:00:00Z"),
  ],
});

const snapshot = (): HotelOperationsSnapshot => ({
  date: "2026-08-14",
  roomTypes: [
    { id: "deluxe", code: "DELUXE", name: "DELUXE", activeRooms: 3, reservedPeak: 2, checkedInNow: 1, allocatedNow: 2, reservedNow: 2, unassignedNow: 2, physicallyEmpty: 1 },
    { id: "standard", code: "STANDARD", name: "STANDARD", activeRooms: 2, reservedPeak: 1, checkedInNow: 0, allocatedNow: 1, reservedNow: 1, unassignedNow: 0, physicallyEmpty: 1 },
  ],
  rooms: [
    { id: "deluxe-1", name: "DELUXE 1", roomTypeId: "deluxe", roomTypeCode: "DELUXE", roomTypeName: "DELUXE", isActive: true, sortOrder: 1 },
    { id: "deluxe-2", name: "DELUXE 2", roomTypeId: "deluxe", roomTypeCode: "DELUXE", roomTypeName: "DELUXE", isActive: true, sortOrder: 2 },
    { id: "deluxe-3", name: "DELUXE 3", roomTypeId: "deluxe", roomTypeCode: "DELUXE", roomTypeName: "DELUXE", isActive: true, sortOrder: 3 },
    { id: "standard-1", name: "STANDARD 1", roomTypeId: "standard", roomTypeCode: "STANDARD", roomTypeName: "STANDARD", isActive: true, sortOrder: 1 },
    { id: "standard-2", name: "STANDARD 2", roomTypeId: "standard", roomTypeCode: "STANDARD", roomTypeName: "STANDARD", isActive: true, sortOrder: 2 },
  ],
  settings: null,
  stays: [hotelStay()],
  unassignedFuture: [
    waitingStay("today", "오늘입실견", "2026-08-14T06:00:00Z"),
    waitingStay("future", "향후입실견", "2026-08-17T06:00:00Z"),
  ],
});

const sharedStays = [
  hotelStay({ id: "shared-a", dogId: "dog-a", dogName: "망치", roomAllocations: [] }),
  hotelStay({ id: "shared-b", dogId: "dog-b", dogName: "펀치", roomAllocations: [] }),
  hotelStay({ id: "shared-c", dogId: "dog-c", dogName: "세번째아주긴이름", roomAllocations: [] }),
];

const shared: SharedHotelOccupancy = {
  id: "shared-1",
  familyBookingId: "family-1",
  sharedRoomGroupId: "group-1",
  customerId: "customer-1",
  roomTypeId: "deluxe",
  roomTypeCode: "DELUXE",
  roomId: "deluxe-3",
  roomName: "DELUXE 3",
  occupiedFrom: "2026-08-13T06:00:00Z",
  occupiedUntil: "2026-08-16T02:00:00Z",
  status: "active",
  version: 1,
  capacityReservationId: "shared-capacity",
  roomAllocationId: "shared-allocation",
  capacityUsed: 1,
  dogCount: 3,
  members: sharedStays.map((stay, index) => ({
    id: `member-${index}`,
    familyBookingMemberId: `family-${index}`,
    hotelStayId: stay.id,
    dogId: stay.dogId,
    dogName: stay.dogName,
    status: "active" as const,
    joinedAt: "2026-08-13T06:00:00Z",
    leftAt: null,
  })),
};

const daycare: DaycareReservation = {
  operationScheduleId: "daycare-1",
  calendarId: "calendar-1",
  scheduleTypeId: "daycare",
  title: "초코 데이케어",
  memo: null,
  startsAt: "2026-08-14T01:00:00Z",
  endsAt: "2026-08-14T09:00:00Z",
  scheduleStatus: "scheduled",
  scheduleVersion: 1,
  version: 1,
  lifecycleStatus: "checked_in",
  roomTypeId: "standard",
  roomTypeCode: "STANDARD",
  roomTypeName: "STANDARD",
  checkedInAt: "2026-08-14T01:05:00Z",
  checkedOutAt: null,
  cancelledAt: null,
  dog: { id: "dog-daycare", name: "초코", customerId: "customer-2" },
  customer: { id: "customer-2", name: "보호자2", phone: null },
  assignees: [],
  capacityReservation: { id: "daycare-capacity", reservedFrom: "2026-08-14T01:00:00Z", reservedUntil: "2026-08-14T09:00:00Z", archivedAt: null },
  roomAllocation: { id: "daycare-allocation", roomId: "standard-1", roomName: "STANDARD 1", allocatedFrom: "2026-08-14T01:00:00Z", allocatedUntil: "2026-08-14T09:00:00Z", version: 1 },
  createdAt: "2026-08-13T00:00:00Z",
  updatedAt: "2026-08-14T01:05:00Z",
};

const props = () => ({
  snapshot: snapshot(),
  sharedOccupancies: [shared],
  sharedMemberStays: sharedStays,
  daycareReservations: [daycare],
  selectedDate: "2026-08-14",
  selectedDateIsToday: false,
  processing: false,
  allowCrossTypeChange: true,
  onOpenStay: vi.fn(),
  onOpenSharedOccupancy: vi.fn(),
  onDropStay: vi.fn(),
  onUnassignStay: vi.fn(),
});

beforeEach(() => {
  window.matchMedia = matchMedia(true);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Hotel Room Board mobile projection", () => {
  it("orders unassigned work first and renders occupied and empty rooms without a desktop grid", () => {
    render(<HotelRoomBoard {...props()} />);

    const unassigned = screen.getByTestId("hotel-room-board-unassigned-drop-zone");
    const mobile = screen.getByTestId("hotel-room-board-mobile-projection");
    expect(unassigned.compareDocumentPosition(mobile) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByTestId("hotel-room-board-desktop-projection")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "DELUXE 모바일 Room Board" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "STANDARD 모바일 Room Board" })).toBeInTheDocument();
    expect(screen.getByTestId("deluxe-mobile-occupied")).toHaveClass("grid-cols-1");
    expect(screen.getByTestId("deluxe-mobile-empty")).toHaveClass("grid-cols-2");
    expect(screen.getByText("아주긴이름의장기호텔반려견")).toHaveClass("truncate");
    expect(mobile.innerHTML).not.toContain("text-[9px]");
  });

  it("keeps shared-room dog rows and Daycare identity readable in the same room system", () => {
    render(<HotelRoomBoard {...props()} />);

    const sharedCard = screen.getByTestId("shared-room-card-shared-1");
    expect(sharedCard).toHaveTextContent("망치");
    expect(sharedCard).toHaveTextContent("펀치");
    expect(sharedCard).toHaveTextContent("세번째아주긴이름");
    expect(sharedCard).toHaveTextContent("Shared Room · 3마리");
    expect(sharedCard).not.toHaveTextContent("Capacity");
    expect(screen.getByRole("button", { name: "초코 데이케어" })).toHaveTextContent("데이케어 · 이용중");
    expect(screen.getByTestId("hotel-room-board-room-standard-1")).toHaveAttribute("data-room-phase", "in_house");
    expect(screen.getByTestId("hotel-room-board-room-standard-1")).toHaveClass("bg-emerald-50/65");
  });

  it("filters locally, preserves accordions, and expands every room type in move mode", () => {
    const value = props();
    render(<HotelRoomBoard {...value} />);

    fireEvent.click(screen.getByRole("button", { name: "빈방" }));
    expect(screen.queryByTestId("deluxe-mobile-occupied")).not.toBeInTheDocument();
    expect(screen.getByTestId("deluxe-mobile-empty")).toBeInTheDocument();

    const standardToggle = within(screen.getByRole("region", { name: "STANDARD 모바일 Room Board" })).getByRole("button", { name: /STANDARD/ });
    expect(standardToggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(standardToggle);
    expect(standardToggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(screen.getByRole("button", { name: "전체" }));
    fireEvent.click(screen.getByRole("button", { name: "아주긴이름의장기호텔반려견 호실 이동 시작" }));
    expect(standardToggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("standard-mobile-empty")).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByTestId("hotel-room-board-room-standard-2"));
    expect(value.onDropStay).toHaveBeenCalledWith("stay-1", "standard-2", true);
  });

  it("keeps completed stays collapsed on mobile and does not restore a released outing into a room", () => {
    const value = props();
    const completed = hotelStay({
      id: "completed",
      dogName: "퇴실견",
      checkedOutAt: "2026-08-14T03:32:00Z",
      checkedOutBy: "owner-1",
    });
    value.snapshot.stays.push(completed);
    render(<HotelRoomBoard {...value} />);

    const completedSection = screen.getByTestId("hotel-room-board-completed-checkouts");
    expect(within(completedSection).queryByText("퇴실견")).not.toBeInTheDocument();
    fireEvent.click(within(completedSection).getByRole("button", { name: /퇴실 완료/ }));
    expect(within(completedSection).getByText("퇴실견")).toBeInTheDocument();

    expect(screen.getByTestId("hotel-room-board-room-deluxe-2")).toHaveAttribute("data-room-phase", "empty");
    expect(screen.getByTestId("hotel-room-board-room-deluxe-2")).toHaveTextContent("빈 호실");
  });

  it("rerenders Dog-level day phases when the selected business date changes", () => {
    const value = props();
    const { rerender } = render(<HotelRoomBoard {...value} selectedDate="2026-08-13" />);
    expect(screen.getByTestId("hotel-room-board-stay-stay-1")).toHaveTextContent("입실");

    rerender(<HotelRoomBoard {...value} selectedDate="2026-08-16" />);
    expect(screen.getByTestId("hotel-room-board-stay-stay-1")).toHaveTextContent("퇴실");
  });

  it("preserves the desktop/tablet projection at the 768px contract", () => {
    cleanup();
    window.matchMedia = matchMedia(false);
    render(<HotelRoomBoard {...props()} />);
    expect(screen.getByTestId("hotel-room-board-desktop-projection")).toBeInTheDocument();
    expect(screen.queryByTestId("hotel-room-board-mobile-projection")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "DELUXE Room Board" })).toBeInTheDocument();
  });
});
