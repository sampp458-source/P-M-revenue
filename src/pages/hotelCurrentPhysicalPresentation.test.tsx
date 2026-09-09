// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { supabase } from "../lib/supabase";
import type { HotelStay, HotelOperationsSnapshot, HotelEventRoomProjection } from "./hotelOperationsRepository";
import type { SharedHotelOccupancy } from "../platform/multiDogSharedRoomContract";
import { CURRENT_ROOM_UNAVAILABLE, currentHotelRoomLabel, fetchCurrentHotelRoomLabel } from "./hotelCurrentPhysicalPresentation";
import { hotelServices, loadCurrentCustomerDogServices } from "./customerDogDirectory";
import { StayDetailModal } from "./HotelOperations";

vi.mock("../lib/supabase", () => ({ supabase: { rpc: vi.fn() } }));
vi.mock("./operationsScheduleRepository", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./operationsScheduleRepository")>()),
  fetchOperationSchedulesForDay: vi.fn(async () => []),
}));
const now = Date.parse("2032-03-05T06:00:00Z");
const stay = (overrides: Partial<HotelStay> = {}): HotelStay => ({
  id: "stay", dogId: "dog", dogName: "테스트견", customerId: "customer", customerName: "보호자", customerPhone: null,
  version: 1, requestId: "request", checkedInAt: "2032-03-01T06:00:00Z", checkedInBy: null, checkedOutAt: null, checkedOutBy: null,
  createdBy: "creator", createdAt: "2032-02-01T00:00:00Z", updatedAt: "2032-03-05T00:00:00Z", archivedAt: null,
  capacityReservation: { id: "capacity", roomTypeId: "type", roomTypeCode: "STANDARD", roomTypeName: "STANDARD", quantity: 1, reservedFrom: "2032-03-01T00:00:00Z", reservedUntil: "2032-03-10T00:00:00Z" },
  scheduleEvents: [],
  roomAllocations: [{ id: "allocation", roomId: "room", roomName: "Current Single", roomTypeId: "type", allocatedFrom: "2032-03-01T00:00:00Z", allocatedUntil: "2032-03-10T00:00:00Z", assignmentReason: null, version: 1 }],
  ...overrides,
});
const shared = (): SharedHotelOccupancy => ({
  id: "occupancy", familyBookingId: "family", sharedRoomGroupId: "group", customerId: "customer", roomTypeId: "deluxe", roomTypeCode: "DELUXE",
  roomId: "shared-room", roomName: "Current Shared", occupiedFrom: "2032-03-01T00:00:00Z", occupiedUntil: "2032-03-10T00:00:00Z", status: "active", version: 1,
  capacityReservationId: "shared-capacity", roomAllocationId: "shared-allocation", capacityUsed: 1, dogCount: 1,
  members: [{ id: "member", familyBookingMemberId: "family-member", hotelStayId: "stay", dogId: "dog", dogName: "테스트견", status: "active", joinedAt: "2032-03-01T00:00:00Z", leftAt: null }],
});
const snapshot = (stays: HotelStay[] = [], unassignedFuture: HotelStay[] = []): HotelOperationsSnapshot => ({ date: "2032-03-05", stays, unassignedFuture, rooms: [], roomTypes: [], settings: null });
beforeEach(() => { vi.mocked(supabase.rpc).mockReset(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("current services", () => {
  it("loads Shared once for the directory collection, including members absent from Single snapshot", async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    vi.mocked(supabase.rpc).mockImplementation((name: string) => Promise.resolve({ data: name === "get_hotel_operations_snapshot_v2" ? snapshot() : [shared()], error: null }) as never);
    const result = await loadCurrentCustomerDogServices();
    expect(result.available).toBe(true);
    expect(result.services).toMatchObject([{ dogId: "dog", detail: "Current Shared" }]);
    expect(supabase.rpc).toHaveBeenCalledTimes(2);
    expect(supabase.rpc).toHaveBeenCalledWith("get_hotel_shared_room_occupancies", { p_date: "2032-03-05" });
  });

  it("shows current Single service", () => {
    expect(hotelServices(snapshot([stay()]), "2032-03-05", [], now)).toMatchObject([{ detail: "Current Single", dogId: "dog" }]);
  });
  it("includes Shared members after capacity is detached and Single snapshot is empty", () => {
    expect(hotelServices(snapshot(), "2032-03-05", [shared()], now)).toMatchObject([{ dogId: "dog", detail: "Current Shared", sourceEntityId: "stay" }]);
  });
  it("deduplicates snapshot/future/shared overlap and suppresses Single room", () => {
    const result = hotelServices(snapshot([stay()], [stay()]), "2032-03-05", [shared()], now);
    expect(result).toHaveLength(1); expect(result[0].detail).toBe("Current Shared");
  });
  it("does not expose another current Single stay for the same Shared dog", () => {
    const result = hotelServices(snapshot([stay({ id: "other-stay" })]), "2032-03-05", [shared()], now);
    expect(result).toHaveLength(1); expect(result[0].detail).toBe("Current Shared");
  });
  it("preserves future reservation intent and deduplicates repeated entries", () => {
    const future = stay({ checkedInAt: null, id: "future", roomAllocations: [] });
    const result = hotelServices(snapshot([], [future, future]), "2032-03-05", [], now);
    expect(result).toHaveLength(1); expect(result[0]).toMatchObject({ detail: "STANDARD", status: "예약" });
  });
  it("excludes completed Single and completed Shared members", () => {
    const occupancy = shared(); occupancy.members = occupancy.members.map(m => ({ ...m, status: "completed", leftAt: "2032-03-04T00:00:00Z" }));
    expect(hotelServices(snapshot([stay({ checkedOutAt: "2032-03-04T00:00:00Z" })]), "2032-03-05", [occupancy], now)).toEqual([]);
  });
  it("does not resolve duplicate Shared relations or duplicate dog stays", () => {
    const duplicate = shared(); duplicate.id = "another"; duplicate.members = duplicate.members.map(m => ({ ...m, hotelStayId: "second" }));
    const result = hotelServices(snapshot(), "2032-03-05", [shared(), duplicate], now);
    expect(result).toHaveLength(1); expect(result[0].detail).toBe(CURRENT_ROOM_UNAVAILABLE);
  });
  it.each(["future", "ended", "released", "member-left", "duplicate"])("does not infer Shared room for %s evidence", mode => {
    const occupancy = shared();
    if (mode === "future") occupancy.occupiedFrom = "2032-03-06T00:00:00Z";
    if (mode === "ended") occupancy.occupiedUntil = "2032-03-04T00:00:00Z";
    if (mode === "released") occupancy.status = "released";
    if (mode === "member-left") occupancy.members = occupancy.members.map(m => ({ ...m, leftAt: "2032-03-04T00:00:00Z" }));
    const result = hotelServices(snapshot([stay()]), "2032-03-05", mode === "duplicate" ? [occupancy, occupancy] : [occupancy], now);
    expect(result).toHaveLength(1); expect(result[0].detail).toBe(CURRENT_ROOM_UNAVAILABLE);
  });
  it("marks current room unavailable on Shared read failure without historical fallback", () => {
    expect(hotelServices(snapshot([stay()]), "2032-03-05", null, now)[0].detail).toBe(CURRENT_ROOM_UNAVAILABLE);
  });
});

describe("independent current detail evidence", () => {
  it("resolves exact current Single and Shared evidence", () => {
    expect(currentHotelRoomLabel(stay(), [], now)).toBe("Current Single");
    expect(currentHotelRoomLabel(stay({ capacityReservation: null, roomAllocations: [] }), [shared()], now)).toBe("Current Shared");
  });
  it.each(["past", "future", "archived", "duplicate", "no-capacity"])("fails closed for %s Single evidence", mode => {
    const value = stay();
    if (mode === "past") value.roomAllocations[0].allocatedUntil = "2032-03-04T00:00:00Z";
    if (mode === "future") value.roomAllocations[0].allocatedFrom = "2032-03-06T00:00:00Z";
    if (mode === "archived") value.roomAllocations[0].archivedAt = "2032-03-02T00:00:00Z";
    if (mode === "duplicate") value.roomAllocations.push({ ...value.roomAllocations[0], id: "second" });
    if (mode === "no-capacity") value.capacityReservation = null;
    expect(currentHotelRoomLabel(value, [], now)).toBe(CURRENT_ROOM_UNAVAILABLE);
  });
  it("does not claim current occupancy before check-in or after completion", () => {
    expect(currentHotelRoomLabel(stay({ checkedInAt: null }), [], now)).toBe("입실 전 · 현재 점유 없음");
    expect(currentHotelRoomLabel(stay({ checkedOutAt: "2032-03-04T00:00:00Z" }), [], now)).toBe("이용 종료 · 현재 호실 없음");
  });
  it("reads current date Shared plus a fresh stay, without projection or mutation RPC", async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    vi.mocked(supabase.rpc).mockImplementation((name: string) => Promise.resolve({ data: name === "hotel_stay_json" ? stay() : [shared()], error: null }) as never);
    expect(await fetchCurrentHotelRoomLabel("stay")).toBe("Current Shared");
    expect(supabase.rpc).toHaveBeenCalledTimes(2);
    expect(supabase.rpc).toHaveBeenCalledWith("hotel_stay_json", { p_hotel_stay_id: "stay" });
    expect(supabase.rpc).toHaveBeenCalledWith("get_hotel_shared_room_occupancies", { p_date: "2032-03-05" });
  });
  it("returns unavailable on read rejection", async () => {
    vi.mocked(supabase.rpc).mockRejectedValue(new Error("offline"));
    expect(await fetchCurrentHotelRoomLabel("stay")).toBe(CURRENT_ROOM_UNAVAILABLE);
  });
  it("completed detail never displays a supplied current room but preserves canonical event rooms", () => {
    const value = stay({ checkedOutAt: "2032-03-04T00:00:00Z" });
    value.scheduleEvents = (["check_in", "check_out"] as const).map(eventKind => ({ eventKind, schedule: { id: eventKind, title: "예약", memo: null, startsAt: "2032-03-04T00:00:00Z", endsAt: "2032-03-04T00:00:00Z", timeUnspecified: false, status: "completed", calendarId: "calendar", scheduleTypeId: "type", assignees: [] } }));
    const projections = new Map<string, HotelEventRoomProjection>(value.scheduleEvents.map(e => [e.schedule.id, { operationScheduleId: e.schedule.id, hotelStayId: value.id, hotelEventKind: e.eventKind, hotelRoomName: `Historical ${e.eventKind}`, hotelRoomTypeName: "OLD", hotelSharedRoom: false, roomResolutionStatus: "resolved" }]));
    const noop = vi.fn();
    render(<StayDetailModal open stay={value} selectedDate="2032-03-04" loading={false} creatorName="담당자" sharedOccupancy={null} canMergeSharedRoom={false} operationRole={null}
      onClose={noop} onEdit={noop} onAssign={noop} onReassign={noop} onMove={noop} onUnassign={noop} onCheckIn={noop} onCheckOut={noop} onReverseCheckIn={noop} onChangePlannedCheckout={noop} onCancel={noop} onMergeSharedRoom={noop}
      currentRoomLabel="Stale room" eventRoomProjections={projections} />);
    expect(screen.getByText("현재 호실").parentElement).toHaveTextContent("이용 종료 · 현재 호실 없음");
    expect(screen.queryByText("Stale room")).not.toBeInTheDocument();
    expect(screen.getByText("입실 객실").parentElement).toHaveTextContent("Historical check_in");
    expect(screen.getByText("퇴실 객실").parentElement).toHaveTextContent("Historical check_out");
  });
});
