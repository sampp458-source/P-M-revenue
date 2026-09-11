import {useState} from 'react';
import {Clock3, TriangleAlert} from 'lucide-react';
import {Badge, Modal, cn} from '../components/ui';
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
 const [detail,setDetail]=useState<OccupantSlice|null>(null);
 return <><div className="space-y-1.5">{groups.map(slice=>{const {key,items}=slice;return <div key={key} className={cn('w-full rounded-xl border text-left shadow-sm',mobile?'px-3 py-3':'px-2 py-2',roomStageClass(phase(items)))}>
  {items[0].lifecycleKind==='shared'&&items.length>1?<span className="flex items-center justify-between gap-1"><strong className="min-w-0 break-words text-sm">같은 방 투숙</strong><Badge tone="blue">공유</Badge></span>:null}
  {items.map(s=><button type="button" key={s.segmentId} onClick={()=>onOpenStay(s.stayId)} className="block w-full rounded-lg py-1 text-left transition-colors duration-150 hover:bg-white/40 motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-primary">
   <span className={cn('break-words font-extrabold',mobile?'text-sm leading-5':'text-xs')}>{s.dogName}</span>
   {s.lifecycleKind==='shared'&&items.length===1?<Badge tone="blue">공유</Badge>:null}
   {s.lifecycleKind==='longstay'?<Badge tone="blue">장기호텔</Badge>:null}
   <span className="block text-xs font-bold">{s.selectedDayEvents.map(e=>labels[e]).join(' · ')}</span>
  </button>)}
  {items[0].lifecycleKind==='shared'&&items.length>1?<span className="mt-1 block text-xs font-semibold">함께 투숙 · {new Set(items.map(s=>s.stayId)).size}마리 · 객실 1실</span>:null}
  <button type="button" aria-label={`${items.map(s=>s.dogName).join(' · ')} 투숙 시간 상세`} onClick={()=>setDetail(slice)} className="mt-1 rounded p-1 text-text-muted hover:text-text-primary focus-visible:ring-2 focus-visible:ring-primary"><Clock3 size={14}/></button>
 </div>;})}</div>
 <Modal open={detail!==null} title="투숙 시간" onClose={()=>setDetail(null)} size="small">
  {detail?<div className="space-y-3 text-sm"><p className="font-bold">{detail.items.map(s=>s.dogName).join(' · ')}</p><p>선택일 표시 구간 {displayRange(detail.from,detail.until,date)}</p><p className="text-xs text-text-secondary">선택한 날짜 안에서 표시하는 시간입니다. 실제 입·퇴실 및 이동 시각과는 다를 수 있습니다.</p>{detail.items.map(s=><div key={s.segmentId}><p>{s.dogName} · 선택일 상태: {s.selectedDayEvents.map(e=>labels[e]).join(' · ')}</p><p className="text-xs text-text-secondary">객실 사용 구간: {new Date(s.usedFrom).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})} – {new Date(s.usedUntil).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})}</p></div>)}</div>:null}
 </Modal></>;
}
function unavailableExplanation(reason:string):string {
 if(reason.includes('SHARED'))return '함께 투숙한 참여 시간이나 객실을 확인할 수 없습니다.';
 if(reason.includes('ABSENCE')||reason.includes('LONGSTAY'))return '외출·복귀를 포함한 객실 사용 시간을 확인할 수 없습니다.';
 if(reason.includes('TRANSITION')||reason.includes('REVERSAL'))return '객실 변경 또는 취소 전후의 사용 구간을 확인할 수 없습니다.';
 if(reason.includes('CONFLICT')||reason.includes('AMBIGU'))return '객실 정보가 서로 일치하지 않습니다.';
 return '해당 시간의 객실을 확인할 근거가 충분하지 않습니다.';
}
export function HotelHistoricalRoomGrid({history,error,onOpenStay,mobile=false}:{history?:HistoricalBoard;error?:string;onOpenStay:(id:string)=>void;mobile?:boolean}) {
 const [expanded,setExpanded]=useState<Record<string,boolean>>({});
 const types=history?[...new Set(history.rooms.map(r=>r.roomType))].sort((a,b)=>a==='DELUXE'?-1:b==='DELUXE'?1:a.localeCompare(b)):[];
 const renderRoom=(room:HistoricalBoard['rooms'][number])=><RoomBoardCellFrame key={room.roomId} mobile={mobile} data-testid={`hotel-room-board-room-${room.roomId}`} data-room-phase={phase(room.segments)??'empty'} className={roomStageClass(phase(room.segments))}>
  <div className="mb-1 flex min-w-0 items-center justify-between gap-1.5 px-0.5"><b className="whitespace-nowrap text-sm font-extrabold text-text-primary">{room.roomName}</b></div>
  {room.segments.length?<HistoricalOccupants segments={room.segments} onOpenStay={onOpenStay} mobile={mobile} date={history!.selectedDate}/>:<div aria-hidden="true" className="min-h-8"/>}
 </RoomBoardCellFrame>;
 const segments=history?.rooms.flatMap(r=>r.segments)??[];
 const count=(event?:HistoricalDayEvent)=>new Set(segments.filter(s=>!event||s.selectedDayEvents.includes(event)).map(s=>s.stayId)).size;
 return <section aria-label="Room Board">
  <div className="border-b border-border px-4 py-4 sm:px-5 lg:px-6">
   <p className={cn('font-extrabold uppercase tracking-[0.16em] text-primary',mobile?'text-xs':'text-[11px]')}>Room Board</p>
   <h2 className="mt-1 text-xl font-extrabold text-text-primary">객실 운영 현황</h2>
   <p className="mt-0.5 text-xs text-text-secondary">선택한 날짜의 투숙 현황 · 조회 전용</p>
   {history&&!error?<dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5" aria-label="선택일 투숙 요약">
    {[
     ['투숙',count(),'border-emerald-200 bg-emerald-50 text-emerald-900'],
     ['당일 입실',count('check_in'),'border-blue-200 bg-blue-50 text-blue-900'],
     ['당일 퇴실',count('check_out'),'border-orange-200 bg-orange-50 text-orange-950'],
    ].map(([label,value,color])=><div key={label} className={cn('flex min-h-14 items-center justify-between rounded-xl border px-3 py-2',color as string)}><dt className="text-xs font-bold">{label}</dt><dd className="text-lg font-black tabular-nums">{value}</dd></div>)}
   </dl>:null}
   <p className="mt-3 text-xs font-medium text-text-muted">카드를 눌러 상세 보기</p>
   <p role="note" className="mt-1 text-xs text-text-muted">확인된 투숙만 표시합니다. 표시가 없어도 당시 빈 객실이었다는 의미는 아닙니다.</p>
  </div>
  <div className="flex flex-col gap-5 p-4 sm:p-5 lg:p-6">
  {error?<p role="alert">{error}</p>:!history?<p role="status">기록 확인 중…</p>:<>
   <div className={mobile?'space-y-3':'min-w-0 space-y-6 overflow-x-auto overscroll-x-contain pb-2'} data-testid={mobile?'hotel-room-board-mobile-projection':'hotel-room-board-desktop-projection'}>
    {types.map(type=>{
     const rooms=history.rooms.filter(r=>r.roomType===type);const used=rooms.filter(r=>r.segments.length);const unshown=rooms.filter(r=>!r.segments.length);
     const summary=null;
     return mobile?<RoomBoardMobileGroup key={type} type={type} summary={summary} expanded={expanded[type]??true} onToggle={()=>setExpanded(x=>({...x,[type]:!(x[type]??true)}))}>
      {used.length?<div className="grid grid-cols-1 gap-3" data-testid={`${type.toLowerCase()}-mobile-occupied`}>{used.map(renderRoom)}</div>:null}
      {unshown.length?<div className={cn('grid grid-cols-2 gap-2',used.length>0&&'mt-3')} data-testid={`${type.toLowerCase()}-mobile-empty`}>{unshown.map(renderRoom)}</div>:null}
     </RoomBoardMobileGroup>:<RoomBoardDesktopGroup key={type} type={type} summary={summary}>{rooms.map(renderRoom)}</RoomBoardDesktopGroup>;
    })}
   </div>
   {history.unavailable.length?<details className="text-xs text-text-secondary" aria-label="과거 객실 확인 필요"><summary className="w-fit cursor-pointer list-none rounded focus-visible:ring-2 focus-visible:ring-primary"><span className="inline-flex items-center gap-1"><TriangleAlert size={14} className="text-amber-600" aria-hidden="true"/>확인 필요 · {new Set(history.unavailable.map(u=>u.stayId)).size}건</span></summary><ul className="mt-2 space-y-2">{[...new Set(history.unavailable.map(u=>u.stayId))].map(id=>{const items=history.unavailable.filter(u=>u.stayId===id);return <li key={id}><button type="button" className="font-semibold underline underline-offset-2" onClick={()=>onOpenStay(id)}>{items[0].dogName}</button><p>{[...new Set(items.map(u=>unavailableExplanation(u.reasonCode)))].join(' · ')}</p></li>;})}</ul></details>:null}
  </>}
  </div>
 </section>;
}
