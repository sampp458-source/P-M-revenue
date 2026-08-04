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
  halfHourTimeOptions,
  hotelReservationInputFromForm,
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
    expect(screen.queryByLabelText(/^제목/)).toBeNull();
    expect(screen.queryByLabelText(/예약 제목/)).toBeNull();
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

  it("switches a Hotel calendar between reservation and general operation modes", () => {
    render(<Harness initialHotel />);

    expect(screen.getByLabelText(/입실 날짜/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "상담·일반 일정" }));
    expect(screen.queryByLabelText(/입실 날짜/)).toBeNull();
    expect(screen.getByLabelText(/^제목/)).toBeTruthy();
    expect((screen.getByLabelText(/일정 유형/) as HTMLSelectElement).disabled).toBe(false);
    expect((screen.getByLabelText(/일정 유형/) as HTMLSelectElement).value).toBe("class-type");

    fireEvent.click(screen.getByRole("button", { name: "호텔 예약" }));
    expect(screen.getByLabelText(/입실 날짜/)).toBeTruthy();
    expect((screen.getByLabelText(/일정 유형/) as HTMLSelectElement).value).toBe("hotel-stay-type");
  });

  it("prioritizes configured Hotel defaults while retaining every 30-minute option", () => {
    const options = halfHourTimeOptions("15:00:00");
    expect(options[0]).toBe("15:00");
    expect(options).toHaveLength(48);
    expect(options).toContain("09:30");
    expect(options).toContain("23:30");
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

    const hotelGeneralForm = initializeHotelScheduleForm(
      generalForm(),
      options,
      snapshot,
    );
    hotelGeneralForm.hotelScheduleMode = "operation";
    hotelGeneralForm.scheduleTypeId = "class-type";
    hotelGeneralForm.title = "호텔 방문 상담";
    hotelGeneralForm.startTime = "14:00";
    hotelGeneralForm.endTime = "15:00";
    await createNewScheduleFromForm(
      hotelGeneralForm,
      options,
      snapshot,
      "request-hotel-consultation",
      { createHotel, createOperation },
    );
    expect(createOperation).toHaveBeenCalledTimes(2);
    expect(createOperation.mock.calls[1][0]).toEqual(
      expect.objectContaining({
        calendarId: "hotel-calendar",
        scheduleTypeId: "class-type",
        title: "호텔 방문 상담",
      }),
    );
    expect(createHotel).toHaveBeenCalledTimes(1);
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

  it("supports independent unknown check-in, check-out and room-type values", async () => {
    const createHotel = vi
      .fn<
        (input: HotelReservationInput, requestId: string) => Promise<HotelStay>
      >()
      .mockResolvedValue({ id: "stay-flexible" } as HotelStay);
    const createOperation = vi
      .fn<
        (
          input: OperationScheduleInput,
          requestId: string,
        ) => Promise<OperationSchedule>
      >();
    const form = initializeHotelScheduleForm(
      generalForm(),
      options,
      snapshot,
    );
    form.title = "토리 호텔 예약";
    form.dogIds = ["dog-1"];
    form.customerIds = ["customer-1"];
    form.hotelCheckInTimeUnspecified = true;
    form.hotelCheckOutTimeUnspecified = true;
    form.hotelRoomTypeId = "";

    await createNewScheduleFromForm(
      form,
      options,
      snapshot,
      "request-flexible",
      { createHotel, createOperation },
    );

    expect(createHotel).toHaveBeenCalledWith(
      expect.objectContaining({
        checkInTime: null,
        checkInTimeUnspecified: true,
        checkOutTime: null,
        checkOutTimeUnspecified: true,
        roomTypeId: null,
      }),
      "request-flexible",
    );
    expect(createOperation).not.toHaveBeenCalled();
  });

  it("clears stale times when an unknown-time option changes", () => {
    render(<Harness initialHotel />);

    const checkInTime = screen.getByLabelText(/입실 시간/) as HTMLInputElement;
    const checkOutTime = screen.getByLabelText(/퇴실 시간/) as HTMLInputElement;
    expect(checkInTime.value).toBe("15:00");
    expect(checkOutTime.value).toBe("11:00");

    const unknownTimeOptions = screen.getAllByLabelText("시간 미정");
    fireEvent.click(unknownTimeOptions[0]);
    expect(checkInTime.value).toBe("");
    expect(checkInTime.disabled).toBe(true);
    fireEvent.click(unknownTimeOptions[0]);
    expect(checkInTime.value).toBe("");
    expect(checkInTime.disabled).toBe(false);

    fireEvent.click(unknownTimeOptions[1]);
    expect(checkOutTime.value).toBe("");
    expect(checkOutTime.disabled).toBe(true);
  });

  it("rejects invalid same-day fixed times but permits unknown times", () => {
    const form = initializeHotelScheduleForm(
      generalForm(),
      options,
      snapshot,
    );
    form.title = "토리 호텔 예약";
    form.dogIds = ["dog-1"];
    form.customerIds = ["customer-1"];
    form.hotelCheckOutDate = form.date;
    form.startTime = "15:00";
    form.hotelCheckOutTime = "11:00";

    const invalid = hotelReservationInputFromForm(form, options, snapshot);
    expect(invalid.error).toContain("퇴실 시간은 입실 시간보다 늦어야");

    form.hotelCheckOutTimeUnspecified = true;
    const flexible = hotelReservationInputFromForm(form, options, snapshot);
    expect(flexible.error).toBe("");
  });
});
