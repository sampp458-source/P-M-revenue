// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HotelRoomBoard, hotelRoomBoardDogStatus, sharedRoomCardStage } from "./HotelRoomBoard";
import type { HotelOperationsSnapshot, HotelStay } from "./hotelOperationsRepository";
import type { SharedHotelOccupancy } from "../platform/multiDogSharedRoomContract";
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

const today = "2026-09-27";
const now = "2026-09-27T03:00:00Z";
const guest = (id: string, checkout = "2026-09-27T09:00:00Z", checkedInAt: string | null = "2026-09-26T01:00:00Z", unknown = false): HotelStay => hotelStay({
  id, dogId: id, dogName: id, checkedInAt,
  scheduleEvents: [schedule("check_in", "2026-09-27T01:00:00Z"), { ...schedule("check_out", checkout), schedule: { ...schedule("check_out", checkout).schedule, timeUnspecified: unknown } }],
  roomAllocations: [{ ...hotelStay().roomAllocations[0], allocatedFrom: "2026-09-26T00:00:00Z", allocatedUntil: checkout }],
});
const occupancy = (stays: HotelStay[]): SharedHotelOccupancy => ({
  id: "shared", familyBookingId: "family", sharedRoomGroupId: "group", customerId: "customer", roomTypeId: "deluxe", roomTypeCode: "DELUXE", roomId: "deluxe-1", roomName: "DELUXE 1", occupiedFrom: "2026-09-26T00:00:00Z", occupiedUntil: "2026-09-30T09:00:00Z", status: "active", version: 1, capacityReservationId: "capacity", roomAllocationId: "allocation", capacityUsed: 1, dogCount: stays.length,
  members: stays.map(s => ({ id: s.id, familyBookingMemberId: s.id, hotelStayId: s.id, dogId: s.id, dogName: s.dogName, status: s.checkedOutAt ? "completed" : "active", joinedAt: s.checkedInAt ?? now, leftAt: s.checkedOutAt })),
});
const boardProps = (stays: HotelStay[], shared: SharedHotelOccupancy[] = []) => ({
  snapshot: { date: today, roomTypes: [{id:"deluxe",code:"DELUXE",name:"DELUXE",activeRooms:1,reservedPeak:1,checkedInNow:1,allocatedNow:1,reservedNow:1,unassignedNow:0,physicallyEmpty:0}], rooms:[{id:"deluxe-1",name:"DELUXE 1",roomTypeId:"deluxe",roomTypeCode:"DELUXE",roomTypeName:"DELUXE",isActive:true,sortOrder:1}], settings:null, stays:shared.length ? [] : stays,unassignedFuture:[] } as HotelOperationsSnapshot,
  sharedOccupancies: shared, sharedMemberStays: shared.length ? stays : [], selectedDate:today, selectedDateIsToday:true, dateMode:"TODAY" as const, processing:false, allowCrossTypeChange:true, onOpenStay:vi.fn(), onDropStay:vi.fn(), onUnassignStay:vi.fn(), onOpenSharedOccupancy:vi.fn(),
});
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(now)); window.matchMedia = vi.fn().mockImplementation(() => ({matches:false,addEventListener:vi.fn(),removeEventListener:vi.fn()})); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
describe("current Hotel next-action lifecycle", () => {
  it.each([
    ["pending", guest("A", "2026-09-29T09:00:00Z", null), "입실"],
    ["checked in today / future", guest("B", "2026-09-29T09:00:00Z", "2026-09-27T01:00:00Z"), "이용중"],
    ["due today", guest("C"), "퇴실"],
    ["overdue", guest("D", "2026-09-27T02:00:00Z"), "퇴실 지연"],
    ["unknown today", guest("E", "2026-09-26T15:00:00Z", undefined, true), "퇴실"],
    ["same day pending", guest("G", undefined, null), "입실"],
    ["same day entered", guest("H", undefined, "2026-09-27T01:00:00Z"), "퇴실"],
    ["same day overdue", guest("I", "2026-09-27T02:00:00Z", "2026-09-27T01:00:00Z"), "퇴실 지연"],
    ["unknown future", guest("unknown", "2026-09-29T15:00:00Z", undefined, true), "이용중"],
    ["unknown past date is not clock overdue", guest("unknown-past", "2026-09-25T15:00:00Z", undefined, true), "이용중"],
    ["Long Stay", {...guest("J"),scheduleEvents:[],roomAllocations:[]}, "이용중"],
    ["date rollover overdue", guest("rollover", "2026-09-26T09:00:00Z"), "퇴실 지연"],
  ] as [string, HotelStay, string][])("%s", (_name, stay, label) => { expect(hotelRoomBoardDogStatus(stay, today).label).toBe(label); });
  it("removes a Single card when refreshed snapshot contains successful checkout", () => {
    const stay = guest("single"); const {rerender} = render(<HotelRoomBoard {...boardProps([stay])}/>);
    expect(screen.getByTestId("hotel-room-board-stay-single")).toHaveTextContent("퇴실");
    rerender(<HotelRoomBoard {...boardProps([{...stay,checkedOutAt:now}])}/>);
    expect(screen.queryByTestId("hotel-room-board-stay-single")).not.toBeInTheDocument();
  });
  it("preserves per-member status, first-member occupancy and last-member release after refresh", () => {
    const a=guest("memberA"), b=guest("memberB","2026-09-29T09:00:00Z");
    const shared=occupancy([a,b]); const {rerender}=render(<HotelRoomBoard {...boardProps([a,b],[shared])}/>);
    const card=screen.getByTestId("shared-room-card-shared");
    expect(card).toHaveAttribute("data-room-phase","check_out");
    expect(within(card).getByText("퇴실")).toBeInTheDocument(); expect(within(card).getByText("이용중")).toBeInTheDocument();
    const outA={...a,checkedOutAt:now}; rerender(<HotelRoomBoard {...boardProps([outA,b],[occupancy([outA,b])])}/>);
    expect(screen.getByTestId("shared-room-card-shared")).not.toHaveTextContent("memberA");
    expect(screen.getByTestId("shared-room-card-shared")).toHaveTextContent("memberB");
    expect(screen.getByTestId("shared-room-card-shared")).toHaveAttribute("data-room-phase","in_house");
    const outB={...b,checkedOutAt:now}; rerender(<HotelRoomBoard {...boardProps([outA,outB],[{...occupancy([outA,outB]),status:"completed"}])}/>);
    expect(screen.queryByTestId("shared-room-card-shared")).not.toBeInTheDocument();
  });
  it("ranks departure before arrival before in-house without hiding overdue labels", () => {
    const a=guest("a","2026-09-27T02:00:00Z"),b=guest("b",undefined,null);
    expect(sharedRoomCardStage(occupancy([a,b]),new Map([[a.id,a],[b.id,b]]),today)).toBe("check_out");
    expect(hotelRoomBoardDogStatus(a,today).label).toBe("퇴실 지연");
    const c=guest("c","2026-09-30T09:00:00Z");
    expect(sharedRoomCardStage(occupancy([b,c]),new Map([[b.id,b],[c.id,c]]),today)).toBe("check_in");
  });
  it("keeps historical/future schedule-date semantics", () => {
    const s=guest("date");
    vi.setSystemTime(new Date("2026-09-28T03:00:00Z"));
    expect(hotelRoomBoardDogStatus(s,today).label).toBe("입실·퇴실");
    vi.setSystemTime(new Date("2026-09-26T03:00:00Z"));
    expect(hotelRoomBoardDogStatus(s,today).label).toBe("입실·퇴실");
  });
});
