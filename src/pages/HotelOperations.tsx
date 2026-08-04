import {
  BedDouble,
  CalendarDays,
  CheckCircle2,
  DoorOpen,
  Hotel,
  MoveRight,
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
import {
  assignHotelRoom,
  cancelHotelReservation,
  completeHotelCheckIn,
  completeHotelCheckOut,
  finalizeAndCompleteHotelCheckIn,
  finalizeAndCompleteHotelCheckOut,
  fetchHotelOperationsSnapshot,
  fetchHotelStay,
  HotelOperationsRepositoryError,
  moveHotelRoomSameType,
  reassignHotelRoomBeforeCheckIn,
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
  hotelStayMemo,
  hotelStayNeedsCheckInFinalization,
  hotelStayStatus,
  hotelStayTitle,
  hotelStayScheduleEvent,
  hotelStayUnspecifiedState,
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
  const [scheduleForm, setScheduleForm] = useState<ScheduleForm>(() =>
    emptyForm(),
  );
  const [titleManuallyEdited, setTitleManuallyEdited] = useState(false);
  const [formError, setFormError] = useState("");
  const [roomTypeChangeConfirmationOpen, setRoomTypeChangeConfirmationOpen] =
    useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" } | null>(null);

  const loadSnapshot = useCallback(async (date: string) => {
    return fetchHotelOperationsSnapshot(date).then((value) => {
      setSnapshot(value);
      return value;
    });
  }, []);

  const loadPage = useCallback(async () => {
    if (!profile) return;
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
  const roomTypeUnspecifiedStays = filteredStays.filter(
    (stay) => !stay.capacityReservation?.roomTypeId,
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
        description="Calendar 예약을 기준으로 객실 점유와 현장 입·퇴실을 관리합니다."
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

      <Card className="mb-5 p-4 sm:p-5">
        <Field label="현황 날짜">
          <Input
            type="date"
            value={selectedDate}
            onChange={(event) => {
              setSelectedDate(event.target.value);
              setQuickFilter("all");
            }}
            className="max-w-xs"
          />
        </Field>
        <div className="mt-4 border-t border-border pt-4">
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
            목록만 필터링하며 객실 현황 수치는 선택 날짜 전체 예약 기준입니다.
          </p>
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        {snapshot.roomTypes.map((roomType) => {
          const remaining = snapshot.confirmedRemainingByType?.[roomType.code]
            ?? roomType.confirmedRemaining
            ?? Math.max(0, roomType.activeRooms - roomType.reservedPeak);
          const conservativeRemaining =
            roomType.conservativeRemaining ?? remaining;
          const affectedByUnspecifiedCount =
            roomType.affectedByUnspecifiedCount ?? 0;
          const confirmedReserved =
            roomType.confirmedReservedPeak ?? roomType.reservedPeak;
          return (
            <Card key={roomType.id} className="p-5 sm:p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.12em] text-primary">{roomType.code}</p>
                  <h2 className="mt-1 text-xl font-bold text-text-primary">{roomType.name}</h2>
                </div>
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary-soft text-primary"><Hotel size={21} /></span>
              </div>
              <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Metric label="총 객실" value={`${roomType.activeRooms}실`} />
                <Metric label="확정 예약" value={`${confirmedReserved}실`} />
                <Metric label="유형 확정 잔여" value={`${remaining}실`} />
                <Metric label="안전 예약 가능" value={`${conservativeRemaining}실`} alert={conservativeRemaining === 0} />
                <Metric label="객실 미정 영향" value={`${affectedByUnspecifiedCount}건`} alert={affectedByUnspecifiedCount > 0} />
                <Metric label="입실 중" value={`${roomType.checkedInNow}실`} />
                <Metric label="현재 배정" value={`${roomType.allocatedNow}실`} />
                <Metric label="미배정" value={`${roomType.unassignedNow}건`} alert={roomType.unassignedNow > 0} />
              </dl>
              {affectedByUnspecifiedCount > 0 || snapshot.individualTypeAvailabilityWarning ? (
                <p className="mt-4 text-xs font-medium text-amber-700">
                  객실 미정 예약의 확정 유형에 따라 유형별 잔여가 변동될 수 있습니다.
                </p>
              ) : null}
            </Card>
          );
        })}
        <Card className="p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-amber-700">객실 미정</p>
              <h2 className="mt-1 text-xl font-bold text-text-primary">유형 확정 대기</h2>
            </div>
            <Badge tone="amber">객실 미정 예약</Badge>
          </div>
          <dl className="mt-5 grid grid-cols-2 gap-3">
            <Metric label="예약" value={`${snapshot.unassignedRoomTypeCount ?? 0}건`} alert={(snapshot.unassignedRoomTypeCount ?? 0) > 0} />
            <Metric label="전체 안전 잔여" value={`${snapshot.overallSafeRemaining ?? 0}실`} alert={(snapshot.overallSafeRemaining ?? 0) === 0} />
          </dl>
          {snapshot.individualTypeAvailabilityWarning ? (
            <p className="mt-4 text-xs font-medium text-amber-700">
              객실 미정 예약이 있어 유형별 잔여는 변동될 수 있습니다.
            </p>
          ) : null}
        </Card>
      </div>

      <Card className="mt-6 overflow-hidden">
        <div className="border-b border-border px-5 py-4 sm:px-6">
          <h2 className="font-bold text-text-primary">객실 미정 예약</h2>
          <p className="mt-0.5 text-xs text-text-secondary">선택 날짜에 객실 유형 확정이 필요한 예약입니다.</p>
        </div>
        {roomTypeUnspecifiedStays.length === 0 ? (
          <EmptyState compact title="객실 미정 예약이 없습니다." />
        ) : (
          <div className="divide-y divide-border">
              {roomTypeUnspecifiedStays.map((stay) => (
                <StayRow key={stay.id} stay={stay} selectedDate={selectedDate} onClick={() => void openStay(stay.id)} />
            ))}
          </div>
        )}
      </Card>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-5 py-4 sm:px-6">
            <div>
              <h2 className="font-bold text-text-primary">선택 날짜 예약</h2>
              <p className="mt-0.5 text-xs text-text-secondary">총 {filteredStays.length}건</p>
            </div>
            <BedDouble size={20} className="text-primary" />
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
        </Card>

        <Card className="h-fit overflow-hidden">
          <div className="border-b border-border px-5 py-4">
            <h2 className="font-bold text-text-primary">호실 미배정 예정</h2>
            <p className="mt-0.5 text-xs text-text-secondary">입실 전에 직원이 직접 호실을 선택합니다.</p>
          </div>
          {snapshot.unassignedFuture.length === 0 ? (
            <EmptyState compact title="미배정 예약이 없습니다." />
          ) : (
            <div className="divide-y divide-border">
              {snapshot.unassignedFuture.slice(0, 8).map((stay) => (
                <button key={stay.id} type="button" onClick={() => void openStay(stay.id)} className="block w-full px-5 py-3.5 text-left transition hover:bg-primary-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary">
                  <b className="block truncate text-sm text-text-primary">{stay.dogName}</b>
                  <span className="mt-1 block text-xs text-text-secondary">{stay.capacityReservation?.roomTypeName ?? "객실 미정"} · {formatHotelScheduleTime(stay, "check_in")}</span>
                </button>
              ))}
            </div>
          )}
        </Card>
      </div>

      <StayDetailModal
        open={Boolean(selectedStayId) && modal === null}
        stay={detail}
        loading={detailLoading}
        onClose={closeDetail}
        onEdit={openReservationEdit}
        onAssign={() => setModal("assign")}
        onReassign={() => setModal("reassign")}
        onMove={() => setModal("move")}
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
          <RoomReassignModal open={modal === "reassign"} snapshot={snapshot} stay={detail} processing={processing} onClose={() => setModal(null)} onSubmit={(roomId, reason) => void runStayMutation(() => reassignHotelRoomBeforeCheckIn(detail.id, detail.version, roomId, reason, requestId()), "호실을 재배정했습니다.")} />
          <MoveRoomModal open={modal === "move"} snapshot={snapshot} stay={detail} processing={processing} onClose={() => setModal(null)} onSubmit={(roomId, moveAt, reason) => void runStayMutation(() => moveHotelRoomSameType(detail.id, detail.version, roomId, moveAt, reason, requestId()), "객실 이동을 기록했습니다.")} />
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
      {toast ? <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} /> : null}
    </>
  );
}

function Metric({ label, value, alert = false }: { label: string; value: string; alert?: boolean }) {
  return <div className={`rounded-2xl border px-3.5 py-3 ${alert ? "border-warning/20 bg-warning-soft" : "border-border bg-surface-secondary"}`}><dt className="text-xs text-text-secondary">{label}</dt><dd className={`mt-1 text-lg font-bold tabular-nums ${alert ? "text-warning" : "text-text-primary"}`}>{value}</dd></div>;
}

function StayRow({ stay, selectedDate, onClick }: { stay: HotelStay; selectedDate: string; onClick: () => void }) {
  const status = hotelStayStatus(stay);
  const dayPhase = hotelStayDayPhase(stay, selectedDate);
  const unspecified = hotelStayUnspecifiedState(stay);
  return (
    <button type="button" onClick={onClick} className="grid w-full gap-3 px-5 py-4 text-left transition hover:bg-primary-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-6">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <b className="truncate text-sm text-text-primary">{hotelStayTitle(stay)}</b>
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

function StayDetailModal({ open, stay, loading, creatorName, onClose, onEdit, onAssign, onReassign, onMove, onCheckIn, onCheckOut, onCancel }: { open: boolean; stay: HotelStay | null; loading: boolean; creatorName: string | null; onClose: () => void; onEdit: () => void; onAssign: () => void; onReassign: () => void; onMove: () => void; onCheckIn: () => void; onCheckOut: () => void; onCancel: () => void }) {
  if (!stay && !loading) return null;
  const allocation = stay ? activeHotelAllocation(stay) : null;
  const status = stay ? hotelStayStatus(stay) : "예약";
  const unspecified = stay
    ? hotelStayUnspecifiedState(stay)
    : { checkInTime: false, checkOutTime: false, roomType: false };
  return <Modal open={open} title="호텔 예약 상세" onClose={onClose} wide resetKey={stay?.id}>{loading || !stay ? <LoadingState /> : <div className="space-y-6"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-xl font-bold text-text-primary">{hotelStayTitle(stay)}</h3><p className="mt-1 text-sm text-text-secondary">🐶 {stay.dogName} · {stay.customerName ?? "보호자 미등록"}</p><div className="mt-2 flex flex-wrap gap-1.5">{unspecified.checkInTime ? <Badge tone="amber">입실시간 미정</Badge> : null}{unspecified.checkOutTime ? <Badge tone="amber">퇴실시간 미정</Badge> : null}{unspecified.roomType ? <Badge tone="amber">객실 미정</Badge> : null}</div></div><Badge tone={statusTone(status)}>{status}</Badge></div><dl className="grid gap-3 sm:grid-cols-2"><Detail label="객실 유형" value={stay.capacityReservation?.roomTypeName ?? "객실 미정"} icon={<Hotel size={16} />} /><Detail label="현재 호실" value={allocation?.roomName ?? "미배정"} icon={<DoorOpen size={16} />} /><Detail label="입실 예정" value={formatHotelScheduleTime(stay, "check_in")} icon={<CalendarDays size={16} />} /><Detail label="퇴실 예정" value={formatHotelScheduleTime(stay, "check_out")} icon={<CalendarDays size={16} />} /><Detail label="입실 완료" value={formatHotelDateTime(stay.checkedInAt)} icon={<CheckCircle2 size={16} />} /><Detail label="퇴실 완료" value={formatHotelDateTime(stay.checkedOutAt)} icon={<CheckCircle2 size={16} />} /></dl><div className="rounded-2xl bg-surface-secondary p-4 text-sm text-text-secondary"><p><b className="text-text-primary">담당자</b> {stay.scheduleEvents[0]?.schedule.assignees.map((person) => person.name ?? "이름 미등록").join(", ") || "미지정"}</p><p className="mt-2"><b className="text-text-primary">생성자</b> {creatorName ?? stay.createdBy}</p>{stay.customerPhone ? <p className="mt-2"><b className="text-text-primary">보호자 연락처</b> {stay.customerPhone}</p> : null}{hotelStayMemo(stay) ? <p className="mt-2 whitespace-pre-wrap"><b className="text-text-primary">메모</b> {hotelStayMemo(stay)}</p> : null}{stay.roomAllocations.length > 1 ? <p className="mt-2"><b className="text-text-primary">객실 이동</b> {stay.roomAllocations.map((row) => row.roomName).join(" → ")}</p> : null}</div><div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="secondary" onClick={onEdit}>예약 수정</Button>{!stay.checkedInAt && !allocation && !unspecified.roomType ? <Button type="button" variant="secondary" onClick={onAssign}>호실 배정</Button> : null}{!stay.checkedInAt && allocation ? <Button type="button" variant="secondary" onClick={onReassign}>호실 재배정</Button> : null}{stay.checkedInAt && !stay.checkedOutAt ? <Button type="button" variant="secondary" onClick={onMove}><MoveRight size={16} /> 객실 이동</Button> : null}{!stay.checkedInAt ? <Button type="button" onClick={onCheckIn}>입실 완료</Button> : null}{stay.checkedInAt && !stay.checkedOutAt ? <Button type="button" onClick={onCheckOut}>퇴실 완료</Button> : null}{!stay.checkedInAt ? <Button type="button" variant="danger" onClick={onCancel}>예약 취소</Button> : null}</div></div>}</Modal>;
}

function Detail({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return <div className="rounded-2xl border border-border bg-surface p-4"><dt className="flex items-center gap-2 text-xs text-text-secondary">{icon}{label}</dt><dd className="mt-2 text-sm font-semibold text-text-primary">{value}</dd></div>;
}
