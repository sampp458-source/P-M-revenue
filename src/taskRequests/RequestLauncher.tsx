import {useState} from 'react';
import {Navigate,useLocation} from 'react-router-dom';
import {useAuth} from '../auth/AuthContext';
import {useNotifications} from '../notifications/notificationContext';
import {Modal} from '../components/ui';
import {useTaskAccess} from './useTaskAccess';
import {TaskComposer} from './TaskRequestUi';
import type {TaskAccess} from './taskRequestRepository';
import './taskRequests.css';

// Only implemented, permitted request types belong in this launcher.
export function canLaunchRequest(access: TaskAccess) { return access.enabled && access.can_create; }
export function RequestQuickAction() {
 const {user}=useAuth(),notifications=useNotifications();
 const access=useTaskAccess(user?.id,notifications?.inbox);
 const [open,setOpen]=useState(false);
 const location=useLocation();
 if(!user || !canLaunchRequest(access) || ['/operations/requests','/operations/tasks'].includes(location.pathname.replace(/\/$/,'')))return null;
 return <><button className="pt-request-quick" onClick={()=>setOpen(true)}>+ 요청</button>
 <Modal open={open} title="업무요청 작성" onClose={()=>setOpen(false)} resetKey={location.key}>
 <TaskComposer userId={user.id} onCreated={()=>setOpen(false)} />
 </Modal></>;
}
export function LegacyTaskRoute() {
 const location=useLocation();
 return <Navigate replace to={{pathname:'/operations/requests',search:location.search,hash:location.hash}} />;
}
