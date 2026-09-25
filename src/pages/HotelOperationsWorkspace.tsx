import {useId,useState,type ReactNode} from 'react';
import {DoorOpen,CalendarDays,ListChecks,Layers} from 'lucide-react';
const panes=[['rooms','객실',DoorOpen],['schedule','일정',CalendarDays],['attention','처리 필요',ListChecks],['modules','기타 운영',Layers]] as const;
/** Keep every panel mounted: changing the mobile view must not start another data load. */
export function HotelOperationsWorkspace({rooms,schedule,attention,attentionCount,modules}:{rooms:ReactNode;schedule:ReactNode;attention:ReactNode;attentionCount:number;modules:ReactNode}){
 const [view,setView]=useState<string>('rooms');const id=useId();
 const content={rooms,schedule,attention,modules};
 return <div className="hotel-operations-workspace" data-view={view}>
  <nav className="hotel-workspace-nav pm-d-pane-control" aria-label="호텔 업무 화면">
   {panes.map(([key,label,Icon])=><button key={key} type="button" aria-pressed={view===key} aria-controls={`${id}-${key}`} onClick={()=>setView(key)}><Icon size={17} aria-hidden="true"/><span>{label}</span>{key==='attention'&&attentionCount>0?<b>{attentionCount}</b>:null}</button>)}
  </nav>
  {panes.map(([key,label])=><section key={key} id={`${id}-${key}`} data-workspace-pane={key} aria-label={label} className="hotel-workspace-panel">{content[key]}</section>)}
 </div>;
}
