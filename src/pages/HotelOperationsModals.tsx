import { useEffect, useMemo, useState, type ReactNode } from "react";
import { SearchSelect } from "../components/SearchSelect";
import { Button, Field, Input, Modal, ModalActions, Select } from "../components/ui";
import { toSeoulInstant } from "./operationsScheduleRepository";
import type {
  HotelOperationSettingsSnapshot,
  HotelOperationsSnapshot,
  HotelRoomSnapshot,
  HotelStay,
} from "./hotelOperationsRepository";
import {
  activeHotelAllocation,
  formatHotelScheduleTime,
  hotelStayScheduleEvent,
  hotelStayUnspecifiedState,
  seoulInputParts,
} from "./hotelOperationsUi";

function SingleRoomSearch({
  rooms,
  selectedId,
  onChange,
}: {
  rooms: HotelRoomSnapshot[];
  selectedId: string;
  onChange: (id: string) => void;
}) {
  return (
    <SearchSelect
      label="호실"
      items={rooms}
      selectedIds={selectedId ? [selectedId] : []}
      onChange={(ids) => onChange(ids[0] ?? "")}
      getItemId={(room) => room.id}
      getSearchText={(room) => `${room.roomTypeName} ${room.name}`}
      renderOption={(room) => (
        <span>
          <b>{room.name}</b> · {room.roomTypeName}
        </span>
      )}
      renderSelected={(room) => (
        <span>
          <b>{room.name}</b> · {room.roomTypeName}
        </span>
      )}
      placeholder="직접 호실 선택"
      multiple={false}
      required
      showAllOnEmpty
      noResultsMessage="선택 가능한 호실이 없습니다."
    />
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
  includeOtherRoomTypes = false,
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
  includeOtherRoomTypes?: boolean;
  children?: ReactNode;
}) {
  const [roomId, setRoomId] = useState("");
  const [reason, setReason] = useState("");
  const roomTypeId = stay.capacityReservation?.roomTypeId ?? "";
  const rooms = useMemo(
    () =>
      snapshot.rooms.filter(
        (room) =>
          room.isActive &&
          (includeOtherRoomTypes || room.roomTypeId === roomTypeId),
      ),
    [includeOtherRoomTypes, roomTypeId, snapshot.rooms],
  );

  useEffect(() => {
    if (!open) return;
    setRoomId("");
    setReason("");
  }, [open]);

  return (
    <Modal open={open} title={title} description={`${stay.dogName} · ${activeHotelAllocation(stay)?.roomName ?? "호실 미배정"}`} onClose={onClose} resetKey={stay.id} size="medium">
      <form
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (roomId) onSubmit(roomId, reason.trim());
        }}
      >
        <SingleRoomSearch
          rooms={rooms}
          selectedId={roomId}
          onChange={setRoomId}
        />
        {children}
        <Field label="처리 사유">
          <Input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="선택 사항"
          />
        </Field>
        <ModalActions>
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={processing}
          >
            닫기
          </Button>
          <Button disabled={processing || !roomId}>
            {processing ? "처리 중..." : submitLabel}
          </Button>
        </ModalActions>
      </form>
    </Modal>
  );
}

type RoomModalProps = Omit<
  Parameters<typeof RoomSelectModal>[0],
  "title" | "submitLabel"
>;

export function RoomAssignModal(props: RoomModalProps) {
  return (
    <RoomSelectModal {...props} title="호실 배정" submitLabel="호실 배정" />
  );
}

export function RoomReassignModal(props: RoomModalProps) {
  return (
    <RoomSelectModal
      {...props}
      title="입실 전 호실 재배정"
      submitLabel="재배정"
    />
  );
}

export function MoveRoomModal({
  open,
  snapshot,
  stay,
  processing,
  onClose,
  onSubmit,
  includeOtherRoomTypes = false,
}: {
  open: boolean;
  snapshot: HotelOperationsSnapshot;
  stay: HotelStay;
  processing: boolean;
  onClose: () => void;
  onSubmit: (roomId: string, moveAt: string, reason: string) => void;
  includeOtherRoomTypes?: boolean;
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
      includeOtherRoomTypes={includeOtherRoomTypes}
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
    <Modal open={open} title={title} description={`${stay.dogName} · ${activeHotelAllocation(stay)?.roomName ?? "호실 미배정"}`} onClose={onClose} resetKey={stay.id} size="small">
      <form
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          const [date, time] = completedAt.split("T");
          if (date && time) onSubmit(toSeoulInstant(date, time));
        }}
      >
        <Field label="처리 시각" required>
          <Input
            type="datetime-local"
            required
            value={completedAt}
            onChange={(event) => setCompletedAt(event.target.value)}
          />
        </Field>
        <ModalActions>
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={processing}
          >
            닫기
          </Button>
          <Button disabled={processing || !completedAt}>
            {processing ? "처리 중..." : label}
          </Button>
        </ModalActions>
      </form>
    </Modal>
  );
}

type CompletionModalProps = Omit<
  Parameters<typeof CompletionModal>[0],
  "title" | "label"
>;

export function CheckInModal({
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
  onSubmit: (completedAt: string, roomTypeId: string, roomId: string) => void;
}) {
  const [completedAt, setCompletedAt] = useState("");
  const [roomTypeId, setRoomTypeId] = useState("");
  const [roomId, setRoomId] = useState("");
  const unspecified = hotelStayUnspecifiedState(stay);
  const currentAllocation = activeHotelAllocation(stay);
  const rooms = useMemo(
    () => snapshot.rooms.filter(
      (room) => room.isActive && room.roomTypeId === roomTypeId,
    ),
    [roomTypeId, snapshot.rooms],
  );

  useEffect(() => {
    if (!open) return;
    const now = seoulInputParts(new Date().toISOString());
    setCompletedAt(`${now.date}T${now.time}`);
    setRoomTypeId(stay.capacityReservation?.roomTypeId ?? "");
    setRoomId(currentAllocation?.roomId ?? "");
  }, [currentAllocation?.roomId, open, stay.capacityReservation?.roomTypeId]);

  return (
    <Modal open={open} title="입실 확정 및 완료" description={`${stay.dogName} · ${activeHotelAllocation(stay)?.roomName ?? "호실 미배정"}`} onClose={onClose} resetKey={stay.id} size="medium">
      <form
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          const [date, time] = completedAt.split("T");
          if (date && time && roomTypeId && roomId) {
            onSubmit(toSeoulInstant(date, time), roomTypeId, roomId);
          }
        }}
      >
        {(unspecified.checkInTime || unspecified.roomType || !currentAllocation) ? (
          <p className="rounded-xl bg-warning-soft px-3.5 py-3 text-sm text-warning">
            미정 항목을 확정하고 Capacity를 재검증한 후 입실 완료합니다.
          </p>
        ) : null}
        <Field label="입실 시각" required>
          <Input type="datetime-local" required value={completedAt} onChange={(event) => setCompletedAt(event.target.value)} />
        </Field>
        <Field label="객실 유형" required>
          <Select
            required
            value={roomTypeId}
            onChange={(event) => {
              setRoomTypeId(event.target.value);
              setRoomId("");
            }}
          >
            <option value="">객실 유형 선택</option>
            {snapshot.roomTypes.map((roomType) => (
              <option key={roomType.id} value={roomType.id}>{roomType.name}</option>
            ))}
          </Select>
        </Field>
        <SingleRoomSearch rooms={rooms} selectedId={roomId} onChange={setRoomId} />
        <p className="text-xs leading-relaxed text-text-secondary">
          활성 호실과 선택한 객실 유형을 기준으로 표시합니다. 전체 예약 기간의
          최종 충돌 여부는 입실 완료 시 다시 확인합니다.
        </p>
        <ModalActions>
          <Button type="button" variant="secondary" onClick={onClose} disabled={processing}>닫기</Button>
          <Button disabled={processing || !completedAt || !roomTypeId || !roomId}>
            {processing ? "처리 중..." : "입실 완료"}
          </Button>
        </ModalActions>
      </form>
    </Modal>
  );
}

export function CompleteCheckInModal(props: CompletionModalProps) {
  return <CompletionModal {...props} title="입실 완료" label="입실 완료" />;
}

export function CheckOutModal(props: CompletionModalProps) {
  return <CompletionModal {...props} title="퇴실 완료" label="퇴실 완료" />;
}

export function PlannedCheckoutChangeModal({
  open,
  stay,
  processing,
  onClose,
  onSubmit,
}: {
  open: boolean;
  stay: HotelStay;
  processing: boolean;
  onClose: () => void;
  onSubmit: (
    checkOutDate: string,
    checkOutTime: string | null,
    checkOutTimeUnspecified: boolean,
  ) => void;
}) {
  const [checkOutDate, setCheckOutDate] = useState("");
  const [checkOutTime, setCheckOutTime] = useState("");
  const [timeUnspecified, setTimeUnspecified] = useState(false);

  useEffect(() => {
    if (!open) return;
    const event = hotelStayScheduleEvent(stay, "check_out");
    const parts = event
      ? seoulInputParts(event.startsAt)
      : { date: "", time: "" };
    setCheckOutDate(parts.date);
    setCheckOutTime(event?.timeUnspecified ? "" : parts.time);
    setTimeUnspecified(Boolean(event?.timeUnspecified));
  }, [open, stay]);

  return (
    <Modal open={open} title="퇴실 예정 변경" description={`${stay.dogName} · ${activeHotelAllocation(stay)?.roomName ?? "호실 미배정"}`} onClose={onClose} resetKey={stay.id} size="medium">
      <form
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (!checkOutDate || (!timeUnspecified && !checkOutTime)) return;
          onSubmit(
            checkOutDate,
            timeUnspecified ? null : checkOutTime,
            timeUnspecified,
          );
        }}
      >
        <div className="rounded-2xl border border-border bg-surface-secondary p-4">
          <span className="text-xs text-text-secondary">현재 퇴실 예정</span>
          <b className="mt-1 block text-sm text-text-primary">
            {formatHotelScheduleTime(stay, "check_out")}
          </b>
        </div>
        <Field label="새 퇴실일" required>
          <Input
            type="date"
            required
            value={checkOutDate}
            onChange={(event) => setCheckOutDate(event.target.value)}
          />
        </Field>
        <Field label="새 퇴실 시간" required={!timeUnspecified}>
          <Input
            type="time"
            required={!timeUnspecified}
            disabled={timeUnspecified}
            value={checkOutTime}
            onChange={(event) => setCheckOutTime(event.target.value)}
          />
        </Field>
        <label className="flex min-h-11 items-center gap-3 rounded-xl border border-border px-3.5 text-sm font-medium text-text-primary">
          <input
            type="checkbox"
            checked={timeUnspecified}
            onChange={(event) => setTimeUnspecified(event.target.checked)}
          />
          퇴실 시간 미정
        </label>
        <p className="text-xs leading-relaxed text-text-secondary">
          연장 시 같은 호실의 다음 예약과 전체 Capacity를 다시 확인합니다.
        </p>
        <ModalActions>
          <Button type="button" variant="secondary" onClick={onClose} disabled={processing}>
            닫기
          </Button>
          <Button disabled={processing || !checkOutDate || (!timeUnspecified && !checkOutTime)}>
            {processing ? "처리 중..." : "퇴실 예정 변경"}
          </Button>
        </ModalActions>
      </form>
    </Modal>
  );
}

export function canChangeCheckedInHotelPlannedCheckout(stay: HotelStay) {
  return Boolean(
    stay.checkedInAt &&
      !stay.checkedOutAt &&
      stay.capacityReservation?.reservedUntil !== "infinity",
  );
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
  const [checkIn, setCheckIn] = useState(
    settings.defaultCheckInTime.slice(0, 5),
  );
  const [checkOut, setCheckOut] = useState(
    settings.defaultCheckOutTime.slice(0, 5),
  );

  useEffect(() => {
    if (!open) return;
    setCheckIn(settings.defaultCheckInTime.slice(0, 5));
    setCheckOut(settings.defaultCheckOutTime.slice(0, 5));
  }, [open, settings]);

  return (
    <Modal open={open} title="호텔 운영 기본 시간" onClose={onClose}>
      <form
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(checkIn, checkOut);
        }}
      >
        <Field label="기본 입실 시간" required>
          <Input
            type="time"
            required
            value={checkIn}
            onChange={(event) => setCheckIn(event.target.value)}
          />
        </Field>
        <Field label="기본 퇴실 시간" required>
          <Input
            type="time"
            required
            value={checkOut}
            onChange={(event) => setCheckOut(event.target.value)}
          />
        </Field>
        <p className="text-xs text-text-secondary">
          시간대: {settings.timezone}
        </p>
        <ModalActions>
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={processing}
          >
            닫기
          </Button>
          <Button disabled={processing}>
            {processing ? "저장 중..." : "설정 저장"}
          </Button>
        </ModalActions>
      </form>
    </Modal>
  );
}
