import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repository = readFileSync(
  resolve(import.meta.dirname, "./operationsScheduleRepository.ts"),
  "utf8",
);
const hotelRepository = readFileSync(
  resolve(import.meta.dirname, "./hotelOperationsRepository.ts"),
  "utf8",
);
const modal = readFileSync(
  resolve(import.meta.dirname, "./LegacyHotelConversionModal.tsx"),
  "utf8",
);
const today = readFileSync(
  resolve(import.meta.dirname, "./OperationsToday.tsx"),
  "utf8",
);
const calendar = readFileSync(
  resolve(import.meta.dirname, "./OperationsCalendarFoundation.tsx"),
  "utf8",
);

describe("legacy Hotel schedule compatibility", () => {
  it("derives aggregate protection only from active link metadata", () => {
    const helper = repository.slice(
      repository.indexOf("export function isHotelReservationSchedule"),
      repository.indexOf("export function isLegacyHotelSchedule"),
    );
    expect(helper).toContain("schedule.hotelStayId");
    expect(helper).toContain('schedule.hotelEventKind === "check_in"');
    expect(helper).toContain('schedule.hotelEventKind === "check_out"');
    expect(helper).not.toContain("businessUnitCode");
    expect(helper).not.toContain("scheduleTypeName");
    expect(helper).not.toContain("title");
  });

  it("queries every loaded schedule and verifies both active link and active stay", () => {
    expect(repository).toContain('.from("hotel_stay_schedule_events")');
    expect(repository).toContain('.in("operation_schedule_id", scheduleIds)');
    expect(repository).toContain('.from("hotel_stays")');
    expect(repository).toContain("activeStayIds.has(link.hotel_stay_id)");
    expect(repository).not.toContain(
      "schedules.filter((schedule) => schedule.businessUnitCode === \"hotel\")",
    );
  });

  it("uses one common conversion modal in Today and Calendar", () => {
    expect(today).toContain("<LegacyHotelConversionModal");
    expect(calendar).toContain("<LegacyHotelConversionModal");
    expect(today).toContain("isLegacyHotelSchedule(detail)");
    expect(calendar).toContain("isLegacyHotelSchedule(detail)");
    expect(modal).toContain("현재 일정의 역할");
    expect(modal).toContain("제목으로 자동 확정하지 않습니다");
    expect(modal).toContain("추천");
    expect(modal).toContain("고객·반려견 관리에서 먼저 연결");
    expect(modal).toContain("담당자 1명 이상");
  });

  it("calls only the append-only conversion RPC and refreshes all surfaces", () => {
    expect(hotelRepository).toContain(
      'rpc<HotelStay>("convert_legacy_hotel_schedules_to_reservation"',
    );
    expect(modal).not.toContain("createOperationSchedule");
    expect(today).toContain("loadSchedules()");
    expect(today).toContain("fetchHotelOperationsSnapshot(localDate)");
    expect(today).toContain("fetchHotelStay(stay.id)");
    expect(calendar).toContain("loadMonth()");
    expect(calendar).toContain("fetchHotelStay(stay.id)");
  });
});
