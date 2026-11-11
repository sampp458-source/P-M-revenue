import {useRef,useState} from 'react';
import {executeDustCorrection,inspectDustCorrection,resolveDustAttempt,type DustAttempt,type DustCorrectionState,type DustRequestState} from './dustCorrectionRepository';
const originalRequestId='ee331a50-e577-4d3b-a312-1a08e5ee9b18';
const attemptKey='pnm:dust-transfer-20261107:attempt';
function loadAttempt():DustAttempt|null{
 try{
  const raw=sessionStorage.getItem(attemptKey);if(!raw)return null;
  if(/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(raw))return {requestId:raw};
  const a=JSON.parse(raw);if(typeof a.requestId!=='string'||!a.requestId)throw Error();return a;
 }catch{return {requestId:'확인 불가',error:'저장된 요청 기록을 확인할 수 없습니다. 재실행하지 마세요.'};}
}
export function DustCorrectionPanel({allowed,onChanged}:{allowed:boolean;onChanged:()=>void}){
 const [open,setOpen]=useState(false),[row,setRow]=useState<DustCorrectionState|null>(null),[busy,setBusy]=useState(false),[confirmed,setConfirmed]=useState(false),[final,setFinal]=useState(false),[message,setMessage]=useState('');
 const [attempt,setAttempt]=useState<DustAttempt|null>(loadAttempt);
 const [outcome,setOutcome]=useState<DustRequestState>('unknown');
 const lock=useRef(false);
 if(!allowed)return null;
 const blocked=busy||!row||row.completed||!attempt||outcome!=='not_applied';
 function save(a:DustAttempt){sessionStorage.setItem(attemptKey,JSON.stringify(a));setAttempt(a);}
 async function refresh(){
  if(lock.current)return;lock.current=true;setBusy(true);setRow(null);setConfirmed(false);setFinal(false);setOutcome('unknown');setMessage('');
  try{
   const fresh=await inspectDustCorrection();setRow(fresh);
   if(attempt){
    const checked=await resolveDustAttempt(attempt,fresh);save(checked.attempt);setOutcome(checked.outcome.state);
    if(checked.outcome.state==='not_applied')setMessage('서버 미반영 확인 · 진행 중인 요청 없음 · 원래 배정과 감사 기록 일치. 같은 요청으로 다시 확인한 뒤 재시도할 수 있습니다.');
    else if(checked.outcome.state==='in_progress')setMessage('요청 진행 중입니다. 재실행하지 말고 잠시 후 결과를 다시 확인해 주세요.');
    else if(checked.outcome.state==='succeeded')setMessage('서버 정정 완료 확인. 재실행할 수 없습니다.');
    else setMessage('결과 불확실 · 재실행하지 말고 감사 이력을 확인해 주세요.');
   }
  }catch(e){setMessage(e instanceof Error?e.message:'최신 상태 확인 실패');}
  finally{lock.current=false;setBusy(false);}
 }
 async function restoreOriginalRequest(){
  if(lock.current||attempt)return;
  lock.current=true;setBusy(true);setRow(null);setConfirmed(false);setFinal(false);setOutcome('unknown');setMessage('');
  try{
   const fresh=await inspectDustCorrection();setRow(fresh);
   if(fresh.completed)throw new Error('이미 정정된 기록입니다. 재실행하지 않습니다.');
   const checked=await resolveDustAttempt({requestId:originalRequestId},fresh);
   if(checked.outcome.state!=='not_applied'||!checked.attempt.snapshotHash)throw new Error('기존 요청의 서버 미반영을 확인하지 못했습니다. 복원 및 실행을 차단합니다.');
   // Restore only the fixed original request after authenticated server reconciliation.
   // Existing browser attempts are never removed or overwritten by this path.
   save(checked.attempt);setOutcome('not_applied');
   setMessage('기존 요청 복원 완료 · 서버 미반영 및 원본 배정·감사·점유 확인. 정정 내용을 다시 확인한 뒤 같은 요청으로 실행할 수 있습니다.');
  }catch(e){setMessage(e instanceof Error?e.message:'기존 요청 복원 실패');}
  finally{lock.current=false;setBusy(false);}
 }
 async function execute(){
  if(lock.current||blocked||!row||!attempt||!confirmed||!final)return;
  lock.current=true;setBusy(true);setFinal(false);setConfirmed(false);setOutcome('unknown');
  const current: DustAttempt=attempt;
  try{
   // Persist original identity/input before network. Retry retains this exact request.
   save(current);
   const after=await executeDustCorrection(row,current.requestId,true,current.snapshotHash);setRow(after);setOutcome('succeeded');
   setMessage(`정정 완료 · 감사 ID: ${after.auditId} · 요청 ID: ${current.requestId}`);onChanged();
  }catch(e){
   const error=e instanceof Error?e.message:'응답 확인 실패';
   try{save({...current,error});}catch{setAttempt({...current,error});}
   setMessage(`${error} 자동 재실행하지 않습니다. 최신 상태 다시 조회로 결과를 확인해 주세요.`);
  }finally{lock.current=false;setBusy(false);}
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
   {!attempt&&!row?.completed&&<div><p>기존 실패 요청 ID: {originalRequestId}</p><button type="button" style={{minHeight:44}} disabled={busy} onClick={()=>void restoreOriginalRequest()}>기존 실패 요청 확인·복원</button><p>서버가 미반영 상태와 원본 기록을 확인한 경우에만 복원합니다. 복원만으로 정정이 실행되지는 않습니다.</p></div>}
   {attempt&&<div><p>요청 ID: {attempt.requestId}</p>{attempt.error&&<p>직전 결과: {attempt.error}</p>}</div>}
   <label style={{display:'flex',gap:10,alignItems:'center',minHeight:44}}><input type="checkbox" checked={confirmed} disabled={blocked} onChange={e=>{setConfirmed(e.target.checked);setFinal(false);}}/>먼지의 실제 이동 09:00과 위 정정 내용을 확인했습니다.</label>
   <button type="button" style={{minHeight:44}} disabled={blocked||!confirmed} onClick={()=>setFinal(true)}>먼지 단건 정정 최종 확인</button>
   {final&&!blocked&&<div role="group" aria-label="먼지 정정 최종 승인" style={{border:'1px solid #ddd',borderRadius:8,padding:12,display:'grid',gap:12}}>
    <p>2026-11-07 먼지의 이동 경계를 19:35에서 09:00으로 변경합니다. 실제 운영 기록이 변경됩니다.{attempt?' 기존 요청 ID와 같은 입력으로 재시도합니다.':''}</p>
    <button type="button" style={{minHeight:44}} onClick={()=>void execute()}>승인하고 같은 요청 재시도</button>
    <button type="button" style={{minHeight:44}} onClick={()=>setFinal(false)}>취소</button>
   </div>}
   <p role="status" aria-live="polite">{message||(row?.completed?'정정 완료. 다시 실행할 수 없습니다.':busy?'최신 상태 확인 중…':'실행은 관리자의 최종 승인 후에만 진행됩니다.')}</p>
  </div>}
 </section>;
}
