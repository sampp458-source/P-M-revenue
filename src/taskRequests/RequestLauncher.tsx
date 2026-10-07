import {useState} from 'react';
import {Navigate,useLocation} from 'react-router-dom';
import {useAuth} from '../auth/AuthContext';
import {useNotifications} from '../notifications/notificationContext';
import {Modal} from '../components/ui';
import {useTaskAccess} from './useTaskAccess';
import {RequestTypeComposer} from '../paymentRequests/RequestTypeComposer';
import {usePaymentAccess} from '../paymentRequests/usePaymentAccess';
import {availableRequestTypes} from '../paymentRequests/paymentRequestPresentation';
import type {TaskAccess} from './taskRequestRepository';
import './taskRequests.css';

// Only implemented, permitted request types belong in this launcher.
export function canLaunchRequest(access: TaskAccess) { return access.enabled && access.can_create; }
export function RequestQuickAction() {
 const {user}=useAuth(),notifications=useNotifications();
 const access=useTaskAccess(user?.id,notifications?.inbox);
 const payment=usePaymentAccess(user?.id,notifications?.inbox);
 const types=availableRequestTypes(access,payment);
 const [open,setOpen]=useState(false);
 const location=useLocation();
 if(!user || payment.loading || !types.length || ['/operations/requests','/operations/tasks'].includes(location.pathname.replace(/\/$/,'')))return null;
 return <><button className="pt-request-quick" onClick={()=>setOpen(true)}>+ 요청</button>
 <Modal open={open} title={types.length===1&&types[0]==='TASK_REQUEST'?'업무요청 작성':'요청 작성'} onClose={()=>setOpen(false)} resetKey={location.key}>
 <RequestTypeComposer types={types} userId={user.id} onCreated={()=>setOpen(false)} />
 </Modal></>;
}
export function LegacyTaskRoute() {
 const location=useLocation();
 return <Navigate replace to={{pathname:'/operations/requests',search:location.search,hash:location.hash}} />;
}
