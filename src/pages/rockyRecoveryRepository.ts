import {supabase} from '../lib/supabase';
import {fetchDaycareReservation,type DaycareReservation} from './daycareOperationsRepository';
import {fetchHotelOperationsSnapshot} from './hotelOperationsRepository';
export const ROCKY_ID='c8d76766-22e5-4b46-b191-248449b5be0b';
export const ROCKY_ROOM='f9c7f2eb-4d7b-4cbf-9c15-3d91c905e076';
export const ROCKY_IN='2026-10-27T01:20:00Z';
export const ROCKY_OUT='2026-10-27T09:10:00Z';
const date='2026-10-27';
function fail(message='최신 대상·점유 정보를 확인할 수 없습니다. 다시 조회해 주세요.'):never{throw new Error(message);}
function bound(value:string){if(value==='infinity')return Infinity;if(value==='-infinity')return -Infinity;const t=Date.parse(value);if(!Number.isFinite(t))fail();return t;}
async function guard(name:string,args:Record<string,unknown>){const r=await supabase.rpc(name,args);if(r.error)fail(r.error.message);}
export function assertRockyTarget(r:DaycareReservation){
 if(!r||r.operationScheduleId!==ROCKY_ID||r.dog.id!=='c305902e-d6ce-4e5e-809e-61d42dfabc50'||r.roomAllocation?.roomId!==ROCKY_ROOM||r.roomTypeCode!=='STANDARD'||!r.startsAt.startsWith(date)||!Number.isInteger(r.version))fail('복구 대상 또는 객실이 변경됐습니다. 실행하지 않습니다.');
 if(r.lifecycleStatus!=='scheduled'||r.scheduleStatus!=='scheduled'||r.checkedInAt||r.checkedOutAt||r.capacityReservation.archivedAt)fail('이미 처리됐거나 상태가 변경된 예약입니다. 재처리하지 않습니다.');
}
type Capacity={id:string;reserved_from:string;reserved_until:string;quantity:number;room_type_id:string|null;hotel_stay_id:string|null;daycare_schedule_id:string|null;archived_at:string|null};
export function capacityPeak(rows:Capacity[],ownId:string,typeId?:string){
 const points=new Map<number,number>();
 const add=(t:number,n:number)=>points.set(t,(points.get(t)||0)+n);
 add(Date.parse(ROCKY_IN),1);add(Date.parse(ROCKY_OUT),-1);
 for(const c of rows){if(c.id===ownId||c.archived_at||(typeId&&c.room_type_id!==typeId))continue;
 const start=Math.max(bound(c.reserved_from),Date.parse(ROCKY_IN)),end=Math.min(bound(c.reserved_until),Date.parse(ROCKY_OUT));
 if(!Number.isFinite(start)||!Number.isFinite(end)||!Number.isInteger(c.quantity)||c.quantity<1)fail();
 if(start<end){add(start,c.quantity);add(end,-c.quantity);}}
 let count=0,peak=0;for(const [,delta] of [...points].sort((a,b)=>a[0]-b[0])){count+=delta;peak=Math.max(peak,count);}return peak;
}
/** Conservative read-only precheck. The atomic command repeats authoritative guards under locks. */
export async function inspectRockyRecovery(){
 const r=await fetchDaycareReservation(ROCKY_ID);assertRockyTarget(r);
 const [snapshot,allocations,capacity]=await Promise.all([
 fetchHotelOperationsSnapshot(date),
 supabase.from('hotel_room_allocations').select('id,capacity_reservation_id,allocated_from,allocated_until,archived_at').eq('room_id',ROCKY_ROOM).limit(501),
 supabase.from('hotel_capacity_reservations').select('id,reserved_from,reserved_until,quantity,room_type_id,hotel_stay_id,daycare_schedule_id,archived_at').is('archived_at',null).lt('reserved_from',ROCKY_OUT).gt('reserved_until',ROCKY_IN).limit(501)]);
 if(allocations.error||capacity.error||!allocations.data||!capacity.data||allocations.data.length>=501||capacity.data.length>=501)fail();
 const own=r.capacityReservation.id;
 if(allocations.data.filter(a=>a.capacity_reservation_id===own&&!a.archived_at).length!==1)fail('단일 활성 배정이 아닙니다. 별도 확인이 필요합니다.');
 const others=allocations.data.filter(a=>a.capacity_reservation_id!==own);
 if(others.some(a=>bound(a.allocated_from)<Date.parse(ROCKY_OUT)&&bound(a.allocated_until)>Date.parse(ROCKY_IN)))fail('해당 이용 구간에 다른 배정 이력이 있습니다. 별도 확인이 필요합니다.');
 // A finite plan does not prove an actual exit. Preserve unknown historical holds.
 if(others.length){
 const caps=await supabase.from('hotel_capacity_reservations').select('id,hotel_stay_id,daycare_schedule_id').in('id',[...new Set(others.map(a=>a.capacity_reservation_id))]);
 if(caps.error||!caps.data||caps.data.length!==new Set(others.map(a=>a.capacity_reservation_id)).size)fail();
 const stays=caps.data.flatMap(c=>c.hotel_stay_id?[c.hotel_stay_id]:[]);
 if(stays.length){const h=await supabase.from('hotel_stays').select('id,checked_in_at,checked_out_at').in('id',stays);
 if(h.error||!h.data||h.data.length!==new Set(stays).size)fail();
 if(h.data.some(s=>s.checked_in_at&&Date.parse(s.checked_in_at)<Date.parse(ROCKY_OUT)&&(!s.checked_out_at||Date.parse(s.checked_out_at)>Date.parse(ROCKY_IN))))fail('과거 호텔 실제 퇴실 근거 또는 점유 이력을 확인해야 합니다.');}
 const visits=caps.data.flatMap(c=>c.daycare_schedule_id?[c.daycare_schedule_id]:[]);
 if(visits.length){const h=await supabase.from('daycare_operation_states').select('operation_schedule_id,checked_in_at,checked_out_at').in('operation_schedule_id',visits);
 if(h.error||!h.data||h.data.length!==new Set(visits).size)fail();
 if(h.data.some(s=>s.checked_in_at&&Date.parse(s.checked_in_at)<Date.parse(ROCKY_OUT)&&(!s.checked_out_at||Date.parse(s.checked_out_at)>Date.parse(ROCKY_IN))))fail('다른 Daycare 실제 점유 이력을 확인해야 합니다.');}}
 const room=snapshot.rooms.find(x=>x.id===ROCKY_ROOM);
 if(!room?.isActive||capacityPeak(capacity.data,own)>snapshot.roomTypes.reduce((n,t)=>n+t.activeRooms,0)||capacityPeak(capacity.data,own,r.roomTypeId)>(snapshot.roomTypes.find(t=>t.id===r.roomTypeId)?.activeRooms??0))fail('활성 객실 또는 Capacity를 확인해야 합니다.');
 await guard('assert_hotel_capacity_available',{p_room_type_id:r.roomTypeId,p_reserved_from:ROCKY_IN,p_reserved_until:ROCKY_OUT,p_quantity:1,p_exclude_reservation_id:own});
 // The existing room guard requires bounds inside the CURRENT Capacity. Use
 // its intersection for the current physical guard; the full actual interval
 // was checked above. The atomic RPC extends Capacity before its full guard.
 const from=new Date(Math.max(Date.parse(ROCKY_IN),bound(r.capacityReservation.reservedFrom))).toISOString();
 const until=new Date(Math.min(Date.parse(ROCKY_OUT),bound(r.capacityReservation.reservedUntil))).toISOString();
 if(Date.parse(from)>=Date.parse(until))fail('현재 배정 구간과 실제 이용 구간을 확인해야 합니다.');
 await guard('assert_hotel_room_allocation_available',{p_room_id:ROCKY_ROOM,p_capacity_reservation_id:own,p_allocated_from:from,p_allocated_until:until,p_exclude_allocation_id:r.roomAllocation!.id});
 return r;
}
export async function executeRockyRecovery(expected:DaycareReservation,requestId:string){
 const fresh=await inspectRockyRecovery();
 if(fresh.version!==expected.version||fresh.scheduleVersion!==expected.scheduleVersion||JSON.stringify(fresh.roomAllocation)!==JSON.stringify(expected.roomAllocation)||JSON.stringify(fresh.capacityReservation)!==JSON.stringify(expected.capacityReservation))fail('확인 후 예약이 변경됐습니다. 다시 조회하고 확인해 주세요.');
 const result=await supabase.rpc('reconcile_verified_daycare_visit_v1',{p_operation_schedule_id:ROCKY_ID,p_expected_version:fresh.version,p_checked_in_at:ROCKY_IN,p_checked_out_at:ROCKY_OUT,p_reason:'로키 확인된 실제 이용 구간과 배정·Capacity 정합성 복구',p_evidence:'대표자가 확인하여 전달한 실제 입실 2026-10-27 10:20 KST 및 실제 퇴실 2026-10-27 18:10 KST',p_request_id:requestId,p_confirmed:true});
 if(result.error)throw new Error(result.error.message);
 const r=result.data as DaycareReservation;
 if(r?.operationScheduleId!==ROCKY_ID||r.lifecycleStatus!=='completed'||Date.parse(r.checkedInAt??'')!==Date.parse(ROCKY_IN)||Date.parse(r.checkedOutAt??'')!==Date.parse(ROCKY_OUT)||r.scheduleVersion<fresh.scheduleVersion)fail('응답을 확정할 수 없습니다. 재실행하지 말고 처리 이력을 확인해 주세요.');
 return r;
}
