// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { supabase } from "../lib/supabase";
import { fetchHotelEventRoomProjections, type HotelStay, type HotelEventRoomProjection } from "./hotelOperationsRepository";
import { activeHotelAllocation, hotelEventRoomLabel } from "./hotelOperationsUi";
import { StayRow, StayDetailModal } from "./HotelOperations";

vi.mock("../lib/supabase", () => ({ supabase: { rpc: vi.fn() } }));
afterEach(cleanup);
beforeEach(() => { vi.mocked(supabase.rpc).mockReset(); });

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
const projection = (kind: "check_in" | "check_out" = "check_in", overrides: Partial<HotelEventRoomProjection> = {}): HotelEventRoomProjection => ({
  operationScheduleId: kind, hotelStayId: "synthetic-stay", hotelEventKind: kind,
  hotelRoomTypeName: "OLD", hotelRoomName: kind === "check_in" ? "입실 당시 객실" : "퇴실 당시 객실",
  hotelSharedRoom: false, roomResolutionStatus: "resolved", ...overrides,
});
const map = (...rows: HotelEventRoomProjection[]) => new Map(rows.map(row => [row.operationScheduleId, row]));
const respond = (data: unknown, error: unknown = null) => vi.mocked(supabase.rpc).mockResolvedValue({ data, error } as never);

describe("Hotel event presentation batch adapter", () => {
  it("batches and deduplicates all snapshot/detail event identities without modifying physical data", async () => {
    const original = stay();
    const before = structuredClone(original);
    const other = { ...stay(), id: "second", scheduleEvents: stay().scheduleEvents.map(e => ({ ...e, schedule: { ...e.schedule, id: `second-${e.schedule.id}` } })) };
    respond([projection(), projection("check_out")]);
    const result = await fetchHotelEventRoomProjections([original, original, other]);
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
    expect(supabase.rpc).toHaveBeenCalledWith("get_operation_hotel_room_projections", {
      p_operation_schedule_ids: ["check_in", "check_out", "second-check_in", "second-check_out"],
    });
    expect(result.size).toBe(2);
    expect(original).toEqual(before);
  });
  it("does not call any RPC for an empty event collection", async () => {
    expect((await fetchHotelEventRoomProjections([])).size).toBe(0);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
  it.each(["error", "rejection", "missing", "duplicate", "wrong-stay", "wrong-event", "malformed", "empty-room"])("fails closed on %s without physical fallback", async mode => {
    const row = projection();
    if (mode === "error") respond(null, { message: "denied" });
    if (mode === "rejection") vi.mocked(supabase.rpc).mockRejectedValue(new Error("offline"));
    if (mode === "missing") respond([]);
    if (mode === "duplicate") respond([row, row]);
    if (mode === "wrong-stay") respond([{ ...row, hotelStayId: "another" }]);
    if (mode === "wrong-event") respond([{ ...row, hotelEventKind: "check_out" }]);
    if (mode === "malformed") respond([{ ...row, hotelSharedRoom: undefined }]);
    if (mode === "empty-room") respond([{ ...row, hotelRoomName: "" }]);
    const result = await fetchHotelEventRoomProjections([stay()]);
    expect(hotelEventRoomLabel(stay(), "check_in", result)).toBe("객실 정보 확인 필요");
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
  });
  it("rejects conflicting stay identities rather than choosing the first", async () => {
    respond([projection()]);
    expect((await fetchHotelEventRoomProjections([stay(), { ...stay(), id: "other" }])).size).toBe(0);
  });
});

describe("event room consumers", () => {
  it("preserves check-in history after reassignment and preserves the current physical helper", () => {
    const value = stay();
    render(<StayRow stay={value} selectedDate="2031-02-01" onClick={vi.fn()} eventRoomProjections={map(projection())} />);
    expect(screen.getByRole("button")).toHaveTextContent("입실 객실: 입실 당시 객실");
    expect(screen.getByRole("button")).not.toHaveTextContent("현재 물리 객실");
    expect(screen.getByRole("button")).not.toHaveTextContent("NEW");
    expect(activeHotelAllocation(value)?.roomName).toBe("현재 물리 객실");
  });
  it("uses checkout projection for a historical completed stay", () => {
    render(<StayRow stay={{ ...stay(), checkedOutAt: "2031-02-03T01:00:00Z" }} selectedDate="2031-02-03" onClick={vi.fn()} eventRoomProjections={map(projection("check_out"))} />);
    expect(screen.getByRole("button")).toHaveTextContent("퇴실 객실: 퇴실 당시 객실");
    expect(screen.getByRole("button")).not.toHaveTextContent("현재 물리 객실");
  });
  it("keeps in-house physical display unchanged", () => {
    render(<StayRow stay={stay()} selectedDate="2031-02-02" onClick={vi.fn()} eventRoomProjections={map(projection())} />);
    expect(screen.getByRole("button")).toHaveTextContent("현재 물리 객실");
    expect(screen.getByRole("button")).not.toHaveTextContent("입실 당시 객실");
  });
  it("shows both event rooms when check-in and checkout share a day", () => {
    const value = stay(); value.scheduleEvents[1].schedule.startsAt = value.scheduleEvents[0].schedule.startsAt;
    render(<StayRow stay={value} selectedDate="2031-02-01" onClick={vi.fn()} eventRoomProjections={map(projection(), projection("check_out"))} />);
    expect(screen.getByRole("button")).toHaveTextContent("입실 객실: 입실 당시 객실 / 퇴실 객실: 퇴실 당시 객실");
  });
  it.each([
    ["resolved", "현재 Single 객실", "현재 Single 객실"],
    ["unassigned", null, "OLD · 미배정"],
    ["unknown", null, "객실 미정"],
    ["unavailable", "사용하면 안 되는 객실", "객실 정보 확인 필요"],
  ] as const)("formats %s using the canonical status only", (status, roomName, expected) => {
    expect(hotelEventRoomLabel(stay(), "check_in", map(projection("check_in", { roomResolutionStatus: status, hotelRoomName: roomName })))).toBe(expected);
  });
  it("separates resolved current Shared from unavailable Shared history", () => {
    const projections = map(projection("check_in", { hotelSharedRoom: true, hotelRoomName: "Shared physical" }), projection("check_out", { hotelSharedRoom: true, roomResolutionStatus: "unavailable", hotelRoomName: null }));
    expect(hotelEventRoomLabel(stay(), "check_in", projections)).toBe("Shared physical");
    expect(hotelEventRoomLabel(stay(), "check_out", projections)).toBe("객실 정보 확인 필요");
  });
  it("accepts a Long Stay canonical segment with no current capacity or allocation", () => {
    const value = { ...stay(), capacityReservation: null, roomAllocations: [] };
    expect(hotelEventRoomLabel(value, "check_in", map(projection()))).toBe("입실 당시 객실");
    expect(value.capacityReservation).toBeNull();
    expect(value.roomAllocations).toEqual([]);
  });
  it("fails closed for multiple links of the same event kind", () => {
    const value = stay(); value.scheduleEvents.push({ ...value.scheduleEvents[0], schedule: { ...value.scheduleEvents[0].schedule, id: "extra" } });
    expect(hotelEventRoomLabel(value, "check_in", map(projection()))).toBe("객실 정보 확인 필요");
  });
  it("labels current physical and historical rooms separately in detail", () => {
    const noop = vi.fn();
    render(<StayDetailModal open stay={stay()} selectedDate="2031-02-01" loading={false} creatorName="담당자" sharedOccupancy={null}
      canMergeSharedRoom={false} operationRole={null} onClose={noop} onEdit={noop} onAssign={noop} onReassign={noop} onMove={noop}
      onUnassign={noop} onCheckIn={noop} onCheckOut={noop} onReverseCheckIn={noop} onChangePlannedCheckout={noop} onCancel={noop} onMergeSharedRoom={noop}
      eventRoomProjections={map(projection())} />);
    expect(screen.getByText("현재 호실").parentElement).toHaveTextContent("현재 물리 객실");
    expect(screen.getByText("입실 객실").parentElement).toHaveTextContent("입실 당시 객실");
    expect(screen.getByText("퇴실 객실").parentElement).toHaveTextContent("객실 정보 확인 필요");
  });
});
