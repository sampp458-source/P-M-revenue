import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { HotelStay } from "./hotelOperationsRepository";
import {
  activeHotelAllocation,
  hotelStayStatus,
  seoulInputParts,
} from "./hotelOperationsUi";
import {
  emptyForm,
  hotelReservationInputFromForm,
  initializeHotelScheduleForm,
} from "./OperationsToday";
import type { OperationScheduleOptions } from "./operationsScheduleRepository";
import type { HotelOperationsSnapshot } from "./hotelOperationsRepository";

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
const todaySource = readFileSync(
  resolve(import.meta.dirname, "./OperationsToday.tsx"),
  "utf8",
);
const calendarSource = readFileSync(
  resolve(import.meta.dirname, "./OperationsCalendarFoundation.tsx"),
  "utf8",
);

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

  it("uses one shared new-schedule modal across Today, Calendar and Hotel", () => {
    expect(appSource).toContain('to: "/operations/hotel"');
    expect(appSource).toContain('path="hotel"');
    expect(pageSource).toContain("snapshot.roomTypes");
    expect(modalSource).toContain("snapshot.rooms.filter");
    expect(pageSource).toContain("<ScheduleFormModal");
    expect(todaySource).toContain("<ScheduleFormModal");
    expect(calendarSource).toContain("<ScheduleFormModal");
    expect(pageSource).not.toContain("HotelReservationModal");
    expect(modalSource).not.toContain("HotelReservationModal");
  });

  it("routes only Hotel creates to create_hotel_reservation", () => {
    expect(todaySource).toContain("isHotelScheduleCalendar");
    expect(todaySource).toContain("createHotelReservation");
    expect(todaySource).toContain("createOperationSchedule");
    expect(calendarSource).toContain("createNewScheduleFromForm");
    expect(pageSource).toContain("createNewScheduleFromForm");
    expect(pageSource).not.toContain("createHotelReservation(");
    expect(pageSource).not.toContain("createOperationSchedule(");
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

  it("applies Snapshot defaults and builds one Hotel reservation payload", () => {
    const options: OperationScheduleOptions = {
      calendars: [
        {
          id: "hotel-calendar",
          name: "호텔",
          scopeType: "business_unit",
          color: "#EA580C",
          sortOrder: 1,
          businessUnitCode: "hotel",
          businessUnitName: "호텔",
        },
      ],
      scheduleTypes: [
        {
          id: "class-type",
          name: "수업",
          color: "#2563EB",
          sortOrder: 0,
          calendarIds: ["hotel-calendar"],
        },
        {
          id: "hotel-type",
          name: "입실·퇴실",
          color: "#EA580C",
          sortOrder: 1,
          calendarIds: ["hotel-calendar"],
        },
      ],
      assignees: [{ id: "profile-1", name: "담당자" }],
      customers: [
        { id: "customer-1", name: "보호자", phone: "01012345678" },
      ],
      dogs: [{ id: "dog-1", name: "토리", customerId: "customer-1" }],
    };
    const snapshot: HotelOperationsSnapshot = {
      date: "2026-08-02",
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
      rooms: [],
      settings: {
        id: "settings-1",
        version: 1,
        defaultCheckInTime: "15:00:00",
        defaultCheckOutTime: "11:00:00",
        timezone: "Asia/Seoul",
      },
      stays: [],
      unassignedFuture: [],
    };
    const initial = emptyForm();
    initial.date = "2026-08-02";
    const form = initializeHotelScheduleForm(initial, options, snapshot);
    form.title = "토리 호텔 예약";
    form.dogIds = ["dog-1"];
    form.customerIds = ["customer-1"];
    form.assigneeIds = ["profile-1"];
    const result = hotelReservationInputFromForm(form, options, snapshot);
    expect(form.startTime).toBe("15:00");
    expect(form.hotelCheckOutTime).toBe("11:00");
    expect(form.scheduleTypeId).toBe("hotel-type");
    expect(result.error).toBe("");
    expect(result.input).toMatchObject({
      calendarId: "hotel-calendar",
      roomTypeId: "standard",
      dogId: "dog-1",
      customerId: "customer-1",
      assigneeIds: ["profile-1"],
    });
  });
});
