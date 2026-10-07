import { useEffect,useRef,useState } from 'react';
import { taskRequestRepository, type TaskRepository,type TaskRequest,type TaskCreate } from './taskRequestRepository';
import { taskDue,taskTime,taskStatus,taskSummary } from './taskRequestPresentation';
import './taskRequests.css';
import { pendingTaskCreates } from './taskAttempts';
import { TaskFailure } from './taskRequestRepository';
import {TaskRecipientPicker} from './TaskRecipientPicker';

export function TaskComposer({repository=taskRequestRepository,onCreated,userId='fixture'}:{repository?:TaskRepository;userId?:string;onCreated:(id:string)=>void}) {
 const [people,setPeople]=useState<{id:string;name:string}[]>([]),[selected,setSelected]=useState<string[]>(pendingTaskCreates.get(userId)?.recipientIds||[]);
 const saved=pendingTaskCreates.get(userId);
 const [title,setTitle]=useState(saved?.title||''),[body,setBody]=useState(saved?.body||''),[due,setDue]=useState(saved?new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(saved.dueAt)).replace(' ','T'):''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [editingDue,setEditingDue]=useState(false);
 const attempt=useRef<TaskCreate|null>(saved||null),lock=useRef(false);
 useEffect(()=>{let live=true;void repository.recipients().then(r=>{if(live)setPeople(r);}).catch(e=>{if(live)setError(e.message);});return()=>{live=false;};},[repository]);
 return <form className="pt-task-form" onSubmit={e=>{e.preventDefault();if(lock.current)return;setError('');let payload:TaskCreate;
 try{payload=attempt.current||{requestId:crypto.randomUUID(),title,body,dueAt:taskDue(due),recipientIds:selected};if(!payload.recipientIds.length)throw new Error('담당자를 선택해주세요.');}catch(e){setError((e as Error).message);return;}
 attempt.current=payload;pendingTaskCreates.set(userId,payload);lock.current=true;setBusy(true);void repository.create(payload).then(id=>{pendingTaskCreates.delete(userId);onCreated(id);}).catch(e=>{if(e instanceof TaskFailure&&e.definite){pendingTaskCreates.delete(userId);attempt.current=null;}setError(e.message);}).finally(()=>{lock.current=false;setBusy(false);});}}>
 <p className="pt-secondary">확인과 완료를 각각 기록합니다. 발행 후 내용 변경은 취소 후 새 요청으로 진행합니다.</p>
 <TaskRecipientPicker people={people} selected={selected} onChange={setSelected} disabled={busy||!!attempt.current}/>
 <label>제목<input required maxLength={100} value={title} disabled={!!attempt.current} onChange={e=>setTitle(e.target.value)}/></label>
 <label>내용<textarea required maxLength={4000} value={body} disabled={!!attempt.current} onChange={e=>setBody(e.target.value)}/></label>
 <label>완료기한 · 한국 시간<input aria-label="완료기한" aria-describedby="task-due-help" required type={due||editingDue?'datetime-local':'text'} placeholder="날짜와 시간을 선택해주세요" autoComplete="off" onFocus={()=>setEditingDue(true)} onBlur={()=>{if(!due)setEditingDue(false);}} value={due} disabled={!!attempt.current} onChange={e=>setDue(e.target.value)}/></label>
 <p id="task-due-help" className="pt-secondary">{due?'한국 시간 기준 · 현재보다 이후의 날짜와 시간을 선택해주세요.':'미선택 · 완료기한의 날짜와 시간을 직접 선택해주세요. (한국 시간)'}</p>
 {attempt.current&&<p className="pt-secondary">이전 요청의 처리 결과를 확인 중입니다. 같은 요청으로 재확인합니다.</p>}
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
