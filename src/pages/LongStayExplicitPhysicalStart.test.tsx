// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LongStayMonthContractProjection } from "../platform/longStayHotelContract";
import {
  firstPhysicalStartDateDefault,
  LongStayOperationsPanel,
} from "./LongStayOperationsPanel";

const repositoryMocks = vi.hoisted(() => ({
  completeLongStayAbsence: vi.fn(),
  completeLongStayCheckIn: vi.fn(),
  completeLongStayCheckOut: vi.fn(),
  confirmLongStayMonth: vi.fn(),
  getLongStayContract: vi.fn(),
  getLongStayHotelVersion: vi.fn(),
  getLongStayMonth: vi.fn(),
  getLongStayRoomAvailability: vi.fn(),
  reverseLongStayCompletion: vi.fn(),
  setLongStayPlannedCheckout: vi.fn(),
  startLongStayAbsence: vi.fn(),
}));

vi.mock("../platform/longStayHotelRepository", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../platform/longStayHotelRepository")>()),
  ...repositoryMocks,
}));
vi.mock("./OperationsToday", () => ({
  hotelScheduleTypeForCalendar: () => ({ id: "hotel-schedule-type" }),
}));

const contract = (overrides: Partial<LongStayMonthContractProjection> = {}): LongStayMonthContractProjection => ({
  id: "contract-1",
  customerId: "customer-1",
  customerName: "보호자",
  dogId: "dog-1",
  dogName: "감자",
  storedStatus: "pending",
  derivedStatus: "pending",
  startedOn: "2026-06-11",
  plannedCheckOutDate: null,
  checkedInAt: null,
  checkedOutAt: null,
  hotelStayId: null,
  version: 1,
  isOpenEnded: true,
  runtimeCapacityUntil: null,
  runtimeAllocationUntil: null,
  currentRoom: null,
  isAway: false,
  monthlyOccupancy: null,
  monthlyState: "unassigned",
  ...overrides,
});

const snapshot = {
  date: "2026-08-13",
  roomTypes: [],
  rooms: [{
    id: "deluxe-5",
    roomTypeId: "deluxe",
    roomTypeCode: "DELUXE",
    roomTypeName: "DELUXE",
    name: "DELUXE 5",
    sortOrder: 5,
    isActive: true,
  }],
  settings: {
    id: "hotel-settings",
    version: 1,
    defaultCheckInTime: "15:00:00",
    defaultCheckOutTime: "11:00:00",
    timezone: "Asia/Seoul",
  },
  stays: [],
  unassignedFuture: [],
};

const options = {
  calendars: [{
    id: "hotel-calendar",
    name: "Hotel Operations",
    scopeType: "business_unit",
    color: "#000",
    sortOrder: 1,
    businessUnitCode: "hotel",
    businessUnitName: "호텔",
  }],
  scheduleTypes: [],
  assignees: [{ id: "staff-1", name: "담당자" }],
  customers: [],
  dogs: [],
};

const availability = {
  contractId: "contract-1",
  serviceMonth: "2026-08-01",
  availabilityFrom: "2026-08-13T06:00:00Z",
  isOpenEnded: true,
  rooms: [{
    roomId: "deluxe-5",
    roomName: "DELUXE 5",
    roomTypeId: "deluxe",
    roomTypeCode: "DELUXE",
    roomTypeName: "DELUXE",
    assignable: true,
    nextConflictFrom: null,
    nextConflictUntil: null,
    conflictSource: null,
    conflictPhase: null,
    reason: "사용 가능",
  }],
};

const renderPanel = (value: LongStayMonthContractProjection) => {
  repositoryMocks.getLongStayMonth.mockResolvedValue({ serviceMonth: "2026-08-01", contracts: [value] });
  repositoryMocks.getLongStayRoomAvailability.mockResolvedValue(availability);
  repositoryMocks.confirmLongStayMonth.mockResolvedValue(value);
  return render(<LongStayOperationsPanel
    snapshot={snapshot as never}
    options={options as never}
    operationRole="owner"
    selectedBusinessDate="2026-08-13"
    onHotelSnapshotRefresh={vi.fn().mockResolvedValue(undefined)}
  />);
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("Long Stay explicit first physical start", () => {
  it("uses the selected business date as an editable, visible first-runtime boundary", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-13T12:00:00+09:00"));
    renderPanel(contract());

    fireEvent.click(await screen.findByRole("button", { name: "객실 배정" }));
    const date = screen.getByLabelText("객실 사용 시작 날짜") as HTMLInputElement;
    const time = screen.getByLabelText("객실 사용 시작 시간") as HTMLInputElement;
    expect(date.value).toBe("2026-08-13");
    expect(time.value).toBe("15:00");
    expect(date.min).toBe("2026-08-01");
    expect(date.max).toBe("2026-08-31");
    await waitFor(() => expect(repositoryMocks.getLongStayRoomAvailability).toHaveBeenCalledWith({
      contractId: "contract-1",
      serviceMonth: "2026-08-01",
      physicalStartDate: "2026-08-13",
      checkInTime: "15:00",
      checkInTimeUnspecified: false,
    }));

    fireEvent.change(date, { target: { value: "2026-08-14" } });
    fireEvent.change(time, { target: { value: "16:30" } });
    await waitFor(() => expect(repositoryMocks.getLongStayRoomAvailability).toHaveBeenLastCalledWith(
      expect.objectContaining({ physicalStartDate: "2026-08-14", checkInTime: "16:30" }),
    ));
    fireEvent.click(await screen.findByRole("button", { name: "확인" }));
    await waitFor(() => expect(repositoryMocks.confirmLongStayMonth).toHaveBeenCalledWith(
      expect.objectContaining({
        physicalStartDate: "2026-08-14",
        checkInTime: "16:30",
        checkInTimeUnspecified: false,
      }),
      expect.any(String),
    ));
  });

  it("uses midnight parity for unknown time and never re-enters a start for existing runtime", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-13T12:00:00+09:00"));
    const rendered = renderPanel(contract());
    fireEvent.click(await screen.findByRole("button", { name: "객실 배정" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "시간 미정" }));
    await waitFor(() => expect(repositoryMocks.getLongStayRoomAvailability).toHaveBeenLastCalledWith(
      expect.objectContaining({
        physicalStartDate: "2026-08-13",
        checkInTime: null,
        checkInTimeUnspecified: true,
      }),
    ));

    rendered.unmount();
    vi.clearAllMocks();
    renderPanel(contract({ hotelStayId: "stay-1" }));
    fireEvent.click(await screen.findByRole("button", { name: "객실 배정" }));
    expect(screen.queryByLabelText("객실 사용 시작 날짜")).toBeNull();
    await waitFor(() => expect(repositoryMocks.getLongStayRoomAvailability).toHaveBeenCalledWith(
      expect.objectContaining({ physicalStartDate: null }),
    ));
  });

  it("falls back deterministically inside the service month", () => {
    expect(firstPhysicalStartDateDefault("2026-08-13", "2026-08-01", "2026-06-11")).toBe("2026-08-13");
    expect(firstPhysicalStartDateDefault("2026-09-10", "2026-08-01", "2026-06-11")).toBe("2026-08-01");
    expect(firstPhysicalStartDateDefault("2026-08-01", "2026-08-01", "2026-08-12")).toBe("2026-08-12");
  });
});
