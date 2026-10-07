import {useEffect,useRef,useState} from 'react';
import {paymentRequestRepository,PaymentFailure,type PaymentRepository} from './paymentRequestRepository';
import {paymentAmount,paymentDue} from './paymentRequestPresentation';
import type {PaymentType,PaymentAttempt} from './paymentRequestTypes';
import './paymentRequests.css';
// Memory only, scoped by authenticated identity. Ambiguous network outcomes retain the exact command on reopen.
const pending=new Map<string,PaymentAttempt>();
export function PaymentComposer({type,userId,repository=paymentRequestRepository,onCreated}:{type:PaymentType;userId:string;repository?:PaymentRepository;onCreated:(id:string)=>void}){
 const identity=`${userId}:${type}`,saved=pending.get(identity),confirmation=type==='PAYMENT_CONFIRMATION_REQUEST';
 const [people,setPeople]=useState<{id:string;name:string}[]>([]),[handler,setHandler]=useState(''),[payer,setPayer]=useState(''),[dog,setDog]=useState(''),[title,setTitle]=useState(''),[amount,setAmount]=useState(''),[text,setText]=useState(''),[due,setDue]=useState(''),[editingDue,setEditingDue]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(!!saved);
 const attempt=useRef<PaymentAttempt|undefined>(saved),lock=useRef(false);
 useEffect(()=>{let live=true;void repository.handlers(type).then(rows=>{if(live){setPeople(rows);if(rows.length===1)setHandler(rows[0].id);}}).catch(e=>{if(live)setError(e.message);});return()=>{live=false;};},[repository,type]);
 const send=()=>{if(lock.current)return;try{if(!attempt.current){if(!handler)throw new Error('담당자를 선택해주세요.');if(!payer.trim()||(!confirmation&&(!title.trim()||!text.trim())))throw new Error('필수 항목을 입력해주세요.');attempt.current={type,action:'CREATE',version:0,key:crypto.randomUUID(),payload:confirmation?{handler_id:handler,payer_name:payer.trim(),amount:paymentAmount(amount),dog_name:dog.trim()||null,note:text.trim()||null}:{handler_id:handler,title:title.trim(),payee_name:payer.trim(),amount:paymentAmount(amount),reason:text.trim(),due_at:paymentDue(due)}};}pending.set(identity,attempt.current);setUncertain(true);lock.current=true;setBusy(true);setError('');void repository.command(attempt.current).then(r=>{pending.delete(identity);attempt.current=undefined;setUncertain(false);onCreated(r.id);}).catch(e=>{if(e instanceof PaymentFailure&&e.definite){pending.delete(identity);attempt.current=undefined;setUncertain(false);}setError(e.message);}).finally(()=>{lock.current=false;setBusy(false);});}catch(e){setError((e as Error).message);}};
 return <form className="pt-task-form payment-form" noValidate onSubmit={e=>{e.preventDefault();send();}}>
 <p className="pt-secondary">{confirmation?'입금 여부 확인 요청이며 매출·수납 내역은 자동 등록되지 않습니다.':'계좌번호·카드번호·비밀번호 등 금융 민감정보는 입력하지 마세요.'}</p>
 <fieldset disabled={busy||uncertain}>
 <label>{confirmation?'확인 담당자':'처리 담당자'}<select aria-label={confirmation?'확인 담당자':'처리 담당자'} value={handler} onChange={e=>setHandler(e.target.value)}><option value="">담당자 선택</option>{people.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select></label>
 {!people.length&&<p role="status">현재 선택 가능한 담당자가 없습니다.</p>}
 {!confirmation&&<label>제목<input maxLength={100} value={title} onChange={e=>setTitle(e.target.value)}/></label>}
 <label>{confirmation?'입금자명 / 확인 대상 이름':'지급 대상'}<input maxLength={100} value={payer} onChange={e=>setPayer(e.target.value)}/></label>
 <label>{confirmation?'확인 금액':'금액'}<input inputMode="numeric" value={amount} onChange={e=>setAmount(e.target.value)} aria-describedby="payment-amount-help"/></label><small id="payment-amount-help">원 · 요청 정보이며 회계 확정 금액이 아닙니다.</small>
 {confirmation&&<label>반려견 이름 · 선택<input maxLength={100} value={dog} onChange={e=>setDog(e.target.value)}/></label>}
 <label>{confirmation?'요청 메모 · 선택':'사유'}<textarea maxLength={2000} value={text} onChange={e=>setText(e.target.value)}/></label>
 {!confirmation&&<label>완료 희망일시 · 선택 · 한국 시간<input aria-label="완료 희망일시" type={due||editingDue?'datetime-local':'text'} placeholder="날짜와 시간을 선택해주세요" value={due} onFocus={()=>setEditingDue(true)} onBlur={()=>{if(!due)setEditingDue(false);}} onChange={e=>setDue(e.target.value)}/></label>}
 </fieldset>{uncertain&&<p role="status">이전 요청의 처리 결과를 같은 요청 번호로 확인합니다.</p>}{error&&<p role="alert">{error}</p>}
 <button className="pn-primary" disabled={busy||(!uncertain&&!people.length)}>{busy?'처리 중…':uncertain?'같은 요청으로 결과 확인':confirmation?'결제 확인 요청 보내기':'지급 요청 보내기'}</button></form>;
}
