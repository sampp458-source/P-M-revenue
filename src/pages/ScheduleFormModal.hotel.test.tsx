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
  hotelMultiDogCreationFromForm,
  initializeHotelScheduleForm,
  resolveScheduleCreateAttempt,
  transitionScheduleFormCalendar,
  type ScheduleForm,
} from "./OperationsToday";
import type {
  OperationSchedule,
  OperationScheduleInput,
  OperationScheduleOptions,
} from "./operationsScheduleRepository";
import {
  sharedRoomFamilyBookingErrorMessage,
  sharedRoomFamilyBookingRpcArgs,
} from "../platform/familyBookingRepository";

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
    { id: "customer-2", name: "다른 보호자", phone: "01098765432" },
  ],
  dogs: [
    { id: "dog-1", name: "토리", customerId: "customer-1" },
    { id: "dog-2", name: "보리", customerId: "customer-1" },
    { id: "dog-4", name: "몽이", customerId: "customer-1" },
    { id: "dog-3", name: "구름", customerId: "customer-2" },
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
    {
      id: "deluxe",
      code: "DELUXE",
      name: "DELUXE",
      activeRooms: 3,
      reservedPeak: 0,
      checkedInNow: 0,
      allocatedNow: 0,
      reservedNow: 0,
      unassignedNow: 0,
      physicallyEmpty: 3,
    },
  ],
  rooms: [
    {
      id: "deluxe-room-1",
      name: "디럭스 1",
      roomTypeId: "deluxe",
      roomTypeCode: "DELUXE",
      roomTypeName: "DELUXE",
      isActive: true,
      sortOrder: 1,
    },
  ],
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

function Harness({
  initialHotel = false,
  initialForm,
}: {
  initialHotel?: boolean;
  initialForm?: ScheduleForm;
}) {
  const initial = initialForm ?? (initialHotel
    ? initializeHotelScheduleForm(generalForm(), options, snapshot)
    : generalForm());
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

  it("shows customer-first multi-Dog selection and explicit room intent", () => {
    const form = initializeHotelScheduleForm(generalForm(), options, snapshot);
    form.customerIds = ["customer-1"];
    form.dogIds = ["dog-1", "dog-2"];
    render(<Harness initialForm={form} />);

    const labels = screen.getAllByText(/^(보호자|반려견)$/);
    expect(labels[0].textContent).toContain("보호자");
    expect(screen.getByText("2마리 선택됨")).toBeTruthy();
    expect(screen.getByText("객실 사용 방식")).toBeTruthy();
    expect(screen.getByText("각각 다른 객실 사용")).toBeTruthy();
    expect(screen.getByText("같은 객실에서 함께 투숙")).toBeTruthy();

    fireEvent.click(screen.getByText("같은 객실에서 함께 투숙"));
    expect(screen.getByText("같은 객실 투숙은 디럭스 객실에서만 가능합니다.")).toBeTruthy();
    expect(screen.getByText("함께 투숙할 객실")).toBeTruthy();
  });

  it("maps two independent Dogs to one atomic Family Booking call", async () => {
    const form = initializeHotelScheduleForm(generalForm(), options, snapshot);
    form.customerIds = ["customer-1"];
    form.dogIds = ["dog-1", "dog-2"];
    const createHotel = vi.fn();
    const createOperation = vi.fn();
    const createIndependentHotelFamily = vi.fn().mockResolvedValue({
      members: [
        { hotelStayId: "stay-1" },
        { hotelStayId: "stay-2" },
      ],
    });
    const createSharedHotelFamily = vi.fn();

    const result = await createNewScheduleFromForm(
      form,
      options,
      snapshot,
      "request-independent",
      {
        createHotel,
        createOperation,
        createIndependentHotelFamily,
        createSharedHotelFamily,
      },
    );

    expect(result).toEqual(expect.objectContaining({
      kind: "hotel",
      creationMode: "independent",
      hotelStayId: "stay-1",
    }));
    expect(createIndependentHotelFamily).toHaveBeenCalledTimes(1);
    expect(createIndependentHotelFamily.mock.calls[0][0].members).toHaveLength(2);
    expect(createIndependentHotelFamily.mock.calls[0][0].members.every(
      (member: { sharedRoomGroupKey: string | null }) => member.sharedRoomGroupKey === null,
    )).toBe(true);
    expect(createHotel).not.toHaveBeenCalled();
    expect(createSharedHotelFamily).not.toHaveBeenCalled();
  });

  it("calls the shared-room facade exactly once with DELUXE room intent", async () => {
    const form = initializeHotelScheduleForm(generalForm(), options, snapshot);
    form.customerIds = ["customer-1"];
    form.dogIds = ["dog-1", "dog-2"];
    form.hotelRoomUsageIntent = "shared";
    form.hotelRoomTypeId = "deluxe";
    form.hotelSharedRoomId = "deluxe-room-1";
    form.memo = "함께 투숙 메모";
    const createSharedHotelFamily = vi.fn().mockResolvedValue({
      familyBooking: {
        members: [
          { hotelStayId: "stay-1" },
          { hotelStayId: "stay-2" },
        ],
      },
      occupancy: { dogCount: 2 },
      replayed: false,
    });
    const createHotel = vi.fn();
    const createOperation = vi.fn();

    const result = await createNewScheduleFromForm(
      form,
      options,
      snapshot,
      "request-shared",
      { createHotel, createOperation, createSharedHotelFamily },
    );

    expect(result).toEqual(expect.objectContaining({
      kind: "hotel",
      creationMode: "shared",
      hotelStayId: "stay-1",
    }));
    expect(createSharedHotelFamily).toHaveBeenCalledTimes(1);
    expect(createSharedHotelFamily.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        requestId: "request-shared",
        roomTypeId: "deluxe",
        roomId: "deluxe-room-1",
        sharedRoomIntent: true,
      }),
    );
    expect(createSharedHotelFamily.mock.calls[0][0].members).toHaveLength(2);
    expect(createSharedHotelFamily.mock.calls[0][0].members.every(
      (member: { memo: string | null }) => member.memo === form.memo,
    )).toBe(true);
    expect(createSharedHotelFamily.mock.calls[0][0].members.every(
      (member: { sharedRoomGroupKey: string | null }) => member.sharedRoomGroupKey === "shared-room",
    )).toBe(true);
    expect(createHotel).not.toHaveBeenCalled();
  });

  it("keeps an empty memo empty for shared-room creation", () => {
    const form = initializeHotelScheduleForm(generalForm(), options, snapshot);
    form.customerIds = ["customer-1"];
    form.dogIds = ["dog-1", "dog-2"];
    form.hotelRoomUsageIntent = "shared";
    form.hotelRoomTypeId = "deluxe";
    form.hotelSharedRoomId = "deluxe-room-1";
    form.memo = "";

    const result = hotelMultiDogCreationFromForm(
      form,
      options,
      snapshot,
      "request-empty-memo",
    );

    expect(result.error).toBe("");
    expect(result.creation?.input.commonMemo).toBeNull();
    expect(result.creation?.input.members.every((member) => member.memo === null)).toBe(true);
    expect(JSON.stringify(result.creation)).not.toContain("두 반려견");
  });

  it("preserves only the exact user memo across room intent and Dog-count changes", () => {
    const form = initializeHotelScheduleForm(generalForm(), options, snapshot);
    form.customerIds = ["customer-1"];
    form.dogIds = ["dog-1", "dog-2"];
    form.hotelRoomTypeId = "deluxe";
    form.hotelSharedRoomId = "deluxe-room-1";
    form.memo = "복약 후 저녁 식사를 확인해 주세요.";

    for (const [intent, dogIds] of [
      ["shared", ["dog-1", "dog-2"]],
      ["independent", ["dog-1", "dog-2"]],
      ["shared", ["dog-1", "dog-2", "dog-4"]],
    ] as const) {
      form.hotelRoomUsageIntent = intent;
      form.dogIds = [...dogIds];
      const result = hotelMultiDogCreationFromForm(
        form,
        options,
        snapshot,
        `request-${intent}-${dogIds.length}`,
      );
      expect(result.error).toBe("");
      expect(result.creation?.input.commonMemo).toBe(form.memo);
      expect(result.creation?.input.members).toHaveLength(dogIds.length);
      expect(result.creation?.input.members.every((member) => member.memo === form.memo)).toBe(true);
    }
  });

  it("creates a three-Dog shared reservation through one facade call", async () => {
    const form = initializeHotelScheduleForm(generalForm(), options, snapshot);
    form.customerIds = ["customer-1"];
    form.dogIds = ["dog-1", "dog-2", "dog-4"];
    form.hotelRoomUsageIntent = "shared";
    form.hotelRoomTypeId = "deluxe";
    form.hotelSharedRoomId = "deluxe-room-1";
    const createSharedHotelFamily = vi.fn().mockResolvedValue({
      familyBooking: {
        members: [
          { hotelStayId: "stay-1" },
          { hotelStayId: "stay-2" },
          { hotelStayId: "stay-3" },
        ],
      },
      occupancy: { dogCount: 3, allocationCount: 1, sharedCapacityQuantity: 1 },
      replayed: false,
    });

    await createNewScheduleFromForm(
      form,
      options,
      snapshot,
      "request-shared-three",
      {
        createHotel: vi.fn(),
        createOperation: vi.fn(),
        createSharedHotelFamily,
      },
    );

    expect(createSharedHotelFamily).toHaveBeenCalledTimes(1);
    expect(createSharedHotelFamily.mock.calls[0][0].members).toHaveLength(3);
    expect(createSharedHotelFamily.mock.calls[0][0].commonMemo).toBeNull();
  });

  it("rejects non-DELUXE, missing-room and cross-customer shared requests before mutation", () => {
    const form = initializeHotelScheduleForm(generalForm(), options, snapshot);
    form.customerIds = ["customer-1"];
    form.dogIds = ["dog-1", "dog-2"];
    form.hotelRoomUsageIntent = "shared";
    form.hotelRoomTypeId = "standard";

    expect(hotelMultiDogCreationFromForm(
      form,
      options,
      snapshot,
      "request-standard",
    ).error).toContain("디럭스");

    form.hotelRoomTypeId = "deluxe";
    expect(hotelMultiDogCreationFromForm(
      form,
      options,
      snapshot,
      "request-room-missing",
    ).error).toContain("객실을 선택");

    form.dogIds = ["dog-1", "dog-3"];
    form.hotelSharedRoomId = "deluxe-room-1";
    expect(hotelMultiDogCreationFromForm(
      form,
      options,
      snapshot,
      "request-cross-customer",
    ).error).toContain("같은 보호자");
  });

  it("reuses a request ID only for the exact same retry payload", () => {
    const form = initializeHotelScheduleForm(generalForm(), options, snapshot);
    const ids = ["request-1", "request-2"];
    const createId = vi.fn(() => ids.shift()!);
    const first = resolveScheduleCreateAttempt(null, form, createId);
    const retry = resolveScheduleCreateAttempt(first, form, createId);
    const changed = resolveScheduleCreateAttempt(
      retry,
      { ...form, memo: "changed" },
      createId,
    );

    expect(retry.requestId).toBe("request-1");
    expect(changed.requestId).toBe("request-2");
    expect(createId).toHaveBeenCalledTimes(2);
  });

  it("maps the approved facade signature in its exact argument order and meaning", () => {
    const args = sharedRoomFamilyBookingRpcArgs({
      customerId: "customer-1",
      commonMemo: "memo",
      paymentBundleRequested: false,
      members: [],
      roomTypeId: "deluxe",
      roomId: "deluxe-room-1",
      sharedRoomIntent: true,
      requestId: "request-shared",
    });

    expect(Object.keys(args)).toEqual([
      "p_customer_id",
      "p_common_memo",
      "p_payment_bundle_requested",
      "p_members",
      "p_room_type_id",
      "p_room_id",
      "p_shared_room_intent",
      "p_request_id",
    ]);
    expect(args).toEqual(expect.objectContaining({
      p_customer_id: "customer-1",
      p_room_type_id: "deluxe",
      p_room_id: "deluxe-room-1",
      p_shared_room_intent: true,
      p_request_id: "request-shared",
    }));
  });

  it("presents room, capacity and generic facade errors without SQL details", () => {
    expect(sharedRoomFamilyBookingErrorMessage({ code: "23P01" })).toContain(
      "다른 예약이 먼저 사용",
    );
    expect(sharedRoomFamilyBookingErrorMessage({
      code: "23514",
      message: "capacity unavailable",
    })).toContain("이용 가능한 디럭스 객실이 없습니다");
    expect(sharedRoomFamilyBookingErrorMessage({
      code: "P0001",
      message: "internal sql detail",
    })).toBe("호텔 예약을 완료하지 못했습니다. 다시 시도해 주세요.");
  });
});
