/** Read-only effective presentation; never changes schedule workflow or ACK. */
export type DaycareStatusSource={lifecycleStatus:string;checkedInAt:string|null;checkedOutAt:string|null};
export type EffectiveStatus={label:string;tone:'scheduled'|'completed'|'cancelled';key:string};
export function daycareOperationalStatus(operation:DaycareStatusSource|null|undefined):EffectiveStatus|null {
 if(!operation)return null;
 const {lifecycleStatus,checkedInAt,checkedOutAt}=operation;
 const entered=checkedInAt!==null&&Number.isFinite(Date.parse(checkedInAt));
 const exited=checkedOutAt!==null&&Number.isFinite(Date.parse(checkedOutAt));
 if(lifecycleStatus==='administratively_released'&&entered&&!checkedOutAt)return {label:'행정 점유 해제 · 실제 퇴실시각 미확정',tone:'scheduled',key:'reconciled'};
 if(lifecycleStatus==='cancelled'&&!checkedInAt&&!checkedOutAt)return {label:'취소',tone:'cancelled',key:'cancelled'};
 if(lifecycleStatus==='completed'&&entered&&exited&&Date.parse(checkedOutAt!)>=Date.parse(checkedInAt!))return {label:'완료',tone:'completed',key:'completed'};
 if(lifecycleStatus==='checked_in'&&entered&&!checkedOutAt)return {label:'이용중',tone:'scheduled',key:'in_use'};
 if(lifecycleStatus==='scheduled'&&!checkedInAt&&!checkedOutAt)return {label:'예정',tone:'scheduled',key:'scheduled'};
 return {label:'입퇴실 확인 필요',tone:'scheduled',key:'review'};
}
