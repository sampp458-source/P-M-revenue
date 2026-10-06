import { useCallback,useEffect,useRef,useState } from 'react';
import {taskRequestRepository,TaskFailure,type TaskRepository,type CapabilityRow} from './taskRequestRepository';
import './taskRequests.css';
const labels:Record<string,string>={ANNOUNCEMENT_PUBLISH:'공지 발행',ANNOUNCEMENT_RECEIPTS_VIEW:'공지 확인현황 조회',TASK_REQUEST_CREATE:'업무요청 발행'};
type Attempt={id:string;capability:string;active:boolean;version:number;key:string};
export function CapabilityManagement({repository=taskRequestRepository}:{repository?:TaskRepository}) {
 const [rows,setRows]=useState<CapabilityRow[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[pending,setPending]=useState<Attempt|null>(null);const lock=useRef(false);
 const load=useCallback(async()=>{try{setRows(await repository.directory());setError('');}catch(e){setError((e as Error).message);setRows([]);}},[repository]);
 useEffect(()=>{void load();},[load]);
 const submit=(p:Attempt)=>{if(lock.current)return;lock.current=true;setBusy(true);setPending(p);void repository.setCapability(p.id,p.capability,p.active,p.version,p.key).then(async()=>{setPending(null);await load();}).catch(e=>{if(e instanceof TaskFailure&&e.definite)setPending(null);setError(e.message);}).finally(()=>{lock.current=false;setBusy(false);});};
 return <section className="pt-permissions"><h2>업무 기능 권한</h2><p>운영 최고 관리자만 변경할 수 있습니다. 작성 권한 회수 후에도 기존 업무요청은 유지됩니다.</p>{error&&<p role="alert">{error}</p>}{pending&&!busy&&<button onClick={()=>submit(pending)}>같은 요청으로 결과 확인</button>}{rows.map(r=><fieldset key={r.id} disabled={busy||!!pending||!r.active}><legend>{r.name}</legend>{Object.entries(labels).map(([key,label])=><label key={key}><input type="checkbox" checked={r.capabilities[key]?.active||false} disabled={key==='TASK_REQUEST_CREATE'&&!r.operation_active} onChange={e=>submit({id:r.id,capability:key,active:e.target.checked,version:r.capabilities[key]?.version||0,key:crypto.randomUUID()})}/>{label}</label>)}</fieldset>)}<button disabled={busy||!!pending} onClick={()=>void load()}>새로고침</button></section>;
}
