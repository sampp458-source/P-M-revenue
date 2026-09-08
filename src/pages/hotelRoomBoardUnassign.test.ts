import { describe, expect, it } from "vitest";
import type { SharedHotelOccupancy } from "../platform/multiDogSharedRoomContract";
import type { HotelStay } from "./hotelOperationsRepository";
import {
  canUnassignHotelStayBeforeCheckIn,
  canUnassignSharedHotelOccupancyBeforeCheckIn,
  hotelStayRoomUnassignMode,
  sharedHotelOccupancyRoomUnassignMode,
} from "./hotelRoomBoardUnassign";

const stay = (overrides: Partial<HotelStay> = {}): HotelStay => ({
  id: "stay-1",
  dogId: "dog-1",
  dogName: "감자",
  customerId: "customer-1",
  customerName: "보호자",
  customerPhone: null,
  version: 1,
  requestId: "request-1",
  checkedInAt: null,
  checkedInBy: null,
  checkedOutAt: null,
  checkedOutBy: null,
  createdBy: "owner-1",
  createdAt: "2026-09-07T00:00:00Z",
  updatedAt: "2026-09-07T00:00:00Z",
  archivedAt: null,
  capacityReservation: null,
  scheduleEvents: [],
  roomAllocations: [{
    id: "allocation-1",
    roomId: "room-1",
    roomName: "DELUXE 1",
    roomTypeId: "deluxe",
    allocatedFrom: "2026-09-07T06:00:00Z",
    allocatedUntil: "2026-09-08T02:00:00Z",
    assignmentReason: null,
    version: 1,
  }],
  ...overrides,
});

const occupancy = (
  overrides: Partial<SharedHotelOccupancy> = {},
): SharedHotelOccupancy => ({
  id: "occupancy-1",
  familyBookingId: "family-1",
  sharedRoomGroupId: "group-1",
  customerId: "customer-1",
  roomTypeId: "deluxe",
  roomTypeCode: "DELUXE",
  roomId: "room-1",
  roomName: "DELUXE 1",
  occupiedFrom: "2026-09-07T06:00:00Z",
  occupiedUntil: "2026-09-08T02:00:00Z",
  status: "active",
  version: 3,
  capacityReservationId: "capacity-1",
  roomAllocationId: "allocation-1",
  capacityUsed: 1,
  dogCount: 2,
  members: [
    { id: "member-1", familyBookingMemberId: "family-member-1", hotelStayId: "stay-1", dogId: "dog-1", dogName: "감자", status: "active", joinedAt: "2026-09-07T06:00:00Z", leftAt: null },
    { id: "member-2", familyBookingMemberId: "family-member-2", hotelStayId: "stay-2", dogId: "dog-2", dogName: "먼지", status: "active", joinedAt: "2026-09-07T06:00:00Z", leftAt: null },
  ],
  ...overrides,
});

describe("Room Board unassign eligibility", () => {
  it("allows only an actively allocated Single stay before check-in and checkout", () => {
    expect(canUnassignHotelStayBeforeCheckIn(stay())).toBe(true);
    expect(canUnassignHotelStayBeforeCheckIn(stay({ roomAllocations: [] }))).toBe(false);
    expect(canUnassignHotelStayBeforeCheckIn(stay({ checkedInAt: "2026-09-07T06:00:00Z" }))).toBe(false);
    expect(canUnassignHotelStayBeforeCheckIn(stay({ checkedOutAt: "2026-09-08T02:00:00Z" }))).toBe(false);
  });

  it("classifies checked-in Single stays for the atomic reverse-and-unassign path", () => {
    expect(hotelStayRoomUnassignMode(stay())).toBe("pre_check_in");
    expect(hotelStayRoomUnassignMode(stay({ checkedInAt: "2026-09-07T06:00:00Z" })))
      .toBe("reverse_check_in_and_unassign");
    expect(hotelStayRoomUnassignMode(stay({ checkedInAt: "2026-09-07T06:00:00Z", checkedOutAt: "2026-09-08T02:00:00Z" })))
      .toBeNull();
    expect(hotelStayRoomUnassignMode(stay({ roomAllocations: [] }))).toBeNull();
  });

  it("allows Shared unassign only with an active occupancy and every member stay loaded pre-check-in", () => {
    const stays = new Map([
      ["stay-1", stay()],
      ["stay-2", stay({ id: "stay-2", dogId: "dog-2", dogName: "먼지" })],
    ]);
    expect(canUnassignSharedHotelOccupancyBeforeCheckIn(occupancy(), stays)).toBe(true);
    expect(canUnassignSharedHotelOccupancyBeforeCheckIn(occupancy({ status: "completed" }), stays)).toBe(false);
    expect(canUnassignSharedHotelOccupancyBeforeCheckIn(occupancy({ members: [] }), stays)).toBe(false);
    expect(canUnassignSharedHotelOccupancyBeforeCheckIn(occupancy(), new Map([["stay-1", stay()]]))).toBe(false);
    expect(canUnassignSharedHotelOccupancyBeforeCheckIn(
      occupancy(),
      new Map(stays).set("stay-2", stay({ id: "stay-2", checkedInAt: "2026-09-07T06:00:00Z" })),
    )).toBe(false);
    expect(canUnassignSharedHotelOccupancyBeforeCheckIn(
      occupancy(),
      new Map(stays).set("stay-2", stay({ id: "stay-2", checkedOutAt: "2026-09-08T02:00:00Z" })),
    )).toBe(false);
  });

  it("classifies partial and full Shared check-in for one atomic group action", () => {
    const preCheckIn = new Map([
      ["stay-1", stay()],
      ["stay-2", stay({ id: "stay-2", dogId: "dog-2", dogName: "먼지" })],
    ]);
    const partialCheckIn = new Map(preCheckIn).set(
      "stay-1",
      stay({ checkedInAt: "2026-09-07T06:00:00Z" }),
    );
    const fullCheckIn = new Map(partialCheckIn).set(
      "stay-2",
      stay({ id: "stay-2", dogId: "dog-2", dogName: "먼지", checkedInAt: "2026-09-07T06:05:00Z" }),
    );
    const checkedOut = new Map(fullCheckIn).set(
      "stay-2",
      stay({ id: "stay-2", dogId: "dog-2", checkedInAt: "2026-09-07T06:05:00Z", checkedOutAt: "2026-09-08T02:00:00Z" }),
    );

    expect(sharedHotelOccupancyRoomUnassignMode(occupancy(), preCheckIn)).toBe("pre_check_in");
    expect(sharedHotelOccupancyRoomUnassignMode(occupancy(), partialCheckIn)).toBe("reverse_check_in_and_unassign");
    expect(sharedHotelOccupancyRoomUnassignMode(occupancy(), fullCheckIn)).toBe("reverse_check_in_and_unassign");
    expect(sharedHotelOccupancyRoomUnassignMode(occupancy(), checkedOut)).toBeNull();
  });
});
