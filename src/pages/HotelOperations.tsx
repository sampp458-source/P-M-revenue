import {
  BedDouble,
  CalendarDays,
  CheckCircle2,
  DoorOpen,
  Hotel,
  MoveRight,
  Settings,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
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
} from "../components/ui";
import {
  CheckInModal,
  CheckOutModal,
  HotelReservationModal,
  MoveRoomModal,
  RoomAssignModal,
  RoomReassignModal,
  SettingsModal,
  currentAllocatedRoomName,
} from "./HotelOperationsModals";
import {
  assignHotelRoom,
  cancelHotelReservation,
  completeHotelCheckIn,
  completeHotelCheckOut,
  createHotelReservation,
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
  formatHotelDateTime,
  hotelStayMemo,
  hotelStayStatus,
  hotelStayTitle,
} from "./hotelOperationsUi";
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

export function HotelOperationsPage() {
  const { profile } = useAuth();
  const [selectedDate, setSelectedDate] = useState(() => seoulDateKey());
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

  const openStay = async (stayId: string) => {
    setSelectedStayId(stayId);
    setDetailLoading(true);
    try {
      setDetail(await fetchHotelStay(stayId));
    } catch (error) {
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

  const onCreate = (input: HotelReservationInput) =>
    void runStayMutation(
      () => createHotelReservation(input, requestId()),
      "호텔 예약을 등록했습니다.",
      true,
    );

  const onUpdate = (input: HotelReservationInput) => {
    if (!detail) return;
    void runStayMutation(
      () => updateHotelReservation(detail.id, detail.version, input, requestId()),
      "호텔 예약을 수정했습니다.",
    );
  };

  const stays = snapshot?.stays ?? [];
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
            <Button type="button" onClick={() => { setDetail(null); setModal("reservation"); }}>
              <CalendarDays size={17} /> 호텔 예약 등록
            </Button>
          </div>
        }
      />

      <Card className="mb-5 p-4 sm:p-5">
        <Field label="현황 날짜">
          <Input
            type="date"
            value={selectedDate}
            onChange={(event) => setSelectedDate(event.target.value)}
            className="max-w-xs"
          />
        </Field>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        {snapshot.roomTypes.map((roomType) => {
          const remaining = Math.max(0, roomType.activeRooms - roomType.reservedPeak);
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
                <Metric label="예약" value={`${roomType.reservedPeak}실`} />
                <Metric label="잔여" value={`${remaining}실`} />
                <Metric label="입실 중" value={`${roomType.checkedInNow}실`} />
                <Metric label="현재 배정" value={`${roomType.allocatedNow}실`} />
                <Metric label="미배정" value={`${roomType.unassignedNow}건`} alert={roomType.unassignedNow > 0} />
              </dl>
            </Card>
          );
        })}
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-5 py-4 sm:px-6">
            <div>
              <h2 className="font-bold text-text-primary">선택 날짜 예약</h2>
              <p className="mt-0.5 text-xs text-text-secondary">총 {stays.length}건</p>
            </div>
            <BedDouble size={20} className="text-primary" />
          </div>
          {stays.length === 0 ? (
            <EmptyState title="이 날짜에 호텔 예약이 없습니다." description="호텔 예약은 여기에서 한 번만 등록하며 Calendar에 입·퇴실 일정이 자동 연결됩니다." />
          ) : (
            <div className="divide-y divide-border">
              {stays.map((stay) => (
                <StayRow key={stay.id} stay={stay} onClick={() => void openStay(stay.id)} />
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
                  <span className="mt-1 block text-xs text-text-secondary">{stay.capacityReservation?.roomTypeName} · {formatHotelDateTime(stay.capacityReservation?.reservedFrom ?? null)}</span>
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
        onEdit={() => setModal("reservation")}
        onAssign={() => setModal("assign")}
        onReassign={() => setModal("reassign")}
        onMove={() => setModal("move")}
        onCheckIn={() => setModal("checkin")}
        onCheckOut={() => setModal("checkout")}
        onCancel={() => { setCancelReason(""); setModal("cancel"); }}
        creatorName={options.assignees.find((person) => person.id === detail?.createdBy)?.name ?? null}
      />

      <HotelReservationModal open={modal === "reservation"} selectedDate={selectedDate} snapshot={snapshot} options={options} currentProfileId={profile?.id ?? ""} stay={detail} processing={processing} onClose={() => setModal(null)} onSubmit={detail ? onUpdate : onCreate} />
      {detail ? (
        <>
          <RoomAssignModal open={modal === "assign"} snapshot={snapshot} stay={detail} processing={processing} onClose={() => setModal(null)} onSubmit={(roomId, reason) => void runStayMutation(() => assignHotelRoom(detail.id, detail.version, roomId, reason, requestId()), "호실을 배정했습니다.")} />
          <RoomReassignModal open={modal === "reassign"} snapshot={snapshot} stay={detail} processing={processing} onClose={() => setModal(null)} onSubmit={(roomId, reason) => void runStayMutation(() => reassignHotelRoomBeforeCheckIn(detail.id, detail.version, roomId, reason, requestId()), "호실을 재배정했습니다.")} />
          <MoveRoomModal open={modal === "move"} snapshot={snapshot} stay={detail} processing={processing} onClose={() => setModal(null)} onSubmit={(roomId, moveAt, reason) => void runStayMutation(() => moveHotelRoomSameType(detail.id, detail.version, roomId, moveAt, reason, requestId()), "객실 이동을 기록했습니다.")} />
          <CheckInModal open={modal === "checkin"} stay={detail} processing={processing} onClose={() => setModal(null)} onSubmit={(completedAt) => void runStayMutation(() => completeHotelCheckIn(detail.id, detail.version, completedAt, requestId()), "입실 완료로 처리했습니다.")} />
          <CheckOutModal open={modal === "checkout"} stay={detail} processing={processing} onClose={() => setModal(null)} onSubmit={(completedAt) => void runStayMutation(() => completeHotelCheckOut(detail.id, detail.version, completedAt, requestId()), "퇴실 완료로 처리했습니다.")} />
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

function StayRow({ stay, onClick }: { stay: HotelStay; onClick: () => void }) {
  const status = hotelStayStatus(stay);
  return <button type="button" onClick={onClick} className="grid w-full gap-3 px-5 py-4 text-left transition hover:bg-primary-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-6"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><b className="truncate text-sm text-text-primary">{hotelStayTitle(stay)}</b><Badge tone={statusTone(status)}>{status}</Badge></div><p className="mt-1.5 text-sm text-text-secondary">🐶 {stay.dogName} · {stay.customerName ?? "보호자 미등록"}</p><p className="mt-1 text-xs text-text-muted">{formatHotelDateTime(stay.capacityReservation?.reservedFrom ?? null)} → {formatHotelDateTime(stay.capacityReservation?.reservedUntil ?? null)}</p></div><div className="flex items-center gap-2 text-sm font-semibold text-primary"><DoorOpen size={16} /> {currentAllocatedRoomName(stay)}</div></button>;
}

function StayDetailModal({ open, stay, loading, creatorName, onClose, onEdit, onAssign, onReassign, onMove, onCheckIn, onCheckOut, onCancel }: { open: boolean; stay: HotelStay | null; loading: boolean; creatorName: string | null; onClose: () => void; onEdit: () => void; onAssign: () => void; onReassign: () => void; onMove: () => void; onCheckIn: () => void; onCheckOut: () => void; onCancel: () => void }) {
  if (!stay && !loading) return null;
  const allocation = stay ? activeHotelAllocation(stay) : null;
  const status = stay ? hotelStayStatus(stay) : "예약";
  return <Modal open={open} title="호텔 예약 상세" onClose={onClose} wide resetKey={stay?.id}>{loading || !stay ? <LoadingState /> : <div className="space-y-6"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-xl font-bold text-text-primary">{hotelStayTitle(stay)}</h3><p className="mt-1 text-sm text-text-secondary">🐶 {stay.dogName} · {stay.customerName ?? "보호자 미등록"}</p></div><Badge tone={statusTone(status)}>{status}</Badge></div><dl className="grid gap-3 sm:grid-cols-2"><Detail label="객실 유형" value={stay.capacityReservation?.roomTypeName ?? "-"} icon={<Hotel size={16} />} /><Detail label="현재 호실" value={allocation?.roomName ?? "미배정"} icon={<DoorOpen size={16} />} /><Detail label="입실 예정" value={formatHotelDateTime(stay.capacityReservation?.reservedFrom ?? null)} icon={<CalendarDays size={16} />} /><Detail label="퇴실 예정" value={formatHotelDateTime(stay.capacityReservation?.reservedUntil ?? null)} icon={<CalendarDays size={16} />} /><Detail label="입실 완료" value={formatHotelDateTime(stay.checkedInAt)} icon={<CheckCircle2 size={16} />} /><Detail label="퇴실 완료" value={formatHotelDateTime(stay.checkedOutAt)} icon={<CheckCircle2 size={16} />} /></dl><div className="rounded-2xl bg-surface-secondary p-4 text-sm text-text-secondary"><p><b className="text-text-primary">담당자</b> {stay.scheduleEvents[0]?.schedule.assignees.map((person) => person.name ?? "이름 미등록").join(", ") || "미지정"}</p><p className="mt-2"><b className="text-text-primary">생성자</b> {creatorName ?? stay.createdBy}</p>{stay.customerPhone ? <p className="mt-2"><b className="text-text-primary">보호자 연락처</b> {stay.customerPhone}</p> : null}{hotelStayMemo(stay) ? <p className="mt-2 whitespace-pre-wrap"><b className="text-text-primary">메모</b> {hotelStayMemo(stay)}</p> : null}{stay.roomAllocations.length > 1 ? <p className="mt-2"><b className="text-text-primary">객실 이동</b> {stay.roomAllocations.map((row) => row.roomName).join(" → ")}</p> : null}</div><div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="secondary" onClick={onEdit}>예약 수정</Button>{!stay.checkedInAt && !allocation ? <Button type="button" variant="secondary" onClick={onAssign}>호실 배정</Button> : null}{!stay.checkedInAt && allocation ? <Button type="button" variant="secondary" onClick={onReassign}>호실 재배정</Button> : null}{stay.checkedInAt && !stay.checkedOutAt ? <Button type="button" variant="secondary" onClick={onMove}><MoveRight size={16} /> 객실 이동</Button> : null}{!stay.checkedInAt ? <Button type="button" onClick={onCheckIn}>입실 완료</Button> : null}{stay.checkedInAt && !stay.checkedOutAt ? <Button type="button" onClick={onCheckOut}>퇴실 완료</Button> : null}{!stay.checkedInAt ? <Button type="button" variant="danger" onClick={onCancel}>예약 취소</Button> : null}</div></div>}</Modal>;
}

function Detail({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return <div className="rounded-2xl border border-border bg-surface p-4"><dt className="flex items-center gap-2 text-xs text-text-secondary">{icon}{label}</dt><dd className="mt-2 text-sm font-semibold text-text-primary">{value}</dd></div>;
}
