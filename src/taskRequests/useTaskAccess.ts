import {useEffect,useState} from 'react';
import {taskUiEnabled,taskRequestRepository,type TaskAccess} from './taskRequestRepository';
export function useTaskAccess(identity?:string,revision?:unknown) {
 const [loaded,setLoaded]=useState<string>();
 const [access,setAccess]=useState<TaskAccess>({enabled:false,can_create:false,owner:false});
 useEffect(()=>{if(!taskUiEnabled||!identity)return;let live=true;
 const refresh=()=>{if(document.visibilityState==='hidden')return;void taskRequestRepository.access().then(a=>{if(live){setAccess(a);setLoaded(identity);}}).catch(()=>{if(live){setAccess({enabled:false,can_create:false,owner:false});setLoaded(identity);}});};
 refresh();const timer=setInterval(refresh,30000);window.addEventListener('focus',refresh);return()=>{live=false;clearInterval(timer);window.removeEventListener('focus',refresh);};},[identity,revision]);
 return {...(loaded===identity?access:{enabled:false,can_create:false,owner:false}),loading:!!identity&&taskUiEnabled&&loaded!==identity};
}
