import { describe, expect, it } from "vitest";
import type { HotelStay } from "./hotelOperationsRepository";
import { existingStaySharedRoomCandidates } from "./SharedHotelRoomModal";

const stay = (overrides: Partial<HotelStay> = {}): HotelStay => ({
  id: "joining",
  dogId: "dog-b",
  dogName: "Dog B",
  customerId: "customer-1",
  customerName: "보호자",
  customerPhone: null,
  version: 3,
  requestId: "request",
  checkedInAt: null,
  checkedInBy: null,
  checkedOutAt: null,
  checkedOutBy: null,
  createdBy: "staff",
  createdAt: "2026-08-13T00:00:00Z",
  updatedAt: "2026-08-13T00:00:00Z",
  archivedAt: null,
  capacityReservation: {
    id: "capacity-b",
    roomTypeId: "deluxe",
    roomTypeCode: "DELUXE",
    roomTypeName: "DELUXE",
    reservedFrom: "2026-08-13T06:00:00Z",
    reservedUntil: "2026-08-15T02:00:00Z",
    quantity: 1,
  },
  scheduleEvents: [],
  roomAllocations: [],
  ...overrides,
});

describe("existing Stay Shared Room eligibility", () => {
  const primary = stay({
    id: "primary",
    dogId: "dog-a",
    dogName: "Dog A",
    roomAllocations: [{
      id: "allocation-a",
      roomId: "deluxe-2",
      roomName: "DELUXE 2",
      roomTypeId: "deluxe",
      allocatedFrom: "2026-08-13T06:00:00Z",
      allocatedUntil: "2026-08-15T02:00:00Z",
      assignmentReason: null,
      version: 1,
    }],
  });

  it("offers the allocated same-owner DELUXE Stay with exact dates", () => {
    expect(existingStaySharedRoomCandidates(stay(), [primary], [])).toMatchObject([
      { roomId: "deluxe-2", roomName: "DELUXE 2", stay: { id: "primary" } },
    ]);
  });

  it("fails closed for STANDARD, cross-owner, or incompatible dates", () => {
    const standard = stay({
      capacityReservation: { ...stay().capacityReservation!, roomTypeCode: "STANDARD" },
    });
    const otherOwner = stay({ ...primary, id: "other-owner", customerId: "customer-2" });
    const otherDates = stay({
      ...primary,
      id: "other-dates",
      capacityReservation: {
        ...primary.capacityReservation!,
        reservedUntil: "2026-08-16T02:00:00Z",
      },
    });
    expect(existingStaySharedRoomCandidates(standard, [primary], [])).toEqual([]);
    expect(existingStaySharedRoomCandidates(stay(), [otherOwner, otherDates], [])).toEqual([]);
  });
});
