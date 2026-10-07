import {useState} from 'react';
import {TaskComposer} from '../taskRequests/TaskRequestUi';
import {PaymentComposer} from './PaymentComposer';
import {paymentLabels,type RequestType} from './paymentRequestTypes';
export function RequestTypeComposer({types,userId,onCreated}:{types:RequestType[];userId:string;onCreated:(type:RequestType,id:string)=>void}){
 const [selected,setSelected]=useState<RequestType>();const type=types.length===1?types[0]:selected&&types.includes(selected)?selected:undefined;
 if(!type)return <div className="payment-menu">{types.map(t=><button key={t} onClick={()=>setSelected(t)}>{paymentLabels[t]}</button>)}</div>;
 return <>{types.length>1&&<button onClick={()=>setSelected(undefined)}>요청 유형 선택으로</button>}<h2>{paymentLabels[type]}</h2>{type==='TASK_REQUEST'?<TaskComposer userId={userId} onCreated={id=>onCreated(type,id)}/>:<PaymentComposer key={type} type={type} userId={userId} onCreated={id=>onCreated(type,id)}/>}</>;
}
