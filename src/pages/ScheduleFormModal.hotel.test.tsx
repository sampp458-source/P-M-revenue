// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  HotelOperationsSnapshot,
  HotelReservationInput,
  HotelStay,
} from "./hotelOperationsRepository";
import {
  ScheduleFormModal,
  createNewScheduleFromForm,
  emptyForm,
  initializeHotelScheduleForm,
  transitionScheduleFormCalendar,
  type ScheduleForm,
} from "./OperationsToday";
import type {
  OperationSchedule,
  OperationScheduleInput,
  OperationScheduleOptions,
} from "./operationsScheduleRepository";

const options: OperationScheduleOptions = {
  calendars: [
    {
      id: "common-calendar",
      name: "공통",
      scopeType: "common",
      color: "#2563EB",
      sortOrder: 1,
      businessUnitCode: null,
      businessUnitName: null,
    },
    {
      id: "hotel-calendar",
      name: "Hotel Operations",
      scopeType: "business_unit",
      color: "#EA580C",
      sortOrder: 2,
      businessUnitCode: "hotel",
      businessUnitName: "호텔 사업부",
    },
  ],
  scheduleTypes: [
    {
      id: "class-type",
      name: "수업",
      color: "#2563EB",
      sortOrder: 1,
      calendarIds: ["common-calendar", "hotel-calendar"],
    },
    {
      id: "hotel-stay-type",
      name: "입실·퇴실",
      color: "#EA580C",
      sortOrder: 2,
      calendarIds: ["hotel-calendar"],
    },
    {
      id: "other-type",
      name: "기타",
      color: "#64748B",
      sortOrder: 3,
      calendarIds: ["common-calendar"],
    },
  ],
  assignees: [{ id: "staff-1", name: "담당자" }],
  customers: [
    { id: "customer-1", name: "보호자", phone: "01012345678" },
  ],
  dogs: [
    { id: "dog-1", name: "토리", customerId: "customer-1" },
  ],
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

const generalForm = () => {
  const form = emptyForm();
  form.calendarId = "common-calendar";
  form.scheduleTypeId = "other-type";
  form.assigneeIds = ["staff-1"];
  return form;
};

function Harness({ initialHotel = false }: { initialHotel?: boolean }) {
  const initial = initialHotel
    ? initializeHotelScheduleForm(generalForm(), options, snapshot)
    : generalForm();
  const [form, setForm] = useState<ScheduleForm>(initial);
  const [open, setOpen] = useState(true);
  const [titleManuallyEdited, setTitleManuallyEdited] = useState(false);
  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => {
            setForm(generalForm());
            setTitleManuallyEdited(false);
            setOpen(true);
          }}
        >
          다시 열기
        </button>
      )}
      <ScheduleFormModal
        open={open}
        editing="new"
        form={form}
        options={options}
        error=""
        saving={false}
        recentScope="hotel-modal-test"
        titleManuallyEdited={titleManuallyEdited}
        onTitleManuallyEdited={setTitleManuallyEdited}
        onChange={setForm}
        onSubmit={(event) => event.preventDefault()}
        onClose={() => setOpen(false)}
        hotelSnapshot={snapshot}
      />
    </>
  );
}

afterEach(cleanup);

describe("shared ScheduleFormModal Hotel mode", () => {
  it("renders Hotel fields and the exact stay type on its first render", () => {
    render(<Harness initialHotel />);

    expect((screen.getByLabelText(/캘린더/) as HTMLSelectElement).value).toBe(
      "hotel-calendar",
    );
    const typeSelect = screen.getByLabelText(/일정 유형/) as HTMLSelectElement;
    expect(typeSelect.value).toBe("hotel-stay-type");
    expect(typeSelect.disabled).toBe(true);
    expect([...typeSelect.options].map((option) => option.text)).not.toContain(
      "수업",
    );
    expect(screen.getByLabelText(/입실 날짜/)).toBeTruthy();
    expect(screen.getByLabelText(/퇴실 날짜/)).toBeTruthy();
    expect(screen.getByLabelText(/객실 유형/)).toBeTruthy();
    expect(screen.queryByText("종일 일정")).toBeNull();
  });

  it("switches general and Hotel fields repeatedly from the calendar Select", () => {
    render(<Harness />);
    const calendarSelect = screen.getByLabelText(/캘린더/);

    expect(screen.getByText("종일 일정")).toBeTruthy();
    expect(screen.queryByLabelText(/입실 날짜/)).toBeNull();

    fireEvent.change(calendarSelect, { target: { value: "hotel-calendar" } });
    expect(screen.getByLabelText(/입실 날짜/)).toBeTruthy();
    expect((screen.getByLabelText(/일정 유형/) as HTMLSelectElement).value).toBe(
      "hotel-stay-type",
    );

    fireEvent.change(calendarSelect, { target: { value: "common-calendar" } });
    expect(screen.getByText("종일 일정")).toBeTruthy();
    expect(screen.queryByLabelText(/입실 날짜/)).toBeNull();
    expect((screen.getByLabelText(/일정 유형/) as HTMLSelectElement).value).toBe(
      "other-type",
    );

    fireEvent.change(calendarSelect, { target: { value: "hotel-calendar" } });
    expect(screen.getByLabelText(/객실 유형/)).toBeTruthy();
    expect((screen.getByLabelText(/일정 유형/) as HTMLSelectElement).value).toBe(
      "hotel-stay-type",
    );
  });

  it("does not leak Hotel calendar state after closing and reopening", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText(/캘린더/), {
      target: { value: "hotel-calendar" },
    });
    fireEvent.click(screen.getAllByRole("button", { name: "닫기" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "다시 열기" }));

    expect((screen.getByLabelText(/캘린더/) as HTMLSelectElement).value).toBe(
      "common-calendar",
    );
    expect(screen.getByText("종일 일정")).toBeTruthy();
    expect(screen.queryByLabelText(/입실 날짜/)).toBeNull();
  });

  it("routes Hotel and general creates to exactly one matching repository", async () => {
    const createHotel = vi
      .fn<
        (input: HotelReservationInput, requestId: string) => Promise<HotelStay>
      >()
      .mockResolvedValue({ id: "stay-1" } as HotelStay);
    const createOperation = vi
      .fn<
        (
          input: OperationScheduleInput,
          requestId: string,
        ) => Promise<OperationSchedule>
      >()
      .mockResolvedValue({ id: "schedule-1" } as OperationSchedule);
    const hotelForm = initializeHotelScheduleForm(
      generalForm(),
      options,
      snapshot,
    );
    hotelForm.title = "토리 호텔 예약";
    hotelForm.dogIds = ["dog-1"];
    hotelForm.customerIds = ["customer-1"];

    await createNewScheduleFromForm(
      hotelForm,
      options,
      snapshot,
      "request-hotel",
      { createHotel, createOperation },
    );
    expect(createHotel).toHaveBeenCalledTimes(1);
    expect(createHotel.mock.calls[0][0].scheduleTypeId).toBe(
      "hotel-stay-type",
    );
    expect(createOperation).not.toHaveBeenCalled();

    const normalForm = generalForm();
    normalForm.title = "내부 회의";
    normalForm.startTime = "10:00";
    normalForm.endTime = "11:00";
    await createNewScheduleFromForm(
      normalForm,
      options,
      snapshot,
      "request-general",
      { createHotel, createOperation },
    );
    expect(createOperation).toHaveBeenCalledTimes(1);
    expect(createHotel).toHaveBeenCalledTimes(1);
    expect(createOperation.mock.calls[0][0]).not.toHaveProperty(
      "hotelRoomTypeId",
    );
  });

  it("does not choose the first mapped type when the stay type is missing", () => {
    const missingTypeOptions = {
      ...options,
      scheduleTypes: options.scheduleTypes.filter(
        (scheduleType) => scheduleType.id !== "hotel-stay-type",
      ),
    };
    const transitioned = transitionScheduleFormCalendar(
      generalForm(),
      "hotel-calendar",
      missingTypeOptions,
      snapshot,
    );
    expect(transitioned.scheduleTypeId).toBe("");
  });
});
