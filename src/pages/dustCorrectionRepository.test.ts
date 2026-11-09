import {beforeEach,describe,it,expect,vi} from 'vitest';
const api=vi.hoisted(()=>({user:vi.fn(),rpc:vi.fn(),from:vi.fn()}));
vi.mock('../lib/supabase',()=>({supabase:{auth:{getUser:api.user},rpc:api.rpc,from:api.from}}));
import {DUST,inspectDustCorrection,executeDustCorrection} from './dustCorrectionRepository';
function fixture(){return {
 hotel_stays:{id:String(DUST.stay),dog_id:String(DUST.dog),version:6,checked_in_at:String(DUST.entered),checked_out_at:String(DUST.exited),archived_at:null},
 hotel_capacity_reservations:{id:String(DUST.capacity),hotel_stay_id:String(DUST.stay),version:3,reserved_from:'2026-11-06T10:00:00Z',reserved_until:'2026-11-08T09:00:00Z',quantity:1,source_kind:'stay',shared_room_group_id:null,physical_occupancy_id:null,archived_at:null},
 hotel_room_allocations:[{id:String(DUST.oldAllocation),room_id:String(DUST.oldRoom),capacity_reservation_id:String(DUST.capacity),version:2,allocated_from:String(DUST.entered),allocated_until:String(DUST.oldBoundary),request_id:'original-entry',archived_at:null},{id:String(DUST.newAllocation),room_id:String(DUST.newRoom),capacity_reservation_id:String(DUST.capacity),version:3,allocated_from:String(DUST.oldBoundary),allocated_until:String(DUST.exited),request_id:String(DUST.moveRequest),archived_at:null}],
 entity_audit_events:[{id:String(DUST.moveAudit),entity_type:'hotel_stays',entity_id:String(DUST.stay),request_id:String(DUST.moveRequest),changed_by:'original-actor',created_at:'2026-11-07T10:36:00.194645Z',after_data:{} as Record<string,unknown>}],
};}
let rows=fixture(),conflict=false,readError=false;
const command='correct_dust_transfer_20261107_v1';
function complete(){
 rows.hotel_room_allocations[0].version=3;rows.hotel_room_allocations[0].allocated_until=DUST.correctedBoundary;
 rows.hotel_room_allocations[1].version=4;rows.hotel_room_allocations[1].allocated_from=DUST.correctedBoundary;
 const result={operation:'dust_transfer_20261107_v1',actor:'admin',proof:{moveAuditId:DUST.moveAudit,correctedBoundary:DUST.correctedBoundary},oldAllocation:rows.hotel_room_allocations[0],newAllocation:rows.hotel_room_allocations[1]};
 rows.entity_audit_events.push({id:'correction-audit',entity_type:'hotel_transfer_boundary_correction',entity_id:DUST.stay,request_id:'request',changed_by:'admin',created_at:'2026-11-09T10:00:00Z',after_data:result});return result;
}
beforeEach(()=>{
 vi.resetAllMocks();rows=fixture();conflict=false;readError=false;
 api.user.mockResolvedValue({data:{user:{id:'admin'}},error:null});
 api.rpc.mockImplementation(async(name)=>({data:name.startsWith('assert_')?null:true,error:null}));
 api.from.mockImplementation((table:keyof typeof rows)=>{
  let onlyConflicts=false;
  const q={select:vi.fn((fields)=>{onlyConflicts=fields==='id';return q;}),eq:vi.fn(()=>q),in:vi.fn(()=>q),order:vi.fn(()=>q),limit:vi.fn(()=>q),neq:vi.fn(()=>q),lt:vi.fn(()=>q),gt:vi.fn(()=>q),single:vi.fn(()=>q),then:(resolve:(v:unknown)=>unknown)=>Promise.resolve({data:structuredClone(onlyConflicts?(conflict?[{id:'other'}]:[]):rows[table]),error:readError?{message:'denied'}:null}).then(resolve)};return q;
 });
});
const writes=()=>api.rpc.mock.calls.filter(c=>c[0]===command);
describe('fixed Dust authenticated correction',()=>{
 it('reads exact target and source audit, no writes on inspect',async()=>{const r=await inspectDustCorrection();expect(r).toMatchObject({actorId:'admin',completed:false,stayVersion:6,oldVersion:2,newVersion:3});expect(writes()).toHaveLength(0);});
 it('requires a real authenticated user',async()=>{api.user.mockResolvedValue({data:{user:null},error:null});await expect(inspectDustCorrection()).rejects.toThrow('로그인');expect(api.from).not.toHaveBeenCalled();});
 it.each(['is_admin','is_active_operation_member','can_operate_hotel'])('denies failed %s',async(denied)=>{api.rpc.mockImplementation(async name=>({data:name!==denied,error:null}));await expect(inspectDustCorrection()).rejects.toThrow('관리자');expect(writes()).toHaveLength(0);});
 it('does not trust client UI permission when server read fails',async()=>{readError=true;await expect(inspectDustCorrection()).rejects.toThrow('조회');});
 it.each(['version','target','boundary','allocationVersion','move','capacity','audit'])('blocks drift: %s',async field=>{
  if(field==='version')rows.hotel_stays.version=7;
  if(field==='target')rows.hotel_stays.id='other';
  if(field==='boundary')rows.hotel_room_allocations[0].allocated_until=DUST.correctedBoundary;
  if(field==='allocationVersion')rows.hotel_room_allocations[1].version=4;
  if(field==='move')rows.hotel_room_allocations[1].request_id='other';
  if(field==='capacity')rows.hotel_capacity_reservations.quantity=2;
  if(field==='audit')rows.entity_audit_events=[];
  await expect(inspectDustCorrection()).rejects.toThrow();expect(writes()).toHaveLength(0);
 });
 it('blocks retained allocation overlap including archived histories',async()=>{conflict=true;await expect(inspectDustCorrection()).rejects.toThrow('다른 배정');expect(writes()).toHaveLength(0);});
 it('propagates official physical occupancy guard failure without write',async()=>{api.rpc.mockImplementation(async name=>({data:true,error:name.startsWith('assert_')?{message:'실제 점유 충돌'}:null}));await expect(inspectDustCorrection()).rejects.toThrow('실제 점유 충돌');expect(writes()).toHaveLength(0);});
 it('re-reads and denies changed actor before write',async()=>{const r=await inspectDustCorrection();api.user.mockResolvedValue({data:{user:{id:'other-admin'}},error:null});await expect(executeDustCorrection(r,'request',true)).rejects.toThrow('로그인 계정');expect(writes()).toHaveLength(0);});
 it('requires explicit final confirmation',async()=>{const r=await inspectDustCorrection();await expect(executeDustCorrection(r,'request',false)).rejects.toThrow('최종 확인');expect(writes()).toHaveLength(0);});
 it('one fixed command uses session and only request ID plus confirmed; verifies postflight',async()=>{
  const r=await inspectDustCorrection();api.rpc.mockImplementation(async name=>({data:name===command?complete():true,error:null}));
  expect(await executeDustCorrection(r,'unique-request',true)).toMatchObject({completed:true,auditId:'correction-audit'});
  expect(writes()).toEqual([[command,{p_request_id:'unique-request',p_confirmed:true}]]);
 });
 it('blocks an already corrected record from a fresh UI instance',async()=>{complete();const r=await inspectDustCorrection();expect(r.completed).toBe(true);await expect(executeDustCorrection(r,'another',true)).rejects.toThrow('이미 정정');expect(writes()).toHaveLength(0);});
 it('does not retry command errors',async()=>{const r=await inspectDustCorrection();api.rpc.mockImplementation(async name=>({data:true,error:name===command?{message:'충돌',code:'23P01'}:null}));await expect(executeDustCorrection(r,'request',true)).rejects.toThrow('23P01');expect(writes()).toHaveLength(1);});
 it('rejects uncertain success response and never retries',async()=>{const r=await inspectDustCorrection();await expect(executeDustCorrection(r,'request',true)).rejects.toThrow('응답 확인');expect(writes()).toHaveLength(1);});
});
