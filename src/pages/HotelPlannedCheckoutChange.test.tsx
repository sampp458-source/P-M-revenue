// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PlannedCheckoutChangeModal } from "./HotelOperationsModals";
import { canChangeCheckedInHotelPlannedCheckout } from "./HotelOperationsModals";
import type { HotelStay } from "./hotelOperationsRepository";

const checkedInStay = (reservedUntil = "2026-08-15T02:00:00Z"): HotelStay => ({
  id: "stay-1",
  dogId: "dog-1",
  dogName: "감자",
  customerId: "customer-1",
  customerName: "보호자",
  customerPhone: null,
  version: 4,
  requestId: "request-1",
  checkedInAt: "2026-08-13T06:00:00Z",
  checkedInBy: "staff-1",
  checkedOutAt: null,
  checkedOutBy: null,
  createdBy: "staff-1",
  createdAt: "2026-08-01T00:00:00Z",
  updatedAt: "2026-08-13T06:00:00Z",
  archivedAt: null,
  capacityReservation: {
    id: "capacity-1",
    roomTypeId: "deluxe",
    roomTypeCode: "DELUXE",
    roomTypeName: "DELUXE",
    reservedFrom: "2026-08-13T06:00:00Z",
    reservedUntil,
    quantity: 1,
  },
  roomAllocations: [],
  scheduleEvents: [{
    eventKind: "check_out",
    schedule: {
      id: "schedule-1",
      title: "감자 퇴실",
      memo: null,
      startsAt: "2026-08-15T02:00:00Z",
      endsAt: "2026-08-15T03:00:00Z",
      timeUnspecified: false,
      status: "scheduled",
      calendarId: "calendar-1",
      scheduleTypeId: "type-1",
      assignees: [],
    },
  }],
});

afterEach(cleanup);

describe("checked-in Hotel planned checkout UI", () => {
  it("shows the current checkout and submits the new date/time", () => {
    const onSubmit = vi.fn();
    render(
      <PlannedCheckoutChangeModal
        open
        stay={checkedInStay()}
        processing={false}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    expect(screen.getByText("현재 퇴실 예정")).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/새 퇴실일/), {
      target: { value: "2026-08-16" },
    });
    fireEvent.change(screen.getByLabelText(/새 퇴실 시간/), {
      target: { value: "11:30" },
    });
    fireEvent.click(screen.getByRole("button", { name: "퇴실 예정 변경" }));

    expect(onSubmit).toHaveBeenCalledWith("2026-08-16", "11:30", false);
  });

  it("submits a null time through the explicit unknown-time contract", () => {
    const onSubmit = vi.fn();
    render(
      <PlannedCheckoutChangeModal
        open
        stay={checkedInStay()}
        processing={false}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />,
    );
    fireEvent.change(screen.getByLabelText(/새 퇴실일/), {
      target: { value: "2026-08-16" },
    });
    fireEvent.click(screen.getByLabelText("퇴실 시간 미정"));
    fireEvent.click(screen.getByRole("button", { name: "퇴실 예정 변경" }));
    expect(onSubmit).toHaveBeenCalledWith("2026-08-16", null, true);
  });

  it("allows normal and Shared Room checked-in stays but excludes Long Stay infinity", () => {
    expect(canChangeCheckedInHotelPlannedCheckout(checkedInStay())).toBe(true);
    expect(canChangeCheckedInHotelPlannedCheckout({
      ...checkedInStay(),
      capacityReservation: null,
    })).toBe(true);
    expect(canChangeCheckedInHotelPlannedCheckout(checkedInStay("infinity"))).toBe(false);
    expect(canChangeCheckedInHotelPlannedCheckout({
      ...checkedInStay(),
      checkedOutAt: "2026-08-15T02:00:00Z",
    })).toBe(false);
  });
});
