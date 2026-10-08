import {useEffect,useRef,useState} from 'react';
import {PaymentFailure,type PaymentRepository} from './paymentRequestRepository';
import {readPaymentAttempt,savePaymentAttempt,clearPaymentAttempt,type PaymentRecoveryScope} from './paymentCommandRecovery';
import type {PaymentAttempt} from './paymentRequestTypes';

// Both detail and inline actions retain the exact command for an uncertain result.
export function usePaymentCommand(repository:PaymentRepository,onSuccess:(attempt:PaymentAttempt,result:{id:string;version:number;status:string})=>Promise<void>|void,scope?:PaymentRecoveryScope){
 const [initial]=useState(()=>{try{return {attempt:scope?readPaymentAttempt(scope):undefined,error:''};}catch(e){return {attempt:undefined,error:(e as Error).message};}});
 const pending=useRef<PaymentAttempt|undefined>(initial.attempt),lock=useRef(false),mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const [busy,setBusy]=useState(false),[retry,setRetry]=useState<PaymentAttempt|undefined>(initial.attempt),[error,setError]=useState(initial.error);
 const guarded=!!scope&&retry?.type==='PAYMENT_CONFIRMATION_REQUEST'&&['CONFIRMED','NOT_FOUND'].includes(retry.action);
 useEffect(()=>{if(!guarded)return;const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[guarded]);
 const run=(create:()=>PaymentAttempt,onPrepared?:()=>void)=>{
  if(lock.current||initial.error)return;
  try{
   const next=pending.current??create();
   if(scope)savePaymentAttempt(scope,next);
   onPrepared?.();
   pending.current=next;
   const attempt=pending.current;lock.current=true;setBusy(true);setRetry(attempt);setError('');
   void repository.command(attempt).then(async result=>{if(scope)clearPaymentAttempt(scope,attempt);pending.current=undefined;setRetry(undefined);if(mounted.current)await onSuccess(attempt,result);}).catch(e=>{
    if(e instanceof PaymentFailure&&e.definite){try{if(scope)clearPaymentAttempt(scope,attempt);}catch{setError('처리 결과 기록을 정리하지 못했습니다. 같은 요청으로 다시 확인해주세요.');return;}pending.current=undefined;setRetry(undefined);}
    setError(e.message);
   }).finally(()=>{lock.current=false;setBusy(false);});
  }catch(e){setError((e as Error).message);}
 };
 return {run,busy,retry,error,setError};
}
