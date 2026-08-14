// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DaycareReservationForm, validateDaycareReservationInput } from "./DaycareReservationModal";
import { LongStayRegistrationForm } from "./LongStayRegistrationForm";

const mocks = vi.hoisted(() => ({
  createDaycare: vi.fn(),
  createLongStay: vi.fn(),
  options: vi.fn(),
  snapshot: vi.fn(),
}));

vi.mock("./daycareOperationsRepository", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./daycareOperationsRepository")>()),
  createDaycareReservation: mocks.createDaycare,
}));
vi.mock("../platform/longStayHotelRepository", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../platform/longStayHotelRepository")>()),
  createLongStayContract: mocks.createLongStay,
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

const customers = [
  { id: "customer-1", name: "감자 보호자", phone: "01011112222" },
  { id: "customer-2", name: "보리 보호자", phone: "01033334444" },
];
const dogs = [
  { id: "dog-1", name: "감자", customerId: "customer-1", breed: "푸들", sex: "male" as const },
  { id: "dog-2", name: "보리", customerId: "customer-2", breed: "말티즈", sex: "female" as const },
];
const options = {
  calendars: [{ id: "daycare", name: "데이케어", businessUnitCode: "daycare", businessUnitName: "데이케어", scopeType: "business_unit", color: "#06b6d4", sortOrder: 1 }],
  scheduleTypes: [{ id: "daycare-type", name: "데이케어", calendarIds: ["daycare"], color: "#06b6d4", sortOrder: 1 }],
  customers,
  dogs,
  assignees: [{ id: "staff-1", name: "담당자" }],
};
const snapshot = {
  date: "2026-08-14",
  roomTypes: [{ id: "deluxe", code: "DELUXE", name: "DELUXE", activeRooms: 1, reservedPeak: 0, checkedInNow: 0, allocatedNow: 0, reservedNow: 0, unassignedNow: 0, physicallyEmpty: 1 }],
  rooms: [],
  settings: null,
  stays: [],
  unassignedFuture: [],
};

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
});

async function choose(label: "보호자" | "반려견", query: string, optionName: RegExp) {
  const input = screen.getByRole("combobox", { name: label });
  fireEvent.change(input, { target: { value: query } });
  const option = await screen.findByRole("option", { name: optionName });
  fireEvent.click(option);
}

describe("canonical customer and dog search forms", () => {
  it("links a searched Daycare dog to its customer and keeps the create payload unchanged", async () => {
    mocks.options.mockResolvedValue(options);
    mocks.snapshot.mockResolvedValue(snapshot);
    mocks.createDaycare.mockResolvedValue({ operationScheduleId: "schedule-1" });
    render(<DaycareReservationForm onClose={vi.fn()} onSaved={vi.fn()} />);

    await waitFor(() => expect(screen.getByRole("combobox", { name: "반려견" })).not.toBeNull());
    for (const section of ["예약 대상", "이용 정보", "운영 정보", "메모"]) {
      expect(screen.getByRole("heading", { name: section })).not.toBeNull();
    }
    expect(screen.getByPlaceholderText("반려견, 보호자 또는 전화번호 검색")).not.toBeNull();
    expect(screen.getByPlaceholderText("보호자, 전화번호 또는 반려견 검색")).not.toBeNull();
    await choose("반려견", "0101111", /감자/);
    expect(screen.getByLabelText("보호자 선택됨").textContent).toContain("감자 보호자");

    fireEvent.click(screen.getByRole("button", { name: /예약 저장/ }));
    await waitFor(() => expect(mocks.createDaycare).toHaveBeenCalledTimes(1));
    expect(mocks.createDaycare.mock.calls[0][0]).toMatchObject({
      customerId: "customer-1",
      dogId: "dog-1",
      serviceDate: "2026-08-14",
      roomTypeId: "deluxe",
    });
  });

  it("filters Daycare dogs after selecting a customer and rejects mismatched pairs", async () => {
    mocks.options.mockResolvedValue(options);
    mocks.snapshot.mockResolvedValue(snapshot);
    render(<DaycareReservationForm onClose={vi.fn()} onSaved={vi.fn()} />);
    await choose("보호자", "보리 보호자", /보리 보호자/);
    fireEvent.change(screen.getByRole("combobox", { name: "반려견" }), { target: { value: "감자" } });
    await waitFor(() => expect(screen.queryByRole("option", { name: /감자/ })).toBeNull());
    expect(validateDaycareReservationInput({
      calendarId: "daycare", scheduleTypeId: "daycare-type", customerId: "customer-2", dogId: "dog-1",
      serviceDate: "2026-08-14", checkInTime: "10:00", checkOutTime: "18:00", roomTypeId: "deluxe",
      roomId: null, assigneeIds: ["staff-1"], memo: "",
    }, dogs)).toContain("일치하지 않습니다");
  });

  it("uses the same search flow for Long Stay and links dog to customer", async () => {
    mocks.createLongStay.mockResolvedValue({ id: "contract-1" });
    render(
      <LongStayRegistrationForm
        customers={customers}
        dogs={dogs}
        initialHotelSnapshot={snapshot}
        onCancel={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    for (const section of ["예약 대상", "이용 정보", "운영 정보", "계약 정보", "메모"]) {
      expect(screen.getByRole("heading", { name: section })).not.toBeNull();
    }
    expect(screen.getByTestId("modal-actions")).not.toBeNull();
    await choose("반려견", "감자", /감자/);
    expect(screen.getByLabelText("보호자 선택됨").textContent).toContain("감자 보호자");
    fireEvent.change(screen.getByLabelText("월 금액"), { target: { value: "900000" } });
    fireEvent.click(screen.getByRole("button", { name: "계약 등록" }));
    await waitFor(() => expect(mocks.createLongStay).toHaveBeenCalledTimes(1));
    expect(mocks.createLongStay.mock.calls[0][0]).toMatchObject({
      customerId: "customer-1",
      dogId: "dog-1",
      startedOn: "2026-08-14",
      monthlyRate: 900000,
    });
  });

  it("preserves Customer and Dog profile prefills as searchable selected values", async () => {
    render(
      <LongStayRegistrationForm
        customers={customers}
        dogs={dogs}
        prefill={{ customerId: "customer-1", dogId: "dog-1" }}
        initialHotelSnapshot={snapshot}
        onCancel={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("보호자 선택됨").textContent).toContain("감자 보호자");
    expect(screen.getByLabelText("반려견 선택됨").textContent).toContain("감자");
    expect(screen.getByRole("combobox", { name: "보호자" }).hasAttribute("disabled")).toBe(false);
    expect(screen.getByRole("combobox", { name: "반려견" }).hasAttribute("disabled")).toBe(false);
  });
});
