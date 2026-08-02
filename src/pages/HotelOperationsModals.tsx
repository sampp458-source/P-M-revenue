import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { SearchSelect } from "../components/SearchSelect";
import {
  Button,
  Field,
  Input,
  Modal,
  Textarea,
} from "../components/ui";
import type {
  OperationCustomer,
  OperationDog,
  OperationPerson,
  OperationScheduleOptions,
} from "./operationsScheduleRepository";
import {
  nextSeoulDate,
  operationPersonColor,
  toSeoulInstant,
} from "./operationsScheduleRepository";
import type {
  HotelOperationSettingsSnapshot,
  HotelOperationsSnapshot,
  HotelReservationInput,
  HotelRoomSnapshot,
  HotelStay,
} from "./hotelOperationsRepository";
import {
  activeHotelAllocation,
  hotelStayAssigneeIds,
  hotelStayCalendarContract,
  hotelStayMemo,
  hotelStayTitle,
  seoulInputParts,
} from "./hotelOperationsUi";

const phone = (value: string | null) => value || "연락처 미등록";

function SingleSearch<T>({
  label,
  items,
  selectedId,
  onChange,
  getId,
  getText,
  render,
  placeholder,
  required = true,
}: {
  label: string;
  items: readonly T[];
  selectedId: string;
  onChange: (id: string) => void;
  getId: (item: T) => string;
  getText: (item: T) => string;
  render: (item: T) => ReactNode;
  placeholder: string;
  required?: boolean;
}) {
  return (
    <SearchSelect
      label={label}
      items={items}
      selectedIds={selectedId ? [selectedId] : []}
      onChange={(ids) => onChange(ids[0] ?? "")}
      getItemId={getId}
      getSearchText={getText}
      renderOption={(item) => render(item)}
      renderSelected={(item) => render(item)}
      placeholder={placeholder}
      multiple={false}
      required={required}
      showAllOnEmpty
      noResultsMessage="검색 결과가 없습니다."
    />
  );
}

interface ReservationFormState {
  calendarId: string;
  scheduleTypeId: string;
  title: string;
  checkInDate: string;
  checkInTime: string;
  checkOutDate: string;
  checkOutTime: string;
  roomTypeId: string;
  dogId: string;
  customerId: string;
  assigneeId: string;
  memo: string;
}

function reservationInitial(
  selectedDate: string,
  snapshot: HotelOperationsSnapshot,
  options: OperationScheduleOptions,
  currentProfileId: string,
  stay: HotelStay | null,
): ReservationFormState {
  const hotelCalendars = options.calendars.filter(
    (calendar) => calendar.businessUnitName === "호텔",
  );
  if (stay?.capacityReservation) {
    const checkIn = seoulInputParts(stay.capacityReservation.reservedFrom);
    const checkOut = seoulInputParts(stay.capacityReservation.reservedUntil);
    const contract = hotelStayCalendarContract(stay);
    return {
      calendarId: contract.calendarId,
      scheduleTypeId: contract.scheduleTypeId,
      title: hotelStayTitle(stay),
      checkInDate: checkIn.date,
      checkInTime: checkIn.time,
      checkOutDate: checkOut.date,
      checkOutTime: checkOut.time,
      roomTypeId: stay.capacityReservation.roomTypeId,
      dogId: stay.dogId,
      customerId: stay.customerId ?? "",
      assigneeId: hotelStayAssigneeIds(stay)[0] ?? "",
      memo: hotelStayMemo(stay),
    };
  }
  const calendarId = hotelCalendars[0]?.id ?? "";
  const scheduleTypeId =
    options.scheduleTypes.find((type) => type.calendarIds?.includes(calendarId))
      ?.id ?? "";
  return {
    calendarId,
    scheduleTypeId,
    title: "",
    checkInDate: selectedDate,
    checkInTime: snapshot.settings?.defaultCheckInTime.slice(0, 5) ?? "15:00",
    checkOutDate: nextSeoulDate(selectedDate),
    checkOutTime: snapshot.settings?.defaultCheckOutTime.slice(0, 5) ?? "11:00",
    roomTypeId: snapshot.roomTypes[0]?.id ?? "",
    dogId: "",
    customerId: "",
    assigneeId: options.assignees.some((person) => person.id === currentProfileId)
      ? currentProfileId
      : "",
    memo: "",
  };
}

export function HotelReservationModal({
  open,
  selectedDate,
  snapshot,
  options,
  currentProfileId,
  stay,
  processing,
  onClose,
  onSubmit,
}: {
  open: boolean;
  selectedDate: string;
  snapshot: HotelOperationsSnapshot;
  options: OperationScheduleOptions;
  currentProfileId: string;
  stay: HotelStay | null;
  processing: boolean;
  onClose: () => void;
  onSubmit: (input: HotelReservationInput) => void;
}) {
  const [form, setForm] = useState(() =>
    reservationInitial(selectedDate, snapshot, options, currentProfileId, stay),
  );
  const [formError, setFormError] = useState("");
  const titleEdited = useRef(Boolean(stay));
  useEffect(() => {
    if (!open) return;
    setForm(
      reservationInitial(selectedDate, snapshot, options, currentProfileId, stay),
    );
    titleEdited.current = Boolean(stay);
    setFormError("");
  }, [currentProfileId, open, options, selectedDate, snapshot, stay]);

  const hotelCalendars = options.calendars.filter(
    (calendar) => calendar.businessUnitName === "호텔",
  );
  const scheduleTypes = options.scheduleTypes.filter((type) =>
    type.calendarIds?.includes(form.calendarId),
  );
  const selectedDog = options.dogs.find((dog) => dog.id === form.dogId);

  const updateDog = (dogId: string) => {
    const dog = options.dogs.find((item) => item.id === dogId);
    setForm((current) => ({
      ...current,
      dogId,
      customerId: dog?.customerId ?? "",
      title:
        !titleEdited.current && dog
          ? `${dog.name} 호텔 예약`
          : current.title,
    }));
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (
      !form.calendarId ||
      !form.scheduleTypeId ||
      !form.title.trim() ||
      !form.checkInDate ||
      !form.checkInTime ||
      !form.checkOutDate ||
      !form.checkOutTime ||
      !form.roomTypeId ||
      !form.dogId ||
      !form.customerId ||
      !form.assigneeId
    ) {
      setFormError("필수 항목을 모두 선택해 주세요.");
      return;
    }
    const checkInAt = toSeoulInstant(form.checkInDate, form.checkInTime);
    const checkOutAt = toSeoulInstant(form.checkOutDate, form.checkOutTime);
    if (new Date(checkOutAt) <= new Date(checkInAt)) {
      setFormError("퇴실 일시는 입실 일시보다 늦어야 합니다.");
      return;
    }
    setFormError("");
    onSubmit({
      calendarId: form.calendarId,
      scheduleTypeId: form.scheduleTypeId,
      title: form.title.trim(),
      checkInAt,
      checkOutAt,
      roomTypeId: form.roomTypeId,
      dogId: form.dogId,
      customerId: form.customerId || null,
      assigneeIds: form.assigneeId ? [form.assigneeId] : [],
      memo: form.memo.trim(),
    });
  };

  return (
    <Modal
      open={open}
      title={stay ? "호텔 예약 수정" : "호텔 예약 등록"}
      onClose={onClose}
      wide
      resetKey={stay?.id ?? selectedDate}
    >
      <form onSubmit={submit} className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <SingleSearch
            label="호텔 캘린더"
            items={hotelCalendars}
            selectedId={form.calendarId}
            onChange={(calendarId) =>
              setForm((current) => ({
                ...current,
                calendarId,
                scheduleTypeId:
                  options.scheduleTypes.find((type) =>
                    type.calendarIds?.includes(calendarId),
                  )?.id ?? "",
              }))
            }
            getId={(item) => item.id}
            getText={(item) => item.name}
            render={(item) => <span>{item.name}</span>}
            placeholder="호텔 캘린더 검색"
          />
          <SingleSearch
            label="일정 유형"
            items={scheduleTypes}
            selectedId={form.scheduleTypeId}
            onChange={(scheduleTypeId) =>
              setForm((current) => ({ ...current, scheduleTypeId }))
            }
            getId={(item) => item.id}
            getText={(item) => item.name}
            render={(item) => <span>{item.name}</span>}
            placeholder="일정 유형 검색"
          />
        </div>

        <SingleSearch<HotelOperationsSnapshot["roomTypes"][number]>
          label="객실 유형"
          items={snapshot.roomTypes}
          selectedId={form.roomTypeId}
          onChange={(roomTypeId) =>
            setForm((current) => ({ ...current, roomTypeId }))
          }
          getId={(item) => item.id}
          getText={(item) => `${item.code} ${item.name}`}
          render={(item) => (
            <span>
              <b>{item.name}</b> · 예약 {item.reservedPeak}/{item.activeRooms}
            </span>
          )}
          placeholder="객실 유형 검색"
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="입실일" required>
            <Input
              type="date"
              required
              value={form.checkInDate}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  checkInDate: event.target.value,
                }))
              }
            />
          </Field>
          <Field label="입실 시간" required>
            <Input
              type="time"
              required
              value={form.checkInTime}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  checkInTime: event.target.value,
                }))
              }
            />
          </Field>
          <Field label="퇴실일" required>
            <Input
              type="date"
              required
              value={form.checkOutDate}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  checkOutDate: event.target.value,
                }))
              }
            />
          </Field>
          <Field label="퇴실 시간" required>
            <Input
              type="time"
              required
              value={form.checkOutTime}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  checkOutTime: event.target.value,
                }))
              }
            />
          </Field>
        </div>

        <SingleSearch<OperationDog>
          label="반려견"
          items={options.dogs}
          selectedId={form.dogId}
          onChange={updateDog}
          getId={(item) => item.id}
          getText={(item) => {
            const customer = options.customers.find(
              (row) => row.id === item.customerId,
            );
            return `${item.name} ${customer?.name ?? ""} ${customer?.phone ?? ""}`;
          }}
          render={(item) => {
            const customer = options.customers.find(
              (row) => row.id === item.customerId,
            );
            return (
              <span>
                🐶 <b>{item.name}</b>
                <small className="ml-2 text-text-secondary">
                  {customer?.name ?? "보호자 미등록"} · {phone(customer?.phone ?? null)}
                </small>
              </span>
            );
          }}
          placeholder="반려견·보호자·연락처 검색"
        />

        <SingleSearch<OperationCustomer>
          label="보호자"
          items={options.customers}
          selectedId={form.customerId}
          onChange={(customerId) =>
            setForm((current) => ({ ...current, customerId }))
          }
          getId={(item) => item.id}
          getText={(item) => `${item.name ?? ""} ${item.phone ?? ""}`}
          render={(item) => (
            <span>
              <b>{item.name ?? "이름 미등록"}</b>
              <small className="ml-2 text-text-secondary">{phone(item.phone)}</small>
            </span>
          )}
          placeholder="보호자명·연락처 검색"
        />

        <SingleSearch<OperationPerson>
          label="담당자"
          items={options.assignees}
          selectedId={form.assigneeId}
          onChange={(assigneeId) =>
            setForm((current) => ({ ...current, assigneeId }))
          }
          getId={(item) => item.id}
          getText={(item) => item.name ?? "이름 미등록"}
          render={(item) => (
            <span className="inline-flex items-center gap-2">
              <i
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: operationPersonColor(item) }}
              />
              {item.name ?? "이름 미등록"}
            </span>
          )}
          placeholder="담당자 검색"
        />

        <Field label="예약 제목" required>
          <Input
            required
            value={form.title}
            onChange={(event) => {
              titleEdited.current = true;
              setForm((current) => ({ ...current, title: event.target.value }));
            }}
            placeholder={
              selectedDog ? `${selectedDog.name} 호텔 예약` : "예약 제목 입력"
            }
          />
        </Field>
        <Field label="메모">
          <Textarea
            value={form.memo}
            onChange={(event) =>
              setForm((current) => ({ ...current, memo: event.target.value }))
            }
            placeholder="현장에서 확인할 내용을 입력하세요."
          />
        </Field>
        {formError ? (
          <p role="alert" className="rounded-xl border border-error/15 bg-error-soft px-4 py-3 text-sm text-error">
            {formError}
          </p>
        ) : null}
        <div className="sticky bottom-0 -mx-5 -mb-5 flex justify-end gap-2 border-t border-border bg-surface px-5 py-4 sm:static sm:mx-0 sm:mb-0 sm:border-0 sm:p-0">
          <Button type="button" variant="secondary" onClick={onClose} disabled={processing}>
            닫기
          </Button>
          <Button disabled={processing}>
            {processing ? "저장 중..." : stay ? "변경 저장" : "예약 등록"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function RoomSelectModal({
  open,
  title,
  submitLabel,
  snapshot,
  stay,
  processing,
  onClose,
  onSubmit,
  children,
}: {
  open: boolean;
  title: string;
  submitLabel: string;
  snapshot: HotelOperationsSnapshot;
  stay: HotelStay;
  processing: boolean;
  onClose: () => void;
  onSubmit: (roomId: string, reason: string) => void;
  children?: ReactNode;
}) {
  const [roomId, setRoomId] = useState("");
  const [reason, setReason] = useState("");
  const roomTypeId = stay.capacityReservation?.roomTypeId ?? "";
  const rooms = useMemo(
    () =>
      snapshot.rooms.filter(
        (room) => room.roomTypeId === roomTypeId && room.isActive,
      ),
    [roomTypeId, snapshot.rooms],
  );
  useEffect(() => {
    if (!open) return;
    setRoomId("");
    setReason("");
  }, [open]);
  return (
    <Modal open={open} title={title} onClose={onClose} resetKey={stay.id}>
      <form
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (roomId) onSubmit(roomId, reason.trim());
        }}
      >
        <SingleSearch<HotelRoomSnapshot>
          label="호실"
          items={rooms}
          selectedId={roomId}
          onChange={setRoomId}
          getId={(item) => item.id}
          getText={(item) => `${item.roomTypeName} ${item.name}`}
          render={(item) => (
            <span>
              <b>{item.name}</b> · {item.roomTypeName}
            </span>
          )}
          placeholder="직접 호실 선택"
        />
        {children}
        <Field label="처리 사유">
          <Input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="선택 사항" />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={processing}>닫기</Button>
          <Button disabled={processing || !roomId}>{processing ? "처리 중..." : submitLabel}</Button>
        </div>
      </form>
    </Modal>
  );
}

export function RoomAssignModal(props: Omit<Parameters<typeof RoomSelectModal>[0], "title" | "submitLabel">) {
  return <RoomSelectModal {...props} title="호실 배정" submitLabel="호실 배정" />;
}

export function RoomReassignModal(props: Omit<Parameters<typeof RoomSelectModal>[0], "title" | "submitLabel">) {
  return <RoomSelectModal {...props} title="입실 전 호실 재배정" submitLabel="재배정" />;
}

export function MoveRoomModal({
  open,
  snapshot,
  stay,
  processing,
  onClose,
  onSubmit,
}: {
  open: boolean;
  snapshot: HotelOperationsSnapshot;
  stay: HotelStay;
  processing: boolean;
  onClose: () => void;
  onSubmit: (roomId: string, moveAt: string, reason: string) => void;
}) {
  const [moveAt, setMoveAt] = useState("");
  useEffect(() => {
    if (!open) return;
    const now = seoulInputParts(new Date().toISOString());
    setMoveAt(`${now.date}T${now.time}`);
  }, [open]);
  return (
    <RoomSelectModal
      open={open}
      title="객실 이동"
      submitLabel="객실 이동"
      snapshot={snapshot}
      stay={stay}
      processing={processing}
      onClose={onClose}
      onSubmit={(roomId, reason) => {
        const [date, time] = moveAt.split("T");
        if (date && time) onSubmit(roomId, toSeoulInstant(date, time), reason);
      }}
    >
      <Field label="이동 시각" required>
        <Input
          type="datetime-local"
          required
          value={moveAt}
          onChange={(event) => setMoveAt(event.target.value)}
        />
      </Field>
    </RoomSelectModal>
  );
}

function CompletionModal({
  open,
  title,
  label,
  stay,
  processing,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  label: string;
  stay: HotelStay;
  processing: boolean;
  onClose: () => void;
  onSubmit: (completedAt: string) => void;
}) {
  const [completedAt, setCompletedAt] = useState("");
  useEffect(() => {
    if (!open) return;
    const now = seoulInputParts(new Date().toISOString());
    setCompletedAt(`${now.date}T${now.time}`);
  }, [open]);
  return (
    <Modal open={open} title={title} onClose={onClose} resetKey={stay.id}>
      <form
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          const [date, time] = completedAt.split("T");
          if (date && time) onSubmit(toSeoulInstant(date, time));
        }}
      >
        <Field label="처리 시각" required>
          <Input type="datetime-local" required value={completedAt} onChange={(event) => setCompletedAt(event.target.value)} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={processing}>닫기</Button>
          <Button disabled={processing || !completedAt}>{processing ? "처리 중..." : label}</Button>
        </div>
      </form>
    </Modal>
  );
}

export function CheckInModal(props: Omit<Parameters<typeof CompletionModal>[0], "title" | "label">) {
  return <CompletionModal {...props} title="입실 완료" label="입실 완료" />;
}

export function CheckOutModal(props: Omit<Parameters<typeof CompletionModal>[0], "title" | "label">) {
  return <CompletionModal {...props} title="퇴실 완료" label="퇴실 완료" />;
}

export function SettingsModal({
  open,
  settings,
  processing,
  onClose,
  onSubmit,
}: {
  open: boolean;
  settings: HotelOperationSettingsSnapshot;
  processing: boolean;
  onClose: () => void;
  onSubmit: (checkIn: string, checkOut: string) => void;
}) {
  const [checkIn, setCheckIn] = useState(settings.defaultCheckInTime.slice(0, 5));
  const [checkOut, setCheckOut] = useState(settings.defaultCheckOutTime.slice(0, 5));
  useEffect(() => {
    if (!open) return;
    setCheckIn(settings.defaultCheckInTime.slice(0, 5));
    setCheckOut(settings.defaultCheckOutTime.slice(0, 5));
  }, [open, settings]);
  return (
    <Modal open={open} title="호텔 운영 기본 시간" onClose={onClose}>
      <form className="space-y-5" onSubmit={(event) => { event.preventDefault(); onSubmit(checkIn, checkOut); }}>
        <Field label="기본 입실 시간" required><Input type="time" required value={checkIn} onChange={(event) => setCheckIn(event.target.value)} /></Field>
        <Field label="기본 퇴실 시간" required><Input type="time" required value={checkOut} onChange={(event) => setCheckOut(event.target.value)} /></Field>
        <p className="text-xs text-text-secondary">시간대: {settings.timezone}</p>
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose} disabled={processing}>닫기</Button><Button disabled={processing}>{processing ? "저장 중..." : "설정 저장"}</Button></div>
      </form>
    </Modal>
  );
}

export function currentAllocatedRoomName(stay: HotelStay) {
  return activeHotelAllocation(stay)?.roomName ?? "미배정";
}
