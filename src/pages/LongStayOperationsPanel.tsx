import {
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  DoorOpen,
  Home,
  LogIn,
  LogOut,
  RotateCcw,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  LoadingState,
  Modal,
  ModalActions,
  Select,
  Textarea,
  Toast,
} from "../components/ui";
import { koDate, monthLabel } from "../lib/format";
import {
  completeLongStayAbsence,
  completeLongStayCheckIn,
  completeLongStayCheckOut,
  confirmLongStayMonth,
  getLongStayHotelVersion,
  getLongStayContract,
  getLongStayMonth,
  getLongStayRoomAvailability,
  getLongStayReturnRoomAvailability,
  LongStayRepositoryError,
  newLongStayRequestId,
  reverseLongStayCompletion,
  releaseLongStayRoomDuringAbsence,
  setLongStayAbsenceExpectedReturn,
  setLongStayPlannedCheckout,
  startLongStayAbsence,
} from "../platform/longStayHotelRepository";
import type {
  LongStayContractProjection,
  LongStayMonthContractProjection,
  LongStayRoomAvailability,
} from "../platform/longStayHotelContract";
import type { HotelOperationsSnapshot } from "./hotelOperationsRepository";
import type {
  OperationRole,
  OperationScheduleOptions,
} from "./operationsScheduleRepository";
import { hotelScheduleTypeForCalendar } from "./OperationsToday";

type ActionKind =
  | "confirm"
  | "checkin"
  | "leave"
  | "return"
  | "release_room"
  | "expected_return"
  | "planned_checkout"
  | "checkout"
  | "reverse";

interface ActionState {
  kind: ActionKind;
  contract: LongStayMonthContractProjection;
  requestId: string;
}

const monthStart = (value: Date) =>
  `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-01`;
const shiftMonth = (value: string, delta: number) => {
  const [year, month] = value.split("-").map(Number);
  return monthStart(new Date(year, month - 1 + delta, 1));
};

const monthEnd = (serviceMonth: string) => {
  const [year, month] = serviceMonth.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
};

export const firstPhysicalStartDateDefault = (
  selectedBusinessDate: string,
  serviceMonth: string,
  contractStartedOn: string,
) => {
  const serviceMonthEnd = monthEnd(serviceMonth);
  const businessDateIsInMonth = selectedBusinessDate >= serviceMonth
    && selectedBusinessDate <= serviceMonthEnd;
  const candidate = businessDateIsInMonth ? selectedBusinessDate : serviceMonth;
  return candidate < contractStartedOn ? contractStartedOn : candidate;
};

export const isServiceMonthBeforeLongStayStart = (
  serviceMonth: string,
  startedOn: string,
) => {
  const [year, month] = serviceMonth.split("-").map(Number);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextMonthStart = `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`;
  return nextMonthStart <= startedOn;
};

const nowLocalInput = () => {
  const value = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString();
  return value.slice(0, 16);
};
const kstIso = (value: string) => new Date(`${value}:00+09:00`).toISOString();
const kstDateKey = (value: string) =>
  new Date(value).toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
const shortDate = (value: string) => {
  const [, month, day] = value.split("-").map(Number);
  return `${month}/${day}`;
};
const expectedReturnLabel = (
  absence: NonNullable<LongStayContractProjection["currentAbsence"]>,
) => {
  if (!absence.expectedReturnDate) return "미정";
  if (absence.expectedReturnTimeUnspecified) {
    return `${shortDate(absence.expectedReturnDate)} · 시간 미정`;
  }
  if (!absence.expectedReturnAt) return shortDate(absence.expectedReturnDate);
  const time = new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Seoul",
  }).format(new Date(absence.expectedReturnAt));
  return `${shortDate(absence.expectedReturnDate)} ${time}`;
};

const conflictSourceLabel: Partial<Record<
  NonNullable<LongStayRoomAvailability["conflictSource"]>,
  string
>> = {
  hotel: "일반 호텔 예약",
  shared_room: "같은 방 투숙",
  long_stay: "장기호텔",
};

export const roomAvailabilityLabel = (room: LongStayRoomAvailability) => {
  if (room.assignable) return "사용 가능";
  const sourceLabel = room.conflictSource ? conflictSourceLabel[room.conflictSource] : null;
  let reason: string;
  if (room.conflictPhase === "future" && room.nextConflictFrom) {
    reason = `${koDate(kstDateKey(room.nextConflictFrom))}부터 예약 있음`;
  } else if (room.conflictPhase === "effective_start_overlap") {
    reason = "객실 사용 시작 시점에 사용 중";
  } else if (room.conflictPhase === "effective_period_history") {
    reason = "배정 대상 기간의 종료 이력과 겹침";
  } else {
    reason = room.reason || "사용 불가";
  }
  return sourceLabel ? `${reason} · ${sourceLabel}` : reason;
};

const statusPresentation = (contract: LongStayMonthContractProjection) => {
  if (contract.derivedStatus === "overstay") return { label: "초과체류", tone: "red" as const };
  if (contract.storedStatus === "completed") return { label: "완료", tone: "gray" as const };
  if (contract.isAway) return { label: "외출 중", tone: "amber" as const };
  if (contract.checkedInAt) return { label: "이용중", tone: "green" as const };
  if (contract.monthlyState === "unassigned") return { label: "미배정", tone: "amber" as const };
  return { label: "입실 예정", tone: "blue" as const };
};

const actionTitle: Record<ActionKind, string> = {
  confirm: "이번 달 객실 배정",
  checkin: "장기호텔 입실",
  leave: "외출 기록",
  return: "복귀 처리",
  release_room: "객실 임시 해제",
  expected_return: "복귀 예정 변경",
  planned_checkout: "퇴실 예정 등록·수정",
  checkout: "실제 퇴실",
  reverse: "퇴실 완료 취소",
};

export function LongStayOperationsPanel({
  snapshot,
  options,
  operationRole,
  selectedBusinessDate = snapshot.date,
  onHotelSnapshotRefresh,
}: {
  snapshot: HotelOperationsSnapshot;
  options: OperationScheduleOptions;
  operationRole: OperationRole | null;
  selectedBusinessDate?: string;
  onHotelSnapshotRefresh: () => Promise<unknown>;
}) {
  const [serviceMonth, setServiceMonth] = useState(() => monthStart(new Date()));
  const [contracts, setContracts] = useState<LongStayMonthContractProjection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [action, setAction] = useState<ActionState | null>(null);
  const [processing, setProcessing] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" } | null>(null);
  const [roomId, setRoomId] = useState("");
  const [occurredAt, setOccurredAt] = useState(nowLocalInput);
  const [expectedReturnDate, setExpectedReturnDate] = useState("");
  const [expectedReturnTime, setExpectedReturnTime] = useState("");
  const [expectedReturnDateUnknown, setExpectedReturnDateUnknown] = useState(true);
  const [expectedReturnTimeUnknown, setExpectedReturnTimeUnknown] = useState(true);
  const [inventoryMode, setInventoryMode] = useState<"keep_room" | "release_room">("keep_room");
  const [plannedDate, setPlannedDate] = useState("");
  const [timeUnspecified, setTimeUnspecified] = useState(false);
  const [physicalStartDate, setPhysicalStartDate] = useState("");
  const [physicalStartTime, setPhysicalStartTime] = useState("");
  const [memo, setMemo] = useState("");
  const [reason, setReason] = useState("");
  const [roomAvailability, setRoomAvailability] = useState<LongStayRoomAvailability[]>([]);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [availabilityError, setAvailabilityError] = useState("");
  const [returnRoomAvailability, setReturnRoomAvailability] = useState<Array<{
    roomId: string;
    roomName: string;
    roomTypeId: string;
    isPreviousRoom: boolean;
    available: boolean;
  }>>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await getLongStayMonth(serviceMonth);
      setContracts(result.contracts);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "장기호텔 월 현황을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [serviceMonth]);

  useEffect(() => void load(), [load]);

  const hotelCalendar = options.calendars.find((calendar) => calendar.businessUnitCode === "hotel") ?? null;
  const hotelScheduleType = hotelCalendar
    ? hotelScheduleTypeForCalendar(hotelCalendar.id, options)
    : null;
  const availableRooms = useMemo(
    () => snapshot.rooms.filter((room) => room.isActive).sort((a, b) => a.sortOrder - b.sortOrder),
    [snapshot.rooms],
  );
  const selectedRoom = availableRooms.find((room) => room.id === roomId) ?? null;
  const selectableRooms = useMemo(
    () => action && operationRole === "staff" && action.contract.currentRoom
      ? availableRooms.filter((room) => room.roomTypeId === action.contract.currentRoom?.roomTypeId)
      : availableRooms,
    [action, availableRooms, operationRole],
  );
  const availabilityByRoom = useMemo(
    () => new Map(roomAvailability.map((room) => [room.roomId, room])),
    [roomAvailability],
  );
  const selectableAvailability = selectableRooms.map((room) => ({
    room,
    availability: availabilityByRoom.get(room.id) ?? null,
  }));
  const availableRoomCount = selectableAvailability.filter(
    ({ availability }) => availability?.assignable,
  ).length;
  const selectedAvailability = availabilityByRoom.get(roomId) ?? null;

  const openAction = (kind: ActionKind, contract: LongStayMonthContractProjection) => {
    setToast(null);
    setAction({ kind, contract, requestId: newLongStayRequestId() });
    setRoomId(contract.currentRoom?.id ?? availableRooms[0]?.id ?? "");
    setOccurredAt(nowLocalInput());
    setExpectedReturnDate("");
    setExpectedReturnTime("");
    setExpectedReturnDateUnknown(true);
    setExpectedReturnTimeUnknown(true);
    setInventoryMode("keep_room");
    setPlannedDate(contract.plannedCheckOutDate ?? "");
    setTimeUnspecified(false);
    setPhysicalStartDate(kind === "confirm" && !contract.hotelStayId
      ? firstPhysicalStartDateDefault(selectedBusinessDate, serviceMonth, contract.startedOn)
      : "");
    setPhysicalStartTime(snapshot.settings?.defaultCheckInTime?.slice(0, 5) ?? "15:00");
    setMemo("");
    setReason("");
    setRoomAvailability([]);
    setAvailabilityError("");
    setReturnRoomAvailability([]);
  };

  useEffect(() => {
    if (!action || action.kind !== "return"
      || action.contract.currentAbsence?.inventoryMode !== "release_room") return;
    let cancelled = false;
    setAvailabilityLoading(true);
    setAvailabilityError("");
    void getLongStayReturnRoomAvailability(
      action.contract.id,
      kstIso(occurredAt),
    ).then((result) => {
      if (cancelled) return;
      setReturnRoomAvailability(result.rooms);
      setRoomId(
        result.rooms.find((room) => room.isPreviousRoom && room.available)?.roomId
        ?? result.rooms.find((room) => room.available)?.roomId
        ?? "",
      );
    }).catch((loadError) => {
      if (cancelled) return;
      setRoomId("");
      setAvailabilityError(loadError instanceof Error ? loadError.message : "복귀할 객실을 확인하지 못했습니다.");
    }).finally(() => {
      if (!cancelled) setAvailabilityLoading(false);
    });
    return () => { cancelled = true; };
  }, [action, occurredAt]);

  useEffect(() => {
    if (!action || action.kind !== "confirm") return;
    let cancelled = false;
    setAvailabilityLoading(true);
    setAvailabilityError("");
    setRoomAvailability([]);
    void getLongStayRoomAvailability({
      contractId: action.contract.id,
      serviceMonth,
      physicalStartDate: action.contract.hotelStayId ? null : physicalStartDate,
      checkInTime: timeUnspecified ? null : physicalStartTime,
      checkInTimeUnspecified: timeUnspecified,
    }).then((result) => {
      if (cancelled) return;
      setRoomAvailability(result.rooms);
      const allowedIds = new Set(selectableRooms.map((room) => room.id));
      setRoomId((currentRoomId) => {
        const current = result.rooms.find((room) => room.roomId === currentRoomId);
        return current?.assignable && allowedIds.has(current.roomId)
          ? currentRoomId
          : result.rooms.find((room) => room.assignable && allowedIds.has(room.roomId))?.roomId ?? "";
      });
    }).catch((loadError) => {
      if (cancelled) return;
      setRoomId("");
      setAvailabilityError(loadError instanceof Error ? loadError.message : "객실 가용성을 확인하지 못했습니다.");
    }).finally(() => {
      if (!cancelled) setAvailabilityLoading(false);
    });
    return () => { cancelled = true; };
  }, [action, physicalStartDate, physicalStartTime, selectableRooms, serviceMonth, timeUnspecified]);

  const finishMutation = async (result: LongStayContractProjection) => {
    await Promise.all([load(), onHotelSnapshotRefresh()]);
    setAction(null);
    setToast({
      message: result.replayed ? "이미 처리된 요청 결과를 불러왔습니다." : "장기호텔 상태를 반영했습니다.",
      tone: "success",
    });
  };

  const submit = async () => {
    if (!action || processing) return;
    setProcessing(true);
    try {
      const { contract, kind } = action;
      let result: LongStayContractProjection;
      if (kind === "confirm") {
        if (!selectedRoom || !hotelCalendar || !hotelScheduleType) throw new Error("호텔 일정 설정과 호실을 확인해 주세요.");
        result = await confirmLongStayMonth({
          contractId: contract.id,
          expectedContractVersion: contract.version,
          serviceMonth,
          physicalStartDate: contract.hotelStayId ? null : physicalStartDate,
          calendarId: hotelCalendar.id,
          scheduleTypeId: hotelScheduleType.id,
          checkInTime: timeUnspecified ? null : physicalStartTime,
          checkInTimeUnspecified: timeUnspecified,
          roomTypeId: selectedRoom.roomTypeId,
          roomId: selectedRoom.id,
          assigneeIds: options.assignees.slice(0, 1).map((person) => person.id),
          reason: reason || "장기호텔 월 객실 배정",
        }, action.requestId);
      } else if (kind === "checkin") {
        const stayVersion = await getLongStayHotelVersion(contract);
        if (stayVersion === null) throw new Error("먼저 이번 달 객실을 배정해 주세요.");
        result = await completeLongStayCheckIn({
          contractId: contract.id,
          expectedContractVersion: contract.version,
          expectedStayVersion: stayVersion,
          completedAt: kstIso(occurredAt),
          reason: reason || "장기호텔 입실 완료",
        }, action.requestId);
      } else if (kind === "leave") {
        result = await startLongStayAbsence({
          contractId: contract.id,
          expectedContractVersion: contract.version,
          leftAt: kstIso(occurredAt),
          expectedReturnDate: expectedReturnDateUnknown ? null : expectedReturnDate,
          expectedReturnTime: expectedReturnDateUnknown || expectedReturnTimeUnknown ? null : expectedReturnTime,
          expectedReturnTimeUnspecified: expectedReturnDateUnknown || expectedReturnTimeUnknown,
          inventoryMode,
          memo,
          reason: reason || "장기호텔 외출",
        }, action.requestId);
      } else if (kind === "return") {
        result = await completeLongStayAbsence({
          contractId: contract.id,
          expectedContractVersion: contract.version,
          returnedAt: kstIso(occurredAt),
          roomId: contract.currentAbsence?.inventoryMode === "release_room" ? roomId : null,
          memo,
          reason: reason || "장기호텔 복귀",
        }, action.requestId);
      } else if (kind === "release_room") {
        result = await releaseLongStayRoomDuringAbsence({
          contractId: contract.id,
          expectedContractVersion: contract.version,
          reason: reason || "외출 중 객실 임시 해제",
        }, action.requestId);
      } else if (kind === "expected_return") {
        result = await setLongStayAbsenceExpectedReturn({
          contractId: contract.id,
          expectedContractVersion: contract.version,
          expectedReturnDate,
          expectedReturnTime: expectedReturnTimeUnknown ? null : expectedReturnTime,
          expectedReturnTimeUnspecified: expectedReturnTimeUnknown,
          reason: reason || "장기호텔 복귀 예정 변경",
        }, action.requestId);
      } else if (kind === "planned_checkout") {
        if (!hotelCalendar || !hotelScheduleType) throw new Error("호텔 일정 설정을 확인해 주세요.");
        result = await setLongStayPlannedCheckout({
          contractId: contract.id,
          expectedContractVersion: contract.version,
          plannedCheckOutDate: plannedDate || null,
          calendarId: hotelCalendar.id,
          scheduleTypeId: hotelScheduleType.id,
          checkOutTime: timeUnspecified ? null : snapshot.settings?.defaultCheckOutTime ?? "11:00",
          timeUnspecified,
          assigneeIds: options.assignees.slice(0, 1).map((person) => person.id),
          reason: reason || "장기호텔 퇴실 예정 변경",
        }, action.requestId);
      } else if (kind === "checkout") {
        const stayVersion = await getLongStayHotelVersion(contract);
        if (stayVersion === null) throw new Error("연결된 호텔 이용 정보를 찾을 수 없습니다.");
        result = await completeLongStayCheckOut({
          contractId: contract.id,
          expectedContractVersion: contract.version,
          expectedStayVersion: stayVersion,
          completedAt: kstIso(occurredAt),
          reason: reason || "장기호텔 실제 퇴실",
        }, action.requestId);
      } else {
        const stayVersion = await getLongStayHotelVersion(contract);
        if (stayVersion === null) throw new Error("연결된 호텔 이용 정보를 찾을 수 없습니다.");
        result = await reverseLongStayCompletion({
          contractId: contract.id,
          expectedContractVersion: contract.version,
          expectedStayVersion: stayVersion,
          reason: reason || "장기호텔 퇴실 완료 취소",
        }, action.requestId);
      }
      await finishMutation(result);
    } catch (mutationError) {
      if (mutationError instanceof LongStayRepositoryError && mutationError.kind === "conflict") {
        await Promise.all([
          load(),
          getLongStayContract(action.contract.id),
          onHotelSnapshotRefresh(),
        ]);
        setAction(null);
      }
      setToast({
        message: mutationError instanceof Error ? mutationError.message : "장기호텔 요청을 처리하지 못했습니다.",
        tone: "error",
      });
    } finally {
      setProcessing(false);
    }
  };

  return (
    <Card className="mb-4 overflow-hidden">
      <div className="border-b border-border bg-[linear-gradient(135deg,#f7fafc,#eef5f2)] px-4 py-4 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Home size={19} className="text-primary" />
              <h2 className="font-bold text-text-primary">장기호텔 월 운영</h2>
            </div>
            <p className="mt-1 text-xs text-text-secondary">결제일과 분리하여 매월 실제 객실을 확정합니다.</p>
          </div>
          <div className="flex items-center gap-1 rounded-xl border border-border bg-surface p-1">
            <button type="button" aria-label="이전 달" className="flex h-10 w-10 items-center justify-center rounded-lg hover:bg-primary-soft" onClick={() => setServiceMonth((value) => shiftMonth(value, -1))}><ArrowLeft size={17} /></button>
            <strong className="min-w-28 text-center text-sm">{monthLabel(serviceMonth.slice(0, 7))}</strong>
            <button type="button" aria-label="다음 달" className="flex h-10 w-10 items-center justify-center rounded-lg hover:bg-primary-soft" onClick={() => setServiceMonth((value) => shiftMonth(value, 1))}><ArrowRight size={17} /></button>
          </div>
        </div>
      </div>

      <div className="p-4 sm:p-6">
        {loading ? <LoadingState /> : error ? (
          <div className="rounded-2xl bg-error-soft p-4 text-sm text-error">{error} <Button variant="ghost" onClick={() => void load()}>다시 시도</Button></div>
        ) : contracts.length === 0 ? (
          <EmptyState compact title="이 달에 운영할 장기호텔 계약이 없습니다." />
        ) : (
          <div className="grid gap-3 xl:grid-cols-2">
            {contracts.map((contract) => {
              const beforeContractStart = isServiceMonthBeforeLongStayStart(
                serviceMonth,
                contract.startedOn,
              );
              const status = beforeContractStart
                ? { label: "계약 시작 전", tone: "gray" as const }
                : statusPresentation(contract);
              return (
                <article key={contract.id} className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <strong className="truncate text-base text-text-primary">{contract.dogName || "이름 미등록"}</strong>
                        <Badge tone={status.tone}>{status.label}</Badge>
                        <Badge tone="blue">장기호텔</Badge>
                        {contract.currentAbsence?.inventoryMode === "release_room" ? <Badge tone="amber">객실 임시 해제</Badge> : null}
                      </div>
                      <p className="mt-1 text-sm text-text-secondary">{contract.customerName || "보호자 미등록"}</p>
                    </div>
                    <div className="text-right">
                      <b className="block text-sm text-text-primary">{contract.currentRoom?.name || "호실 미배정"}</b>
                      <span className="text-xs text-text-muted">이번 달 {contract.monthlyOccupancy ? "확정" : "미확정"}</span>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl bg-surface-secondary p-3 text-xs text-text-secondary">
                    <span>시작일 <b className="text-text-primary">{koDate(contract.startedOn)}</b></span>
                    <span>퇴실 예정 <b className="text-text-primary">{contract.plannedCheckOutDate ? koDate(contract.plannedCheckOutDate) : "미정"}</b></span>
                    <span>월 점유 <b className="text-text-primary">{contract.monthlyOccupancy ? `${koDate(contract.monthlyOccupancy.plannedOccupiedFrom.slice(0, 10))}부터` : "미배정"}</b></span>
                    <span>객실 유지 <b className="text-text-primary">{contract.isOpenEnded ? "실제 퇴실까지" : "종료"}</b></span>
                    {contract.isAway && contract.currentAbsence ? (
                      <>
                        <span className="col-span-2">복귀 예정 <b className="text-text-primary">{expectedReturnLabel(contract.currentAbsence)}</b></span>
                        {contract.currentAbsence.inventoryMode === "release_room" ? (
                          <>
                            <span>이전 객실 <b className="text-text-primary">{contract.currentAbsence.previousRoom?.name ?? "확인 필요"}</b></span>
                            <span>복귀 객실 <b className="text-text-primary">복귀 시 같은 유형 재배정</b></span>
                          </>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {!beforeContractStart && !contract.monthlyOccupancy && contract.storedStatus !== "completed" ? <Button onClick={() => openAction("confirm", contract)}><DoorOpen size={15} /> 객실 배정</Button> : null}
                    {contract.monthlyOccupancy && !contract.checkedInAt ? <Button onClick={() => openAction("checkin", contract)}><LogIn size={15} /> 입실</Button> : null}
                    {contract.checkedInAt && !contract.checkedOutAt && !contract.isAway ? <Button variant="secondary" onClick={() => openAction("leave", contract)}>외출</Button> : null}
                    {contract.isAway ? <Button onClick={() => openAction("return", contract)}>복귀 처리</Button> : null}
                    {contract.isAway
                      && contract.currentAbsence?.inventoryMode === "keep_room"
                      && contract.currentAbsence.inventoryTransitionStatus === "room_retained" ? (
                        <Button
                          variant="secondary"
                          disabled={!contract.currentAbsence.expectedReturnDate}
                          title={contract.currentAbsence.expectedReturnDate
                            ? undefined
                            : "객실을 임시 해제하려면 복귀 예정 날짜가 필요합니다."}
                          onClick={() => openAction("release_room", contract)}
                        >객실 임시 해제</Button>
                      ) : null}
                    {contract.currentAbsence?.inventoryMode === "release_room" ? <Button variant="secondary" onClick={() => {
                      openAction("expected_return", contract);
                      setExpectedReturnDate(contract.currentAbsence?.expectedReturnDate ?? "");
                      setExpectedReturnDateUnknown(false);
                      setExpectedReturnTimeUnknown(contract.currentAbsence?.expectedReturnTimeUnspecified ?? true);
                      setExpectedReturnTime(contract.currentAbsence?.expectedReturnAt
                        ? new Date(contract.currentAbsence.expectedReturnAt).toLocaleTimeString("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit" })
                        : "");
                    }}>복귀 예정 변경</Button> : null}
                    {contract.hotelStayId && !contract.checkedOutAt && (operationRole === "owner" || operationRole === "manager") ? <Button variant="secondary" onClick={() => openAction("planned_checkout", contract)}><CalendarClock size={15} /> 퇴실 예정</Button> : null}
                    {contract.checkedInAt && !contract.checkedOutAt && contract.currentAbsence?.inventoryMode !== "release_room" ? <Button variant="danger" onClick={() => openAction("checkout", contract)}><LogOut size={15} /> 실제 퇴실</Button> : null}
                    {contract.checkedOutAt && (operationRole === "owner" || operationRole === "manager") ? <Button variant="secondary" onClick={() => openAction("reverse", contract)}><RotateCcw size={15} /> 완료 취소</Button> : null}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      <Modal open={Boolean(action)} title={action ? actionTitle[action.kind] : "장기호텔 처리"} onClose={() => !processing && setAction(null)} resetKey={`${action?.kind ?? ""}-${action?.contract.id ?? ""}`} wide>
        {action ? (
          <div className="space-y-4">
            <div className="rounded-2xl bg-primary-subtle p-4"><b>{action.contract.dogName || "반려견"}</b><span className="ml-2 text-sm text-text-secondary">{action.contract.currentRoom?.name || "호실 미배정"}</span></div>
            {action.kind === "confirm" ? (
              <>
                {!action.contract.hotelStayId ? (
                  <Field label="객실 사용 시작" required>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Input
                        aria-label="객실 사용 시작 날짜"
                        type="date"
                        min={action.contract.startedOn > serviceMonth ? action.contract.startedOn : serviceMonth}
                        max={monthEnd(serviceMonth)}
                        value={physicalStartDate}
                        onChange={(event) => setPhysicalStartDate(event.target.value)}
                      />
                      <Input
                        aria-label="객실 사용 시작 시간"
                        type="time"
                        value={physicalStartTime}
                        disabled={timeUnspecified}
                        onChange={(event) => setPhysicalStartTime(event.target.value)}
                      />
                    </div>
                  </Field>
                ) : null}
                <Field label="이번 달 호실" required>
                  <Select value={roomId} disabled={availabilityLoading || Boolean(availabilityError)} onChange={(event) => setRoomId(event.target.value)}>
                    {availabilityLoading ? <option value="">객실 가용성 확인 중...</option> : null}
                    {!availabilityLoading && availableRoomCount === 0 ? <option value="">배정 가능한 객실 없음</option> : null}
                    {!availabilityLoading ? selectableAvailability.map(({ room, availability }) => (
                      <option key={room.id} value={room.id} disabled={!availability?.assignable}>
                        {room.roomTypeName} · {room.name} · {availability ? roomAvailabilityLabel(availability) : "확인 불가"}
                      </option>
                    )) : null}
                  </Select>
                </Field>
                {availabilityError ? <p role="alert" className="rounded-xl bg-error-soft p-3 text-sm text-error">{availabilityError}</p> : null}
                {!availabilityLoading && !availabilityError && availableRoomCount === 0 ? (
                  <p className="rounded-xl bg-warning-soft p-3 text-sm text-text-secondary">현재 계약 기간으로 장기호텔에 배정 가능한 객실이 없습니다. 미래 예약이 없는 다른 객실을 확인해 주세요.</p>
                ) : null}
                {!availabilityLoading && !availabilityError && selectedAvailability ? (
                  <p className="rounded-xl bg-surface-secondary p-3 text-xs text-text-secondary">
                    선택 객실: <b className="text-text-primary">{roomAvailabilityLabel(selectedAvailability)}</b>
                  </p>
                ) : null}
                {!action.contract.hotelStayId ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={timeUnspecified} onChange={(event) => setTimeUnspecified(event.target.checked)} /> 시간 미정</label> : null}
              </>
            ) : null}
            {["checkin", "leave", "return", "checkout"].includes(action.kind) ? <Field label={action.kind === "leave" ? "외출 시각" : action.kind === "return" ? "복귀 시각" : action.kind === "checkout" ? "실제 퇴실 시각" : "입실 시각"} required><Input type="datetime-local" value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} /></Field> : null}
            {action.kind === "leave" ? (
              <div className="space-y-3 rounded-2xl border border-border p-4">
                <strong className="text-sm text-text-primary">객실 처리</strong>
                <label className="flex items-start gap-2 text-sm"><input aria-label="객실 유지" type="radio" name="inventory-mode" checked={inventoryMode === "keep_room"} onChange={() => setInventoryMode("keep_room")} /><span><b>객실 유지</b><span className="block text-xs text-text-secondary">외출 중에도 현재 객실과 Capacity를 유지합니다.</span></span></label>
                <label className="flex items-start gap-2 text-sm"><input aria-label="객실 임시 해제" type="radio" name="inventory-mode" checked={inventoryMode === "release_room"} onChange={() => { setInventoryMode("release_room"); setExpectedReturnDateUnknown(false); }} /><span><b>객실 임시 해제</b><span className="block text-xs text-text-secondary">외출 기간에는 재판매할 수 있으며 복귀 시 같은 객실 유형으로 다시 배정합니다.</span></span></label>
                <strong className="text-sm text-text-primary">예상 복귀</strong>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Field label="날짜">
                    <Input
                      aria-label="예상 복귀 날짜"
                      type="date"
                      value={expectedReturnDate}
                      disabled={expectedReturnDateUnknown && inventoryMode === "keep_room"}
                      onChange={(event) => setExpectedReturnDate(event.target.value)}
                    />
                  </Field>
                  <Field label="시간">
                    <Input
                      aria-label="예상 복귀 시간"
                      type="time"
                      value={expectedReturnTime}
                      disabled={expectedReturnDateUnknown || expectedReturnTimeUnknown}
                      onChange={(event) => setExpectedReturnTime(event.target.value)}
                    />
                  </Field>
                </div>
                <div className="flex flex-wrap gap-4 text-sm text-text-secondary">
                  <label className="flex items-center gap-2"><input aria-label="예상 복귀 날짜 미정" type="checkbox" checked={expectedReturnDateUnknown} disabled={inventoryMode === "release_room"} onChange={(event) => {
                    setExpectedReturnDateUnknown(event.target.checked);
                    if (event.target.checked) {
                      setExpectedReturnDate("");
                      setExpectedReturnTime("");
                      setExpectedReturnTimeUnknown(true);
                    }
                  }} /> 날짜 미정</label>
                  <label className="flex items-center gap-2"><input aria-label="예상 복귀 시간 미정" type="checkbox" checked={expectedReturnTimeUnknown} disabled={expectedReturnDateUnknown} onChange={(event) => {
                    setExpectedReturnTimeUnknown(event.target.checked);
                    if (event.target.checked) setExpectedReturnTime("");
                  }} /> 시간 미정</label>
                </div>
                {inventoryMode === "release_room" && !expectedReturnDate ? <p role="alert" className="text-xs font-medium text-error">객실 임시 해제에는 예상 복귀 날짜가 필요합니다.</p> : null}
              </div>
            ) : null}
            {action.kind === "expected_return" ? (
              <div className="space-y-3 rounded-2xl border border-border p-4">
                <strong className="text-sm text-text-primary">새 복귀 예정</strong>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Field label="날짜" required><Input aria-label="새 예상 복귀 날짜" type="date" value={expectedReturnDate} onChange={(event) => setExpectedReturnDate(event.target.value)} /></Field>
                  <Field label="시간"><Input aria-label="새 예상 복귀 시간" type="time" value={expectedReturnTime} disabled={expectedReturnTimeUnknown} onChange={(event) => setExpectedReturnTime(event.target.value)} /></Field>
                </div>
                <label className="flex items-center gap-2 text-sm"><input aria-label="새 예상 복귀 시간 미정" type="checkbox" checked={expectedReturnTimeUnknown} onChange={(event) => { setExpectedReturnTimeUnknown(event.target.checked); if (event.target.checked) setExpectedReturnTime(""); }} /> 시간 미정</label>
              </div>
            ) : null}
            {action.kind === "release_room" ? (
              <div className="space-y-3 rounded-2xl border border-border p-4">
                <div className="grid gap-2 rounded-xl bg-surface-secondary p-3 text-sm text-text-secondary sm:grid-cols-2">
                  <span>현재 객실 <b className="text-text-primary">{action.contract.currentRoom?.name ?? "확인 필요"}</b></span>
                  <span>복귀 예정 <b className="text-text-primary">{action.contract.currentAbsence ? expectedReturnLabel(action.contract.currentAbsence) : "미정"}</b></span>
                </div>
                <p className="text-sm text-text-secondary">객실을 임시 해제하면 외출 기간 동안 다른 예약에 사용할 수 있습니다.</p>
                <p className="text-sm text-text-secondary">복귀 시 같은 객실 유형은 보장되지만 현재 객실이 아닌 다른 호실로 배정될 수 있습니다.</p>
                {action.contract.currentAbsence?.expectedReturnDate ? (
                  <p className="rounded-xl bg-primary-subtle p-3 text-sm text-text-secondary">
                    사용 가능 기간: 지금부터 <b className="text-text-primary">{expectedReturnLabel(action.contract.currentAbsence)}</b> 이전
                  </p>
                ) : (
                  <p role="alert" className="rounded-xl bg-error-soft p-3 text-sm text-error">객실을 임시 해제하려면 복귀 예정 날짜가 필요합니다.</p>
                )}
              </div>
            ) : null}
            {action.kind === "return" && action.contract.currentAbsence?.inventoryMode === "release_room" ? (
              <Field label="복귀 객실" required>
                <Select aria-label="복귀 객실" value={roomId} disabled={availabilityLoading || Boolean(availabilityError)} onChange={(event) => setRoomId(event.target.value)}>
                  {availabilityLoading ? <option value="">가용 객실 확인 중...</option> : null}
                  {!availabilityLoading && !returnRoomAvailability.some((room) => room.available) ? <option value="">복귀 가능한 객실 없음</option> : null}
                  {returnRoomAvailability.map((room) => <option key={room.roomId} value={room.roomId} disabled={!room.available}>{room.roomName}{room.isPreviousRoom ? " · 이전 객실" : ""}{room.available ? " · 사용 가능" : " · 사용 중"}</option>)}
                </Select>
              </Field>
            ) : null}
            {action.kind === "return" && availabilityError ? <p role="alert" className="rounded-xl bg-error-soft p-3 text-sm text-error">{availabilityError}</p> : null}
            {action.kind === "planned_checkout" ? <><Field label="퇴실 예정일"><Input type="date" value={plannedDate} onChange={(event) => setPlannedDate(event.target.value)} /></Field><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={timeUnspecified} onChange={(event) => setTimeUnspecified(event.target.checked)} /> 퇴실 시간 미정</label></> : null}
            {["leave", "return"].includes(action.kind) ? <Field label="메모"><Textarea value={memo} onChange={(event) => setMemo(event.target.value)} /></Field> : null}
            <Field label="처리 사유"><Input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="비워두면 기본 사유가 기록됩니다." /></Field>
            <ModalActions><Button variant="secondary" disabled={processing} onClick={() => setAction(null)}>취소</Button><Button disabled={processing || (action.kind === "confirm" && (!roomId || availabilityLoading || !selectedAvailability?.assignable || (!action.contract.hotelStayId && (!physicalStartDate || (!timeUnspecified && !physicalStartTime))))) || (action.kind === "leave" && ((inventoryMode === "release_room" && !expectedReturnDate) || (!expectedReturnDateUnknown && (!expectedReturnDate || (!expectedReturnTimeUnknown && !expectedReturnTime))))) || (action.kind === "return" && action.contract.currentAbsence?.inventoryMode === "release_room" && (!roomId || availabilityLoading || Boolean(availabilityError))) || (action.kind === "expected_return" && (!expectedReturnDate || (!expectedReturnTimeUnknown && !expectedReturnTime))) || (action.kind === "release_room" && !action.contract.currentAbsence?.expectedReturnDate)} onClick={() => void submit()}>{processing ? "처리 중..." : action.kind === "release_room" ? "객실 임시 해제" : "확인"}</Button></ModalActions>
          </div>
        ) : null}
      </Modal>
      {toast ? <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} /> : null}
    </Card>
  );
}
