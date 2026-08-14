// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OperationScheduleOptions } from "./operationsScheduleRepository";
import {
  ScheduleFormModal,
  emptyForm,
  initializeHotelScheduleForm,
  type CalendarCreateProduct,
  type ScheduleForm,
} from "./OperationsToday";

const options: OperationScheduleOptions = {
  calendars: [
    { id: "hotel-calendar", name: "호텔", businessUnitCode: "hotel", businessUnitName: "호텔", scopeType: "business_unit", color: "#f97316", sortOrder: 1 },
    { id: "common-calendar", name: "공통", businessUnitCode: null, businessUnitName: null, scopeType: "common", color: "#2563eb", sortOrder: 2 },
  ],
  scheduleTypes: [
    { id: "hotel-stay", name: "입실·퇴실", calendarIds: ["hotel-calendar"], color: "#f97316", sortOrder: 1 },
    { id: "hotel-general", name: "호텔 상담", calendarIds: ["hotel-calendar"], color: "#64748b", sortOrder: 2 },
    { id: "common-general", name: "일반 상담", calendarIds: ["common-calendar"], color: "#2563eb", sortOrder: 3 },
  ],
  customers: [],
  dogs: [],
  assignees: [{ id: "staff-1", name: "담당자" }],
};

const snapshot = {
  date: "2026-08-14",
  roomTypes: [{ id: "deluxe", code: "DELUXE", name: "DELUXE", activeRooms: 1, reservedPeak: 0, checkedInNow: 0, allocatedNow: 0, reservedNow: 0, unassignedNow: 0, physicallyEmpty: 1 }],
  rooms: [],
  settings: { id: "settings", version: 1, defaultCheckInTime: "15:00:00", defaultCheckOutTime: "11:00:00", timezone: "Asia/Seoul" },
  stays: [],
  unassignedFuture: [],
};

function Harness({ longStayAllowed = true }: { longStayAllowed?: boolean }) {
  const initial = initializeHotelScheduleForm({ ...emptyForm(), date: "2026-08-14", endDate: "2026-08-14", assigneeIds: ["staff-1"] }, options, snapshot);
  const [form, setForm] = useState<ScheduleForm>(initial);
  const [product, setProduct] = useState<CalendarCreateProduct | null>("hotel");
  return (
    <ScheduleFormModal
      open
      editing="new"
      form={form}
      options={options}
      error=""
      saving={false}
      recentScope="calendar-first-test"
      titleManuallyEdited={false}
      onTitleManuallyEdited={vi.fn()}
      onChange={setForm}
      onSubmit={(event) => event.preventDefault()}
      onClose={vi.fn()}
      hotelSnapshot={snapshot}
      calendarCreateProduct={product}
      onCalendarCreateProductChange={setProduct}
      longStayAllowed={longStayAllowed}
      createProductContent={
        product === "daycare" ? <div aria-label="데이케어 예약 양식">데이케어 날짜</div>
          : product === "long-stay" ? <div aria-label="장기호텔 등록 양식">계약 시작일</div>
            : null
      }
    />
  );
}

afterEach(cleanup);

describe("Calendar-first inline create form", () => {
  it("opens directly on the form shell without the four-card selection stage", () => {
    render(<Harness />);
    expect(screen.getByRole("dialog", { name: "새 일정" })).not.toBeNull();
    expect(screen.getByLabelText("캘린더")).not.toBeNull();
    expect(screen.getByLabelText("일정 유형")).not.toBeNull();
    expect(screen.queryByText("등록할 서비스나 일정 종류를 먼저 선택하세요.")).toBeNull();
    expect(screen.getByText("입실 날짜")).not.toBeNull();
  });

  it("offers four Hotel product types and switches inline forms", () => {
    render(<Harness />);
    const product = screen.getByLabelText("일정 유형") as HTMLSelectElement;
    expect([...product.options].map((option) => option.text)).toEqual([
      "호텔 예약",
      "데이케어 예약",
      "장기호텔",
      "상담·일반 일정",
    ]);

    fireEvent.change(product, { target: { value: "daycare" } });
    expect(screen.getByLabelText("데이케어 예약 양식")).not.toBeNull();
    expect(screen.queryByLabelText("입실 날짜")).toBeNull();
    expect(document.querySelector("form form")).toBeNull();

    fireEvent.change(screen.getByLabelText("일정 유형"), { target: { value: "long-stay" } });
    expect(screen.getByLabelText("장기호텔 등록 양식")).not.toBeNull();

    fireEvent.change(screen.getByLabelText("일정 유형"), { target: { value: "general" } });
    expect(screen.getByText("세부 일정 유형")).not.toBeNull();
    expect(screen.getByLabelText("제목")).not.toBeNull();

    fireEvent.change(screen.getByLabelText("일정 유형"), { target: { value: "hotel" } });
    expect(screen.getByText("입실 날짜")).not.toBeNull();
  });

  it("preserves the Long Stay owner-manager permission boundary", () => {
    render(<Harness longStayAllowed={false} />);
    const product = screen.getByLabelText("일정 유형") as HTMLSelectElement;
    expect([...product.options].find((option) => option.value === "long-stay")?.disabled).toBe(true);
  });

  it("keeps other calendars on their existing generic schedule types", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("캘린더"), { target: { value: "common-calendar" } });
    const type = screen.getByLabelText("일정 유형") as HTMLSelectElement;
    expect([...type.options].map((option) => option.text)).toContain("일반 상담");
    expect([...type.options].map((option) => option.text)).not.toContain("데이케어 예약");
    expect(screen.getByLabelText("제목")).not.toBeNull();
  });

  it("keeps canonical Calendar/Profile form and RPC wiring", () => {
    const source = (name: string) => readFileSync(resolve(process.cwd(), "src/pages", name), "utf8");
    const calendar = source("OperationsCalendarFoundation.tsx");
    const daycare = source("DaycareReservationModal.tsx");
    const longStay = source("LongStayRegistrationForm.tsx");
    const customer = source("CustomerProfileModal.tsx");
    const dog = source("DogProfileModal.tsx");

    expect(calendar).not.toContain("UnifiedOperationCreateEntryModal");
    expect(calendar).toContain("<DaycareReservationForm");
    expect(calendar).toContain("<LongStayRegistrationForm");
    expect(calendar).toContain('prefill={{ serviceDate: selectedDate }}');
    expect(calendar).toContain('prefill={{ startedOn: selectedDate }}');
    expect(daycare).toContain("createDaycareReservation(input)");
    expect(longStay).toContain("createLongStayContract({");
    expect(customer).toContain("<DaycareReservationModal");
    expect(dog).toContain("<DaycareReservationModal");
    expect(customer).toContain("<LongStayProfileSection");
    expect(dog).toContain("<LongStayProfileSection");
  });
});
