// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  LongStayContractProjection,
  LongStayMonthContractProjection,
} from "../platform/longStayHotelContract";
import {
  LongStayRepositoryError,
} from "../platform/longStayHotelRepository";
import {
  isServiceMonthBeforeLongStayStart,
  LongStayOperationsPanel,
} from "./LongStayOperationsPanel";
import { LongStayProfileSection } from "./LongStayProfileSection";

const repositoryMocks = vi.hoisted(() => ({
  completeLongStayAbsence: vi.fn(),
  completeLongStayCheckIn: vi.fn(),
  completeLongStayCheckOut: vi.fn(),
  confirmLongStayMonth: vi.fn(),
  createLongStayContract: vi.fn(),
  getCustomerLongStays: vi.fn(),
  getLongStayContract: vi.fn(),
  getLongStayHotelVersion: vi.fn(),
  getLongStayMonth: vi.fn(),
  getLongStayRoomAvailability: vi.fn(),
  reverseLongStayCompletion: vi.fn(),
  setLongStayPlannedCheckout: vi.fn(),
  startLongStayAbsence: vi.fn(),
}));

const hotelRepositoryMocks = vi.hoisted(() => ({
  fetchHotelOperationsSnapshot: vi.fn(),
}));

vi.mock("../platform/longStayHotelRepository", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../platform/longStayHotelRepository")>()),
  ...repositoryMocks,
}));

vi.mock("./hotelOperationsRepository", () => hotelRepositoryMocks);
vi.mock("./operationsScheduleRepository", () => ({
  seoulDateKey: () => "2026-09-15",
}));
vi.mock("./OperationsToday", () => ({
  hotelScheduleTypeForCalendar: () => ({ id: "hotel-schedule-type" }),
}));

const snapshot = {
  date: "2026-09-15",
  roomTypes: [
    {
      id: "standard",
      code: "STANDARD",
      name: "STANDARD",
      activeRooms: 5,
      reservedPeak: 0,
      checkedInNow: 0,
      allocatedNow: 0,
      reservedNow: 0,
      unassignedNow: 0,
      physicallyEmpty: 5,
    },
  ],
  rooms: [
    {
      id: "standard-1",
      roomTypeId: "standard",
      roomTypeCode: "STANDARD",
      roomTypeName: "STANDARD",
      name: "STANDARD 1",
      sortOrder: 1,
      isActive: true,
    },
  ],
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
  calendars: [
    {
      id: "hotel-calendar",
      name: "Hotel Operations",
      scopeType: "business_unit",
      color: "#EA580C",
      sortOrder: 1,
      businessUnitCode: "hotel",
      businessUnitName: "호텔",
    },
  ],
  scheduleTypes: [],
  assignees: [{ id: "staff-1", name: "담당자" }],
  customers: [],
  dogs: [],
};

const projection = (
  overrides: Partial<LongStayMonthContractProjection> = {},
): LongStayMonthContractProjection => ({
  id: "contract-1",
  customerId: "customer-1",
  customerName: "보호자",
  dogId: "dog-1",
  dogName: "동동이",
  storedStatus: "pending",
  derivedStatus: "pending",
  startedOn: "2026-09-10",
  plannedCheckOutDate: null,
  checkedInAt: null,
  checkedOutAt: null,
  hotelStayId: null,
  version: 1,
  isOpenEnded: false,
  runtimeCapacityUntil: null,
  runtimeAllocationUntil: null,
  currentRoom: null,
  isAway: false,
  monthlyOccupancy: null,
  monthlyState: "unassigned",
  ...overrides,
});

const renderOperations = (contracts: LongStayMonthContractProjection[]) => {
  repositoryMocks.getLongStayMonth.mockResolvedValue({
    serviceMonth: "2026-09-01",
    contracts,
  });
  repositoryMocks.getLongStayRoomAvailability.mockResolvedValue({
    contractId: contracts[0]?.id ?? "contract-1",
    serviceMonth: "2026-09-01",
    availabilityFrom: "2026-09-10T06:00:00Z",
    isOpenEnded: true,
    rooms: snapshot.rooms.map((room) => ({
      roomId: room.id,
      roomName: room.name,
      roomTypeId: room.roomTypeId,
      roomTypeCode: room.roomTypeCode,
      roomTypeName: room.roomTypeName,
      assignable: true,
      nextConflictFrom: null,
      nextConflictUntil: null,
      conflictSource: null,
      conflictPhase: null,
      reason: "사용 가능",
    })),
  });

  return render(
    <LongStayOperationsPanel
      snapshot={snapshot as never}
      options={options as never}
      operationRole="owner"
      onHotelSnapshotRefresh={vi.fn().mockResolvedValue(undefined)}
    />,
  );
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("Long Stay frontend production stabilization", () => {
  it.each(["PT409", "40001"])(
    "refreshes the profile and clears the stale reverse action after %s",
    async (code) => {
      const completed = projection({
        storedStatus: "completed",
        derivedStatus: "completed",
        checkedInAt: "2026-09-10T06:00:00Z",
        checkedOutAt: "2026-09-15T02:00:00Z",
        hotelStayId: "stay-1",
      });
      const refreshed: LongStayContractProjection = {
        ...completed,
        storedStatus: "active",
        derivedStatus: "active",
        checkedOutAt: null,
        version: 2,
      };

      repositoryMocks.getCustomerLongStays
        .mockResolvedValueOnce([completed])
        .mockResolvedValueOnce([refreshed]);
      repositoryMocks.getLongStayMonth.mockResolvedValue({
        serviceMonth: "2026-09-01",
        contracts: [],
      });
      repositoryMocks.getLongStayHotelVersion.mockResolvedValue(7);
      repositoryMocks.reverseLongStayCompletion.mockRejectedValueOnce(
        new LongStayRepositoryError(
          "다른 사용자가 먼저 변경했습니다. 최신 상태를 다시 불러왔습니다.",
          "conflict",
          code,
        ),
      );
      hotelRepositoryMocks.fetchHotelOperationsSnapshot.mockResolvedValue(snapshot);

      render(
        <LongStayProfileSection
          customerId="customer-1"
          dogs={[{ id: "dog-1", name: "동동이" }]}
        />,
      );

      fireEvent.click(await screen.findByRole("button", { name: "완료 취소" }));
      const reverseForm = screen.getByLabelText("장기호텔 퇴실 완료 취소 양식");
      fireEvent.click(within(reverseForm).getByRole("button", { name: "완료 취소" }));

      expect(await screen.findByText("이용중")).not.toBeNull();
      expect(
        screen.getByText("다른 사용자가 먼저 변경했습니다. 최신 상태를 다시 불러왔습니다."),
      ).not.toBeNull();
      expect(screen.queryByLabelText("장기호텔 퇴실 완료 취소 양식")).toBeNull();
      expect(screen.queryByText("처리 중...")).toBeNull();
      expect(repositoryMocks.getCustomerLongStays).toHaveBeenCalledTimes(2);
    },
  );

  it("hides monthly confirmation before the contract start month", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-15T12:00:00+09:00"));
    renderOperations([projection()]);

    expect(await screen.findByText("계약 시작 전")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "객실 배정" })).toBeNull();
  });

  it.each([
    ["2026-09-10", "2026-09-01"],
    ["2026-09-01", "2026-09-01"],
  ])(
    "keeps monthly confirmation available for start date %s in month %s",
    async (startedOn) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-09-15T12:00:00+09:00"));
      renderOperations([projection({ startedOn })]);

      expect(await screen.findByRole("button", { name: "객실 배정" })).not.toBeNull();
      expect(screen.queryByText("계약 시작 전")).toBeNull();
    },
  );

  it("preserves unassigned, active and completed presentations", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-15T12:00:00+09:00"));
    renderOperations([
      projection({ id: "pending", dogName: "대기견", startedOn: "2026-09-15" }),
      projection({
        id: "active",
        dogName: "이용견",
        storedStatus: "active",
        derivedStatus: "active",
        checkedInAt: "2026-09-15T06:00:00Z",
        hotelStayId: "stay-active",
        startedOn: "2026-09-01",
        isOpenEnded: true,
      }),
      projection({
        id: "completed",
        dogName: "완료견",
        storedStatus: "completed",
        derivedStatus: "completed",
        checkedInAt: "2026-09-01T06:00:00Z",
        checkedOutAt: "2026-09-14T02:00:00Z",
        hotelStayId: "stay-completed",
        startedOn: "2026-09-01",
      }),
    ]);

    await screen.findByText("대기견");
    await waitFor(() => {
      expect(screen.getAllByText("미배정").length).toBeGreaterThan(0);
      expect(screen.getByText("이용중")).not.toBeNull();
      expect(screen.getByText("완료")).not.toBeNull();
    });
  });

  it("uses a whole-month boundary without timezone conversion", () => {
    expect(isServiceMonthBeforeLongStayStart("2026-08-01", "2026-09-10")).toBe(true);
    expect(isServiceMonthBeforeLongStayStart("2026-09-01", "2026-09-10")).toBe(false);
    expect(isServiceMonthBeforeLongStayStart("2026-09-01", "2026-09-01")).toBe(false);
  });

  it("disables a currently occupied room and fails closed when no room is available", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-15T12:00:00+09:00"));
    repositoryMocks.getLongStayRoomAvailability.mockResolvedValueOnce({
      contractId: "contract-1",
      serviceMonth: "2026-09-01",
      availabilityFrom: "2026-09-10T06:00:00Z",
      isOpenEnded: true,
      rooms: [{
        roomId: "standard-1",
        roomName: "STANDARD 1",
        roomTypeId: "standard",
        roomTypeCode: "STANDARD",
        roomTypeName: "STANDARD",
        assignable: false,
        nextConflictFrom: "2026-09-10T06:00:00Z",
        nextConflictUntil: null,
        conflictSource: "hotel",
        conflictPhase: "current",
        reason: "현재 사용 중",
      }],
    });
    renderOperations([projection()]);

    fireEvent.click(await screen.findByRole("button", { name: "객실 배정" }));
    await waitFor(() => expect(repositoryMocks.getLongStayRoomAvailability).toHaveBeenCalledWith({
      contractId: "contract-1",
      serviceMonth: "2026-09-01",
      physicalStartDate: "2026-09-15",
      checkInTime: "15:00",
      checkInTimeUnspecified: false,
    }));
    expect(await screen.findByText(/현재 계약 기간으로 장기호텔에 배정 가능한 객실이 없습니다/)).not.toBeNull();
    expect(screen.getByRole("option", { name: /현재 사용 중/ }).getAttribute("disabled")).not.toBeNull();
    expect(screen.getByRole("button", { name: "확인" }).getAttribute("disabled")).not.toBeNull();
  });

  it("shows the next conflict date and disables a future-reserved room", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-15T12:00:00+09:00"));
    repositoryMocks.getLongStayRoomAvailability.mockResolvedValueOnce({
      contractId: "contract-1",
      serviceMonth: "2026-09-01",
      availabilityFrom: "2026-09-10T06:00:00Z",
      isOpenEnded: true,
      rooms: [{
        roomId: "standard-1",
        roomName: "STANDARD 1",
        roomTypeId: "standard",
        roomTypeCode: "STANDARD",
        roomTypeName: "STANDARD",
        assignable: false,
        nextConflictFrom: "2026-09-20T15:30:00Z",
        nextConflictUntil: "2026-09-21T02:00:00Z",
        conflictSource: "shared_room",
        conflictPhase: "future",
        reason: "미래 예약 있음",
      }],
    });
    renderOperations([projection()]);

    fireEvent.click(await screen.findByRole("button", { name: "객실 배정" }));
    await waitFor(() => expect(repositoryMocks.getLongStayRoomAvailability).toHaveBeenCalledTimes(1));
    const futureOption = await screen.findByRole("option", { name: /예약 있음/ });
    expect(futureOption.getAttribute("disabled")).not.toBeNull();
    expect(futureOption.textContent).toContain("2026. 09. 21");
  });

  it("fails closed instead of rendering the legacy room catalog when availability loading fails", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-15T12:00:00+09:00"));
    repositoryMocks.getLongStayRoomAvailability.mockRejectedValueOnce(
      new Error("객실 가용성을 확인할 수 없습니다. 잠시 후 다시 시도해 주세요."),
    );
    renderOperations([projection()]);

    fireEvent.click(await screen.findByRole("button", { name: "객실 배정" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "객실 가용성을 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.",
    );
    expect(screen.getByRole("combobox", { name: "이번 달 호실" }).getAttribute("disabled")).not.toBeNull();
    expect(screen.getByRole("button", { name: "확인" }).getAttribute("disabled")).not.toBeNull();
    expect(screen.queryByRole("option", { name: "STANDARD · STANDARD 1" })).toBeNull();
  });
});
