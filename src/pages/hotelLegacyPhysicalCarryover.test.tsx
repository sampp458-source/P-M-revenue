// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HotelRoomBoard, hotelRoomBoardDogStatus, hotelRoomBoardUnassigned } from './HotelRoomBoard';
import { currentHotelAllocation, activeHotelAllocation, hotelStayHasPhysicalHold, hotelStayNeedsPhysicalRoomReview, hotelStayNeedsCheckoutReview } from './hotelOperationsUi';
import type { HotelStay, HotelOperationsSnapshot } from './hotelOperationsRepository';
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


const now = '2026-09-28T04:00:00Z';
const benger = (): HotelStay => {
  const allocation = {...hotelStay().roomAllocations[0], id:'benger-allocation',roomId:'deluxe-4',roomName:'DELUXE 4',allocatedFrom:'2026-09-23T05:20:00Z',allocatedUntil:'2026-09-28T03:40:00Z'};
  return hotelStay({id:'benger',dogName:'벵거',checkedInAt:'2026-09-23T05:20:00Z',roomAllocations:[allocation],scheduleEvents:[schedule('check_in','2026-09-23T05:20:00Z'),schedule('check_out','2026-09-28T03:40:00Z')],currentPhysicalRoom:{date:'2026-09-28',observedAt:now,state:'occupied',allocation}});
};
const props = (stay:HotelStay) => ({
  snapshot:{date:'2026-09-28',rooms:[{id:'deluxe-4',name:'DELUXE 4',roomTypeId:'deluxe',roomTypeCode:'DELUXE',roomTypeName:'DELUXE',isActive:true,sortOrder:4}],roomTypes:[{id:'deluxe',code:'DELUXE',name:'DELUXE',activeRooms:1,reservedPeak:1,checkedInNow:1,allocatedNow:1,reservedNow:0,unassignedNow:0,physicallyEmpty:0}],settings:null,stays:[stay],unassignedFuture:[]} as HotelOperationsSnapshot,
  selectedDate:'2026-09-28',selectedDateIsToday:true,processing:false,allowCrossTypeChange:false,onOpenStay:vi.fn(),onDropStay:vi.fn(),onUnassignStay:vi.fn(),
});
beforeEach(() => {vi.useFakeTimers();vi.setSystemTime(new Date(now));window.matchMedia=vi.fn().mockImplementation(()=>({matches:false,addEventListener:vi.fn(),removeEventListener:vi.fn()}));});
afterEach(()=>{cleanup();vi.useRealTimers();});
describe('canonical current physical projection',()=>{
  it.each(['2026-09-28T03:39:00Z','2026-09-28T03:40:00Z',now])('retains bounded legacy room across planned end at %s',at=>{
    expect(currentHotelAllocation(benger(),at)?.roomName).toBe('DELUXE 4');
    expect(hotelStayHasPhysicalHold(benger(),at)).toBe(true);
    expect(hotelRoomBoardUnassigned([benger()],at)).toEqual([]);
  });
  it('renders Benger in D4 with existing overdue status, never unassigned',()=>{
    render(<HotelRoomBoard {...props(benger())}/>);
    expect(screen.getByTestId('hotel-room-board-stay-benger')).toHaveTextContent('벵거');
    expect(screen.getByTestId('hotel-room-board-stay-benger')).toHaveTextContent('퇴실 지연');
    expect(hotelRoomBoardUnassigned([benger()],now)).toEqual([]);
    expect(hotelStayNeedsCheckoutReview(benger(),now)).toBe(false);
  });
  it('honors actual checkout over a stale projection',()=>{
    const out={...benger(),checkedOutAt:now};
    expect(currentHotelAllocation(out,now)).toBeNull();
    expect(hotelStayHasPhysicalHold(out,now)).toBe(false);
    expect(hotelStayNeedsPhysicalRoomReview(out,now)).toBe(false);
  });
  it('does not recreate an excluded legacy room from raw planned allocation',()=>{
    const s=benger();s.currentPhysicalRoom={date:'2026-09-28',observedAt:now,state:'unresolved',allocation:null};
    expect(currentHotelAllocation(s,now)).toBeNull();
    expect(hotelRoomBoardUnassigned([s],now)).toEqual([]);
    expect(hotelStayNeedsPhysicalRoomReview(s,now)).toBe(true);
  });
  it('explicit Long Stay release does not create false attention',()=>{
    const s=benger();s.currentPhysicalRoom={date:'2026-09-28',observedAt:now,state:'released',allocation:null};
    expect(currentHotelAllocation(s,now)).toBeNull();
    expect(hotelStayNeedsPhysicalRoomReview(s,now)).toBe(false);
  });
  it('uses the server-resolved successor rather than anchor/latest frontend rows',()=>{
    const s=benger();s.currentPhysicalRoom!.allocation={...s.roomAllocations[0],roomId:'deluxe-2',roomName:'DELUXE 2'};
    expect(currentHotelAllocation(s,now)?.roomId).toBe('deluxe-2');
  });
  it('fails closed for a projection from another date',()=>{
    const s=benger();s.currentPhysicalRoom!.date='2026-09-27';
    expect(currentHotelAllocation(s,now)).toBeNull();
    expect(hotelStayNeedsPhysicalRoomReview(s,now)).toBe(true);
  });
  it('keeps historical/future planned lookup independent of current physical state',()=>{
    expect(currentHotelAllocation(benger())).toEqual(activeHotelAllocation(benger()));
    expect(activeHotelAllocation(benger(),'2026-09-29T04:00:00Z')).toBeNull();
  });
  it('retains unknown-time lifecycle without fake overdue',()=>{
    const s=benger();s.scheduleEvents[1].schedule.timeUnspecified=true;
    expect(hotelRoomBoardDogStatus(s,'2026-09-28').label).toBe('퇴실');
  });
  it('preserves ordinary pre-checkin unassigned classification',()=>{
    const s={...benger(),checkedInAt:null,roomAllocations:[],currentPhysicalRoom:undefined};
    expect(hotelRoomBoardUnassigned([s],now)).toEqual([s]);
    expect(hotelStayNeedsPhysicalRoomReview(s,now)).toBe(false);
  });
});
