import { useEffect, useMemo, useState, type ReactNode } from "react";
import { SearchSelect } from "../components/SearchSelect";
import { Button, Field, Input, Modal } from "../components/ui";
import { toSeoulInstant } from "./operationsScheduleRepository";
import type {
  HotelOperationSettingsSnapshot,
  HotelOperationsSnapshot,
  HotelRoomSnapshot,
  HotelStay,
} from "./hotelOperationsRepository";
import { seoulInputParts } from "./hotelOperationsUi";

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
        <div className="flex justify-end gap-2">
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
        </div>
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
          <Input
            type="datetime-local"
            required
            value={completedAt}
            onChange={(event) => setCompletedAt(event.target.value)}
          />
        </Field>
        <div className="flex justify-end gap-2">
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
        </div>
      </form>
    </Modal>
  );
}

type CompletionModalProps = Omit<
  Parameters<typeof CompletionModal>[0],
  "title" | "label"
>;

export function CheckInModal(props: CompletionModalProps) {
  return <CompletionModal {...props} title="입실 완료" label="입실 완료" />;
}

export function CheckOutModal(props: CompletionModalProps) {
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
        <div className="flex justify-end gap-2">
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
        </div>
      </form>
    </Modal>
  );
}
