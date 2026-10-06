import {useEffect,useState} from 'react';
import {useNotifications} from '../notifications/notificationContext';
import {useTaskAccess} from './useTaskAccess';
import {taskRequestRepository} from './taskRequestRepository';
import {useNavigate} from 'react-router-dom';
import {taskRequestPath} from './taskNavigation';
export function TaskHomeEntry() {
 const navigate=useNavigate();
 const state=useNotifications(),access=useTaskAccess(state?.userId,state?.inbox);
 const [count,setCount]=useState(0);
 useEffect(()=>{if(!access.enabled)return;let live=true;const refresh=()=>{if(document.visibilityState!=='hidden')void taskRequestRepository.summary().then(r=>{if(live)setCount(r.incomplete);}).catch(()=>{if(live)setCount(0);});};refresh();const timer=setInterval(refresh,30000);return()=>{live=false;clearInterval(timer);};},[access.enabled,state?.inbox]);
 if(!access.enabled||!state)return null;
 return <>{count>0&&<button className="pn-secondary-button" style={{minHeight:44}} onClick={()=>navigate(taskRequestPath())}>요청 · 미완료 {count}</button>}</>;
}
