import {useRef,useState} from 'react';
import {executeDustCorrection,inspectDustCorrection,type DustCorrectionState} from './dustCorrectionRepository';
const attemptKey='pnm:dust-transfer-20261107:attempt';
export function DustCorrectionPanel({allowed,onChanged}:{allowed:boolean;onChanged:()=>void}){
 const [open,setOpen]=useState(false),[row,setRow]=useState<DustCorrectionState|null>(null),[busy,setBusy]=useState(false),[confirmed,setConfirmed]=useState(false),[final,setFinal]=useState(false),[message,setMessage]=useState('');
 const [attempt,setAttempt]=useState(()=>{try{return sessionStorage.getItem(attemptKey);}catch{return '요청 기록 저장 불가';}});
 const lock=useRef(false);
 if(!allowed)return null;
 const blocked=busy||!row||row.completed||!!attempt;
 async function refresh(){
  if(lock.current)return;lock.current=true;setBusy(true);setRow(null);setConfirmed(false);setFinal(false);setMessage('');
  try{setRow(await inspectDustCorrection());}catch(e){setMessage(e instanceof Error?e.message:'최신 상태 확인 실패');}finally{lock.current=false;setBusy(false);}
 }
 async function execute(){
  if(lock.current||blocked||!row||!confirmed||!final)return;
  lock.current=true;setBusy(true);setFinal(false);setConfirmed(false);
  const requestId=crypto.randomUUID();
  try{
   // Persist before sending. A lost response or remount must not permit another write attempt.
   sessionStorage.setItem(attemptKey,requestId);setAttempt(requestId);
   const after=await executeDustCorrection(row,requestId,true);setRow(after);
   setMessage(`정정 완료 · 감사 ID: ${after.auditId} · 요청 ID: ${requestId}`);onChanged();
  }catch(e){setAttempt(requestId);setMessage(`${e instanceof Error?e.message:'응답 확인 실패'} 자동 재실행하지 않습니다. 요청 ID: ${requestId}`);}
  finally{lock.current=false;setBusy(false);}
 }
 return <section className="panel" aria-label="먼지 관리자 복구" style={{minWidth:0,padding:16,overflowWrap:'anywhere'}}>
  <button type="button" style={{minHeight:44}} aria-expanded={open} onClick={()=>{setOpen(!open);if(!open)void refresh();}}>관리자 복구 · 먼지 이동 시각 정정</button>
  {open&&<div style={{display:'grid',gap:12,minWidth:0}}>
   <h3>먼지 · 2026-11-07 · STANDARD 1 → STANDARD 5</h3>
   <p>정정 전 기록: 19:35 KST → 대표 확인 실제 이동: 09:00 KST</p>
   <p>STANDARD 1 종료와 STANDARD 5 시작만 09:00으로 정정합니다. 원본 이동 감사와 시스템 저장 시각 19:36은 보존합니다.</p>
   {row&&<p>최신 상태: {row.completed?'정정 완료 · 09:00 KST':'미정정 · 19:35 KST'} / 투숙 version {row.stayVersion} / 배정 version {row.oldVersion}·{row.newVersion}</p>}
   <button type="button" style={{minHeight:44}} disabled={busy} onClick={()=>void refresh()}>먼지 최신 상태 다시 조회</button>
   <p>다른 투숙객, 현재 점유, Capacity 및 로키 예약은 변경하지 않습니다. 서버가 실행 직전 이력·버전·충돌을 다시 검사하며, 실패하면 전체 정정을 취소합니다.</p>
   <label style={{display:'flex',gap:10,alignItems:'center',minHeight:44}}><input type="checkbox" checked={confirmed} disabled={blocked} onChange={e=>{setConfirmed(e.target.checked);setFinal(false);}}/>먼지의 실제 이동 09:00과 위 정정 내용을 확인했습니다.</label>
   <button type="button" style={{minHeight:44}} disabled={blocked||!confirmed} onClick={()=>setFinal(true)}>먼지 단건 정정 최종 확인</button>
   {final&&!blocked&&<div role="group" aria-label="먼지 정정 최종 승인" style={{border:'1px solid #ddd',borderRadius:8,padding:12,display:'grid',gap:12}}>
    <p>2026-11-07 먼지의 이동 경계를 19:35에서 09:00으로 변경합니다. 실제 운영 기록이 변경됩니다.</p>
    <button type="button" style={{minHeight:44}} onClick={()=>void execute()}>승인하고 먼지 1건 정정 실행</button>
    <button type="button" style={{minHeight:44}} onClick={()=>setFinal(false)}>취소</button>
   </div>}
   <p role="status" aria-live="polite">{message||(row?.completed?'정정 완료. 다시 실행할 수 없습니다.':attempt?`이 브라우저에서 실행을 시도한 기록이 있습니다. 재실행하지 말고 감사 이력을 확인해 주세요. 요청 ID: ${attempt}`:busy?'최신 상태 확인 중…':'실행은 관리자의 최종 승인 후에만 진행됩니다.')}</p>
  </div>}
 </section>;
}
