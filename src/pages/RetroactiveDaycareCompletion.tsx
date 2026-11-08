import {useRef, useState} from 'react';
import {Button, Field, Input, Modal, ModalActions, Select} from '../components/ui';
import {completeRetrospectiveDaycareVisit, fetchDaycareReservation, type DaycareReservation} from './daycareOperationsRepository';
import type {HotelRoomSnapshot} from './hotelOperationsRepository';

type Form = {date:string;entry:string;exit:string;room:string;reason:string;evidence:string;confirmed:boolean};
const empty = ():Form => ({date:'',entry:'',exit:'',room:'',reason:'',evidence:'',confirmed:false});
const kstDay = (v:string) => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul'}).format(new Date(v));
export function retrospectiveProblems(form:Form,row:DaycareReservation,now=Date.now()) {
 const problems:string[]=[];
 const day=kstDay(row.startsAt);
 if(!form.date) problems.push('실제 이용 날짜 필요');
 else if(form.date!==day) problems.push('예약의 서비스 날짜와 일치해야 합니다.');
 if(day>=kstDay(new Date(now).toISOString())) problems.push('과거 이용 건만 사후 처리할 수 있습니다.');
 if(!form.entry) problems.push('실제 입실 시각 필요');
 if(!form.exit) problems.push('실제 퇴실 시각 필요');
 const entry=Date.parse(`${form.date}T${form.entry}:00+09:00`),exit=Date.parse(`${form.date}T${form.exit}:00+09:00`);
 if(form.entry&&form.exit&&(!Number.isFinite(entry)||!Number.isFinite(exit)||entry>=exit||exit>now)) problems.push('입퇴실 순서와 미래 시각을 확인해 주세요.');
 if(!form.room) problems.push('실제 사용 객실 확인 필요');
 if(!form.reason.trim()) problems.push('사후 처리 사유 필요');
 if(!form.evidence.trim()) problems.push('이용 사실 확인 근거 필요');
 if(!form.confirmed) problems.push('이용 확인 필요');
 return problems;
}
export function RetroactiveDaycareCompletion({reservation,rooms,onChanged}:{reservation:DaycareReservation;rooms:readonly HotelRoomSnapshot[];onChanged:()=>void|Promise<void>}) {
 const [open,setOpen]=useState(false),[form,setForm]=useState<Form>(empty),[review,setReview]=useState<DaycareReservation|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[attempted,setAttempted]=useState(false);
 const lock=useRef(false),request=useRef<string|null>(null);
 const patch=(value:Partial<Form>)=>{setForm(v=>({...v,...value,confirmed:value.confirmed??false}));setReview(null);};
 const problems=retrospectiveProblems(form,reservation);
 async function inspect(){if(lock.current||problems.length||attempted)return;lock.current=true;setBusy(true);setMessage('');try{const current=await fetchDaycareReservation(reservation.operationScheduleId);if(current.operationScheduleId!==reservation.operationScheduleId||current.lifecycleStatus!=='scheduled'||current.scheduleStatus!=='scheduled'||current.checkedInAt||current.checkedOutAt||current.version!==reservation.version||current.scheduleVersion!==reservation.scheduleVersion)throw new Error('예약 상태가 변경됐습니다. 화면을 새로고침해 주세요.');setReview(current);}catch(e){setMessage(e instanceof Error?e.message:'최신 상태 조회 실패');}finally{lock.current=false;setBusy(false);}}
 async function save(){if(lock.current||!review||problems.length||attempted)return;lock.current=true;setBusy(true);setAttempted(true);request.current??=crypto.randomUUID();try{await completeRetrospectiveDaycareVisit(review.operationScheduleId,review.version,form.room,`${form.date}T${form.entry}:00+09:00`,`${form.date}T${form.exit}:00+09:00`,form.reason,form.evidence,request.current);setMessage('사후 이용 기록이 완료됐습니다. 다시 실행하지 마세요.');setReview(null);}catch(e){setMessage(`${e instanceof Error?e.message:'응답을 확인하지 못했습니다.'} 배정과 완료는 한 트랜잭션입니다. 재실행하지 말고 최신 기록을 확인해 주세요. 요청 ID: ${request.current}`);}finally{lock.current=false;setBusy(false);try{await onChanged();}catch{setMessage(value=>value+' 화면 갱신에 실패했습니다. 완료 여부를 다시 조회하고 중복 실행하지 마세요.');}}}
 return <><Button variant="secondary" onClick={()=>{if(!attempted){setForm(empty());setMessage('');}setReview(null);setOpen(true);}}>사후 이용 처리</Button>
 <Modal open={open} title={`${reservation.dog.name} 사후 이용 처리`} description="관리자 전용 · 확인한 실제 이용 정보만 기록합니다." onClose={()=>{if(!busy)setOpen(false);}} size="small">
 <div className="grid min-w-0 gap-3" style={{overflowWrap:'anywhere'}}>
 <p className="text-sm">예약 서비스 날짜 {kstDay(reservation.startsAt)} · 현재 {reservation.lifecycleStatus} · 버전 {reservation.version}. 예정 시각을 실제 시각으로 복사하지 않습니다.</p>
 <Field label="실제 이용 날짜"><Input type="date" value={form.date} disabled={busy||attempted} onChange={e=>patch({date:e.target.value})}/></Field>
 <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2"><Field label="실제 입실 시각"><Input type="time" step="60" value={form.entry} disabled={busy||attempted} onChange={e=>patch({entry:e.target.value})}/></Field><Field label="실제 퇴실 시각"><Input type="time" step="60" value={form.exit} disabled={busy||attempted} onChange={e=>patch({exit:e.target.value})}/></Field></div>
 <Field label="실제 사용한 객실"><Select value={form.room} disabled={busy||attempted} onChange={e=>patch({room:e.target.value})}><option value="">확인한 호실 선택</option>{rooms.filter(r=>r.isActive&&r.roomTypeId===reservation.roomTypeId).map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</Select></Field>
 <Field label="사후 처리 사유"><Input maxLength={1000} value={form.reason} disabled={busy||attempted} onChange={e=>patch({reason:e.target.value})}/></Field>
 <Field label="이용 사실 확인 근거"><Input maxLength={2000} value={form.evidence} disabled={busy||attempted} onChange={e=>patch({evidence:e.target.value})}/></Field>
 <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={form.confirmed} disabled={busy||attempted} onChange={e=>patch({confirmed:e.target.checked})}/>실제 이용·입퇴실 시각·사용 객실을 확인했습니다.</label>
 {problems.length>0&&!attempted?<ul className="text-sm text-text-secondary">{problems.map(p=><li key={p}>{p}</li>)}</ul>:null}
 {review?<section aria-label="사후 이용 최종 확인" className="rounded-xl border border-border p-3 text-sm"><strong>{reservation.dog.name} · {form.date}</strong><p>{form.entry} → {form.exit} KST · {rooms.find(r=>r.id===form.room)?.name}</p><p>사유: {form.reason}<br/>근거: {form.evidence}</p><p>서버에서 과거 점유·배정·권한을 다시 검사합니다. 충돌하면 전체 취소되며 현재 객실 점유를 강제 해제하지 않습니다.</p></section>:null}
 {message?<p role="status" className="text-sm">{message}</p>:null}
 <ModalActions><Button variant="secondary" disabled={busy} onClick={()=>setOpen(false)}>닫기</Button>{review?<Button disabled={busy||attempted||problems.length>0} onClick={()=>void save()}>최종 확인 후 완료</Button>:<Button disabled={busy||attempted||problems.length>0} onClick={()=>void inspect()}>최신 상태 및 입력 확인</Button>}</ModalActions>
 </div></Modal></>;
}
