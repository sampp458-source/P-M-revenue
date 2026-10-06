import type { TaskRequest,TaskTarget } from './taskRequestRepository';
export const taskTime=(value:string)=>new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(value));
export function taskStatus(task:TaskRequest,target:TaskTarget,now=Date.now()) {
 if(task.cancelled_at)return '취소';
 if(target.completed_at)return Date.parse(target.completed_at)>Date.parse(task.due_at)?'완료 · 기한 초과':'완료';
 if(now>Date.parse(task.due_at))return target.acknowledged_at?'지연 · 확인':'지연 · 미확인';
 return target.acknowledged_at?'확인':'미확인';
}
export function taskSummary(task:TaskRequest,now=Date.now()) {
 return {total:task.targets.length,ack:task.targets.filter(t=>t.acknowledged_at).length,complete:task.targets.filter(t=>t.completed_at).length,overdue:task.cancelled_at?0:task.targets.filter(t=>!t.completed_at&&now>Date.parse(task.due_at)).length};
}
export function taskDue(value:string,now=Date.now()) {
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))throw new Error('완료기한의 날짜와 시간을 입력해주세요.');
 const d=new Date(`${value}:00+09:00`);
 if(!Number.isFinite(d.getTime()))throw new Error('완료기한의 날짜와 시간을 확인해주세요.');
 const check=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(d).replace(' ','T');
 if(!Number.isFinite(d.getTime())||check!==value||d.getTime()<=now)throw new Error('완료기한은 현재보다 이후로 설정해주세요.');
 return d.toISOString();
}
