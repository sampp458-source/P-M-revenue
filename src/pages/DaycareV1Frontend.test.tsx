// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { calculateOperationTodaySummary, type OperationSchedule } from "./operationsScheduleRepository";
import { scheduleBusiness } from "./operationSchedulePresentation";
import { DaycareReservationModal, validateDaycareReservationInput } from "./DaycareReservationModal";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  options: vi.fn(),
  snapshot: vi.fn(),
}));

vi.mock("./daycareOperationsRepository", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./daycareOperationsRepository")>()),
  createDaycareReservation: mocks.create,
  updateDaycareReservation: mocks.update,
}));
vi.mock("./operationsScheduleRepository", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./operationsScheduleRepository")>()),
  fetchOperationScheduleOptions: mocks.options,
  seoulDateKey: () => "2026-08-14",
}));
vi.mock("./hotelOperationsRepository", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./hotelOperationsRepository")>()),
  fetchHotelOperationsSnapshot: mocks.snapshot,
}));

const options = {
  calendars: [{ id: "kindergarten", name: "유치원", businessUnitCode: "daycare", businessUnitName: "유치원", scopeType: "business_unit", color: "#06b6d4", sortOrder: 0 }, { id: "daycare-calendar", name: "Hotel", businessUnitCode: "hotel", businessUnitName: "데이케어", scopeType: "business_unit", color: "#06b6d4", sortOrder: 1 }],
  scheduleTypes: [{ id: "checkin-out", name: "입실·퇴실", calendarIds: ["daycare-calendar"] }, { id: "5cadf20b-021a-4948-a5dd-471677f51d21", name: "호텔 데이케어", calendarIds: ["daycare-calendar"] }],
  customers: [{ id: "customer-1", name: "보호자", phone: "01012345678" }],
  dogs: [{ id: "dog-1", customerId: "customer-1", name: "감자" }],
  assignees: [{ id: "staff-1", name: "담당자" }],
};
const snapshot = {
  date: "2026-08-14",
  roomTypes: [{ id: "deluxe", code: "DELUXE", name: "DELUXE", activeRooms: 1, reservedPeak: 0, checkedInNow: 0, allocatedNow: 0, reservedNow: 0, unassignedNow: 0, physicallyEmpty: 1 }],
  rooms: [{ id: "room-1", roomTypeId: "deluxe", roomTypeCode: "DELUXE", roomTypeName: "DELUXE", name: "DELUXE 1", sortOrder: 1, isActive: true }],
  settings: null,
  stays: [],
  unassignedFuture: [],
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Daycare V1 common form", () => {
  it("classifies by actual calendar business identity, preserving kindergarten and hotel events", () => {
    const schedules = [
      { id: "new-daycare", businessUnitCode: "hotel", calendarId: "hotel", title: "임의 제목" },
      { id: "kindergarten", businessUnitCode: "daycare", calendarId: "kindergarten", title: "데이케어 문자열" },
      { id: "checkin", businessUnitCode: "hotel", calendarId: "hotel", hotelEventKind: "check_in" },
      { id: "checkout", businessUnitCode: "hotel", calendarId: "hotel", hotelEventKind: "check_out" },
    ] as OperationSchedule[];
    expect(scheduleBusiness(schedules[0]).label).toBe("호텔");
    expect(scheduleBusiness(schedules[1]).label).toBe("유치원");
    expect(calculateOperationTodaySummary(schedules).counts).toMatchObject({ hotel: 3, daycare: 1 });
  });
  it("validates one same-day service block with required exact times and room type", () => {
    const base = { calendarId: "c", scheduleTypeId: "t", customerId: "customer", dogId: "dog", serviceDate: "2026-08-14", checkInTime: "10:00", checkOutTime: "18:00", roomTypeId: "deluxe", roomId: null, assigneeIds: ["staff"], memo: "" };
    expect(validateDaycareReservationInput(base)).toBe("");
    expect(validateDaycareReservationInput({ ...base, checkInTime: "" })).toContain("입실·퇴실 시간");
    expect(validateDaycareReservationInput({ ...base, checkOutTime: "10:00" })).toContain("늦어야");
    expect(validateDaycareReservationInput({ ...base, roomTypeId: "" })).toContain("객실 유형");
  });

  it("renders the actual common modal with customer/dog prefill and no checkout date field", async () => {
    mocks.options.mockResolvedValue(options);
    mocks.snapshot.mockResolvedValue(snapshot);
    render(<DaycareReservationModal open prefill={{ customerId: "customer-1", dogId: "dog-1", serviceDate: "2026-08-14" }} onClose={vi.fn()} onSaved={vi.fn()} />);

    expect(await screen.findByRole("dialog", { name: "데이케어 예약" })).not.toBeNull();
    expect(screen.getByRole("combobox", { name: "보호자" })).not.toBeNull();
    expect(screen.getByRole("combobox", { name: "반려견" })).not.toBeNull();
    expect(screen.getByLabelText("보호자 선택됨").textContent).toContain("보호자");
    expect(screen.getByLabelText("반려견 선택됨").textContent).toContain("감자");
    expect(screen.getByLabelText("데이케어 날짜")).not.toBeNull();
    expect(screen.queryByLabelText(/퇴실 날짜/)).toBeNull();
    expect(screen.getByLabelText("입실 시간")).not.toBeNull();
    expect(screen.getByLabelText("퇴실 시간")).not.toBeNull();
    expect(screen.getByText("호실 (선택)")).not.toBeNull();
    expect(screen.getByTestId("modal-actions")).not.toBeNull();
  });

  it("submits the canonical single-block payload with optional room", async () => {
    mocks.options.mockResolvedValue(options);
    mocks.snapshot.mockResolvedValue(snapshot);
    mocks.create.mockResolvedValue({ operationScheduleId: "schedule-1" });
    render(<DaycareReservationModal open prefill={{ customerId: "customer-1", dogId: "dog-1" }} onClose={vi.fn()} onSaved={vi.fn()} />);
    await screen.findByRole("dialog", { name: "데이케어 예약" });
    await waitFor(() => expect((screen.getByLabelText("객실 유형") as HTMLSelectElement).value).toBe("deluxe"));
    fireEvent.click(screen.getByRole("button", { name: /예약 저장/ }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    expect(mocks.create.mock.calls[0][0]).toMatchObject({
      calendarId: "daycare-calendar", scheduleTypeId: "5cadf20b-021a-4948-a5dd-471677f51d21",
      customerId: "customer-1", dogId: "dog-1", serviceDate: "2026-08-14",
      checkInTime: "10:00", checkOutTime: "18:00", roomTypeId: "deluxe", roomId: null,
    });
  });


  it("fails closed when the dedicated hotel daycare type is unavailable", async () => {
    mocks.options.mockResolvedValue({ ...options, scheduleTypes: [options.scheduleTypes[0]] });
    mocks.snapshot.mockResolvedValue(snapshot);
    render(<DaycareReservationModal open prefill={{ customerId: "customer-1", dogId: "dog-1" }} onClose={vi.fn()} onSaved={vi.fn()} />);
    await waitFor(() => expect((screen.getByLabelText("객실 유형") as HTMLSelectElement).value).toBe("deluxe"));
    fireEvent.click(screen.getByRole("button", { name: /예약 저장/ }));
    expect(await screen.findByText("호텔 데이케어 캘린더와 일정 유형을 확인해 주세요.")).not.toBeNull();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("uses the hotel calendar/type on edit while preserving room, times, assignees and version", async () => {
    mocks.options.mockResolvedValue(options);
    mocks.snapshot.mockResolvedValue(snapshot);
    mocks.update.mockResolvedValue({ operationScheduleId: "edited" });
    const reservation = {
      operationScheduleId: "edited", calendarId: "kindergarten", scheduleTypeId: "class",
      startsAt: "2026-08-14T02:00:00Z", endsAt: "2026-08-14T05:00:00Z",
      customer: { id: "customer-1" }, dog: { id: "dog-1" }, roomTypeId: "deluxe",
      roomAllocation: { roomId: "room-1" }, assignees: [{ id: "staff-1" }], memo: "유지", version: 4,
    } as Parameters<typeof DaycareReservationModal>[0]["reservation"];
    render(<DaycareReservationModal open reservation={reservation} onClose={vi.fn()} onSaved={vi.fn()} />);
    await waitFor(() => expect((screen.getByLabelText("객실 유형") as HTMLSelectElement).value).toBe("deluxe"));
    fireEvent.click(screen.getByRole("button", { name: /예약 저장/ }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1));
    expect(mocks.update.mock.calls[0]).toEqual(["edited", 4, expect.objectContaining({
      calendarId: "daycare-calendar", scheduleTypeId: "5cadf20b-021a-4948-a5dd-471677f51d21",
      checkInTime: "11:00", checkOutTime: "14:00", roomId: "room-1", memo: "유지", assigneeIds: ["staff-1"],
    })]);
  });

  it("wires Calendar, Customer, Dog, Hotel Operations, and Room Board to the shared domain", () => {
    const pageSource = (name: string) => readFileSync(resolve(process.cwd(), "src/pages", name), "utf8");
    const calendar = pageSource("OperationsCalendarFoundation.tsx");
    const customer = pageSource("CustomerProfileModal.tsx");
    const dog = pageSource("DogProfileModal.tsx");
    const hotel = pageSource("HotelOperations.tsx");
    const board = pageSource("HotelRoomBoard.tsx");
    const queue = pageSource("DaycareOperationsPanel.tsx");
    expect(calendar).toContain("<DaycareReservationModal");
    expect(calendar).toContain("schedule.daycareReservation");
    expect(calendar).toContain("일반 일정으로 삭제할 수 없습니다");
    expect(customer).toContain("<DaycareReservationModal");
    expect(customer).toContain("prefill={{ customerId: customer.id }}");
    expect(dog).toContain("prefill={{ customerId: owner.id, dogId: dog.id }}");
    expect(hotel).toContain("fetchDaycareOperationsForDate(selectedDate)");
    expect(hotel).toContain("<DaycareOperationsPanel");
    expect(board).toContain("daycareReservation.lifecycleStatus === \"checked_in\"");
    expect(board).toContain("reservation.lifecycleStatus !== \"completed\"");
    for (const operation of [
      "assignDaycareRoom", "unassignDaycareRoom", "completeDaycareCheckIn",
      "completeDaycareCheckOut", "cancelDaycareReservation",
    ]) expect(queue).toContain(operation);
  });
});
