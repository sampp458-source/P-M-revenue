import {beforeEach,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('../lib/supabase',()=>({supabase:{rpc:m.rpc}}));
import {completeVerifiedDaycareCheckOut,fetchOverdueDaycareOperations,DaycareRepositoryError} from './daycareOperationsRepository';
beforeEach(()=>m.rpc.mockReset());
it('uses the new verified command with explicit time, version, request id and confirmation only',async()=>{
 m.rpc.mockResolvedValue({data:{version:4},error:null});await completeVerifiedDaycareCheckOut('schedule',3,'2026-10-18T08:00:00Z',true,'request');expect(m.rpc).toHaveBeenCalledWith('complete_verified_daycare_check_out_v1',{p_operation_schedule_id:'schedule',p_expected_version:3,p_checked_out_at:'2026-10-18T08:00:00Z',p_request_id:'request',p_confirmed:true});
});
it('keeps the read-only recovery query independent of the selected service date',async()=>{
 m.rpc.mockResolvedValue({data:[],error:null});expect(await fetchOverdueDaycareOperations()).toEqual([]);expect(m.rpc).toHaveBeenCalledWith('get_overdue_daycare_operations_v1',{});
});
it.each(['42501','PT409','23P01'])('propagates command failure without retry: %s',async(code)=>{
 m.rpc.mockResolvedValue({data:null,error:{code,message:'guard failure'}});await expect(completeVerifiedDaycareCheckOut('s',2,'2026-10-18T08:00:00Z',true,'r')).rejects.toBeInstanceOf(DaycareRepositoryError);expect(m.rpc).toHaveBeenCalledTimes(1);
});

it('preserves the verified-history conflict explanation without changing other errors',async()=>{
 const message='실제 퇴실 구간에 다른 점유 기록이 있거나 종료 근거가 부족합니다. 점유 이력을 확인해 주세요.';m.rpc.mockResolvedValue({data:null,error:{code:'23P01',message}});await expect(completeVerifiedDaycareCheckOut('s',2,'2026-10-18T08:00:00Z',true,'r')).rejects.toMatchObject({message,kind:'room_conflict'});
});
