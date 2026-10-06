import {useEffect,useState} from 'react';
import {useNotifications} from '../notifications/notificationContext';
import {useTaskAccess} from './useTaskAccess';
import {taskRequestRepository} from './taskRequestRepository';
import {TaskHub} from './TaskRequestUi';
export function TaskHomeEntry() {
 const state=useNotifications(),access=useTaskAccess(state?.userId,state?.inbox);
 const [count,setCount]=useState(0),[open,setOpen]=useState(false);
 useEffect(()=>{if(!access.enabled)return;let live=true;const refresh=()=>{if(document.visibilityState!=='hidden')void taskRequestRepository.summary().then(r=>{if(live)setCount(r.incomplete);}).catch(()=>{if(live)setCount(0);});};refresh();const timer=setInterval(refresh,30000);return()=>{live=false;clearInterval(timer);};},[access.enabled,state?.inbox]);
 if(!access.enabled||!state)return null;
 return <>{count>0&&<button className="pn-secondary-button" style={{minHeight:44}} onClick={()=>setOpen(true)}>업무요청 · 미완료 {count}</button>}{open&&<TaskHub userId={state.userId} access={access} revision={state.inbox} onClose={()=>setOpen(false)}/>}</>;
}
