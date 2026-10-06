import { useCallback,useEffect,useRef,useState } from 'react';
import { Modal } from '../components/ui';
import { taskRequestRepository, type TaskRepository,type TaskRequest,type TaskAccess,type TaskCreate } from './taskRequestRepository';
import { taskDue,taskTime,taskStatus,taskSummary } from './taskRequestPresentation';
import './taskRequests.css';
import { pendingTaskCreates } from './taskAttempts';
import { TaskFailure } from './taskRequestRepository';

export function TaskComposer({repository=taskRequestRepository,onCreated,userId='fixture'}:{repository?:TaskRepository;userId?:string;onCreated:(id:string)=>void}) {
 const [people,setPeople]=useState<{id:string;name:string}[]>([]),[selected,setSelected]=useState<string[]>(pendingTaskCreates.get(userId)?.recipientIds||[]);
 const saved=pendingTaskCreates.get(userId);
 const [title,setTitle]=useState(saved?.title||''),[body,setBody]=useState(saved?.body||''),[due,setDue]=useState(saved?new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(saved.dueAt)).replace(' ','T'):''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const attempt=useRef<TaskCreate|null>(saved||null),lock=useRef(false);
 useEffect(()=>{let live=true;void repository.recipients().then(r=>{if(live)setPeople(r);}).catch(e=>{if(live)setError(e.message);});return()=>{live=false;};},[repository]);
 return <form className="pt-task-form" onSubmit={e=>{e.preventDefault();if(lock.current)return;setError('');let payload:TaskCreate;
 try{payload=attempt.current||{requestId:crypto.randomUUID(),title,body,dueAt:taskDue(due),recipientIds:selected};if(!payload.recipientIds.length)throw new Error('담당자를 선택해주세요.');}catch(e){setError((e as Error).message);return;}
 attempt.current=payload;pendingTaskCreates.set(userId,payload);lock.current=true;setBusy(true);void repository.create(payload).then(id=>{pendingTaskCreates.delete(userId);onCreated(id);}).catch(e=>{if(e instanceof TaskFailure&&e.definite){pendingTaskCreates.delete(userId);attempt.current=null;}setError(e.message);}).finally(()=>{lock.current=false;setBusy(false);});}}>
 <p className="pt-secondary">확인과 완료를 각각 기록합니다. 발행 후 내용 변경은 취소 후 새 요청으로 진행합니다.</p>
 <fieldset disabled={busy||!!attempt.current}><legend>담당자</legend>{people.map(p=><label className="pt-check" key={p.id}><input type="checkbox" checked={selected.includes(p.id)} onChange={e=>setSelected(e.target.checked?[...selected,p.id]:selected.filter(id=>id!==p.id))}/>{p.name}</label>)}</fieldset>
 <label>제목<input required maxLength={100} value={title} disabled={!!attempt.current} onChange={e=>setTitle(e.target.value)}/></label>
 <label>내용<textarea required maxLength={4000} value={body} disabled={!!attempt.current} onChange={e=>setBody(e.target.value)}/></label>
 <label>완료기한 · 한국 시간<input aria-label="완료기한" required type="datetime-local" value={due} disabled={!!attempt.current} onChange={e=>setDue(e.target.value)}/></label>
 {error&&<p role="alert">{error}</p>}<button className="pn-primary" disabled={busy}>{busy?'처리 중…':attempt.current?'같은 요청으로 결과 확인':'업무요청 보내기'}</button>
 </form>;
}
export function TaskDetail({task,userId,repository=taskRequestRepository,onRefresh}:{task:TaskRequest;userId:string;repository?:TaskRepository;onRefresh:()=>Promise<void>}) {
 const mine=task.targets.find(t=>t.recipient_id===userId),summary=taskSummary(task);
 const [note,setNote]=useState(''),[reason,setReason]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const pending=useRef<{action:string;key:string;value:string}|null>(null),lock=useRef(false);
 const act=(action:'ack'|'complete'|'cancel')=>{if(lock.current)return;const value=action==='cancel'?reason:action==='complete'?note:'';if(action==='cancel'&&!value.trim()){setError('취소 사유를 입력해주세요.');return;}
 const p=pending.current||{action,key:crypto.randomUUID(),value};if(p.action!==action){setError('이전 요청의 결과를 먼저 확인해주세요.');return;}pending.current=p;lock.current=true;setBusy(true);setError('');
 const request=action==='ack'?repository.ack(task.id,p.key):action==='complete'?repository.complete(task.id,p.key,p.value):repository.cancel(task.id,p.key,p.value);
 void request.then(async()=>{pending.current=null;await onRefresh();}).catch(e=>{if(e instanceof TaskFailure&&e.definite)pending.current=null;setError(e.message);}).finally(()=>{lock.current=false;setBusy(false);});};
 return <article className="pt-task-detail"><p className="pt-secondary">업무요청</p><h3>{task.title}</h3><p className="pt-body">{task.body}</p><p>{task.requester_name} · 완료기한 {taskTime(task.due_at)}</p>
 <p>담당 {summary.total} · 확인 {summary.ack} · 완료 {summary.complete} · 지연 {summary.overdue}</p>
 {task.targets.map(t=><div className="pt-target" key={t.recipient_id}><strong>{t.name}</strong><span>{taskStatus(task,t)}</span>{t.acknowledged_at&&<small>확인 {taskTime(t.acknowledged_at)}</small>}{t.completed_at&&<small>완료 {taskTime(t.completed_at)}</small>}{t.completion_note&&<p className="pt-body">{t.completion_note}</p>}</div>)}
 {task.cancelled_at?<p>취소 · {task.cancel_reason}</p>:mine&&!mine.completed_at&&<>{mine.acknowledged_at?<><label>완료 메모 · 선택<textarea value={note} maxLength={1000} disabled={busy||!!pending.current} onChange={e=>setNote(e.target.value)}/></label><button className="pn-primary" disabled={busy} onClick={()=>act('complete')}>완료했습니다</button></>:<button className="pn-primary" disabled={busy} onClick={()=>act('ack')}>확인했습니다</button>}</>}
 {task.can_cancel&&!task.cancelled_at&&summary.complete<summary.total&&<details><summary>업무요청 취소</summary><label>취소 사유<textarea value={reason} maxLength={1000} disabled={busy||!!pending.current} onChange={e=>setReason(e.target.value)}/></label><button disabled={busy} onClick={()=>act('cancel')}>취소하기</button></details>}
 {error&&<p role="alert">{error}</p>}</article>;
}
export function TaskHub({userId,access,initialId,onClose,revision,repository=taskRequestRepository}:{userId:string;access:TaskAccess;initialId?:string;onClose:()=>void;revision:unknown;repository?:TaskRepository}) {
 const [scope,setScope]=useState<'inbox'|'sent'|'all'>('inbox'),[filter,setFilter]=useState('active'),[offset,setOffset]=useState(0),[items,setItems]=useState<TaskRequest[]>([]),[id,setId]=useState(initialId),[detail,setDetail]=useState<TaskRequest|null>(null),[compose,setCompose]=useState(false),[error,setError]=useState('');
 const generation=useRef(0);
 const invalidate=useCallback(()=>{generation.current++;},[]);
 const load=useCallback(async()=>{const token=++generation.current;try{if(id){const next=await repository.detail(id);if(token===generation.current)setDetail(next);}else{const next=await repository.list(scope,offset,filter);if(token===generation.current)setItems(next);}if(token===generation.current)setError('');}catch(e){if(token===generation.current){setError((e as Error).message);setDetail(null);}}},[id,repository,scope,offset,filter]);
 useEffect(()=>{let live=true;const refresh=()=>{if(live&&document.visibilityState!=='hidden')void load();};refresh();const timer=setInterval(refresh,30000);window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);return()=>{live=false;invalidate();clearInterval(timer);window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);};},[load,revision,invalidate]);
 const shown=items.filter(t=>{const ts=scope==='inbox'?t.targets.filter(v=>v.recipient_id===userId):t.targets;const complete=ts.every(v=>v.completed_at);return filter==='all'||(filter==='done'?complete:!complete&&!t.cancelled_at);});
 return <Modal open title={compose?'업무요청 작성':id?'업무요청 상세':'내 업무요청'} onClose={onClose} size="medium"><div className="pt-task">
 {error&&<p role="alert">{error}</p>}
 {compose?<><button onClick={()=>setCompose(false)}>목록으로</button><TaskComposer userId={userId} repository={repository} onCreated={value=>{setCompose(false);setId(value);}}/></>:id?<><button onClick={()=>{setId(undefined);setDetail(null);}}>목록으로</button>{detail&&<TaskDetail key={detail.id} task={detail} userId={userId} repository={repository} onRefresh={load}/>}</>:<>
 <nav aria-label="업무요청 목록"><button aria-pressed={scope==='inbox'} onClick={()=>{setScope('inbox');setOffset(0);}}>받은 업무</button><button aria-pressed={scope==='sent'} onClick={()=>{setScope('sent');setOffset(0);}}>내가 요청한 업무</button>{access.owner&&<button onClick={()=>{setScope('all');setOffset(0);}}>전체 현황</button>}</nav>
 {access.can_create&&<button className="pn-primary" onClick={()=>setCompose(true)}>업무요청 작성</button>}
 <label>상태<select value={filter} onChange={e=>{setFilter(e.target.value);setOffset(0);}}><option value="active">진행중</option><option value="done">완료</option><option value="all">전체</option></select></label>
 {shown.map(t=>{const sum=taskSummary(t);return <button className="pt-task-row" key={t.id} onClick={()=>setId(t.id)}><strong>{t.title}</strong><span>{t.requester_name} · {taskTime(t.due_at)}</span><span>담당 {sum.total} · 확인 {sum.ack} · 완료 {sum.complete} · 지연 {sum.overdue}</span></button>;})}
 {!shown.length&&<p>표시할 업무요청이 없습니다.</p>}<div><button disabled={!offset} onClick={()=>setOffset(Math.max(0,offset-50))}>이전</button><button disabled={items.length<50} onClick={()=>setOffset(offset+50)}>다음</button></div>
 </>}
 </div></Modal>;
}
