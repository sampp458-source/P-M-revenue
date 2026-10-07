import type {PaymentAccess,PaymentType,RequestType} from './paymentRequestTypes';
import type {TaskAccess} from '../taskRequests/taskRequestRepository';
import {taskDue} from '../taskRequests/taskRequestPresentation';
export function availableRequestTypes(task:TaskAccess,p:PaymentAccess):RequestType[]{return [...(task.enabled&&task.can_create?['TASK_REQUEST' as const]:[]),...(p.confirmation_enabled&&p.confirmation_create?['PAYMENT_CONFIRMATION_REQUEST' as const]:[]),...(p.payment_enabled&&p.payment_create?['PAYMENT_REQUEST' as const]:[])];}
export function paymentStatus(type:PaymentType,status:string){return ({REQUESTED:type==='PAYMENT_CONFIRMATION_REQUEST'?'확인 대기':'요청됨',CONFIRMED:'입금 확인',NOT_FOUND:'입금 미확인',ACKNOWLEDGED:'확인',COMPLETED:'지급 완료',REJECTED:'반려',CANCELLED:'취소'} as Record<string,string>)[status]||status;}
export function paymentAmount(value:string){if(!/^[1-9]\d*$/.test(value)||Number(value)>2147483647)throw new Error('금액은 1원 이상의 정수로 입력해주세요.');return Number(value);}
export const paymentDue=(value:string)=>value?taskDue(value):null;
export function paymentRequestPath(type:PaymentType,id:string){return `/operations/requests?${new URLSearchParams({type,request:id})}`;}
