import type {PaymentAttempt} from './paymentRequestTypes';
export const paymentRecoveryEvent='pnm-payment-confirmation-recovery';
export interface PaymentRecoveryScope {userId:string;id:string}
const prefix=(userId:string)=>`pnm:confirmation-command:${encodeURIComponent(userId)}:`;
const storageKey=({userId,id}:PaymentRecoveryScope)=>prefix(userId)+encodeURIComponent(id);
const supported=(p:PaymentAttempt)=>p.type==='PAYMENT_CONFIRMATION_REQUEST'&&['CONFIRMED','NOT_FOUND'].includes(p.action)&&typeof p.id==='string'&&typeof p.key==='string'&&Number.isSafeInteger(p.version)&&p.version>=0&&p.payload&&typeof p.payload==='object';
export function readPaymentAttempt(scope:PaymentRecoveryScope):PaymentAttempt|undefined{
 const raw=sessionStorage.getItem(storageKey(scope));if(!raw)return;
 const p=JSON.parse(raw) as PaymentAttempt;
 if(!supported(p)||p.id!==scope.id)throw new Error('보관된 처리 정보가 올바르지 않습니다. 새 처리를 중단하고 확인해주세요.');
 return p;
}
export function pendingPaymentAttempts(userId:string):PaymentAttempt[]{
 const keys=Array.from({length:sessionStorage.length},(_,i)=>sessionStorage.key(i)).filter((k):k is string=>!!k&&k.startsWith(prefix(userId)));
 return keys.flatMap(key=>{const p=readPaymentAttempt({userId,id:decodeURIComponent(key.slice(prefix(userId).length))});return p?[p]:[];});
}
export function savePaymentAttempt(scope:PaymentRecoveryScope,p:PaymentAttempt){
 if(!supported(p))return;
 const prior=readPaymentAttempt(scope);
 if(prior&&prior.key!==p.key)throw new Error('이 요청의 이전 처리 결과를 먼저 확인해주세요.');
 const value=JSON.stringify(p);sessionStorage.setItem(storageKey(scope),value);
 if(sessionStorage.getItem(storageKey(scope))!==value)throw new Error('처리 정보를 안전하게 보관할 수 없습니다. 다시 시도해주세요.');
 window.dispatchEvent(new Event(paymentRecoveryEvent));
}
export function clearPaymentAttempt(scope:PaymentRecoveryScope,p:PaymentAttempt){
 if(readPaymentAttempt(scope)?.key===p.key){sessionStorage.removeItem(storageKey(scope));window.dispatchEvent(new Event(paymentRecoveryEvent));}
}
