// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HotelOperationsPage } from "./HotelOperations";
import type { HotelOperationsSnapshot } from "./hotelOperationsRepository";
import type { OperationRole, OperationScheduleOptions } from "./operationsScheduleRepository";

const m = vi.hoisted(() => ({
  snapshot: vi.fn(),
  operationRole: vi.fn(),
  daycareList: vi.fn(),
  createDaycare: vi.fn(),
  hotelCreate: vi.fn(),
  createOperation: vi.fn(),
  createLongStay: vi.fn(),
  longStayMonth: vi.fn(),
  options: vi.fn(),
}));

vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ profile: profile }) }));
vi.mock("./hotelOperationsRepository", async (original) => ({
  ...await original<typeof import("./hotelOperationsRepository")>(),
  fetchHotelOperationsSnapshot: m.snapshot,
  fetchHotelEventRoomProjections: async () => new Map(),
  createHotelReservation: m.hotelCreate,
}));
vi.mock("./hotelHistoricalBoardRepository", () => ({
  fetchHistoricalBoard: async (date: string) => ({ selectedDate: date, rooms: [], unavailable: [] }),
}));
vi.mock("./sharedHotelHistoryRepository", () => ({ fetchCompletedSharedStays: async () => [] }));
vi.mock("../platform/multiDogSharedRoomRepository", () => ({
  sharedHotelRoomRepository: { listForDate: async () => [], listUnassigned: async () => [] },
}));
vi.mock("./daycareOperationsRepository", async (original) => ({
  ...await original<typeof import("./daycareOperationsRepository")>(),
  fetchDaycareOperationsForDate: m.daycareList,
  createDaycareReservation: m.createDaycare,
}));
vi.mock("./operationsScheduleRepository", async (original) => ({
  ...await original<typeof import("./operationsScheduleRepository")>(),
  seoulDateKey: () => "2032-01-03",
  fetchOperationScheduleOptions: m.options,
  fetchCurrentOperationRole: m.operationRole,
  createOperationSchedule: m.createOperation,
}));
vi.mock("../platform/longStayHotelRepository", async (original) => ({
  ...await original<typeof import("../platform/longStayHotelRepository")>(),
  createLongStayContract: m.createLongStay,
  getLongStayMonth: m.longStayMonth,
}));

const profile = { id: "staff-1", name: "합성 담당자", role: "staff" };
const TODAY = "2032-01-03";
const FUTURE = "2032-01-06";
const DAYCARE_TYPE = "5cadf20b-021a-4948-a5dd-471677f51d21";
const options: OperationScheduleOptions = {
  calendars: [
    { id: "hotel", name: "호텔", businessUnitCode: "hotel", businessUnitName: "호텔", scopeType: "business_unit", color: "#f97316", sortOrder: 1 },
    { id: "common", name: "공통", businessUnitCode: null, businessUnitName: null, scopeType: "common", color: "#2563eb", sortOrder: 2 },
  ],
  scheduleTypes: [
    { id: "hotel-stay", name: "입실·퇴실", calendarIds: ["hotel"], color: "#f97316", sortOrder: 1 },
    { id: "hotel-consult", name: "호텔 상담", calendarIds: ["hotel"], color: "#64748b", sortOrder: 2 },
    { id: DAYCARE_TYPE, name: "호텔 데이케어", calendarIds: ["hotel"], color: "#06b6d4", sortOrder: 3 },
    { id: "common-consult", name: "공통 일정", calendarIds: ["common"], color: "#2563eb", sortOrder: 1 },
  ],
  assignees: [{ id: profile.id, name: profile.name }],
  customers: [{ id: "guardian", name: "합성 보호자", phone: null }],
  dogs: [
    { id: "dog-1", name: "합성 감자", customerId: "guardian" },
    { id: "dog-2", name: "합성 보리", customerId: "guardian" },
  ],
};
const snapshot = (date: string): HotelOperationsSnapshot => ({
  date,
  roomTypes: [{ id: "deluxe", code: "DELUXE", name: "DELUXE", activeRooms: 1, reservedPeak: 0, checkedInNow: 0, allocatedNow: 0, reservedNow: 0, unassignedNow: 0, physicallyEmpty: 1 }],
  rooms: [],
  settings: { id: "settings", version: 1, defaultCheckInTime: "15:00:00", defaultCheckOutTime: "11:00:00", timezone: "Asia/Seoul" },
  stays: [],
  unassignedFuture: [],
});

beforeEach(() => {
  m.snapshot.mockImplementation(async (date: string) => snapshot(date));
  m.options.mockResolvedValue(options);
  m.daycareList.mockResolvedValue([]);
  m.createDaycare.mockResolvedValue({ operationScheduleId: "synthetic-daycare" });
  m.createLongStay.mockResolvedValue({ id: "synthetic-contract" });
  m.longStayMonth.mockResolvedValue({ contracts: [] });
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.resetAllMocks();
});

async function open(role: OperationRole | null, date = TODAY) {
  m.operationRole.mockResolvedValue(role);
  render(<MemoryRouter initialEntries={["/operations/hotel"]}><HotelOperationsPage /></MemoryRouter>);
  await waitFor(() => expect(screen.getByRole("button", { name: "새 일정" })).toBeEnabled());
  if (date !== TODAY) {
    fireEvent.change(screen.getByLabelText("운영 날짜"), { target: { value: date } });
    await waitFor(() => expect(screen.getByRole("button", { name: "새 일정" })).toBeEnabled());
  }
  fireEvent.click(screen.getByRole("button", { name: "새 일정" }));
  return within(await screen.findByRole("dialog", { name: "새 일정" }));
}

function choose(dialog: ReturnType<typeof within>, value: string) {
  fireEvent.change(dialog.getByRole("combobox", { name: "일정 유형" }), { target: { value } });
}

async function selectDog(dialog: ReturnType<typeof within>, name: string) {
  fireEvent.change(dialog.getByRole("combobox", { name: "반려견" }), { target: { value: name } });
  fireEvent.click(await dialog.findByRole("option", { name: new RegExp(name) }));
}

describe("Hotel Operations 새 일정 entry", () => {
  it("offers the Calendar product chooser in-place and preserves the selected date across modes and reopening", async () => {
    const dialog = await open("owner", FUTURE);
    expect(dialog.getByRole("combobox", { name: "캘린더" })).toHaveValue("hotel");
    expect(dialog.getByRole("combobox", { name: "일정 유형" })).toHaveValue("hotel");
    expect(within(dialog.getByRole("combobox", { name: "일정 유형" })).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "호텔 예약", "데이케어 예약", "장기호텔", "상담·일반 일정",
    ]);
    expect(dialog.getByLabelText(/^입실 날짜/)).toHaveValue(FUTURE);

    choose(dialog, "daycare");
    expect(dialog.getByLabelText("데이케어 날짜")).toHaveValue(FUTURE);
    expect(document.querySelector("form form")).toBeNull();

    choose(dialog, "long-stay");
    expect(dialog.getByLabelText("계약 시작일")).toHaveValue(FUTURE);
    expect(dialog.queryByLabelText("데이케어 날짜")).not.toBeInTheDocument();

    choose(dialog, "general");
    expect(dialog.getByLabelText("제목")).toBeVisible();
    expect(dialog.getByLabelText(/^날짜/)).toHaveValue(FUTURE);
    expect(dialog.getByLabelText("세부 일정 유형")).toHaveValue("hotel-consult");
    expect(dialog.queryByRole("option", { name: "입실·퇴실" })).not.toBeInTheDocument();

    fireEvent.change(dialog.getByRole("combobox", { name: "캘린더" }), { target: { value: "common" } });
    expect(dialog.getByRole("option", { name: "공통 일정" })).toBeInTheDocument();
    expect(dialog.queryByRole("option", { name: "장기호텔" })).not.toBeInTheDocument();
    fireEvent.change(dialog.getByRole("combobox", { name: "캘린더" }), { target: { value: "hotel" } });
    expect(dialog.getByLabelText(/^입실 날짜/)).toHaveValue(FUTURE);

    choose(dialog, "daycare");
    fireEvent.click(dialog.getByRole("button", { name: "취소" }));
    expect(screen.queryByRole("dialog", { name: "새 일정" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "새 일정" }));
    expect(screen.getByRole("combobox", { name: "일정 유형" })).toHaveValue("hotel");
    expect(screen.getByLabelText(/^입실 날짜/)).toHaveValue(FUTURE);
    expect(m.createDaycare).not.toHaveBeenCalled();
    expect(m.createLongStay).not.toHaveBeenCalled();
  });

  it("preserves staff permissions and keeps creation unavailable on a past Hotel date", async () => {
    const dialog = await open("staff");
    expect(dialog.getByRole("option", { name: "장기호텔" })).toBeDisabled();
    expect(dialog.getByRole("option", { name: "데이케어 예약" })).not.toBeDisabled();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "새 일정" })).not.toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("운영 날짜"), { target: { value: "2032-01-01" } });
    await waitFor(() => expect(screen.queryByRole("button", { name: "새 일정" })).not.toBeInTheDocument());
    expect(m.createLongStay).not.toHaveBeenCalled();
  });

  it("creates one shared Deluxe Daycare request with both dogs from Hotel Operations", async () => {
    const dialog = await open("owner", FUTURE);
    choose(dialog, "daycare");
    const share = await dialog.findByRole("checkbox", { name: /한 객실에 두 마리/ });
    await waitFor(() => expect(share).toBeEnabled());
    fireEvent.click(share);
    await selectDog(dialog, "합성 감자");
    await selectDog(dialog, "합성 보리");
    expect(dialog.getByLabelText("객실 유형")).toHaveValue("deluxe");
    expect(dialog.getByLabelText("객실 유형")).toBeDisabled();
    fireEvent.click(dialog.getByRole("button", { name: /예약 저장/ }));
    await waitFor(() => expect(m.createDaycare).toHaveBeenCalledTimes(1));
    expect(m.createDaycare).toHaveBeenCalledWith(expect.objectContaining({
      customerId: "guardian", sharedDogIds: ["dog-1", "dog-2"], roomTypeId: "deluxe", serviceDate: FUTURE,
    }), expect.any(String));
    expect(m.hotelCreate).not.toHaveBeenCalled();
    expect(m.createOperation).not.toHaveBeenCalled();
  });

  it("routes Daycare to its real form and refreshes the selected Hotel board after the single canonical save", async () => {
    const dialog = await open("staff", FUTURE);
    choose(dialog, "daycare");
    await selectDog(dialog, "합성 감자");
    const save = dialog.getByRole("button", { name: "예약 저장" });
    await waitFor(() => expect(save).toBeEnabled());
    const count = m.daycareList.mock.calls.length;
    fireEvent.click(save);
    await screen.findByText("데이케어 예약을 등록했습니다.");
    expect(m.createDaycare).toHaveBeenCalledTimes(1);
    expect(m.createDaycare).toHaveBeenCalledWith(expect.objectContaining({
      calendarId: "hotel", scheduleTypeId: DAYCARE_TYPE, customerId: "guardian",
      dogId: "dog-1", serviceDate: FUTURE, roomTypeId: "deluxe", roomId: null,
    }));
    expect(m.daycareList).toHaveBeenCalledTimes(count + 1);
    expect(m.daycareList).toHaveBeenLastCalledWith(FUTURE);
    expect(screen.getByLabelText("운영 날짜")).toHaveValue(FUTURE);
    expect(screen.queryByRole("dialog", { name: "새 일정" })).not.toBeInTheDocument();
    expect(m.hotelCreate).not.toHaveBeenCalled();
    expect(m.createOperation).not.toHaveBeenCalled();
  });

  it("allows a manager to create only the Long Stay contract and refreshes the open-month contract list", async () => {
    const dialog = await open("manager", FUTURE);
    choose(dialog, "long-stay");
    await selectDog(dialog, "합성 감자");
    fireEvent.change(dialog.getByLabelText("월 금액"), { target: { value: "500000" } });
    const save = dialog.getByRole("button", { name: "계약 등록" });
    await waitFor(() => expect(save).toBeEnabled());
    const listCallCount = m.longStayMonth.mock.calls.length;
    expect(listCallCount).toBeGreaterThan(0);
    const listArgs = m.longStayMonth.mock.calls.at(-1);
    fireEvent.click(save);
    await screen.findByText("장기호텔 계약을 등록했습니다. 이번 달 객실을 배정하세요.");
    expect(m.createLongStay).toHaveBeenCalledTimes(1);
    expect(m.createLongStay).toHaveBeenCalledWith(expect.objectContaining({
      customerId: "guardian", dogId: "dog-1", startedOn: FUTURE, monthlyRate: 500000,
      preferredRoomTypeId: null, preferredRoomId: null,
    }), expect.any(String));
    await waitFor(() => expect(m.longStayMonth).toHaveBeenCalledTimes(listCallCount + 1));
    expect(m.longStayMonth.mock.calls.at(-1)).toEqual(listArgs);
    expect(screen.getByLabelText("운영 날짜")).toHaveValue(FUTURE);
    expect(m.hotelCreate).not.toHaveBeenCalled();
    expect(m.createDaycare).not.toHaveBeenCalled();
  });

  it("keeps a newer draft open if an earlier embedded Daycare save resolves after switching type", async () => {
    let finishSave!: (value: { operationScheduleId: string }) => void;
    m.createDaycare.mockReturnValueOnce(new Promise((resolve) => { finishSave = resolve; }));
    const dialog = await open("staff", FUTURE);
    choose(dialog, "daycare");
    await selectDog(dialog, "합성 감자");
    const save = dialog.getByRole("button", { name: "예약 저장" });
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(save);
    await waitFor(() => expect(m.createDaycare).toHaveBeenCalledTimes(1));
    choose(dialog, "general");
    fireEvent.change(dialog.getByLabelText("제목"), { target: { value: "새 합성 상담 초안" } });
    await act(async () => finishSave({ operationScheduleId: "synthetic-daycare" }));
    await screen.findByText("데이케어 예약을 등록했습니다.");
    expect(dialog.getByLabelText("제목")).toHaveValue("새 합성 상담 초안");
    expect(m.createOperation).not.toHaveBeenCalled();
  });

  it("keeps a Hotel consultation on the generic schedule save path without creating room stock or a stay", async () => {
    m.createOperation.mockResolvedValue({ id: "synthetic-consult" });
    const dialog = await open("staff", FUTURE);
    choose(dialog, "general");
    fireEvent.change(dialog.getByLabelText("제목"), { target: { value: "합성 상담" } });
    fireEvent.click(dialog.getByRole("checkbox", { name: "시간 미정" }));
    fireEvent.click(dialog.getByRole("button", { name: "저장" }));
    await screen.findByText("새 일정을 등록했습니다.");
    expect(m.createOperation).toHaveBeenCalledTimes(1);
    expect(m.createOperation).toHaveBeenCalledWith(expect.objectContaining({
      calendarId: "hotel", scheduleTypeId: "hotel-consult", title: "합성 상담", timeUnspecified: true,
    }), expect.any(String));
    expect(m.hotelCreate).not.toHaveBeenCalled();
    expect(m.createDaycare).not.toHaveBeenCalled();
    expect(m.createLongStay).not.toHaveBeenCalled();
  });

  it("preserves the existing multi-dog Hotel reservation and DELUXE-only shared-room controls", async () => {
    const dialog = await open("staff");
    await selectDog(dialog, "합성 감자");
    await selectDog(dialog, "합성 보리");
    expect(dialog.getByText("2마리 선택됨")).toBeVisible();
    fireEvent.click(dialog.getByRole("radio", { name: "같은 객실에서 함께 투숙" }));
    expect(dialog.getByText(/같은 객실 투숙은 디럭스 객실에서만 가능합니다/)).toBeVisible();
    expect(dialog.getByLabelText("객실 유형")).toBeDisabled();
    expect(m.hotelCreate).not.toHaveBeenCalled();
  });
});
