import {useEffect,useId,useLayoutEffect,useRef,useState} from 'react';
import {displayServiceTime,earlyTimeKind,type TimeServiceKind} from './hotelAdditionalServices';

/** Quote-only selection: no clock-derived defaults and no operational data writes. */
export function HotelServiceTimePicker({label,kind,value,onChange}:{label:string;kind:TimeServiceKind;value:string;onChange:(time:string)=>void}) {
 const id=useId();const trigger=useRef<HTMLButtonElement>(null);const panel=useRef<HTMLDivElement>(null);
 const [position,setPosition]=useState<{left:number;top:number}|null>(null);const [precise,setPrecise]=useState(false);const [hour,setHour]=useState('');const [minute,setMinute]=useState('');
 const isOpen=position!==null;
 const early=earlyTimeKind(kind);const first=early?8:20;const last=first+2;
 const close=()=>{setPosition(null);trigger.current?.focus();};
 useLayoutEffect(()=>{if(!position||!panel.current||!trigger.current)return;const rect=trigger.current.getBoundingClientRect();const height=panel.current.getBoundingClientRect().height;const top=Math.max(8,Math.min(rect.bottom+4,window.innerHeight-height-8));if(top!==position.top)setPosition(p=>p?{...p,top}:null);},[position,precise]);
 useEffect(()=>{if(!isOpen)return;const outside=(e:PointerEvent)=>{if(!panel.current?.contains(e.target as Node)&&!trigger.current?.contains(e.target as Node))setPosition(null);};const dismiss=()=>setPosition(null);const scroll=(e:Event)=>{if(!panel.current?.contains(e.target as Node))dismiss();};document.addEventListener('pointerdown',outside);window.addEventListener('resize',dismiss);document.addEventListener('scroll',scroll,true);panel.current?.querySelector<HTMLButtonElement>('button')?.focus();return()=>{document.removeEventListener('pointerdown',outside);window.removeEventListener('resize',dismiss);document.removeEventListener('scroll',scroll,true);};},[isOpen]);
 const choose=(time:string)=>{onChange(time);close();};
 const open=()=>{if(position){close();return;}const rect=trigger.current!.getBoundingClientRect();setPrecise(false);setHour(value?value.slice(0,2):'');setMinute(value?value.slice(3):'');setPosition({left:Math.max(8,Math.min(rect.left,window.innerWidth-294)),top:Math.max(8,Math.min(rect.bottom+4,window.innerHeight-340))});};
 return <><button ref={trigger} type="button" className="hrc-time-trigger" aria-label={`${label} 시간 선택`} aria-haspopup="dialog" aria-expanded={!!position} aria-controls={position?id:undefined} onClick={open}>{value?displayServiceTime(value):'시간 선택'}</button>
 {position&&<div ref={panel} id={id} role="dialog" aria-label={`${label} 시간 선택 패널`} className="hrc-time-panel" style={position} onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();}}}>
  <div className="hrc-time-panel-heading"><strong>{label.split(' ').slice(-2).join(' ')} 시간</strong><button type="button" aria-label="시간 선택 닫기" onClick={close}>닫기</button></div>
  <p>{early?'오전 8:00~10:00':'오후 8:00~10:00'} · 10분 간격</p>
  <div className="hrc-time-quick">{Array.from({length:13},(_,i)=>{const mins=first*60+i*10;const time=`${String(Math.floor(mins/60)).padStart(2,'0')}:${String(mins%60).padStart(2,'0')}`;return <button type="button" key={time} aria-pressed={value===time} aria-label={displayServiceTime(time)} onClick={()=>choose(time)}>{Math.floor(mins/60)%12||12}:{String(mins%60).padStart(2,'0')}</button>;})}</div>
  <button type="button" className="hrc-time-precise-toggle" aria-expanded={precise} onClick={()=>setPrecise(v=>!v)}>직접 시간 선택 · 1분 단위</button>
  {precise&&<div className="hrc-time-precise"><label>시<select aria-label="세부 시" value={hour} onChange={e=>{setHour(e.target.value);if(Number(e.target.value)===last&&minute!=='00')setMinute('');}}><option value="">시 선택</option>{Array.from({length:3},(_,i)=>first+i).map(h=><option key={h} value={String(h).padStart(2,'0')}>{early?'오전':'오후'} {h%12||12}시</option>)}</select></label><label>분<select aria-label="세부 분" value={minute} onChange={e=>setMinute(e.target.value)}><option value="">분 선택</option>{Array.from({length:Number(hour)===last?1:60},(_,i)=><option key={i} value={String(i).padStart(2,'0')}>{String(i).padStart(2,'0')}분</option>)}</select></label><button type="button" disabled={!hour||!minute} onClick={()=>choose(`${hour}:${minute}`)}>적용</button></div>}
 </div>}
 </>;
}
