import { hotelFutureUnassignedPresentation } from "./hotelFutureUnassignedPresentation";
import { HotelAttentionQueue } from "./HotelAttentionQueue";
import { hotelStayNeedsPhysicalRoomReview } from "./hotelOperationsUi";
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HotelRoomBoard, hotelRoomBoardUnassigned } from "./HotelRoomBoard";
import type { HotelOperationsSnapshot, HotelStay } from "./hotelOperationsRepository";
import type { SharedHotelOccupancy, UnassignedSharedRoomGroup } from "../platform/multiDogSharedRoomContract";
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
const boardProps = (stays: HotelStay[], shared: SharedHotelOccupancy[] = []) => ({
  snapshot: { date: today, roomTypes: [{id:"deluxe",code:"DELUXE",name:"DELUXE",activeRooms:1,reservedPeak:1,checkedInNow:1,allocatedNow:1,reservedNow:1,unassignedNow:0,physicallyEmpty:0}], rooms:[{id:"deluxe-1",name:"DELUXE 1",roomTypeId:"deluxe",roomTypeCode:"DELUXE",roomTypeName:"DELUXE",isActive:true,sortOrder:1}], settings:null, stays:shared.length ? [] : stays,unassignedFuture:[] } as HotelOperationsSnapshot,
  sharedOccupancies: shared, sharedMemberStays: shared.length ? stays : [], selectedDate:today, selectedDateIsToday:true, dateMode:"TODAY" as const, processing:false, allowCrossTypeChange:true, onOpenStay:vi.fn(), onDropStay:vi.fn(), onUnassignStay:vi.fn(), onOpenSharedOccupancy:vi.fn(),
});
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(now)); window.matchMedia = vi.fn().mockImplementation(() => ({matches:false,addEventListener:vi.fn(),removeEventListener:vi.fn()})); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

const future = (id: string, date = "2026-09-29T09:00:00Z") => hotelStay({id, dogId:id,dogName:id,checkedInAt:null,roomAllocations:[],scheduleEvents:[schedule("check_in",date)]});
const group = (date = "2026-09-29T09:00:00Z"): UnassignedSharedRoomGroup => ({sharedRoomGroupId:"group",familyBookingId:"family",customerId:"c",customerName:"",dogMembers:[{familyBookingMemberId:"m",hotelStayId:"member",dogId:"dog",dogName:"함께견"}],dogCount:1,roomTypeId:"deluxe",roomTypeCode:"DELUXE",reservedFrom:date,reservedUntil:"2026-10-15T09:00:00Z",capacityReservationId:"cap",requestedCapacity:1,status:"requested",version:1});
const partition = (stays: HotelStay[], groups: UnassignedSharedRoomGroup[] = []) => hotelFutureUnassignedPresentation(stays,groups,today);
const attention = (stays: HotelStay[], groups: UnassignedSharedRoomGroup[] = []) => {
  const p=partition(stays,groups);
  const sharedIds=new Set(groups.flatMap(g=>g.dogMembers.map(m=>m.hotelStayId)));
  return [
    ...hotelRoomBoardUnassigned([...new Map(stays.map(s=>[s.id,s])).values()].filter(s=>!sharedIds.has(s.id))).filter(s=>!p.stayIds.has(s.id)).map(s=>({id:s.id,name:s.dogName,reason:"호실 미배정",onOpen:vi.fn()})),
    ...[...new Map(groups.map(g=>[g.sharedRoomGroupId,g])).values()].filter(g=>!p.groupIds.has(g.sharedRoomGroupId)).map(g=>({id:g.sharedRoomGroupId,name:g.dogMembers.map(m=>m.dogName).join(" · "),reason:"함께 투숙 · 호실 미배정",onOpen:vi.fn()})),
  ];
};
function view(stays: HotelStay[], groups: UnassignedSharedRoomGroup[] = []) {
 const props=boardProps(stays);
 return render(<HotelRoomBoard {...props} snapshot={{...props.snapshot,unassignedFuture:stays}} unassignedSharedGroups={groups} attention={<HotelAttentionQueue items={attention(stays,groups)}/>}/>);
}
describe("future unassigned presentation identity and scope",()=>{
 it("A: future Single appears only in future, even when present in both snapshot arrays",()=>{
  view([future("메리")]);expect(screen.queryByRole("region",{name:"확인할 호텔 업무"})).not.toBeInTheDocument();
  expect(screen.getByRole("button",{name:"접기"})).toHaveAttribute("aria-expanded","true");
  expect(screen.getAllByTestId("hotel-room-board-stay-메리")).toHaveLength(1);
  expect(within(screen.getByRole("region",{name:"향후 입실 미배정"})).getByText("호실 미배정")).toBeVisible();
  fireEvent.click(screen.getByRole("button",{name:"접기"}));expect(screen.queryByTestId("hotel-room-board-stay-메리")).not.toBeInTheDocument();
 });
 it("B: future Shared stays group-level, deduplicated by group id",()=>{
  const g=group();view([future("member")],[g,g]);
  expect(attention([future("member")],[g,g])).toHaveLength(0);
  expect(screen.getByRole("button",{name:"접기"})).toHaveAttribute("aria-expanded","true");
  expect(screen.getAllByTestId("hotel-room-board-unassigned-shared-group")).toHaveLength(1);
  expect(screen.queryByTestId("hotel-room-board-stay-member")).not.toBeInTheDocument();
 });
 it("C/D: today Single and Shared remain attention, never future",()=>{
  const s=future("today",now),g=group(now);expect(partition([s],[g]).stays).toHaveLength(0);expect(partition([s],[g]).groups).toHaveLength(0);expect(attention([s],[g])).toHaveLength(2);
 });
 it("E: past missed check-in remains attention",()=>{const s=future("past","2026-09-26T01:00:00Z");expect(partition([s]).stays).toHaveLength(0);expect(attention([s])).toHaveLength(1);});
 it("F: future assigned is in neither unassigned list",()=>{const s={...future("assigned"),roomAllocations:hotelStay().roomAllocations};expect(partition([s]).stays).toHaveLength(0);expect(attention([s])).toHaveLength(0);});
 it("G/H: canonical ids deduplicate repeated sources, not different reservations for one dog",()=>{
  const a={...future("a"),dogId:"same-dog",dogName:"같은견"},b={...a,id:"b"};expect(partition([a,a,b]).stays.map(s=>s.id)).toEqual(["a","b"]);
 });
 it("current unresolved room and missing date are not silenced",()=>{
  const a={...future("active"),checkedInAt:now},b={...future("missing"),scheduleEvents:[]};expect(partition([a,b]).stays).toHaveLength(0);
  expect(attention([a,b]).map(item=>item.id)).toEqual([b.id]);
  expect(hotelStayNeedsPhysicalRoomReview(a,now)).toBe(true);
 });
 it("completed and archived stays remain excluded",()=>{
  expect(partition([{...future("done"),checkedOutAt:now},{...future("archived"),archivedAt:now}]).stays).toHaveLength(0);
 });
 it("Production equivalent: four future rows, no attention, dates survive unknown time",()=>{
  const stays=[future("메리"),future("별이","2026-10-08T15:00:00Z"),future("여름이","2026-10-10T15:00:00Z"),future("지구","2026-10-10T15:00:00Z")];
  stays.slice(1).forEach(s=>s.scheduleEvents[0].schedule.timeUnspecified=true);
  view(stays);expect(screen.queryByRole("region",{name:"확인할 호텔 업무"})).not.toBeInTheDocument();
  expect(screen.getByRole("button",{name:"접기"})).toHaveAttribute("aria-expanded","true");
  const section=screen.getByRole("region",{name:"향후 입실 미배정"});expect(within(section).getByRole("heading",{name:/향후 입실 · 객실 미배정/})).toBeVisible();
  for(const s of stays) expect(within(section).getAllByText(s.dogName)).toHaveLength(1);
  expect(within(section).getByText("2026. 10. 09. · 시간 미정")).toBeVisible();expect(section.textContent).not.toContain("00:00");
 });
 it("Shared unknown member time remains unknown, missing member schedule never invents midnight",()=>{
  const s=future("member","2026-10-08T15:00:00Z");s.scheduleEvents[0].schedule.timeUnspecified=true;
  view([s],[group("2026-10-08T15:00:00Z")]);expect(screen.getByRole("button",{name:"접기"})).toHaveAttribute("aria-expanded","true");expect(screen.getByText("2026. 10. 09. · 시간 미정")).toBeVisible();
  cleanup();view([],[group("2026-10-08T15:00:00Z")]);expect(screen.getByRole("button",{name:"접기"})).toHaveAttribute("aria-expanded","true");expect(screen.getByText("2026-10-09 · 시간 확인 필요")).toBeVisible();
 });
});
