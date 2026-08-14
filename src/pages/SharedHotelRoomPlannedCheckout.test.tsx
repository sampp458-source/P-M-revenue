// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SharedHotelOccupancy } from "../platform/multiDogSharedRoomContract";
import { SharedHotelRoomModal } from "./SharedHotelRoomModal";
import type { HotelOperationsSnapshot, HotelStay } from "./hotelOperationsRepository";

const mocks = vi.hoisted(() => ({
  fetchHotelStay: vi.fn(),
}));

vi.mock("./hotelOperationsRepository", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./hotelOperationsRepository")>()),
  fetchHotelStay: mocks.fetchHotelStay,
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
  it("shows independent checkout details/actions and reuses the canonical change modal", async () => {
    const onChange = renderSharedRoom();
    expect(await screen.findAllByRole("button", { name: "퇴실 예정 변경" })).toHaveLength(2);
    expect(screen.getByText("망치").closest("article")?.textContent).toContain("퇴실 예정");
    expect(screen.getByText("펀치").closest("article")?.textContent).toContain("퇴실 예정");
    expect(screen.getAllByRole("button", { name: /Dog별 퇴실/ })).toHaveLength(2);
    expect(screen.getByRole("button", { name: /DELUXE로 전체 이동/ })).not.toBeNull();

    fireEvent.click(screen.getAllByRole("button", { name: "퇴실 예정 변경" })[0]);
    expect(screen.getByRole("dialog", { name: "퇴실 예정 변경" })).not.toBeNull();
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
