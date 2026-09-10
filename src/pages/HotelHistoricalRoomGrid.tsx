import type { HistoricalBoard, HistoricalDayEvent } from './hotelHistoricalBoardRepository';
const labels: Record<HistoricalDayEvent, string> = {continuing:'이용 중',check_in:'당일 입실',check_out:'당일 퇴실',moved_in:'이동 입실',moved_out:'이동 퇴실',returned:'외출 복귀',left_for_absence:'외출 시작'};
const time = (value: string) => new Intl.DateTimeFormat('ko-KR', {timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value));
export function HotelHistoricalRoomGrid({history,error,onOpenStay}:{history?:HistoricalBoard;error?:string;onOpenStay:(id:string)=>void}) {
  return <section aria-label="선택일 실제 객실 사용 기록" className="space-y-4">
    <h2 className="text-xl font-bold">선택일 실제 객실 사용 기록</h2>
    <p>실제 투숙이 확인된 구간만 표시합니다. 외출·입실 전 예약은 투숙으로 표시하지 않습니다. 과거 기록은 조회만 가능합니다.</p>
    <p role="note">일부 이력은 확인할 수 없습니다. 표시된 반려견이 없더라도 당시 빈 객실이었다는 의미는 아닙니다. 객실명은 보관된 객실 목록 기준입니다.</p>
    {error ? <p role="alert">{error}</p> : !history ? <p role="status">기록 확인 중…</p> : <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{history.rooms.map(room => <article key={room.roomId} className="rounded-2xl border border-border p-4" aria-label={`${room.roomName} 사용 기록`}>
        <h3 className="font-bold">{room.roomName}</h3><p className="text-sm text-muted">{room.roomType}</p>
        {room.segments.length ? room.segments.map(s => <button type="button" key={s.segmentId} className="my-2 block w-full rounded-xl border border-border p-3 text-left" onClick={() => onOpenStay(s.stayId)}>
          <span className="font-semibold">{s.dogName}</span>{s.lifecycleKind === 'shared' ? <span> · 함께 투숙</span> : s.lifecycleKind === 'longstay' ? <span> · 장기호텔</span> : null}
          <span className="block text-sm">{time(s.displayFrom)}–{time(s.displayUntil)}</span>
          <span className="block text-sm">{s.selectedDayEvents.map(e => labels[e]).join(' · ')}</span>
        </button>) : <p className="mt-3 text-sm">확인된 사용 기록 없음</p>}
      </article>)}</div>
      {history.unavailable.length ? <section aria-label="과거 객실 확인 필요"><h3 className="font-bold">객실 정보 확인 필요</h3><p>아래 기록은 사용 객실을 확정할 증거가 부족합니다.</p>{history.unavailable.map(u => <button type="button" key={`${u.stayId}-${u.affectedFrom}-${u.affectedUntil}`} className="block py-2" onClick={() => onOpenStay(u.stayId)}>{u.dogName} · 객실 정보 확인 필요</button>)}</section> : null}
    </>}
  </section>;
}
