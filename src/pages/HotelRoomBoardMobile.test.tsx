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
  dateMode: "FUTURE" as const, selectedDateIsToday: false,
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


describe('mobile floorplan transposes desktop identity without occupancy sorting',()=>{
 it('keeps eleven real room IDs in desktop type order and an unmatched blank, including empty rooms',()=>{
  const value=props();value.snapshot.rooms=[...Array.from({length:6},(_,i)=>({...value.snapshot.rooms[0],id:`d-${i+1}`,name:`DELUXE ${i+1}`,sortOrder:i+1})),...Array.from({length:5},(_,i)=>({...value.snapshot.rooms[3],id:`s-${i+1}`,name:`STANDARD ${i+1}`,sortOrder:i+1}))].reverse();
  value.snapshot.stays=[];value.sharedOccupancies=[];value.daycareReservations=[];
  const {container}=render(<HotelRoomBoard {...value}/>);
  expect([...container.querySelectorAll('[data-side=left]')].map(x=>x.getAttribute('data-room-id'))).toEqual(['d-1','d-2','d-3','d-4','d-5','d-6']);
  expect([...container.querySelectorAll('[data-side=right]')].map(x=>x.getAttribute('data-room-id'))).toEqual(['s-1','s-2','s-3','s-4','s-5',null]);
  expect(container.querySelectorAll('.hotel-floorplan-room')).toHaveLength(11);
  fireEvent.click(screen.getByTestId('hotel-room-board-room-s-5'));expect(screen.getByRole('dialog',{name:'객실 상세'})).toHaveTextContent('STANDARD 5');
  expect(value.onDropStay).not.toHaveBeenCalled();expect(value.onUnassignStay).not.toHaveBeenCalled();
 });
 it('opens the existing single-stay detail without issuing a room command',()=>{
  const value=props();render(<HotelRoomBoard {...value}/>);fireEvent.click(screen.getByTestId('hotel-room-board-room-deluxe-1'));
  expect(value.onOpenStay).toHaveBeenCalledWith('stay-1');expect(value.onDropStay).not.toHaveBeenCalled();
 });
 it('retains Shared Room as one cell, previews two names and exposes all names to the existing shared detail',()=>{
  const value=props();render(<HotelRoomBoard {...value}/>);const cell=screen.getByTestId('hotel-room-board-room-deluxe-3');
  expect(cell).toHaveTextContent('망치');expect(cell).toHaveTextContent('펀치');expect(cell).toHaveTextContent('외 1마리');expect(cell).toHaveAccessibleName(/세번째아주긴이름/);expect(cell).toHaveTextContent('3마리 · 1실');
  fireEvent.click(cell);expect(value.onOpenSharedOccupancy).toHaveBeenCalledWith('shared-1');
 });
 it('retains Daycare exact information in the reused room detail',()=>{
  render(<HotelRoomBoard {...props()}/>);const cell=screen.getByTestId('hotel-room-board-room-standard-1');expect(cell).toHaveTextContent('초코');expect(cell).toHaveTextContent('데이케어');
  fireEvent.click(cell);expect(screen.getByRole('dialog',{name:'객실 상세'})).toHaveTextContent('퇴실 18:00');
 });
 it('keeps room positions and DOM identity when the selected date changes',()=>{
  const value=props();const {rerender}=render(<HotelRoomBoard {...value} selectedDate="2026-08-13"/>);const room=screen.getByTestId('hotel-room-board-room-deluxe-1');expect(room).toHaveTextContent('입실');
  rerender(<HotelRoomBoard {...value} selectedDate="2026-08-16"/>);expect(screen.getByTestId('hotel-room-board-room-deluxe-1')).toBe(room);expect(room).toHaveTextContent('퇴실');
 });
 it('does not turn absent past evidence into vacant rooms or allow current operations',()=>{
  render(<HotelRoomBoard {...props()} dateMode="PAST"/>);expect(screen.queryByText('빈 호실')).toBeNull();expect(screen.queryByRole('group',{name:'객실 상태'})).toBeNull();expect(screen.queryByTestId('hotel-room-board-unassigned-drop-zone')).toBeNull();expect(screen.getByRole('note')).toBeTruthy();
 });
 it('retains the completed collection and exact detail callback below the map',()=>{
  const value=props();value.snapshot.stays.push(hotelStay({id:'done',dogName:'완료견',checkedOutAt:'2026-08-14T03:32:00Z'}));render(<HotelRoomBoard {...value}/>);
  const completed=screen.getByTestId('hotel-room-board-completed-checkouts');fireEvent.click(within(completed).getByRole('button',{name:/퇴실 완료/}));expect(within(completed).getByText('완료견')).toBeVisible();
 });
 it('leaves desktop projection unchanged at the existing 768px boundary',()=>{
  window.matchMedia=matchMedia(false);render(<HotelRoomBoard {...props()}/>);expect(screen.getByTestId('hotel-room-board-desktop-projection')).toBeTruthy();expect(screen.queryByTestId('hotel-room-board-mobile-projection')).toBeNull();expect(screen.getByRole('region',{name:'DELUXE Room Board'})).toBeTruthy();
 });
});
