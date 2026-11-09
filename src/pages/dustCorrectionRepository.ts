import {supabase} from '../lib/supabase';

export const DUST = Object.freeze({
 stay: 'd8f7de04-4db3-49bb-b9cb-23850e1c283c', dog: '505505b5-fc7d-4683-9ce6-cb67ec291b77',
 capacity: '798cbb68-ec89-431d-88de-a8507d11c1c7',
 oldAllocation: 'd872ca7e-9cc7-4db3-80b7-28385238136b', newAllocation: '1486a81c-700b-48db-a356-896174b26bf4',
 oldRoom: '80b56ae0-1d3d-4a27-80d6-9859bbcf96ae', newRoom: '56bed086-9fb0-46ec-83a0-95dfad265f65',
 moveRequest: '09fcf996-f224-4b3e-ae20-996f8ea3d94e', moveAudit: '9dc39c10-d078-4404-b79b-69c7db2008cd',
 oldBoundary: '2026-11-07T10:35:00Z', correctedBoundary: '2026-11-07T00:00:00Z',
 entered: '2026-11-06T12:58:00Z', exited: '2026-11-08T07:34:00Z',
});
export interface DustCorrectionState { actorId:string; completed:boolean; fingerprint:string; stayVersion:number; oldVersion:number; newVersion:number; auditId:string|null; }
function fail(message='대상 또는 기록이 변경됐습니다. 실행하지 않고 확인이 필요합니다.'):never{throw new Error(message);}
const sameTime=(a:unknown,b:string)=>typeof a==='string' && Date.parse(a)===Date.parse(b);
async function administrator(){
 const user=await supabase.auth.getUser();
 if(user.error||!user.data.user)fail('관리자 로그인이 필요합니다.');
 for(const name of ['is_admin','is_active_operation_member','can_operate_hotel']){
  const r=await supabase.rpc(name);if(r.error||r.data!==true)fail('활성 호텔 관리자만 실행할 수 있습니다.');
 }
 return user.data.user.id;
}
/** Read-only UI precheck. The installed command repeats authoritative history,
 * physical occupancy, capacity and provenance checks under row/advisory locks. */
export async function inspectDustCorrection():Promise<DustCorrectionState>{
 const actorId=await administrator();
 const [s,c,a,e]=await Promise.all([
  supabase.from('hotel_stays').select('id,dog_id,version,checked_in_at,checked_out_at,archived_at').eq('id',DUST.stay).single(),
  supabase.from('hotel_capacity_reservations').select('id,hotel_stay_id,version,reserved_from,reserved_until,quantity,source_kind,shared_room_group_id,physical_occupancy_id,archived_at').eq('id',DUST.capacity).single(),
  supabase.from('hotel_room_allocations').select('id,room_id,capacity_reservation_id,version,allocated_from,allocated_until,request_id,archived_at').eq('capacity_reservation_id',DUST.capacity).order('id').limit(3),
  supabase.from('entity_audit_events').select('id,entity_type,entity_id,request_id,changed_by,created_at,after_data').eq('entity_id',DUST.stay).in('entity_type',['hotel_stays','hotel_transfer_boundary_correction']).order('id').limit(101),
 ]);
 if(s.error||c.error||a.error||e.error||!s.data||!c.data||!a.data||!e.data||e.data.length>=101)fail('최신 기록 조회에 실패했습니다. 실행하지 않습니다.');
 const stay=s.data,cap=c.data,old=a.data.find(x=>x.id===DUST.oldAllocation),next=a.data.find(x=>x.id===DUST.newAllocation);
 if(stay.id!==DUST.stay||stay.dog_id!==DUST.dog||stay.version!==6||stay.archived_at!==null||!sameTime(stay.checked_in_at,DUST.entered)||!sameTime(stay.checked_out_at,DUST.exited)
 ||cap.id!==DUST.capacity||cap.hotel_stay_id!==DUST.stay||cap.version!==3||cap.archived_at!==null||cap.quantity!==1||cap.source_kind!=='stay'||cap.shared_room_group_id!==null||cap.physical_occupancy_id!==null
 ||!sameTime(cap.reserved_from,'2026-11-06T10:00:00Z')||!sameTime(cap.reserved_until,'2026-11-08T09:00:00Z')
 ||a.data.length!==2||!old||!next||old.room_id!==DUST.oldRoom||next.room_id!==DUST.newRoom||old.capacity_reservation_id!==DUST.capacity||next.capacity_reservation_id!==DUST.capacity
 ||old.archived_at!==null||next.archived_at!==null||!sameTime(old.allocated_from,DUST.entered)||!sameTime(next.allocated_until,DUST.exited)||next.request_id!==DUST.moveRequest)fail();
 const root=e.data.find(x=>x.id===DUST.moveAudit);
 if(!root||root.entity_type!=='hotel_stays'||root.request_id!==DUST.moveRequest||!root.changed_by||!sameTime(root.created_at,'2026-11-07T10:36:00.194645Z'))fail('원본 이동 감사 근거가 일치하지 않습니다.');
 const corrections=e.data.filter(x=>x.entity_type==='hotel_transfer_boundary_correction');
 const completed=corrections.length===1 && corrections[0].after_data?.operation==='dust_transfer_20261107_v1'
  && corrections[0].after_data?.proof?.moveAuditId===DUST.moveAudit
  && sameTime(corrections[0].after_data?.proof?.correctedBoundary,DUST.correctedBoundary)
  && old.version===3 && next.version===4 && sameTime(old.allocated_until,DUST.correctedBoundary)&&sameTime(next.allocated_from,DUST.correctedBoundary);
 if(!completed&&(corrections.length!==0||old.version!==2||next.version!==3||!sameTime(old.allocated_until,DUST.oldBoundary)||!sameTime(next.allocated_from,DUST.oldBoundary)))fail();
 if(!completed){
  const conflicts=await supabase.from('hotel_room_allocations').select('id').eq('room_id',DUST.newRoom).neq('id',DUST.newAllocation).lt('allocated_from',DUST.exited).gt('allocated_until',DUST.correctedBoundary).limit(1);
  if(conflicts.error||!conflicts.data)fail('객실 배정 충돌 조회에 실패했습니다.');
  if(conflicts.data.length)fail('STANDARD 5의 확장 구간에 다른 배정 이력이 있습니다. 실행할 수 없습니다.');
  for(const [room,from,until,allocation] of [[DUST.oldRoom,DUST.entered,DUST.correctedBoundary,DUST.oldAllocation],[DUST.newRoom,DUST.correctedBoundary,DUST.exited,DUST.newAllocation]]){
   const r=await supabase.rpc('assert_hotel_room_allocation_available',{p_room_id:room,p_capacity_reservation_id:DUST.capacity,p_allocated_from:from,p_allocated_until:until,p_exclude_allocation_id:allocation});
   if(r.error)fail(`객실 점유 검사에서 차단됐습니다: ${r.error.message}`);
  }
 }
 return {actorId,completed,fingerprint:JSON.stringify([actorId,stay,cap,a.data,e.data]),stayVersion:stay.version,oldVersion:old.version,newVersion:next.version,auditId:completed?corrections[0].id:null};
}
export async function executeDustCorrection(expected:DustCorrectionState,requestId:string,confirmed:boolean){
 if(!confirmed||!requestId||expected.completed)fail('명시적 최종 확인이 필요하거나 이미 정정된 기록입니다.');
 const fresh=await inspectDustCorrection();
 if(fresh.completed||fresh.fingerprint!==expected.fingerprint)fail('확인 후 상태 또는 로그인 계정이 변경됐습니다. 실행하지 않습니다.');
 // No target, time, version or identity can be supplied by the caller. The server pins all of them.
 const result=await supabase.rpc('correct_dust_transfer_20261107_v1',{p_request_id:requestId,p_confirmed:true});
 if(result.error)throw new Error(`${result.error.message} (${result.error.code})`);
 if(result.data?.operation!=='dust_transfer_20261107_v1'||result.data?.actor!==fresh.actorId
 ||result.data?.oldAllocation?.id!==DUST.oldAllocation||result.data?.newAllocation?.id!==DUST.newAllocation
 ||!sameTime(result.data?.oldAllocation?.allocated_until,DUST.correctedBoundary)||!sameTime(result.data?.newAllocation?.allocated_from,DUST.correctedBoundary))fail('정정 응답 확인 필요. 다시 실행하지 마세요.');
 const after=await inspectDustCorrection();
 if(!after.completed)fail('정정 후 감사·배정 확인 실패. 다시 실행하지 마세요.');
 return after;
}
