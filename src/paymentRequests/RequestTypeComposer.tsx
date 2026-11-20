import {useState} from 'react';
import {TaskComposer} from '../taskRequests/TaskRequestUi';
import {PaymentComposer} from './PaymentComposer';
import {paymentLabels,paymentDescriptions,type RequestType} from './paymentRequestTypes';
export function RequestTypeComposer({types,userId,onCreated}:{types:RequestType[];userId:string;onCreated:(type:RequestType,id:string)=>void}){
 const [selected,setSelected]=useState<RequestType>();const type=types.length===1?types[0]:selected&&types.includes(selected)?selected:undefined;
 const payoutUnavailable=types.includes('PAYMENT_CONFIRMATION_REQUEST')&&!types.includes('PAYMENT_REQUEST')?<p role="status">현재 계정에서 지급 요청을 작성할 수 없습니다. 지출 결제를 입금 확인 요청으로 대신 보내지 말고 관리자에게 문의해 주세요.</p>:null;
 if(!type)return <>{payoutUnavailable}<div className="payment-menu">{types.map(t=><div key={t}><button onClick={()=>setSelected(t)}>{paymentLabels[t]}</button>{t!=='TASK_REQUEST'&&<p className="pt-secondary">{paymentDescriptions[t]}</p>}</div>)}</div></>;
 return <>{payoutUnavailable}{types.length>1&&<button onClick={()=>setSelected(undefined)}>요청 유형 선택으로</button>}<h2>{paymentLabels[type]}</h2>{type==='TASK_REQUEST'?<TaskComposer userId={userId} onCreated={id=>onCreated(type,id)}/>:<PaymentComposer key={type} type={type} userId={userId} onCreated={id=>onCreated(type,id)}/>}</>;
}
