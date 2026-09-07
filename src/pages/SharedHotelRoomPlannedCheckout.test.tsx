// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SharedHotelOccupancy } from "../platform/multiDogSharedRoomContract";
import { SharedHotelRoomModal } from "./SharedHotelRoomModal";
import type { HotelOperationsSnapshot, HotelStay } from "./hotelOperationsRepository";

const mocks = vi.hoisted(() => ({
  fetchHotelStay: vi.fn(),
  unassign: vi.fn(),
}));

vi.mock("./hotelOperationsRepository", () => ({
  fetchHotelStay: mocks.fetchHotelStay,
}));

vi.mock("../platform/multiDogSharedRoomRepository", () => ({
  sharedHotelRoomErrorMessage: (error: unknown) => error instanceof Error ? error.message : "오류",
  sharedHotelRoomRepository: {
    checkIn: vi.fn(),
    checkOut: vi.fn(),
    get: vi.fn(),
    mergeExistingStays: vi.fn(),
    move: vi.fn(),
    reverseCompletion: vi.fn(),
    unassign: mocks.unassign,
  },
}));

const stay = (
  id: string,
  dogName: string,
  checkOutAt: string,
  overrides: Partial<HotelStay> = {},
): HotelStay => ({
  id,
  dogId: `dog-${id}`,
  dogName,
  customerId: "customer-1",
  customerName: "보호자",
  customerPhone: null,
  version: 3,
  requestId: `request-${id}`,
  checkedInAt: "2026-08-13T06:00:00Z",
  checkedInBy: "staff-1",
  checkedOutAt: null,
  checkedOutBy: null,
  createdBy: "staff-1",
  createdAt: "2026-08-01T00:00:00Z",
  updatedAt: "2026-08-13T06:00:00Z",
  archivedAt: null,
  capacityReservation: null,
  roomAllocations: [],
  scheduleEvents: [
    {
      eventKind: "check_in",
      schedule: {
        id: `check-in-${id}`,
        title: `${dogName} 입실`,
        memo: null,
        startsAt: "2026-08-13T06:00:00Z",
        endsAt: "2026-08-13T07:00:00Z",
        timeUnspecified: false,
        status: "completed",
        calendarId: "hotel-calendar",
        scheduleTypeId: "hotel-type",
        assignees: [],
      },
    },
    {
      eventKind: "check_out",
      schedule: {
        id: `check-out-${id}`,
        title: `${dogName} 퇴실`,
        memo: null,
        startsAt: checkOutAt,
        endsAt: new Date(new Date(checkOutAt).getTime() + 3_600_000).toISOString(),
        timeUnspecified: false,
        status: "scheduled",
        calendarId: "hotel-calendar",
        scheduleTypeId: "hotel-type",
        assignees: [],
      },
    },
  ],
  ...overrides,
});

const dogA = stay("stay-a", "망치", "2026-08-15T10:00:00Z");
const dogB = stay("stay-b", "펀치", "2026-08-16T02:00:00Z");

const occupancy = (memberStates: readonly ("active" | "completed")[] = ["active", "active"]): SharedHotelOccupancy => ({
  id: "occupancy-1",
  familyBookingId: "family-1",
  sharedRoomGroupId: "group-1",
  customerId: "customer-1",
  roomTypeId: "deluxe",
  roomTypeCode: "DELUXE",
  roomId: "room-1",
  roomName: "DELUXE 2",
  occupiedFrom: "2026-08-13T06:00:00Z",
  occupiedUntil: "2026-08-16T02:00:00Z",
  status: memberStates.every((status) => status === "completed") ? "completed" : "active",
  version: 4,
  capacityReservationId: "capacity-1",
  roomAllocationId: "allocation-1",
  capacityUsed: memberStates.every((status) => status === "completed") ? 0 : 1,
  dogCount: 2,
  members: [dogA, dogB].map((memberStay, index) => ({
    id: `member-${index + 1}`,
    familyBookingMemberId: `family-member-${index + 1}`,
    hotelStayId: memberStay.id,
    dogId: memberStay.dogId,
    dogName: memberStay.dogName,
    status: memberStates[index],
    joinedAt: "2026-08-13T06:00:00Z",
    leftAt: memberStates[index] === "completed" ? "2026-08-15T10:00:00Z" : null,
  })),
});

const snapshot: HotelOperationsSnapshot = {
  date: "2026-08-14",
  roomTypes: [],
  rooms: [
    { id: "room-1", name: "DELUXE 2", roomTypeId: "deluxe", roomTypeCode: "DELUXE", roomTypeName: "DELUXE", isActive: true, sortOrder: 1 },
    { id: "room-2", name: "DELUXE 3", roomTypeId: "deluxe", roomTypeCode: "DELUXE", roomTypeName: "DELUXE", isActive: true, sortOrder: 2 },
  ],
  settings: null,
  stays: [],
  unassignedFuture: [],
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderSharedRoom(
  memberStates: readonly ("active" | "completed")[] = ["active", "active"],
  onChangePlannedCheckout = vi.fn().mockResolvedValue(true),
) {
  const completedA = { ...dogA, checkedOutAt: "2026-08-15T10:00:00Z" };
  const completedB = { ...dogB, checkedOutAt: "2026-08-16T02:00:00Z" };
  const stays = new Map([
    [dogA.id, memberStates[0] === "completed" ? completedA : dogA],
    [dogB.id, memberStates[1] === "completed" ? completedB : dogB],
  ]);
  mocks.fetchHotelStay.mockImplementation((id: string) => Promise.resolve(stays.get(id)));
  render(
    <SharedHotelRoomModal
      occupancy={occupancy(memberStates)}
      snapshot={snapshot}
      selectedDate="2026-08-14"
      operationRole="staff"
      onClose={vi.fn()}
      onChanged={vi.fn()}
      onChangePlannedCheckout={onChangePlannedCheckout}
    />,
  );
  return onChangePlannedCheckout;
}

describe("Shared Room Dog planned checkout UI", () => {
  it("offers one confirmed group-level unassign only while every Dog is pre-check-in", async () => {
    const preCheckInA = { ...dogA, checkedInAt: null, checkedInBy: null };
    const preCheckInB = { ...dogB, checkedInAt: null, checkedInBy: null };
    mocks.fetchHotelStay.mockImplementation((id: string) => Promise.resolve(
      id === dogA.id ? preCheckInA : preCheckInB,
    ));
    mocks.unassign.mockResolvedValue({
      sharedRoomGroupId: "group-1",
      status: "requested",
      version: 5,
    });
    const onUnassigned = vi.fn();
    render(
      <SharedHotelRoomModal
        occupancy={occupancy()}
        snapshot={snapshot}
        selectedDate="2026-08-14"
        operationRole="staff"
        onClose={vi.fn()}
        onChanged={vi.fn()}
        onUnassigned={onUnassigned}
        onChangePlannedCheckout={vi.fn().mockResolvedValue(true)}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "객실 배정 해제" }));
    expect(screen.getByRole("dialog", { name: "객실 배정을 해제할까요?" })).not.toBeNull();
    expect(screen.getByText("예약은 유지되며 호실 미배정 상태로 이동합니다.")).not.toBeNull();
    fireEvent.click(within(screen.getByRole("dialog", { name: "객실 배정을 해제할까요?" }))
      .getByRole("button", { name: "돌아가기" }));
    expect(mocks.unassign).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "객실 배정 해제" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "객실 배정을 해제할까요?" }))
      .getByRole("button", { name: "객실 배정 해제" }));

    await waitFor(() => expect(mocks.unassign).toHaveBeenCalledTimes(1));
    expect(mocks.unassign).toHaveBeenCalledWith(
      "occupancy-1",
      4,
      "공유 객실 배정 해제",
      expect.any(String),
    );
    await waitFor(() => expect(onUnassigned).toHaveBeenCalledTimes(1));
  });

  it("does not offer unassign after any Dog has checked in", async () => {
    renderSharedRoom();
    await screen.findByText("망치");
    expect(screen.queryByRole("button", { name: "객실 배정 해제" })).toBeNull();
  });

  it("shows independent checkout details/actions and reuses the canonical change modal", async () => {
    const onChange = renderSharedRoom();
    expect(await screen.findAllByRole("button", { name: "퇴실 예정 변경" })).toHaveLength(2);
    expect(screen.getByText("망치").closest("article")?.textContent).toContain("퇴실 예정");
    expect(screen.getByText("펀치").closest("article")?.textContent).toContain("퇴실 예정");
    expect(screen.getAllByRole("button", { name: /Dog별 퇴실/ })).toHaveLength(2);
    expect(screen.getByRole("button", { name: /DELUXE로 전체 이동/ })).not.toBeNull();

    fireEvent.click(screen.getAllByRole("button", { name: /Dog별 퇴실/ })[0]);
    expect(screen.getByRole("dialog", { name: "반려견 퇴실을 완료할까요?" })).not.toBeNull();
    expect(screen.getByText(/같은 방의 다른 반려견은 그대로 유지/)).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "돌아가기" }));

    fireEvent.click(screen.getAllByRole("button", { name: "퇴실 예정 변경" })[0]);
    expect(screen.getByRole("dialog", { name: "퇴실 예정 변경" })).not.toBeNull();
    expect(screen.getByTestId("modal-actions")).not.toBeNull();
    fireEvent.change(screen.getByLabelText(/새 퇴실일/), { target: { value: "2026-08-17" } });
    fireEvent.change(screen.getByLabelText(/새 퇴실 시간/), { target: { value: "11:30" } });
    fireEvent.click(screen.getByRole("button", { name: "퇴실 예정 변경" }));

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(onChange).toHaveBeenCalledWith(dogA, "2026-08-17", "11:30", false);
    expect(onChange.mock.calls[0][0].id).not.toBe(dogB.id);
  });

  it("keeps only the remaining active Dog changeable after a partial checkout", async () => {
    renderSharedRoom(["completed", "active"]);
    expect(await screen.findAllByRole("button", { name: "퇴실 예정 변경" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /Dog별 퇴실/ })).toHaveLength(1);
    expect(screen.getByText("망치").closest("article")?.textContent).toContain("퇴실 완료");
  });

  it("hides planned-checkout and checkout actions after the final checkout", async () => {
    renderSharedRoom(["completed", "completed"]);
    await screen.findByText("망치");
    expect(screen.queryByRole("button", { name: "퇴실 예정 변경" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Dog별 퇴실/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /DELUXE로 전체 이동/ })).toBeNull();
  });
});
