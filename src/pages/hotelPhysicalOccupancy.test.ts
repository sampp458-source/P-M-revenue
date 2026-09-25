// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { render, fireEvent, within, cleanup } from '@testing-library/react';
import { HotelRoomBoard } from './HotelRoomBoard';
import type { HotelOperationsSnapshot } from './hotelOperationsRepository';
import type { SharedHotelOccupancy } from '../platform/multiDogSharedRoomContract';
import type { HotelStay } from './hotelOperationsRepository';
import { currentHotelAllocation, activeHotelAllocation, hotelStayCheckoutOverdue, hotelOverdueCheckoutLabel, hotelStayHasPhysicalHold, hotelStayNeedsCheckoutReview } from './hotelOperationsUi';
import { hotelRoomBoardOccupiesRoom, hotelRoomBoardUnassigned, hotelRoomBoardUnassignedGroups } from './HotelRoomBoard';

const stay = (overrides: Partial<HotelStay> = {}) => ({
  id: 'stay', dogName: '토리', archivedAt: null,
  checkedInAt: '2026-09-25T00:00:00Z', checkedOutAt: null,
  roomAllocations: [
    { id: 'a', roomId: 'A', allocatedFrom: '2026-09-25T00:00:00Z', allocatedUntil: '2026-09-25T02:00:00Z' },
    { id: 'b', roomId: 'B', allocatedFrom: '2026-09-25T02:00:00Z', allocatedUntil: '2026-09-25T09:00:00Z' },
  ],
  scheduleEvents: [{eventKind: 'check_out', schedule: { startsAt: '2026-09-25T09:00:00Z', timeUnspecified: false }}],
  ...overrides,
}) as HotelStay;

describe('planned versus physical Hotel occupancy', () => {
  it('isolates pre-cutover stale holds but retains due legacy checkout access', () => {
    const old = stay({checkedInAt:'2026-09-24T14:59:59Z'});
    const at='2026-09-25T12:00:00Z';
    expect(hotelStayHasPhysicalHold(old,at)).toBe(false);
    expect(currentHotelAllocation(old,at)).toBeNull();
    expect(hotelStayCheckoutOverdue(old,at)).toBe(false);
    expect(hotelStayNeedsCheckoutReview(old,at)).toBe(true);
    expect(hotelStayNeedsCheckoutReview({...old,checkedOutAt:at},at)).toBe(false);
    expect(hotelStayNeedsCheckoutReview({...old,scheduleEvents:[{eventKind:'check_out',schedule:{startsAt:'2026-09-23T09:00:00Z',timeUnspecified:false}}]} as HotelStay,at)).toBe(false);
    expect(hotelStayHasPhysicalHold(stay({checkedInAt:'2026-09-24T15:00:00Z'}),at)).toBe(true);
  });
  it.each([
    ['A', '2026-09-25T08:59:00Z', false],
    ['boundary', '2026-09-25T09:00:00Z', false],
    ['B', '2026-09-25T09:01:00Z', true],
    ['C', '2026-09-25T10:30:00Z', true],
    ['F', '2026-09-26T01:00:00Z', true],
  ])('%s retains only current room through late checkout/date rollover', (_, instant, overdue) => {
    expect(currentHotelAllocation(stay(), instant)?.roomId).toBe('B');
    expect(hotelRoomBoardOccupiesRoom(stay(), instant)).toBe(true);
    expect(hotelStayCheckoutOverdue(stay(), instant)).toBe(overdue);
    expect(hotelRoomBoardUnassigned([stay()], instant)).toEqual([]);
  });
  it('keeps a compact explicit overdue time and includes the date after rollover', () => {
    expect(hotelOverdueCheckoutLabel(stay(),'2026-09-25T10:00:00Z')).toBe('18:00 퇴실 예정');
    expect(hotelOverdueCheckoutLabel(stay(),'2026-09-26T01:00:00Z')).toBe('2026-09-25 18:00 퇴실 예정');
  });
  it('D releases on actual completion without reviving Room A', () => {
    const completed = stay({checkedOutAt:'2026-09-25T09:35:00Z'});
    expect(currentHotelAllocation(completed, '2026-09-25T09:36:00Z')).toBeNull();
    expect(hotelStayCheckoutOverdue(completed)).toBe(false);
  });
  it('E never turns unknown midnight fallback into hourly overdue', () => {
    const unknown = stay({scheduleEvents:[{eventKind:'check_out',schedule:{startsAt:'2026-09-25T15:00:00Z',timeUnspecified:true}}] as HotelStay['scheduleEvents']});
    expect(hotelStayCheckoutOverdue(unknown,'2026-09-26T03:00:00Z')).toBe(false);
    expect(hotelOverdueCheckoutLabel(unknown,'2026-09-26T03:00:00Z')).toBeNull();
    expect(currentHotelAllocation(unknown,'2026-09-26T03:00:00Z')?.roomId).toBe('B');
  });
  it('H keeps planned interval semantics and does not revive never checked-in stays', () => {
    const at='2026-09-25T10:00:00Z';
    expect(activeHotelAllocation(stay(),at)).toBeNull();
    expect(currentHotelAllocation(stay({checkedInAt:null}),at)).toBeNull();
  });
  it('count and list share the exact current predicate', () => {
    const stays=[stay(),stay({id:'unassigned',checkedInAt:null,roomAllocations:[]}),stay({id:'expired-never-entered',checkedInAt:null})];
    const at='2026-09-25T10:00:00Z';
    const groups=hotelRoomBoardUnassignedGroups(stays,'2026-09-25',at);
    expect(Object.values(groups).flat().map(x=>x.id).sort()).toEqual(hotelRoomBoardUnassigned(stays,at).map(x=>x.id).sort());
  });
  it('released Long Stay segment with no current allocations stays released', () => {
    expect(currentHotelAllocation(stay({roomAllocations:[]}), '2026-09-25T10:00:00Z')).toBeNull();
  });
});


describe('legacy checkout review access', () => {
  it('opens existing Single/Shared detail paths without taking a room or invoking a command', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-25T12:30:00Z'));
    const single = stay({id:'legacy-single',dogName:'Synthetic Single',checkedInAt:'2026-09-22T22:50:00Z',roomAllocations:[]});
    const sharedA = stay({id:'legacy-member-a',dogName:'Synthetic Shared A',checkedInAt:'2026-09-21T06:44:00Z',roomAllocations:[]});
    const sharedB = {...sharedA,id:'legacy-member-b',dogName:'Synthetic Shared B'};
    const snapshot = {date:'2026-09-25',roomTypes:[],rooms:[],settings:null,stays:[single],unassignedFuture:[]} as HotelOperationsSnapshot;
    const occupancy = {id:'legacy-group',familyBookingId:'family',sharedRoomGroupId:'group',customerId:'customer',roomTypeId:'deluxe',roomTypeCode:'DELUXE',roomName:'D6',version:1,capacityReservationId:'capacity',roomAllocationId:'allocation',capacityUsed:1,dogCount:2,status:'active',occupiedFrom:'2026-09-21T04:00:00Z',occupiedUntil:'2026-09-25T11:00:00Z',roomId:'legacy-room',members:[{id:'member-a',familyBookingMemberId:'family-a',hotelStayId:sharedA.id,dogId:'dog-a',dogName:sharedA.dogName,status:'active',joinedAt:'2026-09-21T04:00:00Z',leftAt:null},{id:'member-b',familyBookingMemberId:'family-b',hotelStayId:sharedB.id,dogId:'dog-b',dogName:sharedB.dogName,status:'active',joinedAt:'2026-09-21T04:00:00Z',leftAt:null}]} as SharedHotelOccupancy;
    const openSingle=vi.fn(),openShared=vi.fn(),command=vi.fn();
    const props = {snapshot,sharedOccupancies:[occupancy],sharedMemberStays:[sharedA,sharedB],selectedDate:'2026-09-25',selectedDateIsToday:true,processing:false,allowCrossTypeChange:false,onOpenStay:openSingle,onOpenSharedOccupancy:openShared,onDropStay:command,onUnassignStay:command};
    try {
      const view=render(createElement(HotelRoomBoard,props));
      const review=within(view.getByRole('region',{name:'퇴실 처리 확인'}));
      fireEvent.click(review.getByRole('button',{name:/Synthetic Single/}));
      expect(openSingle).toHaveBeenCalledWith(single.id);
      fireEvent.click(review.getByRole('button',{name:/Synthetic Shared A/}));
      fireEvent.click(review.getByRole('button',{name:/Synthetic Shared B/}));
      expect(openShared).toHaveBeenCalledTimes(2);
      expect(openShared).toHaveBeenLastCalledWith(occupancy.id);
      expect(command).not.toHaveBeenCalled();
      expect(view.container.querySelector('[data-testid="hotel-room-board"]')?.textContent).toContain('현재 배정·이용 객실0실');
      view.rerender(createElement(HotelRoomBoard,{...props,snapshot:{...snapshot,stays:[{...single,checkedOutAt:'2026-09-25T12:00:00Z'}]},sharedMemberStays:[{...sharedA,checkedOutAt:'2026-09-25T12:00:00Z'},{...sharedB,checkedOutAt:'2026-09-25T12:00:00Z'}]}));
      expect(view.queryByRole('region',{name:'퇴실 처리 확인'})).toBeNull();
    } finally {cleanup(); vi.useRealTimers();}
  });
});
