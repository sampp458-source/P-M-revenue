import type { HotelOperationsSnapshot } from './hotelOperationsRepository';
import './hotel-selected-date-summary.css';
import './hotel-long-stay-room-type.css';

/** Server-projected values only: no interval, capacity or identity arithmetic. */
export function HotelSelectedDateSummary({ snapshot, selectedDate, assigned, checkIn, checkOut }: {
  snapshot: HotelOperationsSnapshot;
  selectedDate: string;
  assigned: number;
  checkIn: number;
  checkOut: number;
}) {
  const current = snapshot.date === selectedDate;
  const unknown = Boolean(snapshot.individualTypeAvailabilityWarning
    || snapshot.roomTypeUnspecified?.reservationCount
    || snapshot.unassignedRoomTypeCount);
  const projection = current && snapshot.selectedDateUnassigned?.date === selectedDate
    ? snapshot.selectedDateUnassigned : undefined;
  return <section className="hotel-selected-date-summary" aria-label="선택일 계획 요약">
    <p className="hotel-selected-date-summary-label">선택일 계획 여유</p>
    <dl className="hotel-selected-date-capacity">
      {snapshot.roomTypes.map(type => {
        // Missing conservative evidence must never fall back to an optimistic value.
        const remaining = !current ? undefined : unknown || (type.affectedByUnspecifiedCount ?? 0) > 0
          ? type.conservativeRemaining
          : type.conservativeRemaining ?? snapshot.confirmedRemainingByType?.[type.code] ?? type.confirmedRemaining;
        return <div key={type.id} data-room-type={type.code}><dt>{type.code}</dt><dd>{remaining ?? '확인 필요'}{remaining !== undefined && <small>실</small>}</dd></div>;
      })}
    </dl>
    {unknown && <p className="hotel-selected-date-note" role="status">객실 유형 미정 예약을 반영한 보수적 수치입니다. 유형 확정 시 달라질 수 있습니다.</p>}
    <dl className="hotel-selected-date-facts">
      <div><dt>배정</dt><dd>{current ? assigned : '확인 중'}{current && <small>실</small>}</dd></div>
      <div><dt>미배정</dt><dd>{projection ? projection.count : '확인 필요'}{projection && <small>건</small>}</dd></div>
      <div><dt>입실</dt><dd>{current ? checkIn : '확인 중'}</dd></div>
      <div><dt>퇴실</dt><dd>{current ? checkOut : '확인 중'}</dd></div>
    </dl>
    <p className="hotel-selected-date-note">선택일 기준 · 실제 예약 가능 여부는 전체 숙박 기간에 따라 달라질 수 있습니다.</p>
  </section>;
}
