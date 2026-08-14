// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LongStayMonthContractProjection } from "../platform/longStayHotelContract";
import { LongStayOperationsPanel } from "./LongStayOperationsPanel";

const repositoryMocks = vi.hoisted(() => ({
  completeLongStayAbsence: vi.fn(), completeLongStayCheckIn: vi.fn(), completeLongStayCheckOut: vi.fn(),
  confirmLongStayMonth: vi.fn(), getLongStayContract: vi.fn(), getLongStayHotelVersion: vi.fn(),
  getLongStayMonth: vi.fn(), getLongStayRoomAvailability: vi.fn(), reverseLongStayCompletion: vi.fn(),
  setLongStayPlannedCheckout: vi.fn(), startLongStayAbsence: vi.fn(),
}));
vi.mock("../platform/longStayHotelRepository", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../platform/longStayHotelRepository")>()), ...repositoryMocks,
}));
vi.mock("./OperationsToday", () => ({ hotelScheduleTypeForCalendar: () => ({ id: "hotel-type" }) }));

const projection = (overrides: Partial<LongStayMonthContractProjection> = {}): LongStayMonthContractProjection => ({
  id: "contract-1", customerId: "customer-1", customerName: "보호자", dogId: "dog-1", dogName: "감자",
  storedStatus: "pending", derivedStatus: "pending", startedOn: "2026-06-11", plannedCheckOutDate: null,
  checkedInAt: "2026-08-13T06:00:00Z", checkedOutAt: null, hotelStayId: "stay-1", version: 3,
  isOpenEnded: true, runtimeCapacityUntil: null, runtimeAllocationUntil: null,
  currentRoom: { id: "room-4", name: "DELUXE 4", roomTypeId: "deluxe" }, isAway: false,
  monthlyOccupancy: { id: "month-1", status: "confirmed", roomTypeId: "deluxe", roomId: "room-4", plannedOccupiedFrom: "2026-08-01T00:00:00Z", plannedOccupiedUntilExclusive: "2026-09-01T00:00:00Z", billingSourceId: "month-1" },
  monthlyState: "active", ...overrides,
});
const snapshot = { date: "2026-08-14", roomTypes: [], rooms: [], settings: null, stays: [], unassignedFuture: [] };
const options = { calendars: [], scheduleTypes: [], assignees: [], customers: [], dogs: [] };

const renderPanel = (value: LongStayMonthContractProjection) => {
  repositoryMocks.getLongStayMonth.mockResolvedValue({ serviceMonth: "2026-08-01", contracts: [value] });
  repositoryMocks.startLongStayAbsence.mockResolvedValue({ ...value, storedStatus: "active", isAway: true });
  repositoryMocks.completeLongStayAbsence.mockResolvedValue({ ...value, storedStatus: "active", isAway: false });
  return render(<LongStayOperationsPanel snapshot={snapshot as never} options={options as never} operationRole="owner" selectedBusinessDate="2026-08-14" onHotelSnapshotRefresh={vi.fn().mockResolvedValue(undefined)} />);
};

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("Long Stay outing expected-return UI", () => {
  it("submits a date with explicitly unknown time using a fresh request id", async () => {
    renderPanel(projection());
    fireEvent.click(await screen.findByRole("button", { name: "외출" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "예상 복귀 날짜 미정" }));
    fireEvent.change(screen.getByLabelText("예상 복귀 날짜"), { target: { value: "2026-08-17" } });
    expect((screen.getByRole("checkbox", { name: "예상 복귀 시간 미정" }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "확인" }));
    await waitFor(() => expect(repositoryMocks.startLongStayAbsence).toHaveBeenCalledWith(
      expect.objectContaining({
        contractId: "contract-1", expectedContractVersion: 3,
        expectedReturnDate: "2026-08-17", expectedReturnTime: null,
        expectedReturnTimeUnspecified: true,
      }), expect.any(String),
    ));
  });

  it("supports exact time and date-unknown payloads without a sentinel", async () => {
    const first = renderPanel(projection());
    fireEvent.click(await screen.findByRole("button", { name: "외출" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "예상 복귀 날짜 미정" }));
    fireEvent.change(screen.getByLabelText("예상 복귀 날짜"), { target: { value: "2026-08-17" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "예상 복귀 시간 미정" }));
    fireEvent.change(screen.getByLabelText("예상 복귀 시간"), { target: { value: "15:00" } });
    fireEvent.click(screen.getByRole("button", { name: "확인" }));
    await waitFor(() => expect(repositoryMocks.startLongStayAbsence).toHaveBeenCalledWith(
      expect.objectContaining({ expectedReturnDate: "2026-08-17", expectedReturnTime: "15:00", expectedReturnTimeUnspecified: false }), expect.any(String),
    ));

    first.unmount(); vi.clearAllMocks(); renderPanel(projection());
    fireEvent.click(await screen.findByRole("button", { name: "외출" }));
    fireEvent.click(screen.getByRole("button", { name: "확인" }));
    await waitFor(() => expect(repositoryMocks.startLongStayAbsence).toHaveBeenCalledWith(
      expect.objectContaining({ expectedReturnDate: null, expectedReturnTime: null, expectedReturnTimeUnspecified: true }), expect.any(String),
    ));
  });

  it("renders exact, time-unknown and date-unknown projections", async () => {
    const view = renderPanel(projection({ isAway: true, currentAbsence: { id: "leave-1", leftAt: "2026-08-14T01:00:00Z", expectedReturnAt: null, expectedReturnDate: "2026-08-17", expectedReturnTimeUnspecified: true } }));
    expect(await screen.findByText("8/17 · 시간 미정")).toBeTruthy();
    view.unmount(); vi.clearAllMocks();
    const exact = "2026-08-17T06:00:00Z";
    renderPanel(projection({ isAway: true, currentAbsence: { id: "leave-2", leftAt: "2026-08-14T01:00:00Z", expectedReturnAt: exact, expectedReturnDate: "2026-08-17", expectedReturnTimeUnspecified: false } }));
    expect(await screen.findByText("8/17 15:00")).toBeTruthy();
    cleanup(); vi.clearAllMocks();
    renderPanel(projection({ isAway: true, currentAbsence: { id: "leave-3", leftAt: "2026-08-14T01:00:00Z", expectedReturnAt: null, expectedReturnDate: null, expectedReturnTimeUnspecified: true } }));
    expect((await screen.findAllByText("미정")).length).toBeGreaterThan(0);
  });
});
