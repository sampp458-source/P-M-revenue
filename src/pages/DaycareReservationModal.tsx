import { daycareDogNames } from "./daycareReservationPresentation";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { CalendarDays, Check } from "lucide-react";
import { CustomerDogSearchFields } from "../components/CustomerDogSearchFields";
import { Button, Field, FormAlert, FormSection, Input, Modal, ModalActions, Select, Textarea } from "../components/ui";
import { fetchHotelOperationsSnapshot, type HotelOperationsSnapshot } from "./hotelOperationsRepository";
import { fetchOperationScheduleOptions, seoulDateKey, type OperationScheduleOptions } from "./operationsScheduleRepository";
import {
  createDaycareReservation,
  updateDaycareReservation,
  type DaycareReservation,
  type DaycareReservationInput,
} from "./daycareOperationsRepository";

export interface DaycareReservationPrefill {
  customerId?: string;
  dogId?: string;
  serviceDate?: string;
}

export function validateDaycareReservationInput(
  input: DaycareReservationInput,
  dogs: OperationScheduleOptions["dogs"] = [],
  deluxeRoomTypeId?: string,
) {
  if (!input.customerId || !input.dogId) return "보호자와 반려견을 선택해 주세요.";
  if (input.sharedDogIds) {
    if (input.sharedDogIds.length !== 2 || !input.sharedDogIds.includes(input.dogId) || new Set(input.sharedDogIds).size !== 2) {
      return "반려견 두 마리를 선택해 주세요.";
    }
    if (!deluxeRoomTypeId || input.roomTypeId !== deluxeRoomTypeId) return "함께 데이케어는 디럭스 객실에서만 가능합니다.";
    if (input.sharedDogIds.some((id) => dogs.find((dog) => dog.id === id)?.customerId !== input.customerId)) {
      return "같은 보호자의 반려견만 함께 예약할 수 있습니다.";
    }
  }
  const selectedDog = dogs.find((dog) => dog.id === input.dogId);
  if (selectedDog?.customerId && selectedDog.customerId !== input.customerId) {
    return "선택한 보호자와 반려견 정보가 일치하지 않습니다.";
  }
  if (!input.calendarId || !input.scheduleTypeId) return "호텔 데이케어 캘린더와 일정 유형을 확인해 주세요.";
  if (!input.serviceDate) return "데이케어 날짜를 선택해 주세요.";
  if (!input.checkInTime || !input.checkOutTime) return "입실·퇴실 시간을 입력해 주세요.";
  if (input.checkOutTime <= input.checkInTime) return "퇴실 시간은 입실 시간보다 늦어야 합니다.";
  if (!input.roomTypeId) return "객실 유형을 선택해 주세요.";
  if (!input.assigneeIds.length) return "담당자를 한 명 이상 선택해 주세요.";
  return "";
}

const initialInput = (prefill?: DaycareReservationPrefill): DaycareReservationInput => ({
  calendarId: "",
  scheduleTypeId: "",
  customerId: prefill?.customerId ?? "",
  dogId: prefill?.dogId ?? "",
  serviceDate: prefill?.serviceDate ?? seoulDateKey(),
  checkInTime: "10:00",
  checkOutTime: "18:00",
  roomTypeId: "",
  roomId: null,
  assigneeIds: [],
  memo: "",
});

function inputFromReservation(reservation: DaycareReservation): DaycareReservationInput {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(reservation.startsAt));
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  const endParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(reservation.endsAt));
  const end = (type: Intl.DateTimeFormatPartTypes) => endParts.find((part) => part.type === type)?.value ?? "";
  return {
    calendarId: reservation.calendarId,
    scheduleTypeId: reservation.scheduleTypeId,
    customerId: reservation.customer.id,
    dogId: reservation.dog.id,
    ...(reservation.dogs?.length === 2 ? { sharedDogIds: reservation.dogs.map((dog) => dog.id) } : {}),
    serviceDate: `${value("year")}-${value("month")}-${value("day")}`,
    checkInTime: `${value("hour")}:${value("minute")}`,
    checkOutTime: `${end("hour")}:${end("minute")}`,
    roomTypeId: reservation.roomTypeId,
    roomId: reservation.roomAllocation?.roomId ?? null,
    assigneeIds: reservation.assignees.map((item) => item.id),
    memo: reservation.memo ?? "",
  };
}

export function DaycareReservationForm({
  onClose,
  onSaved,
  prefill,
  reservation = null,
}: {
  onClose: () => void;
  onSaved: (reservation: DaycareReservation) => void | Promise<void>;
  prefill?: DaycareReservationPrefill;
  reservation?: DaycareReservation | null;
}) {
  const [input, setInput] = useState<DaycareReservationInput>(() => initialInput(prefill));
  const [options, setOptions] = useState<OperationScheduleOptions | null>(null);
  const [snapshot, setSnapshot] = useState<HotelOperationsSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const sharedAttempt = useRef<{ key: string; requestId: string } | null>(null);
  const submitting = useRef(false);
  const prefillCustomerId = prefill?.customerId;
  const prefillDogId = prefill?.dogId;
  const prefillServiceDate = prefill?.serviceDate;

  useEffect(() => {
    setInput(reservation ? inputFromReservation(reservation) : initialInput({
      customerId: prefillCustomerId,
      dogId: prefillDogId,
      serviceDate: prefillServiceDate,
    }));
    sharedAttempt.current = null;
    setError("");
    setLoading(true);
    Promise.all([
      fetchOperationScheduleOptions(),
      fetchHotelOperationsSnapshot(prefillServiceDate ?? seoulDateKey()),
    ])
      .then(([nextOptions, nextSnapshot]) => {
        setOptions(nextOptions);
        setSnapshot(nextSnapshot);
        const calendar = nextOptions.calendars.find((item) => item.businessUnitCode === "hotel");
        const scheduleType = nextOptions.scheduleTypes.find((item) => item.id === "5cadf20b-021a-4948-a5dd-471677f51d21" && item.calendarIds?.includes(calendar?.id ?? ""));
        setInput((current) => ({
          ...current,
          customerId:
            nextOptions.dogs.find((dog) => dog.id === current.dogId)?.customerId ??
            current.customerId,
          calendarId: calendar?.id ?? "",
          scheduleTypeId: scheduleType?.id ?? "",
          roomTypeId: reservation ? current.roomTypeId : nextSnapshot.roomTypes[0]?.id ?? "",
          assigneeIds: reservation ? current.assigneeIds : current.assigneeIds.length ? current.assigneeIds : nextOptions.assignees[0]?.id ? [nextOptions.assignees[0].id] : [],
        }));
      })
      .catch(() => setError("Daycare 예약 정보를 불러오지 못했습니다."))
      .finally(() => setLoading(false));
  }, [prefillCustomerId, prefillDogId, prefillServiceDate, reservation]);

  useEffect(() => {
    if (!input.serviceDate) return;
    void fetchHotelOperationsSnapshot(input.serviceDate).then(setSnapshot).catch(() => setSnapshot(null));
  }, [input.serviceDate]);

  const dogs = useMemo(
    () => (options?.dogs ?? []).filter((dog) => !input.customerId || dog.customerId === input.customerId),
    [input.customerId, options?.dogs],
  );
  const rooms = useMemo(
    () => (snapshot?.rooms ?? []).filter((room) => room.isActive && room.roomTypeId === input.roomTypeId),
    [input.roomTypeId, snapshot?.rooms],
  );
  const deluxeRoomTypeId = snapshot?.roomTypes.find((roomType) => roomType.code.trim().toUpperCase() === "DELUXE")?.id;
  const shared = input.sharedDogIds !== undefined;
  const patch = (change: Partial<DaycareReservationInput>) => setInput((current) => ({ ...current, ...change }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting.current) return;
    const validation = validateDaycareReservationInput(input, options?.dogs ?? [], deluxeRoomTypeId);
    if (validation) return setError(validation);
    submitting.current = true;
    setSaving(true);
    setError("");
    try {
      if (!reservation && input.sharedDogIds) {
        const key = JSON.stringify({ ...input, dogId: undefined, sharedDogIds: [...input.sharedDogIds].sort() });
        if (sharedAttempt.current?.key !== key) sharedAttempt.current = { key, requestId: crypto.randomUUID() };
      }
      const saved = reservation
        ? await updateDaycareReservation(reservation.operationScheduleId, reservation.version, input)
        : input.sharedDogIds && sharedAttempt.current
          ? await createDaycareReservation(input, sharedAttempt.current.requestId)
          : await createDaycareReservation(input);
      await onSaved(saved);
      onClose();
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "Daycare 예약을 저장하지 못했습니다.");
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  };

  return (
      <form className="space-y-7" aria-label="데이케어 예약 양식" onSubmit={submit}>
        <FormAlert tone="info"><span className="flex items-center gap-2"><CalendarDays size={17} /> 같은 날짜 안에서 이용할 객실을 확보합니다.</span></FormAlert>
        <FormSection title="예약 대상" description="보호자와 반려견을 검색해 선택합니다.">
          {!reservation ? <label className="mb-3 flex min-h-11 items-center gap-2 text-sm font-semibold">
            <input type="checkbox" checked={shared} disabled={loading || saving || !deluxeRoomTypeId}
              onChange={(event) => patch(event.target.checked
                ? { sharedDogIds: input.dogId ? [input.dogId] : [], roomTypeId: deluxeRoomTypeId ?? "", roomId: null }
                : { sharedDogIds: undefined })} />
            한 객실에 두 마리 (디럭스)
          </label> : null}
          {shared ? <p className="mb-3 text-sm text-text-secondary">같은 보호자의 반려견 두 마리가 같은 시간에 디럭스 한 객실을 이용합니다.</p> : null}
          <div className="grid gap-4 sm:grid-cols-2">
          <CustomerDogSearchFields
            customers={options?.customers ?? []}
            dogs={dogs}
            customerIds={input.customerId ? [input.customerId] : []}
            dogIds={input.sharedDogIds ?? (input.dogId ? [input.dogId] : [])}
            dogMultiple={shared}
            disabled={Boolean(reservation)}
            recentScope="daycare-reservation"
            onDogIdsChange={(dogIds) => {
              if (shared && dogIds.length > 2) return setError("함께 데이케어는 두 마리까지 선택할 수 있습니다.");
              const dogId = (shared ? dogIds[0] : dogIds.at(-1)) ?? "";
              setError("");
              const customerId = options?.dogs.find((dog) => dog.id === dogId)?.customerId ?? "";
              patch({ dogId, ...(shared ? { sharedDogIds: dogIds } : {}), customerId: dogId ? customerId : input.customerId });
            }}
            onCustomerIdsChange={(customerIds) => {
              const customerId = customerIds.at(-1) ?? "";
              const selectedDog = options?.dogs.find((dog) => dog.id === input.dogId);
              patch({
                customerId,
                dogId: selectedDog?.customerId === customerId ? input.dogId : "",
                ...(shared ? { sharedDogIds: selectedDog?.customerId === customerId ? input.sharedDogIds : [] } : {}),
              });
            }}
          />
          </div>
        </FormSection>
        <FormSection title="이용 정보">
          <div className="grid gap-4 sm:grid-cols-2">
          <Field label="데이케어 날짜" required>
            <Input aria-label="데이케어 날짜" type="date" value={input.serviceDate} onChange={(event) => patch({ serviceDate: event.target.value })} />
          </Field>
          <div className="hidden sm:block" aria-hidden="true" />
          <Field label="입실 시간" required>
            <Input aria-label="입실 시간" type="time" value={input.checkInTime} onChange={(event) => patch({ checkInTime: event.target.value })} />
          </Field>
          <Field label="퇴실 시간" required>
            <Input aria-label="퇴실 시간" type="time" value={input.checkOutTime} onChange={(event) => patch({ checkOutTime: event.target.value })} />
          </Field>
          <Field label="객실 유형" required>
            <Select aria-label="객실 유형" disabled={shared} value={input.roomTypeId} onChange={(event) => patch({ roomTypeId: event.target.value, roomId: null })}>
              <option value="">객실 유형 선택</option>
              {snapshot?.roomTypes.map((roomType) => <option key={roomType.id} value={roomType.id}>{roomType.name}</option>)}
            </Select>
          </Field>
          </div>
        </FormSection>
        <FormSection title="운영 정보" description="호실은 예약 후 Hotel Operations에서도 배정할 수 있습니다.">
          <div className="grid gap-4 sm:grid-cols-2">
          <Field label="호실 (선택)">
            <Select aria-label="호실 (선택)" value={input.roomId ?? ""} onChange={(event) => patch({ roomId: event.target.value || null })}>
              <option value="">나중에 배정</option>
              {rooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}
            </Select>
          </Field>
          <Field label="담당자" required>
            <Select aria-label="담당자" value={input.assigneeIds[0] ?? ""} onChange={(event) => patch({ assigneeIds: event.target.value ? [event.target.value] : [] })}>
              <option value="">담당자 선택</option>
              {options?.assignees.map((assignee) => <option key={assignee.id} value={assignee.id}>{assignee.name ?? "이름 미등록"}</option>)}
            </Select>
          </Field>
          </div>
        </FormSection>
        <FormSection title="메모"><Field label="메모"><Textarea value={input.memo} onChange={(event) => patch({ memo: event.target.value })} /></Field></FormSection>
        {error ? <FormAlert>{error}</FormAlert> : null}
        <ModalActions>
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>취소</Button>
          <Button type="submit" disabled={loading || saving}><Check size={16} />{saving ? "저장 중…" : "예약 저장"}</Button>
        </ModalActions>
      </form>
  );
}

export function DaycareReservationModal({
  open,
  onClose,
  onSaved,
  prefill,
  reservation = null,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (reservation: DaycareReservation) => void | Promise<void>;
  prefill?: DaycareReservationPrefill;
  reservation?: DaycareReservation | null;
}) {
  return (
    <Modal open={open} title={reservation ? "데이케어 예약 수정" : "데이케어 예약"} description={reservation ? daycareDogNames(reservation) : "보호자와 반려견을 선택해 주세요."} onClose={onClose} size="large" resetKey={reservation?.operationScheduleId ?? `${prefill?.customerId ?? "new"}:${prefill?.dogId ?? ""}`}>
      <DaycareReservationForm
        prefill={prefill}
        reservation={reservation}
        onClose={onClose}
        onSaved={onSaved}
      />
    </Modal>
  );
}
