import {
  BedDouble,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  DoorOpen,
  Hotel,
  MoveRight,
  RotateCcw,
  Settings,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import {
  Badge,
  Button,
  Card,
  ConfirmModal,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingState,
  Modal,
  PageHeader,
  Toast,
  cn,
} from "../components/ui";
import {
  CheckInModal,
  CheckOutModal,
  CompleteCheckInModal,
  MoveRoomModal,
  RoomAssignModal,
  RoomReassignModal,
  SettingsModal,
} from "./HotelOperationsModals";
import { HotelRoomBoard } from "./HotelRoomBoard";
import { LongStayOperationsPanel } from "./LongStayOperationsPanel";
import {
  assignHotelRoom,
  cancelHotelReservation,
  changeRoomTypeAfterCheckIn,
  changeRoomTypeBeforeCheckIn,
  completeHotelCheckIn,
  completeHotelCheckOut,
  finalizeAndCompleteHotelCheckIn,
  finalizeAndCompleteHotelCheckOut,
  fetchHotelOperationsSnapshot,
  fetchHotelStay,
  HotelOperationsRepositoryError,
  moveHotelRoomSameType,
  reassignHotelRoomBeforeCheckIn,
  unassignHotelRoomBeforeCheckIn,
  updateHotelOperationSettings,
  updateHotelReservation,
  type HotelOperationsSnapshot,
  type HotelReservationInput,
  type HotelStay,
} from "./hotelOperationsRepository";
import {
  activeHotelAllocation,
  currentAllocatedRoomName,
  formatHotelDateTime,
  formatHotelScheduleTime,
  hotelStayAssigneeIds,
  hotelStayCalendarContract,
  hotelStayDayPhase,
  hotelStayDayTitle,
  hotelStayMemo,
  hotelStayNeedsCheckInFinalization,
  hotelStayStatus,
  hotelStayScheduleEvent,
  hotelStayUnspecifiedState,
  isValidHotelSnapshotDate,
  matchesHotelQuickFilter,
  seoulInputParts,
  type HotelQuickFilter,
} from "./hotelOperationsUi";
import {
  ScheduleFormModal,
  createNewScheduleFromForm,
  emptyForm,
  hotelReservationInputFromForm,
  initializeHotelScheduleForm,
  type ScheduleForm,
} from "./OperationsToday";
import {
  fetchCurrentOperationRole,
  fetchOperationScheduleOptions,
  seoulDateKey,
  type OperationRole,
  type OperationScheduleOptions,
} from "./operationsScheduleRepository";

type ModalName =
  | "reservation"
  | "assign"
  | "reassign"
  | "move"
  | "checkin"
  | "checkout"
  | "cancel"
  | "settings"
  | null;

type PendingRoomBoardAction =
  | {
      kind: "unassign";
      stayId: string;
    }
  | {
      kind: "change_type";
      stayId: string;
      roomId: string;
      effectiveAt: string | null;
      useCurrentTime: boolean;
      reason: string;
    };

const emptyOptions: OperationScheduleOptions = {
  calendars: [],
  scheduleTypes: [],
  assignees: [],
  customers: [],
  dogs: [],
};

function errorMessage(error: unknown) {
  if (error instanceof HotelOperationsRepositoryError) return error.message;
  if (error instanceof Error) return error.message;
  return "호텔 운영 요청을 처리하지 못했습니다.";
}

type HotelToast = {
  message: string;
  title?: string;
  description?: string;
  tone: "success" | "error";
};

type RoomBoardUndo = {
  stayId: string;
  dogName: string;
  roomName: string;
  roomId: string | null;
  kind:
    | "unassign"
    | "assign"
    | "reassign"
    | "move"
    | "change_before"
    | "change_after";
};

function roomDropErrorToast(error: unknown): HotelToast {
  if (error instanceof HotelOperationsRepositoryError) {
    if (error.kind === "room_conflict") {
      return {
        title: "호실을 변경할 수 없습니다",
        message: "해당 기간에 다른 예약이 있습니다. 다른 호실을 선택해 주세요.",
        tone: "error",
      };
    }
    if (error.kind === "conflict") {
      return {
        title: "최신 상태를 다시 확인해 주세요",
        message: "다른 사용자가 먼저 변경했습니다. 카드 위치를 새로고침했습니다.",
        tone: "error",
      };
    }
    if (error.code === "PGRST202") {
      return {
        title: "서버 기능 적용이 필요합니다",
        message: error.message,
        tone: "error",
      };
    }
    if (error.kind === "unavailable") {
      return {
        title: "호실 변경 요청을 전송하지 못했습니다",
        message: "네트워크 연결을 확인한 뒤 다시 시도해 주세요. 카드 위치는 변경되지 않았습니다.",
        tone: "error",
      };
    }
  }
  return {
    title: "호실을 변경할 수 없습니다",
    message: errorMessage(error),
    tone: "error",
  };
}

function requestId() {
  return crypto.randomUUID();
}

function statusTone(status: ReturnType<typeof hotelStayStatus>) {
  if (status === "퇴실 완료") return "gray" as const;
  if (status === "호실 미배정") return "amber" as const;
  if (status === "입실 완료" || status === "사용 중" || status === "객실 이동") {
    return "green" as const;
  }
  return "blue" as const;
}

export function scheduleFormFromHotelStay(stay: HotelStay): ScheduleForm {
  const capacity = stay.capacityReservation;
  const checkInSchedule = hotelStayScheduleEvent(stay, "check_in");
  const checkOutSchedule = hotelStayScheduleEvent(stay, "check_out");
  const checkIn = checkInSchedule
    ? seoulInputParts(checkInSchedule.startsAt)
    : { date: seoulDateKey(), time: "15:00" };
  const checkOut = checkOutSchedule
    ? seoulInputParts(checkOutSchedule.startsAt)
    : { date: seoulDateKey(), time: "11:00" };
  const contract = hotelStayCalendarContract(stay);
  const checkInTimeUnspecified = Boolean(checkInSchedule?.timeUnspecified);
  const checkOutTimeUnspecified = Boolean(checkOutSchedule?.timeUnspecified);
  return {
    ...emptyForm(),
    hotelScheduleMode: "reservation",
    calendarId: contract.calendarId,
    scheduleTypeId: contract.scheduleTypeId,
    date: checkIn.date,
    startTime: checkInTimeUnspecified ? "" : checkIn.time,
    endDate: checkOut.date,
    endTime: checkOut.time,
    hotelCheckOutDate: checkOut.date,
    hotelCheckOutTime: checkOutTimeUnspecified ? "" : checkOut.time,
    hotelCheckInTimeUnspecified: checkInTimeUnspecified,
    hotelCheckOutTimeUnspecified: checkOutTimeUnspecified,
    hotelRoomTypeId: capacity?.roomTypeId ?? "",
    dogIds: [stay.dogId],
    customerIds: stay.customerId ? [stay.customerId] : [],
    assigneeIds: hotelStayAssigneeIds(stay),
    title: "",
    memo: hotelStayMemo(stay),
  };
}

export function HotelOperationsPage() {
  const { profile } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const directStayHandledRef = useRef<string | null>(null);
  const [selectedDate, setSelectedDate] = useState(() => seoulDateKey());
  const [quickFilter, setQuickFilter] = useState<HotelQuickFilter>("all");
  const [showSupportDetails, setShowSupportDetails] = useState(false);
  const [snapshot, setSnapshot] = useState<HotelOperationsSnapshot | null>(null);
  const [options, setOptions] = useState<OperationScheduleOptions>(emptyOptions);
  const [operationRole, setOperationRole] = useState<OperationRole | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [selectedStayId, setSelectedStayId] = useState<string | null>(null);
  const [detail, setDetail] = useState<HotelStay | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [modal, setModal] = useState<ModalName>(null);
  const [processing, setProcessing] = useState(false);
  const [processingStayId, setProcessingStayId] = useState<string | null>(null);
  const [pendingRoomBoardAction, setPendingRoomBoardAction] =
    useState<PendingRoomBoardAction | null>(null);
  const [scheduleForm, setScheduleForm] = useState<ScheduleForm>(() =>
    emptyForm(),
  );
  const [titleManuallyEdited, setTitleManuallyEdited] = useState(false);
  const [formError, setFormError] = useState("");
  const [roomTypeChangeConfirmationOpen, setRoomTypeChangeConfirmationOpen] =
    useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [toast, setToast] = useState<HotelToast | null>(null);
  const [roomBoardUndo, setRoomBoardUndo] = useState<RoomBoardUndo | null>(
    null,
  );
  const roomBoardUndoTimerRef = useRef<number | null>(null);
  const latestRoomBoardStayRef = useRef<Map<string, HotelStay>>(new Map());
  const roomBoardInFlightRef = useRef<Set<string>>(new Set());

  const rememberLatestRoomBoardStay = useCallback((stay: HotelStay) => {
    const remembered = latestRoomBoardStayRef.current.get(stay.id);
    if (!remembered || stay.version >= remembered.version) {
      latestRoomBoardStayRef.current.set(stay.id, stay);
    }
  }, []);

  const clearRoomBoardUndo = useCallback(() => {
    if (roomBoardUndoTimerRef.current) {
      window.clearTimeout(roomBoardUndoTimerRef.current);
      roomBoardUndoTimerRef.current = null;
    }
    setRoomBoardUndo(null);
  }, []);

  const offerRoomBoardUndo = useCallback((undo: RoomBoardUndo) => {
    if (roomBoardUndoTimerRef.current) {
      window.clearTimeout(roomBoardUndoTimerRef.current);
    }
    setRoomBoardUndo(undo);
    roomBoardUndoTimerRef.current = window.setTimeout(() => {
      setRoomBoardUndo(null);
      roomBoardUndoTimerRef.current = null;
    }, 5000);
  }, []);

  useEffect(
    () => () => {
      if (roomBoardUndoTimerRef.current) {
        window.clearTimeout(roomBoardUndoTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    latestRoomBoardStayRef.current.clear();
  }, [selectedDate]);

  useEffect(() => {
    [...(snapshot?.stays ?? []), ...(snapshot?.unassignedFuture ?? [])].forEach(
      rememberLatestRoomBoardStay,
    );
  }, [rememberLatestRoomBoardStay, snapshot]);

  const loadSnapshot = useCallback(async (date: string) => {
    if (!isValidHotelSnapshotDate(date)) return null;

    return fetchHotelOperationsSnapshot(date).then((value) => {
      setSnapshot(value);
      return value;
    });
  }, []);

  const loadPage = useCallback(async () => {
    if (!profile || !isValidHotelSnapshotDate(selectedDate)) return;
    setLoading(true);
    setLoadError("");
    try {
      const [nextSnapshot, nextOptions, nextRole] = await Promise.all([
        fetchHotelOperationsSnapshot(selectedDate),
        fetchOperationScheduleOptions(),
        fetchCurrentOperationRole(profile.id),
      ]);
      setSnapshot(nextSnapshot);
      setOptions(nextOptions);
      setOperationRole(nextRole);
    } catch (error) {
      setLoadError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [profile, selectedDate]);

  useEffect(() => {
    void loadPage();
  }, [loadPage]);

  useEffect(() => {
    const stayId = searchParams.get("stayId");
    if (!stayId || loading || !snapshot || directStayHandledRef.current === stayId) {
      return;
    }
    directStayHandledRef.current = stayId;
    setSelectedStayId(stayId);
    setDetailLoading(true);
    void fetchHotelStay(stayId)
      .then((stay) => {
        setDetail(stay);
        const nextParams = new URLSearchParams(searchParams);
        const mode = nextParams.get("mode");
        nextParams.delete("stayId");
        nextParams.delete("mode");
        setSearchParams(nextParams, { replace: true });
        if (mode === "edit") {
          if (stay.archivedAt || stay.checkedInAt || stay.checkedOutAt) {
            setToast({
              message: "현재 상태에서는 예약을 수정할 수 없어 상세 정보로 열었습니다.",
              tone: "error",
            });
            return;
          }
          setScheduleForm(scheduleFormFromHotelStay(stay));
          setTitleManuallyEdited(true);
          setFormError("");
          setModal("reservation");
        }
      })
      .catch((error) => {
        setSelectedStayId(null);
        setDetail(null);
        setToast({ message: errorMessage(error), tone: "error" });
      })
      .finally(() => setDetailLoading(false));
  }, [loading, searchParams, setSearchParams, snapshot]);

  const openStay = async (stayId: string) => {
    setSelectedStayId(stayId);
    setDetailLoading(true);
    try {
      setDetail(await fetchHotelStay(stayId));
    } catch (error) {
      if (
        error instanceof HotelOperationsRepositoryError &&
        error.kind === "conflict" &&
        detail
      ) {
        try {
          const [latestStay] = await Promise.all([
            fetchHotelStay(detail.id),
            loadSnapshot(selectedDate),
          ]);
          setDetail(latestStay);
        } catch {
          // 원래 충돌 안내를 유지하고 사용자가 재시도할 수 있게 Modal을 닫지 않는다.
        }
      }
      setToast({ message: errorMessage(error), tone: "error" });
      setSelectedStayId(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const closeDetail = () => {
    if (processing) return;
    setSelectedStayId(null);
    setDetail(null);
  };

  const refreshAfterMutation = async (
    stayId: string,
    successMessage: string,
  ) => {
    const latestStay = await fetchHotelStay(stayId);
    setDetail(latestStay);
    await loadSnapshot(selectedDate);
    setToast({ message: successMessage, tone: "success" });
    setModal(null);
  };

  const runStayMutation = async (
    action: () => Promise<HotelStay>,
    successMessage: string,
    closeDetailAfter = false,
  ) => {
    clearRoomBoardUndo();
    setProcessing(true);
    try {
      const result = await action();
      await refreshAfterMutation(result.id, successMessage);
      if (closeDetailAfter) {
        setSelectedStayId(null);
        setDetail(null);
      }
    } catch (error) {
      setToast({ message: errorMessage(error), tone: "error" });
    } finally {
      setProcessing(false);
    }
  };

  const openNewSchedule = () => {
    const initial = emptyForm();
    initial.date = selectedDate;
    initial.endDate = selectedDate;
    initial.assigneeIds = profile?.id ? [profile.id] : [];
    setScheduleForm(initializeHotelScheduleForm(initial, options, snapshot!));
    setTitleManuallyEdited(false);
    setFormError("");
    setDetail(null);
    setModal("reservation");
  };

  const openReservationEdit = () => {
    if (!detail) return;
    setScheduleForm(scheduleFormFromHotelStay(detail));
    setTitleManuallyEdited(true);
    setFormError("");
    setModal("reservation");
  };

  const updateReservation = (
    input: HotelReservationInput,
    roomTypeChanged = false,
  ) => {
    if (!detail) return;
    setRoomTypeChangeConfirmationOpen(false);
    void runStayMutation(
      () =>
        updateHotelReservation(
          detail.id,
          detail.version,
          input,
          requestId(),
        ),
      roomTypeChanged
        ? "호텔 예약을 수정했습니다. 새 객실 유형에 맞는 호실을 배정해 주세요."
        : "호텔 예약을 수정했습니다.",
    );
  };

  const saveReservation = (event: FormEvent) => {
    event.preventDefault();
    setFormError("");
    if (!detail) {
      setProcessing(true);
      void createNewScheduleFromForm(
        scheduleForm,
        options,
        snapshot,
        requestId(),
      )
        .then(async (created) => {
          if (created.kind === "hotel") {
            await refreshAfterMutation(
              created.value.id,
              "호텔 예약과 입·퇴실 일정을 등록했습니다.",
            );
            setDetail(null);
          } else {
            setToast({ message: "새 일정을 등록했습니다.", tone: "success" });
            setModal(null);
          }
        })
        .catch((error) =>
          setFormError(
            error instanceof Error
              ? error.message
              : "일정을 저장하지 못했습니다.",
          ),
        )
        .finally(() => setProcessing(false));
      return;
    }
    const prepared = hotelReservationInputFromForm(
      scheduleForm,
      options,
      snapshot,
    );
    if (!prepared.input) {
      setFormError(prepared.error);
      return;
    }
    if (detail) {
      const allocation = activeHotelAllocation(detail);
      const roomTypeChanged =
        detail.capacityReservation?.roomTypeId !== prepared.input.roomTypeId;
      if (allocation && roomTypeChanged) {
        setRoomTypeChangeConfirmationOpen(true);
        return;
      }
      updateReservation(prepared.input, roomTypeChanged);
      return;
    }
  };

  const allSnapshotStays = () => {
    const current = [
      ...(snapshot?.stays ?? []),
      ...(snapshot?.unassignedFuture ?? []),
    ];
    return current.map((stay) => {
      const remembered = latestRoomBoardStayRef.current.get(stay.id);
      return remembered && remembered.version >= stay.version
        ? remembered
        : stay;
    });
  };

  const currentRoomBoardStay = (stayId: string) =>
    allSnapshotStays().find((row) => row.id === stayId) ?? null;

  const refreshRoomBoardStay = async (
    stayId: string,
    returnedStay?: HotelStay,
  ) => {
    if (returnedStay) rememberLatestRoomBoardStay(returnedStay);
    const latestStay = await fetchHotelStay(stayId);
    rememberLatestRoomBoardStay(latestStay);
    await loadSnapshot(selectedDate);
    if (detail?.id === stayId) setDetail(latestStay);
    return latestStay;
  };

  const refreshRoomBoardAfterFailure = async (stayId: string) => {
    const latestStay = await fetchHotelStay(stayId).catch(() => null);
    if (latestStay) {
      rememberLatestRoomBoardStay(latestStay);
      if (detail?.id === stayId) setDetail(latestStay);
    }
    await loadSnapshot(selectedDate);
  };

  const executeRoomBoardAction = async (
    stay: HotelStay,
    action: () => Promise<HotelStay>,
    success: HotelToast,
    afterSuccess?: (latestStay: HotelStay) => void,
  ) => {
    if (roomBoardInFlightRef.current.has(stay.id)) return;
    roomBoardInFlightRef.current.add(stay.id);
    clearRoomBoardUndo();
    setProcessing(true);
    setProcessingStayId(stay.id);
    try {
      const returnedStay = await action();
      rememberLatestRoomBoardStay(returnedStay);
      const latestStay = await refreshRoomBoardStay(stay.id, returnedStay);
      setToast(success);
      setModal(null);
      setPendingRoomBoardAction(null);
      afterSuccess?.(latestStay);
    } catch (error) {
      await refreshRoomBoardAfterFailure(stay.id).catch(() => undefined);
      setToast(roomDropErrorToast(error));
    } finally {
      roomBoardInFlightRef.current.delete(stay.id);
      setProcessing(false);
      setProcessingStayId(null);
    }
  };

  const dropStayOnRoom = (
    stayId: string,
    roomId: string,
    requiresRoomTypeChange = false,
  ) => {
    const stay = currentRoomBoardStay(stayId);
    const room = snapshot?.rooms.find((row) => row.id === roomId);
    if (
      !stay ||
      !room ||
      processing ||
      roomBoardInFlightRef.current.has(stayId)
    ) {
      return;
    }
    if (
      requiresRoomTypeChange ||
      stay.capacityReservation?.roomTypeId !== room.roomTypeId
    ) {
      if (!activeHotelAllocation(stay)) return;
      setPendingRoomBoardAction({
        kind: "change_type",
        stayId,
        roomId,
        effectiveAt: null,
        useCurrentTime: Boolean(stay.checkedInAt),
        reason: "",
      });
      return;
    }
    const allocation = activeHotelAllocation(stay);
    if (allocation?.roomId === roomId) return;
    const previousRoomId = allocation?.roomId ?? null;
    const previousRoomName = allocation?.roomName ?? "호실 미배정";
    const operationRequestId = requestId();
    const action = !allocation
      ? () => assignHotelRoom(stay.id, stay.version, roomId, "Room Board 드래그 배정", operationRequestId)
      : stay.checkedInAt
        ? () => moveHotelRoomSameType(stay.id, stay.version, roomId, new Date().toISOString(), "Room Board 드래그 이동", operationRequestId)
        : () => reassignHotelRoomBeforeCheckIn(stay.id, stay.version, roomId, "Room Board 드래그 재배정", operationRequestId);
    void executeRoomBoardAction(
      stay,
      action,
      {
        title: `${stay.dogName} · ${room.name}`,
        message: allocation ? "호실을 변경했습니다." : "호실을 배정했습니다.",
        tone: "success",
      },
      (latestStay) => {
        offerRoomBoardUndo({
          stayId: latestStay.id,
          dogName: latestStay.dogName,
          roomName: previousRoomName,
          roomId: previousRoomId,
          kind: !allocation
            ? "unassign"
            : stay.checkedInAt
              ? "move"
              : "reassign",
        });
      },
    );
  };

  const requestUnassignRoom = (stayId: string) => {
    const stay = currentRoomBoardStay(stayId);
    if (
      !stay ||
      stay.checkedInAt ||
      !activeHotelAllocation(stay) ||
      processing ||
      roomBoardInFlightRef.current.has(stayId)
    ) {
      return;
    }
    setPendingRoomBoardAction({ kind: "unassign", stayId });
  };

  const confirmPendingRoomBoardAction = () => {
    if (!pendingRoomBoardAction || processing || !snapshot) return;
    const stay = currentRoomBoardStay(pendingRoomBoardAction.stayId);
    if (!stay) return;
    if (pendingRoomBoardAction.kind === "unassign") {
      const previousAllocation = activeHotelAllocation(stay);
      const previousRoom = previousAllocation?.roomName ?? "현재 호실";
      void executeRoomBoardAction(
        stay,
        () =>
          unassignHotelRoomBeforeCheckIn(
            stay.id,
            stay.version,
            "Room Board 호실 배정 해제",
            requestId(),
          ),
        {
          title: `${stay.dogName} · 호실 미배정`,
          message: `${previousRoom} 배정을 해제했습니다. 객실 유형 예약은 유지됩니다.`,
          tone: "success",
        },
        (latestStay) =>
          offerRoomBoardUndo({
            stayId: latestStay.id,
            dogName: latestStay.dogName,
            roomName: previousRoom,
            roomId: previousAllocation?.roomId ?? null,
            kind: "assign",
          }),
      );
      return;
    }
    const room = snapshot.rooms.find(
      (row) => row.id === pendingRoomBoardAction.roomId,
    );
    if (!room) return;
    const effectiveAt = pendingRoomBoardAction.useCurrentTime
      ? new Date().toISOString()
      : pendingRoomBoardAction.effectiveAt;
    const previousAllocation = activeHotelAllocation(stay);
    const previousRoomName = previousAllocation?.roomName ?? "이전 호실";
    const operationRequestId = requestId();
    void executeRoomBoardAction(
      stay,
      () =>
        effectiveAt
          ? changeRoomTypeAfterCheckIn(
              stay.id,
              stay.version,
              room.id,
              effectiveAt,
              pendingRoomBoardAction.reason || "Room Board 객실 유형 변경 및 이동",
              operationRequestId,
            )
          : changeRoomTypeBeforeCheckIn(
              stay.id,
              stay.version,
              room.id,
              pendingRoomBoardAction.reason || "Room Board 객실 유형 변경 및 배정",
              operationRequestId,
            ),
      {
        title: `${stay.dogName} · ${room.name}`,
        message: `${room.roomTypeCode} 유형으로 변경하고 호실을 배정했습니다.`,
        tone: "success",
      },
      (latestStay) =>
        offerRoomBoardUndo({
          stayId: latestStay.id,
          dogName: latestStay.dogName,
          roomName: previousRoomName,
          roomId: previousAllocation?.roomId ?? null,
          kind: effectiveAt ? "change_after" : "change_before",
        }),
    );
  };

  const undoLastRoomBoardDrop = async () => {
    const undo = roomBoardUndo;
    if (!undo || processing) return;
    clearRoomBoardUndo();
    setModal(null);
    try {
      const latestStay = await fetchHotelStay(undo.stayId);
      if (!undo.roomId && undo.kind !== "unassign") {
        throw new Error("되돌릴 이전 호실을 확인할 수 없습니다.");
      }
      const action =
        undo.kind === "unassign"
          ? () =>
              unassignHotelRoomBeforeCheckIn(
                latestStay.id,
                latestStay.version,
                "Room Board 직전 배정 취소",
                requestId(),
              )
          : undo.kind === "assign"
            ? () =>
                assignHotelRoom(
                  latestStay.id,
                  latestStay.version,
                  undo.roomId!,
                  "Room Board 배정 해제 되돌리기",
                  requestId(),
                )
            : undo.kind === "reassign"
              ? () =>
                  reassignHotelRoomBeforeCheckIn(
                    latestStay.id,
                    latestStay.version,
                    undo.roomId!,
                    "Room Board 재배정 되돌리기",
                    requestId(),
                  )
              : undo.kind === "move"
                ? () =>
                    moveHotelRoomSameType(
                      latestStay.id,
                      latestStay.version,
                      undo.roomId!,
                      new Date().toISOString(),
                      "Room Board 호실 이동 되돌리기",
                      requestId(),
                    )
                : undo.kind === "change_before"
                  ? () =>
                      changeRoomTypeBeforeCheckIn(
                        latestStay.id,
                        latestStay.version,
                        undo.roomId!,
                        "Room Board 객실 유형 변경 되돌리기",
                        requestId(),
                      )
                  : () =>
                      changeRoomTypeAfterCheckIn(
                        latestStay.id,
                        latestStay.version,
                        undo.roomId!,
                        new Date().toISOString(),
                        "Room Board 객실 유형 이동 되돌리기",
                        requestId(),
                      );
      await executeRoomBoardAction(latestStay, action, {
        title: `${undo.dogName} · ${undo.roomName}`,
        message: "직전 호실 배정을 되돌렸습니다.",
        tone: "success",
      });
    } catch (error) {
      await loadSnapshot(selectedDate).catch(() => undefined);
      setToast(roomDropErrorToast(error));
    }
  };

  const stays = useMemo(() => snapshot?.stays ?? [], [snapshot?.stays]);
  const filterCounts = useMemo(
    () => ({
      all: stays.length,
      check_in: stays.filter((stay) =>
        matchesHotelQuickFilter(stay, selectedDate, "check_in"),
      ).length,
      in_house: stays.filter((stay) =>
        matchesHotelQuickFilter(stay, selectedDate, "in_house"),
      ).length,
      check_out: stays.filter((stay) =>
        matchesHotelQuickFilter(stay, selectedDate, "check_out"),
      ).length,
    }),
    [selectedDate, stays],
  );
  const filteredStays = useMemo(
    () =>
      stays.filter((stay) =>
        matchesHotelQuickFilter(stay, selectedDate, quickFilter),
      ),
    [quickFilter, selectedDate, stays],
  );
  const selectedDateIsToday = selectedDate === seoulDateKey();
  const isSettingsManager = operationRole === "owner" || operationRole === "manager";

  if (loading) return <LoadingState />;
  if (loadError || !snapshot) {
    return <ErrorState title={loadError || "호텔 현황을 불러오지 못했습니다."} retry={() => void loadPage()} />;
  }

  return (
    <>
      <PageHeader
        title="호텔 운영"
        description="Room Board에서 오늘의 빈방, 입·퇴실, 이용중 객실을 바로 관리합니다."
        action={
          <div className="flex flex-wrap gap-2">
            {isSettingsManager && snapshot.settings ? (
              <Button type="button" variant="secondary" onClick={() => setModal("settings")}>
                <Settings size={17} /> 기본 시간
              </Button>
            ) : null}
            <Button type="button" onClick={openNewSchedule}>
              <CalendarDays size={17} /> 새 일정
            </Button>
          </div>
        }
      />

      <div className="mb-3 flex flex-wrap items-end justify-between gap-3 rounded-2xl border border-border bg-surface px-3 py-2.5 shadow-sm sm:px-4">
        <Field label="객실 현황 날짜">
          <Input
            type="date"
            value={selectedDate}
            onChange={(event) => {
              setSelectedDate(event.target.value);
              setQuickFilter("all");
            }}
            onBlur={(event) => {
              if (event.target.value === selectedDate) return;
              setSelectedDate(event.target.value);
              setQuickFilter("all");
            }}
            className="w-[168px]"
          />
        </Field>
        <p className="pb-1 text-xs font-medium text-text-muted">
          {selectedDateIsToday ? "오늘 운영 현황" : `${selectedDate} 운영 현황`}
        </p>
      </div>

      <HotelRoomBoard
        snapshot={snapshot}
        selectedDate={selectedDate}
        selectedDateIsToday={selectedDateIsToday}
        processing={processing}
        processingStayId={processingStayId}
        allowCrossTypeChange={isSettingsManager}
        onOpenStay={(stayId) => void openStay(stayId)}
        onDropStay={dropStayOnRoom}
        onUnassignStay={requestUnassignRoom}
      />

      <LongStayOperationsPanel
        snapshot={snapshot}
        options={options}
        operationRole={operationRole}
        onHotelSnapshotRefresh={() => loadSnapshot(selectedDate)}
      />

      <Card className="mb-4 overflow-hidden">
        <button
          type="button"
          aria-expanded={showSupportDetails}
          onClick={() => setShowSupportDetails((value) => !value)}
          className="flex min-h-14 w-full items-center justify-between gap-4 px-5 py-3.5 text-left transition hover:bg-surface-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary sm:px-6"
        >
          <span>
            <b className="block text-sm text-text-primary">예약 목록</b>
            <span className="mt-0.5 block text-xs text-text-secondary">
              선택 날짜 예약 {stays.length}건 · 필요할 때 펼쳐 확인합니다.
            </span>
          </span>
          <ChevronDown
            size={19}
            className={cn(
              "shrink-0 text-text-muted transition-transform duration-150 ease-out",
              showSupportDetails && "rotate-180",
            )}
          />
        </button>
      </Card>

      {showSupportDetails ? (
        <Card className="mb-6 overflow-hidden">
          <div className="border-b border-border px-5 py-4 sm:px-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-bold text-text-primary">선택 날짜 예약</h2>
                <p className="mt-0.5 text-xs text-text-secondary">총 {filteredStays.length}건</p>
              </div>
              <BedDouble size={20} className="text-primary" />
            </div>
          </div>
          <div className="border-b border-border px-4 py-3 sm:px-5">
            <p className="mb-2 text-xs font-semibold text-text-muted">빠른 업무 보기</p>
          <div
            role="group"
            aria-label="호텔 예약 빠른 상태 필터"
            className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 sm:mx-0 sm:px-0"
          >
            {([
              ["all", "전체"],
              ["check_in", selectedDateIsToday ? "오늘 입실" : "입실"],
              ["in_house", "이용중"],
              ["check_out", selectedDateIsToday ? "오늘 퇴실" : "퇴실"],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={quickFilter === value}
                onClick={() => setQuickFilter(value)}
                className={cn(
                  "min-h-11 shrink-0 rounded-full border px-4 text-sm font-semibold transition duration-150 ease-out focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                  quickFilter === value
                    ? "border-primary bg-primary text-white shadow-sm"
                    : "border-border bg-surface text-text-secondary hover:-translate-y-px hover:border-primary/30 hover:text-primary hover:shadow-sm",
                )}
              >
                {label} <span className="tabular-nums">({filterCounts[value]})</span>
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-text-muted">
            필터는 예약 목록에만 적용되며 Room Board는 선택 날짜 전체 현황을 유지합니다.
          </p>
          </div>
          {filteredStays.length === 0 ? (
            <EmptyState title={quickFilter === "all" ? "이 날짜에 호텔 예약이 없습니다." : "선택한 업무에 해당하는 예약이 없습니다."} description="호텔 예약은 여기에서 한 번만 등록하며 Calendar에 입·퇴실 일정이 자동 연결됩니다." />
          ) : (
            <div className="divide-y divide-border">
              {filteredStays.map((stay) => (
                <StayRow key={stay.id} stay={stay} selectedDate={selectedDate} onClick={() => void openStay(stay.id)} />
              ))}
            </div>
          )}
          <details className="border-t border-border bg-surface-secondary/50">
            <summary className="cursor-pointer px-5 py-3 text-xs font-bold text-text-secondary transition hover:text-text-primary sm:px-6">
              Capacity 보조 지표
            </summary>
            <div className="grid gap-3 border-t border-border px-5 py-4 sm:grid-cols-2 sm:px-6">
              {snapshot.roomTypes.map((roomType) => {
                const remaining =
                  snapshot.confirmedRemainingByType?.[roomType.code] ??
                  roomType.confirmedRemaining ??
                  Math.max(0, roomType.activeRooms - roomType.reservedPeak);
                const conservativeRemaining =
                  roomType.conservativeRemaining ?? remaining;
                const affectedByUnspecifiedCount =
                  roomType.affectedByUnspecifiedCount ?? 0;
                return (
                  <div key={roomType.id} className="rounded-2xl border border-border bg-surface p-4">
                    <b className="text-sm text-text-primary">{roomType.code}</b>
                    <dl className="mt-3 grid grid-cols-3 gap-2">
                      <Metric label="유형 확정 잔여" value={`${remaining}실`} />
                      <Metric label="안전 예약 가능" value={`${conservativeRemaining}실`} alert={conservativeRemaining === 0} />
                      <Metric label="객실 미정 영향" value={`${affectedByUnspecifiedCount}건`} alert={affectedByUnspecifiedCount > 0} />
                    </dl>
                  </div>
                );
              })}
              <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4 sm:col-span-2">
                <b className="text-sm text-amber-900">객실 미정 예약</b>
                <dl className="mt-3 grid grid-cols-2 gap-2">
                  <Metric label="예약" value={`${snapshot.unassignedRoomTypeCount ?? 0}건`} alert={(snapshot.unassignedRoomTypeCount ?? 0) > 0} />
                  <Metric label="전체 안전 잔여" value={`${snapshot.overallSafeRemaining ?? 0}실`} alert={(snapshot.overallSafeRemaining ?? 0) === 0} />
                </dl>
                {snapshot.individualTypeAvailabilityWarning ? (
                  <p className="mt-3 text-xs font-medium text-amber-800">
                    객실 미정 예약이 있어 유형별 잔여는 변동될 수 있습니다.
                  </p>
                ) : null}
              </div>
            </div>
          </details>
        </Card>
      ) : null}

      <StayDetailModal
        open={Boolean(selectedStayId) && modal === null}
        stay={detail}
        selectedDate={selectedDate}
        loading={detailLoading}
        onClose={closeDetail}
        onEdit={openReservationEdit}
        onAssign={() => setModal("assign")}
        onReassign={() => setModal("reassign")}
        onMove={() => setModal("move")}
        onUnassign={() => requestUnassignRoom(detail!.id)}
        onCheckIn={() => setModal("checkin")}
        onCheckOut={() => setModal("checkout")}
        onCancel={() => { setCancelReason(""); setModal("cancel"); }}
        creatorName={options.assignees.find((person) => person.id === detail?.createdBy)?.name ?? null}
      />

      <ScheduleFormModal
        open={modal === "reservation"}
        editing="new"
        form={scheduleForm}
        options={options}
        error={formError}
        saving={processing}
        recentScope={profile?.id ?? "hotel"}
        titleManuallyEdited={titleManuallyEdited}
        onTitleManuallyEdited={setTitleManuallyEdited}
        onChange={setScheduleForm}
        onSubmit={saveReservation}
        onClose={() => {
          if (processing) return;
          setRoomTypeChangeConfirmationOpen(false);
          setModal(null);
        }}
        currentUserName={
          detail
            ? options.assignees.find((person) => person.id === detail.createdBy)
                ?.name
            : profile?.name
        }
        hotelSnapshot={snapshot}
        modalTitle={detail ? "호텔 예약 수정" : "새 일정"}
        modalResetKey={detail?.id ?? `hotel-new-${selectedDate}`}
        calendarLocked={Boolean(detail)}
      />
      <ConfirmModal
        open={roomTypeChangeConfirmationOpen}
        title="객실 유형을 변경할까요?"
        description={
          <p>
            객실 유형을 변경하면 기존 호실 배정이 해제됩니다.<br />
            저장 후 새 객실 유형에 맞는 호실을 다시 배정해 주세요.
          </p>
        }
        confirmLabel="변경 후 저장"
        cancelLabel="돌아가기"
        processing={processing}
        onClose={() => setRoomTypeChangeConfirmationOpen(false)}
        onConfirm={() => {
          const prepared = hotelReservationInputFromForm(
            scheduleForm,
            options,
            snapshot,
          );
          if (!prepared.input) {
            setFormError(prepared.error);
            setRoomTypeChangeConfirmationOpen(false);
            return;
          }
          updateReservation(prepared.input, true);
        }}
      />
      {detail ? (
        <>
          <RoomAssignModal open={modal === "assign"} snapshot={snapshot} stay={detail} processing={processing} onClose={() => setModal(null)} onSubmit={(roomId, reason) => void runStayMutation(() => assignHotelRoom(detail.id, detail.version, roomId, reason, requestId()), "호실을 배정했습니다.")} />
          <RoomReassignModal open={modal === "reassign"} snapshot={snapshot} stay={detail} processing={processing} includeOtherRoomTypes={isSettingsManager} onClose={() => setModal(null)} onSubmit={(roomId, reason) => {
            const room = snapshot.rooms.find((row) => row.id === roomId);
            if (room && room.roomTypeId !== detail.capacityReservation?.roomTypeId) {
              setPendingRoomBoardAction({ kind: "change_type", stayId: detail.id, roomId, effectiveAt: null, useCurrentTime: false, reason });
              return;
            }
            void runStayMutation(() => reassignHotelRoomBeforeCheckIn(detail.id, detail.version, roomId, reason, requestId()), "호실을 재배정했습니다.");
          }} />
          <MoveRoomModal open={modal === "move"} snapshot={snapshot} stay={detail} processing={processing} includeOtherRoomTypes={isSettingsManager} onClose={() => setModal(null)} onSubmit={(roomId, moveAt, reason) => {
            const room = snapshot.rooms.find((row) => row.id === roomId);
            if (room && room.roomTypeId !== detail.capacityReservation?.roomTypeId) {
              setPendingRoomBoardAction({ kind: "change_type", stayId: detail.id, roomId, effectiveAt: moveAt, useCurrentTime: false, reason });
              return;
            }
            void runStayMutation(() => moveHotelRoomSameType(detail.id, detail.version, roomId, moveAt, reason, requestId()), "객실 이동을 기록했습니다.");
          }} />
          {hotelStayNeedsCheckInFinalization(detail) ? (
            <CheckInModal open={modal === "checkin"} snapshot={snapshot} stay={detail} processing={processing} onClose={() => setModal(null)} onSubmit={(completedAt, roomTypeId, roomId) => {
              void runStayMutation(
                () => finalizeAndCompleteHotelCheckIn(detail.id, detail.version, completedAt, roomTypeId, roomId, requestId()),
                "입실 완료로 처리했습니다.",
              );
            }} />
          ) : (
            <CompleteCheckInModal open={modal === "checkin"} stay={detail} processing={processing} onClose={() => setModal(null)} onSubmit={(completedAt) => {
              void runStayMutation(
                () => completeHotelCheckIn(detail.id, detail.version, completedAt, requestId()),
                "입실 완료로 처리했습니다.",
              );
            }} />
          )}
          <CheckOutModal open={modal === "checkout"} stay={detail} processing={processing} onClose={() => setModal(null)} onSubmit={(completedAt) => {
            const unspecified = hotelStayUnspecifiedState(detail);
            void runStayMutation(
              () => unspecified.checkOutTime
                ? finalizeAndCompleteHotelCheckOut(detail.id, detail.version, completedAt, requestId())
                : completeHotelCheckOut(detail.id, detail.version, completedAt, requestId()),
              "퇴실 완료로 처리했습니다.",
            );
          }} />
          <ConfirmModal open={modal === "cancel"} title="호텔 예약을 취소할까요?" description={<div className="space-y-3"><p>연결된 입·퇴실 일정과 Capacity가 함께 취소되며 기록은 유지됩니다.</p><Field label="취소 사유"><Input value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} placeholder="선택 사항" /></Field></div>} confirmLabel="예약 취소" cancelLabel="돌아가기" processing={processing} onClose={() => setModal(null)} onConfirm={() => void runStayMutation(() => cancelHotelReservation(detail.id, detail.version, cancelReason, requestId()), "호텔 예약을 취소했습니다.", true)} />
        </>
      ) : null}
      {snapshot.settings ? <SettingsModal open={modal === "settings"} settings={snapshot.settings} processing={processing} onClose={() => setModal(null)} onSubmit={(checkIn, checkOut) => { setProcessing(true); void updateHotelOperationSettings(snapshot.settings!.version, checkIn, checkOut, requestId()).then(async () => { await loadSnapshot(selectedDate); setToast({ message: "호텔 기본 시간을 저장했습니다.", tone: "success" }); setModal(null); }).catch((error) => setToast({ message: errorMessage(error), tone: "error" })).finally(() => setProcessing(false)); }} /> : null}
      <ConfirmModal
        open={pendingRoomBoardAction !== null}
        title={
          pendingRoomBoardAction?.kind === "unassign"
            ? "호실 배정을 해제할까요?"
            : "객실 유형을 변경할까요?"
        }
        description={(() => {
          if (!pendingRoomBoardAction) return null;
          const stay = allSnapshotStays().find(
            (row) => row.id === pendingRoomBoardAction.stayId,
          );
          if (!stay) return null;
          if (pendingRoomBoardAction.kind === "unassign") {
            return <p>객실 유형 예약은 유지됩니다.</p>;
          }
          const room = snapshot.rooms.find(
            (row) => row.id === pendingRoomBoardAction.roomId,
          );
          const previousRoom = activeHotelAllocation(stay)?.roomName ?? "미배정";
          return (
            <div className="space-y-3">
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 rounded-2xl border border-border bg-surface-secondary p-3 text-center">
                <div>
                  <span className="block text-xs text-text-muted">이전 유형</span>
                  <b className="mt-1 block text-sm text-text-primary">
                    {stay.capacityReservation?.roomTypeCode ?? "객실 미정"}
                  </b>
                </div>
                <MoveRight size={18} className="text-text-muted" />
                <div>
                  <span className="block text-xs text-text-muted">새 유형</span>
                  <b className="mt-1 block text-sm text-primary">
                    {room?.roomTypeCode ?? "새 유형"}
                  </b>
                </div>
              </div>
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 rounded-2xl border border-border bg-surface-secondary p-3 text-center">
                <div>
                  <span className="block text-xs text-text-muted">이전 호실</span>
                  <b className="mt-1 block text-sm text-text-primary">{previousRoom}</b>
                </div>
                <MoveRight size={18} className="text-text-muted" />
                <div>
                  <span className="block text-xs text-text-muted">새 호실</span>
                  <b className="mt-1 block text-sm text-primary">
                    {room?.name ?? "선택 호실"}
                  </b>
                </div>
              </div>
              {stay.checkedInAt ? (
                <Field label="이동 사유 (선택)">
                  <Input
                    value={pendingRoomBoardAction.reason}
                    onChange={(event) =>
                      setPendingRoomBoardAction((current) =>
                        current?.kind === "change_type"
                          ? { ...current, reason: event.target.value }
                          : current,
                      )
                    }
                    placeholder="입력하지 않으면 기본 사유로 기록됩니다."
                  />
                </Field>
              ) : null}
            </div>
          );
        })()}
        confirmLabel={
          pendingRoomBoardAction?.kind === "unassign"
            ? "배정 해제"
            : "유형 변경 및 배정"
        }
        cancelLabel="돌아가기"
        processing={processing}
        onClose={() => {
          if (!processing) setPendingRoomBoardAction(null);
        }}
        onConfirm={confirmPendingRoomBoardAction}
      />
      {toast ? <Toast message={toast.message} title={toast.title} description={toast.description} tone={toast.tone} onClose={() => setToast(null)} /> : null}
      {roomBoardUndo ? (
        <button
          type="button"
          onClick={() => void undoLastRoomBoardDrop()}
          disabled={processing}
          className="pm-room-board-undo fixed bottom-[6.4rem] right-4 z-[70] inline-flex items-center gap-2 rounded-full border border-slate-700/10 bg-slate-950 px-4 py-2.5 text-sm font-extrabold text-white shadow-[0_14px_32px_rgb(15_23_42_/_0.3)] transition duration-150 ease-out hover:-translate-y-0.5 hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50 sm:right-6"
        >
          <RotateCcw size={16} /> 배정 취소
          <span className="text-xs font-semibold text-white/65">5초</span>
        </button>
      ) : null}
    </>
  );
}

function Metric({ label, value, alert = false }: { label: string; value: string; alert?: boolean }) {
  return <div className={cn("rounded-xl border px-2.5 py-2", alert ? "border-warning/20 bg-warning-soft" : "border-border bg-surface-secondary")}><dt className="text-[11px] text-text-secondary">{label}</dt><dd className={cn("mt-1 text-sm font-bold tabular-nums", alert ? "text-warning" : "text-text-primary")}>{value}</dd></div>;
}

function StayRow({ stay, selectedDate, onClick }: { stay: HotelStay; selectedDate: string; onClick: () => void }) {
  const status = hotelStayStatus(stay);
  const dayPhase = hotelStayDayPhase(stay, selectedDate);
  const unspecified = hotelStayUnspecifiedState(stay);
  return (
    <button type="button" onClick={onClick} className="grid w-full gap-3 px-5 py-4 text-left transition hover:bg-primary-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-6">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <b className="truncate text-sm text-text-primary">{hotelStayDayTitle(stay, selectedDate)}</b>
          <Badge tone={statusTone(status)}>{status}</Badge>
          {dayPhase ? <Badge tone="blue">{dayPhase}</Badge> : null}
          {unspecified.checkInTime ? <Badge tone="amber">입실시간 미정</Badge> : null}
          {unspecified.checkOutTime ? <Badge tone="amber">퇴실시간 미정</Badge> : null}
          {unspecified.roomType ? <Badge tone="amber">객실 미정</Badge> : null}
        </div>
        <p className="mt-1.5 text-sm text-text-secondary">🐶 {stay.dogName} · {stay.customerName ?? "보호자 미등록"}</p>
        <p className="mt-1 text-xs text-text-muted">
          {formatHotelScheduleTime(stay, "check_in")} → {formatHotelScheduleTime(stay, "check_out")}
        </p>
      </div>
      <div className="flex items-center gap-2 text-sm font-semibold text-primary">
        <DoorOpen size={16} /> {currentAllocatedRoomName(stay)}
      </div>
    </button>
  );
}

function StayDetailModal({ open, stay, selectedDate, loading, creatorName, onClose, onEdit, onAssign, onReassign, onMove, onUnassign, onCheckIn, onCheckOut, onCancel }: { open: boolean; stay: HotelStay | null; selectedDate: string; loading: boolean; creatorName: string | null; onClose: () => void; onEdit: () => void; onAssign: () => void; onReassign: () => void; onMove: () => void; onUnassign: () => void; onCheckIn: () => void; onCheckOut: () => void; onCancel: () => void }) {
  if (!stay && !loading) return null;
  const allocation = stay ? activeHotelAllocation(stay) : null;
  const status = stay ? hotelStayStatus(stay) : "예약";
  const dayPhase = stay ? hotelStayDayPhase(stay, selectedDate) : null;
  const unspecified = stay
    ? hotelStayUnspecifiedState(stay)
    : { checkInTime: false, checkOutTime: false, roomType: false };
  return <Modal open={open} title="호텔 예약 상세" onClose={onClose} wide resetKey={stay?.id}>{loading || !stay ? <LoadingState /> : <div className="space-y-6"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-xl font-bold text-text-primary">{hotelStayDayTitle(stay, selectedDate)}</h3><p className="mt-1 text-sm text-text-secondary">🐶 {stay.dogName} · {stay.customerName ?? "보호자 미등록"}</p><div className="mt-2 flex flex-wrap gap-1.5">{unspecified.checkInTime ? <Badge tone="amber">입실시간 미정</Badge> : null}{unspecified.checkOutTime ? <Badge tone="amber">퇴실시간 미정</Badge> : null}{unspecified.roomType ? <Badge tone="amber">객실 미정</Badge> : null}</div></div><div className="flex flex-wrap justify-end gap-1.5">{dayPhase ? <Badge tone="blue">{dayPhase}</Badge> : null}<Badge tone={statusTone(status)}>{status}</Badge></div></div><dl className="grid gap-3 sm:grid-cols-2"><Detail label="객실 유형" value={stay.capacityReservation?.roomTypeName ?? "객실 미정"} icon={<Hotel size={16} />} /><Detail label="현재 호실" value={allocation?.roomName ?? "미배정"} icon={<DoorOpen size={16} />} /><Detail label="입실 예정" value={formatHotelScheduleTime(stay, "check_in")} icon={<CalendarDays size={16} />} /><Detail label="퇴실 예정" value={formatHotelScheduleTime(stay, "check_out")} icon={<CalendarDays size={16} />} /><Detail label="입실 완료" value={formatHotelDateTime(stay.checkedInAt)} icon={<CheckCircle2 size={16} />} /><Detail label="퇴실 완료" value={formatHotelDateTime(stay.checkedOutAt)} icon={<CheckCircle2 size={16} />} /></dl><div className="rounded-2xl bg-surface-secondary p-4 text-sm text-text-secondary"><p><b className="text-text-primary">담당자</b> {stay.scheduleEvents[0]?.schedule.assignees.map((person) => person.name ?? "이름 미등록").join(", ") || "미지정"}</p><p className="mt-2"><b className="text-text-primary">생성자</b> {creatorName ?? stay.createdBy}</p>{stay.customerPhone ? <p className="mt-2"><b className="text-text-primary">보호자 연락처</b> {stay.customerPhone}</p> : null}{hotelStayMemo(stay) ? <p className="mt-2 whitespace-pre-wrap"><b className="text-text-primary">메모</b> {hotelStayMemo(stay)}</p> : null}{stay.roomAllocations.length > 1 ? <p className="mt-2"><b className="text-text-primary">객실 이동</b> {stay.roomAllocations.map((row) => row.roomName).join(" → ")}</p> : null}</div><div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="secondary" onClick={onEdit}>예약 수정</Button>{!stay.checkedInAt && !allocation && !unspecified.roomType ? <Button type="button" variant="secondary" onClick={onAssign}>호실 배정</Button> : null}{!stay.checkedInAt && allocation ? <><Button type="button" variant="secondary" onClick={onReassign}>호실 재배정</Button><Button type="button" variant="secondary" onClick={onUnassign}>배정 해제</Button></> : null}{stay.checkedInAt && !stay.checkedOutAt ? <Button type="button" variant="secondary" onClick={onMove}><MoveRight size={16} /> 객실 이동</Button> : null}{!stay.checkedInAt ? <Button type="button" onClick={onCheckIn}>입실 완료</Button> : null}{stay.checkedInAt && !stay.checkedOutAt ? <Button type="button" onClick={onCheckOut}>퇴실 완료</Button> : null}{!stay.checkedInAt ? <Button type="button" variant="danger" onClick={onCancel}>예약 취소</Button> : null}</div></div>}</Modal>;
}

function Detail({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return <div className="rounded-2xl border border-border bg-surface p-4"><dt className="flex items-center gap-2 text-xs text-text-secondary">{icon}{label}</dt><dd className="mt-2 text-sm font-semibold text-text-primary">{value}</dd></div>;
}
