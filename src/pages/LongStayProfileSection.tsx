import { BedDouble, CalendarDays, Plus, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ProfileSection } from "../components/profile";
import {
  Badge,
  Button,
  EmptyState,
  Field,
  Input,
  Select,
  Textarea,
} from "../components/ui";
import { koDate } from "../lib/format";
import {
  createLongStayContract,
  getCustomerLongStays,
  getLongStayHotelVersion,
  getLongStayMonth,
  LongStayRepositoryError,
  newLongStayRequestId,
  reverseLongStayCompletion,
} from "../platform/longStayHotelRepository";
import type {
  LongStayContractProjection,
  LongStayMonthContractProjection,
} from "../platform/longStayHotelContract";
import {
  fetchHotelOperationsSnapshot,
  type HotelOperationsSnapshot,
} from "./hotelOperationsRepository";
import { seoulDateKey } from "./operationsScheduleRepository";

interface ProfileDogOption {
  id: string;
  name: string;
}

const currentMonthStart = () => `${seoulDateKey().slice(0, 7)}-01`;

const projectionStatus = (contract: LongStayContractProjection) => {
  if (contract.derivedStatus === "overstay") return { label: "초과체류", tone: "red" as const };
  if (contract.checkedOutAt) return { label: "완료", tone: "gray" as const };
  if (contract.isAway) return { label: "외출 중", tone: "amber" as const };
  if (contract.checkedInAt) return { label: "이용중", tone: "green" as const };
  return { label: "등록", tone: "blue" as const };
};

export function LongStayProfileSection({
  customerId,
  dogs,
  dogId,
}: {
  customerId: string;
  dogs: ProfileDogOption[];
  dogId?: string;
}) {
  const [contracts, setContracts] = useState<LongStayContractProjection[]>([]);
  const [monthContracts, setMonthContracts] = useState<LongStayMonthContractProjection[]>([]);
  const [snapshot, setSnapshot] = useState<HotelOperationsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selectedDogId, setSelectedDogId] = useState(dogId ?? dogs[0]?.id ?? "");
  const [startedOn, setStartedOn] = useState(seoulDateKey);
  const [plannedDate, setPlannedDate] = useState("");
  const [roomTypeId, setRoomTypeId] = useState("");
  const [roomId, setRoomId] = useState("");
  const [monthlyRate, setMonthlyRate] = useState("");
  const [billingDay, setBillingDay] = useState("1");
  const [memo, setMemo] = useState("");
  const [createRequestId, setCreateRequestId] = useState(newLongStayRequestId);
  const [reverseTarget, setReverseTarget] = useState<LongStayContractProjection | null>(null);
  const [reverseReason, setReverseReason] = useState("");
  const [reverseRequestId, setReverseRequestId] = useState(newLongStayRequestId);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [customerContracts, month, hotelSnapshot] = await Promise.all([
        getCustomerLongStays(customerId),
        getLongStayMonth(currentMonthStart()),
        fetchHotelOperationsSnapshot(seoulDateKey()),
      ]);
      setContracts(customerContracts);
      setMonthContracts(month.contracts.filter((contract) => contract.customerId === customerId));
      setSnapshot(hotelSnapshot);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "장기호텔 정보를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => void load(), [load]);
  useEffect(() => setSelectedDogId(dogId ?? dogs[0]?.id ?? ""), [dogId, dogs]);

  const visibleContracts = useMemo(
    () => contracts.filter((contract) => !dogId || contract.dogId === dogId),
    [contracts, dogId],
  );
  const roomTypes = snapshot?.roomTypes ?? [];
  const rooms = (snapshot?.rooms ?? []).filter(
    (room) => room.isActive && Boolean(roomTypeId) && room.roomTypeId === roomTypeId,
  );

  const submit = async () => {
    if (!selectedDogId || !startedOn || !monthlyRate || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      await createLongStayContract({
        customerId,
        dogId: selectedDogId,
        startedOn,
        plannedCheckOutDate: plannedDate || null,
        preferredRoomTypeId: roomTypeId || null,
        preferredRoomId: roomId || null,
        monthlyRate: Number(monthlyRate),
        billingAnchorDay: Number(billingDay),
        memo,
      }, createRequestId);
      setCreateOpen(false);
      setMonthlyRate("");
      setMemo("");
      await load();
    } catch (createError) {
      setError(
        createError instanceof LongStayRepositoryError || createError instanceof Error
          ? createError.message
          : "장기호텔 계약을 등록하지 못했습니다.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const submitReverse = async () => {
    if (!reverseTarget || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const stayVersion = await getLongStayHotelVersion(reverseTarget);
      if (stayVersion === null) throw new Error("연결된 호텔 이용 정보를 찾을 수 없습니다.");
      await reverseLongStayCompletion({
        contractId: reverseTarget.id,
        expectedContractVersion: reverseTarget.version,
        expectedStayVersion: stayVersion,
        reason: reverseReason || "장기호텔 퇴실 완료 취소",
      }, reverseRequestId);
      setReverseTarget(null);
      setReverseReason("");
      await load();
    } catch (reverseError) {
      if (reverseError instanceof LongStayRepositoryError && reverseError.kind === "conflict") {
        setReverseTarget(null);
        await load();
      }
      setError(reverseError instanceof Error ? reverseError.message : "퇴실 완료를 취소하지 못했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ProfileSection
      id={`long-stay-profile-${dogId ?? customerId}`}
      title="장기호텔"
      description="계약 상태와 이번 달 실제 객실 배정을 함께 확인합니다."
      action={
        <Button type="button" variant="secondary" disabled={!dogs.length} onClick={() => { setError(""); setReverseTarget(null); setCreateRequestId(newLongStayRequestId()); setCreateOpen(true); }}>
          <Plus size={15} /> 장기호텔 등록
        </Button>
      }
    >
      {loading ? (
        <p className="py-5 text-sm text-text-muted">장기호텔 정보를 확인하고 있습니다.</p>
      ) : visibleContracts.length ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {visibleContracts.map((contract) => {
            const status = projectionStatus(contract);
            const month = monthContracts.find((item) => item.id === contract.id);
            return (
              <article key={contract.id} className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2"><b>{contract.dogName || "반려견"}</b><Badge tone={status.tone}>{status.label}</Badge></div>
                    <p className="mt-1 text-sm text-text-secondary">시작 {koDate(contract.startedOn)}</p>
                  </div>
                  <BedDouble size={19} className="text-primary" />
                </div>
                <div className="mt-3 grid gap-1.5 text-sm text-text-secondary">
                  <span>현재 객실 <b className="text-text-primary">{contract.currentRoom?.name || "미배정"}</b></span>
                  <span>이번 달 객실 <b className="text-text-primary">{month?.monthlyOccupancy ? contract.currentRoom?.name || "확정" : "미배정"}</b></span>
                  <span>퇴실 예정 <b className="text-text-primary">{contract.plannedCheckOutDate ? koDate(contract.plannedCheckOutDate) : "미정"}</b></span>
                  {contract.isAway ? <span className="font-semibold text-warning">외출 중 · 객실과 Capacity 유지</span> : null}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button type="button" variant="ghost" className="px-0" onClick={() => window.location.assign("/operations/hotel")}><CalendarDays size={15} /> 월 객실 배정·상세</Button>
                  {contract.checkedOutAt ? <Button type="button" variant="secondary" onClick={() => { setError(""); setCreateOpen(false); setReverseTarget(contract); setReverseReason(""); setReverseRequestId(newLongStayRequestId()); }}><RotateCcw size={15} /> 완료 취소</Button> : null}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <EmptyState compact title="등록된 장기호텔 계약이 없습니다." description="계약 등록 후 월별 객실은 Hotel Operations에서 확정합니다." />
      )}
      {error ? <p role="alert" className="mt-3 rounded-xl bg-error-soft p-3 text-sm text-error">{error}</p> : null}

      {createOpen ? (
        <div className="mt-4 space-y-4 rounded-2xl border border-primary/20 bg-primary-subtle/40 p-4 sm:p-5" aria-label="장기호텔 등록 양식">
          <div><h3 className="font-bold text-text-primary">장기호텔 등록</h3><p className="mt-1 text-xs text-text-secondary">계약을 등록한 뒤 월별 객실은 Hotel Operations에서 확정합니다.</p></div>
          <Field label="반려견" required><Select value={selectedDogId} disabled={Boolean(dogId)} onChange={(event) => setSelectedDogId(event.target.value)}>{dogs.map((dog) => <option key={dog.id} value={dog.id}>{dog.name}</option>)}</Select></Field>
          <div className="grid gap-4 sm:grid-cols-2"><Field label="시작일" required><Input type="date" value={startedOn} onChange={(event) => setStartedOn(event.target.value)} /></Field><Field label="퇴실 예정일"><Input type="date" value={plannedDate} min={startedOn} onChange={(event) => setPlannedDate(event.target.value)} /></Field></div>
          <div className="grid gap-4 sm:grid-cols-2"><Field label="선호 객실 유형"><Select value={roomTypeId} onChange={(event) => { setRoomTypeId(event.target.value); setRoomId(""); }}><option value="">미정</option>{roomTypes.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}</Select></Field><Field label="선호 호실"><Select value={roomId} onChange={(event) => setRoomId(event.target.value)}><option value="">미정</option>{rooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}</Select></Field></div>
          <div className="grid gap-4 sm:grid-cols-2"><Field label="월 금액" required><Input type="number" min="0" step="1000" value={monthlyRate} onChange={(event) => setMonthlyRate(event.target.value)} /></Field><Field label="결제 기준일" help="객실의 월별 배정 기준과는 독립적입니다."><Input type="number" min="1" max="31" value={billingDay} onChange={(event) => setBillingDay(event.target.value)} /></Field></div>
          <Field label="메모"><Textarea value={memo} onChange={(event) => setMemo(event.target.value)} /></Field>
          <p className="rounded-xl bg-primary-subtle p-3 text-xs leading-5 text-text-secondary">등록은 계약만 생성합니다. 이번 달 객실은 Hotel Operations에서 직원이 별도로 확정합니다.</p>
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" disabled={submitting} onClick={() => setCreateOpen(false)}>취소</Button><Button type="button" disabled={submitting || !selectedDogId || !startedOn || Number(monthlyRate) < 0 || !monthlyRate} onClick={() => void submit()}>{submitting ? "등록 중..." : "계약 등록"}</Button></div>
        </div>
      ) : null}
      {reverseTarget ? (
        <div className="mt-4 space-y-4 rounded-2xl border border-warning/25 bg-warning-soft/50 p-4 sm:p-5" aria-label="장기호텔 퇴실 완료 취소 양식">
          <h3 className="font-bold text-text-primary">장기호텔 퇴실 완료 취소</h3>
          <p className="rounded-xl bg-warning-soft p-3 text-sm text-text-secondary">완료를 취소하면 기존 Hotel Capacity와 현재 호실 점유가 다시 복원됩니다.</p>
          <Field label="처리 사유"><Input value={reverseReason} onChange={(event) => setReverseReason(event.target.value)} placeholder="장기호텔 퇴실 완료 취소" /></Field>
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" disabled={submitting} onClick={() => setReverseTarget(null)}>닫기</Button><Button type="button" disabled={submitting} onClick={() => void submitReverse()}>{submitting ? "처리 중..." : "완료 취소"}</Button></div>
        </div>
      ) : null}
    </ProfileSection>
  );
}
