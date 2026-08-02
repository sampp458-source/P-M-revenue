import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { HotelStay } from "./hotelOperationsRepository";
import {
  activeHotelAllocation,
  hotelStayStatus,
  seoulInputParts,
} from "./hotelOperationsUi";

const repositorySource = readFileSync(
  resolve(import.meta.dirname, "./hotelOperationsRepository.ts"),
  "utf8",
);
const pageSource = readFileSync(
  resolve(import.meta.dirname, "./HotelOperations.tsx"),
  "utf8",
);
const modalSource = readFileSync(
  resolve(import.meta.dirname, "./HotelOperationsModals.tsx"),
  "utf8",
);
const appSource = readFileSync(resolve(import.meta.dirname, "../App.tsx"), "utf8");

const stay = (overrides: Partial<HotelStay> = {}): HotelStay => ({
  id: "stay-1",
  dogId: "dog-1",
  dogName: "토리",
  customerId: "customer-1",
  customerName: "김보호",
  customerPhone: "01012345678",
  version: 1,
  requestId: "request-1",
  checkedInAt: null,
  checkedInBy: null,
  checkedOutAt: null,
  checkedOutBy: null,
  createdBy: "profile-1",
  createdAt: "2026-08-02T06:00:00Z",
  updatedAt: "2026-08-02T06:00:00Z",
  archivedAt: null,
  capacityReservation: {
    id: "capacity-1",
    roomTypeId: "standard",
    roomTypeCode: "STANDARD",
    roomTypeName: "STANDARD",
    reservedFrom: "2026-08-02T06:00:00Z",
    reservedUntil: "2026-08-03T02:00:00Z",
    quantity: 1,
  },
  scheduleEvents: [],
  roomAllocations: [],
  ...overrides,
});

describe("Hotel Operations frontend", () => {
  it("keeps every Hotel write behind the installed RPC contract", () => {
    [
      "get_hotel_operations_snapshot",
      "hotel_stay_json",
      "create_hotel_reservation",
      "update_hotel_reservation",
      "cancel_hotel_reservation",
      "assign_hotel_room",
      "reassign_hotel_room_before_check_in",
      "move_hotel_room_same_type",
      "complete_hotel_check_in",
      "complete_hotel_check_out",
      "update_hotel_operation_settings",
    ].forEach((rpcName) => expect(repositorySource).toContain(`"${rpcName}"`));
    expect(repositorySource).not.toContain('.from("hotel_');
    expect(repositorySource).not.toContain(".insert(");
    expect(repositorySource).not.toContain(".update(");
    expect(repositorySource).not.toContain(".delete(");
  });

  it("registers one Hotel route and uses Snapshot rooms/settings", () => {
    expect(appSource).toContain('to: "/operations/hotel"');
    expect(appSource).toContain('path="hotel"');
    expect(pageSource).toContain("snapshot.roomTypes");
    expect(modalSource).toContain("snapshot.rooms.filter");
    expect(modalSource).toContain("snapshot.settings?.defaultCheckInTime");
    expect(modalSource).toContain("snapshot.settings?.defaultCheckOutTime");
  });

  it("distinguishes unassigned, assigned, active, moved and checked-out stays", () => {
    expect(hotelStayStatus(stay())).toBe("호실 미배정");
    const allocation = {
      id: "allocation-1",
      roomId: "room-1",
      roomName: "STANDARD-1",
      roomTypeId: "standard",
      allocatedFrom: "2026-08-02T06:00:00Z",
      allocatedUntil: "2026-08-03T02:00:00Z",
      assignmentReason: null,
      version: 1,
    };
    expect(hotelStayStatus(stay({ roomAllocations: [allocation] }))).toBe("호실 배정");
    expect(hotelStayStatus(stay({ checkedInAt: "2026-08-02T06:05:00Z", roomAllocations: [allocation] }))).toBe("사용 중");
    expect(hotelStayStatus(stay({ checkedInAt: "2026-08-02T06:05:00Z", roomAllocations: [allocation, { ...allocation, id: "allocation-2", roomId: "room-2", roomName: "STANDARD-2", allocatedFrom: "2026-08-02T09:00:00Z" }] }))).toBe("객실 이동");
    expect(hotelStayStatus(stay({ checkedInAt: "2026-08-02T06:05:00Z", checkedOutAt: "2026-08-03T02:10:00Z", roomAllocations: [allocation] }))).toBe("퇴실 완료");
    expect(activeHotelAllocation(stay({ roomAllocations: [allocation, { ...allocation, id: "allocation-2", allocatedFrom: "2026-08-02T09:00:00Z" }] }))?.id).toBe("allocation-2");
  });

  it("converts stored instants to KST form values", () => {
    expect(seoulInputParts("2026-08-02T06:00:00Z")).toEqual({
      date: "2026-08-02",
      time: "15:00",
    });
  });
});
