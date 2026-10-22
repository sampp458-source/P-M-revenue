// @vitest-environment jsdom
import {cleanup, fireEvent, render, screen} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import {afterEach, expect, it, vi} from 'vitest';
const mocked = vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('../lib/supabase',()=>({supabase:{rpc:mocked.rpc}}));
import {HotelRoomBoard} from './HotelRoomBoard';
import {HotelOperationsRepositoryError,getLastHotelRoomMoveDiagnostic,moveHotelRoomSameType,type HotelStay,type HotelOperationsSnapshot} from './hotelOperationsRepository';
const stayId='c3343d3b-7d98-40c1-8df9-951da6fe082b';
const room2='519ce43b-8f45-47bd-8375-1da4bcc591da';
const room3='ded99ff0-0f3f-4ed0-8190-ccdf78be86c0';
const room6='d5d27c2f-c6ca-4bc2-be0e-4304c99e0eea';
const requestId='99000000-0000-4000-8000-000000000001';
// Reproduction clock, not an assertion that this was the original Production payload.
const at='2026-10-19T09:31:22.000Z';
afterEach(()=>{cleanup();vi.useRealTimers();mocked.rpc.mockReset();document.querySelectorAll('[style*="left: -1000px"]').forEach(n=>n.remove());});
const guest:HotelStay={id:stayId,dogId:'synthetic-dog',dogName:'Synthetic',customerId:'synthetic-customer',customerName:'Synthetic',customerPhone:null,version:2,requestId,checkedInAt:'2026-09-28T05:00:00Z',checkedInBy:null,checkedOutAt:null,checkedOutBy:null,createdBy:'synthetic-actor',createdAt:'2026-09-28T05:00:00Z',updatedAt:'2026-09-28T05:00:00Z',archivedAt:null,capacityReservation:{id:'b1f08c40-c983-49aa-a29c-624444ab6958',roomTypeId:'deluxe',roomTypeCode:'DELUXE',roomTypeName:'DELUXE',reservedFrom:'2026-09-28T05:00:00Z',reservedUntil:'infinity',quantity:1},scheduleEvents:[],roomAllocations:[{id:'a945799d-c84d-411b-9271-a5dd11e90a70',roomId:room2,roomName:'DELUXE 2',roomTypeId:'deluxe',allocatedFrom:'2026-09-28T05:00:00Z',allocatedUntil:'infinity',assignmentReason:null,version:1}]};
function board(){
 const snapshot:HotelOperationsSnapshot={date:'2026-10-19',roomTypes:[{id:'deluxe',code:'DELUXE',name:'DELUXE',activeRooms:3,reservedPeak:1,checkedInNow:1,allocatedNow:1,reservedNow:1,unassignedNow:0,physicallyEmpty:2}],rooms:[[room2,2],[room3,3],[room6,6]].map(([id,n])=>({id:String(id),name:`DELUXE ${n}`,roomTypeId:'deluxe',roomTypeCode:'DELUXE',roomTypeName:'DELUXE',isActive:true,sortOrder:Number(n)})),settings:null,stays:[guest],unassignedFuture:[]};
 const open=vi.fn();
 // Same adapter arguments as HotelOperations.dropStayOnRoom; actual Board + repository.
 const drop=vi.fn((id:string,room:string)=>{void moveHotelRoomSameType(id,guest.version,room,new Date().toISOString(),'Room Board 드래그 이동',requestId);});
 render(<HotelRoomBoard snapshot={snapshot} selectedDate="2026-10-19" dateMode="TODAY" selectedDateIsToday processing={false} allowCrossTypeChange={false} onUnassignStay={vi.fn()} onOpenStay={open} onDropStay={drop}/>);
 return {open,drop};
}
it.each([[room3,'DELUXE 3'],[room6,'DELUXE 6']])('native drop on %s sends its own UUID exactly once', (id,label)=>{
 vi.useFakeTimers();vi.setSystemTime(at);mocked.rpc.mockResolvedValue({data:guest,error:null});const {open,drop}=board();
 const values=new Map<string,string>();const transfer={setData:(k:string,v:string)=>values.set(k,v),getData:(k:string)=>values.get(k)??'',setDragImage:vi.fn()};
 const card=screen.getByTestId(`hotel-room-board-stay-${stayId}`),target=screen.getByTestId(`hotel-room-board-room-${id}`);
 expect(target).toHaveTextContent(label);fireEvent.dragStart(card,{dataTransfer:transfer});fireEvent.dragOver(target,{dataTransfer:transfer});fireEvent.drop(target,{dataTransfer:transfer});fireEvent.pointerUp(target);fireEvent.drop(target,{dataTransfer:transfer});
 expect(drop).toHaveBeenCalledTimes(1);expect(open).not.toHaveBeenCalled();expect(mocked.rpc).toHaveBeenCalledWith('move_hotel_room_same_type',{p_hotel_stay_id:stayId,p_expected_version:2,p_new_room_id:id,p_move_at:at,p_reason:'Room Board 드래그 이동',p_request_id:requestId});
});
it('tap selection preserves room UUID and ignores duplicate pointer completion',()=>{
 vi.useFakeTimers();vi.setSystemTime(at);mocked.rpc.mockResolvedValue({data:guest,error:null});const {drop}=board();
 fireEvent.click(screen.getByRole('button',{name:'Synthetic 호실 이동 시작'}));const target=screen.getByTestId(`hotel-room-board-room-${room3}`);fireEvent.pointerDown(target);fireEvent.pointerUp(target);
 expect(drop).toHaveBeenCalledTimes(1);expect(mocked.rpc.mock.calls[0][1].p_new_room_id).toBe(room3);
});
it.each([
 ['실제 퇴실이 완료되지 않은 호실입니다.','실제 퇴실이 완료되지 않은 이용 기록'],
 ['선택한 기간에 이미 사용 중인 호실입니다.','이동 시각 이후 배정 기간'],
 ['unknown exclusion failure','객실 이동을 완료하지 못했습니다.'],
])('keeps the meaning of a 23P01 without assuming a reservation: %s',async(message,expected)=>{
 const server={code:'23P01',message,details:'synthetic detail',hint:'synthetic hint'};mocked.rpc.mockResolvedValue({data:null,error:server});
 const error=await moveHotelRoomSameType(stayId,2,room3,at,'Synthetic',requestId).catch(e=>e);
 expect(error).toBeInstanceOf(HotelOperationsRepositoryError);expect(error.message).toContain(expected);expect(error.diagnostics).toEqual({rpc:'move_hotel_room_same_type',requestId,stayId,targetRoomId:room3,effectiveAt:at,expectedVersion:2,server});expect(error.message).not.toContain('synthetic detail');expect(mocked.rpc).toHaveBeenCalledTimes(1);
});
it('keeps stale version separate and retains request evidence without retry',async()=>{
 mocked.rpc.mockResolvedValue({data:null,error:{code:'40001',message:'stale version'}});const error=await moveHotelRoomSameType(stayId,1,room3,at,'Synthetic',requestId).catch(e=>e);expect(error.kind).toBe('conflict');expect(error.diagnostics.expectedVersion).toBe(1);expect(mocked.rpc).toHaveBeenCalledTimes(1);
});
it('captures source allocation and server-supplied constraint without changing the RPC payload',async()=>{
 const server=Object.assign(new Error('unknown exclusion failure'),{code:'23P01',constraint:'synthetic_constraint'});mocked.rpc.mockResolvedValue({data:null,error:server});
 const error=await moveHotelRoomSameType(stayId,2,room3,at,'Synthetic',requestId,'source-allocation').catch(e=>e);
 expect(error.diagnostics.sourceAllocationId).toBe('source-allocation');expect(getLastHotelRoomMoveDiagnostic()).toEqual(error.diagnostics);expect(getLastHotelRoomMoveDiagnostic()?.server?.message).toBe('unknown exclusion failure');const snapshot=getLastHotelRoomMoveDiagnostic()!;snapshot.requestId='changed';expect(getLastHotelRoomMoveDiagnostic()?.requestId).toBe(requestId);expect(error.diagnostics.server.constraint).toBe('synthetic_constraint');expect(mocked.rpc.mock.calls[0][1]).not.toHaveProperty('sourceAllocationId');expect(mocked.rpc.mock.calls[0][1]).not.toHaveProperty('p_source_allocation_id');
});
