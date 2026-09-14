import {LogIn,LogOut,CalendarDays,ChevronRight} from 'lucide-react';
import {seoulDateKey} from './operationsScheduleRepository';
export type HotelTimelineItem={id:string;at:string;timeUnspecified?:boolean;allDay?:boolean;name:string;detail:string;kind:'check_in'|'check_out'|'other';status?:string;onOpen:()=>void};
export function HotelDayOperationsTimeline({items}:{items:HotelTimelineItem[]}){
 const groups=new Map<string,{label:string;items:HotelTimelineItem[]}>();
 [...items].sort((a,b)=>Number(Boolean(a.timeUnspecified))-Number(Boolean(b.timeUnspecified))||Date.parse(a.at)-Date.parse(b.at)||a.id.localeCompare(b.id)).forEach(item=>{
  const label=item.timeUnspecified?'시간 미정':item.allDay?'종일':new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(item.at));
  const key=seoulDateKey(new Date(item.at))+':'+label;const group=groups.get(key)??{label,items:[]};group.items.push(item);groups.set(key,group);
 });
 return <div className="hotel-day-operations"><header><span className="hotel-operation-eyebrow">DAY OPERATIONS</span><h3>하루의 운영 흐름</h3><p>예정 일정 기준 · 실제 입퇴실 기록은 상세에서 확인</p><div className="hotel-timeline-totals"><span>전체 <b>{items.length}</b></span><span>입실 <b>{items.filter(i=>i.kind==='check_in').length}</b></span><span>퇴실 <b>{items.filter(i=>i.kind==='check_out').length}</b></span></div></header>
  {!items.length?<p className="hotel-timeline-empty">선택한 날짜에 표시할 일정이 없습니다.</p>:<ol className="hotel-day-timeline">{[...groups].map(([key,group])=><li key={key} className="hotel-time-group"><span className="hotel-timeline-time">{group.label}</span><ul>{group.items.map(item=>{const Icon=item.kind==='check_in'?LogIn:item.kind==='check_out'?LogOut:CalendarDays;return <li key={item.id}><button type="button" data-event-kind={item.kind} onClick={item.onOpen}><span className="hotel-timeline-dot"><Icon size={17} aria-hidden="true"/></span><span className="hotel-timeline-copy"><strong>{item.name}</strong><span>{item.detail}</span></span><small>{item.status}</small><ChevronRight size={15} aria-hidden="true"/></button></li>;})}</ul></li>)}</ol>}
 </div>;
}
