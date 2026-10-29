import {useRef,useState} from 'react';
import {inspectRockyRecovery,executeRockyRecovery} from './rockyRecoveryRepository';
import type {DaycareReservation} from './daycareOperationsRepository';
const time=(value:string)=>new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'short',timeStyle:'short'}).format(new Date(value));
export function RockyRecoveryPanel({allowed}:{allowed:boolean}){
 const [open,setOpen]=useState(false),[row,setRow]=useState<DaycareReservation|null>(null),[busy,setBusy]=useState(false),[confirmed,setConfirmed]=useState(false),[message,setMessage]=useState(''),[attempted,setAttempted]=useState(false);
 const lock=useRef(false),request=useRef<string|null>(null);
 if(!allowed)return null;
 async function refresh(){if(lock.current)return;lock.current=true;setBusy(true);setRow(null);setConfirmed(false);setMessage('');try{setRow(await inspectRockyRecovery());}catch(e){setMessage(e instanceof Error?e.message:'조회 실패');}finally{lock.current=false;setBusy(false);}}
 async function execute(){if(lock.current||!row||!confirmed||attempted)return;lock.current=true;setBusy(true);setAttempted(true);request.current??=crypto.randomUUID();try{const r=await executeRockyRecovery(row,request.current);setRow(r);setMessage('로키 실제 이용 기록이 완료됐습니다. 다시 실행하지 마세요.');}catch(e){setMessage(`${e instanceof Error?e.message:'응답 확인 실패'} 재실행하지 말고 최신 예약과 요청 처리 이력을 확인해 주세요. 요청 ID: ${request.current}`);}finally{setConfirmed(false);lock.current=false;setBusy(false);}}
 return <section className="panel" style={{minWidth:0,padding:16,overflowWrap:'anywhere'}} aria-label="로키 관리자 이용 복구">
 <button type="button" style={{minHeight:44}} aria-expanded={open} onClick={()=>{setOpen(!open);if(!open)void refresh();}}>관리자 · 로키 사후 이용 복구</button>
 {open&&<div style={{display:'grid',gap:12,minWidth:0}}>
 <h3>로키 · 2026-10-27 · STANDARD 3</h3>
 <p>직원 처리 시각과 별개로, 대표자가 확인한 실제 이용 시각을 기록합니다.</p>
 <p>실제 입실: 10:20 KST / 실제 퇴실: 18:10 KST</p>
 <p>예상 결과: 이용 완료 · 실제 입퇴실 기록 · 배정 및 Capacity를 10:20~18:10으로 정합화. 기존 변경 이력은 보존됩니다.</p>
 {row&&<><p>현재 상태: {row.lifecycleStatus} / 예약 version {row.version} / 일정 version {row.scheduleVersion}</p><p>현재 배정: {row.roomAllocation?`${time(row.roomAllocation.allocatedFrom)} ~ ${time(row.roomAllocation.allocatedUntil)}`:'확인 불가'}</p><p>현재 Capacity: {time(row.capacityReservation.reservedFrom)} ~ {time(row.capacityReservation.reservedUntil)}</p></>}
 <button type="button" style={{minHeight:44}} disabled={busy} onClick={()=>void refresh()}>최신 상태 다시 조회</button>
 <label style={{display:'flex',gap:10,alignItems:'center',minHeight:44}}><input type="checkbox" checked={confirmed} disabled={!row||busy||attempted} onChange={e=>setConfirmed(e.target.checked)}/>로키의 위 실제 이용 시각과 정정 내용을 확인했습니다.</label>
 <button type="button" style={{minHeight:44}} disabled={!row||!confirmed||busy||attempted} onClick={()=>void execute()}>{busy?'확인 중…':'확인한 로키 1건 복구 실행'}</button>
 <p role="status" aria-live="polite">{message||(!row?'최신 상태 및 점유 확인 중':'실행 직전 다시 조회하며, 서버에서 권한·버전·점유를 재검사합니다.')}</p>
 </div>}
 </section>;
}
