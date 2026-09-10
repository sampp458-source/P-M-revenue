import {useState} from 'react';
import {Badge, cn} from '../components/ui';
import {RoomBoardCellFrame, RoomBoardDesktopGroup, RoomBoardMobileGroup, roomStageClass} from './HotelRoomBoardPresentation';
import type { HistoricalBoard, HistoricalDayEvent, HistoricalSegment } from './hotelHistoricalBoardRepository';
const labels: Record<HistoricalDayEvent, string> = {continuing:'이용중',check_in:'당일 입실',check_out:'당일 퇴실',moved_in:'이동 입실',moved_out:'이동 퇴실',returned:'외출 복귀',left_for_absence:'외출 시작'};
const clock = new Intl.DateTimeFormat('ko-KR', {timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
function displayRange(from:number,until:number,date:string) {
 const dayEnd=Date.parse(`${date}T00:00:00+09:00`)+86_400_000;
 return `${clock.format(new Date(from))}–${until===dayEnd?'24:00':clock.format(new Date(until))}`;
}
type OccupantSlice={key:string;items:HistoricalSegment[];from:number;until:number};
// Sweep actual-use boundaries: a transitive A↔B↔C overlap never claims A+B+C
// were together. These slices are presentation only; resolver DTOs remain intact.
export function historicalOccupantSlices(segments:HistoricalSegment[]):OccupantSlice[] {
 const result:OccupantSlice[]=[]; const shared=new Map<string,HistoricalSegment[]>();
 for(const s of segments){
  if(s.lifecycleKind==='shared'&&s.physicalOccupancyId){
   const key=`${s.roomId}:${s.physicalOccupancyId}`;shared.set(key,[...(shared.get(key)??[]),s]);
  } else result.push({key:s.segmentId,items:[s],from:Date.parse(s.displayFrom),until:Date.parse(s.displayUntil)});
 }
 for(const [key,items] of shared){
  const boundaries=[...new Set(items.flatMap(s=>[Date.parse(s.usedFrom),Date.parse(s.usedUntil),Date.parse(s.displayFrom),Date.parse(s.displayUntil)]))].sort((a,b)=>a-b);
  for(let i=0;i<boundaries.length-1;i++){
   const from=boundaries[i],until=boundaries[i+1];
   const active=items.filter(s=>Date.parse(s.usedFrom)<until&&from<Date.parse(s.usedUntil)&&Date.parse(s.displayFrom)<=from&&until<=Date.parse(s.displayUntil));
   if(from>=until||!active.length)continue;
   if(new Set(active.map(s=>s.stayId)).size!==active.length){
    for(const s of active)result.push({key:`${s.segmentId}:${from}`,items:[s],from,until});
   }else result.push({key:`${key}:${from}`,items:active,from,until});
  }
 }
 return result.sort((a,b)=>a.from-b.from||a.key.localeCompare(b.key));
}
function phase(segments: HistoricalSegment[]) {
 const events=segments.flatMap(s=>s.selectedDayEvents);
 return events.includes('check_out')?'check_out':events.includes('check_in')?'check_in':segments.length?'in_house':null;
}
// Presentation only: no current stay/occupancy synthesis and no command callbacks.
function HistoricalOccupants({segments,onOpenStay,mobile,date}:{segments:HistoricalSegment[];onOpenStay:(id:string)=>void;mobile:boolean;date:string}) {
 const groups=historicalOccupantSlices(segments);
 return <div className="space-y-1.5">{groups.map(({key,items,from,until})=><div key={key} className={cn('w-full rounded-xl border text-left shadow-sm',mobile?'px-3 py-3':'px-2 py-2',roomStageClass(phase(items)))}>
  {items[0].lifecycleKind==='shared'&&items.length>1?<span className="flex items-center justify-between gap-1"><strong className="truncate text-sm">같은 방 투숙</strong><Badge tone="blue">공유</Badge></span>:null}
  {items.map(s=><button type="button" key={s.segmentId} onClick={()=>onOpenStay(s.stayId)} className="block w-full rounded-lg py-1 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary">
   <span className={cn('font-extrabold',mobile?'text-sm leading-5':'text-xs')}>{s.dogName}</span>
   {s.lifecycleKind==='shared'&&items.length===1?<Badge tone="blue">공유</Badge>:null}
   {s.lifecycleKind==='longstay'?<Badge tone="blue">장기호텔</Badge>:null}
   <span className="mt-1 block text-[10px] text-text-secondary">선택일 상태</span>
   <span className="block text-xs font-bold">{s.selectedDayEvents.map(e=>labels[e]).join(' · ')}</span>
   <span className="block text-xs font-semibold tabular-nums text-slate-600">선택일 표시 구간 {displayRange(from,until,date)}</span>
  </button>)}
  {items[0].lifecycleKind==='shared'&&items.length>1?<span className="mt-1 block text-xs font-semibold">함께 투숙 · {new Set(items.map(s=>s.stayId)).size}마리 · 객실 1실</span>:null}
 </div>)}</div>;
}
export function HotelHistoricalRoomGrid({history,error,onOpenStay,mobile=false}:{history?:HistoricalBoard;error?:string;onOpenStay:(id:string)=>void;mobile?:boolean}) {
 const [expanded,setExpanded]=useState<Record<string,boolean>>({});
 const types=history?[...new Set(history.rooms.map(r=>r.roomType))].sort((a,b)=>a==='DELUXE'?-1:b==='DELUXE'?1:a.localeCompare(b)):[];
 const renderRoom=(room:HistoricalBoard['rooms'][number])=><RoomBoardCellFrame key={room.roomId} mobile={mobile} data-testid={`hotel-room-board-room-${room.roomId}`} data-room-phase={phase(room.segments)??'empty'} className={roomStageClass(phase(room.segments))}>
  <div className="mb-1 flex min-w-0 items-center justify-between gap-1.5 px-0.5"><b className="whitespace-nowrap text-sm font-extrabold text-text-primary">{room.roomName}</b></div>
  {room.segments.length?<HistoricalOccupants segments={room.segments} onOpenStay={onOpenStay} mobile={mobile} date={history!.selectedDate}/>:<div aria-hidden="true" className="min-h-8"/>}
 </RoomBoardCellFrame>;
 return <section aria-label="선택일 실제 객실 사용 기록" className="space-y-4 p-4 sm:p-5">
  <h2 className="text-xl font-bold">선택일 실제 객실 사용 기록</h2>
  <p role="note" className="text-xs text-text-secondary">과거 기록은 조회만 가능합니다. 확인 가능한 실제 투숙 구간만 표시하며, 표시된 반려견이 없더라도 당시 빈 객실이었다는 의미는 아닙니다.</p>
  {error?<p role="alert">{error}</p>:!history?<p role="status">기록 확인 중…</p>:<>
   <div className={mobile?'space-y-3':'min-w-0 space-y-6 overflow-x-auto overscroll-x-contain pb-2'} data-testid={mobile?'hotel-room-board-mobile-projection':'hotel-room-board-desktop-projection'}>
    {types.map(type=>{
     const rooms=history.rooms.filter(r=>r.roomType===type);const used=rooms.filter(r=>r.segments.length);const unshown=rooms.filter(r=>!r.segments.length);
     const summary=`${used.length}실 기록 표시`;
     return mobile?<RoomBoardMobileGroup key={type} type={type} summary={summary} expanded={expanded[type]??true} onToggle={()=>setExpanded(x=>({...x,[type]:!(x[type]??true)}))}>
      {used.length?<div className="grid grid-cols-1 gap-3" data-testid={`${type.toLowerCase()}-mobile-occupied`}>{used.map(renderRoom)}</div>:null}
      {unshown.length?<div className={cn('grid grid-cols-2 gap-2',used.length>0&&'mt-3')} data-testid={`${type.toLowerCase()}-mobile-empty`}>{unshown.map(renderRoom)}</div>:null}
     </RoomBoardMobileGroup>:<RoomBoardDesktopGroup key={type} type={type} summary={summary}>{rooms.map(renderRoom)}</RoomBoardDesktopGroup>;
    })}
   </div>
   {history.unavailable.length?<details className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm" aria-label="과거 객실 확인 필요"><summary className="cursor-pointer font-bold text-amber-900">객실 정보 확인 필요 · {new Set(history.unavailable.map(u=>u.stayId)).size}마리</summary><div className="mt-2 flex flex-wrap gap-2">{[...new Map(history.unavailable.map(u=>[u.stayId,u])).values()].map(u=><button type="button" key={u.stayId} className="rounded-lg border border-amber-200 bg-white px-2 py-1" onClick={()=>onOpenStay(u.stayId)}>{u.dogName} · 객실 정보 확인 필요</button>)}</div></details>:null}
  </>}
 </section>;
}
