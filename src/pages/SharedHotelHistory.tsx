import type { SharedHistory } from './sharedHotelHistoryRepository';
const time = (value: string) => new Intl.DateTimeFormat('ko-KR', {timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value));
export function SharedHotelHistory({history,error,onOpenStay}:{history?:SharedHistory;error?:string;onOpenStay:(id:string)=>void}) {
  const rooms = new Map<string, SharedHistory['segments']>();
  for (const segment of history?.segments ?? []) rooms.set(segment.roomId,[...(rooms.get(segment.roomId) ?? []),segment]);
  return <section aria-label="함께 투숙 실제 사용 기록" className="space-y-3 rounded-2xl border border-border p-4">
    <h2 className="text-xl font-bold">선택일 함께 투숙 기록</h2>
    <p>해당 날짜와 겹치는 실제 함께 투숙 구간입니다. 입실 전 예약 시간은 포함하지 않습니다.</p>
    <p>Single·장기호텔의 과거 객실 복원은 아직 지원하지 않습니다. 과거 날짜에서는 현재 운영 상태를 변경할 수 없습니다.</p>
    {error ? <p role="alert">{error}</p> : !history ? <p role="status">기록 확인 중…</p> : <>
      {[...rooms].map(([roomId,segments]) => <article key={roomId} className="rounded-xl border border-border p-3"><h3 className="font-bold">{segments[0].roomName}</h3>
        {segments.map(s => <button type="button" className="block py-2 text-left" key={`${s.hotelStayId}-${s.usedFrom}`} onClick={()=>onOpenStay(s.hotelStayId)}>{s.dogName} · {time(s.displayFrom)}–{time(s.displayUntil)}</button>)}
      </article>)}
      {history.unavailableMembers.length ? <section aria-label="과거 객실 확인 필요"><h3>객실 정보 확인 필요</h3>{history.unavailableMembers.map(m=><button type="button" key={m.hotelStayId} onClick={()=>onOpenStay(m.hotelStayId)} className="block py-2">{m.dogName} · 객실 정보 확인 필요</button>)}</section> : null}
      {!history.segments.length && !history.unavailableMembers.length ? <p>해당 날짜에 확인된 함께 투숙 기록이 없습니다.</p> : null}
    </>}
  </section>;
}
