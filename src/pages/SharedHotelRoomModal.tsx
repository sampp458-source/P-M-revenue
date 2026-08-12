import { BedDouble, LogIn, LogOut, MoveRight, RotateCcw, UsersRound } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Field, Input, LoadingState, Modal, Select } from "../components/ui";
import type { SharedHotelOccupancy } from "../platform/multiDogSharedRoomContract";
import {
  sharedHotelRoomErrorMessage,
  sharedHotelRoomRepository,
} from "../platform/multiDogSharedRoomRepository";
import type { OperationRole } from "./operationsScheduleRepository";
import {
  fetchHotelStay,
  type HotelOperationsSnapshot,
  type HotelStay,
} from "./hotelOperationsRepository";
import { activeHotelAllocation } from "./hotelOperationsUi";
import { hotelRoomBoardDogStatus } from "./HotelRoomBoard";

export interface ExistingStaySharedRoomCandidate {
  stay: HotelStay;
  roomId: string;
  roomName: string;
}

export function existingStaySharedRoomCandidates(
  joiningStay: HotelStay,
  stays: readonly HotelStay[],
  sharedOccupancies: readonly SharedHotelOccupancy[],
): ExistingStaySharedRoomCandidate[] {
  const joiningCapacity = joiningStay.capacityReservation;
  if (
    !joiningStay.customerId ||
    joiningStay.checkedOutAt ||
    joiningCapacity?.roomTypeCode !== "DELUXE"
  ) return [];
  const sharedStayIds = new Set(
    sharedOccupancies.flatMap((occupancy) =>
      occupancy.members.map((member) => member.hotelStayId),
    ),
  );
  if (sharedStayIds.has(joiningStay.id)) return [];
  return stays.flatMap((stay) => {
    const capacity = stay.capacityReservation;
    const allocation = activeHotelAllocation(stay);
    if (
      stay.id === joiningStay.id ||
      stay.customerId !== joiningStay.customerId ||
      stay.checkedOutAt ||
      sharedStayIds.has(stay.id) ||
      capacity?.roomTypeCode !== "DELUXE" ||
      capacity.reservedFrom !== joiningCapacity.reservedFrom ||
      capacity.reservedUntil !== joiningCapacity.reservedUntil ||
      !allocation
    ) return [];
    return [{ stay, roomId: allocation.roomId, roomName: allocation.roomName }];
  });
}

export function ExistingStaySharedRoomMergeModal({
  joiningStay,
  candidates,
  processing,
  onClose,
  onMerged,
}: {
  joiningStay: HotelStay | null;
  candidates: readonly ExistingStaySharedRoomCandidate[];
  processing: boolean;
  onClose: () => void;
  onMerged: (occupancy: SharedHotelOccupancy) => void | Promise<void>;
}) {
  const [primaryStayId, setPrimaryStayId] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [merging, setMerging] = useState(false);

  useEffect(() => {
    if (!joiningStay) return;
    setPrimaryStayId(candidates[0]?.stay.id ?? "");
    setConfirmed(false);
    setError("");
    setMerging(false);
  }, [candidates, joiningStay]);

  if (!joiningStay) return null;
  const selected = candidates.find((candidate) => candidate.stay.id === primaryStayId);
  return (
    <Modal open title="같은 방 투숙" onClose={onClose} resetKey={joiningStay.id}>
      <form className="space-y-5" onSubmit={(event) => {
        event.preventDefault();
        if (!selected || !confirmed || processing || merging) return;
        setError("");
        setMerging(true);
        void sharedHotelRoomRepository.mergeExistingStays(
          [selected.stay.id, joiningStay.id],
          [selected.stay.version, joiningStay.version],
          crypto.randomUUID(),
        ).then(onMerged).catch((mergeError) => setError(sharedHotelRoomErrorMessage(mergeError))).finally(() => setMerging(false));
      }}>
        <div className="rounded-2xl border border-violet-200 bg-violet-50 p-4 text-sm text-violet-950">
          <strong>{joiningStay.dogName}</strong>의 기존 예약을 유지하면서 DELUXE 객실 하나를 함께 사용합니다.
        </div>
        <Field label="함께 투숙할 반려견">
          <Select value={primaryStayId} onChange={(event) => setPrimaryStayId(event.target.value)}>
            {candidates.map((candidate) => (
              <option key={candidate.stay.id} value={candidate.stay.id}>
                {candidate.stay.dogName} · {candidate.roomName}
              </option>
            ))}
          </Select>
        </Field>
        <label className="flex items-start gap-3 rounded-2xl border border-border p-4 text-sm">
          <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
          <span><b>같은 방 투숙</b><br /><span className="text-text-secondary">두 예약의 입·퇴실 기간이 같으며 객실과 Capacity는 1실만 사용합니다.</span></span>
        </label>
        {error ? <p role="alert" className="rounded-xl bg-error-soft px-3 py-2 text-sm font-medium text-error">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={processing || merging}>닫기</Button>
          <Button disabled={processing || merging || !selected || !confirmed}>{processing || merging ? "처리 중…" : "같은 방으로 배정"}</Button>
        </div>
      </form>
    </Modal>
  );
}

const localDateTime = () => {
  const date = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000);
  return date.toISOString().slice(0, 16);
};

export function SharedHotelRoomModal({
  occupancy,
  snapshot,
  selectedDate,
  operationRole,
  onClose,
  onChanged,
}: {
  occupancy: SharedHotelOccupancy | null;
  snapshot: HotelOperationsSnapshot;
  selectedDate: string;
  operationRole: OperationRole | null;
  onClose: () => void;
  onChanged: (occupancy: SharedHotelOccupancy) => void | Promise<void>;
}) {
  const [stays, setStays] = useState<Record<string, HotelStay>>({});
  const [loading, setLoading] = useState(false);
  const [processingMemberId, setProcessingMemberId] = useState<string | null>(null);
  const [completedAt, setCompletedAt] = useState(localDateTime);
  const [moveRoomId, setMoveRoomId] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!occupancy) {
      setStays({});
      return;
    }
    let active = true;
    setLoading(true);
    setError("");
    void Promise.all(occupancy.members.map((member) => fetchHotelStay(member.hotelStayId)))
      .then((rows) => {
        if (active) setStays(Object.fromEntries(rows.map((stay) => [stay.id, stay])));
      })
      .catch((loadError) => {
        if (active) setError(sharedHotelRoomErrorMessage(loadError));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [occupancy]);

  const deluxeRooms = useMemo(
    () => snapshot.rooms.filter((room) => room.isActive && room.roomTypeCode === "DELUXE" && room.id !== occupancy?.roomId),
    [occupancy?.roomId, snapshot.rooms],
  );

  if (!occupancy) return null;

  const refresh = async (next: SharedHotelOccupancy) => {
    await onChanged(next);
    const rows = await Promise.all(next.members.map((member) => fetchHotelStay(member.hotelStayId)));
    setStays(Object.fromEntries(rows.map((stay) => [stay.id, stay])));
  };

  const memberAction = async (
    memberId: string,
    action: (stay: HotelStay) => Promise<{ occupancy: SharedHotelOccupancy }>,
  ) => {
    const member = occupancy.members.find((candidate) => candidate.id === memberId);
    const stay = member ? stays[member.hotelStayId] : null;
    if (!stay) return;
    setProcessingMemberId(memberId);
    setError("");
    try {
      const result = await action(stay);
      await refresh(result.occupancy);
    } catch (actionError) {
      setError(sharedHotelRoomErrorMessage(actionError));
      const latest = await sharedHotelRoomRepository.get(occupancy.id).catch(() => null);
      if (latest) await refresh(latest);
    } finally {
      setProcessingMemberId(null);
    }
  };

  return (
    <Modal open title={`${occupancy.roomName} · Shared Room`} onClose={onClose} resetKey={occupancy.id}>
      <div className="space-y-4">
        <div className="rounded-2xl border border-violet-200 bg-violet-50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-2"><UsersRound size={18} /><strong>다견 DELUXE 공유 객실</strong></span>
            <Badge tone={occupancy.status === "active" ? "green" : "gray"}>{occupancy.status === "active" ? "사용 중" : "완료"}</Badge>
          </div>
          <p className="mt-2 text-sm text-violet-800">객실 1 · 반려견 {occupancy.dogCount}마리 · Capacity {occupancy.capacityUsed}</p>
        </div>
        {loading ? <LoadingState /> : occupancy.members.map((member) => {
          const stay = stays[member.hotelStayId];
          const busy = processingMemberId === member.id;
          const status = stay ? hotelRoomBoardDogStatus(stay, selectedDate) : null;
          return (
            <article key={member.id} className="rounded-2xl border border-border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong>{member.dogName}</strong>
                <span className="flex items-center gap-1.5">
                  {status ? <Badge tone={status.stage === "in_house" ? "green" : status.stage === "check_out" ? "amber" : "blue"}>{status.label}</Badge> : null}
                  <Badge tone={member.status === "active" ? "blue" : "gray"}>{member.status === "active" ? "객실 이용" : "퇴실 완료"}</Badge>
                </span>
              </div>
              <p className="mt-1 text-xs text-text-muted">{stay?.checkedInAt ? "입실 완료" : "입실 전"}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {member.status === "active" && !stay?.checkedInAt ? (
                  <Button disabled={busy} onClick={() => void memberAction(member.id, (current) => sharedHotelRoomRepository.checkIn(occupancy.id, current.id, occupancy.version, current.version, new Date(completedAt).toISOString(), crypto.randomUUID()))}><LogIn size={15} />입실</Button>
                ) : null}
                {member.status === "active" && stay?.checkedInAt ? (
                  <Button disabled={busy} onClick={() => void memberAction(member.id, (current) => sharedHotelRoomRepository.checkOut(occupancy.id, current.id, occupancy.version, current.version, new Date(completedAt).toISOString(), crypto.randomUUID()))}><LogOut size={15} />Dog별 퇴실</Button>
                ) : null}
                {member.status === "completed" && (operationRole === "owner" || operationRole === "manager") ? (
                  <Button variant="secondary" disabled={busy || !reason.trim()} onClick={() => void memberAction(member.id, (current) => sharedHotelRoomRepository.reverseCompletion(occupancy.id, current.id, occupancy.version, current.version, reason, crypto.randomUUID()))}><RotateCcw size={15} />완료 취소</Button>
                ) : null}
              </div>
            </article>
          );
        })}
        <Field label="처리 시각"><Input type="datetime-local" value={completedAt} onChange={(event) => setCompletedAt(event.target.value)} /></Field>
        <Field label="이동/완료 취소 사유"><Input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="운영 사유 입력" /></Field>
        {occupancy.status === "active" ? (
          <div className="rounded-2xl border border-border p-4">
            <strong className="flex items-center gap-2 text-sm"><MoveRight size={16} />공유 그룹 전체 이동</strong>
            <p className="mt-1 text-xs text-text-muted">개별 Dog 분리와 STANDARD 이동은 지원하지 않습니다.</p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
              <Field label="다른 DELUXE 호실"><Select value={moveRoomId} onChange={(event) => setMoveRoomId(event.target.value)}><option value="">호실 선택</option>{deluxeRooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}</Select></Field>
              <Button variant="secondary" disabled={!moveRoomId || !reason.trim() || Boolean(processingMemberId)} onClick={() => {
                setProcessingMemberId("move");
                setError("");
                void sharedHotelRoomRepository.move(occupancy.id, moveRoomId, occupancy.version, reason, crypto.randomUUID())
                  .then(refresh)
                  .catch(async (moveError) => {
                    setError(sharedHotelRoomErrorMessage(moveError));
                    const latest = await sharedHotelRoomRepository.get(occupancy.id).catch(() => null);
                    if (latest) await refresh(latest);
                  })
                  .finally(() => setProcessingMemberId(null));
              }}><BedDouble size={15} />DELUXE로 전체 이동</Button>
            </div>
          </div>
        ) : null}
        {error ? <p role="alert" className="rounded-xl bg-error-soft px-3 py-2 text-sm font-medium text-error">{error}</p> : null}
      </div>
    </Modal>
  );
}
