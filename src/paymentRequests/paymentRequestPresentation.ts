import type {PaymentAccess,PaymentType,RequestType} from './paymentRequestTypes';
import type {TaskAccess} from '../taskRequests/taskRequestRepository';
import {taskDue} from '../taskRequests/taskRequestPresentation';
export function availableRequestTypes(task:TaskAccess,p:PaymentAccess):RequestType[]{return [...(task.enabled&&task.can_create?['TASK_REQUEST' as const]:[]),...(p.confirmation_enabled&&p.confirmation_create?['PAYMENT_CONFIRMATION_REQUEST' as const]:[]),...(p.payment_enabled&&p.payment_create?['PAYMENT_REQUEST' as const]:[])];}
export function paymentStatus(type:PaymentType,status:string){return ({REQUESTED:type==='PAYMENT_CONFIRMATION_REQUEST'?'확인 대기':'요청됨',CONFIRMED:'입금 확인',NOT_FOUND:'입금 미확인',ACKNOWLEDGED:'확인',COMPLETED:'지급 완료',REJECTED:'반려',CANCELLED:'취소'} as Record<string,string>)[status]||status;}
export function paymentAmount(value:string){
 const input=value.trim();
 // Accept plain digits or correctly grouped KRW, without discarding arbitrary text.
 if(!/^(?:[1-9]\d*|[1-9]\d{0,2}(?:,\d{3})+)(?:\s*원)?$/.test(input))throw new Error('금액은 1원 이상의 정수로 입력해주세요.');
 const amount=Number(input.replace(/\s*원$/,'').replaceAll(',',''));
 if(amount>2147483647)throw new Error('금액은 1원 이상의 정수로 입력해주세요.');
 return amount;
}
export const paymentDue=(value:string)=>value?taskDue(value):null;
export function paymentRequestPath(type:PaymentType,id:string){return `/operations/requests?${new URLSearchParams({type,request:id})}`;}

// Older stored notification text remains unchanged; clarify only its displayed title.
export function paymentNoticeTitle(category:string|undefined,title:string){return category==='PAYMENT_CONFIRMATION_REQUEST'?title.replaceAll('결제 확인','입금 확인'):title;}
