import {useEffect,useState} from 'react';
import {paymentRequestRepository} from './paymentRequestRepository';
import {paymentStatus} from './paymentRequestPresentation';
import type {HubRow,PaymentDetail} from './paymentRequestTypes';
import {usePaymentCommand} from './usePaymentCommand';

export function ConfirmationInboxCard({row,onOpen,onProcessing,onLockChange,userId,readEpoch,scheduleRead}:{row:HubRow;userId:string;readEpoch:number;scheduleRead:<T>(read:()=>Promise<T>)=>Promise<T>;onOpen:()=>void;onProcessing:()=>void;onLockChange:(id:string,locked:boolean)=>void}){
 const [reading,setReading]=useState(true);
 const [detail,setDetail]=useState<PaymentDetail>(),[readError,setReadError]=useState(''),[confirm,setConfirm]=useState(false);
 const {id,status:rowStatus,display_title,counterparty,handler_unavailable,administrative_cancelled}=row;
 useEffect(()=>{let current=true;setReading(true);setConfirm(false);void scheduleRead(()=>current?paymentRequestRepository.detail('PAYMENT_CONFIRMATION_REQUEST',id):Promise.resolve(undefined)).then(item=>{if(current&&item){setDetail(item);setReadError('');}}).catch(()=>{if(current){setDetail(undefined);setReadError('정보를 불러오지 못했습니다. 상세에서 다시 확인해주세요.');}}).finally(()=>{if(current)setReading(false);});return()=>{current=false;};},[id,rowStatus,display_title,counterparty,handler_unavailable,administrative_cancelled,readEpoch,scheduleRead]);
 const {run,busy,retry,error}=usePaymentCommand(paymentRequestRepository,(_attempt,result)=>{
  setDetail(current=>current?{...current,status:result.status,version:result.version}:current);setConfirm(false);
 },{userId,id});
 useEffect(()=>{onLockChange(row.id,busy||!!retry);return()=>onLockChange(row.id,false);},[busy,retry,onLockChange,row.id]);
 const status=detail?.status||row.status;
 const allowed=!reading&&detail?.can_process&&(status==='REQUESTED'||status==='NOT_FOUND');
 const act=(action:'CONFIRMED'|'NOT_FOUND')=>{
  if(!retry&&(!detail||!allowed))return;
  run(()=>{if(!detail)throw new Error('상세 정보를 먼저 확인해주세요.');return {type:'PAYMENT_CONFIRMATION_REQUEST',id:detail.id,version:detail.version,key:crypto.randomUUID(),action,payload:{note:null}};},onProcessing);
 };
 return <article className="pt-task-row payment-inline-card" aria-label={row.display_title} onClick={onOpen}>
  <button className="payment-inline-open" onClick={event=>{event.stopPropagation();onOpen();}} aria-label={`${row.display_title} · ${row.counterparty} · ${paymentStatus('PAYMENT_CONFIRMATION_REQUEST',status)}`}>
   <small className="payment-type">결제 확인 요청</small><strong>{row.display_title}</strong>
   <dl><dt>입금 확인 대상</dt><dd>{detail?.payer_name||'확인 중'}</dd><dt>반려견</dt><dd>{detail?detail.dog_name||'미입력':'확인 중'}</dd><dt>금액</dt><dd>{detail?.reported_amount===undefined?'확인 중':`${detail.reported_amount.toLocaleString('ko-KR')}원`}</dd><dt>요청자</dt><dd>{row.counterparty}</dd></dl>
  </button>
  <div className="payment-inline-controls" onClick={event=>event.stopPropagation()}><span className="payment-inline-status" role="status">{row.administrative_cancelled?'관리 종료':status==='CONFIRMED'?'입금 확인 완료':paymentStatus('PAYMENT_CONFIRMATION_REQUEST',status)}</span>
   <div className="payment-inline-actions">{retry?<button disabled={busy} onClick={()=>act(retry.action as 'CONFIRMED'|'NOT_FOUND')}>같은 요청으로 결과 확인</button>:allowed?<>{confirm?<><span>입금을 확인하셨습니까?</span><button disabled={busy} onClick={()=>setConfirm(false)}>돌아가기</button><button className="pn-primary" disabled={busy} onClick={()=>act('CONFIRMED')}>확인 처리</button></>:<>{status==='REQUESTED'&&<button disabled={busy} onClick={()=>act('NOT_FOUND')}>입금 미확인</button>}<button className="pn-primary" disabled={busy} onClick={()=>setConfirm(true)}>입금 확인</button></>}</>:null}</div>
   <div className="payment-inline-feedback">{(error||readError)&&<p role="alert">{error||readError}</p>}{row.handler_unavailable&&<p>처리 담당자 사용 불가 · 관리 확인 필요</p>}</div>
  </div>
 </article>;
}
