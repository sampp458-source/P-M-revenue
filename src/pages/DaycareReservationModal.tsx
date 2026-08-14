import { useEffect, useMemo, useState, type FormEvent } from "react";
import { CalendarDays, Check, DoorOpen } from "lucide-react";
import { CustomerDogSearchFields } from "../components/CustomerDogSearchFields";
import { Button, Field, Input, Modal, Select, Textarea } from "../components/ui";
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
) {
  if (!input.customerId || !input.dogId) return "보호자와 반려견을 선택해 주세요.";
  const selectedDog = dogs.find((dog) => dog.id === input.dogId);
  if (selectedDog?.customerId && selectedDog.customerId !== input.customerId) {
    return "선택한 보호자와 반려견 정보가 일치하지 않습니다.";
  }
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
  const prefillCustomerId = prefill?.customerId;
  const prefillDogId = prefill?.dogId;
  const prefillServiceDate = prefill?.serviceDate;

  useEffect(() => {
    setInput(reservation ? inputFromReservation(reservation) : initialInput({
      customerId: prefillCustomerId,
      dogId: prefillDogId,
      serviceDate: prefillServiceDate,
    }));
    setError("");
    setLoading(true);
    Promise.all([
      fetchOperationScheduleOptions(),
      fetchHotelOperationsSnapshot(prefillServiceDate ?? seoulDateKey()),
    ])
      .then(([nextOptions, nextSnapshot]) => {
        setOptions(nextOptions);
        setSnapshot(nextSnapshot);
        if (reservation) return;
        const calendar = nextOptions.calendars.find((item) => item.businessUnitCode === "daycare");
        const scheduleType = nextOptions.scheduleTypes.find((item) => item.calendarIds?.includes(calendar?.id ?? ""));
        setInput((current) => ({
          ...current,
          customerId:
            nextOptions.dogs.find((dog) => dog.id === current.dogId)?.customerId ??
            current.customerId,
          calendarId: calendar?.id ?? "",
          scheduleTypeId: scheduleType?.id ?? "",
          roomTypeId: nextSnapshot.roomTypes[0]?.id ?? "",
          assigneeIds: current.assigneeIds.length ? current.assigneeIds : nextOptions.assignees[0]?.id ? [nextOptions.assignees[0].id] : [],
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
  const patch = (change: Partial<DaycareReservationInput>) => setInput((current) => ({ ...current, ...change }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const validation = validateDaycareReservationInput(input, options?.dogs ?? []);
    if (validation) return setError(validation);
    setSaving(true);
    setError("");
    try {
      const saved = reservation
        ? await updateDaycareReservation(reservation.operationScheduleId, reservation.version, input)
        : await createDaycareReservation(input);
      await onSaved(saved);
      onClose();
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "Daycare 예약을 저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  };

  return (
      <form className="space-y-5" aria-label="데이케어 예약 양식" onSubmit={submit}>
        <div className="rounded-2xl border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm text-cyan-950">
          <strong className="flex items-center gap-2"><CalendarDays size={17} /> 같은 날짜 안에서 객실 Capacity를 확보합니다.</strong>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <CustomerDogSearchFields
            customers={options?.customers ?? []}
            dogs={dogs}
            customerIds={input.customerId ? [input.customerId] : []}
            dogIds={input.dogId ? [input.dogId] : []}
            disabled={Boolean(reservation)}
            recentScope="daycare-reservation"
            onDogIdsChange={(dogIds) => {
              const dogId = dogIds.at(-1) ?? "";
              const customerId = options?.dogs.find((dog) => dog.id === dogId)?.customerId ?? "";
              patch({ dogId, customerId: dogId ? customerId : input.customerId });
            }}
            onCustomerIdsChange={(customerIds) => {
              const customerId = customerIds.at(-1) ?? "";
              const selectedDog = options?.dogs.find((dog) => dog.id === input.dogId);
              patch({
                customerId,
                dogId: selectedDog?.customerId === customerId ? input.dogId : "",
              });
            }}
          />
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
            <Select aria-label="객실 유형" value={input.roomTypeId} onChange={(event) => patch({ roomTypeId: event.target.value, roomId: null })}>
              <option value="">객실 유형 선택</option>
              {snapshot?.roomTypes.map((roomType) => <option key={roomType.id} value={roomType.id}>{roomType.name}</option>)}
            </Select>
          </Field>
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
          <div className="sm:col-span-2"><Field label="메모"><Textarea value={input.memo} onChange={(event) => patch({ memo: event.target.value })} /></Field></div>
        </div>
        {error ? <p role="alert" className="rounded-xl bg-error-soft px-3 py-2 text-sm font-medium text-error">{error}</p> : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>취소</Button>
          <Button type="submit" disabled={loading || saving}><Check size={16} />{saving ? "저장 중…" : "예약 저장"}</Button>
        </div>
        <p className="flex items-center gap-1.5 text-xs text-text-muted"><DoorOpen size={14} /> 호실은 예약 후 Hotel Operations에서도 배정할 수 있습니다.</p>
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
    <Modal open={open} title={reservation ? "데이케어 예약 수정" : "데이케어 예약"} onClose={onClose} wide resetKey={reservation?.operationScheduleId ?? `${prefill?.customerId ?? "new"}:${prefill?.dogId ?? ""}`}>
      <DaycareReservationForm
        prefill={prefill}
        reservation={reservation}
        onClose={onClose}
        onSaved={onSaved}
      />
    </Modal>
  );
}
