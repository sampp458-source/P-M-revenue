import { useEffect, useRef, useState } from "react";
import { adminPushSelfTest, type SelfTestContext, type SelfTestResult } from "./pushSelfTestRepository";
export function AdminPushSelfTest({userId, api=adminPushSelfTest}:{userId:string;api?:typeof adminPushSelfTest}) {
 const [context,setContext]=useState<SelfTestContext>(); const [confirmed,setConfirmed]=useState(false);
 const [busy,setBusy]=useState(false); const [error,setError]=useState(""); const [result,setResult]=useState<SelfTestResult>();
 const lock=useRef(false); const request=useRef<string | null>(null);
 useEffect(()=>{let live=true;void api.context().then(c=>{if(live)setContext(c);}).catch(()=>{});return()=>{live=false;};},[userId,api]);
 const refresh=async()=>{if(lock.current)return;setBusy(true);setError("");try{const c=await api.context();setContext(c);if(request.current&&c.latest?.request_id===request.current)setResult(c.latest);}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
 const send=async()=>{if(lock.current||result||!confirmed||!context?.subscription)return;lock.current=true;setBusy(true);setError("");try{
   const fresh=await api.context();setContext(fresh);
   if(!fresh.allowed||fresh.blocked||!fresh.subscription||fresh.subscription.id!==context.subscription.id||fresh.subscription.binding_id!==context.subscription.binding_id){setConfirmed(false);throw new Error("기기 연결을 다시 확인해 주세요.");}
   request.current ||= crypto.randomUUID();
   setResult(await api.send(request.current,fresh.subscription.id,fresh.subscription.binding_id));
 }catch(e){setError((e as Error).message);}finally{lock.current=false;setBusy(false);}};
 if(!context?.allowed)return null;
 return <section className="pn-push-settings" aria-label="관리자 본인 테스트 알림">
  <strong>내 기기로 테스트 알림 보내기</strong>
  <p className="pn-secondary">로그인한 본인에게만 전송합니다. 5분에 1회 · 하루 최대 3회.</p>
  {context.blocked ? <p role="status">{context.blocked}</p> : context.subscription && <>
   <p>연결 기기: {context.subscription.provider} · 연결 확인 {new Date(context.subscription.last_seen_at).toLocaleString("ko-KR",{timeZone:"Asia/Seoul"})}</p>
   <p>제목: [테스트 알림] 새 미리보기 확인</p><p>P&M OS 알림 표시 테스트입니다. 실제 업무 처리는 필요하지 않습니다.</p>
   {!result && <label><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/> 본인의 연결 기기를 확인했습니다.</label>}
   <div><button className="pn-secondary-button" disabled={busy||!confirmed||!!result} onClick={()=>void send()}>테스트 알림 1건 보내기</button></div>
  </>}
  {result && <p role="status">{result.status === "SENT" ? "전송 제공자가 수락했습니다. 기기 표시와 소리를 확인해 주세요." : `전송 상태: ${result.status}`}<br/>알림 {result.notification_id}<br/>전송 {result.delivery_id}</p>}
  <button className="pn-secondary-button" disabled={busy} onClick={()=>void refresh()}>기기·전송 결과 다시 확인</button>
  {error&&<p role="alert">{error}</p>}
 </section>;
}
