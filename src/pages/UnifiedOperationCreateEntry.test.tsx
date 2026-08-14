// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UnifiedOperationCreateEntryModal } from "./UnifiedOperationCreateEntryModal";
import { LongStayRegistrationForm } from "./LongStayRegistrationForm";

const mocks = vi.hoisted(() => ({
  createLongStayContract: vi.fn(),
  fetchHotelOperationsSnapshot: vi.fn(),
}));

vi.mock("../platform/longStayHotelRepository", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../platform/longStayHotelRepository")>()),
  createLongStayContract: mocks.createLongStayContract,
}));
vi.mock("./hotelOperationsRepository", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./hotelOperationsRepository")>()),
  fetchHotelOperationsSnapshot: mocks.fetchHotelOperationsSnapshot,
}));
vi.mock("./operationsScheduleRepository", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./operationsScheduleRepository")>()),
  seoulDateKey: () => "2026-08-14",
}));

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

describe("unified operation create entry", () => {
  it("renders the four product-first registration types", () => {
    const onSelect = vi.fn();
    render(<UnifiedOperationCreateEntryModal open longStayAllowed onSelect={onSelect} onClose={vi.fn()} />);

    for (const label of ["호텔 예약", "데이케어 예약", "장기호텔", "상담·일반 일정"]) {
      expect(screen.getByRole("button", { name: new RegExp(label) })).not.toBeNull();
    }
    fireEvent.click(screen.getByRole("button", { name: /데이케어 예약/ }));
    expect(onSelect).toHaveBeenCalledWith("daycare");
  });

  it("preserves the owner-manager permission boundary for Long Stay", () => {
    render(<UnifiedOperationCreateEntryModal open longStayAllowed={false} onSelect={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: /장기호텔/ }).hasAttribute("disabled")).toBe(true);
  });

  it("submits Calendar-prefilled Long Stay through the canonical contract RPC", async () => {
    const onSaved = vi.fn();
    mocks.createLongStayContract.mockResolvedValue({ id: "contract-1" });
    render(
      <LongStayRegistrationForm
        customers={[{ id: "customer-1", name: "보호자" }]}
        dogs={[{ id: "dog-1", name: "감자", customerId: "customer-1" }]}
        prefill={{ startedOn: "2026-08-14" }}
        initialHotelSnapshot={snapshot}
        onSaved={onSaved}
        onCancel={vi.fn()}
      />,
    );

    expect((screen.getByLabelText("계약 시작일") as HTMLInputElement).value).toBe("2026-08-14");
    fireEvent.change(screen.getByLabelText("보호자"), { target: { value: "customer-1" } });
    fireEvent.change(screen.getByLabelText("반려견"), { target: { value: "dog-1" } });
    fireEvent.change(screen.getByLabelText("월 금액"), { target: { value: "900000" } });
    fireEvent.click(screen.getByRole("button", { name: "계약 등록" }));

    await waitFor(() => expect(mocks.createLongStayContract).toHaveBeenCalledTimes(1));
    expect(mocks.createLongStayContract.mock.calls[0][0]).toMatchObject({
      customerId: "customer-1",
      dogId: "dog-1",
      startedOn: "2026-08-14",
      monthlyRate: 900000,
    });
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("wires Calendar and both Profile shortcuts to the same canonical forms", () => {
    const source = (name: string) => readFileSync(resolve(process.cwd(), "src/pages", name), "utf8");
    const calendar = source("OperationsCalendarFoundation.tsx");
    const customer = source("CustomerProfileModal.tsx");
    const dog = source("DogProfileModal.tsx");
    const longStay = source("LongStayProfileSection.tsx");

    expect(calendar).toContain("<UnifiedOperationCreateEntryModal");
    expect(calendar).toContain("<DaycareReservationModal");
    expect(calendar).toContain("<LongStayRegistrationForm");
    expect(calendar).toContain("prefill={{ serviceDate: selectedDate }}");
    expect(calendar).toContain("prefill={{ startedOn: selectedDate }}");
    expect(customer).toContain("<DaycareReservationModal");
    expect(dog).toContain("<DaycareReservationModal");
    expect(customer).toContain("<LongStayProfileSection");
    expect(dog).toContain("<LongStayProfileSection");
    expect(longStay).toContain("<LongStayRegistrationForm");
  });
});
