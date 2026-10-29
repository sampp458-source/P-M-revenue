import {useEffect,useRef} from 'react';
/** Re-read canonical server data on return to a page; do not infer state from time. */
export function useScheduleOperationalRefresh(refresh:()=>Promise<unknown>){
 const latest=useRef(refresh);latest.current=refresh;
 useEffect(()=>{let pending=false;
 const update=()=>{if(pending||document.visibilityState==='hidden')return;pending=true;void latest.current().catch(()=>undefined).finally(()=>{pending=false;});};
 window.addEventListener('focus',update);document.addEventListener('visibilitychange',update);
 return()=>{window.removeEventListener('focus',update);document.removeEventListener('visibilitychange',update);};
 },[]);
}
