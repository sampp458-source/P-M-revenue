import {useEffect,useState} from 'react';
import {paymentRequestRepository} from './paymentRequestRepository';
import {emptyPaymentAccess,type PaymentAccess} from './paymentRequestTypes';
export function usePaymentAccess(identity?:string,revision?:unknown){
 const [result,setResult]=useState<{identity:string;access:PaymentAccess}>();
 useEffect(()=>{if(!identity)return;let live=true,generation=0;
 const refresh=async()=>{if(document.visibilityState==='hidden')return;const token=++generation;try{const access=await paymentRequestRepository.access();if(live&&token===generation)setResult({identity,access});}catch{if(live&&token===generation)setResult({identity,access:emptyPaymentAccess});}};
 void refresh();const timer=setInterval(()=>void refresh(),30000);window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);return()=>{live=false;clearInterval(timer);window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);};},[identity,revision]);
 return {...(result&&result.identity===identity?result.access:emptyPaymentAccess),loading:!!identity&&result?.identity!==identity};
}
