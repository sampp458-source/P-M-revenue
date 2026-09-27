// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HotelStay } from "./hotelOperationsRepository";
import { formatHotelScheduleTime, formatHotelDateTime } from "./hotelOperationsUi";
import { StayDetailModal } from "./HotelOperations";
afterEach(cleanup);
const stay = (): HotelStay => ({
  id: "synthetic-stay", dogId: "synthetic-dog", dogName: "테스트견", customerId: null,
  customerName: null, customerPhone: null, version: 1, requestId: "request", checkedInAt: "2031-02-01T01:00:00Z",
  checkedInBy: null, checkedOutAt: null, checkedOutBy: null, createdBy: "creator",
  createdAt: "2031-01-01T00:00:00Z", updatedAt: "2031-02-02T00:00:00Z", archivedAt: null,
  capacityReservation: { id: "capacity", roomTypeId: "new-type", roomTypeCode: "NEW", roomTypeName: "NEW", quantity: 1,
    reservedFrom: "2031-02-01T01:00:00Z", reservedUntil: "2031-02-03T01:00:00Z" },
  scheduleEvents: (["check_in", "check_out"] as const).map((eventKind, index) => ({ eventKind, schedule: {
    id: eventKind, title: "예약", memo: null, startsAt: `2031-02-0${index ? 3 : 1}T01:00:00Z`,
    endsAt: `2031-02-0${index ? 3 : 1}T01:00:00Z`, timeUnspecified: false, status: "scheduled",
    calendarId: "calendar", scheduleTypeId: "type", assignees: [],
  } })),
  roomAllocations: [{ id: "new-allocation", roomId: "new-room", roomName: "현재 물리 객실", roomTypeId: "new-type",
    allocatedFrom: "2031-02-02T01:00:00Z", allocatedUntil: "infinity", assignmentReason: null, version: 1 }],
});

const datedStay = (unknown: boolean, sameDay = false) => ({...stay(), dogName: "덕춘", checkedInAt:"2026-09-27T07:13:00Z", scheduleEvents: stay().scheduleEvents.map(e => ({...e,schedule:{...e.schedule,
  startsAt:e.eventKind === "check_in" ? (unknown ? "2026-09-26T15:00:00Z" : "2026-09-27T07:00:00Z") : (unknown ? (sameDay ? "2026-09-26T15:00:00Z" : "2026-09-29T15:00:00Z") : (sameDay ? "2026-09-27T09:00:00Z" : "2026-09-30T09:00:00Z")),timeUnspecified:unknown,
}}))});
const detail = (value: HotelStay) => render(<StayDetailModal open stay={value} selectedDate="2026-09-27" loading={false} creatorName="합성 담당자" sharedOccupancy={null} canMergeSharedRoom={false} operationRole={null} onClose={vi.fn()} onEdit={vi.fn()} onAssign={vi.fn()} onReassign={vi.fn()} onMove={vi.fn()} onUnassign={vi.fn()} onCheckIn={vi.fn()} onCheckOut={vi.fn()} onReverseCheckIn={vi.fn()} onChangePlannedCheckout={vi.fn()} onCancel={vi.fn()} onMergeSharedRoom={vi.fn()} />);
describe("Hotel known date / unknown time presentation", () => {
  it.each(["check_in", "check_out"] as const)("%s known time retains existing full date/time formatter", kind => {
    const s=datedStay(false);expect(formatHotelScheduleTime(s,kind)).toBe(formatHotelDateTime(s.scheduleEvents.find(e=>e.eventKind===kind)!.schedule.startsAt));
  });
  it.each(["check_in", "check_out"] as const)("%s unknown time keeps the KST date, never fake midnight",kind=>{
    const value=formatHotelScheduleTime(datedStay(true),kind);expect(value).toBe(kind==='check_in'?'2026. 09. 27. · 시간 미정':'2026. 09. 30. · 시간 미정');expect(value).not.toContain('00:00');
  });
  it("same-day unknown check-in/out keeps both dates",()=>{
    for(const kind of ['check_in','check_out'] as const)expect(formatHotelScheduleTime(datedStay(true,true),kind)).toBe('2026. 09. 27. · 시간 미정');
  });
  it("historical completed stay retains its scheduled date",()=>{
    const s={...datedStay(true),checkedOutAt:'2026-09-30T10:00:00Z'};expect(formatHotelScheduleTime(s,'check_out')).toBe('2026. 09. 30. · 시간 미정');
  });
  it("missing event does not invent a date",()=>{
    expect(formatHotelScheduleTime({...datedStay(true),scheduleEvents:[]},'check_out')).toBe('-');
  });
  it.each([false,true])("actual Reservation Detail renders checkout date (unknown=%s)",unknown=>{
    const s=datedStay(unknown); detail(s);
    expect(screen.getByText('퇴실 예정').parentElement).toHaveTextContent(unknown?'2026. 09. 30. · 시간 미정':formatHotelDateTime('2026-09-30T09:00:00Z'));
    expect(screen.getByText('입실 예정').parentElement).toHaveTextContent(formatHotelScheduleTime(s,'check_in'));
    expect(screen.getByText('입실 완료').parentElement).toHaveTextContent('16:13');
  });
});
