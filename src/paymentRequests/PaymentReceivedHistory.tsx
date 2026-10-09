import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {useSearchParams} from 'react-router-dom';
import {paymentRequestRepository,PaymentFailure} from './paymentRequestRepository';
import {ConfirmationInboxCard} from './ConfirmationInboxCard';
import {createConfirmationDetailReads} from './confirmationDetailReads';
import {paymentLabels,type HubRow,type PaymentType} from './paymentRequestTypes';
import {paymentStatus} from './paymentRequestPresentation';
export const paymentHistoryToday=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export function movePaymentHistoryDate(date:string,step:number){const value=new Date(`${date}T12:00:00Z`);value.setUTCDate(value.getUTCDate()+step);return value.toISOString().slice(0,10);}
type Page={count:number;items:HubRow[]};
export function PaymentReceivedHistory({userId,type,filter,revision,onOpen}:{userId:string;type:string;filter:string;revision:unknown;onOpen:(row:HubRow)=>void}){
 const [params,setParams]=useSearchParams();
 const requestedDate=params.get('historyDate')||'';
 const validDate=/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)&&Number.isFinite(Date.parse(`${requestedDate}T12:00:00Z`))&&new Date(`${requestedDate}T12:00:00Z`).toISOString().slice(0,10)===requestedDate;
 const date=validDate?requestedDate:paymentHistoryToday();
 const pageOffset=(name:string)=>{const n=Number(params.get(name)||0);return Number.isSafeInteger(n)&&n>=0&&n<=100000?n:0;};
 const openOffset=pageOffset('paymentOpenOffset'),closedOffset=pageOffset('paymentClosedOffset');
 const change=(values:Record<string,string>)=>{const next=new URLSearchParams(params);next.set('paymentView','history');for(const [name,value] of Object.entries(values))next.set(name,value);setParams(next);};
 const setOpenOffset=(n:number)=>change({paymentOpenOffset:String(n)}),setClosedOffset=(n:number)=>change({paymentClosedOffset:String(n)});
 const setDate=(value:string)=>change({historyDate:value,paymentClosedOffset:'0'});
 const [pages,setPages]=useState<{key:string;openKey:string;closedKey:string;open:Page;closed:Page}>(),[loading,setLoading]=useState(true),[error,setError]=useState(''),[held,setHeld]=useState(false),[locks,setLocks]=useState<Record<string,boolean>>({}),[epoch,setEpoch]=useState(0);
 const frozen=useRef(false),generation=useRef(0),correcting=useRef<string|undefined>(undefined),explicitRefresh=useRef(false);const key=JSON.stringify([userId,type,date,openOffset,closedOffset]),openKey=JSON.stringify([userId,type,openOffset]),closedKey=JSON.stringify([userId,type,date,closedOffset]);
 const reads=useMemo(()=>({userId,schedule:createConfirmationDetailReads()}),[userId]);
 const lockChange=useCallback((id:string,locked:boolean)=>setLocks(current=>({...current,[id]:locked})),[]);
 const load=useCallback(async(explicit=false)=>{
   if((frozen.current&&!explicit)||correcting.current===key)return;
   if(explicit)explicitRefresh.current=true;
   const token=++generation.current;let redirected=false;setLoading(true);
   try{
     const {open,...closed}=await paymentRequestRepository.history(type,date,closedOffset,openOffset);
     if(token===generation.current){
       const validOffset=(offset:number,count:number)=>offset>0&&offset>=count?Math.max(0,Math.floor((count-1)/50)*50):offset;
       const nextOpen=validOffset(openOffset,open.count),nextClosed=validOffset(closedOffset,closed.count);
       if(nextOpen!==openOffset||nextClosed!==closedOffset){
         redirected=true;correcting.current=key;
         setParams(current=>{const next=new URLSearchParams(current);if(nextOpen!==openOffset)next.set('paymentOpenOffset',String(nextOpen));if(nextClosed!==closedOffset)next.set('paymentClosedOffset',String(nextClosed));return next;},{replace:true});
         return;
       }
       correcting.current=undefined;setPages({key,openKey,closedKey,open,closed});setError('');
       if(explicitRefresh.current){explicitRefresh.current=false;frozen.current=false;setHeld(false);setEpoch(v=>v+1);}
     }
   }catch(e){if(token===generation.current){correcting.current=undefined;explicitRefresh.current=false;setError((e as Error).message);if(e instanceof PaymentFailure&&e.definite)setPages(undefined);}}
   finally{if(token===generation.current&&!redirected)setLoading(false);}
 },[key,openKey,closedKey,type,date,openOffset,closedOffset,setParams]);
 useEffect(()=>{frozen.current=false;setHeld(false);},[key]);
 useEffect(()=>{const requests=generation;const refresh=()=>{if(document.visibilityState!=='hidden')void load();};refresh();window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);const timer=setInterval(refresh,30000);return()=>{requests.current++;clearInterval(timer);window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);};},[load,revision]);
 const ready=pages?.closedKey===closedKey,openReady=pages?.openKey===openKey;
 const row=(r:HubRow)=>r.request_type==='PAYMENT_CONFIRMATION_REQUEST'?<ConfirmationInboxCard key={r.id} row={r} userId={userId} readEpoch={epoch} scheduleRead={reads.schedule} onLockChange={lockChange} onProcessing={()=>{generation.current++;frozen.current=true;setHeld(true);setLoading(false);}} onOpen={()=>onOpen(r)}/>:<button key={r.id} className="pt-task-row" onClick={()=>onOpen(r)}><small>{paymentLabels[r.request_type]}</small><strong>{r.display_title}</strong><span>{r.counterparty} · {r.administrative_cancelled?'관리 종료':paymentStatus(r.request_type as PaymentType,r.status)}</span></button>;
 const pagination=(offset:number,count:number,set:(n:number)=>void,label:string)=><nav className="pt-pagination" aria-label={label}><button disabled={!offset||loading||held||Object.values(locks).some(Boolean)} onClick={()=>set(Math.max(0,offset-50))}>이전</button><button disabled={offset+50>=count||loading||held||Object.values(locks).some(Boolean)} onClick={()=>set(offset+50)}>다음</button></nav>;
 return <section className="payment-history-workspace" aria-label="결제 처리 대기 및 이력" aria-busy={loading}><header className="payment-list-heading"><h2>결제 요청</h2><button disabled={loading||Object.values(locks).some(Boolean)} onClick={()=>void load(true)}>결제 목록 갱신</button></header><span className="payment-refresh-status" role="status">{held?'조회 순서·건수 유지 중 · 최신 목록은 갱신해주세요.':loading?'결제 요청 업데이트 중':''}</span>{error&&<p role="alert">{error}</p>}
 {filter!=='done'&&<section aria-label="처리 대기"><h3>처리 대기 {openReady?`${pages.open.count}건`:''}</h3><p className="pt-secondary">날짜와 관계없이 미처리 결제 요청을 표시합니다.</p><div className="pt-task-list">{openReady&&pages.open.items.map(row)}</div>{openReady&&!pages.open.items.length&&<p>처리 대기 요청이 없습니다.</p>}{openReady&&pagination(openOffset,pages.open.count,setOpenOffset,'처리 대기 페이지')}</section>}
 {filter!=='active'&&<section aria-label="처리 이력"><h3>처리 이력 {ready?`${pages.closed.count}건`:''}</h3><div className="payment-history-date"><button aria-label="이전 날짜" disabled={held||Object.values(locks).some(Boolean)} onClick={()=>{setDate(movePaymentHistoryDate(date,-1));}}>이전 날짜</button><label>처리 날짜 (한국 시간)<input type="date" disabled={held||Object.values(locks).some(Boolean)} value={date} onChange={e=>{if(e.target.value){setDate(e.target.value);}}}/></label><button aria-label="다음 날짜" disabled={held||Object.values(locks).some(Boolean)} onClick={()=>{setDate(movePaymentHistoryDate(date,1));}}>다음 날짜</button></div><div className="pt-task-list">{ready&&pages.closed.items.map(row)}</div>{ready&&!pages.closed.items.length&&<p>선택한 날짜에 처리된 요청이 없습니다.</p>}{ready&&pagination(closedOffset,pages.closed.count,setClosedOffset,'처리 이력 페이지')}</section>}
 </section>;
}
