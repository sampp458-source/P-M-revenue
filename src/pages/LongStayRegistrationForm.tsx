import { useEffect, useMemo, useState } from "react";
import { Button, Field, Input, Select, Textarea } from "../components/ui";
import {
  createLongStayContract,
  LongStayRepositoryError,
  newLongStayRequestId,
} from "../platform/longStayHotelRepository";
import type { LongStayContractProjection } from "../platform/longStayHotelContract";
import {
  fetchHotelOperationsSnapshot,
  type HotelOperationsSnapshot,
} from "./hotelOperationsRepository";
import { seoulDateKey } from "./operationsScheduleRepository";

export interface LongStayRegistrationCustomerOption {
  id: string;
  name: string | null;
}

export interface LongStayRegistrationDogOption {
  id: string;
  name: string;
  customerId?: string | null;
}

export interface LongStayRegistrationPrefill {
  customerId?: string;
  dogId?: string;
  startedOn?: string;
}

export function LongStayRegistrationForm({
  customers,
  dogs,
  prefill,
  initialHotelSnapshot,
  onSaved,
  onCancel,
}: {
  customers: LongStayRegistrationCustomerOption[];
  dogs: LongStayRegistrationDogOption[];
  prefill?: LongStayRegistrationPrefill;
  initialHotelSnapshot?: HotelOperationsSnapshot | null;
  onSaved: (contract: LongStayContractProjection) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [customerId, setCustomerId] = useState(prefill?.customerId ?? "");
  const [dogId, setDogId] = useState(prefill?.dogId ?? "");
  const [startedOn, setStartedOn] = useState(prefill?.startedOn ?? seoulDateKey());
  const [plannedDate, setPlannedDate] = useState("");
  const [roomTypeId, setRoomTypeId] = useState("");
  const [roomId, setRoomId] = useState("");
  const [monthlyRate, setMonthlyRate] = useState("");
  const [billingDay, setBillingDay] = useState("1");
  const [memo, setMemo] = useState("");
  const [snapshot, setSnapshot] = useState<HotelOperationsSnapshot | null>(initialHotelSnapshot ?? null);
  const [loading, setLoading] = useState(!initialHotelSnapshot);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [requestId] = useState(newLongStayRequestId);

  useEffect(() => {
    if (initialHotelSnapshot) {
      setSnapshot(initialHotelSnapshot);
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    void fetchHotelOperationsSnapshot(startedOn || seoulDateKey())
      .then((value) => {
        if (active) setSnapshot(value);
      })
      .catch(() => {
        if (active) setError("객실 정보를 불러오지 못했습니다.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [initialHotelSnapshot, startedOn]);

  const availableDogs = useMemo(
    () => dogs.filter((dog) => !customerId || !dog.customerId || dog.customerId === customerId),
    [customerId, dogs],
  );
  const roomTypes = snapshot?.roomTypes ?? [];
  const rooms = (snapshot?.rooms ?? []).filter(
    (room) => room.isActive && Boolean(roomTypeId) && room.roomTypeId === roomTypeId,
  );

  const submit = async () => {
    if (!customerId || !dogId || !startedOn || !monthlyRate || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const contract = await createLongStayContract({
        customerId,
        dogId,
        startedOn,
        plannedCheckOutDate: plannedDate || null,
        preferredRoomTypeId: roomTypeId || null,
        preferredRoomId: roomId || null,
        monthlyRate: Number(monthlyRate),
        billingAnchorDay: Number(billingDay),
        memo,
      }, requestId);
      await onSaved(contract);
    } catch (submissionError) {
      setError(
        submissionError instanceof LongStayRepositoryError || submissionError instanceof Error
          ? submissionError.message
          : "장기호텔 계약을 등록하지 못했습니다.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4" aria-label="장기호텔 등록 양식">
      <div><h3 className="font-bold text-text-primary">장기호텔 등록</h3><p className="mt-1 text-xs text-text-secondary">계약을 등록한 뒤 월별 객실은 Hotel Operations에서 확정합니다.</p></div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="보호자" required>
          <Select aria-label="보호자" value={customerId} disabled={Boolean(prefill?.customerId)} onChange={(event) => { setCustomerId(event.target.value); setDogId(""); }}>
            <option value="">보호자 선택</option>
            {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name || "이름 미등록"}</option>)}
          </Select>
        </Field>
        <Field label="반려견" required>
          <Select aria-label="반려견" value={dogId} disabled={Boolean(prefill?.dogId)} onChange={(event) => setDogId(event.target.value)}>
            <option value="">반려견 선택</option>
            {availableDogs.map((dog) => <option key={dog.id} value={dog.id}>{dog.name}</option>)}
          </Select>
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2"><Field label="계약 시작일" required><Input aria-label="계약 시작일" type="date" value={startedOn} onChange={(event) => setStartedOn(event.target.value)} /></Field><Field label="퇴실 예정일"><Input type="date" value={plannedDate} min={startedOn} onChange={(event) => setPlannedDate(event.target.value)} /></Field></div>
      <div className="grid gap-4 sm:grid-cols-2"><Field label="선호 객실 유형"><Select value={roomTypeId} disabled={loading} onChange={(event) => { setRoomTypeId(event.target.value); setRoomId(""); }}><option value="">미정</option>{roomTypes.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}</Select></Field><Field label="선호 호실"><Select value={roomId} disabled={loading} onChange={(event) => setRoomId(event.target.value)}><option value="">미정</option>{rooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}</Select></Field></div>
      <div className="grid gap-4 sm:grid-cols-2"><Field label="월 금액" required><Input aria-label="월 금액" type="number" min="0" step="1000" value={monthlyRate} onChange={(event) => setMonthlyRate(event.target.value)} /></Field><Field label="결제 기준일" help="객실의 월별 배정 기준과는 독립적입니다."><Input type="number" min="1" max="31" value={billingDay} onChange={(event) => setBillingDay(event.target.value)} /></Field></div>
      <Field label="메모"><Textarea value={memo} onChange={(event) => setMemo(event.target.value)} /></Field>
      <p className="rounded-xl bg-primary-subtle p-3 text-xs leading-5 text-text-secondary">등록은 계약만 생성합니다. 이번 달 객실은 Hotel Operations에서 직원이 별도로 확정합니다.</p>
      {error ? <p role="alert" className="rounded-xl bg-error-soft p-3 text-sm text-error">{error}</p> : null}
      <div className="flex justify-end gap-2"><Button type="button" variant="secondary" disabled={submitting} onClick={onCancel}>취소</Button><Button type="button" disabled={loading || submitting || !customerId || !dogId || !startedOn || Number(monthlyRate) < 0 || !monthlyRate} onClick={() => void submit()}>{submitting ? "등록 중..." : "계약 등록"}</Button></div>
    </div>
  );
}
