import { Check, DoorOpen, LockKeyhole } from 'lucide-react';
import type { ReactNode } from 'react';

type RoomChoice = {roomId:string;roomName:string;eligible:boolean;recommended?:boolean};
/** Presentation only: availability and recommendation come from the current server result. */
export function HotelEligibleRoomSurface({rooms,selectedId,disabled,onSelect,children}:{
 rooms:RoomChoice[];selectedId:string;disabled:boolean;onSelect:(id:string)=>void;children:ReactNode;
}) {
 const choice = (room:RoomChoice) => <button key={room.roomId} type="button" aria-pressed={selectedId===room.roomId} disabled={disabled||!room.eligible} onClick={()=>onSelect(room.roomId)}>
    <span className="hotel-choice-icon">{!room.eligible?<LockKeyhole size={18}/>:selectedId===room.roomId?<Check size={18}/>:<DoorOpen size={18}/>}</span>
    <strong>{room.roomName}</strong><small>{!room.eligible?'배정 불가':selectedId===room.roomId?'선택됨':room.recommended?'추천 객실':'선택 가능'}</small>
   </button>;
 return <section className="hotel-room-choice" aria-label="이용 가능한 객실">
  <header><span className="hotel-operation-eyebrow">02 / ROOM</span><h3>이용할 객실을 선택하세요</h3><p>확인한 실제 입실 시각 기준 · 서버 확인 결과</p></header>
  <div className="hotel-room-choice-grid" aria-busy={disabled && rooms.length===0}>
   {rooms.filter(room=>room.eligible).map(choice)}
   {!rooms.some(room=>room.eligible)?<div className="hotel-room-choice-placeholder">{rooms.length ? "선택 가능한 객실이 없습니다. 실제 시각과 예약 상태를 확인해 주세요." : "실제 시각에 맞는 객실을 확인한 뒤 여기에 표시합니다."}</div>:null}
  </div>
  {rooms.some(room=>!room.eligible)?<details className="hotel-room-choice-list"><summary>배정 불가 {rooms.filter(room=>!room.eligible).length}실 확인</summary><div className="hotel-room-choice-grid">{rooms.filter(room=>!room.eligible).map(choice)}</div></details>:null}
  <details className="hotel-room-choice-list"><summary>목록으로 선택</summary>{children}</details>
 </section>;
}
